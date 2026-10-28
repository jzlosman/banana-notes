import Foundation
@testable import BananaNotesCore

@main
struct LibraryStoreSelfTest {
    static func main() throws {
        precondition(LibraryStore.dataDirectoryOverride(environment: [:]) == nil)
        precondition(LibraryStore.dataDirectoryOverride(environment: ["FOLDNOTE_DATA_DIR": "/legacy"]) == "/legacy")
        precondition(LibraryStore.dataDirectoryOverride(environment: ["BANANA_NOTES_DATA_DIR": "/banana", "FOLDNOTE_DATA_DIR": "/legacy"]) == "/banana")
        precondition(LibraryStore.dataDirectoryOverride(environment: ["BANANA_NOTES_DATA_DIR": "", "FOLDNOTE_DATA_DIR": "/legacy"]) == "/legacy")
        let isolatedBundle = URL(fileURLWithPath: "/tmp/isolated-profile/Banana Notes Verification.app", isDirectory: true)
        let isolatedDirectory = try LibraryStore.verificationDirectory(bundleURL: isolatedBundle, binding: "/tmp/isolated-profile/data")
        precondition(isolatedDirectory.path == "/tmp/isolated-profile/data")
        for binding: Any? in [nil, 42, "", "relative/data", NSHomeDirectory() + "/Library/Application Support/Foldnote", "/tmp/another-profile/data"] {
            do {
                _ = try LibraryStore.verificationDirectory(bundleURL: isolatedBundle, binding: binding)
                preconditionFailure("verification apps must fail closed without the matching isolated data directory")
            } catch is StoreError {}
        }

        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("BananaNotesStoreTest-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = LibraryStore(directory: directory)
        let emptyLoad = try store.load()
        precondition(emptyLoad == nil, "new store should load empty")
        let first = library(markdown: "first")
        try store.save(first)
        let firstLoad = try store.load()
        precondition(firstLoad?.notes.first?.markdown == "first", "saved library should load as a typed document")
        try store.save(library(markdown: "second"))

        let contender = LibraryStore(directory: directory)
        precondition(contender.startupError?.contains("Another Banana Notes instance") == true, "a second store cannot acquire the single-writer lock")
        do { try contender.save(library(markdown: "must not write")); preconditionFailure("lock loser must not save") }
        catch is StoreError {}
        let lockWinnerLibrary = try store.load()
        precondition(lockWinnerLibrary?.notes.first?.markdown == "second", "lock loser leaves the primary untouched")

        let directoryMode = (try FileManager.default.attributesOfItem(atPath: directory.path)[.posixPermissions] as? NSNumber)?.intValue
        let primaryMode = (try FileManager.default.attributesOfItem(atPath: store.libraryURL.path)[.posixPermissions] as? NSNumber)?.intValue
        let lockMode = (try FileManager.default.attributesOfItem(atPath: store.lockURL.path)[.posixPermissions] as? NSNumber)?.intValue
        precondition(directoryMode.map { $0 & 0o777 } == 0o700 && primaryMode.map { $0 & 0o777 } == 0o600 && lockMode.map { $0 & 0o777 } == 0o600,
                     "the data folder and files have explicit private permissions")

        assertRejected(["version": true, "notes": [], "selectedID": NSNull(), "activeTag": NSNull()], label: "boolean version")
        assertRejected(["version": 1.5, "notes": [], "selectedID": NSNull(), "activeTag": NSNull()], label: "fractional version")
        assertRejected(["version": 1, "notes": [], "selectedID": NSNull(), "activeTag": NSNull(), "unknownState": "do not discard"], label: "unknown root field")
        assertRejected(["version": 1, "notes": [], "selectedID": NSNull(), "activeTag": NSNull(), "pinnedTags": ["launch"], "bookmarks": [:]], label: "scope preferences in the v0.2.5 library envelope")
        var unknownNote = note(id: "future", markdown: "")
        unknownNote["futureState"] = "do not discard"
        assertRejected(["version": 1, "notes": [unknownNote], "selectedID": NSNull(), "activeTag": NSNull()], label: "unknown note field")
        assertRejected(["version": 1, "notes": [note(id: "date", markdown: "", createdAt: "yesterday")], "selectedID": NSNull(), "activeTag": NSNull()], label: "invalid timestamp")
        let trashDocument = try LibraryDocument(version: 1,
            notes: [LibraryNote(id: "trash", markdown: "keep this **Markdown**", createdAt: "2026-01-01T00:00:00Z",
                                updatedAt: "2026-01-01T00:00:00Z", trashedAt: "2026-10-20T12:00:00.000Z")],
            selectedID: "trash", activeTag: nil)
        let trashStore = LibraryStore(directory: directory.appendingPathComponent("trash"))
        try trashStore.save(trashDocument)
        let trashReload = try trashStore.load()!
        precondition(trashReload.notes[0].trashedAt == "2026-10-20T12:00:00.000Z")
        precondition(trashReload.notes[0].markdown == "keep this **Markdown**")
        for invalid: Any in [NSNull(), true, "yesterday"] {
            assertRejected(["version": 1, "notes": [note(id: "trash", markdown: "", trashedAt: invalid)],
                            "selectedID": NSNull(), "activeTag": NSNull()], label: "invalid trash timestamp")
        }
        assertRejected(["version": 1, "notes": [note(id: "same", markdown: "one"), note(id: "same", markdown: "two")],
                        "selectedID": NSNull(), "activeTag": NSNull()], label: "duplicate note id")
        assertRejected(["version": 1, "notes": [note(id: "note", markdown: "")], "activeTag": NSNull()], label: "missing selectedID")
        assertRejected(["version": 1, "notes": [note(id: "note", markdown: "")], "selectedID": 1, "activeTag": NSNull()], label: "non-string selectedID")
        assertRejected(["version": 1, "notes": [note(id: "note", markdown: "")], "selectedID": NSNull(), "activeTag": "1not-a-tag"], label: "invalid activeTag")
        assertRejected(["version": 1, "notes": [note(id: "note", markdown: "")], "selectedID": NSNull(), "activeTag": NSNull(), "activeTags": NSNull()], label: "null activeTags")
        assertRejected(["version": 1, "notes": [note(id: "large", markdown: String(repeating: "x", count: LibraryStore.maximumNoteBytes + 1))],
                        "selectedID": NSNull(), "activeTag": NSNull()], label: "oversized note")
        assertRejected(["version": 1, "notes": (0...LibraryStore.maximumNotes).map { note(id: "note-\($0)", markdown: "") },
                        "selectedID": NSNull(), "activeTag": NSNull()], label: "too many notes")

        let beforeOversizedSave = try Data(contentsOf: store.libraryURL)
        let oversized = try LibraryDocument(notes: (0..<6).map { index in
            LibraryNote(id: "large-\(index)", markdown: String(repeating: "x", count: 1_900_000),
                        createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z")
        }, selectedID: nil, activeTag: nil)
        do { try store.save(oversized); preconditionFailure("oversized envelope accepted") }
        catch let error as StoreError { precondition(error.message.contains("10 MB")) }
        let afterOversizedSave = try Data(contentsOf: store.libraryURL)
        precondition(afterOversizedSave == beforeOversizedSave, "oversized envelope must not replace last-good file")

        let backup = try Data(contentsOf: store.backupURL)
        let backupDocument = try JSONDecoder().decode(LibraryDocument.self, from: backup)
        precondition(backupDocument.notes.first?.markdown == "first", "backup should retain last-good library")
        let backupMode = (try FileManager.default.attributesOfItem(atPath: store.backupURL.path)[.posixPermissions] as? NSNumber)?.intValue
        precondition(backupMode.map { $0 & 0o777 } == 0o600, "the backup is private")

        let writeGroup = DispatchGroup()
        for value in ["queued-1", "queued-2", "queued-3"] {
            writeGroup.enter()
            store.saveAsync(library(markdown: value)) { result in
                if case .failure(let error) = result { preconditionFailure("queued durable save failed: \(error)") }
                writeGroup.leave()
            }
        }
        precondition(writeGroup.wait(timeout: .now() + 10) == .success, "off-main ordered saves complete")
        let finalAsyncLibrary = try store.load()
        precondition(finalAsyncLibrary?.notes.first?.markdown == "queued-3", "serial writer preserves submission order")
        try store.save(library(markdown: String(repeating: "x", count: LibraryStore.maximumNoteBytes)))

        let corruptDirectory = directory.appendingPathComponent("corrupt", isDirectory: true)
        try FileManager.default.createDirectory(at: corruptDirectory, withIntermediateDirectories: true)
        let corruptURL = corruptDirectory.appendingPathComponent("library.json")
        let corruptBytes = Data("not json".utf8)
        try corruptBytes.write(to: corruptURL)
        let corruptStore = LibraryStore(directory: corruptDirectory)
        precondition(corruptStore.startupError != nil, "corrupt startup data should be reported")
        do { try corruptStore.save(first); preconditionFailure("must reject save over corrupt library") }
        catch is StoreError {}
        let untouchedBytes = try Data(contentsOf: corruptURL)
        precondition(untouchedBytes == corruptBytes, "corrupt bytes must remain untouched")

        let recoveryDirectory = directory.appendingPathComponent("recovery", isDirectory: true)
        try FileManager.default.createDirectory(at: recoveryDirectory, withIntermediateDirectories: true)
        let recoveryPrimary = recoveryDirectory.appendingPathComponent("library.json")
        let recoveryBackup = recoveryDirectory.appendingPathComponent("library.json.bak")
        try Data("corrupt primary".utf8).write(to: recoveryPrimary)
        let goodBackup = try JSONEncoder().encode(first)
        try goodBackup.write(to: recoveryBackup)
        let recoveryStore = LibraryStore(directory: recoveryDirectory)
        precondition(recoveryStore.startupError != nil, "invalid primary remains a startup error despite valid backup")
        let recoveryStatus = recoveryStore.recoveryStatus()
        precondition(recoveryStatus.backupAvailable && recoveryStatus.backupNoteCount == 1 && recoveryStatus.backupUpdatedAt != nil,
                     "backup status exposes validated note count and update time")
        try recoveryStore.restoreBackup(now: Date(timeIntervalSince1970: 1_800_000_000))
        let recoveredLibrary = try recoveryStore.load()
        precondition(recoveryStore.startupError == nil && recoveredLibrary != nil, "restoring a verified backup reinitializes the store")
        let quarantined = try FileManager.default.contentsOfDirectory(atPath: recoveryDirectory.path).filter { $0.hasPrefix("library.corrupt-") }
        let quarantinedBytes = try Data(contentsOf: recoveryDirectory.appendingPathComponent(quarantined[0]))
        precondition(quarantined.count == 1 && quarantinedBytes == Data("corrupt primary".utf8),
                     "restore preserves corrupt primary bytes under a unique recovery name")
        print("Native typed persistence, durability, permissions, recovery, limits and lock checks passed")
    }

    private static func assertRejected(_ object: Any, label: String) {
        do {
            let data = try JSONSerialization.data(withJSONObject: object)
            _ = try JSONDecoder().decode(LibraryDocument.self, from: data)
        } catch { return }
        preconditionFailure("typed decoding accepted \(label)")
    }

    private static func note(id: String, markdown: String, createdAt: String = "2026-01-01T00:00:00Z", trashedAt: Any? = nil) -> [String: Any] {
        var value: [String: Any] = ["id": id, "markdown": markdown, "createdAt": createdAt, "updatedAt": "2026-01-01T00:00:00Z"]
        if let trashedAt { value["trashedAt"] = trashedAt }
        return value
    }

    private static func library(markdown: String) -> LibraryDocument {
        try! LibraryDocument(notes: [LibraryNote(id: "note-1", markdown: markdown,
            createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z")], selectedID: "note-1", activeTag: nil)
    }
}
