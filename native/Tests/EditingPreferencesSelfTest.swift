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
        for invalid: Any in [true, "18", 0, 33, 14.5, Double.nan] {
            do { try font.save(invalid); preconditionFailure("invalid font size accepted") } catch is StoreError {}
            precondition(font.size == 21)
        }
        defaults.set(-1, forKey: "editorFontSize"); precondition(font.size == 10)
        defaults.set(true, forKey: "editorFontSize"); precondition(font.size == 15)

        let board = NSPasteboard(name: .init("FoldnoteTest-\(UUID().uuidString)"))
        defer { board.releaseGlobally() }
        let markdown = "# Heading\n\n**Bold**"
        try ClipboardContent(["text": markdown, "markdown": markdown]).write(to: board)
        precondition(board.string(forType: .string) == markdown)
        precondition(board.string(forType: ClipboardContent.markdownType) == markdown)
        precondition(board.string(forType: .html) == nil)
        try ClipboardContent(["text": "Heading\nBold", "html": "<h1>Heading</h1><p><strong>Bold</strong></p>"]).write(to: board)
        precondition(board.string(forType: .html)?.contains("<strong>") == true)
        precondition(board.string(forType: .string) == "Heading\nBold")
        precondition(board.string(forType: ClipboardContent.markdownType) == nil)
        try ClipboardContent(["text": "<h1>Heading</h1>"]).write(to: board)
        precondition(board.string(forType: .html) == nil, "HTML source must paste as code, not rendered content")
        do { _ = try ClipboardContent(["text": true]); preconditionFailure("invalid clipboard accepted") } catch is StoreError {}
        precondition(board.string(forType: .string) == "<h1>Heading</h1>")
        print("Native editing checks passed (font persistence, bounds, clipboard formats, stale-flavor removal)")
    }
}
