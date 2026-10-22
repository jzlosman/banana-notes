import Foundation
import CoreFoundation

final class FontSizePreferences {
    static let defaultSize = 15
    private let defaults: any PreferencesStore
    private let key = "editorFontSize"
    var size: Int {
        guard let number = defaults.object(forKey: key) as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue.isFinite else { return Self.defaultSize }
        return Int(min(32, max(10, number.doubleValue)).rounded())
    }
    init(defaults: any PreferencesStore = UserDefaults.standard) { self.defaults = defaults }
    func save(_ value: Int) throws {
        guard (10...32).contains(value) else { throw StoreError(message: "Note text size must be a whole number between 10 and 32.") }
        defaults.set(value, forKey: key)
    }
}
