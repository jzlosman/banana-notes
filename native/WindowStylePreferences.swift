import Foundation

struct WindowStyle: Codable, Equatable {
    let focusedOpacity: Double
    let unfocusedOpacity: Double
    let glass: Double
    static let standard = WindowStyle(focusedOpacity: 1, unfocusedOpacity: 0.6, glass: 0)

    var bridgeValue: [String: Double] {
        ["focusedOpacity": focusedOpacity, "unfocusedOpacity": unfocusedOpacity, "glass": glass]
    }
    func opacity(isFocused: Bool) -> Double { isFocused ? focusedOpacity : unfocusedOpacity }

    static func validate(_ style: WindowStyle) throws {
        let values = [style.focusedOpacity, style.unfocusedOpacity, style.glass]
        guard values.allSatisfy(\.isFinite), (0.05...1).contains(style.focusedOpacity),
              (0.05...1).contains(style.unfocusedOpacity), (0...1).contains(style.glass) else {
            throw StoreError(message: "Window opacity must be 5–100% and background translucency must be 0–100%.")
        }
    }
}

/// Window effects are user preferences, never part of a note or its frontmatter.
final class WindowStylePreferences {
    private let defaults: any PreferencesStore
    private let key = "windowStyle"
    private(set) var style: WindowStyle

    init(defaults: any PreferencesStore = UserDefaults.standard) {
        self.defaults = defaults
        if let data = defaults.data(forKey: key), let decoded = try? JSONDecoder().decode(WindowStyle.self, from: data),
           (try? WindowStyle.validate(decoded)) != nil {
            style = decoded
        } else { style = .standard }
    }

    func save(_ style: WindowStyle) throws {
        try WindowStyle.validate(style)
        let data = try JSONEncoder().encode(style)
        defaults.set(data, forKey: key)
        self.style = style
    }

    func reset() throws { try save(.standard) }
}
