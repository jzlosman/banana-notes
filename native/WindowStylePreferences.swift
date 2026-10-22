import Foundation
import CoreFoundation

struct WindowStyle: Codable, Equatable {
    let focusedOpacity: Double
    let unfocusedOpacity: Double
    let glass: Double
    static let solid = WindowStyle(focusedOpacity: 1, unfocusedOpacity: 1, glass: 0)

    var bridgeValue: [String: Double] {
        ["focusedOpacity": focusedOpacity, "unfocusedOpacity": unfocusedOpacity, "glass": glass]
    }
    func opacity(isFocused: Bool) -> Double { isFocused ? focusedOpacity : unfocusedOpacity }

    static func resolve(_ value: Any?) -> WindowStyle {
        let fields = value as? [String: Any] ?? [:]
        func number(_ key: String, fallback: Double, minimum: Double) -> Double {
            guard let value = fields[key] as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(), value.doubleValue.isFinite else { return fallback }
            return min(1, max(minimum, value.doubleValue))
        }
        return WindowStyle(focusedOpacity: number("focusedOpacity", fallback: 1, minimum: 0.05),
                           unfocusedOpacity: number("unfocusedOpacity", fallback: 1, minimum: 0.05),
                           glass: number("glass", fallback: 0, minimum: 0))
    }

    static func validate(_ fields: [String: Any]) throws -> WindowStyle {
        for key in ["focusedOpacity", "unfocusedOpacity", "glass"] {
            guard let value = fields[key] as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(), value.doubleValue.isFinite,
                  value.doubleValue >= (key == "glass" ? 0 : 0.05), value.doubleValue <= 1 else {
                throw StoreError(message: "Window opacity must be 5–100% and background translucency must be 0–100%.")
            }
        }
        return resolve(fields)
    }
}

/// Window effects are user preferences, never part of a note or its frontmatter.
final class WindowStylePreferences {
    private let defaults: any PreferencesStore
    private let key = "windowStyle"
    private(set) var style: WindowStyle

    init(defaults: any PreferencesStore = UserDefaults.standard) {
        self.defaults = defaults
        let value = defaults.data(forKey: key).flatMap { try? JSONSerialization.jsonObject(with: $0) }
        self.style = WindowStyle.resolve(value)
    }

    func save(_ fields: [String: Any]) throws {
        let style = try WindowStyle.validate(fields)
        let data = try JSONEncoder().encode(style)
        defaults.set(data, forKey: key)
        self.style = style
    }

    func reset() throws { try save(WindowStyle.solid.bridgeValue) }
}
