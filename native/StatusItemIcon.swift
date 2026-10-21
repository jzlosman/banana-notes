import AppKit

/// An 18pt vector template glyph, drawn at the display's backing scale.
/// Curved edges antialias natively; the menu bar never resizes a raster image.
enum StatusItemIcon {
    static func make() -> NSImage {
        let image = NSImage(size: NSSize(width: 18, height: 18), flipped: false) { bounds in
            BananaMark.draw(in: bounds, color: .black)
            return true
        }
        image.isTemplate = true
        image.accessibilityDescription = "Banana Notes"
        return image
    }
}
