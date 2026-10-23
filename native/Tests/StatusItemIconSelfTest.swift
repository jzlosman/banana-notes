import AppKit
@testable import BananaNotesCore

@main
struct StatusItemIconSelfTest {
    @MainActor
    static func main() throws {
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

            func alphaAtDesignPoint(_ x: Double, _ y: Double) -> CGFloat {
                let pixelX = min(dimension - 1, max(0, Int((x * Double(scale)).rounded())))
                let pixelY = min(dimension - 1, max(0, Int((y * Double(scale)).rounded())))
                return bitmap.colorAt(x: pixelX, y: pixelY)!.alphaComponent
            }
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
            precondition(covered > total / 5 && covered < total * 3 / 4,
                         "menu glyph should leave transparent space at \(scale)x")
            precondition(solid > total / 20, "menu glyph interior should render solidly at \(scale)x")
            precondition(alphaAtDesignPoint(4, 4) > 0.9,
                         "the folded corner must be filled at the upright top-left")
            precondition(alphaAtDesignPoint(13, 12.5) > 0.9,
                         "the peel curve must fill the upright bottom-right")
            precondition(alphaAtDesignPoint(0.5, 0.5) == 0, "outside the menu glyph must remain transparent")
            precondition(alphaAtDesignPoint(17.5, 17.5) == 0, "outside the menu glyph must remain transparent")

            if CommandLine.arguments.count > 1 {
                let path = URL(fileURLWithPath: CommandLine.arguments[1]).appendingPathComponent("status-icon-\(scale)x.png")
                try bitmap.representation(using: .png, properties: [:])!.write(to: path)
            }
        }
        print("Native status icon checks passed (upright glyph, template, 18pt size and accessibility label at 1x/2x)")
    }
}
