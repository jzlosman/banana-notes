import Foundation
@testable import BananaNotesCore

@main
struct HotkeyPreferencesSelfTest {
    static func main() throws {
        let name = "Hotkey-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }

        var fresh = HotkeyPreferences(defaults: defaults, existingLibrary: false)
        precondition(fresh.chord == .freshInstall && fresh.chord.display == "⌃⇧Space")
        precondition(defaults.dictionary(forKey: HotkeyPreferences.defaultsKey)?["keyCode"] as? Int == 49)
        fresh.select(try HotkeyChord(keyCode: 49, modifiers: HotkeyChord.command | HotkeyChord.option))
        precondition(defaults.dictionary(forKey: HotkeyPreferences.defaultsKey)?["modifiers"] as? Int == Int(HotkeyChord.command | HotkeyChord.option))
        let reopened = HotkeyPreferences(defaults: defaults, existingLibrary: false)
        precondition(reopened.chord.display == "⌥⌘Space", "explicit user selection persists")

        let upgradeName = "HotkeyUpgrade-\(UUID().uuidString)"
        let upgradeDefaults = UserDefaults(suiteName: upgradeName)!
        defer { upgradeDefaults.removePersistentDomain(forName: upgradeName) }
        let upgraded = HotkeyPreferences(defaults: upgradeDefaults, existingLibrary: true)
        precondition(upgraded.chord == .upgradedInstall && upgraded.chord.display == "⌃⌥Space")

        let invalidName = "HotkeyInvalid-\(UUID().uuidString)"
        let invalidDefaults = UserDefaults(suiteName: invalidName)!
        defer { invalidDefaults.removePersistentDomain(forName: invalidName) }
        invalidDefaults.set(["keyCode": 49, "modifiers": 0], forKey: HotkeyPreferences.defaultsKey)
        let recovered = HotkeyPreferences(defaults: invalidDefaults, existingLibrary: false)
        precondition(recovered.chord == .freshInstall, "invalid stored shortcut is repaired to a valid default")

        for values: [String: Any] in [["keyCode": 49, "modifiers": 0], ["keyCode": 200, "modifiers": HotkeyChord.command],
                                      ["keyCode": 49.5, "modifiers": HotkeyChord.command], ["keyCode": true, "modifiers": HotkeyChord.command],
                                      ["keyCode": 49, "modifiers": 1 << 4]] {
            do { _ = try HotkeyChord.decode(values); preconditionFailure("invalid hotkey chord was accepted") }
            catch is StoreError {}
        }
        print("Native hotkey validation and fresh/upgrade migration checks passed")
    }
}
