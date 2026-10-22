import Foundation

/// Optional tools are opt-in and independent of a note's Markdown or theme.
final class FeaturePreferences {
    private let defaults: any PreferencesStore
    init(defaults: any PreferencesStore = UserDefaults.standard) { self.defaults = defaults }
    var ocrEnabled: Bool { defaults.bool(forKey: "ocrEnabled") }
    func setOCR(_ enabled: Bool) { defaults.set(enabled, forKey: "ocrEnabled") }
}
