import Foundation

/// Verification copies have no credential, HTTP, calendar, or system clipboard capability.
struct VerificationTodoistPort: TodoistPort {
    func connection() async throws -> TodoistConnection { .disconnected }
    func connect(token: String) async throws -> (TodoistConnection, [CaptureProject]) { throw TasksFailure.unavailable }
    func disconnect() throws {}
    func projects() async throws -> [CaptureProject] { throw TasksFailure.todoistDisconnected }
    func selectProject(_ projectID: String) async throws -> TodoistConnection { throw TasksFailure.todoistDisconnected }
    func captures() async throws -> [CapturedTask] { throw TasksFailure.todoistDisconnected }
    func setCompleted(source: TodoistReference, completed: Bool, operationID: String) async throws {
        throw TasksFailure.todoistDisconnected
    }
}

struct VerificationCalendarPort: CalendarPort {
    func authorization() -> CalendarAuthorization { .unavailable }
    func requestAccess() async -> CalendarAuthorization { .unavailable }
    func calendars() throws -> [PlanningCalendar] { throw TasksFailure.calendarUnavailable }
    func appointments(start: Double, end: Double) throws -> [CalendarAppointment] { throw TasksFailure.calendarUnavailable }
    func createBlock(_ draft: CalendarBlockDraft) throws -> CalendarBlockReceipt { throw TasksFailure.calendarUnavailable }
}

struct VerificationClipboard: TasksClipboardPort { func copy(_ text: String) throws {} }
