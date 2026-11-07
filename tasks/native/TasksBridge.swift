import AppKit
import CoreFoundation
import Foundation
import WebKit

struct TasksBridgeSecurityPolicy {
    static func allows(isMainFrame: Bool, frameURL: URL?, bundledIndexURL: URL) -> Bool {
        guard isMainFrame, let frameURL, frameURL.isFileURL, bundledIndexURL.isFileURL else { return false }
        return frameURL.resolvingSymlinksInPath().standardizedFileURL ==
            bundledIndexURL.resolvingSymlinksInPath().standardizedFileURL
    }
}

@MainActor
final class TasksBridgeRouter {
    private let application: TasksApplication
    private let hotkeys: TasksHotkeyCoordinator
    private let clipboard: TasksClipboardPort
    var onFlushAcknowledged: ((String, Bool) -> Void)?
    var onDragRegion: (([String: Any]?) -> Bool)?
    var onPreferencesSaved: ((TasksPreferences) -> Void)?

    init(application: TasksApplication, hotkeys: TasksHotkeyCoordinator, clipboard: TasksClipboardPort = PasteboardTasksClipboard()) {
        self.application = application
        self.hotkeys = hotkeys
        self.clipboard = clipboard
    }

    func route(_ message: TasksBridgeMessage, reply: @escaping (Any?, String?) -> Void) {
        switch message {
        case .loadTasks:
            switch application.loadTasks().result {
            case let .ready(document, revision):
                reply(["kind": "ready", "document": document ?? NSNull(), "revision": revision], nil)
            case .unreadable:
                reply(["kind": "unreadable", "message": TasksFailure.unreadableStore.localizedDescription], nil)
            }
        case let .saveTasks(expectedRevision, document):
            do {
                switch try application.saveTasks(expectedRevision: expectedRevision, document: document) {
                case let .saved(revision): reply(["kind": "saved", "revision": revision], nil)
                case .conflict: reply(["kind": "conflict"], nil)
                }
            } catch { fail(reply, error) }
        case .loadPreferences:
            reply(preferencesValue(application.loadPreferences()), nil)
        case let .savePreferences(value):
            do {
                let saved = try application.savePreferences(value)
                onPreferencesSaved?(saved)
                reply(preferencesValue(saved), nil)
            } catch { fail(reply, error) }
        case .hotkeyPreferences:
            reply(Self.hotkeyValue(hotkeys.state), nil)
        case .resetHotkeyPreferences:
            reply(Self.hotkeyValue(hotkeys.reset()), nil)
        case let .setHotkey(chord):
            reply(Self.hotkeyValue(hotkeys.set(chord)), nil)
        case let .setHotkeyRecording(recording):
            hotkeys.setRecording(recording)
            reply(NSNull(), nil)
        case .todoistConnection:
            Task { @MainActor in
                do { reply(Self.connectionValue(try await application.todoistConnection()), nil) }
                catch { fail(reply, error) }
            }
        case let .connectTodoist(token):
            Task { @MainActor in
                do {
                    let (connection, projects) = try await application.connectTodoist(token: token)
                    reply(["connection": Self.connectionValue(connection), "projects": projects.map(Self.projectValue)], nil)
                } catch { fail(reply, error) }
            }
        case .disconnectTodoist:
            do { try application.disconnectTodoist(); reply(NSNull(), nil) }
            catch { fail(reply, error) }
        case .todoistProjects:
            Task { @MainActor in
                do { reply(try await application.todoistProjects().map(Self.projectValue), nil) }
                catch { fail(reply, error) }
            }
        case let .selectTodoistProject(projectID):
            Task { @MainActor in
                do { reply(Self.connectionValue(try await application.selectTodoistProject(projectID)), nil) }
                catch { fail(reply, error) }
            }
        case .todoistCaptures:
            Task { @MainActor in
                do { reply(try await application.todoistCaptures().map(Self.captureValue), nil) }
                catch { fail(reply, error) }
            }
        case let .setTodoistCompleted(source, completed, operationID):
            Task { @MainActor in
                do {
                    try await application.setTodoistCompleted(source: source, completed: completed, operationID: operationID)
                    reply(NSNull(), nil)
                } catch { fail(reply, error) }
            }
        case .calendarAuthorization:
            reply(application.calendarAuthorization().rawValue, nil)
        case .requestCalendarAccess:
            Task { @MainActor in
                reply(await application.requestCalendarAccess().rawValue, nil)
            }
        case .planningCalendars:
            do { reply(try application.planningCalendars().map(Self.calendarValue), nil) }
            catch { fail(reply, error) }
        case let .calendarAppointments(start, end):
            do { reply(try application.calendarAppointments(start: start, end: end).map(Self.appointmentValue), nil) }
            catch { fail(reply, error) }
        case let .createCalendarBlock(draft):
            do { reply(Self.receiptValue(try application.createCalendarBlock(draft)), nil) }
            catch { fail(reply, error) }
        case let .flushAcknowledged(requestID, saved):
            onFlushAcknowledged?(requestID, saved)
            reply(NSNull(), nil)
        case let .dragRegion(rect):
            guard onDragRegion?(rect) == true else { fail(reply, TasksFailure.invalidRequest); return }
            reply(NSNull(), nil)
        case let .copyText(text):
            do { try clipboard.copy(text); reply(NSNull(), nil) }
            catch { fail(reply, error) }
        }
    }

    private func fail(_ reply: @escaping (Any?, String?) -> Void, _ error: Error) {
        let safe = error as? TasksFailure ?? .unavailable
        reply(nil, safe.localizedDescription)
    }

    private func preferencesValue(_ value: TasksPreferences) -> [String: Any] {
        ["appearanceTheme": value.appearanceTheme.map { $0 as Any } ?? NSNull(), "pinned": value.pinned,
         "soundEnabled": value.soundEnabled, "motionEnabled": value.motionEnabled,
         "ripeningSpeed": value.ripeningSpeed.rawValue]
    }

    private static func hotkeyValue(_ state: TasksHotkeyState) -> [String: Any] {
        ["keyCode": state.chord.keyCode, "modifiers": state.chord.modifiers, "display": state.display,
         "registered": state.registered, "available": state.available,
         "error": state.error?.rawValue as Any? ?? NSNull()]
    }

    private static func connectionValue(_ connection: TodoistConnection) -> [String: Any] {
        switch connection {
        case .disconnected: return ["kind": "disconnected"]
        case let .connected(accountID, projectID): return ["kind": "connected", "accountID": accountID,
                                                           "projectID": projectID.map { $0 as Any } ?? NSNull()]
        }
    }
    private static func projectValue(_ value: CaptureProject) -> [String: Any] { ["id": value.id, "name": value.name] }
    private static func captureValue(_ value: CapturedTask) -> [String: Any] {
        ["source": ["accountID": value.source.accountID, "projectID": value.source.projectID, "taskID": value.source.taskID],
         "title": value.title, "notes": value.notes, "tags": value.tags, "priority": value.priority.rawValue,
         "createdAt": value.createdAt.map { $0 as Any } ?? NSNull()]
    }
    private static func calendarValue(_ value: PlanningCalendar) -> [String: Any] {
        ["id": value.id, "title": value.title, "sourceTitle": value.sourceTitle, "writable": value.writable]
    }
    private static func appointmentValue(_ value: CalendarAppointment) -> [String: Any] {
        ["id": value.id, "title": value.title, "start": value.start, "end": value.end, "allDay": value.allDay]
    }
    private static func receiptValue(_ value: CalendarBlockReceipt) -> [String: Any] {
        ["id": value.id, "start": value.start, "end": value.end, "calendarID": value.calendarID]
    }
}

@MainActor
final class TasksBridgeMessageAdapter: NSObject, WKScriptMessageHandlerWithReply {
    private let bundledIndexURL: URL
    var router: TasksBridgeRouter?

    init(bundledIndexURL: URL) { self.bundledIndexURL = bundledIndexURL }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard TasksBridgeSecurityPolicy.allows(isMainFrame: message.frameInfo.isMainFrame,
                                               frameURL: message.frameInfo.request.url,
                                               bundledIndexURL: bundledIndexURL) else {
            replyHandler(nil, TasksFailure.invalidRequest.localizedDescription)
            return
        }
        do {
            let request = try TasksBridgeDecoder.decode(message.body)
            guard let router else { throw TasksFailure.unavailable }
            router.route(request, reply: replyHandler)
        } catch {
            let safe = error as? TasksFailure ?? .invalidRequest
            replyHandler(nil, safe.localizedDescription)
        }
    }
}

final class PasteboardTasksClipboard: TasksClipboardPort {
    func copy(_ text: String) throws {
        NSPasteboard.general.clearContents()
        guard NSPasteboard.general.setString(text, forType: .string) else { throw TasksFailure.unavailable }
    }
}
