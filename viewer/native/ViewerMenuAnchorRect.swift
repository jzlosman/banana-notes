import CoreFoundation
import CoreGraphics
import Foundation

/// Viewport-space button geometry accepted from the bundled web UI. Construction validates the wire
/// payload once; conversion clamps every coordinate to the WebKit view before AppKit uses it.
struct ViewerMenuAnchorRect: Equatable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double

    init?(wireValue: Any) {
        guard let values = wireValue as? [String: Any],
              Set(values.keys) == Set(["x", "y", "width", "height"]),
              let x = Self.finiteNumber(values["x"]),
              let y = Self.finiteNumber(values["y"]),
              let width = Self.finiteNumber(values["width"]),
              let height = Self.finiteNumber(values["height"]),
              width > 0, height > 0 else { return nil }
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }

    func clamped(to bounds: CGRect) -> CGRect? {
        let viewWidth = Double(bounds.width)
        let viewHeight = Double(bounds.height)
        guard viewWidth.isFinite, viewHeight.isFinite, viewWidth > 0, viewHeight > 0 else { return nil }
        let left = min(max(x, 0), viewWidth)
        let top = min(max(y, 0), viewHeight)
        return CGRect(x: CGFloat(left), y: CGFloat(top),
                      width: CGFloat(min(width, viewWidth - left)),
                      height: CGFloat(min(height, viewHeight - top)))
    }

    private static func finiteNumber(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let result = number.doubleValue
        return result.isFinite ? result : nil
    }
}
