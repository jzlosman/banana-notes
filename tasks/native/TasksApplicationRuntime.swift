import AppKit
import Foundation
import WebKit

@MainActor
final class TasksApplicationRuntime {
    private let webDirectory: URL
    private let dataDirectory: URL
    private let catalog: TasksThemeCatalog
    private let preferences: UserDefaultsTasksPreferences
    private let documents: TasksLocalDocumentStore
    private let windowController: TasksWindowController
    private let menu: TasksMenuController
    private let hotkey = TasksGlobalHotkeyService()
    private let application: TasksApplication
    private let bridge: TasksBridgeRouter

    init(resourcesDirectory: URL, bundleInfo: [String: Any], environment: [String: String] = ProcessInfo.processInfo.environment) throws {
        webDirectory = resourcesDirectory.appendingPathComponent("web", isDirectory: true)
        let catalogData = try Data(contentsOf: webDirectory.appendingPathComponent("theme-catalog.json"))
        catalog = try TasksThemeCatalog(data: catalogData)
        let profile = try TasksProfileResolver.resolve(bundleInfo: bundleInfo, environment: environment)
        dataDirectory = profile.dataDirectory
        documents = try TasksLocalDocumentStore(directory: dataDirectory)

        let defaults: UserDefaults
        let todoist: TodoistPort
        let calendar: CalendarPort
        let clipboard: TasksClipboardPort
        switch profile {
        case .production:
            defaults = .standard
            todoist = TodoistAdapter()
            calendar = CalendarAdapter()
            clipboard = PasteboardTasksClipboard()
        case let .verification(_, preferencesSuiteName):
            guard let suite = UserDefaults(suiteName: preferencesSuiteName) else { throw TasksFailure.invalidProfile }
            defaults = suite
            todoist = VerificationTodoistPort()
            calendar = VerificationCalendarPort()
            clipboard = VerificationClipboard()
        }
        preferences = UserDefaultsTasksPreferences(defaults: defaults, catalog: catalog)
        application = TasksApplication(documents: documents, preferences: preferences, todoist: todoist, calendar: calendar)
        let initialPreferences = preferences.load()
        windowController = TasksWindowController(webDirectory: webDirectory, catalog: catalog, preferences: initialPreferences)
        bridge = TasksBridgeRouter(application: application, clipboard: clipboard)
        windowController.router = bridge
        bridge.onFlushAcknowledged = { [weak windowController] in windowController?.acknowledgeFlush(requestID: $0, saved: $1) }
        bridge.onDragRegion = { [weak windowController] in windowController?.setDragRegion($0) ?? false }
        bridge.onPreferencesSaved = { [weak windowController] in windowController?.applyPreferences($0) }
        menu = TasksMenuController(isPinned: initialPreferences.pinned)
    }

    func start() {
        NSApp.setActivationPolicy(.accessory)
        menu.onAction = { [weak self] action in self?.handle(action) }
        windowController.onOpenDataFolder = { [weak self] in
            guard let self else { return }
            NSWorkspace.shared.open(self.dataDirectory)
        }
        windowController.onPinnedChange = { [weak menu] in menu?.updatePinned($0) }
        hotkey.onHotkey = { [weak windowController] in windowController?.toggleVisibility() }
        _ = hotkey.register()
        windowController.show()
    }

    func reopen() { windowController.show() }

    func requestTermination(_ reply: @escaping (Bool) -> Void) {
        windowController.requestTermination(reply)
    }

    func shutdown() {
        hotkey.unregister()
        windowController.shutdown()
        bridge.onFlushAcknowledged = nil
        bridge.onDragRegion = nil
        bridge.onPreferencesSaved = nil
    }

    private func handle(_ action: TasksMenuAction) {
        switch action {
        case .toggleWindow: windowController.toggleVisibility()
        case .newTask: windowController.show(); windowController.dispatchCommand("newTask")
        case .settings: windowController.show(); windowController.dispatchCommand("settings")
        case .toggleTimer: windowController.show(); windowController.dispatchCommand("toggleTimer")
        case .togglePin: windowController.show(); windowController.dispatchCommand("togglePin")
        case .quit: NSApp.terminate(nil)
        }
    }
}

@MainActor
final class TasksAppDelegate: NSObject, NSApplicationDelegate {
    private var runtime: TasksApplicationRuntime?

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let resources = Bundle.main.resourceURL else { fail("Banana Tasks is missing its Resources directory."); return }
        let web = resources.appendingPathComponent("web", isDirectory: true)
        let required = ["tasks.html", "tasks.js", "tasks.css", "app.css", "theme-catalog.json"]
        guard required.allSatisfy({ FileManager.default.fileExists(atPath: web.appendingPathComponent($0).path) }) else {
            fail("Banana Tasks is missing bundled web assets. Build the Tasks web assets before launching the app.")
            return
        }
        do {
            let runtime = try TasksApplicationRuntime(resourcesDirectory: resources, bundleInfo: Bundle.main.infoDictionary ?? [:])
            self.runtime = runtime
            runtime.start()
        } catch let failure as TasksFailure {
            fail(failure.localizedDescription)
        } catch {
            fail("Banana Tasks could not load its bundled catalogs or local profile.")
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        runtime?.reopen()
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let runtime else { return .terminateNow }
        runtime.requestTermination { saved in sender.reply(toApplicationShouldTerminate: saved) }
        return .terminateLater
    }

    func applicationWillTerminate(_ notification: Notification) { runtime?.shutdown() }

    private func fail(_ message: String) {
        fputs("\(message)\n", stderr)
        NSApp.terminate(nil)
    }
}
