import Foundation
import CoreFoundation

struct StoreError: Error, LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// Owns the native persistence boundary. The web application owns library semantics;
/// this adapter only validates the versioned envelope and protects bytes on disk.
struct LibraryStore {
    let directory: URL
    private let fileManager = FileManager.default
    private(set) var startupError: String?

    init(directory: URL? = nil) {
        if let directory {
            self.directory = directory
        } else if let override = ProcessInfo.processInfo.environment["FOLDNOTE_DATA_DIR"], !override.isEmpty {
            self.directory = URL(fileURLWithPath: override, isDirectory: true)
        } else {
            let support = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            self.directory = support.appendingPathComponent("Foldnote", isDirectory: true)
        }
        self.startupError = nil
        do {
            try fileManager.createDirectory(at: self.directory, withIntermediateDirectories: true)
            if fileManager.fileExists(atPath: libraryURL.path) {
                do { _ = try readValidatedLibrary() }
                catch { self.startupError = "Foldnote could not read its library: \(error.localizedDescription). Your file was left untouched at \(libraryURL.path). To recover, restore library.json.bak if it contains your latest data, or move/repair library.json, then relaunch Foldnote before saving." }
            }
        } catch {
            self.startupError = "Foldnote could not prepare its data folder: \(error.localizedDescription)"
        }
    }

    var libraryURL: URL { directory.appendingPathComponent("library.json") }
    var backupURL: URL { directory.appendingPathComponent("library.json.bak") }

    func load() throws -> [String: Any]? {
        if let startupError { throw StoreError(message: startupError) }
        guard fileManager.fileExists(atPath: libraryURL.path) else { return nil }
        return try readValidatedLibrary()
    }

    mutating func save(_ library: Any) throws {
        if let startupError { throw StoreError(message: startupError) }
        guard let object = library as? [String: Any] else { throw StoreError(message: "Library must be a JSON object.") }
        try Self.validate(object)
        let data: Data
        do { data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) }
        catch { throw StoreError(message: "Library could not be encoded: \(error.localizedDescription)") }
        guard data.count <= Self.maximumBytes else { throw StoreError(message: "Library is too large (maximum 10 MB).") }

        // Preserve only a verified last-good copy. Never copy malformed current bytes
        // over a potentially useful backup.
        if fileManager.fileExists(atPath: libraryURL.path) {
            let previous = try readValidatedData()
            _ = try readValidatedLibrary()
            try previous.write(to: backupURL, options: .atomic)
        }
        try data.write(to: libraryURL, options: .atomic)
    }

    static let maximumBytes = 10_000_000
    static let maximumNoteBytes = 1_000_000
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
                  let markdown = note["markdown"] as? String, markdown.utf8.count <= maximumNoteBytes,
                  let createdAt = note["createdAt"] as? String, createdAt.count <= 128, isISO8601(createdAt),
                  let updatedAt = note["updatedAt"] as? String, updatedAt.count <= 128, isISO8601(updatedAt) else {
                throw StoreError(message: "Note at index \(index) has an invalid/duplicate id, markdown, or ISO-8601 timestamp.")
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
        fractionalISO8601.date(from: value) != nil || plainISO8601.date(from: value) != nil
    }

    private static func isValidTag(_ value: String) -> Bool {
        let range = NSRange(value.startIndex..., in: value)
        return value.count <= 80 && tagPattern.firstMatch(in: value, range: range) != nil
    }

    private func readValidatedLibrary() throws -> [String: Any] {
        guard let object = try JSONSerialization.jsonObject(with: readValidatedData()) as? [String: Any] else {
            throw StoreError(message: "Library file is not a JSON object.")
        }
        try Self.validate(object)
        return object
    }

    private func readValidatedData() throws -> Data {
        let data = try Data(contentsOf: libraryURL)
        guard data.count <= Self.maximumBytes else { throw StoreError(message: "Library file exceeds the 10 MB safety limit.") }
        return data
    }
}
