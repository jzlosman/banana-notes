import Foundation
import CryptoKit

private final class FakeFontHTTPClient: FontHTTPClient {
    var responses: [String: FontHTTPResponse] = [:]
    var requests: [String] = []
    var errorForURL: [String: Error] = [:]

    func get(_ url: URL, maximumBytes: Int) async throws -> FontHTTPResponse {
        requests.append(url.absoluteString)
        if let error = errorForURL[url.absoluteString] { throw error }
        guard let response = responses[url.absoluteString] else { throw NoteFontError(message: "Unexpected test request") }
        guard response.data.count <= maximumBytes else { throw NoteFontError(message: "Fake response too large") }
        return response
    }
}

@main
struct NoteFontStoreSelfTest {
    static func main() async throws {
        let fm = FileManager.default
        let base = fm.temporaryDirectory.appendingPathComponent("FoldnoteFonts-\(UUID().uuidString)", isDirectory: true)
        defer { try? fm.removeItem(at: base) }
        let bundleDir = base.appendingPathComponent("bundled-fonts", isDirectory: true)
        try fm.createDirectory(at: bundleDir, withIntermediateDirectories: true)
        let bundledFontSpecs: [(id: String, name: String, family: String, kind: String, weights: [Int], faces: [(file: String, weight: String, range: String)])] = [
            ("space-mono", "Space Mono", "Space Mono", "bundled", [400], [
                ("space-mono-latin-400-normal.woff2", "400", "U+0000-00FF"), ("space-mono-latin-ext-400-normal.woff2", "400", "U+0100-02BA"),
                ("space-mono-latin-700-normal.woff2", "700", "U+0000-00FF"), ("space-mono-latin-ext-700-normal.woff2", "700", "U+0100-02BA")]),
            ("jetbrains-mono", "JetBrains Mono", "JetBrains Mono", "bundled", [400, 500, 600], [
                ("jetbrains-mono-latin-wght-normal.woff2", "100 800", "U+0000-00FF"), ("jetbrains-mono-latin-ext-wght-normal.woff2", "100 800", "U+0100-02BA")]),
            ("overpass-mono", "Overpass Mono", "Overpass Mono", "bundled", [400, 500, 600], [
                ("overpass-mono-latin-wght-normal.woff2", "300 700", "U+0000-00FF"), ("overpass-mono-latin-ext-wght-normal.woff2", "300 700", "U+0100-02BA")]),
            ("fira-code", "Fira Code", "Fira Code", "bundled", [400, 500, 600], [
                ("fira-code-latin-wght-normal.woff2", "300 700", "U+0000-00FF"), ("fira-code-latin-ext-wght-normal.woff2", "300 700", "U+0100-02BA")]),
            ("avenir", "Avenir Next", "\"Avenir Next\", -apple-system, sans-serif", "system", [400, 500, 600], []),
            ("georgia", "Georgia", "Georgia, serif", "system", [400], [])
        ]
        let bundledFonts = bundledFontSpecs.map { font -> [String: Any] in
            ["id": font.id, "name": font.name, "family": font.family, "kind": font.kind, "weights": font.weights,
             "faces": font.faces.map { ["file": $0.file, "weight": $0.weight, "unicodeRange": $0.range] }]
        }
        try JSONSerialization.data(withJSONObject: ["fonts": bundledFonts], options: [.prettyPrinted, .sortedKeys])
            .write(to: bundleDir.appendingPathComponent("manifest.json"))
        var fontMarker: UInt8 = 1
        for face in bundledFontSpecs.flatMap(\.faces) {
            try woff2(marker: fontMarker).write(to: bundleDir.appendingPathComponent(face.file))
            fontMarker &+= 1
        }
        let suite = "FoldnoteFontTest-\(UUID().uuidString)"
        let pref = UserDefaults(suiteName: suite)!
        defer { pref.removePersistentDomain(forName: suite) }
        func fontStore(_ directory: URL, client: any FontHTTPClient = FakeFontHTTPClient()) -> NoteFontStore {
            NoteFontStore(directory: directory, defaults: pref, client: client, bundledFontsDirectory: bundleDir)
        }
        let http = FakeFontHTTPClient()
        let dataDir = base.appendingPathComponent("not-created", isDirectory: true)
        let store = fontStore(dataDir, client: http)
        precondition(!fm.fileExists(atPath: dataDir.path), "Reading builtins must not create app data")
        let initial = store.state
        let initialFonts = initial["fonts"] as! [[String: Any]]
        precondition((initial["selection"] as! [String: Any])["fontID"] as? String == "space-mono")
        precondition((initial["selection"] as! [String: Any])["weight"] as? Int == 400)
        precondition(initialFonts.map { $0["id"] as! String } == ["space-mono", "jetbrains-mono", "overpass-mono", "fira-code", "avenir", "georgia"])
        precondition(initialFonts.map { $0["weights"] as! [Int] } == [[400], [400, 500, 600], [400, 500, 600], [400, 500, 600], [400, 500, 600], [400]])
        precondition(initialFonts[0]["family"] as? String == "Space Mono")
        precondition(initialFonts[0]["kind"] as? String == "bundled")
        precondition(initialFonts.last!["weights"] as! [Int] == [400])
        for legacyID in ["sf-mono", "system", "unknown"] {
            pref.set(["fontID": legacyID, "weight": 500], forKey: "foldnote.noteFont.selection")
            let migrated = store.state["selection"] as! [String: Any]
            precondition(migrated["fontID"] as? String == "space-mono" && migrated["weight"] as? Int == 400)
            precondition((pref.dictionary(forKey: "foldnote.noteFont.selection")?["fontID"] as? String) == "space-mono")
        }
        pref.set(["fontID": "space-mono", "weight": 500], forKey: "foldnote.noteFont.selection")
        precondition((store.state["selection"] as! [String: Any])["weight"] as? Int == 400, "Unsupported stored weight migrates to the nearest supported weight")
        let selected = try store.select(NoteFontSelection(fontID: "avenir", weight: 600))
        precondition(selected["selection"] as? [String: Any] != nil)
        let reload = fontStore(dataDir, client: http)
        precondition((reload.state["selection"] as! [String: Any])["fontID"] as? String == "avenir")
        do { _ = try NoteFontSelection(fontID: "georgia", weight: 700); preconditionFailure("Invalid font weight accepted") } catch is NoteFontError {}
        do { _ = try store.select(NoteFontSelection(fontID: "unknown", weight: 400)); preconditionFailure("Unknown font accepted") } catch is NoteFontError {}
        precondition(http.requests.isEmpty, "No network access before explicit download")

        var cssComponents = URLComponents(string: "https://fonts.googleapis.com/css2")!
        cssComponents.queryItems = [URLQueryItem(name: "family", value: "Test Mono:wght@400;500;600;700"), URLQueryItem(name: "display", value: "swap")]
        let cssURL = cssComponents.url!
        let first = URL(string: "https://fonts.gstatic.com/s/test/v1/test-latin-url.woff2")!
        let second = URL(string: "https://fonts.gstatic.com/s/test/v1/test-cjk.woff2")!
        let binary1 = woff2(marker: 1)
        let binary2 = woff2(marker: 2)
        let css = """
        /* latin */
        @font-face { font-family: 'Test Mono'; font-style: normal; font-weight: 400; src: url(\(first.absoluteString)) format('woff2'); unicode-range: U+0000-00FF; }
        @font-face { font-family: 'Test Mono'; font-style: normal; font-weight: 400; src: url(\(second.absoluteString)) format('woff2'); unicode-range: U+4E00-9FFF; }
        @font-face { font-family: 'Test Mono'; font-style: normal; font-weight: 500; src: url(\(first.absoluteString)) format('woff2'); unicode-range: U+0000-00FF; }
        """
        http.responses[cssURL.absoluteString] = .init(data: Data(css.utf8), statusCode: 200, finalURL: cssURL)
        http.responses[first.absoluteString] = .init(data: binary1, statusCode: 200, finalURL: first)
        http.responses[second.absoluteString] = .init(data: binary2, statusCode: 200, finalURL: second)
        let result = try await store.download(family: "Test Mono")
        let fontID = result["downloadedFontID"] as! String
        precondition((result["fontState"] as! [String: Any])["selection"] as? [String: Any] != nil)
        precondition((store.state["selection"] as! [String: Any])["fontID"] as? String == "avenir", "Download must not select")
        let cached = (store.state["fonts"] as! [[String: Any]]).first { $0["id"] as? String == fontID }!
        precondition((cached["faces"] as! [[String: Any]]).count == 3, "Keep per-face weight and unicode ranges")
        precondition(cached["weights"] as? [Int] == [400, 500], "Expose only weights returned by Google")
        do { _ = try store.select(NoteFontSelection(fontID: fontID, weight: 600)); preconditionFailure("Unsupported Google weight accepted") } catch is NoteFontError {}
        precondition(Set(http.requests).count == 3, "Deduplicate shared font URLs")
        let faceURL = URL(string: (cached["faces"] as! [[String: Any]])[0]["url"] as! String)!
        let resolvedFontURL = try store.resolveFontURL(faceURL)
        let resolvedFontData = try Data(contentsOf: resolvedFontURL)
        precondition(resolvedFontData.prefix(4).elementsEqual("wOF2".utf8))
        let bundledURL = URL(string: "foldnote-font://bundled/space-mono-latin-400-normal.woff2")!
        let resolvedBundledURL = try store.resolveFontURL(bundledURL)
        let bundledData = try Data(contentsOf: resolvedBundledURL)
        precondition(bundledData.prefix(4).elementsEqual("wOF2".utf8), "Bundled WOFF2 resolves from the resource manifest")
        for invalidBundledURL in ["foldnote-font://bundled/missing-font.woff2", "foldnote-font://bundled/../space-mono-latin-400-normal.woff2"] {
            do { _ = try store.resolveFontURL(URL(string: invalidBundledURL)!); preconditionFailure("Unknown or traversing bundled URL accepted") } catch {}
        }
        func permissions(_ path: String) throws -> Int { (try fm.attributesOfItem(atPath: path)[.posixPermissions] as? NSNumber)?.intValue ?? -1 }
        let dataMode = try permissions(dataDir.path) & 0o777
        let fontRootMode = try permissions(dataDir.appendingPathComponent("fonts").path) & 0o777
        let fontFileMode = try permissions(resolvedFontURL.path) & 0o777
        let manifestMode = try permissions(dataDir.appendingPathComponent("fonts/manifest.json").path) & 0o777
        precondition(dataMode == 0o700 && fontRootMode == 0o700 && fontFileMode == 0o600 && manifestMode == 0o600,
                     "downloaded fonts, manifests and their directories have private permissions")
        precondition(store.exportCSS(fontSize: 15).contains("font-weight:600") && store.exportCSS(fontSize: 15).contains("15px"))
        let exportWithBrandFont = store.exportCSS(fontSize: 15, addingFontIDs: ["space-mono"])
        precondition(exportWithBrandFont.contains(".content{font-family:\"Avenir Next\"")
            && exportWithBrandFont.contains("foldnote-font://bundled/space-mono-latin-700-normal.woff2"),
                     "PNG export includes Space Mono wordmark faces without changing the selected note font")
        _ = try store.select(NoteFontSelection(fontID: "space-mono", weight: 400))
        let bundledCSS = store.exportCSS(fontSize: 15)
        precondition(bundledCSS.contains("@font-face{font-family:'Space Mono'"))
        precondition(bundledCSS.contains("foldnote-font://bundled/space-mono-latin-400-normal.woff2") && bundledCSS.contains("unicode-range:U+0000-00FF"))
        precondition(bundledCSS.contains("font-weight:700"), "Space Mono's bold face remains available for headings")
        let offline = fontStore(dataDir)
        _ = try await offline.download(family: "Test Mono")
        precondition((offline.state["fonts"] as! [[String: Any]]).contains { $0["id"] as? String == fontID })
        var duplicateCSSComponents = URLComponents(string: "https://fonts.googleapis.com/css2")!
        duplicateCSSComponents.queryItems = [URLQueryItem(name: "family", value: "JetBrains Mono:wght@400;500;600;700"), URLQueryItem(name: "display", value: "swap")]
        let duplicateCSSURL = duplicateCSSComponents.url!
        http.responses[duplicateCSSURL.absoluteString] = .init(data: Data(css.utf8), statusCode: 200, finalURL: duplicateCSSURL)
        let duplicateResult = try await store.download(family: "JetBrains Mono")
        let duplicateID = "google-" + Self.sha256(Data("jetbrains mono".utf8))
        precondition(duplicateResult["downloadedFontID"] as? String == "jetbrains-mono", "Downloaded duplicate resolves to bundled selection")
        precondition(!(store.state["fonts"] as! [[String: Any]]).contains { $0["id"] as? String == duplicateID }, "Downloaded duplicate stays hidden")
        let duplicateDirectory = dataDir.appendingPathComponent("fonts/\(duplicateID)", isDirectory: true)
        precondition(fm.fileExists(atPath: duplicateDirectory.path), "Hiding a duplicate must not delete the Google cache")
        pref.set(["fontID": duplicateID, "weight": 560], forKey: "foldnote.noteFont.selection")
        let migratedDuplicate = store.state["selection"] as! [String: Any]
        precondition(migratedDuplicate["fontID"] as? String == "jetbrains-mono" && migratedDuplicate["weight"] as? Int == 600)
        precondition((pref.dictionary(forKey: "foldnote.noteFont.selection")?["fontID"] as? String) == "jetbrains-mono")

        for badFamily in ["x;body{color:red}", "../font", "x&text=secret"] {
            do { _ = try await store.download(family: badFamily); preconditionFailure("Invalid family accepted") } catch is NoteFontError {}
        }
        for badURL in ["http://fonts.googleapis.com/css2", "https://evil.example/css2", "https://fonts.gstatic.com/evil/a.woff2"] {
            let url = URL(string: badURL)!
            precondition(!NoteFontStore.isAllowedCSSURL(url) && !NoteFontStore.isAllowedFontURL(url))
        }
        let invalidCSS = FakeFontHTTPClient()
        invalidCSS.responses[cssURL.absoluteString] = .init(data: Data("@import url(https://evil.example/x.css);".utf8), statusCode: 200, finalURL: cssURL)
        do { _ = try await fontStore(base.appendingPathComponent("invalid-css"), client: invalidCSS).download(family: "Test Mono"); preconditionFailure("Injected CSS accepted") } catch {}
        let redirect = FakeFontHTTPClient()
        redirect.responses[cssURL.absoluteString] = .init(data: Data(css.utf8), statusCode: 200, finalURL: URL(string: "https://evil.example/css2")!)
        do { _ = try await fontStore(base.appendingPathComponent("redirect"), client: redirect).download(family: "Test Mono"); preconditionFailure("Disallowed redirect accepted") } catch {}
        let large = FakeFontHTTPClient()
        large.responses[cssURL.absoluteString] = .init(data: Data(repeating: 65, count: NoteFontStore.maximumCSSBytes + 1), statusCode: 200, finalURL: cssURL)
        do { _ = try await fontStore(base.appendingPathComponent("large"), client: large).download(family: "Test Mono"); preconditionFailure("Oversized CSS accepted") } catch {}

        let symlinkRoot = dataDir.appendingPathComponent("fonts", isDirectory: true)
        let elsewhere = base.appendingPathComponent("outside", isDirectory: true)
        try fm.createDirectory(at: elsewhere, withIntermediateDirectories: true)
        try binary1.write(to: elsewhere.appendingPathComponent("outside.woff2"))
        let realRoot = dataDir.appendingPathComponent("fonts", isDirectory: true)
        let cachedDir = realRoot.appendingPathComponent(fontID, isDirectory: true)
        let targetName = String(URL(string: (cached["faces"] as! [[String: Any]])[0]["url"] as! String)!.path.dropFirst())
        let cachedFile = cachedDir.appendingPathComponent(targetName)
        try fm.removeItem(at: cachedFile)
        try fm.createSymbolicLink(at: cachedFile, withDestinationURL: elsewhere.appendingPathComponent("outside.woff2"))
        do { _ = try store.resolveFontURL(faceURL); preconditionFailure("Symlink font file accepted") } catch {}
        let bundledFile = bundleDir.appendingPathComponent("space-mono-latin-400-normal.woff2")
        try fm.removeItem(at: bundledFile)
        try fm.createSymbolicLink(at: bundledFile, withDestinationURL: elsewhere.appendingPathComponent("outside.woff2"))
        do { _ = try store.resolveFontURL(bundledURL); preconditionFailure("Symlink bundled font accepted") } catch {}
        try fm.removeItem(at: bundledFile)
        try woff2(marker: 1).write(to: bundledFile)
        try fm.removeItem(at: symlinkRoot)
        try fm.createSymbolicLink(at: symlinkRoot, withDestinationURL: elsewhere)
        do { _ = try store.resolveFontURL(faceURL); preconditionFailure("Symlink cache root accepted") } catch {}

        let failing = FakeFontHTTPClient()
        let failingStore = fontStore(base.appendingPathComponent("failed"), client: failing)
        failing.responses[cssURL.absoluteString] = .init(data: Data(css.utf8), statusCode: 200, finalURL: cssURL)
        failing.responses[first.absoluteString] = .init(data: Data("bad magic".utf8), statusCode: 200, finalURL: first)
        failing.responses[second.absoluteString] = .init(data: binary2, statusCode: 200, finalURL: second)
        do { _ = try await failingStore.download(family: "Test Mono"); preconditionFailure("Invalid WOFF2 accepted") } catch let error as NoteFontError { precondition(error.message.contains("WOFF2")) }
        precondition(!fm.fileExists(atPath: base.appendingPathComponent("failed/fonts/manifest.json").path), "Failed download must not commit manifest")
        let oversizedFont = FakeFontHTTPClient()
        oversizedFont.responses[cssURL.absoluteString] = .init(data: Data(css.utf8), statusCode: 200, finalURL: cssURL)
        oversizedFont.responses[first.absoluteString] = .init(data: Data(repeating: 0, count: NoteFontStore.maximumFontBytes + 1), statusCode: 200, finalURL: first)
        oversizedFont.responses[second.absoluteString] = .init(data: binary2, statusCode: 200, finalURL: second)
        do { _ = try await fontStore(base.appendingPathComponent("oversized-font"), client: oversizedFont).download(family: "Test Mono"); preconditionFailure("Oversized font accepted") } catch {}
        let cancel = FakeFontHTTPClient()
        cancel.responses[cssURL.absoluteString] = .init(data: Data(css.utf8), statusCode: 200, finalURL: cssURL)
        cancel.responses[second.absoluteString] = .init(data: binary2, statusCode: 200, finalURL: second)
        cancel.errorForURL[first.absoluteString] = CancellationError()
        do { _ = try await fontStore(base.appendingPathComponent("cancel"), client: cancel).download(family: "Test Mono"); preconditionFailure("Cancellation ignored") } catch is CancellationError {}
        precondition(!fm.fileExists(atPath: base.appendingPathComponent("cancel/fonts/manifest.json").path))
        let corruptDirectory = base.appendingPathComponent("corrupt")
        try fm.createDirectory(at: corruptDirectory.appendingPathComponent("fonts"), withIntermediateDirectories: true)
        try Data("invalid manifest".utf8).write(to: corruptDirectory.appendingPathComponent("fonts/manifest.json"))
        let corruptHTTP = FakeFontHTTPClient(), corruptStore = fontStore(corruptDirectory, client: corruptHTTP)
        precondition((corruptStore.state["fonts"] as! [[String: Any]]).count == 6 && corruptStore.state["warning"] != nil, "Corrupt downloads must not disable builtins")
        do { _ = try await corruptStore.download(family: "Test Mono"); preconditionFailure("Corrupt manifest was overwritten") } catch is NoteFontError {}
        precondition(corruptHTTP.requests.isEmpty, "Invalid cache must fail before network access")
        let staging = (try? fm.contentsOfDirectory(atPath: base.appendingPathComponent("cancel/fonts").path)) ?? []
        precondition(!staging.contains(where: { $0.hasPrefix(".stage-") }), "Cancellation cleans temporary assets")
        print("Note font defaults, persistence, explicit multi-face cache, offline use, validation, and atomic-failure checks passed")
    }

    private static func sha256(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }

    private static func woff2(marker: UInt8) -> Data {
        var data = Data(repeating: 0, count: 49)
        data.replaceSubrange(0..<4, with: Data("wOF2".utf8))
        data[5] = 1 // TrueType flavor 0x00010000
        data[11] = 49 // declared length includes the complete 48-byte header
        data[13] = 1 // table count
        data[19] = 100 // total sfnt size
        data[23] = 1 // compressed payload size
        data[25] = 1 // major version, not a metadata offset
        data[48] = marker
        return data
    }

}
