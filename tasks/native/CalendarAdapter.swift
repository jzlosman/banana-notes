import EventKit
import Foundation

struct CalendarGatewayCalendar {
    let id: String
    let title: String
    let sourceTitle: String
    let writable: Bool
}
struct CalendarGatewayEvent {
    let id: String
    let title: String
    let start: Double
    let end: Double
    let allDay: Bool
}

protocol EventKitGateway {
    func authorization() -> CalendarAuthorization
    func requestFullAccess() async -> CalendarAuthorization
    func calendars() -> [CalendarGatewayCalendar]
    func events(start: Double, end: Double, calendarID: String?) throws -> [CalendarGatewayEvent]
    func existingBlock(marker: URL, calendarID: String, start: Double, end: Double) throws -> CalendarBlockReceipt?
    func createBlock(_ draft: CalendarBlockDraft, marker: URL) throws -> CalendarBlockReceipt
}

final class CalendarAdapter: CalendarPort {
    private let gateway: EventKitGateway
    private let clock: TasksClock

    init(gateway: EventKitGateway = SystemEventKitGateway(), clock: TasksClock = SystemTasksClock()) {
        self.gateway = gateway
        self.clock = clock
    }

    func authorization() -> CalendarAuthorization { gateway.authorization() }

    func requestAccess() async -> CalendarAuthorization { await gateway.requestFullAccess() }

    func calendars() throws -> [PlanningCalendar] {
        guard gateway.authorization() == .authorized else { throw authorizationFailure() }
        let records = gateway.calendars()
        guard records.count <= 500 else { throw TasksFailure.calendarUnavailable }
        return try records.map { record in
            guard !record.id.isEmpty, record.id.utf16.count <= 128 else { throw TasksFailure.calendarUnavailable }
            return PlanningCalendar(id: record.id, title: Self.displayText(record.title, maximumUTF16Length: 512),
                                    sourceTitle: Self.displayText(record.sourceTitle, maximumUTF16Length: 512),
                                    writable: record.writable)
        }
    }

    func appointments(start: Double, end: Double) throws -> [CalendarAppointment] {
        try CalendarBlockPolicy.validateRange(start: start, end: end, now: clock.nowMilliseconds())
        guard gateway.authorization() == .authorized else { throw authorizationFailure() }
        let records: [CalendarGatewayEvent]
        do { records = try gateway.events(start: start, end: end, calendarID: nil) }
        catch { throw TasksFailure.calendarUnavailable }
        guard records.count <= 10_000 else { throw TasksFailure.calendarUnavailable }
        return try records.map { record in
            guard !record.id.isEmpty, record.id.utf16.count <= 128,
                  let normalizedStart = Self.normalizedTimestamp(record.start),
                  let normalizedEnd = Self.normalizedTimestamp(record.end), normalizedEnd > normalizedStart else {
                throw TasksFailure.calendarUnavailable
            }
            return CalendarAppointment(id: record.id, title: Self.displayText(record.title, maximumUTF16Length: 1_000),
                                       start: normalizedStart, end: normalizedEnd, allDay: record.allDay)
        }
    }

    func createBlock(_ draft: CalendarBlockDraft) throws -> CalendarBlockReceipt {
        try CalendarBlockPolicy.validate(draft, now: clock.nowMilliseconds())
        guard gateway.authorization() == .authorized else { throw authorizationFailure() }
        guard let calendar = gateway.calendars().first(where: { $0.id == draft.calendarID }), calendar.writable,
              let marker = CalendarBlockPolicy.markerURL(blockID: draft.blockID) else { throw TasksFailure.invalidCalendarBlock }
        do {
            if let existing = try gateway.existingBlock(marker: marker, calendarID: draft.calendarID,
                                                         start: draft.start, end: draft.end) {
                return try Self.normalizedReceipt(existing, for: draft)
            }
            let receipt = try gateway.createBlock(draft, marker: marker)
            return try Self.normalizedReceipt(receipt, for: draft)
        } catch { throw TasksFailure.calendarWriteFailed }
    }

    private static func normalizedTimestamp(_ value: Double) -> Double? {
        guard value.isFinite, abs(value) <= CalendarBlockPolicy.maximumSafeIntegerMilliseconds else { return nil }
        let normalized = value.rounded(.toNearestOrAwayFromZero)
        return CalendarBlockPolicy.isSafeIntegerMilliseconds(normalized) ? normalized : nil
    }

    private static func normalizedReceipt(_ receipt: CalendarBlockReceipt, for draft: CalendarBlockDraft) throws -> CalendarBlockReceipt {
        guard !receipt.id.isEmpty, receipt.id.utf16.count <= 128,
              receipt.calendarID == draft.calendarID, receipt.calendarID.utf16.count <= 128,
              let start = normalizedTimestamp(receipt.start), let end = normalizedTimestamp(receipt.end),
              end > start, start == draft.start, end == draft.end else { throw TasksFailure.calendarWriteFailed }
        return CalendarBlockReceipt(id: receipt.id, start: start, end: end, calendarID: receipt.calendarID)
    }

    private static func displayText(_ value: String, maximumUTF16Length: Int) -> String {
        var result = ""
        var length = 0
        for scalar in value.unicodeScalars {
            let scalarLength = scalar.value > 0xFFFF ? 2 : 1
            guard length + scalarLength <= maximumUTF16Length else { break }
            result.unicodeScalars.append(scalar)
            length += scalarLength
        }
        return result
    }

    private func authorizationFailure() -> TasksFailure {
        gateway.authorization() == .unavailable ? .calendarUnavailable : .calendarDenied
    }
}

final class SystemEventKitGateway: EventKitGateway {
    private let store: EKEventStore

    init(store: EKEventStore = EKEventStore()) { self.store = store }

    func authorization() -> CalendarAuthorization {
        switch EKEventStore.authorizationStatus(for: .event) {
        case .fullAccess: return .authorized
        case .notDetermined: return .notDetermined
        case .denied, .restricted, .writeOnly: return .denied
        @unknown default: return .unavailable
        }
    }

    func requestFullAccess() async -> CalendarAuthorization {
        guard authorization() == .notDetermined else { return authorization() }
        do {
            _ = try await store.requestFullAccessToEvents()
            return authorization()
        } catch { return authorization() }
    }

    func calendars() -> [CalendarGatewayCalendar] {
        store.calendars(for: .event).map {
            CalendarGatewayCalendar(id: $0.calendarIdentifier, title: $0.title,
                                    sourceTitle: $0.source.title, writable: $0.allowsContentModifications)
        }
    }

    func events(start: Double, end: Double, calendarID: String?) throws -> [CalendarGatewayEvent] {
        let startDate = Date(timeIntervalSince1970: start / 1_000)
        let endDate = Date(timeIntervalSince1970: end / 1_000)
        let calendars: [EKCalendar]?
        if let calendarID {
            guard let selected = store.calendar(withIdentifier: calendarID) else { throw TasksFailure.calendarUnavailable }
            calendars = [selected]
        } else { calendars = nil }
        let predicate = store.predicateForEvents(withStart: startDate, end: endDate, calendars: calendars)
        return store.events(matching: predicate).map {
            CalendarGatewayEvent(id: $0.eventIdentifier ?? "", title: $0.title ?? "",
                                 start: $0.startDate.timeIntervalSince1970 * 1_000,
                                 end: $0.endDate.timeIntervalSince1970 * 1_000, allDay: $0.isAllDay)
        }
    }

    func existingBlock(marker: URL, calendarID: String, start: Double, end: Double) throws -> CalendarBlockReceipt? {
        guard let calendar = store.calendar(withIdentifier: calendarID) else { throw TasksFailure.calendarUnavailable }
        let margin = 60 * 60 * 1_000.0
        let predicate = store.predicateForEvents(withStart: Date(timeIntervalSince1970: (start - margin) / 1_000),
                                                 end: Date(timeIntervalSince1970: (end + margin) / 1_000), calendars: [calendar])
        guard let event = store.events(matching: predicate).first(where: { $0.url == marker }) else { return nil }
        guard let id = event.eventIdentifier else { throw TasksFailure.calendarWriteFailed }
        return CalendarBlockReceipt(id: id,
                                   start: event.startDate.timeIntervalSince1970 * 1_000,
                                   end: event.endDate.timeIntervalSince1970 * 1_000,
                                   calendarID: calendarID)
    }

    func createBlock(_ draft: CalendarBlockDraft, marker: URL) throws -> CalendarBlockReceipt {
        guard let calendar = store.calendar(withIdentifier: draft.calendarID), calendar.allowsContentModifications else {
            throw TasksFailure.calendarWriteFailed
        }
        let event = EKEvent(eventStore: store)
        event.calendar = calendar
        event.title = draft.title
        event.startDate = Date(timeIntervalSince1970: draft.start / 1_000)
        event.endDate = Date(timeIntervalSince1970: draft.end / 1_000)
        event.url = marker
        try store.save(event, span: .thisEvent, commit: true)
        guard let id = event.eventIdentifier else { throw TasksFailure.calendarWriteFailed }
        return CalendarBlockReceipt(id: id, start: draft.start, end: draft.end, calendarID: draft.calendarID)
    }
}

final class MemoryEventKitGateway: EventKitGateway {
    var currentAuthorization: CalendarAuthorization = .notDetermined
    var availableCalendars: [CalendarGatewayCalendar] = []
    var storedEvents: [(CalendarGatewayEvent, URL, String)] = []
    var failWrites = false
    private(set) var requestCount = 0
    private(set) var writeCount = 0

    func authorization() -> CalendarAuthorization { currentAuthorization }
    func requestFullAccess() async -> CalendarAuthorization {
        requestCount += 1
        if currentAuthorization == .notDetermined { currentAuthorization = .authorized }
        return currentAuthorization
    }
    func calendars() -> [CalendarGatewayCalendar] { availableCalendars }
    func events(start: Double, end: Double, calendarID: String?) throws -> [CalendarGatewayEvent] {
        storedEvents.map(\.0).filter { $0.start < end && $0.end > start }
    }
    func existingBlock(marker: URL, calendarID: String, start: Double, end: Double) throws -> CalendarBlockReceipt? {
        guard let (event, _, eventCalendarID) = storedEvents.first(where: { $0.1 == marker && $0.2 == calendarID }) else { return nil }
        return CalendarBlockReceipt(id: event.id, start: event.start, end: event.end, calendarID: eventCalendarID)
    }
    func createBlock(_ draft: CalendarBlockDraft, marker: URL) throws -> CalendarBlockReceipt {
        if failWrites { throw TasksFailure.calendarWriteFailed }
        guard availableCalendars.contains(where: { $0.id == draft.calendarID && $0.writable }) else { throw TasksFailure.calendarWriteFailed }
        writeCount += 1
        let event = CalendarGatewayEvent(id: "synthetic-\(writeCount)", title: draft.title, start: draft.start, end: draft.end, allDay: false)
        storedEvents.append((event, marker, draft.calendarID))
        return CalendarBlockReceipt(id: event.id, start: event.start, end: event.end, calendarID: draft.calendarID)
    }
}
