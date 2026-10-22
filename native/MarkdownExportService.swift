import Foundation

struct PlannedMarkdownExport: Equatable {
    let filename: String
    let markdown: String
}

/// Deterministic filename planning stays independent of save panels and disk writes.
enum MarkdownExportService {
    static func plan(_ notes: [MarkdownExportNote], avoiding existingNames: Set<String> = []) -> [PlannedMarkdownExport] {
        var used = Set(existingNames.map(normalizedName))
        return notes.map { note in
            let title = note.title?.trimmingCharacters(in: .whitespacesAndNewlines)
            let source = title.flatMap { $0.isEmpty ? nil : $0 } ?? note.id
            let base = sanitizedBase(source)
            var filename = base + ".md"
            var suffix = 2
            while !used.insert(normalizedName(filename)).inserted {
                filename = "\(base) (\(suffix)).md"
                suffix += 1
            }
            return PlannedMarkdownExport(filename: filename, markdown: note.markdown)
        }
    }

    static func sanitizedBase(_ value: String) -> String {
        let invalid = CharacterSet(charactersIn: "/\\:?%*|\"<>\n\r\0")
        let joined = value.components(separatedBy: invalid).filter { !$0.isEmpty }.joined(separator: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: ".-")))
        return String((joined.isEmpty ? "note" : joined).prefix(120))
    }

    private static func normalizedName(_ value: String) -> String {
        value.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
    }
}
