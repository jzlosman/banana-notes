import Foundation

enum WindowPreferencePolicy {
    static let defaultPinned = true

    static func pinned(from storedValue: Any?) -> Bool {
        (storedValue as? Bool) ?? defaultPinned
    }
}
