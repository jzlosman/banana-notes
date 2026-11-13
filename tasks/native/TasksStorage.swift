import CryptoKit
import Darwin
import Foundation

enum TasksLaunchProfile {
    case production(dataDirectory: URL)
    case verification(dataDirectory: URL, preferencesSuiteName: String)

    var dataDirectory: URL {
        switch self {
        case let .production(directory), let .verification(directory, _): return directory
        }
    }
}

struct TasksProfileResolver {
    static let verificationProfileInfoKey = "BananaTasksVerificationProfilePath"
    static let dataDirectoryEnvironmentKey = "BANANA_TASKS_DATA_DIR"
    static let bundleIdentifierKey = "CFBundleIdentifier"
    static let productionBundleIdentifier = "com.jzlosman.banana-tasks"
    static let verificationBundleIdentifierPrefix = "com.jzlosman.banana-tasks.verification."

    static func resolve(bundleInfo: [String: Any], environment: [String: String],
                        applicationSupport: URL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!) throws -> TasksLaunchProfile {
        guard let bundleIdentifier = bundleInfo[bundleIdentifierKey] as? String else { throw TasksFailure.invalidProfile }
        let hasProfileMetadata = bundleInfo.keys.contains(verificationProfileInfoKey)
        let directory: URL
        let resolvedProfile: TasksLaunchProfile

        if bundleIdentifier == productionBundleIdentifier {
            guard !hasProfileMetadata, environment[dataDirectoryEnvironmentKey] == nil else {
                throw TasksFailure.invalidProfile
            }
            directory = applicationSupport.appendingPathComponent("Banana Tasks", isDirectory: true)
            resolvedProfile = .production(dataDirectory: directory)
        } else if bundleIdentifier.hasPrefix(verificationBundleIdentifierPrefix) {
            let nonce = String(bundleIdentifier.dropFirst(verificationBundleIdentifierPrefix.count))
            guard !nonce.isEmpty, hasProfileMetadata,
                  let rawProfile = bundleInfo[verificationProfileInfoKey] as? String,
                  !rawProfile.isEmpty, rawProfile.hasPrefix("/"), !rawProfile.contains("\0") else {
                throw TasksFailure.invalidProfile
            }
            let profile = URL(fileURLWithPath: rawProfile, isDirectory: true).standardizedFileURL
            directory = profile.appendingPathComponent("data", isDirectory: true)
            if let requested = environment[dataDirectoryEnvironmentKey] {
                guard URL(fileURLWithPath: requested, isDirectory: true).standardizedFileURL == directory else {
                    throw TasksFailure.invalidProfile
                }
            }
            resolvedProfile = .verification(dataDirectory: directory,
                                            preferencesSuiteName: "com.jzlosman.banana-tasks.verification.\(profile.lastPathComponent)")
        } else {
            throw TasksFailure.invalidProfile
        }

        try TasksLocalDocumentStore.ensureDirectory(directory)
        let resolvedDirectory = directory.resolvingSymlinksInPath().standardizedFileURL
        switch resolvedProfile {
        case .production:
            return .production(dataDirectory: resolvedDirectory)
        case let .verification(_, preferencesSuiteName):
            return .verification(dataDirectory: resolvedDirectory, preferencesSuiteName: preferencesSuiteName)
        }
    }
}

final class TasksLocalDocumentStore: TasksDocumentStorePort {
    static let maximumBytes = TasksBridgeDecoder.maxDocumentBytes
    static let emptyRevision = revision(for: Data())

    let directory: URL
    private let localLock = NSLock()
    private var fileURL: URL { directory.appendingPathComponent("tasks.json", isDirectory: false) }
    private var backupURL: URL { directory.appendingPathComponent("tasks.json.bak", isDirectory: false) }
    private var lockURL: URL { directory.appendingPathComponent("tasks.lock", isDirectory: false) }

    init(directory: URL) throws {
        try Self.ensureDirectory(directory)
        self.directory = directory.resolvingSymlinksInPath().standardizedFileURL
    }

    func load() throws -> (document: Any?, revision: String) {
        try withExclusiveFileLock {
            guard let data = try readPrimaryIfPresent() else { return (nil, Self.emptyRevision) }
            guard Self.validDocumentData(data),
                  let document = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else {
                throw TasksFailure.unreadableStore
            }
            return (document, Self.revision(for: data))
        }
    }

    /// A nil result denotes a compare-and-swap conflict. Operational errors throw safe native failures.
    func save(expectedRevision: String, document: Any) throws -> String? {
        guard TasksBridgeDecoder.validDocument(document),
              let data = try? JSONSerialization.data(withJSONObject: document, options: [.fragmentsAllowed]),
              data.count <= Self.maximumBytes else { throw TasksFailure.invalidRequest }
        return try withExclusiveFileLock {
            let existing = try readPrimaryIfPresent()
            if let existing, !Self.validDocumentData(existing) { throw TasksFailure.unreadableStore }
            let currentRevision = existing.map(Self.revision(for:)) ?? Self.emptyRevision
            guard currentRevision == expectedRevision else { return nil }
            if let existing { try atomicWrite(existing, to: backupURL) }
            do { try atomicWrite(data, to: fileURL) }
            catch { throw TasksFailure.storeWriteFailed }
            return Self.revision(for: data)
        }
    }

    private func withExclusiveFileLock<T>(_ operation: () throws -> T) throws -> T {
        localLock.lock()
        defer { localLock.unlock() }
        let descriptor = open(lockURL.path, O_CREAT | O_RDWR | O_NOFOLLOW, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw TasksFailure.storeWriteFailed }
        defer { close(descriptor) }
        guard flock(descriptor, LOCK_EX) == 0 else { throw TasksFailure.storeWriteFailed }
        defer { _ = flock(descriptor, LOCK_UN) }
        return try operation()
    }

    private func readPrimaryIfPresent() throws -> Data? {
        var info = stat()
        if lstat(fileURL.path, &info) != 0 {
            if errno == ENOENT { return nil }
            throw TasksFailure.unreadableStore
        }
        guard (info.st_mode & S_IFMT) == S_IFREG, info.st_size >= 0, info.st_size <= Self.maximumBytes else {
            throw TasksFailure.unreadableStore
        }
        let descriptor = open(fileURL.path, O_RDONLY | O_NOFOLLOW)
        guard descriptor >= 0 else { throw TasksFailure.unreadableStore }
        defer { close(descriptor) }
        var opened = stat()
        guard fstat(descriptor, &opened) == 0, (opened.st_mode & S_IFMT) == S_IFREG,
              opened.st_size >= 0, opened.st_size <= Self.maximumBytes else { throw TasksFailure.unreadableStore }
        var output = Data()
        var buffer = [UInt8](repeating: 0, count: 64 * 1_024)
        while true {
            let count = read(descriptor, &buffer, buffer.count)
            if count == 0 { break }
            if count < 0 {
                if errno == EINTR { continue }
                throw TasksFailure.unreadableStore
            }
            guard output.count + count <= Self.maximumBytes else { throw TasksFailure.unreadableStore }
            output.append(contentsOf: buffer[0..<count])
        }
        return output
    }

    private func atomicWrite(_ data: Data, to target: URL) throws {
        guard data.count <= Self.maximumBytes else { throw TasksFailure.storeWriteFailed }
        var targetInfo = stat()
        if lstat(target.path, &targetInfo) == 0 {
            guard (targetInfo.st_mode & S_IFMT) == S_IFREG else { throw TasksFailure.storeWriteFailed }
        } else if errno != ENOENT { throw TasksFailure.storeWriteFailed }

        let temporary = directory.appendingPathComponent(".tasks-\(UUID().uuidString).tmp")
        let descriptor = open(temporary.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw TasksFailure.storeWriteFailed }
        var succeeded = false
        defer {
            close(descriptor)
            if !succeeded { unlink(temporary.path) }
        }
        try data.withUnsafeBytes { rawBuffer in
            guard let baseAddress = rawBuffer.baseAddress else { return }
            var written = 0
            while written < rawBuffer.count {
                let count = write(descriptor, baseAddress.advanced(by: written), rawBuffer.count - written)
                if count < 0 {
                    if errno == EINTR { continue }
                    throw TasksFailure.storeWriteFailed
                }
                guard count > 0 else { throw TasksFailure.storeWriteFailed }
                written += count
            }
        }
        guard fsync(descriptor) == 0 else { throw TasksFailure.storeWriteFailed }
        guard rename(temporary.path, target.path) == 0 else { throw TasksFailure.storeWriteFailed }
        let directoryDescriptor = open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard directoryDescriptor >= 0 else { throw TasksFailure.storeWriteFailed }
        defer { close(directoryDescriptor) }
        guard fsync(directoryDescriptor) == 0 else { throw TasksFailure.storeWriteFailed }
        succeeded = true
    }

    static func ensureDirectory(_ url: URL) throws {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        var info = stat()
        guard lstat(url.path, &info) == 0, (info.st_mode & S_IFMT) == S_IFDIR,
              info.st_uid == geteuid(), chmod(url.path, S_IRWXU) == 0 else { throw TasksFailure.invalidProfile }
    }

    private static func validDocumentData(_ data: Data) -> Bool {
        guard data.count <= maximumBytes,
              let value = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else { return false }
        return TasksBridgeDecoder.validDocument(value)
    }

    static func revision(for data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}

final class UserDefaultsTasksPreferences: TasksPreferencesPort {
    private let defaults: UserDefaults
    private let catalog: TasksThemeCatalog
    private let key = "bananaTasks.preferences.v1"

    init(defaults: UserDefaults = .standard, catalog: TasksThemeCatalog) {
        self.defaults = defaults
        self.catalog = catalog
    }

    func load() -> TasksPreferences {
        guard let data = defaults.data(forKey: key),
              let value = try? JSONDecoder().decode(TasksPreferences.self, from: data),
              (try? value.validated(themeIDs: catalog.identifiers)) != nil else { return .defaults }
        return value
    }

    func save(_ preferences: TasksPreferences) throws -> TasksPreferences {
        let validated = try preferences.validated(themeIDs: catalog.identifiers)
        defaults.set(try JSONEncoder().encode(validated), forKey: key)
        return validated
    }
}
