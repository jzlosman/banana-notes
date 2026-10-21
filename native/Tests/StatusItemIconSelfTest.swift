import AppKit

@main
struct StatusItemIconSelfTest {
    @MainActor
    static func main() {
        _ = NSApplication.shared
        let image = StatusItemIcon.make()
        precondition(image.isTemplate, "macOS must own white/dark menu-bar tinting")
        precondition(image.size == NSSize(width: 18, height: 18))
        for scale in [1, 2] {
            let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 18 * scale, pixelsHigh: 18 * scale,
                                         bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                         isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
            let context = NSGraphicsContext(bitmapImageRep: bitmap)!
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = context
            context.cgContext.scaleBy(x: CGFloat(scale), y: CGFloat(scale))
            image.draw(in: NSRect(x: 0, y: 0, width: 18, height: 18))
            NSGraphicsContext.restoreGraphicsState()
            // Horizontal/vertical strokes are solid even at 1x, with no fractional
            // resize softening. Diagonal-fold antialiasing is intentionally allowed.
            for x in (3 * scale)..<(5 * scale) {
                precondition(bitmap.colorAt(x: x, y: 8 * scale)!.alphaComponent > 0.99,
                             "the page edge must be fully opaque at \(scale)x")
            }
            precondition(bitmap.colorAt(x: 0, y: 8 * scale)!.alphaComponent == 0)
            if CommandLine.arguments.count > 1 {
                let path = URL(fileURLWithPath: CommandLine.arguments[1]).appendingPathComponent("status-icon-\(scale)x.png")
                try! bitmap.representation(using: .png, properties: [:])!.write(to: path)
            }
        }
        print("Native status icon checks passed (template, integer sizing, opaque edges at 1x/2x)")
    }
}
