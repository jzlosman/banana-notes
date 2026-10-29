import CoreGraphics
import CoreText
import Foundation

/// SVG serialization adapter. Geometry and colours come only from `BananaMark`;
/// Space Mono outlines are loaded from the same bundled WOFF2 faces used by the app.
enum BananaBrandSVG {
    static func generatedFiles(repositoryRoot: URL, product: BananaMark.Product = .notes) throws -> [String: String] {
        let fontDirectory = repositoryRoot.appendingPathComponent("node_modules/@fontsource/space-mono/files", isDirectory: true)
        let regularFont = try loadFont(fontDirectory.appendingPathComponent("space-mono-latin-400-normal.woff2"), size: BananaMark.lockupFontSize)
        let boldFont = try loadFont(fontDirectory.appendingPathComponent("space-mono-latin-700-normal.woff2"), size: BananaMark.lockupFontSize)
        let wordmark = try makeWordmark(regular: regularFont, bold: boldFont, product: product)
        if product == .notes {
            return [
                "app-icon.svg": appIconSVG(product: product),
                "mark.svg": markSVG(outlined: true, product: product),
                "mark-on-cocoa.svg": markSVG(outlined: false, product: product),
                "logo.svg": logoSVG(wordmark: wordmark, dark: false, product: product),
                "logo-dark.svg": logoSVG(wordmark: wordmark, dark: true, product: product),
                "logo-on-cocoa.svg": logoOnCocoaSVG(wordmark: wordmark, product: product),
                "menu-bar.svg": menuBarSVG()
            ]
        }
        return [
            "app-icon.svg": appIconSVG(product: product),
            "mark.svg": markSVG(outlined: true, product: product),
            "logo.svg": logoSVG(wordmark: wordmark, dark: false, product: product),
            "logo-dark.svg": logoSVG(wordmark: wordmark, dark: true, product: product),
            "logo-on-cocoa.svg": logoOnCocoaSVG(wordmark: wordmark, product: product)
        ]
    }

    static func exportMarkSVG(side: Double, product: BananaMark.Product = .notes) -> String {
        let box = BananaMark.markViewBox
        let inner = noteLayersSVG(BananaMark.standaloneMarkLayers)
        let lines = product == .viewer ? viewerWritingLinesSVG() : ""
        return "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"\(number(side))\" height=\"\(number(side))\" viewBox=\"\(number(box.x)) \(number(box.y)) \(number(box.width)) \(number(box.height))\" aria-hidden=\"true\"><g transform=\"\(noteRotationTransform)\">\(inner)\(lines)</g></svg>"
    }

    private struct Wordmark {
        let width: Double
        let height: Double
        let paths: [String]
    }

    private struct OutlinedWord {
        let paths: [String]
        let visualEnd: Double
    }

    private static func makeWordmark(regular: CTFont, bold: CTFont, product: BananaMark.Product) throws -> Wordmark {
        let em = BananaMark.lockupFontSize
        let markSize = BananaMark.markSizeInEm * em
        let baseline = markSize / 2 + Double(CTFontGetXHeight(regular)) / 2
        let tracking = BananaMark.letterSpacingInEm * em
        let bananaStart = markSize + BananaMark.markTextGapInEm * em
        let banana = try outline("banana", font: bold, visualStart: bananaStart, baseline: baseline, tracking: tracking)
        let notesStart = banana.visualEnd + BananaMark.wordGapInEm * em
        let suffix = try outline(product.wordmarkSuffix, font: regular, visualStart: notesStart, baseline: baseline, tracking: tracking)
        return Wordmark(width: suffix.visualEnd, height: markSize, paths: banana.paths + suffix.paths)
    }

    private static func outline(_ text: String, font: CTFont, visualStart: Double, baseline: Double,
                                tracking: Double) throws -> OutlinedWord {
        let characters = Array(text.utf16)
        var glyphs = [CGGlyph](repeating: 0, count: characters.count)
        let mapped = characters.withUnsafeBufferPointer { input in
            glyphs.withUnsafeMutableBufferPointer { output in
                CTFontGetGlyphsForCharacters(font, input.baseAddress!, output.baseAddress!, characters.count)
            }
        }
        guard mapped else { throw BrandSVGError.fontGlyphUnavailable(text) }

        let firstBounds = CTFontCreatePathForGlyph(font, glyphs[0], nil)?.boundingBoxOfPath
        guard let firstBounds else { throw BrandSVGError.fontGlyphUnavailable(String(text.prefix(1))) }
        var glyphOrigin = visualStart - Double(firstBounds.minX)
        var outputPaths: [String] = []
        var visualEnd = visualStart
        for index in glyphs.indices {
            guard let glyphPath = CTFontCreatePathForGlyph(font, glyphs[index], nil) else {
                throw BrandSVGError.fontGlyphUnavailable(String(UnicodeScalar(characters[index])!))
            }
            let bounds = glyphPath.boundingBoxOfPath
            var transform = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: glyphOrigin, ty: baseline)
            guard let svgPath = glyphPath.copy(using: &transform) else {
                throw BrandSVGError.fontGlyphUnavailable(String(UnicodeScalar(characters[index])!))
            }
            outputPaths.append("<path d=\"\(pathData(svgPath))\"/>")
            visualEnd = max(visualEnd, glyphOrigin + Double(bounds.maxX))

            var advance = CGSize.zero
            _ = CTFontGetAdvancesForGlyphs(font, .horizontal, &glyphs[index], &advance, 1)
            glyphOrigin += Double(advance.width)
            if index < glyphs.count - 1 { glyphOrigin += tracking }
        }
        return OutlinedWord(paths: outputPaths, visualEnd: visualEnd)
    }

    private static func loadFont(_ url: URL, size: Double) throws -> CTFont {
        let data = try Data(contentsOf: url)
        guard let descriptors = CTFontManagerCreateFontDescriptorsFromData(data as CFData) as? [CTFontDescriptor],
              let descriptor = descriptors.first else { throw BrandSVGError.fontUnavailable(url.lastPathComponent) }
        let font = CTFontCreateWithFontDescriptor(descriptor, CGFloat(size), nil)
        guard CTFontCopyFamilyName(font) as String == "Space Mono" else {
            throw BrandSVGError.unexpectedFontFamily(CTFontCopyFamilyName(font) as String)
        }
        return font
    }

    private static func appIconSVG(product: BananaMark.Product) -> String {
        let scale = BananaMark.iconTileSize / BananaMark.noteSize
        let shadowOffset = BananaMark.iconShadowOffset / scale
        let shadowBlur = BananaMark.iconShadowBlur / scale
        let tile = number(BananaMark.noteSize)
        let radius = number(BananaMark.iconTileRadius)
        let canvas = number(BananaMark.iconCanvasSize)
        let layers = noteLayersSVG(BananaMark.noteLayers)
        let lines = product == .viewer ? viewerWritingLinesSVG() : ""
        return """
        <svg xmlns="http://www.w3.org/2000/svg" width="\(canvas)" height="\(canvas)" viewBox="0 0 \(canvas) \(canvas)" role="img">
          <title>\(product.title)</title>
          <defs><filter id="tile-shadow" x="-4" y="-4" width="56" height="58" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="\(preciseNumber(shadowOffset))" stdDeviation="\(preciseNumber(shadowBlur))" flood-color="#000000" flood-opacity="\(number(BananaMark.iconShadowOpacity))"/></filter></defs>
          <g transform="translate(\(number(BananaMark.iconTileOrigin)) \(number(BananaMark.iconTileOrigin))) scale(\(preciseNumber(scale)))">
            <rect x="0" y="0" width="\(tile)" height="\(tile)" rx="\(radius)" fill="\(BananaMark.Color.cocoa)" filter="url(#tile-shadow)"/>
            <rect x="0" y="0" width="\(tile)" height="\(tile)" rx="\(radius)" fill="\(BananaMark.Color.cocoa)"/>
            <g transform="\(noteRotationTransform)">\(layers)\(lines)</g>
          </g>
        </svg>
        """
    }

    private static func markSVG(outlined: Bool, product: BananaMark.Product) -> String {
        let box = BananaMark.markViewBox
        let layers = noteLayersSVG(outlined ? BananaMark.standaloneMarkLayers : BananaMark.noteLayers)
        let lines = product == .viewer ? viewerWritingLinesSVG() : ""
        return """
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="\(number(box.x)) \(number(box.y)) \(number(box.width)) \(number(box.height))" role="img">
          <title>\(product.title)</title>
          <g transform="\(noteRotationTransform)">\(layers)\(lines)</g>
        </svg>
        """
    }

    private static func menuBarSVG() -> String {
        """
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 \(number(BananaMark.menuBarCanvasSize)) \(number(BananaMark.menuBarCanvasSize))" role="img">
          <title>Banana Notes</title>
          \(layersSVG(BananaMark.menuBarLayers))
        </svg>
        """
    }

    private static func logoSVG(wordmark: Wordmark, dark: Bool, product: BananaMark.Product) -> String {
        let markSize = wordmark.height
        let mark: String
        if dark && product == .notes {
            let tile = number(BananaMark.noteSize)
            mark = "<svg x=\"0\" y=\"0\" width=\"\(number(markSize))\" height=\"\(number(markSize))\" viewBox=\"0 0 \(tile) \(tile)\"><rect width=\"\(tile)\" height=\"\(tile)\" rx=\"\(number(BananaMark.iconTileRadius))\" fill=\"\(BananaMark.Color.cocoa)\"/><g transform=\"\(noteRotationTransform)\">\(noteLayersSVG(BananaMark.noteLayers))</g></svg>"
        } else {
            let box = BananaMark.markViewBox
            let lines = product == .viewer ? viewerWritingLinesSVG() : ""
            mark = "<svg x=\"0\" y=\"0\" width=\"\(number(markSize))\" height=\"\(number(markSize))\" viewBox=\"\(number(box.x)) \(number(box.y)) \(number(box.width)) \(number(box.height))\"><g transform=\"\(noteRotationTransform)\">\(noteLayersSVG(BananaMark.standaloneMarkLayers))\(lines)</g></svg>"
        }
        let textColor = dark ? BananaMark.Color.cream : BananaMark.Color.ink
        return """
        <svg xmlns="http://www.w3.org/2000/svg" width="\(number(wordmark.width))" height="\(number(wordmark.height))" viewBox="0 0 \(number(wordmark.width)) \(number(wordmark.height))" role="img">
          <title>\(product.title)</title>
          \(mark)
          <g fill="\(textColor)">\(wordmark.paths.joined())</g>
        </svg>
        """
    }

    private static func logoOnCocoaSVG(wordmark: Wordmark, product: BananaMark.Product) -> String {
        let padding = 16.0
        let width = wordmark.width + padding * 2
        let height = wordmark.height + padding * 2
        let markSize = wordmark.height
        let box = BananaMark.markViewBox
        let markLayers = product == .viewer ? BananaMark.standaloneMarkLayers : BananaMark.noteLayers
        let lines = product == .viewer ? viewerWritingLinesSVG() : ""
        let mark = "<svg x=\"0\" y=\"0\" width=\"\(number(markSize))\" height=\"\(number(markSize))\" viewBox=\"\(number(box.x)) \(number(box.y)) \(number(box.width)) \(number(box.height))\"><g transform=\"\(noteRotationTransform)\">\(noteLayersSVG(markLayers))\(lines)</g></svg>"
        let background = product == .notes ? "<rect width=\"100%\" height=\"100%\" fill=\"\(BananaMark.Color.cocoa)\"/>\n  " : ""
        return """
        <svg xmlns="http://www.w3.org/2000/svg" width="\(number(width))" height="\(number(height))" viewBox="0 0 \(number(width)) \(number(height))" role="img">
          <title>\(product.title)</title>
          \(background)<g transform="translate(\(number(padding)) \(number(padding)))">
            \(mark)
            <g fill="\(BananaMark.Color.cream)">\(wordmark.paths.joined())</g>
          </g>
        </svg>
        """
    }

    private static func viewerWritingLinesSVG() -> String {
        let path = BananaMark.viewerWritingLines.map { line in
            "M\(number(line.start.x)) \(number(line.start.y))H\(number(line.end.x))"
        }.joined()
        return "<path d=\"\(path)\" fill=\"none\" stroke=\"\(BananaMark.Color.espresso)\" stroke-width=\"\(number(BananaMark.viewerWritingLineWidth))\" stroke-linecap=\"round\"/>"
    }

    private static var noteRotationTransform: String {
        "rotate(\(number(BananaMark.rotationDegrees)) \(number(BananaMark.rotationCenter.x)) \(number(BananaMark.rotationCenter.y)))"
    }

    private static func noteLayersSVG(_ layers: [BananaMark.Layer]) -> String {
        layersSVG(layers)
    }

    private static func layersSVG(_ layers: [BananaMark.Layer]) -> String {
        layers.map { layer in
            let fill = layer.fill ?? "none"
            let stroke = layer.stroke.map { " stroke=\"\($0)\" stroke-width=\"\(number(layer.strokeWidth))\" stroke-linejoin=\"round\" stroke-linecap=\"round\"" } ?? ""
            return "<path d=\"\(pathData(layer.commands))\" fill=\"\(fill)\"\(stroke)/>"
        }.joined()
    }

    private static func pathData(_ commands: [BananaMark.Command]) -> String {
        commands.map { command in
            switch command {
            case .move(let p): "M\(number(p.x)) \(number(p.y))"
            case .line(let p): "L\(number(p.x)) \(number(p.y))"
            case .quad(let control, let end): "Q\(number(control.x)) \(number(control.y)) \(number(end.x)) \(number(end.y))"
            case .cubic(let c1, let c2, let end): "C\(number(c1.x)) \(number(c1.y)) \(number(c2.x)) \(number(c2.y)) \(number(end.x)) \(number(end.y))"
            case .close: "Z"
            }
        }.joined(separator: " ")
    }

    private static func pathData(_ path: CGPath) -> String {
        var components: [String] = []
        path.applyWithBlock { pointer in
            let element = pointer.pointee
            let points = element.points
            switch element.type {
            case .moveToPoint: components.append("M\(number(Double(points[0].x))) \(number(Double(points[0].y)))")
            case .addLineToPoint: components.append("L\(number(Double(points[0].x))) \(number(Double(points[0].y)))")
            case .addQuadCurveToPoint: components.append("Q\(number(Double(points[0].x))) \(number(Double(points[0].y))) \(number(Double(points[1].x))) \(number(Double(points[1].y)))")
            case .addCurveToPoint: components.append("C\(number(Double(points[0].x))) \(number(Double(points[0].y))) \(number(Double(points[1].x))) \(number(Double(points[1].y))) \(number(Double(points[2].x))) \(number(Double(points[2].y)))")
            case .closeSubpath: components.append("Z")
            @unknown default: break
            }
        }
        return components.joined(separator: " ")
    }

    private static func preciseNumber(_ value: Double) -> String {
        let rounded = String(format: "%.12f", locale: Locale(identifier: "en_US_POSIX"), value)
        return rounded.replacingOccurrences(of: #"0+$"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\.$"#, with: "", options: .regularExpression)
    }

    private static func number(_ value: Double) -> String {
        let rounded = String(format: "%.5f", locale: Locale(identifier: "en_US_POSIX"), value)
        return rounded.replacingOccurrences(of: #"0+$"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\.$"#, with: "", options: .regularExpression)
    }
}

enum BrandSVGError: Error, CustomStringConvertible {
    case fontUnavailable(String)
    case fontGlyphUnavailable(String)
    case unexpectedFontFamily(String)

    var description: String {
        switch self {
        case .fontUnavailable(let name): "Unable to load bundled Space Mono face: \(name)"
        case .fontGlyphUnavailable(let glyph): "Unable to outline Space Mono glyph: \(glyph)"
        case .unexpectedFontFamily(let family): "Expected Space Mono but loaded \(family)"
        }
    }
}
