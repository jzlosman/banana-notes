import Foundation
import CoreFoundation

/// Optional tools are opt-in and independent of a note's Markdown or theme.
final class FeaturePreferences {
    private let defaults: any PreferencesStore
    init(defaults: any PreferencesStore = UserDefaults.standard) { self.defaults = defaults }
    var ocrEnabled: Bool { defaults.bool(forKey: "ocrEnabled") }
    func setOCR(_ value: Any?) throws {
        guard let value = value as? NSNumber, CFGetTypeID(value) == CFBooleanGetTypeID() else {
            throw StoreError(message: "OCR preference must be enabled or disabled.")
        }
        defaults.set(value.boolValue, forKey: "ocrEnabled")
    }
}
