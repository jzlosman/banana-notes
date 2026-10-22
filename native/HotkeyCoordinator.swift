import Foundation

@MainActor
final class HotkeyCoordinator {
    private var preferences: HotkeyPreferences
    private let service: GlobalHotkeyService
    private(set) var registration = HotkeyRegistration(registered: false, error: nil)
    var onHotkey: (() -> Void)? {
        didSet { service.onHotkey = onHotkey }
    }
    var onChange: ((String, Bool) -> Void)?

    init(defaults: any PreferencesStore = UserDefaults.standard, existingLibrary: Bool,
         service: GlobalHotkeyService? = nil) {
        self.preferences = HotkeyPreferences(defaults: defaults, existingLibrary: existingLibrary)
        self.service = service ?? GlobalHotkeyService()
    }

    var chord: HotkeyChord { preferences.chord }
    var available: Bool { registration.registered }

    func registerInitial() {
        registration = service.register(preferences.chord)
        notifyChange()
    }

    func select(_ chord: HotkeyChord) -> [String: Any] {
        registration = service.register(chord)
        if registration.registered { preferences.select(chord) }
        notifyChange()
        return reply(error: registration.error)
    }

    func reply() -> [String: Any] { reply(error: registration.error) }

    func unregister() { service.unregister() }

    private func reply(error: String?) -> [String: Any] {
        var result: [String: Any] = ["keyCode": chord.keyCode, "modifiers": chord.modifiers,
                                     "display": chord.display, "registered": available]
        if let error { result["error"] = error }
        return result
    }

    private func notifyChange() { onChange?(chord.display, available) }
}
