import AppKit

struct ClipboardContent {
    let text: String
    let html: String?
    let markdown: String?
    static let markdownType = NSPasteboard.PasteboardType("net.daringfireball.markdown")

    init(_ payload: ClipboardPayload) {
        text = payload.text
        html = payload.html
        markdown = payload.markdown
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
