import AppKit

struct ClipboardContent {
    let text: String
    let html: String?
    let markdown: String?
    static let markdownType = NSPasteboard.PasteboardType("net.daringfireball.markdown")

    init(_ fields: [String: Any]) throws {
        guard let text = fields["text"] as? String else { throw StoreError(message: "Clipboard text is required.") }
        for key in ["html", "markdown"] where fields[key] != nil {
            guard fields[key] is String else { throw StoreError(message: "Clipboard \(key) must be text.") }
        }
        self.text = text; self.html = fields["html"] as? String; self.markdown = fields["markdown"] as? String
        guard text.utf8.count + (html?.utf8.count ?? 0) + (markdown?.utf8.count ?? 0) <= 10_000_000 else {
            throw StoreError(message: "This clipboard content is too large.")
        }
    }

    @MainActor
    func write(to pasteboard: NSPasteboard = .general) throws {
        let item = NSPasteboardItem()
        item.setString(text, forType: .string)
        if let html { item.setString(html, forType: .html) }
        if let markdown { item.setString(markdown, forType: Self.markdownType) }
        pasteboard.clearContents()
        guard pasteboard.writeObjects([item]) else { throw StoreError(message: "The clipboard could not be written. Try copying again.") }
    }
}
