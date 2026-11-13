import Foundation

struct LoadedTasks {
    enum Result { case ready(document: Any?, revision: String), unreadable }
    let result: Result
}
enum SavedTasks { case saved(revision: String), conflict }

/// Application orchestration is deliberately independent of AppKit, WebKit and provider SDKs.
final class TasksApplication {
    private let documents: TasksDocumentStorePort
    private let recovery: TasksBackupRecoveryPort?
    private let preferences: TasksPreferencesPort
    private let todoist: TodoistPort
    private let calendar: CalendarPort

    init(documents: TasksDocumentStorePort, preferences: TasksPreferencesPort,
         todoist: TodoistPort, calendar: CalendarPort, recovery: TasksBackupRecoveryPort? = nil) {
        self.documents = documents
        self.recovery = recovery
        self.preferences = preferences
        self.todoist = todoist
        self.calendar = calendar
    }

    func loadTasks() -> LoadedTasks {
        do {
            let loaded = try documents.load()
            return LoadedTasks(result: .ready(document: loaded.document, revision: loaded.revision))
        } catch { return LoadedTasks(result: .unreadable) }
    }

    func saveTasks(expectedRevision: String, document: Any) throws -> SavedTasks {
        guard let revision = try documents.save(expectedRevision: expectedRevision, document: document) else { return .conflict }
        return .saved(revision: revision)
    }

    func inspectTasksRecovery() -> TasksRecoveryInspection {
        recovery?.inspectBackupRecovery() ?? .unavailable
    }

    func restoreTasksBackup(expectedPrimaryRevision: String?, expectedBackupRevision: String) throws -> TasksBackupRestoration {
        guard let recovery else { throw TasksFailure.unavailable }
        return try recovery.restoreBackup(expectedPrimaryRevision: expectedPrimaryRevision,
                                          expectedBackupRevision: expectedBackupRevision)
    }

    func loadPreferences() -> TasksPreferences { preferences.load() }
    func savePreferences(_ value: TasksPreferences) throws -> TasksPreferences { try preferences.save(value) }

    func todoistConnection() async throws -> TodoistConnection { try await todoist.connection() }
    func connectTodoist(token: String) async throws -> (TodoistConnection, [CaptureProject]) { try await todoist.connect(token: token) }
    func disconnectTodoist() throws { try todoist.disconnect() }
    func todoistProjects() async throws -> [CaptureProject] { try await todoist.projects() }
    func selectTodoistProject(_ id: String) async throws -> TodoistConnection { try await todoist.selectProject(id) }
    func todoistCaptures() async throws -> [CapturedTask] { try await todoist.captures() }
    func setTodoistCompleted(source: TodoistReference, completed: Bool, operationID: String) async throws {
        try await todoist.setCompleted(source: source, completed: completed, operationID: operationID)
    }

    func calendarAuthorization() -> CalendarAuthorization { calendar.authorization() }
    func requestCalendarAccess() async -> CalendarAuthorization { await calendar.requestAccess() }
    func planningCalendars() throws -> [PlanningCalendar] { try calendar.calendars() }
    func calendarAppointments(start: Double, end: Double) throws -> [CalendarAppointment] {
        try calendar.appointments(start: start, end: end)
    }
    func createCalendarBlock(_ draft: CalendarBlockDraft) throws -> CalendarBlockReceipt { try calendar.createBlock(draft) }
}
