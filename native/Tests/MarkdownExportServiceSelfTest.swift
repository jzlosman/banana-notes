import Foundation
@testable import BananaNotesCore

@main
struct MarkdownExportServiceSelfTest {
    static func main() throws {
        let notes = try [
            note(id: "first-id", title: "First", markdown: "# One"),
            note(id: "first-id-2", title: "first", markdown: "# Two"),
            note(id: "third-id", title: "First (2)", markdown: "# Three"),
            note(id: "folder/name?", title: " ../bad:name? ", markdown: "# Four"),
            note(id: "untitled", title: "   ", markdown: "# Five")
        ]
        let plan = MarkdownExportService.plan(notes, avoiding: ["FIRST.MD", "First (2).md"])
        precondition(plan.map(\.filename) == ["First (3).md", "first (4).md", "First (2) (2).md", "bad-name.md", "untitled.md"], "unexpected export names: \(plan.map(\.filename))")
        precondition(plan.map(\.markdown) == notes.map(\.markdown), "planning preserves source Markdown byte-for-byte")
        precondition(MarkdownExportService.sanitizedBase("/..\\") == "note")
        print("Markdown export planning checks passed (sanitization, case-insensitive collisions, existing files, source preservation)")
    }

    private static func note(id: String, title: String, markdown: String) throws -> MarkdownExportNote {
        let json = try JSONSerialization.data(withJSONObject: ["id": id, "title": title, "markdown": markdown])
        return try JSONDecoder().decode(MarkdownExportNote.self, from: json)
    }
}
