import Foundation

/// Application effects are expressed through these ports; filesystem and
/// UserDefaults implementations remain adapters at the native boundary.
protocol LibraryRepository: AnyObject {
    var directory: URL { get }
    var libraryURL: URL { get }
    var startupError: String? { get }
    func load() throws -> LibraryDocument?
    func saveAsync(_ library: LibraryDocument, completion: @escaping (Result<Void, Error>) -> Void)
    func afterPendingWrites(_ completion: @escaping () -> Void)
    func recoveryStatus() -> LibraryRecoveryStatus
    func restoreBackup(now: Date) throws
}

extension LibraryRepository {
    func restoreBackup() throws { try restoreBackup(now: Date()) }
}

protocol AttachmentRepository {
    var attachmentsDirectory: URL { get }
    func importBase64(name: String, mimeType: String, base64: String) throws -> AttachmentRecord
    func importURL(_ url: URL) throws -> AttachmentRecord
    func importURLs(_ urls: [URL]) throws -> [AttachmentRecord]
    func resolveAssetURL(_ url: URL) throws -> (URL, String)
    func collectGarbage(referencedMarkdown: [String], now: Date, grace: TimeInterval) throws -> Int
}

public protocol PreferencesStore: AnyObject {
    func object(forKey defaultName: String) -> Any?
    func string(forKey defaultName: String) -> String?
    func bool(forKey defaultName: String) -> Bool
    func data(forKey defaultName: String) -> Data?
    func dictionary(forKey defaultName: String) -> [String: Any]?
    func set(_ value: Any?, forKey defaultName: String)
}

extension UserDefaults: PreferencesStore {}

protocol Clock: Sendable { var now: Date { get } }
struct SystemClock: Clock { var now: Date { Date() } }
