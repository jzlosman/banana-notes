import CoreFoundation
import Foundation

// MARK: - Application values

struct TasksPreferences: Codable, Equatable {
    enum RipeningSpeed: String, Codable { case gentle, normal, lively }

    let appearanceTheme: String?
    let pinned: Bool
    let soundEnabled: Bool
    let motionEnabled: Bool
    let ripeningSpeed: RipeningSpeed

    static let defaults = TasksPreferences(appearanceTheme: nil, pinned: false, soundEnabled: false,
                                           motionEnabled: true, ripeningSpeed: .normal)

    func validated(themeIDs: Set<String>) throws -> TasksPreferences {
        if let appearanceTheme, !themeIDs.contains(appearanceTheme) { throw TasksFailure.invalidPreferences }
        return self
    }
}

struct TasksThemeCatalog {
    struct Theme: Decodable {
        let id: String
        let appearance: String
        let colors: [String: String]
    }

    let themes: [String: Theme]

    init(data: Data) throws {
        let decoded = try JSONDecoder().decode([Theme].self, from: data)
        var values: [String: Theme] = [:]
        for theme in decoded {
            guard Self.validIdentifier(theme.id), values[theme.id] == nil,
                  theme.appearance == "light" || theme.appearance == "dark",
                  Self.validColor(theme.colors["paper"]) else { throw TasksFailure.invalidCatalog }
            values[theme.id] = theme
        }
        guard !values.isEmpty else { throw TasksFailure.invalidCatalog }
        themes = values
    }

    var identifiers: Set<String> { Set(themes.keys) }
    func theme(for id: String?) -> Theme? { id.flatMap { themes[$0] } }

    private static func validIdentifier(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 128 && value.unicodeScalars.allSatisfy {
            CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_")).contains($0)
        }
    }

    private static func validColor(_ value: String?) -> Bool {
        guard let value, value.count == 7, value.first == "#" else { return false }
        return value.dropFirst().allSatisfy { $0.isHexDigit }
    }
}

struct TodoistReference: Equatable {
    let accountID: String
    let projectID: String
    let taskID: String
}

enum TodoistConnection: Equatable {
    case disconnected
    case connected(accountID: String, projectID: String?)
}

struct CaptureProject: Equatable { let id: String; let name: String }
struct CapturedTask {
    enum Priority: String { case low, normal, high }
    let source: TodoistReference
    let title: String
    let notes: String
    let tags: [String]
    let priority: Priority
    let createdAt: Double?
}

enum CalendarAuthorization: String { case notDetermined, authorized, denied, unavailable }
struct PlanningCalendar: Equatable {
    let id: String
    let title: String
    let sourceTitle: String
    let writable: Bool
}
struct CalendarAppointment {
    let id: String
    let title: String
    let start: Double
    let end: Double
    let allDay: Bool
}
struct CalendarBlockDraft {
    let blockID: String
    let taskID: String
    let title: String
    let start: Double
    let end: Double
    let calendarID: String
}
struct CalendarBlockReceipt: Equatable {
    let id: String
    let start: Double
    let end: Double
    let calendarID: String
}

// MARK: - Safe failure vocabulary

enum TasksFailure: Error, LocalizedError {
    case invalidRequest
    case invalidPreferences
    case invalidCatalog
    case unavailable
    case unreadableStore
    case storeWriteFailed
    case todoistDisconnected
    case todoistAuthentication
    case todoistOffline
    case todoistRateLimited
    case todoistRejected
    case calendarDenied
    case calendarUnavailable
    case invalidCalendarRange
    case invalidCalendarBlock
    case calendarWriteFailed
    case invalidProfile

    var errorDescription: String? {
        switch self {
        case .invalidRequest: return "The Tasks request is invalid."
        case .invalidPreferences: return "The Tasks preferences are invalid."
        case .invalidCatalog: return "The Tasks theme catalog could not be loaded."
        case .unavailable: return "The requested Tasks capability is unavailable."
        case .unreadableStore: return "Tasks could not read its local data. The existing file was left unchanged."
        case .storeWriteFailed: return "Tasks could not save its local data. The current window remains open."
        case .todoistDisconnected: return "Connect Todoist before using this action."
        case .todoistAuthentication: return "Todoist did not accept the connection. Check the token and try again."
        case .todoistOffline: return "Todoist could not be reached. Check your connection and try again."
        case .todoistRateLimited: return "Todoist is temporarily limiting requests. Try again shortly."
        case .todoistRejected: return "Todoist could not complete the request. Try again."
        case .calendarDenied: return "Calendar access is not available. Review Calendar access in System Settings."
        case .calendarUnavailable: return "Calendar is unavailable right now."
        case .invalidCalendarRange: return "Choose a shorter date range within one year."
        case .invalidCalendarBlock: return "The calendar block details are invalid."
        case .calendarWriteFailed: return "The calendar block could not be saved. No existing event was changed."
        case .invalidProfile: return "This verification copy is not bound to its isolated data profile."
        }
    }
}

// MARK: - Wire boundary

enum TasksBridgeMessage {
    case loadTasks
    case saveTasks(expectedRevision: String, document: Any)
    case loadPreferences
    case savePreferences(TasksPreferences)
    case todoistConnection
    case connectTodoist(token: String)
    case disconnectTodoist
    case todoistProjects
    case selectTodoistProject(projectID: String)
    case todoistCaptures
    case setTodoistCompleted(source: TodoistReference, completed: Bool, operationID: String)
    case calendarAuthorization
    case requestCalendarAccess
    case planningCalendars
    case calendarAppointments(start: Double, end: Double)
    case createCalendarBlock(CalendarBlockDraft)
    case flushAcknowledged(requestID: String, saved: Bool)
    case dragRegion([String: Any]?)
    case copyText(String)
}

enum TasksBridgeDecoder {
    static let maxDocumentBytes = 8 * 1_024 * 1_024
    private static let maxRequestBytes = maxDocumentBytes + 32_768
    private static let preferenceKeys: Set<String> = ["appearanceTheme", "pinned", "soundEnabled", "motionEnabled", "ripeningSpeed"]

    static func decode(_ raw: Any) throws -> TasksBridgeMessage {
        guard isJSONValue(raw, depth: 0), let body = raw as? [String: Any], let action = body["action"] as? String,
              let encoded = try? JSONSerialization.data(withJSONObject: body, options: [.fragmentsAllowed]),
              encoded.count <= maxRequestBytes else { throw TasksFailure.invalidRequest }
        switch action {
        case "loadTasks": try exact(body, ["action"]); return .loadTasks
        case "saveTasks":
            try exact(body, ["action", "expectedRevision", "document"])
            guard let revision = body["expectedRevision"] as? String, isRevision(revision),
                  let document = body["document"], validDocument(document) else { throw TasksFailure.invalidRequest }
            return .saveTasks(expectedRevision: revision, document: document)
        case "loadPreferences": try exact(body, ["action"]); return .loadPreferences
        case "savePreferences":
            try exact(body, ["action", "preferences"])
            guard let rawPreferences = body["preferences"] as? [String: Any],
                  Set(rawPreferences.keys) == preferenceKeys,
                  let theme = rawPreferences["appearanceTheme"],
                  (theme is NSNull || theme is String),
                  let pinned = exactBoolean(rawPreferences["pinned"]),
                  let sound = exactBoolean(rawPreferences["soundEnabled"]),
                  let motion = exactBoolean(rawPreferences["motionEnabled"]),
                  let speedValue = rawPreferences["ripeningSpeed"] as? String,
                  let speed = TasksPreferences.RipeningSpeed(rawValue: speedValue) else { throw TasksFailure.invalidRequest }
            return .savePreferences(TasksPreferences(appearanceTheme: theme is NSNull ? nil : theme as? String,
                                                      pinned: pinned, soundEnabled: sound, motionEnabled: motion,
                                                      ripeningSpeed: speed))
        case "todoistConnection": try exact(body, ["action"]); return .todoistConnection
        case "connectTodoist":
            try exact(body, ["action", "token"])
            guard let token = body["token"] as? String, !token.isEmpty, token.utf8.count <= 4_096,
                  token.utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 45 || $0 == 46 || $0 == 95 }) else {
                throw TasksFailure.invalidRequest
            }
            return .connectTodoist(token: token)
        case "disconnectTodoist": try exact(body, ["action"]); return .disconnectTodoist
        case "todoistProjects": try exact(body, ["action"]); return .todoistProjects
        case "selectTodoistProject":
            try exact(body, ["action", "projectID"])
            guard let id = boundedString(body["projectID"], limit: 256) else { throw TasksFailure.invalidRequest }
            return .selectTodoistProject(projectID: id)
        case "todoistCaptures": try exact(body, ["action"]); return .todoistCaptures
        case "setTodoistCompleted":
            try exact(body, ["action", "source", "completed", "operationID"])
            guard let rawSource = body["source"] as? [String: Any], Set(rawSource.keys) == ["accountID", "projectID", "taskID"],
                  let accountID = boundedString(rawSource["accountID"], limit: 256),
                  let projectID = boundedString(rawSource["projectID"], limit: 256),
                  let taskID = boundedString(rawSource["taskID"], limit: 256),
                  let completed = exactBoolean(body["completed"]),
                  let operationID = boundedString(body["operationID"], limit: 128) else { throw TasksFailure.invalidRequest }
            return .setTodoistCompleted(source: TodoistReference(accountID: accountID, projectID: projectID, taskID: taskID),
                                         completed: completed, operationID: operationID)
        case "calendarAuthorization": try exact(body, ["action"]); return .calendarAuthorization
        case "requestCalendarAccess": try exact(body, ["action"]); return .requestCalendarAccess
        case "planningCalendars": try exact(body, ["action"]); return .planningCalendars
        case "calendarAppointments":
            try exact(body, ["action", "start", "end"])
            guard let start = finiteNumber(body["start"]), let end = finiteNumber(body["end"]) else { throw TasksFailure.invalidRequest }
            return .calendarAppointments(start: start, end: end)
        case "createCalendarBlock":
            try exact(body, ["action", "draft"])
            guard let draft = body["draft"] as? [String: Any],
                  Set(draft.keys) == ["blockID", "taskID", "title", "start", "end", "calendarID"],
                  let blockID = boundedString(draft["blockID"], limit: 128),
                  let taskID = boundedString(draft["taskID"], limit: 256),
                  let title = boundedString(draft["title"], limit: 4_096),
                  let start = finiteNumber(draft["start"]), let end = finiteNumber(draft["end"]),
                  let calendarID = boundedString(draft["calendarID"], limit: 512) else { throw TasksFailure.invalidRequest }
            return .createCalendarBlock(CalendarBlockDraft(blockID: blockID, taskID: taskID, title: title,
                                                           start: start, end: end, calendarID: calendarID))
        case "flushAcknowledged":
            try exact(body, ["action", "requestID", "saved"])
            guard let id = boundedString(body["requestID"], limit: 64), UUID(uuidString: id) != nil,
                  let saved = exactBoolean(body["saved"]) else { throw TasksFailure.invalidRequest }
            return .flushAcknowledged(requestID: id, saved: saved)
        case "dragRegion":
            try exact(body, ["action", "rect"])
            if body["rect"] is NSNull { return .dragRegion(nil) }
            guard let rect = body["rect"] as? [String: Any], Set(rect.keys) == ["x", "y", "width", "height"],
                  ["x", "y", "width", "height"].allSatisfy({ finiteNumber(rect[$0]) != nil }) else { throw TasksFailure.invalidRequest }
            return .dragRegion(rect)
        case "copyText":
            try exact(body, ["action", "text"])
            guard let text = body["text"] as? String, text.utf8.count <= 1_048_576 else { throw TasksFailure.invalidRequest }
            return .copyText(text)
        default: throw TasksFailure.invalidRequest
        }
    }

    static func validDocument(_ document: Any) -> Bool {
        guard isJSONValue(document, depth: 0),
              let data = try? JSONSerialization.data(withJSONObject: document, options: [.fragmentsAllowed]),
              data.count <= maxDocumentBytes,
              let root = document as? [String: Any], let version = root["version"] as? NSNumber,
              CFGetTypeID(version) != CFBooleanGetTypeID(), version.intValue == 1,
              version.doubleValue == 1 else { return false }
        return true
    }

    private static func isJSONValue(_ value: Any, depth: Int) -> Bool {
        guard depth <= 64 else { return false }
        if value is NSNull { return true }
        if value is String { return true }
        if let number = value as? NSNumber { return number.doubleValue.isFinite }
        if let values = value as? [Any] {
            return values.count <= 100_000 && values.allSatisfy { isJSONValue($0, depth: depth + 1) }
        }
        if let values = value as? [String: Any] {
            return values.count <= 100_000 && values.allSatisfy { key, item in
                key.utf8.count <= 16_384 && isJSONValue(item, depth: depth + 1)
            }
        }
        return false
    }
    private static func exact(_ body: [String: Any], _ expected: Set<String>) throws {
        guard Set(body.keys) == expected else { throw TasksFailure.invalidRequest }
    }
    private static func exact(_ body: [String: Any], _ expected: [String]) throws { try exact(body, Set(expected)) }
    private static func boundedString(_ value: Any?, limit: Int) -> String? {
        guard let value = value as? String, !value.isEmpty, value.utf8.count <= limit else { return nil }
        return value
    }
    private static func exactBoolean(_ value: Any?) -> Bool? {
        guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
        return number.boolValue
    }
    private static func finiteNumber(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue.isFinite else { return nil }
        return number.doubleValue
    }
    private static func isRevision(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
}

// MARK: - Effect ports

protocol TasksDocumentStorePort {
    func load() throws -> (document: Any?, revision: String)
    func save(expectedRevision: String, document: Any) throws -> String?
}
protocol TasksPreferencesPort {
    func load() -> TasksPreferences
    func save(_ preferences: TasksPreferences) throws -> TasksPreferences
}
protocol TasksClock { func nowMilliseconds() -> Double }
protocol TasksIdentitySource { func next() -> String }
protocol TasksClipboardPort { func copy(_ text: String) throws }
protocol TodoistPort {
    func connection() async throws -> TodoistConnection
    func connect(token: String) async throws -> (TodoistConnection, [CaptureProject])
    func disconnect() throws
    func projects() async throws -> [CaptureProject]
    func selectProject(_ projectID: String) async throws -> TodoistConnection
    func captures() async throws -> [CapturedTask]
    func setCompleted(source: TodoistReference, completed: Bool, operationID: String) async throws
}
protocol CalendarPort {
    func authorization() -> CalendarAuthorization
    func requestAccess() async -> CalendarAuthorization
    func calendars() throws -> [PlanningCalendar]
    func appointments(start: Double, end: Double) throws -> [CalendarAppointment]
    func createBlock(_ draft: CalendarBlockDraft) throws -> CalendarBlockReceipt
}

struct SystemTasksClock: TasksClock { func nowMilliseconds() -> Double { Date().timeIntervalSince1970 * 1_000 } }
struct UUIDTasksIdentitySource: TasksIdentitySource { func next() -> String { UUID().uuidString.lowercased() } }

struct TasksFocusState {
    private(set) var isFocused = false
    private(set) var lossDeadline: Double?

    mutating func update(isKeyWindow: Bool, at time: Double) -> Bool {
        guard time.isFinite else { return false }
        if isKeyWindow {
            lossDeadline = nil
            guard !isFocused else { return false }
            isFocused = true
            return true
        }
        guard isFocused else { return false }
        if lossDeadline == nil { lossDeadline = time + 0.5 }
        return false
    }

    mutating func settle(at time: Double) -> Bool {
        guard let deadline = lossDeadline, time.isFinite, time >= deadline else { return false }
        lossDeadline = nil
        isFocused = false
        return true
    }
}

/// Rejects stale WebKit acknowledgements and authorizes dismissal only after an explicit saved=true reply.
struct TasksFlushState {
    private(set) var requestID: String?

    mutating func begin(_ requestID: String) -> Bool {
        guard self.requestID == nil, UUID(uuidString: requestID) != nil else { return false }
        self.requestID = requestID
        return true
    }

    mutating func acknowledge(requestID: String, saved: Bool) -> Bool? {
        guard self.requestID == requestID else { return nil }
        self.requestID = nil
        return saved
    }
}

// Pure bounds and marker rules shared by the Calendar application service and adapter.
enum CalendarBlockPolicy {
    static let maximumDurationMilliseconds: Double = 12 * 60 * 60 * 1_000
    static let maximumRangeMilliseconds: Double = 366 * 24 * 60 * 60 * 1_000
    static let maximumSafeIntegerMilliseconds: Double = 9_007_199_254_740_991

    static func isSafeIntegerMilliseconds(_ value: Double) -> Bool {
        value.isFinite && value.rounded() == value && abs(value) <= maximumSafeIntegerMilliseconds
    }

    static func validateRange(start: Double, end: Double, now: Double) throws {
        guard isSafeIntegerMilliseconds(start), isSafeIntegerMilliseconds(end), start >= 0, end > start,
              end - start <= maximumRangeMilliseconds, now.isFinite,
              start >= now - maximumRangeMilliseconds, end <= now + maximumRangeMilliseconds else {
            throw TasksFailure.invalidCalendarRange
        }
    }
    static func validate(_ draft: CalendarBlockDraft, now: Double) throws {
        guard now.isFinite else { throw TasksFailure.invalidCalendarBlock }
        let currentMillisecond = now.rounded(.towardZero)
        guard !draft.blockID.isEmpty, draft.blockID.utf16.count <= 128,
              !draft.taskID.isEmpty, draft.taskID.utf16.count <= 128,
              !draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, draft.title.utf16.count <= 240,
              !draft.calendarID.isEmpty, draft.calendarID.utf16.count <= 128,
              isSafeIntegerMilliseconds(draft.start), isSafeIntegerMilliseconds(draft.end), draft.start >= 0,
              draft.end > draft.start, draft.end - draft.start <= maximumDurationMilliseconds,
              draft.start >= currentMillisecond else {
            throw TasksFailure.invalidCalendarBlock
        }
    }
    static func markerURL(blockID: String) -> URL? {
        guard !blockID.isEmpty, blockID.utf8.count <= 128,
              blockID.unicodeScalars.allSatisfy({ CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_")).contains($0) }) else { return nil }
        return URL(string: "banana-tasks-block://\(blockID)")
    }
}
