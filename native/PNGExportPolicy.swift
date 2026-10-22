import Foundation

struct PNGMarkFrame: Equatable {
    let x: Double
    let y: Double
    let side: Double

    var maxX: Double { x + side }
    var maxY: Double { y + side }
}

struct PNGMarkColor: Equatable {
    let hex: String
    let alpha: Double
}

/// Content and geometry rules that can be verified without WebKit or AppKit rendering.
enum PNGExportPolicy {
    static let markSide = 14.0
    static let markAlpha = 0.55

    static func removingDuplicateLeadingTitle(from html: String, title: String) -> String {
        guard let match = html.firstMatch(pattern: #"(?is)^\s*<h1\b[^>]*>(.*?)</h1\s*>\s*"#),
              let range = Range(match.range, in: html), let contentRange = Range(match.range(at: 1), in: html) else { return html }
        let headingText = stripTags(html[contentRange])
        guard headingText.trimmingCharacters(in: .whitespacesAndNewlines)
            .compare(title.trimmingCharacters(in: .whitespacesAndNewlines), options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame else {
            return html
        }
        return String(html[range.upperBound...])
    }

    /// Coordinates use the bitmap's AppKit bottom-left origin. The frame sits solely in the bottom-right gradient gutter.
    static func markFrame(width: Double, height: Double, padding: Double, side: Double = markSide) -> PNGMarkFrame? {
        guard width.isFinite, height.isFinite, padding.isFinite, side.isFinite,
              width > padding * 2, height > padding, side > 0, side < padding else { return nil }
        let gutter = (padding - side) / 2
        return PNGMarkFrame(x: width - padding + gutter, y: gutter, side: side)
    }

    static func markColor(backgroundStart: String, backgroundEnd: String) -> PNGMarkColor? {
        guard let first = rgb(backgroundStart), let second = rgb(backgroundEnd) else { return nil }
        let dark = min(contrast(0.035, first), contrast(0.035, second))
        let light = min(contrast(1, first), contrast(1, second))
        return PNGMarkColor(hex: light > dark ? "#FFFFFF" : "#09080D", alpha: markAlpha)
    }

    private static func stripTags(_ source: Substring) -> String {
        let text = String(source).replacingOccurrences(of: #"(?is)<[^>]*>"#, with: "", options: .regularExpression)
        return decodeEntities(text)
    }

    private static func decodeEntities(_ value: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: #"&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp);"#) else { return value }
        let source = value as NSString
        var result = value
        for match in regex.matches(in: value, range: NSRange(location: 0, length: source.length)).reversed() {
            let entity = source.substring(with: match.range(at: 1))
            let replacement: String?
            if entity == "amp" { replacement = "&" }
            else if entity == "lt" { replacement = "<" }
            else if entity == "gt" { replacement = ">" }
            else if entity == "quot" { replacement = "\"" }
            else if entity == "apos" { replacement = "'" }
            else if entity == "nbsp" { replacement = "\u{00a0}" }
            else if entity.hasPrefix("#x"), let scalar = UInt32(entity.dropFirst(2), radix: 16).flatMap(UnicodeScalar.init) { replacement = String(scalar) }
            else if entity.hasPrefix("#"), let scalar = UInt32(entity.dropFirst()).flatMap(UnicodeScalar.init) { replacement = String(scalar) }
            else { replacement = nil }
            if let replacement, let range = Range(match.range, in: result) { result.replaceSubrange(range, with: replacement) }
        }
        return result
    }

    private static func rgb(_ value: String) -> (Double, Double, Double)? {
        guard value.range(of: #"^#[0-9a-fA-F]{6}$"#, options: .regularExpression) != nil,
              let packed = UInt32(value.dropFirst(), radix: 16) else { return nil }
        return (Double((packed >> 16) & 255) / 255, Double((packed >> 8) & 255) / 255, Double(packed & 255) / 255)
    }

    private static func luminance(_ color: (Double, Double, Double)) -> Double {
        func linear(_ channel: Double) -> Double { channel <= 0.04045 ? channel / 12.92 : pow((channel + 0.055) / 1.055, 2.4) }
        return 0.2126 * linear(color.0) + 0.7152 * linear(color.1) + 0.0722 * linear(color.2)
    }

    private static func contrast(_ candidate: Double, _ background: (Double, Double, Double)) -> Double {
        let backgroundLuminance = luminance(background)
        let foregroundLuminance = candidate < 0.5 ? luminance((0.035, 0.031, 0.051)) : 1
        return (max(backgroundLuminance, foregroundLuminance) + 0.05) / (min(backgroundLuminance, foregroundLuminance) + 0.05)
    }
}

private extension String {
    func firstMatch(pattern: String) -> NSTextCheckingResult? {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        return regex.firstMatch(in: self, range: NSRange(startIndex..., in: self))
    }
}
