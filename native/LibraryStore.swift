import Foundation
import CoreFoundation
import Darwin

struct StoreError: Error, LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// Permission-controlled, crash-durable replacement for one file. All temporary
/// files live beside their destination so rename remains atomic on one volume.
enum DurableFileWriter {
    static func prepareDirectory(_ url: URL) throws {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let descriptor = open(url.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard descriptor >= 0 else { throw posixError("Could not open a real data directory") }
        defer { _ = close(descriptor) }
        var info = stat()
        guard fstat(descriptor, &info) == 0, (info.st_mode & S_IFMT) == S_IFDIR,
              fchmod(descriptor, mode_t(0o700)) == 0 else { throw posixError("Could not secure data directory") }
    }

    static func write(_ data: Data, replacing destination: URL) throws {
        let directory = destination.deletingLastPathComponent()
        let temporary = directory.appendingPathComponent(".\(destination.lastPathComponent).\(UUID().uuidString).tmp")
        var descriptor = open(temporary.path, O_WRONLY | O_CREAT | O_EXCL, mode_t(0o600))
        guard descriptor >= 0 else { throw posixError("Could not create temporary data file") }
        var keepTemporary = true
        defer {
            if descriptor >= 0 { _ = close(descriptor) }
            if keepTemporary { _ = unlink(temporary.path) }
        }
        guard fchmod(descriptor, mode_t(0o600)) == 0 else { throw posixError("Could not secure temporary data file") }
        try data.withUnsafeBytes { buffer in
            guard let base = buffer.baseAddress else { return }
            var offset = 0
            while offset < buffer.count {
                let count = Darwin.write(descriptor, base.advanced(by: offset), buffer.count - offset)
                if count < 0 {
                    if errno == EINTR { continue }
                    throw posixError("Could not write data file")
                }
                offset += count
            }
        }
        guard fcntl(descriptor, F_FULLFSYNC) == 0 else { throw posixError("Could not flush data file to storage") }
        guard close(descriptor) == 0 else { descriptor = -1; throw posixError("Could not close data file") }
        descriptor = -1
        guard rename(temporary.path, destination.path) == 0 else { throw posixError("Could not replace data file") }
        keepTemporary = false
        let directoryDescriptor = open(directory.path, O_RDONLY)
        guard directoryDescriptor >= 0 else { throw posixError("Could not open data directory") }
        defer { _ = close(directoryDescriptor) }
        guard fsync(directoryDescriptor) == 0 else { throw posixError("Could not flush data directory") }
    }

    static func replaceByRename(_ source: URL, with destination: URL) throws {
        guard rename(source.path, destination.path) == 0 else { throw posixError("Could not move data file") }
        let descriptor = open(destination.deletingLastPathComponent().path, O_RDONLY)
        guard descriptor >= 0 else { throw posixError("Could not open data directory") }
        defer { _ = close(descriptor) }
        guard fsync(descriptor) == 0 else { throw posixError("Could not flush data directory") }
    }

    private static func posixError(_ prefix: String) -> StoreError {
        StoreError(message: "\(prefix): \(String(cString: strerror(errno)))")
    }
}

struct LibraryRecoveryStatus {
    let startupError: String?
    let backupAvailable: Bool
    let backupUpdatedAt: String?
    let backupNoteCount: Int?
}

/// Owns library persistence and validation. The synchronous API is for tests and
/// non-UI callers; bridge saves are enqueued onto one serial executor by saveAsync.
final class LibraryStore: LibraryRepository, @unchecked Sendable {
    let directory: URL
    private let fileManager = FileManager.default
    private let writer = DispatchQueue(label: "dev.local.banananotes.library-writer", qos: .userInitiated)
    private var lockDescriptor: Int32 = -1
    private(set) var startupError: String?

    init(directory: URL? = nil) {
        if let directory {
            self.directory = directory.standardizedFileURL
        } else if Bundle.main.bundleIdentifier?.hasPrefix("dev.local.foldnote.verification.") == true {
            do {
                self.directory = try Self.verificationDirectory(bundleURL: Bundle.main.bundleURL,
                    binding: Bundle.main.object(forInfoDictionaryKey: "BananaNotesVerificationDataDirectory"))
            } catch {
                self.directory = fileManager.temporaryDirectory.appendingPathComponent("BananaNotes-unconfigured-verification", isDirectory: true)
                self.startupError = error.localizedDescription
                return
            }
        } else if let override = Self.dataDirectoryOverride(environment: ProcessInfo.processInfo.environment) {
            self.directory = URL(fileURLWithPath: override, isDirectory: true).standardizedFileURL
        } else {
            let support = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            // Stable storage location across the Banana Notes rename; never silently start a new library.
            self.directory = support.appendingPathComponent("Foldnote", isDirectory: true)
        }
        self.startupError = nil
        do {
            try DurableFileWriter.prepareDirectory(self.directory)
            try acquireWriterLock()
            if fileManager.fileExists(atPath: libraryURL.path) {
                do { _ = try readValidatedLibrary() }
                catch { self.startupError = Self.recoveryMessage(error, path: libraryURL.path) }
            }
        } catch {
            self.startupError = "Banana Notes could not prepare its data folder: \(error.localizedDescription)"
        }
    }

    deinit {
        if lockDescriptor >= 0 { _ = flock(lockDescriptor, LOCK_UN); _ = close(lockDescriptor) }
    }

    private func acquireWriterLock() throws {
        let lockURL = directory.appendingPathComponent("library.lock")
        let descriptor = open(lockURL.path, O_RDWR | O_CREAT | O_NOFOLLOW, mode_t(0o600))
        guard descriptor >= 0 else { throw StoreError(message: "Could not open the library lock: \(String(cString: strerror(errno)))") }
        guard fchmod(descriptor, mode_t(0o600)) == 0 else {
            let message = String(cString: strerror(errno)); _ = close(descriptor)
            throw StoreError(message: "Could not secure the library lock: \(message)")
        }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
            let message = String(cString: strerror(errno)); _ = close(descriptor)
            throw StoreError(message: "Another Banana Notes instance is using this library. Activate the existing instance before trying again. (\(message))")
        }
        lockDescriptor = descriptor
    }

    /// Verification bundles must stay bound to their sibling synthetic data, including LaunchServices reopens.
    static func verificationDirectory(bundleURL: URL, binding: Any?) throws -> URL {
        guard let path = binding as? String, path.hasPrefix("/"),
              URL(fileURLWithPath: path, isDirectory: true).resolvingSymlinksInPath().standardizedFileURL ==
                bundleURL.deletingLastPathComponent().appendingPathComponent("data", isDirectory: true).resolvingSymlinksInPath().standardizedFileURL else {
            throw StoreError(message: "This verification app has no valid isolated data binding. Recreate its verification profile; personal notes were not opened.")
        }
        return URL(fileURLWithPath: path, isDirectory: true)
    }

    static func dataDirectoryOverride(environment: [String: String]) -> String? {
        for key in ["BANANA_NOTES_DATA_DIR", "FOLDNOTE_DATA_DIR"] {
            if let path = environment[key], !path.isEmpty { return path }
        }
        return nil
    }

    var libraryURL: URL { directory.appendingPathComponent("library.json") }
    var backupURL: URL { directory.appendingPathComponent("library.json.bak") }
    var lockURL: URL { directory.appendingPathComponent("library.lock") }

    func load() throws -> [String: Any]? {
        if let startupError { throw StoreError(message: startupError) }
        guard fileManager.fileExists(atPath: libraryURL.path) else { return nil }
        return try readValidatedLibrary()
    }

    func saveAsync(_ library: Any, completion: @escaping (Result<Void, Error>) -> Void) {
        writer.async { [self] in
            do { try saveOnWriter(library); completion(.success(())) }
            catch { completion(.failure(error)) }
        }
    }

    /// Enqueue a completion after every save submitted before this call.
    func afterPendingWrites(_ completion: @escaping () -> Void) {
        writer.async(execute: completion)
    }

    func save(_ library: Any) throws {
        try writer.sync { try saveOnWriter(library) }
    }

    private func saveOnWriter(_ library: Any) throws {
        if let startupError { throw StoreError(message: startupError) }
        guard lockDescriptor >= 0 else { throw StoreError(message: "This instance does not own the library writer lock and cannot save.") }
        guard let object = library as? [String: Any] else { throw StoreError(message: "Library must be a JSON object.") }
        try Self.validate(object)
        let data: Data
        do { data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) }
        catch { throw StoreError(message: "Library could not be encoded: \(error.localizedDescription)") }
        guard data.count <= Self.maximumBytes else { throw StoreError(message: "Library is too large (maximum 10 MB).") }

        // Rotate only a verified last-good primary. A corrupt primary can never
        // overwrite a useful backup.
        if fileManager.fileExists(atPath: libraryURL.path) {
            let previous = try readValidatedData(from: libraryURL)
            _ = try Self.decodeAndValidate(previous)
            try DurableFileWriter.write(previous, replacing: backupURL)
        }
        try DurableFileWriter.write(data, replacing: libraryURL)
    }

    func recoveryStatus() -> LibraryRecoveryStatus {
        guard fileManager.fileExists(atPath: backupURL.path),
              let data = try? readValidatedData(from: backupURL),
              let library = try? Self.decodeAndValidate(data) else {
            return LibraryRecoveryStatus(startupError: startupError, backupAvailable: false, backupUpdatedAt: nil, backupNoteCount: nil)
        }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let modified = (try? fileManager.attributesOfItem(atPath: backupURL.path)[.modificationDate] as? Date)
        let updatedAt = modified.map { formatter.string(from: $0) }
        return LibraryRecoveryStatus(startupError: startupError, backupAvailable: true, backupUpdatedAt: updatedAt,
                                    backupNoteCount: (library["notes"] as? [[String: Any]])?.count)
    }

    func restoreBackup(now: Date = Date()) throws {
        guard lockDescriptor >= 0 else { throw StoreError(message: "This instance does not own the library writer lock and cannot restore data.") }
        let backup = try readValidatedData(from: backupURL)
        _ = try Self.decodeAndValidate(backup)
        if fileManager.fileExists(atPath: libraryURL.path) {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            var quarantineDate = now
            var corrupt = directory.appendingPathComponent("library.corrupt-\(formatter.string(from: quarantineDate)).json")
            while fileManager.fileExists(atPath: corrupt.path) {
                quarantineDate = quarantineDate.addingTimeInterval(0.001)
                corrupt = directory.appendingPathComponent("library.corrupt-\(formatter.string(from: quarantineDate)).json")
            }
            try DurableFileWriter.replaceByRename(libraryURL, with: corrupt)
        }
        try DurableFileWriter.write(backup, replacing: libraryURL)
        startupError = nil
        _ = try readValidatedLibrary()
    }

    static let maximumBytes = 10_000_000
    static let maximumNoteBytes = 2_000_000
    static let maximumNotes = 20_000
    private static let tagPattern = try! NSRegularExpression(pattern: "^[\\p{L}][\\p{L}\\p{N}_/-]{0,79}$")
    private static let fractionalISO8601: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private static let plainISO8601: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()
    private static let iso8601Lock = NSLock()

    static func validate(_ library: [String: Any]) throws {
        guard let version = library["version"] as? NSNumber,
              CFGetTypeID(version) != CFBooleanGetTypeID(), version.doubleValue == 1 else {
            throw StoreError(message: "Unsupported library version. Expected version 1; no data was saved.")
        }
        guard let notes = library["notes"] as? [[String: Any]] else {
            throw StoreError(message: "Library notes must be an array.")
        }
        guard notes.count <= maximumNotes else { throw StoreError(message: "Library has too many notes (maximum 20,000).") }
        var identifiers = Set<String>()
        for (index, note) in notes.enumerated() {
            guard let id = note["id"] as? String, !id.isEmpty, id.count <= 512,
                  identifiers.insert(id).inserted,
                  let markdown = note["markdown"] as? String,
                  let createdAt = note["createdAt"] as? String, createdAt.count <= 128, isISO8601(createdAt),
                  let updatedAt = note["updatedAt"] as? String, updatedAt.count <= 128, isISO8601(updatedAt) else {
                throw StoreError(message: "Note at index \(index) has an invalid/duplicate id, Markdown value, or ISO-8601 timestamp.")
            }
            guard markdown.utf8.count <= maximumNoteBytes else {
                throw StoreError(message: "Note \(id) exceeds the 2 MB limit. Shorten the note before saving.")
            }
            if let trashedAt = note["trashedAt"] {
                guard let timestamp = trashedAt as? String, timestamp.count <= 128, isISO8601(timestamp) else {
                    throw StoreError(message: "Note at index \(index) has an invalid trash timestamp.")
                }
            }
        }
        guard let selectedValue = library["selectedID"] else {
            throw StoreError(message: "Library selectedID must be a string or null.")
        }
        if !(selectedValue is NSNull), !(selectedValue is String) {
            throw StoreError(message: "Library selectedID must be a string or null.")
        }
        guard let tagValue = library["activeTag"] else {
            throw StoreError(message: "Library activeTag must be a valid tag or null.")
        }
        if !(tagValue is NSNull) {
            guard let tag = tagValue as? String, isValidTag(tag) else {
                throw StoreError(message: "Library activeTag must be a valid tag or null.")
            }
        }
        if let values = library["activeTags"] {
            guard let tags = values as? [String], tags.allSatisfy(Self.isValidTag), Set(tags).count == tags.count else {
                throw StoreError(message: "Library activeTags must be a list of unique valid tags.")
            }
        }
    }

    private static func isISO8601(_ value: String) -> Bool {
        iso8601Lock.lock()
        defer { iso8601Lock.unlock() }
        return fractionalISO8601.date(from: value) != nil || plainISO8601.date(from: value) != nil
    }

    private static func isValidTag(_ value: String) -> Bool {
        let range = NSRange(value.startIndex..., in: value)
        return value.count <= 80 && tagPattern.firstMatch(in: value, range: range) != nil
    }

    private static func decodeAndValidate(_ data: Data) throws -> [String: Any] {
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw StoreError(message: "Library file is not a JSON object.")
        }
        try validate(object)
        return object
    }

    private func readValidatedLibrary() throws -> [String: Any] {
        try Self.decodeAndValidate(readValidatedData(from: libraryURL))
    }

    private func readValidatedData(from url: URL) throws -> Data {
        let data = try Data(contentsOf: url, options: [.mappedIfSafe])
        guard data.count <= Self.maximumBytes else { throw StoreError(message: "Library file exceeds the 10 MB safety limit.") }
        return data
    }

    private static func recoveryMessage(_ error: Error, path: String) -> String {
        "Banana Notes could not read its library: \(error.localizedDescription). Your file was left untouched at \(path). To recover, restore library.json.bak if it contains your latest data, or move/repair library.json, then relaunch Banana Notes before saving."
    }
}
