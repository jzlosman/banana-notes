import Foundation

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
        let suite = "FoldnoteFontTest-\(UUID().uuidString)"
        let pref = UserDefaults(suiteName: suite)!
        defer { pref.removePersistentDomain(forName: suite) }
        let http = FakeFontHTTPClient()
        let dataDir = base.appendingPathComponent("not-created", isDirectory: true)
        let store = NoteFontStore(directory: dataDir, defaults: pref, client: http)
        precondition(!fm.fileExists(atPath: dataDir.path), "Reading builtins must not create app data")
        let initial = store.state
        let initialFonts = initial["fonts"] as! [[String: Any]]
        precondition((initial["selection"] as! [String: Any])["fontID"] as? String == "sf-mono")
        precondition(initialFonts.map { $0["id"] as! String } == ["sf-mono", "system", "avenir", "georgia"])
        precondition(initialFonts[0]["family"] as? String == "ui-monospace, \"SFMono-Regular\", Menlo, monospace")
        precondition(initialFonts.last!["weights"] as! [Int] == [400])
        let selected = try store.select(["fontID": "avenir", "weight": 600])
        precondition(selected["selection"] as? [String: Any] != nil)
        let reload = NoteFontStore(directory: dataDir, defaults: pref, client: http)
        precondition((reload.state["selection"] as! [String: Any])["fontID"] as? String == "avenir")
        for invalid in [["fontID": "georgia", "weight": 700], ["fontID": "unknown", "weight": 400], ["fontID": "sf-mono", "weight": true]] as [Any] {
            do { _ = try store.select(invalid); preconditionFailure("Invalid font selection accepted") } catch is NoteFontError {}
        }
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
        do { _ = try store.select(["fontID": fontID, "weight": 600]); preconditionFailure("Unsupported Google weight accepted") } catch is NoteFontError {}
        precondition(Set(http.requests).count == 3, "Deduplicate shared font URLs")
        let faceURL = URL(string: (cached["faces"] as! [[String: Any]])[0]["url"] as! String)!
        let resolvedFontData = try Data(contentsOf: store.resolveFontURL(faceURL))
        precondition(resolvedFontData.prefix(4).elementsEqual("wOF2".utf8))
        precondition(store.exportCSS(fontSize: 15).contains("font-weight:600") && store.exportCSS(fontSize: 15).contains("15px"))
        let offline = NoteFontStore(directory: dataDir, defaults: pref, client: FakeFontHTTPClient())
        _ = try await offline.download(family: "Test Mono")
        precondition((offline.state["fonts"] as! [[String: Any]]).contains { $0["id"] as? String == fontID })

        for badFamily in ["x;body{color:red}", "../font", "x&text=secret"] {
            do { _ = try await store.download(family: badFamily); preconditionFailure("Invalid family accepted") } catch is NoteFontError {}
        }
        for badURL in ["http://fonts.googleapis.com/css2", "https://evil.example/css2", "https://fonts.gstatic.com/evil/a.woff2"] {
            let url = URL(string: badURL)!
            precondition(!NoteFontStore.isAllowedCSSURL(url) && !NoteFontStore.isAllowedFontURL(url))
        }
        let invalidCSS = FakeFontHTTPClient()
        invalidCSS.responses[cssURL.absoluteString] = .init(data: Data("@import url(https://evil.example/x.css);".utf8), statusCode: 200, finalURL: cssURL)
        do { _ = try await NoteFontStore(directory: base.appendingPathComponent("invalid-css"), defaults: pref, client: invalidCSS).download(family: "Test Mono"); preconditionFailure("Injected CSS accepted") } catch {}
        let redirect = FakeFontHTTPClient()
        redirect.responses[cssURL.absoluteString] = .init(data: Data(css.utf8), statusCode: 200, finalURL: URL(string: "https://evil.example/css2")!)
        do { _ = try await NoteFontStore(directory: base.appendingPathComponent("redirect"), defaults: pref, client: redirect).download(family: "Test Mono"); preconditionFailure("Disallowed redirect accepted") } catch {}
        let large = FakeFontHTTPClient()
        large.responses[cssURL.absoluteString] = .init(data: Data(repeating: 65, count: NoteFontStore.maximumCSSBytes + 1), statusCode: 200, finalURL: cssURL)
        do { _ = try await NoteFontStore(directory: base.appendingPathComponent("large"), defaults: pref, client: large).download(family: "Test Mono"); preconditionFailure("Oversized CSS accepted") } catch {}

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
        try fm.removeItem(at: symlinkRoot)
        try fm.createSymbolicLink(at: symlinkRoot, withDestinationURL: elsewhere)
        do { _ = try store.resolveFontURL(faceURL); preconditionFailure("Symlink cache root accepted") } catch {}

        let failing = FakeFontHTTPClient()
        let failingStore = NoteFontStore(directory: base.appendingPathComponent("failed"), defaults: pref, client: failing)
        failing.responses[cssURL.absoluteString] = .init(data: Data(css.utf8), statusCode: 200, finalURL: cssURL)
        failing.responses[first.absoluteString] = .init(data: Data("bad magic".utf8), statusCode: 200, finalURL: first)
        failing.responses[second.absoluteString] = .init(data: binary2, statusCode: 200, finalURL: second)
        do { _ = try await failingStore.download(family: "Test Mono"); preconditionFailure("Invalid WOFF2 accepted") } catch let error as NoteFontError { precondition(error.message.contains("WOFF2")) }
        precondition(!fm.fileExists(atPath: base.appendingPathComponent("failed/fonts/manifest.json").path), "Failed download must not commit manifest")
        let oversizedFont = FakeFontHTTPClient()
        oversizedFont.responses[cssURL.absoluteString] = .init(data: Data(css.utf8), statusCode: 200, finalURL: cssURL)
        oversizedFont.responses[first.absoluteString] = .init(data: Data(repeating: 0, count: NoteFontStore.maximumFontBytes + 1), statusCode: 200, finalURL: first)
        oversizedFont.responses[second.absoluteString] = .init(data: binary2, statusCode: 200, finalURL: second)
        do { _ = try await NoteFontStore(directory: base.appendingPathComponent("oversized-font"), defaults: pref, client: oversizedFont).download(family: "Test Mono"); preconditionFailure("Oversized font accepted") } catch {}
        let cancel = FakeFontHTTPClient()
        cancel.responses[cssURL.absoluteString] = .init(data: Data(css.utf8), statusCode: 200, finalURL: cssURL)
        cancel.responses[second.absoluteString] = .init(data: binary2, statusCode: 200, finalURL: second)
        cancel.errorForURL[first.absoluteString] = CancellationError()
        do { _ = try await NoteFontStore(directory: base.appendingPathComponent("cancel"), defaults: pref, client: cancel).download(family: "Test Mono"); preconditionFailure("Cancellation ignored") } catch is CancellationError {}
        precondition(!fm.fileExists(atPath: base.appendingPathComponent("cancel/fonts/manifest.json").path))
        let corruptDirectory = base.appendingPathComponent("corrupt")
        try fm.createDirectory(at: corruptDirectory.appendingPathComponent("fonts"), withIntermediateDirectories: true)
        try Data("invalid manifest".utf8).write(to: corruptDirectory.appendingPathComponent("fonts/manifest.json"))
        let corruptHTTP = FakeFontHTTPClient(), corruptStore = NoteFontStore(directory: corruptDirectory, defaults: pref, client: corruptHTTP)
        precondition((corruptStore.state["fonts"] as! [[String: Any]]).count == 4 && corruptStore.state["warning"] != nil, "Corrupt downloads must not disable builtins")
        do { _ = try await corruptStore.download(family: "Test Mono"); preconditionFailure("Corrupt manifest was overwritten") } catch is NoteFontError {}
        precondition(corruptHTTP.requests.isEmpty, "Invalid cache must fail before network access")
        let staging = (try? fm.contentsOfDirectory(atPath: base.appendingPathComponent("cancel/fonts").path)) ?? []
        precondition(!staging.contains(where: { $0.hasPrefix(".stage-") }), "Cancellation cleans temporary assets")
        print("Note font defaults, persistence, explicit multi-face cache, offline use, validation, and atomic-failure checks passed")
    }

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
