import AppKit

@main
struct EditingPreferencesSelfTest {
    @MainActor
    static func main() throws {
        let suite = "FoldnoteEditing-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let font = FontSizePreferences(defaults: defaults)
        precondition(font.size == 15)
        try font.save(21)
        precondition(FontSizePreferences(defaults: defaults).size == 21)
        for invalid in [0, 33] {
            do { try font.save(invalid); preconditionFailure("invalid font size accepted") } catch is StoreError {}
            precondition(font.size == 21)
        }
        defaults.set(-1, forKey: "editorFontSize"); precondition(font.size == 10)
        defaults.set(true, forKey: "editorFontSize"); precondition(font.size == 15)

        let board = NSPasteboard(name: .init("FoldnoteTest-\(UUID().uuidString)"))
        defer { board.releaseGlobally() }
        let markdown = "# Heading\n\n**Bold**"
        try ClipboardContent(ClipboardPayload(text: markdown, markdown: markdown)).write(to: board)
        precondition(board.string(forType: .string) == markdown)
        precondition(board.string(forType: ClipboardContent.markdownType) == markdown)
        precondition(board.string(forType: .html) == nil)
        try ClipboardContent(ClipboardPayload(text: "Heading\nBold", html: "<h1>Heading</h1><p><strong>Bold</strong></p>")).write(to: board)
        precondition(board.string(forType: .html)?.contains("<strong>") == true)
        precondition(board.string(forType: .string) == "Heading\nBold")
        precondition(board.string(forType: ClipboardContent.markdownType) == nil)
        try ClipboardContent(ClipboardPayload(text: "<h1>Heading</h1>")).write(to: board)
        precondition(board.string(forType: .html) == nil, "HTML source must paste as code, not rendered content")
        do {
            let bytes = try JSONSerialization.data(withJSONObject: ["text": true])
            _ = try JSONDecoder().decode(ClipboardPayload.self, from: bytes)
            preconditionFailure("invalid clipboard accepted")
        } catch {}
        precondition(board.string(forType: .string) == "<h1>Heading</h1>")
        print("Native editing checks passed (font persistence, bounds, clipboard formats, stale-flavor removal)")
    }
}
