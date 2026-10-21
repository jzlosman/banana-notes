import AppKit

/// An integer-aligned template glyph, drawn at the display's backing scale.
/// Avoid thin SF-symbol details or resizing a raster image in the menu bar.
enum StatusItemIcon {
    static func make() -> NSImage {
        let image = NSImage(size: NSSize(width: 18, height: 18), flipped: false) { _ in
            NSColor.black.setFill()
            let page = NSBezierPath()
            page.windingRule = .evenOdd
            page.move(to: NSPoint(x: 3, y: 1))
            page.line(to: NSPoint(x: 15, y: 1))
            page.line(to: NSPoint(x: 15, y: 12))
            page.line(to: NSPoint(x: 10, y: 17))
            page.line(to: NSPoint(x: 3, y: 17))
            page.close()
            page.move(to: NSPoint(x: 5, y: 3))
            page.line(to: NSPoint(x: 13, y: 3))
            page.line(to: NSPoint(x: 13, y: 11))
            page.line(to: NSPoint(x: 9, y: 15))
            page.line(to: NSPoint(x: 5, y: 15))
            page.close()
            page.fill()

            let fold = NSBezierPath()
            fold.move(to: NSPoint(x: 10, y: 17))
            fold.line(to: NSPoint(x: 10, y: 12))
            fold.line(to: NSPoint(x: 15, y: 12))
            fold.close()
            fold.fill()
            NSRect(x: 6, y: 6, width: 6, height: 2).fill()
            NSRect(x: 6, y: 10, width: 3, height: 2).fill()
            return true
        }
        image.isTemplate = true
        image.accessibilityDescription = "Foldnote"
        return image
    }
}
