import CoreFoundation
import Foundation
import Security

struct TodoistCredential: Codable, Equatable {
    let token: String
    let accountID: String
    var projectID: String?
}

protocol TodoistCredentialStore {
    var lifecycleScope: String { get }
    func read() throws -> TodoistCredential?
    func write(_ credential: TodoistCredential) throws
    func remove() throws
}

private struct TodoistCredentialSnapshot {
    let ticket: UUID?
    let credential: TodoistCredential?
}

/// Orders local credential mutations across adapters sharing the same persistent store.
/// The lock only protects synchronous snapshots and commits; it is never held over HTTP.
private enum TodoistCredentialLifecycle {
    private static let lock = NSLock()
    private static var latestTicketByScope: [String: UUID] = [:]

    static func begin(scope: String) -> UUID {
        lock.lock()
        defer { lock.unlock() }
        let ticket = UUID()
        latestTicketByScope[scope] = ticket
        return ticket
    }

    static func snapshot(store: TodoistCredentialStore) throws -> TodoistCredentialSnapshot {
        lock.lock()
        defer { lock.unlock() }
        return TodoistCredentialSnapshot(ticket: latestTicketByScope[store.lifecycleScope],
                                         credential: try store.read())
    }

    static func isCurrent(_ snapshot: TodoistCredentialSnapshot, store: TodoistCredentialStore) throws -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard latestTicketByScope[store.lifecycleScope] == snapshot.ticket else { return false }
        return try store.read() == snapshot.credential
    }

    static func commit(store: TodoistCredentialStore, ticket: UUID,
                       expected: TodoistCredential?, replacement: TodoistCredential?) throws -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard latestTicketByScope[store.lifecycleScope] == ticket,
              try store.read() == expected else { return false }
        if let replacement { try store.write(replacement) }
        else { try store.remove() }
        return true
    }
}

final class KeychainTodoistCredentialStore: TodoistCredentialStore {
    private let service: String
    private let account = "current"

    init(service: String = "com.jzlosman.banana-tasks.todoist") { self.service = service }

    var lifecycleScope: String { "keychain:\(service):\(account)" }

    func read() throws -> TodoistCredential? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service, kSecAttrAccount as String: account,
                                    kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data,
              let credential = try? JSONDecoder().decode(TodoistCredential.self, from: data),
              Self.valid(credential) else { throw TasksFailure.todoistDisconnected }
        return credential
    }

    func write(_ credential: TodoistCredential) throws {
        guard Self.valid(credential), let data = try? JSONEncoder().encode(credential) else { throw TasksFailure.todoistRejected }
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service, kSecAttrAccount as String: account]
        let update: [String: Any] = [kSecValueData as String: data,
                                     kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var add = query
            update.forEach { add[$0.key] = $0.value }
            guard SecItemAdd(add as CFDictionary, nil) == errSecSuccess else { throw TasksFailure.todoistRejected }
        } else if status != errSecSuccess { throw TasksFailure.todoistRejected }
    }

    func remove() throws {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service, kSecAttrAccount as String: account]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw TasksFailure.todoistRejected }
    }

    private static func valid(_ value: TodoistCredential) -> Bool {
        !value.token.isEmpty && value.token.utf8.count <= 4_096 && Self.validToken(value.token) &&
            !value.accountID.isEmpty && value.accountID.utf8.count <= 256 &&
            (value.projectID == nil || (value.projectID!.utf8.count <= 256 && !value.projectID!.isEmpty))
    }

    private static func validToken(_ value: String) -> Bool {
        value.utf8.allSatisfy { (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 45 || $0 == 46 || $0 == 95 }
    }
}

struct TasksHTTPResponse {
    let status: Int
    let data: Data
}
enum TasksHTTPFailure: Error, Equatable { case tooLarge, invalidResponse }
protocol TasksHTTPClient {
    func send(_ request: URLRequest, maximumResponseBytes: Int) async throws -> TasksHTTPResponse
}

/// Streams response chunks and cancels before buffering beyond each request's explicit bound.
private final class BoundedURLSessionClient: NSObject, TasksHTTPClient, URLSessionDataDelegate, @unchecked Sendable {
    private final class Pending {
        let maximum: Int
        let continuation: CheckedContinuation<TasksHTTPResponse, Error>
        var response: HTTPURLResponse?
        var data = Data()
        var overflow = false
        init(maximum: Int, continuation: CheckedContinuation<TasksHTTPResponse, Error>) {
            self.maximum = maximum
            self.continuation = continuation
        }
    }

    private let lock = NSLock()
    private var pending: [Int: Pending] = [:]
    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 60
        configuration.httpMaximumConnectionsPerHost = 2
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        return URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
    }()

    func send(_ request: URLRequest, maximumResponseBytes: Int) async throws -> TasksHTTPResponse {
        guard maximumResponseBytes > 0 else { throw TasksHTTPFailure.invalidResponse }
        return try await withCheckedThrowingContinuation { continuation in
            let task = session.dataTask(with: request)
            lock.lock()
            pending[task.taskIdentifier] = Pending(maximum: maximumResponseBytes, continuation: continuation)
            lock.unlock()
            task.resume()
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                    didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        lock.lock()
        guard let state = pending[dataTask.taskIdentifier], let http = response as? HTTPURLResponse else {
            lock.unlock(); completionHandler(.cancel); return
        }
        state.response = http
        let oversized = response.expectedContentLength > Int64(state.maximum)
        if oversized { state.overflow = true }
        lock.unlock()
        completionHandler(oversized ? .cancel : .allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        guard let state = pending[dataTask.taskIdentifier] else { lock.unlock(); return }
        if state.data.count + data.count > state.maximum {
            state.overflow = true
            lock.unlock()
            dataTask.cancel()
            return
        }
        state.data.append(data)
        lock.unlock()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        // Never forward the Bearer token to a redirect target.
        completionHandler(nil)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        let state = pending.removeValue(forKey: task.taskIdentifier)
        lock.unlock()
        guard let state else { return }
        if state.overflow { state.continuation.resume(throwing: TasksHTTPFailure.tooLarge) }
        else if let error { state.continuation.resume(throwing: error) }
        else if let response = state.response { state.continuation.resume(returning: TasksHTTPResponse(status: response.statusCode, data: state.data)) }
        else { state.continuation.resume(throwing: TasksHTTPFailure.invalidResponse) }
    }
}

final class TodoistAdapter: TodoistPort {
    private let credentials: TodoistCredentialStore
    private let http: TasksHTTPClient
    private let baseURL = URL(string: "https://api.todoist.com/api/v1")!
    private let maximumPageBytes = 2 * 1_024 * 1_024
    private let maximumPages = 100
    private let maximumRecords = 10_000

    init(credentials: TodoistCredentialStore = KeychainTodoistCredentialStore(), http: TasksHTTPClient = BoundedURLSessionClient()) {
        self.credentials = credentials
        self.http = http
    }

    func connection() async throws -> TodoistConnection {
        let snapshot = try TodoistCredentialLifecycle.snapshot(store: credentials)
        guard let credential = snapshot.credential else { return .disconnected }
        return .connected(accountID: credential.accountID, projectID: credential.projectID)
    }

    func connect(token: String) async throws -> (TodoistConnection, [CaptureProject]) {
        guard !token.isEmpty, token.utf8.count <= 4_096,
              token.utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 45 || $0 == 46 || $0 == 95 }) else {
            throw TasksFailure.todoistAuthentication
        }
        let ticket = TodoistCredentialLifecycle.begin(scope: credentials.lifecycleScope)
        let initial: TodoistCredentialSnapshot
        do { initial = try TodoistCredentialLifecycle.snapshot(store: credentials) }
        catch { throw map(error) }
        guard initial.ticket == ticket else { throw TasksFailure.todoistRejected }

        let accountID: String
        do {
            let user = try await object(path: "/user", token: token)
            guard let id = identifier(user["id"]) else { throw TasksFailure.todoistAuthentication }
            accountID = id
        } catch { throw map(error) }
        let projects: [CaptureProject]
        do { projects = try await fetchProjects(token: token) }
        catch { throw map(error) }
        let projectID = initial.credential?.accountID == accountID ? initial.credential?.projectID : nil
        let credential = TodoistCredential(token: token, accountID: accountID,
                                           projectID: projectID.flatMap { id in projects.contains(where: { $0.id == id }) ? id : nil })
        do {
            guard try TodoistCredentialLifecycle.commit(store: credentials, ticket: ticket,
                                                        expected: initial.credential, replacement: credential) else {
                throw TasksFailure.todoistRejected
            }
        } catch { throw TasksFailure.todoistRejected }
        return (.connected(accountID: accountID, projectID: credential.projectID), projects)
    }

    func disconnect() throws {
        let ticket = TodoistCredentialLifecycle.begin(scope: credentials.lifecycleScope)
        do {
            let initial = try TodoistCredentialLifecycle.snapshot(store: credentials)
            guard initial.ticket == ticket,
                  try TodoistCredentialLifecycle.commit(store: credentials, ticket: ticket,
                                                        expected: initial.credential, replacement: nil) else {
                throw TasksFailure.todoistRejected
            }
        } catch { throw TasksFailure.todoistRejected }
    }

    func projects() async throws -> [CaptureProject] {
        let snapshot = try credentialSnapshot()
        guard let credential = snapshot.credential else { throw TasksFailure.todoistDisconnected }
        do {
            let result = try await fetchProjects(token: credential.token)
            guard try TodoistCredentialLifecycle.isCurrent(snapshot, store: credentials) else {
                throw TasksFailure.todoistDisconnected
            }
            return result
        } catch { throw map(error) }
    }

    func selectProject(_ projectID: String) async throws -> TodoistConnection {
        let ticket = TodoistCredentialLifecycle.begin(scope: credentials.lifecycleScope)
        let initial: TodoistCredentialSnapshot
        do { initial = try TodoistCredentialLifecycle.snapshot(store: credentials) }
        catch { throw map(error) }
        guard initial.ticket == ticket else { throw TasksFailure.todoistRejected }
        guard let credential = initial.credential else { throw TasksFailure.todoistDisconnected }
        let available: [CaptureProject]
        do { available = try await fetchProjects(token: credential.token) }
        catch { throw map(error) }
        guard available.contains(where: { $0.id == projectID }) else { throw TasksFailure.invalidRequest }
        let updated = TodoistCredential(token: credential.token, accountID: credential.accountID, projectID: projectID)
        do {
            guard try TodoistCredentialLifecycle.commit(store: credentials, ticket: ticket,
                                                        expected: credential, replacement: updated) else {
                throw TasksFailure.todoistRejected
            }
        } catch { throw TasksFailure.todoistRejected }
        return .connected(accountID: updated.accountID, projectID: updated.projectID)
    }

    func captures() async throws -> [CapturedTask] {
        let snapshot = try credentialSnapshot()
        guard let credential = snapshot.credential else { throw TasksFailure.todoistDisconnected }
        guard let projectID = credential.projectID else { throw TasksFailure.todoistDisconnected }
        do {
            var cursor: String?
            var tasks: [CapturedTask] = []
            for _ in 0..<maximumPages {
                let page = try await taskPage(token: credential.token, projectID: projectID, cursor: cursor)
                guard tasks.count + page.items.count <= maximumRecords else { throw TasksHTTPFailure.tooLarge }
                for item in page.items { tasks.append(try normalize(item, accountID: credential.accountID, projectID: projectID)) }
                guard let next = page.nextCursor else {
                    guard try TodoistCredentialLifecycle.isCurrent(snapshot, store: credentials) else {
                        throw TasksFailure.todoistDisconnected
                    }
                    return tasks
                }
                guard next.utf8.count <= 2_048, next != cursor else { throw TasksHTTPFailure.invalidResponse }
                cursor = next
            }
            throw TasksHTTPFailure.tooLarge
        } catch { throw map(error) }
    }

    func setCompleted(source: TodoistReference, completed: Bool, operationID: String) async throws {
        let snapshot = try credentialSnapshot()
        guard let credential = snapshot.credential else { throw TasksFailure.todoistDisconnected }
        guard source.accountID == credential.accountID, source.projectID == credential.projectID,
              !source.taskID.isEmpty, source.taskID.utf8.count <= 256,
              UUID(uuidString: operationID) != nil else { throw TasksFailure.invalidRequest }
        do {
            guard try TodoistCredentialLifecycle.isCurrent(snapshot, store: credentials) else {
                throw TasksFailure.todoistDisconnected
            }
            let command: [String: Any] = [
                "type": completed ? "item_close" : "item_uncomplete",
                "uuid": operationID,
                "args": ["id": source.taskID]
            ]
            let commandsData = try JSONSerialization.data(withJSONObject: [command], options: [.sortedKeys])
            guard let commands = String(data: commandsData, encoding: .utf8) else { throw TasksHTTPFailure.invalidResponse }
            var form = URLComponents()
            form.queryItems = [URLQueryItem(name: "commands", value: commands)]
            guard let body = form.percentEncodedQuery?.data(using: .utf8) else { throw TasksHTTPFailure.invalidResponse }

            var request = URLRequest(url: baseURL.appendingPathComponent("sync"))
            request.httpMethod = "POST"
            request.httpBody = body
            request.setValue("Bearer \(credential.token)", forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            let response = try await http.send(request, maximumResponseBytes: 256 * 1_024)
            try checkStatus(response.status)
            guard let result = try JSONSerialization.jsonObject(with: response.data) as? [String: Any],
                  let syncStatus = result["sync_status"] as? [String: Any],
                  let commandStatus = syncStatus[operationID] as? String,
                  commandStatus == "ok" else { throw TasksHTTPFailure.invalidResponse }
            guard try TodoistCredentialLifecycle.isCurrent(snapshot, store: credentials) else {
                throw TasksFailure.todoistDisconnected
            }
        } catch { throw map(error) }
    }

    private func credentialSnapshot() throws -> TodoistCredentialSnapshot {
        do { return try TodoistCredentialLifecycle.snapshot(store: credentials) }
        catch { throw map(error) }
    }

    private func fetchProjects(token: String) async throws -> [CaptureProject] {
        var cursor: String?
        var result: [CaptureProject] = []
        var seen = Set<String>()
        for _ in 0..<maximumPages {
            let page = try await listPage(path: "/projects", token: token, cursor: cursor)
            for raw in page.items {
                guard let id = identifier(raw["id"]), seen.insert(id).inserted,
                      let name = raw["name"] as? String, name.utf8.count <= 4_096 else { throw TasksHTTPFailure.invalidResponse }
                result.append(CaptureProject(id: id, name: name))
            }
            guard result.count <= maximumRecords else { throw TasksHTTPFailure.tooLarge }
            guard let next = page.nextCursor else { return result }
            guard next.utf8.count <= 2_048, next != cursor else { throw TasksHTTPFailure.invalidResponse }
            cursor = next
        }
        throw TasksHTTPFailure.tooLarge
    }

    private func taskPage(token: String, projectID: String, cursor: String?) async throws -> Page {
        var components = URLComponents(url: baseURL.appendingPathComponent("tasks"), resolvingAgainstBaseURL: false)!
        var query = [URLQueryItem(name: "project_id", value: projectID)]
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        components.queryItems = query
        return try await page(url: components.url!, token: token)
    }

    private func listPage(path: String, token: String, cursor: String?) async throws -> Page {
        var components = URLComponents(url: baseURL.appendingPathComponent(String(path.dropFirst())), resolvingAgainstBaseURL: false)!
        if let cursor { components.queryItems = [URLQueryItem(name: "cursor", value: cursor)] }
        return try await page(url: components.url!, token: token)
    }

    private struct Page { let items: [[String: Any]]; let nextCursor: String? }
    private func page(url: URL, token: String) async throws -> Page {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let response = try await http.send(request, maximumResponseBytes: maximumPageBytes)
        try checkStatus(response.status)
        guard let object = try JSONSerialization.jsonObject(with: response.data) as? [String: Any],
              let rawItems = object["results"] as? [[String: Any]],
              let nextValue = object["next_cursor"], nextValue is NSNull || nextValue is String else {
            throw TasksHTTPFailure.invalidResponse
        }
        let cursor = nextValue as? String
        guard cursor?.isEmpty != true else { throw TasksHTTPFailure.invalidResponse }
        return Page(items: rawItems, nextCursor: cursor)
    }

    private func object(path: String, token: String) async throws -> [String: Any] {
        let url = baseURL.appendingPathComponent(String(path.dropFirst()))
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let response = try await http.send(request, maximumResponseBytes: 256 * 1_024)
        try checkStatus(response.status)
        guard let value = try JSONSerialization.jsonObject(with: response.data) as? [String: Any] else { throw TasksHTTPFailure.invalidResponse }
        return value
    }

    private func normalize(_ raw: [String: Any], accountID: String, projectID: String) throws -> CapturedTask {
        guard let taskID = identifier(raw["id"]), identifier(raw["project_id"]) == projectID,
              let title = raw["content"] as? String, title.utf8.count <= 4_096,
              let priorityNumber = raw["priority"] as? NSNumber,
              CFGetTypeID(priorityNumber) != CFBooleanGetTypeID(), (1...4).contains(priorityNumber.intValue),
              priorityNumber.doubleValue == Double(priorityNumber.intValue) else { throw TasksHTTPFailure.invalidResponse }
        let notes: String
        if let value = raw["description"] as? String { notes = value }
        else if raw["description"] == nil || raw["description"] is NSNull { notes = "" }
        else { throw TasksHTTPFailure.invalidResponse }
        guard notes.utf8.count <= 16_384 else { throw TasksHTTPFailure.invalidResponse }
        let rawLabels: [String]
        if let value = raw["labels"] as? [String] { rawLabels = value }
        else if raw["labels"] == nil || raw["labels"] is NSNull { rawLabels = [] }
        else { throw TasksHTTPFailure.invalidResponse }
        guard rawLabels.count <= 256, rawLabels.allSatisfy({ $0.utf8.count <= 256 }) else { throw TasksHTTPFailure.invalidResponse }
        let addedAt = raw["added_at"] ?? NSNull()
        guard addedAt is NSNull || addedAt is String else { throw TasksHTTPFailure.invalidResponse }
        let priority: CapturedTask.Priority = priorityNumber.intValue == 4 ? .high : (priorityNumber.intValue == 1 ? .low : .normal)
        let created: Double?
        if let value = addedAt as? String {
            guard let date = Self.parseDate(value), let milliseconds = Self.safeMilliseconds(date) else {
                throw TasksHTTPFailure.invalidResponse
            }
            created = milliseconds
        } else { created = nil }
        return CapturedTask(source: TodoistReference(accountID: accountID, projectID: projectID, taskID: taskID),
                            title: title, notes: notes, tags: rawLabels, priority: priority, createdAt: created)
    }

    private func checkStatus(_ status: Int) throws {
        switch status {
        case 200..<300: return
        case 401, 403: throw TasksFailure.todoistAuthentication
        case 429: throw TasksFailure.todoistRateLimited
        default: throw TasksFailure.todoistRejected
        }
    }

    private func map(_ error: Error) -> TasksFailure {
        if let failure = error as? TasksFailure { return failure }
        if error is TasksHTTPFailure { return .todoistRejected }
        if let urlError = error as? URLError, urlError.code == .userAuthenticationRequired { return .todoistAuthentication }
        if let urlError = error as? URLError {
            if urlError.code == .cancelled { return .todoistRejected }
            return .todoistOffline
        }
        return .todoistRejected
    }

    private func identifier(_ value: Any?) -> String? {
        if let string = value as? String, !string.isEmpty, string.utf8.count <= 256 { return string }
        if let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() { return number.stringValue }
        return nil
    }

    private static func parseDate(_ value: String) -> Date? {
        guard value.utf8.count <= 64 else { return nil }
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions.insert(.withFractionalSeconds)
        return formatter.date(from: value)
    }

    private static func safeMilliseconds(_ date: Date) -> Double? {
        let milliseconds = (date.timeIntervalSince1970 * 1_000).rounded(.toNearestOrAwayFromZero)
        guard milliseconds.isFinite, abs(milliseconds) <= 9_007_199_254_740_991 else { return nil }
        return milliseconds
    }
}

final class MemoryTodoistCredentialStore: TodoistCredentialStore {
    let lifecycleScope = "memory:\(UUID().uuidString)"
    private let lock = NSLock()
    private var storedValue: TodoistCredential?

    init(initial: TodoistCredential? = nil) { storedValue = initial }

    var value: TodoistCredential? {
        lock.lock()
        defer { lock.unlock() }
        return storedValue
    }

    func read() throws -> TodoistCredential? {
        lock.lock()
        defer { lock.unlock() }
        return storedValue
    }

    func write(_ credential: TodoistCredential) throws {
        lock.lock()
        defer { lock.unlock() }
        storedValue = credential
    }

    func remove() throws {
        lock.lock()
        defer { lock.unlock() }
        storedValue = nil
    }
}
