import AppKit

@main
struct StatusItemIconSelfTest {
    @MainActor
    static func main() {
        _ = NSApplication.shared
        let image = StatusItemIcon.make()
        precondition(image.isTemplate, "macOS must own menu-bar tinting")
        precondition(image.size == NSSize(width: 18, height: 18))
        precondition(image.accessibilityDescription == "Banana Notes")

        for scale in [1, 2] {
            let dimension = 18 * scale
            let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: dimension, pixelsHigh: dimension,
                                         bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                         isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
            let context = NSGraphicsContext(bitmapImageRep: bitmap)!
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = context
            context.cgContext.scaleBy(x: CGFloat(scale), y: CGFloat(scale))
            image.draw(in: NSRect(x: 0, y: 0, width: 18, height: 18))
            NSGraphicsContext.restoreGraphicsState()

            var covered = 0
            var solid = 0
            for y in 0..<dimension {
                for x in 0..<dimension {
                    let alpha = bitmap.colorAt(x: x, y: y)!.alphaComponent
                    if alpha > 0.05 { covered += 1 }
                    if alpha > 0.99 { solid += 1 }
                }
            }
            let total = dimension * dimension
            precondition(covered > total / 5 && covered < total * 3 / 4, "banana coverage should be substantial but leave transparent space at \(scale)x")
            precondition(solid > total / 20, "banana interior should render solidly at \(scale)x; got \(solid) solid pixels")
            precondition(bitmap.colorAt(x: 0, y: 0)!.alphaComponent == 0, "outside the mark must remain transparent")
            precondition(bitmap.colorAt(x: dimension - 1, y: dimension - 1)!.alphaComponent == 0, "outside the mark must remain transparent")

            if CommandLine.arguments.count > 1 {
                let path = URL(fileURLWithPath: CommandLine.arguments[1]).appendingPathComponent("status-icon-\(scale)x.png")
                try! bitmap.representation(using: .png, properties: [:])!.write(to: path)
            }
        }
        print("Native status icon checks passed (template, 18pt sizing, Banana Notes label, curved silhouette at 1x/2x)")
    }
}
