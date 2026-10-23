import AppKit
import WebKit

@main struct PNGExportSelfTest {
    @MainActor static func main() async throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let dataPath = ProcessInfo.processInfo.environment["BANANA_NOTES_DATA_DIR"]
            ?? FileManager.default.temporaryDirectory.appendingPathComponent("BananaNotesPNGExport-\(UUID().uuidString)").path
        let suite = "BananaNotesPNGExport-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let fonts = NoteFontStore(directory: URL(fileURLWithPath: dataPath, isDirectory: true), defaults: defaults,
                                  bundledFontsDirectory: root.appendingPathComponent("web/dist/fonts", isDirectory: true))
        let service = PNGExportService(configurationFactory: {
            let configuration = WKWebViewConfiguration()
            configuration.setURLSchemeHandler(FontSchemeHandler(store: fonts), forURLScheme: "foldnote-font")
            return configuration
        }, fontCSS: { fonts.exportCSS(fontSize: 15, addingFontIDs: ["space-mono"]) })
        let request = NoteImageRequest(html: "<h1>Synthetic note</h1><p>Visible synthetic note text.</p><pre><code>let answer = 42</code></pre>", title: "Synthetic note", backgroundStart: "#dce8ff", backgroundEnd: "#f8dff1", paper: "#ffffff", text: "#202534", accent: "#496de8", width: 760, padding: 48)
        let document = service.htmlDocument(request)
        precondition(!document.contains("<h1>Synthetic note</h1>") && document.contains("Visible synthetic note text."),
                     "a leading H1 equal to the card title should render once")
        precondition(document.contains("class=\"signature\"") && document.contains("#FBE122")
            && document.contains("viewBox=\"5.5 7.25 33.5 33.5\"") && document.contains("stroke=\"#2E1D12\"")
            && document.contains("class=\"banana\">banana</span>") && document.contains("class=\"notes\">notes</span>")
            && document.contains("font-family:'Space Mono'") && document.contains("font-weight:700") && document.contains("font-weight:400"),
                     "marked export uses the standalone mark and the two-weight lowercase Space Mono wordmark")
        let unmarked = service.htmlDocument(NoteImageRequest(html: request.html, title: request.title,
            backgroundStart: request.backgroundStart, backgroundEnd: request.backgroundEnd, paper: request.paper,
            text: request.text, accent: request.accent, width: request.width, padding: request.padding, showMark: false))
        precondition(!unmarked.contains("class=\"signature\""), "signature remains optional")
        let png = try await service.render(request: request)
        if let previewPath = ProcessInfo.processInfo.environment["BANANA_NOTES_EXPORT_PREVIEW"] {
            try png.write(to: URL(fileURLWithPath: previewPath), options: .atomic)
        }
        precondition(Array(png.prefix(8)) == [137, 80, 78, 71, 13, 10, 26, 10], "output must have a PNG signature")
        guard let bitmap = NSBitmapImageRep(data: png) else { preconditionFailure("PNG could not be decoded") }
        precondition(bitmap.pixelsWide >= 660 && bitmap.pixelsHigh > 180 && bitmap.pixelsHigh < 6_000)
        let unmarkedPNG = try await service.render(request: NoteImageRequest(html: request.html, title: request.title,
            backgroundStart: request.backgroundStart, backgroundEnd: request.backgroundEnd, paper: request.paper,
            text: request.text, accent: request.accent, width: request.width, padding: request.padding, showMark: false))
        guard let unmarkedBitmap = NSBitmapImageRep(data: unmarkedPNG),
              unmarkedBitmap.pixelsWide == bitmap.pixelsWide, unmarkedBitmap.pixelsHigh == bitmap.pixelsHigh else {
            preconditionFailure("mark does not alter exported image dimensions")
        }
        // The signature is painted only in the bottom gradient gutter, never on the card.
        let scale = Double(bitmap.pixelsWide) / Double(request.width)
        let gutterRows = Int(Double(request.padding) * scale)
        var markedGutterPixels = 0, markedCardPixels = 0
        for x in 0..<bitmap.pixelsWide {
            for y in 0..<bitmap.pixelsHigh {
                guard let markedColor = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB),
                      let plainColor = unmarkedBitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else { continue }
                let differs = abs(markedColor.redComponent - plainColor.redComponent) > 0.2
                    || abs(markedColor.greenComponent - plainColor.greenComponent) > 0.2
                    || abs(markedColor.blueComponent - plainColor.blueComponent) > 0.2
                guard differs else { continue }
                if y >= bitmap.pixelsHigh - gutterRows { markedGutterPixels += 1 } else { markedCardPixels += 1 }
            }
        }
        precondition(markedCardPixels == 0, "the signature must not touch the card or upper gutter")
        precondition(markedGutterPixels > 0, "the Banana Notes signature is painted in the bottom gutter")
        let short = try await service.render(request: NoteImageRequest(html: "<p>Short</p>", title: "Short", backgroundStart: "#000000", backgroundEnd: "#ffffff", paper: "#ffffff", text: "#000000", accent: "#ffffff", width: 760, padding: 48))
        let shortBitmap = NSBitmapImageRep(data: short)!
        precondition(shortBitmap.pixelsHigh < 500, "short notes must be cropped to content (got \(shortBitmap.pixelsHigh)px)")
        _ = try await service.render(request: NoteImageRequest(html: #"<p><a href="https://example.com">https link</a> <a href="mailto:test@example.com">mail</a></p>"#, title: "Links", backgroundStart: "#000000", backgroundEnd: "#ffffff", paper: "#ffffff", text: "#000000", accent: "#ffffff", width: 760, padding: 48))
        var colors = Set<String>()
        for y in stride(from: 0, to: bitmap.pixelsHigh, by: max(1, bitmap.pixelsHigh / 30)) {
            for x in stride(from: 0, to: bitmap.pixelsWide, by: max(1, bitmap.pixelsWide / 30)) {
                if let c = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) { colors.insert("\(c.redComponent),\(c.greenComponent),\(c.blueComponent)") }
            }
        }
        precondition(colors.count > 3, "render should contain nonblank card, text, and gradient pixels")
        let invalid = [
            #"<p><a href="javascript:alert(1)">bad</a></p>"#,
            #"<img src="https://example.invalid/a.png">"#,
            #"<img src="data:image/png;base64,not-base64">"#,
            #"<p onclick="alert(1)">event</p>"#,
            #"<script>alert(1)</script>"#,
            #"<meta http-equiv="refresh" content="0;url=https://example.com">"#,
        ]
        for html in invalid {
            do {
                _ = try await service.render(request: NoteImageRequest(html: html, title: "Bad", backgroundStart: "#000000", backgroundEnd: "#ffffff", paper: "#ffffff", text: "#000000", accent: "#ffffff", width: 760, padding: 48))
                preconditionFailure("unsafe HTML was accepted: \\(html)")
            } catch is PNGExportError {}
        }
        do {
            _ = try await service.render(request: NoteImageRequest(html: "<p>safe</p>", title: "Bad bounds", backgroundStart: "#000000", backgroundEnd: "#ffffff", paper: "#ffffff", text: "#000000", accent: "#ffffff", width: 480, padding: 240))
            preconditionFailure("invalid width/padding bounds were accepted")
        } catch is PNGExportError {}
        let longHTML = "<p>" + String(repeating: "Long note content. ", count: 1200) + "</p>"
        do {
            _ = try await service.render(request: NoteImageRequest(html: longHTML, title: "Long", backgroundStart: "#000000", backgroundEnd: "#ffffff", paper: "#ffffff", text: "#000000", accent: "#ffffff", width: 760, padding: 48))
            preconditionFailure("oversized note should be rejected")
        } catch PNGExportError.contentTooLarge {}
        print("PNG export checks passed (signature, dimensions, visible rendering, unsafe HTML, long-note bounds)")
    }
}
