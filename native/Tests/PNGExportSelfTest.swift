import AppKit

@main struct PNGExportSelfTest {
    @MainActor static func main() async throws {
        let service = PNGExportService()
        let request = NoteImageRequest(html: "<h1>Export check</h1><p>Visible synthetic note text.</p><pre><code>let answer = 42</code></pre>", title: "Synthetic note", backgroundStart: "#dce8ff", backgroundEnd: "#f8dff1", paper: "#ffffff", text: "#202534", accent: "#496de8", width: 760, padding: 48)
        let png = try await service.render(request: request)
        precondition(Array(png.prefix(8)) == [137, 80, 78, 71, 13, 10, 26, 10], "output must have a PNG signature")
        guard let bitmap = NSBitmapImageRep(data: png) else { preconditionFailure("PNG could not be decoded") }
        precondition(bitmap.pixelsWide >= 660 && bitmap.pixelsHigh > 180 && bitmap.pixelsHigh < 6_000)
        let short = try await service.render(request: NoteImageRequest(html: "<p>Short</p>", title: "Short", backgroundStart: "#000000", backgroundEnd: "#ffffff", paper: "#ffffff", text: "#000000", accent: "#ffffff", width: 760, padding: 48))
        let shortBitmap = NSBitmapImageRep(data: short)!
        precondition(shortBitmap.pixelsHigh < 500, "short notes must be cropped to content")
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
