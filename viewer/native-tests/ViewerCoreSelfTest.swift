import Foundation
import Darwin
@testable import BananaViewerCore

@main
@MainActor
struct ViewerCoreSelfTest {
    static func main() async throws {
        let catalog = try makeCatalog()
        testWindowTitles()
        try testPreferences(catalog: catalog)
        print("Viewer preference policy cases passed.")
        try testDocuments()
        try testAtomicDocumentWriter()
        try testRootSwapBeforePinning()
        print("Viewer document policy cases passed.")
        try testResourceAndLinkPolicies()
        print("Viewer resource/link policy cases passed.")
        try testPreferencePersistence(catalog: catalog)
        testRecentDocumentMenuBuilder()
        testMenuAnchorRect()
        try testPendingOpenURLs()
        try await testDefaultApplication()
        print("Viewer default app decisions, bundle identity, and fake LaunchServices cases passed.")
        print("Viewer core policies, bounded reads, and isolated preferences passed.")
    }

    private static func makeCatalog() throws -> ViewerCatalog {
        let themes = Data(##"[{"id":"banana-dark","appearance":"dark","colors":{"paper":"#1c1a15"}}]"##.utf8)
        let fonts = Data(#"[{"id":"space-mono","kind":"bundled","weights":[400]},{"id":"avenir","kind":"system","weights":[400,500]},{"id":"google-font","kind":"google","weights":[400]}]"#.utf8)
        return try ViewerCatalog(themeData: themes, fontData: fonts)
    }

    private static func testWindowTitles() {
        expect(ViewerWindowTitle.make(filename: "Notes.md", editingState: .locked) == "Notes.md — Banana Viewer",
               "locked document title has no unsaved marker")
        expect(ViewerWindowTitle.make(filename: "Notes.md", editingState: .unlocked(dirty: false)) == "Notes.md — Banana Viewer",
               "clean unlocked document title has no unsaved marker")
        expect(ViewerWindowTitle.make(filename: "Notes.md", editingState: .unlocked(dirty: true)) == "*Notes.md — Banana Viewer",
               "dirty document title prefixes the filename with an asterisk")
        expect(ViewerWindowTitle.make(filename: "東京 notes.md", editingState: .unlocked(dirty: true)) == "*東京 notes.md — Banana Viewer",
               "dirty title preserves spaces and unicode in the filename")
        print("Viewer window title cases passed.")
    }

    private static func testPreferences(catalog: ViewerCatalog) throws {
        try ViewerPreferences.defaults.validate(using: catalog)
        let effectsPreferences = ViewerPreferences(themeID: "system", syntaxThemeID: "app", fontID: "space-mono", fontWeight: 400,
                                                  fontSize: 15, focusedOpacity: 0.9, unfocusedOpacity: 0.65, glass: 0)
        let opaquePlan = ViewerWindowSurfacePlan.make(preferences: effectsPreferences, isFocused: false)
        let glassPlan = ViewerWindowSurfacePlan.make(preferences: ViewerPreferences(
            themeID: "system", syntaxThemeID: "app", fontID: "space-mono", fontWeight: 400,
            fontSize: 15, focusedOpacity: 0.9, unfocusedOpacity: 0.65, glass: 0.4), isFocused: false)
        expect(opaquePlan.paperAlpha == 1 && opaquePlan.windowIsOpaque && !opaquePlan.showsVibrancy,
               "zero glass uses an opaque theme surface with no vibrancy")
        expect(glassPlan.paperAlpha == 0.6 && !glassPlan.windowIsOpaque && glassPlan.showsVibrancy && glassPlan.vibrancyAlpha == 0.4,
               "glass blends the theme surface alpha with native vibrancy")
        expect(glassPlan.foregroundAlpha == opaquePlan.foregroundAlpha,
               "glass amount does not independently dim foreground content")
        try expectThrows("unknown appearance") {
            try ViewerPreferences(themeID: "system-hack", syntaxThemeID: "app", fontID: "space-mono", fontWeight: 400,
                                 fontSize: 15, focusedOpacity: 1, unfocusedOpacity: 1, glass: 0).validate(using: catalog)
        }
        try expectThrows("downloaded font") {
            try ViewerPreferences(themeID: "system", syntaxThemeID: "app", fontID: "google-font", fontWeight: 400,
                                 fontSize: 15, focusedOpacity: 1, unfocusedOpacity: 1, glass: 0).validate(using: catalog)
        }
        try expectThrows("font weight mismatch") {
            try ViewerPreferences(themeID: "system", syntaxThemeID: "app", fontID: "space-mono", fontWeight: 700,
                                 fontSize: 15, focusedOpacity: 1, unfocusedOpacity: 1, glass: 0).validate(using: catalog)
        }
        try expectThrows("invalid opacity") {
            try ViewerPreferences(themeID: "system", syntaxThemeID: "app", fontID: "space-mono", fontWeight: 400,
                                 fontSize: 15, focusedOpacity: .nan, unfocusedOpacity: 1, glass: 0).validate(using: catalog)
        }
        let encoded = try JSONEncoder().encode(ViewerPreferences.defaults)
        var wire = try JSONSerialization.jsonObject(with: encoded) as! [String: Any]
        _ = try ViewerPolicy.validateWirePreferences(wire, catalog: catalog)
        wire["legacyNotePath"] = "/Users/private/notes.md"
        try expectThrows("extra wire key") { _ = try ViewerPolicy.validateWirePreferences(wire, catalog: catalog) }
        wire.removeValue(forKey: "legacyNotePath")
        wire["fontSize"] = true
        try expectThrows("boolean is not a font size") { _ = try ViewerPolicy.validateWirePreferences(wire, catalog: catalog) }
    }

    private static func testDocuments() throws {
        let root = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let note = root.appendingPathComponent("sample.MD")
        try Data("# Héllo viewer\n".utf8).write(to: note)
        let alias = root.appendingPathComponent("alias.md")
        try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: note)
        let result = try ViewerDocumentReader.read(note)
        expect(result.markdown.contains("Héllo"), "valid UTF-8 content is preserved")
        expect(result.canonicalURL == ViewerDocumentReader.canonicalURL(for: note), "document path is canonical")
        expect(result.revision.count == 64, "revision is SHA-256")
        let documentID = ViewerDocumentReader.documentID(for: result.canonicalURL)
        expect(documentID.count == 64, "document identity is an opaque SHA-256 of its canonical path")
        expect(documentID == ViewerDocumentReader.documentID(for: ViewerDocumentReader.canonicalURL(for: root.appendingPathComponent("alias.md"))),
               "canonical aliases keep one document identity")
        expect(documentID != ViewerDocumentReader.documentID(for: ViewerDocumentReader.canonicalURL(for: root.appendingPathComponent("other.md"))),
               "different paths have different document identities")
        let loaded = ViewerDocument.loaded(documentID: documentID, name: note.lastPathComponent, markdown: result.markdown,
                                           revision: result.revision, resourceBaseURL: ViewerPolicy.resourceBaseURL)
        let wire = try JSONSerialization.jsonObject(with: JSONEncoder().encode(loaded)) as! [String: Any]
        expect(wire["documentID"] as? String == documentID, "loaded snapshots carry the opaque document identity")
        expect(result.resourceRoot.directoryPath == result.canonicalURL.deletingLastPathComponent().path,
               "the document and images share the root pinned before the document read")
        expect(ViewerDocumentReader.canonicalURL(for: alias) == result.canonicalURL,
               "symlink aliases deduplicate to a canonical document URL")

        let unsupported = root.appendingPathComponent("notes.txt")
        try Data("plain".utf8).write(to: unsupported)
        try expectThrows("unsupported extension") { _ = try ViewerDocumentReader.read(unsupported) }

        let directory = root.appendingPathComponent("folder.md", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        try expectThrows("directory") { _ = try ViewerDocumentReader.read(directory) }

        let invalidUTF8 = root.appendingPathComponent("invalid.md")
        try Data([0xff, 0xfe, 0x80]).write(to: invalidUTF8)
        try expectThrows("invalid UTF-8") { _ = try ViewerDocumentReader.read(invalidUTF8) }

        let oversized = root.appendingPathComponent("oversized.md")
        try Data(repeating: 0x61, count: ViewerDocumentReader.maximumBytes + 1).write(to: oversized)
        try expectThrows("oversized document") { _ = try ViewerDocumentReader.read(oversized) }

        let before = try ViewerDocumentReader.fingerprint(note)
        let replacement = root.appendingPathComponent("atomic.tmp")
        try Data("# replacement content with a different size\n".utf8).write(to: replacement)
        let renamed = replacement.path.withCString { from in
            note.path.withCString { to in Darwin.rename(from, to) == 0 }
        }
        expect(renamed, "atomic replacement succeeds")
        let after = try ViewerDocumentReader.fingerprint(note)
        expect(before != after, "replacement is observable through the fingerprint")
        let replaced = try ViewerDocumentReader.read(note)
        expect(replaced.markdown.contains("replacement"), "replacement content is readable")
    }

    private static func testAtomicDocumentWriter() throws {
        let root = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let document = root.appendingPathComponent("writer.md")
        let original = Data("# Keep\r\n\r\nFirst paragraph\r\n\r\nLast line".utf8)
        try original.write(to: document)
        try FileManager.default.setAttributes([.posixPermissions: 0o640], ofItemAtPath: document.path)
        let canonical = ViewerDocumentReader.canonicalURL(for: document)
        let reader = try ViewerRasterResourceReader(canonicalDocumentDirectory: canonical.deletingLastPathComponent())
        let initial = try ViewerDocumentReader.read(canonicalURL: canonical, using: reader)
        let noOp = ViewerDocumentWriter.save(canonicalURL: canonical, using: reader, expectedRevision: initial.revision,
                                            markdown: initial.markdown, isUnlocked: true)
        expect(noOp == .saved(revision: initial.revision), "no-op save returns the existing revision")
        let noOpStat = try FileManager.default.attributesOfItem(atPath: document.path)
        expect((noOpStat[.systemFileNumber] as? NSNumber)?.uint64Value == UInt64(initial.fingerprint.inode),
               "no-op save does not replace the source file")

        let changed = "# Keep\r\n\r\nChanged paragraph\r\n\r\nLast line"
        let saved = ViewerDocumentWriter.save(canonicalURL: canonical, using: reader, expectedRevision: initial.revision,
                                              markdown: changed, isUnlocked: true)
        guard case .saved(let revision) = saved else { fatalError("Viewer writer failed to save: \(saved)") }
        let savedBytes = try Data(contentsOf: document)
        expect(savedBytes == Data(changed.utf8), "writer saves exact CRLF and trailing-newline state")
        let permissions = try FileManager.default.attributesOfItem(atPath: document.path)[.posixPermissions] as? NSNumber
        expect(permissions?.intValue == 0o640, "atomic replacement preserves POSIX permissions")
        let savedRead = try ViewerDocumentReader.read(canonicalURL: canonical, using: reader)
        expect(revision == savedRead.revision,
               "saved revision matches the exact file bytes")

        let current = try ViewerDocumentReader.read(canonicalURL: canonical, using: reader)
        try Data("external version\n".utf8).write(to: document)
        let conflict = ViewerDocumentWriter.save(canonicalURL: canonical, using: reader, expectedRevision: current.revision,
                                                 markdown: "my edits\n", isUnlocked: true)
        expect(conflict == .conflict, "stale expected revision is a typed conflict")
        let conflictBytes = try String(contentsOf: document, encoding: .utf8)
        expect(conflictBytes == "external version\n", "conflict never overwrites the external version")

        let disk = try Data(contentsOf: document)
        let locked = ViewerDocumentWriter.save(canonicalURL: canonical, using: reader, expectedRevision: current.revision,
                                              markdown: "blocked\n", isUnlocked: false)
        expect(locked == .failed(reason: .unknown), "writer refuses a locked window")
        let lockedBytes = try Data(contentsOf: document)
        expect(lockedBytes == disk, "locked rejection leaves disk unchanged")

        try FileManager.default.setAttributes([.posixPermissions: 0o444], ofItemAtPath: document.path)
        let readOnly = try ViewerDocumentReader.read(canonicalURL: canonical, using: reader)
        let denied = ViewerDocumentWriter.save(canonicalURL: canonical, using: reader, expectedRevision: readOnly.revision,
                                               markdown: "not writable\n", isUnlocked: true)
        expect(denied == .failed(reason: .readOnlyFile), "read-only file reports an allowlisted failure")
        print("Viewer atomic writer, permissions, conflict and lock guards passed.")
    }

    private static func testRootSwapBeforePinning() throws {
        let workspace = try temporaryDirectory()
        let selectedDirectory = workspace.appendingPathComponent("selected", isDirectory: true)
        let movedDirectory = workspace.appendingPathComponent("selected-moved", isDirectory: true)
        let outside = try temporaryDirectory()
        try FileManager.default.createDirectory(at: selectedDirectory, withIntermediateDirectories: false)
        defer {
            try? FileManager.default.removeItem(at: selectedDirectory)
            try? FileManager.default.removeItem(at: movedDirectory)
            try? FileManager.default.removeItem(at: workspace)
            try? FileManager.default.removeItem(at: outside)
        }
        let document = selectedDirectory.appendingPathComponent("chosen.md")
        try Data("# selected document\n".utf8).write(to: document)
        try Data("# outside document\n".utf8).write(to: outside.appendingPathComponent("chosen.md"))
        let canonicalDocument = ViewerDocumentReader.canonicalURL(for: document)
        let canonicalDirectory = canonicalDocument.deletingLastPathComponent()

        // The parent is replaced after canonicalization but before Reader pins it.
        try FileManager.default.moveItem(at: canonicalDirectory, to: movedDirectory)
        try FileManager.default.createSymbolicLink(at: canonicalDirectory, withDestinationURL: outside)
        try expectThrows("document parent swapped to an outside symlink before pinning") {
            _ = try ViewerDocumentReader.read(canonicalURL: canonicalDocument)
        }
    }

    private static func testResourceAndLinkPolicies() throws {
        let root = try temporaryDirectory()
        let outside = try temporaryDirectory()
        let pinnedRoot = try temporaryDirectory()
        let movedPinnedRoot = pinnedRoot.deletingLastPathComponent().appendingPathComponent("moved-\(pinnedRoot.lastPathComponent)", isDirectory: true)
        defer {
            try? FileManager.default.removeItem(at: root)
            try? FileManager.default.removeItem(at: outside)
            try? FileManager.default.removeItem(at: pinnedRoot)
            try? FileManager.default.removeItem(at: movedPinnedRoot)
        }
        let imageURL = URL(string: "banana-viewer-resource://document/image.png")!
        let imagePath = try ViewerPolicy.rasterPath(requestURL: imageURL)
        try Data([0x89, 0x50, 0x4e, 0x47]).write(to: root.appendingPathComponent("image.png"))
        let canonicalRoot = ViewerDocumentReader.canonicalURL(for: root.appendingPathComponent("image.png")).deletingLastPathComponent()
        let rootReader = try ViewerRasterResourceReader(canonicalDocumentDirectory: canonicalRoot)
        let image = try rootReader.read(imagePath)
        expect(image.mimeType == "image/png" && image.data.count == 4, "raster path is allowlisted and read from its pinned root")

        let svgURL = URL(string: "banana-viewer-resource://document/vector.svg")!
        try expectThrows("SVG is not raster") { _ = try ViewerPolicy.rasterPath(requestURL: svgURL) }
        try expectThrows("path traversal") {
            _ = try ViewerPolicy.rasterPath(requestURL: URL(string: "banana-viewer-resource://document/%2e%2e/escape.png")!)
        }

        // Validate a lexical path, then replace its final component with an outside symlink.
        try Data([1, 2, 3]).write(to: outside.appendingPathComponent("escape.png"))
        let swappedURL = URL(string: "banana-viewer-resource://document/swapped.png")!
        let validatedBeforeSwap = try ViewerPolicy.rasterPath(requestURL: swappedURL)
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("swapped.png"),
                                                   withDestinationURL: outside.appendingPathComponent("escape.png"))
        try expectThrows("post-validation symlink replacement") { _ = try rootReader.read(validatedBeforeSwap) }

        let subdirectoryURL = URL(string: "banana-viewer-resource://document/linked/escape.png")!
        let validatedSubdirectory = try ViewerPolicy.rasterPath(requestURL: subdirectoryURL)
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("linked"), withDestinationURL: outside)
        try expectThrows("symlinked directory traversal") { _ = try rootReader.read(validatedSubdirectory) }

        let pinnedImage = URL(string: "banana-viewer-resource://document/pinned.png")!
        try Data([0x11]).write(to: pinnedRoot.appendingPathComponent("pinned.png"))
        try Data([0x22]).write(to: outside.appendingPathComponent("pinned.png"))
        let canonicalPinnedRoot = ViewerDocumentReader.canonicalURL(for: pinnedRoot.appendingPathComponent("pinned.png")).deletingLastPathComponent()
        let pinnedReader = try ViewerRasterResourceReader(canonicalDocumentDirectory: canonicalPinnedRoot)
        try FileManager.default.moveItem(at: pinnedRoot, to: movedPinnedRoot)
        try FileManager.default.createSymbolicLink(at: pinnedRoot, withDestinationURL: outside)
        let pinnedContents = try pinnedReader.read(ViewerPolicy.rasterPath(requestURL: pinnedImage))
        expect(pinnedContents.data == Data([0x11]), "renaming the root cannot redirect an already pinned descriptor")

        let source = root.appendingPathComponent("folder/current.md")
        expect(ViewerPolicy.localMarkdownTarget(href: "next.md#section", relativeTo: source)?.lastPathComponent == "next.md",
               "relative Markdown link accepts fragments")
        expect(ViewerPolicy.localMarkdownTarget(href: "../../outside.md", relativeTo: source) != nil,
               "an explicit Markdown link may resolve a Markdown document")
        expect(ViewerPolicy.localMarkdownTarget(href: "file:///tmp/private.md", relativeTo: source) == nil,
               "file URL is not a local bridge target")
        expect(ViewerPolicy.localMarkdownTarget(href: "image.png", relativeTo: source) == nil,
               "local link bridge opens only Markdown")
        expect(ViewerPolicy.explicitExternalURL("https://example.test/a") != nil, "HTTPS click is allowed")
        expect(ViewerPolicy.explicitExternalURL("mailto:reader@example.test") != nil, "mailto click is allowed")
        expect(ViewerPolicy.explicitExternalURL("file:///etc/passwd") == nil, "file URL is not external")
        expect(ViewerPolicy.explicitExternalURL("javascript:alert(1)") == nil, "script URL is rejected")
        expect(ViewerPolicy.explicitExternalURL("https://user:pass@example.test") == nil, "credential URL is rejected")
    }

    private static func testPreferencePersistence(catalog: ViewerCatalog) throws {
        let suite = "com.jzlosman.banana-viewer.tests.\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else { fatalError("Could not create isolated preferences domain") }
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = ViewerPreferencesStore(defaults: defaults, catalog: catalog)
        expect(store.preferences == .defaults, "new app domain starts from viewer defaults")
        let changed = ViewerPreferences(themeID: "banana-dark", syntaxThemeID: "banana-dark", fontID: "avenir", fontWeight: 500,
                                        fontSize: 18, focusedOpacity: 0.9, unfocusedOpacity: 0.8, glass: 0.3)
        try store.save(changed)
        expect(store.preferences == changed, "viewer settings persist in the supplied isolated domain")

        let previousApp = ViewerBundleIdentifier("com.apple.dt.Xcode")!
        store.rememberPreviousDefaultApplication(previousApp)
        let reopenedStore = ViewerPreferencesStore(defaults: defaults, catalog: catalog)
        expect(reopenedStore.previousDefaultApplicationBundleIdentifier == previousApp,
               "the previous default app bundle identifier persists in the native viewer preferences domain")
        defaults.set("/Applications/Preview.app", forKey: "viewerPreviousDefaultAppBundleIdentifier.v1")
        expect(reopenedStore.previousDefaultApplicationBundleIdentifier == nil &&
               defaults.object(forKey: "viewerPreviousDefaultAppBundleIdentifier.v1") == nil,
               "invalid remembered application identifiers are rejected and removed")

        let first = URL(fileURLWithPath: "/tmp/viewer-one.md")
        let second = URL(fileURLWithPath: "/tmp/viewer-two.mdown")
        store.recordRecent(first)
        store.recordRecent(second)
        store.recordRecent(first)
        expect(store.recentDocumentURLs.map(\.lastPathComponent) == ["viewer-one.md", "viewer-two.mdown"],
               "recents are unique and newest first")
        store.clearRecentDocuments()
        expect(store.recentDocumentURLs.isEmpty, "clear recents removes viewer-owned recent list")
    }

    private static func testRecentDocumentMenuBuilder() {
        let first = URL(fileURLWithPath: "/tmp/Folder B/Shared.md")
        let current = URL(fileURLWithPath: "/tmp/Folder A/Shared.md")
        let unique = URL(fileURLWithPath: "/tmp/Folder A/Notes.md")
        let missing = URL(fileURLWithPath: "/tmp/Folder A/Missing.md")
        let existing = Set([first.path, current.path, unique.path])
        let items = ViewerRecentDocumentMenuBuilder.build(
            recentURLs: [first, current, unique, missing],
            fileExists: { existing.contains($0.path) }, currentDocumentURL: current)
        expect(items.map(\.url) == [first, current, unique], "recent menu preserves newest-first order and drops files that no longer exist")
        expect(items[0].hasDuplicateFilename && items[1].hasDuplicateFilename && !items[2].hasDuplicateFilename,
               "both matching filenames are marked for folder disambiguation")
        expect(items[0].fallbackTitle == "Shared.md — Folder B" && items[1].fallbackTitle == "Shared.md — Folder A",
               "duplicate titles include each parent folder name")
        expect(items[0].isCurrentDocument == false && items[1].isCurrentDocument && !items[2].isCurrentDocument,
               "the current window document is marked without changing recency order")
        expect(ViewerRecentDocumentMenuBuilder.build(recentURLs: [missing], fileExists: { _ in false }, currentDocumentURL: nil).isEmpty,
               "no existing recent documents produces the empty-state item list")

        let capInput = [URL(fileURLWithPath: "/tmp/Missing.md")] + (0..<11).map { URL(fileURLWithPath: "/tmp/recent-\($0).md") }
        let capped = ViewerRecentDocumentMenuBuilder.build(
            recentURLs: capInput, fileExists: { $0.lastPathComponent != "Missing.md" }, currentDocumentURL: nil)
        expect(capped.count == 10 && capped.first?.filename == "recent-0.md" && capped.last?.filename == "recent-9.md",
               "the ten-item cap applies after missing files are removed")
        print("Viewer recent-document menu ordering, cap, existence, duplicate names, and current marking passed.")
    }

    private static func testMenuAnchorRect() {
        let valid = ViewerMenuAnchorRect(wireValue: ["x": 30, "y": 25, "width": 30, "height": 20])
        expect(valid?.clamped(to: CGRect(x: 0, y: 0, width: 40, height: 30)) == CGRect(x: 30, y: 25, width: 10, height: 5),
               "open-menu geometry is clamped to the viewport")
        let partial = ViewerMenuAnchorRect(wireValue: ["x": -5, "y": -2, "width": 12, "height": 10])
        expect(partial?.clamped(to: CGRect(x: 0, y: 0, width: 40, height: 30)) == CGRect(x: 0, y: 0, width: 12, height: 10),
               "partially offscreen menu anchors are clamped into the viewport")
        expect(ViewerMenuAnchorRect(wireValue: ["x": NSNumber(value: Double.nan), "y": 0, "width": 30, "height": 30]) == nil,
               "non-finite menu geometry is rejected")
        expect(ViewerMenuAnchorRect(wireValue: ["x": true, "y": 0, "width": 30, "height": 30]) == nil,
               "boolean menu geometry is rejected instead of being coerced to a number")
        expect(ViewerMenuAnchorRect(wireValue: ["x": 0, "y": 0, "width": 0, "height": 30]) == nil,
               "zero-area menu geometry is rejected")
        expect(ViewerMenuAnchorRect(wireValue: ["x": 0, "y": 0, "width": 30, "height": 30, "path": "/tmp/private.md"]) == nil,
               "unexpected menu payload keys are rejected")
    }

    private static func testPendingOpenURLs() throws {
        var pending = ViewerPendingOpenURLs()
        let first = URL(fileURLWithPath: "/tmp/first.md")
        let second = URL(fileURLWithPath: "/tmp/second.md")
        pending.append(contentsOf: [first])
        pending.append(contentsOf: [second])
        expect(pending.drain() == [first, second], "file-open requests received before launch are drained in arrival order")
        expect(pending.drain().isEmpty, "draining pending file-open requests prevents replay")
    }

    private static func testDefaultApplication() async throws {
        let markdownType = "net.daringfireball.markdown"
        let mdType = "public.markdown"
        expect(ViewerBundleIdentifier("com.apple.dt.Xcode") != nil && ViewerBundleIdentifier("/Applications/Xcode.app") == nil,
               "bundle identity accepts identifiers and rejects application paths")
        expect(ViewerDefaultApplicationDecision.contentTypeIdentifiers(markdownTypeIdentifier: markdownType,
                                                                       mdExtensionTypeIdentifier: markdownType) == [markdownType],
               "the Markdown content type is not duplicated when .md resolves to the same identifier")
        expect(ViewerDefaultApplicationDecision.contentTypeIdentifiers(markdownTypeIdentifier: markdownType,
                                                                       mdExtensionTypeIdentifier: mdType) == [markdownType, mdType],
               "the Markdown UTI and a distinct .md content type are both retained")
        expect(ViewerDefaultApplicationDecision.contentTypeIdentifiers(markdownTypeIdentifier: "", mdExtensionTypeIdentifier: "bad\nuti") == [],
               "empty and control-bearing content type identifiers are rejected")
        expect(ViewerDefaultApplicationDecision.applicationName(displayName: "  ", bundleName: "Preview") == "Preview",
               "app display-name extraction falls back to the bundle name")
        expect(ViewerDefaultApplicationDecision.applicationName(displayName: "Banana Viewer", bundleName: "Other") == "Banana Viewer",
               "app display-name extraction prefers CFBundleDisplayName")
        expect(ViewerDefaultApplicationDecision.applicationName(displayName: "Bad\nName", bundleName: nil) == nil,
               "control characters are not accepted in app display names")

        let services = FakeViewerLaunchServices()
        let memory = FakeViewerDefaultApplicationMemory()
        let manager = ViewerDefaultApplicationManager(launchServices: services, memory: memory)
        let previewIdentifier = ViewerBundleIdentifier("com.apple.Preview")!
        services.register(ViewerDefaultApplication(bundleIdentifier: previewIdentifier, displayName: "Preview"))
        services.applications[markdownType] = services.registeredApplications[previewIdentifier]
        services.applications[mdType] = services.registeredApplications[previewIdentifier]
        expect(manager.status() == ViewerDefaultAppStatus(isViewerDefault: false, currentAppName: "Preview", canToggle: true, previousAppName: nil),
               "the current default is shown while enabling remains available")

        services.setResults = [true, false, true]
        let declined = await manager.setDefault(enabled: true)
        expect(declined == .declinedOrFailed && services.setCalls == [markdownType, mdType, markdownType],
               "a failed registration rolls earlier content types back to the remembered default")
        expect(services.setBundleIdentifierCalls == [services.viewerBundleIdentifier!, services.viewerBundleIdentifier!, previewIdentifier] &&
               memory.previousDefaultApplicationBundleIdentifier == nil && !manager.status().isViewerDefault,
               "failed registration restores a coherent off state and clears the temporary memory")

        services.setCalls.removeAll(); services.setBundleIdentifierCalls.removeAll(); services.setResults = [true, true]
        let changed = await manager.setDefault(enabled: true)
        expect(changed == .changed && services.setCalls == [markdownType, mdType] &&
               services.setBundleIdentifierCalls == [services.viewerBundleIdentifier!, services.viewerBundleIdentifier!],
               "enabling sets every distinct Markdown content type in order")
        expect(memory.previousDefaultApplicationBundleIdentifier == previewIdentifier &&
               manager.status() == ViewerDefaultAppStatus(isViewerDefault: true, currentAppName: nil, canToggle: true, previousAppName: "Preview"),
               "the Viewer state keeps the prior app name and bundle identifier available for restoration")
        expect(services.applications[markdownType]?.bundleIdentifier == services.viewerBundleIdentifier &&
               services.applications[mdType]?.bundleIdentifier == services.viewerBundleIdentifier,
               "build copies with the same bundle identifier count as Viewer irrespective of location")

        services.setCalls.removeAll(); services.setBundleIdentifierCalls.removeAll(); services.setResults = [false]
        let restoreDeclined = await manager.setDefault(enabled: false)
        expect(restoreDeclined == .declinedOrFailed && memory.previousDefaultApplicationBundleIdentifier == previewIdentifier &&
               manager.status().canToggle,
               "a failed restoration retains the previous app so the user can retry")

        services.setCalls.removeAll(); services.setBundleIdentifierCalls.removeAll(); services.setResults = [true, true]
        let restored = await manager.setDefault(enabled: false)
        expect(restored == .changed && services.setCalls == [markdownType, mdType] &&
               services.setBundleIdentifierCalls == [previewIdentifier, previewIdentifier],
               "disabling restores the remembered application for every distinct content type")
        expect(memory.previousDefaultApplicationBundleIdentifier == nil &&
               manager.status() == ViewerDefaultAppStatus(isViewerDefault: false, currentAppName: "Preview", canToggle: true, previousAppName: nil),
               "successful restoration clears the remembered bundle identifier")

        services.applications[markdownType] = ViewerDefaultApplication(bundleIdentifier: services.viewerBundleIdentifier, displayName: "Banana Viewer")
        services.applications[mdType] = ViewerDefaultApplication(bundleIdentifier: services.viewerBundleIdentifier, displayName: "Banana Viewer (build copy)")
        services.setCalls.removeAll(); memory.rememberPreviousDefaultApplication(nil)
        let alreadyDefault = manager.status()
        expect(alreadyDefault.isViewerDefault && !alreadyDefault.canToggle && alreadyDefault.previousAppName == nil,
               "an already-default Viewer with no remembered app cannot offer a restore action")
        let noRememberedRestore = await manager.setDefault(enabled: false)
        expect(noRememberedRestore == .declinedOrFailed && services.setCalls.isEmpty,
               "a restore request without remembered state is rejected without Launch Services effects")

        services.applications.removeAll(); services.setCalls.removeAll(); services.setBundleIdentifierCalls.removeAll()
        services.setResults = [true, true]
        let noPreviousApp = manager.status()
        expect(!noPreviousApp.isViewerDefault && noPreviousApp.canToggle && noPreviousApp.currentAppName == nil,
               "an unset default can still be enabled")
        let enabledWithoutPrevious = await manager.setDefault(enabled: true)
        expect(enabledWithoutPrevious == .changed && manager.status().isViewerDefault && !manager.status().canToggle,
               "if no prior app existed, Viewer becomes default but cannot offer an impossible restore")
        let disabledWithoutPrevious = await manager.setDefault(enabled: false)
        expect(disabledWithoutPrevious == .declinedOrFailed,
               "turning off without a remembered previous application is rejected")

        let encoded = try JSONEncoder().encode(manager.status())
        let wire = try JSONSerialization.jsonObject(with: encoded) as! [String: Any]
        expect(wire.keys.sorted() == ["canToggle", "currentAppName", "isViewerDefault", "previousAppName"] &&
               wire["currentAppName"] is NSNull && wire["previousAppName"] is NSNull,
               "native status encodes the closed switch state and nullable, path-free display names")
    }

    private static func temporaryDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("banana-viewer-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    private static func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
        guard condition() else { fatalError("Viewer core test failed: \(message)") }
    }

    private static func expectThrows(_ name: String, _ body: () throws -> Void) throws {
        do { try body() } catch { return }
        fatalError("Viewer core test did not reject \(name)")
    }
}

private final class FakeViewerDefaultApplicationMemory: ViewerDefaultApplicationMemory {
    var previousDefaultApplicationBundleIdentifier: ViewerBundleIdentifier?
    func rememberPreviousDefaultApplication(_ identifier: ViewerBundleIdentifier?) {
        previousDefaultApplicationBundleIdentifier = identifier
    }
}

@MainActor
private final class FakeViewerLaunchServices: ViewerLaunchServices {
    let viewerBundleIdentifier: ViewerBundleIdentifier? = ViewerBundleIdentifier("com.jzlosman.banana-viewer")
    let markdownContentTypeIdentifiers = ["net.daringfireball.markdown", "public.markdown"]
    var applications: [String: ViewerDefaultApplication] = [:]
    var registeredApplications: [ViewerBundleIdentifier: ViewerDefaultApplication] = [:]
    var setCalls: [String] = []
    var setBundleIdentifierCalls: [ViewerBundleIdentifier] = []
    var setResults: [Bool] = [true, false]

    func register(_ application: ViewerDefaultApplication) {
        if let identifier = application.bundleIdentifier { registeredApplications[identifier] = application }
    }

    func currentApplication(forContentTypeIdentifier identifier: String) -> ViewerDefaultApplication? {
        applications[identifier]
    }

    func application(forBundleIdentifier identifier: ViewerBundleIdentifier) -> ViewerDefaultApplication? {
        registeredApplications[identifier]
    }

    func setDefaultApplication(bundleIdentifier: ViewerBundleIdentifier, forContentTypeIdentifier identifier: String) async -> Bool {
        let index = setCalls.count
        setCalls.append(identifier); setBundleIdentifierCalls.append(bundleIdentifier)
        let succeeded = index < setResults.count ? setResults[index] : true
        if succeeded {
            applications[identifier] = registeredApplications[bundleIdentifier] ??
                ViewerDefaultApplication(bundleIdentifier: bundleIdentifier, displayName: nil)
        }
        return succeeded
    }
}
