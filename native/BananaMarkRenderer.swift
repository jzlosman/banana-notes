import AppKit

/// AppKit drawing adapter for the pure design geometry in `BananaMark`.
enum BananaMarkRenderer {
    static func drawNote(in bounds: NSRect, outlined: Bool) {
        draw(layers: outlined ? BananaMark.standaloneMarkLayers : BananaMark.noteLayers,
             in: bounds, designSize: BananaMark.noteSize, rotated: true)
    }

    static func drawMenuGlyph(in bounds: NSRect) {
        draw(layers: BananaMark.menuBarLayers, in: bounds, designSize: BananaMark.menuBarCanvasSize, rotated: false)
    }

    static func drawAppIcon(in bounds: NSRect) {
        let canvasScale = bounds.width / CGFloat(BananaMark.iconCanvasSize)
        let tileScale = canvasScale * CGFloat(BananaMark.iconTileSize / BananaMark.noteSize)
        let tileOrigin = CGFloat(BananaMark.iconTileOrigin) * canvasScale
        let tileSize = CGFloat(BananaMark.iconTileSize) * canvasScale
        let tile = NSRect(x: bounds.minX + tileOrigin, y: bounds.minY + tileOrigin, width: tileSize, height: tileSize)
        let radius = CGFloat(BananaMark.iconTileRadius) * tileScale
        let tilePath = NSBezierPath(roundedRect: tile, xRadius: radius, yRadius: radius)
        if let context = NSGraphicsContext.current?.cgContext {
            context.saveGState()
            context.setShadow(offset: CGSize(width: 0, height: -CGFloat(BananaMark.iconShadowOffset) * canvasScale),
                              blur: CGFloat(BananaMark.iconShadowBlur) * canvasScale,
                              color: NSColor.black.withAlphaComponent(BananaMark.iconShadowOpacity).cgColor)
            color(BananaMark.Color.cocoa).setFill()
            tilePath.fill()
            context.restoreGState()
        } else {
            color(BananaMark.Color.cocoa).setFill()
            tilePath.fill()
        }
        drawNote(in: tile, outlined: false)
    }

    private static func draw(layers: [BananaMark.Layer], in bounds: NSRect, designSize: Double, rotated: Bool) {
        let transform: (BananaMark.Point) -> NSPoint = { source in
            let point = rotated ? BananaMark.rotated(source) : source
            return NSPoint(x: bounds.minX + CGFloat(point.x / designSize) * bounds.width,
                           y: bounds.maxY - CGFloat(point.y / designSize) * bounds.height)
        }
        for layer in layers {
            let path = bezierPath(layer.commands, map: transform)
            path.lineJoinStyle = .round
            path.lineCapStyle = .round
            path.lineWidth = CGFloat(layer.strokeWidth) * min(bounds.width, bounds.height) / CGFloat(designSize)
            if let fill = layer.fill {
                color(fill).setFill()
                path.fill()
            }
            if let stroke = layer.stroke {
                color(stroke).setStroke()
                path.stroke()
            }
        }
    }

    private static func bezierPath(_ commands: [BananaMark.Command], map: (BananaMark.Point) -> NSPoint) -> NSBezierPath {
        let path = NSBezierPath()
        var current = BananaMark.Point(x: 0, y: 0)
        for command in commands {
            switch command {
            case .move(let point):
                path.move(to: map(point)); current = point
            case .line(let point):
                path.line(to: map(point)); current = point
            case .quad(let control, let end):
                let c1 = BananaMark.Point(x: current.x + (control.x - current.x) * 2 / 3,
                                          y: current.y + (control.y - current.y) * 2 / 3)
                let c2 = BananaMark.Point(x: end.x + (control.x - end.x) * 2 / 3,
                                          y: end.y + (control.y - end.y) * 2 / 3)
                path.curve(to: map(end), controlPoint1: map(c1), controlPoint2: map(c2))
                current = end
            case .cubic(let control1, let control2, let end):
                path.curve(to: map(end), controlPoint1: map(control1), controlPoint2: map(control2))
                current = end
            case .close:
                path.close()
            }
        }
        return path
    }

    private static func color(_ hex: String) -> NSColor {
        let value = UInt32(hex.dropFirst(), radix: 16) ?? 0
        return NSColor(calibratedRed: CGFloat((value >> 16) & 0xff) / 255,
                       green: CGFloat((value >> 8) & 0xff) / 255,
                       blue: CGFloat(value & 0xff) / 255, alpha: 1)
    }
}
