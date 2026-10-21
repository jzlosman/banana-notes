import Foundation

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
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("FoldnoteStoreTest-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        var store = LibraryStore(directory: directory)
        let emptyLoad = try store.load()
        precondition(emptyLoad == nil, "new store should load empty")
        let first = library(markdown: "first")
        try store.save(first)
        let savedLoad = try store.load()
        precondition(savedLoad?["notes"] != nil, "saved library should load")
        try store.save(library(markdown: "second"))
        assertRejected(version: true, label: "boolean version")
        assertRejected(version: 1.5, label: "fractional version")
        var invalidTimestamp = library(markdown: "bad date")
        var invalidTimestampNotes = invalidTimestamp["notes"] as! [[String: Any]]
        invalidTimestampNotes[0]["createdAt"] = "yesterday"
        invalidTimestamp["notes"] = invalidTimestampNotes
        assertRejected(invalidTimestamp, label: "invalid timestamp")
        var trashed = library(markdown: "keep this **Markdown**")
        var trashedNotes = trashed["notes"] as! [[String: Any]]
        trashedNotes[0]["trashedAt"] = "2026-10-20T12:00:00.000Z"; trashed["notes"] = trashedNotes
        var trashStore = LibraryStore(directory: directory.appendingPathComponent("trash"))
        try trashStore.save(trashed)
        let trashReload = try trashStore.load()!
        precondition((trashReload["notes"] as! [[String: Any]])[0]["trashedAt"] as? String == "2026-10-20T12:00:00.000Z")
        precondition((trashReload["notes"] as! [[String: Any]])[0]["markdown"] as? String == "keep this **Markdown**")
        for invalid: Any in [NSNull(), true, "yesterday"] {
            var badTrash = trashed; var notes = trashedNotes; notes[0]["trashedAt"] = invalid; badTrash["notes"] = notes
            assertRejected(badTrash, label: "invalid trash timestamp")
        }
        var duplicateIDs = library(markdown: "one")
        duplicateIDs["notes"] = [note(id: "same", markdown: "one"), note(id: "same", markdown: "two")]
        assertRejected(duplicateIDs, label: "duplicate note id")
        var missingSelection = library(markdown: "note")
        missingSelection.removeValue(forKey: "selectedID")
        assertRejected(missingSelection, label: "missing selectedID")
        var invalidSelection = library(markdown: "note")
        invalidSelection["selectedID"] = 1
        assertRejected(invalidSelection, label: "non-string selectedID")
        var invalidTag = library(markdown: "note")
        invalidTag["activeTag"] = "1not-a-tag"
        assertRejected(invalidTag, label: "invalid activeTag")
        let beforeOversizedSave = try Data(contentsOf: store.libraryURL)
        assertRejectedSave(["version": 1, "notes": [], "selectedID": NSNull(), "activeTag": NSNull(),
                            "extra": String(repeating: "x", count: LibraryStore.maximumBytes)], store: &store, label: "oversized envelope")
        let afterOversizedSave = try Data(contentsOf: store.libraryURL)
        precondition(afterOversizedSave == beforeOversizedSave, "oversized envelope must not replace last-good file")
        assertRejected(["version": 1, "notes": [note(id: "large", markdown: String(repeating: "x", count: LibraryStore.maximumNoteBytes + 1))],
                        "selectedID": NSNull(), "activeTag": NSNull()], label: "oversized note")
        assertRejected(["version": 1, "notes": (0...LibraryStore.maximumNotes).map { note(id: "note-\($0)", markdown: "") },
                        "selectedID": NSNull(), "activeTag": NSNull()], label: "too many notes")
        let goodBytesBeforeRejectedSaves = try Data(contentsOf: store.libraryURL)
        do {
            try store.save(["version": true, "notes": [], "selectedID": NSNull(), "activeTag": NSNull()])
            preconditionFailure("invalid library must not replace last-good file")
        } catch is StoreError {}
        let afterRejectedSave = try Data(contentsOf: store.libraryURL)
        precondition(afterRejectedSave == goodBytesBeforeRejectedSaves, "rejected save must preserve last-good file")

        let backup = try Data(contentsOf: store.backupURL)
        let backupObject = try JSONSerialization.jsonObject(with: backup) as! [String: Any]
        let backupNote = (backupObject["notes"] as! [[String: Any]])[0]
        precondition(backupNote["markdown"] as? String == "first", "backup should retain last-good library")

        let corruptDirectory = directory.appendingPathComponent("corrupt", isDirectory: true)
        try FileManager.default.createDirectory(at: corruptDirectory, withIntermediateDirectories: true)
        let corruptURL = corruptDirectory.appendingPathComponent("library.json")
        let corruptBytes = Data("not json".utf8)
        try corruptBytes.write(to: corruptURL)
        var corruptStore = LibraryStore(directory: corruptDirectory)
        precondition(corruptStore.startupError != nil, "corrupt startup data should be reported")
        do {
            try corruptStore.save(first)
            preconditionFailure("must reject save over corrupt library")
        } catch is StoreError {}
        let untouchedBytes = try Data(contentsOf: corruptURL)
        precondition(untouchedBytes == corruptBytes, "corrupt bytes must remain untouched")
        print("Native persistence checks passed")
    }

    private static func assertRejected(_ library: Any, label: String) {
        guard let object = library as? [String: Any] else { preconditionFailure("test case \(label) is not an object") }
        do {
            try LibraryStore.validate(object)
        } catch { return }
        preconditionFailure("validation accepted \(label)")
    }

    private static func assertRejected(version: Any, label: String) {
        assertRejected(["version": version, "notes": [], "selectedID": NSNull(), "activeTag": NSNull()], label: label)
    }

    private static func assertRejectedSave(_ library: Any, store: inout LibraryStore, label: String) {
        do {
            try store.save(library)
        } catch { return }
        preconditionFailure("save accepted \(label)")
    }

    private static func note(id: String, markdown: String) -> [String: Any] {
        ["id": id, "markdown": markdown, "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z"]
    }

    private static func library(markdown: String) -> [String: Any] {
        ["version": 1, "notes": [["id": "note-1", "markdown": markdown,
                                    "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z"]],
         "selectedID": "note-1", "activeTag": NSNull()]
    }
}
