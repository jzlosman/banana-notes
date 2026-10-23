import Foundation

/// Pure design geometry and colours for every Banana Notes brand rendering.
/// Coordinates use a top-left origin, positive y down, and the approved 48-unit grid.
enum BananaMark {
    struct Point: Equatable {
        let x: Double
        let y: Double
    }

    enum Command: Equatable {
        case move(Point)
        case line(Point)
        case quad(control: Point, end: Point)
        case cubic(control1: Point, control2: Point, end: Point)
        case close
    }

    struct Layer: Equatable {
        let commands: [Command]
        let fill: String?
        let stroke: String?
        let strokeWidth: Double
    }

    enum Color {
        static let banana = "#FBE122"
        static let peel = "#D9A00A"
        static let espresso = "#2E1D12"
        static let cocoa = "#5A3A22"
        static let ink = "#2A1D14"
        static let cream = "#F7EFDF"
        static let glyph = "#000000"
    }

    static let noteSize = 48.0
    static let rotationDegrees = -8.0
    static let rotationCenter = Point(x: 23.5, y: 24)
    static let iconCanvasSize = 1024.0
    static let iconTileOrigin = 100.0
    static let iconTileSize = 824.0
    static let iconTileRadius = 10.8
    static let iconShadowOffset = 10.0
    static let iconShadowBlur = 10.0
    static let iconShadowOpacity = 0.25
    static let menuBarCanvasSize = 18.0
    static let markViewBox = (x: 5.5, y: 7.25, width: 33.5, height: 33.5)
    static let lockupFontSize = 24.0
    static let markSizeInEm = 1.43
    static let markTextGapInEm = 0.43
    static let wordGapInEm = 0.33
    static let letterSpacingInEm = -0.04

    static let silhouette: [Command] = [
        .move(Point(x: 12.2, y: 10)), .line(Point(x: 34.8, y: 10)),
        .quad(control: Point(x: 37, y: 10), end: Point(x: 37, y: 12.2)),
        .line(Point(x: 37, y: 16.5)),
        .cubic(control1: Point(x: 37, y: 30.5), control2: Point(x: 32.5, y: 38), end: Point(x: 17.5, y: 38)),
        .line(Point(x: 12.2, y: 38)),
        .quad(control: Point(x: 10, y: 38), end: Point(x: 10, y: 35.8)),
        .line(Point(x: 10, y: 12.2)),
        .quad(control: Point(x: 10, y: 10), end: Point(x: 12.2, y: 10)), .close
    ]

    static let face: [Command] = [
        .move(Point(x: 17.2, y: 10)), .line(Point(x: 34.8, y: 10)),
        .quad(control: Point(x: 37, y: 10), end: Point(x: 37, y: 12.2)),
        .line(Point(x: 37, y: 16.5)),
        .cubic(control1: Point(x: 37, y: 25), control2: Point(x: 25, y: 36.6), end: Point(x: 17.5, y: 38)),
        .line(Point(x: 12.2, y: 38)),
        .quad(control: Point(x: 10, y: 38), end: Point(x: 10, y: 35.8)),
        .line(Point(x: 10, y: 17.2)), .close
    ]

    static let corner: [Command] = [
        .move(Point(x: 12.2, y: 10)), .line(Point(x: 17.2, y: 10)),
        .line(Point(x: 10, y: 17.2)), .line(Point(x: 10, y: 12.2)),
        .quad(control: Point(x: 10, y: 10), end: Point(x: 12.2, y: 10)), .close
    ]

    static let noteLayers: [Layer] = [
        Layer(commands: silhouette, fill: Color.peel, stroke: nil, strokeWidth: 0),
        Layer(commands: face, fill: Color.banana, stroke: nil, strokeWidth: 0),
        Layer(commands: corner, fill: Color.espresso, stroke: nil, strokeWidth: 0)
    ]

    static let standaloneMarkLayers = noteLayers + [
        Layer(commands: silhouette, fill: nil, stroke: Color.espresso, strokeWidth: 1)
    ]

    static let menuBarLayers: [Layer] = [
        Layer(commands: [
            .move(Point(x: 3.9, y: 2.7)), .line(Point(x: 14.1, y: 2.7)),
            .quad(control: Point(x: 15.3, y: 2.7), end: Point(x: 15.3, y: 3.9)),
            .line(Point(x: 15.3, y: 6.6)),
            .cubic(control1: Point(x: 15.3, y: 12), control2: Point(x: 13.6, y: 15.3), end: Point(x: 7, y: 15.3)),
            .line(Point(x: 3.9, y: 15.3)),
            .quad(control: Point(x: 2.7, y: 15.3), end: Point(x: 2.7, y: 14.1)),
            .line(Point(x: 2.7, y: 3.9)),
            .quad(control: Point(x: 2.7, y: 2.7), end: Point(x: 3.9, y: 2.7)), .close
        ], fill: nil, stroke: Color.glyph, strokeWidth: 1.4),
        Layer(commands: [
            .move(Point(x: 3.9, y: 2.7)), .line(Point(x: 7.6, y: 2.7)),
            .line(Point(x: 2.7, y: 7.6)), .line(Point(x: 2.7, y: 3.9)),
            .quad(control: Point(x: 2.7, y: 2.7), end: Point(x: 3.9, y: 2.7)), .close
        ], fill: Color.glyph, stroke: Color.glyph, strokeWidth: 1.4),
        Layer(commands: [
            .move(Point(x: 15.3, y: 6.6)),
            .cubic(control1: Point(x: 15.3, y: 12), control2: Point(x: 13.6, y: 15.3), end: Point(x: 7, y: 15.3)),
            .cubic(control1: Point(x: 11, y: 14.9), control2: Point(x: 15.3, y: 10.6), end: Point(x: 15.3, y: 6.6)), .close
        ], fill: Color.glyph, stroke: nil, strokeWidth: 0)
    ]

    static func rotated(_ point: Point) -> Point {
        let radians = rotationDegrees * Double.pi / 180
        let x = point.x - rotationCenter.x
        let y = point.y - rotationCenter.y
        return Point(x: rotationCenter.x + cos(radians) * x - sin(radians) * y,
                     y: rotationCenter.y + sin(radians) * x + cos(radians) * y)
    }
}
