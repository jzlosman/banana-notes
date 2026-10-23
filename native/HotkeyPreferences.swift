import Foundation

struct HotkeyChord: Equatable, Sendable {
    static let command: UInt32 = 1 << 8
    static let shift: UInt32 = 1 << 9
    static let option: UInt32 = 1 << 11
    static let control: UInt32 = 1 << 12
    static let supportedModifiers = command | shift | option | control
    static let keySpace: UInt32 = 49

    let keyCode: UInt32
    let modifiers: UInt32

    init(keyCode: UInt32, modifiers: UInt32) throws {
        guard keyCode <= 127, modifiers & ~Self.supportedModifiers == 0,
              modifiers & (Self.command | Self.control | Self.option) != 0 else {
            throw StoreError(message: "Choose a valid shortcut that includes Command, Control or Option.")
        }
        self.keyCode = keyCode
        self.modifiers = modifiers
    }

    var display: String {
        var result = ""
        if modifiers & Self.control != 0 { result += "⌃" }
        if modifiers & Self.option != 0 { result += "⌥" }
        if modifiers & Self.shift != 0 { result += "⇧" }
        if modifiers & Self.command != 0 { result += "⌘" }
        result += keyCode == Self.keySpace ? "Space" : "Key \(keyCode)"
        return result
    }

    var bridgeValue: [String: Any] { ["keyCode": keyCode, "modifiers": modifiers] }

    static func decode(_ value: Any?) throws -> HotkeyChord {
        guard let object = value as? [String: Any], let key = object["keyCode"] as? NSNumber,
              let modifiers = object["modifiers"] as? NSNumber,
              CFGetTypeID(key) != CFBooleanGetTypeID(), CFGetTypeID(modifiers) != CFBooleanGetTypeID() else {
            throw StoreError(message: "Shortcut keyCode and modifiers must be integers.")
        }
        let keyNumber = key.doubleValue, modifierNumber = modifiers.doubleValue
        guard keyNumber.isFinite, modifierNumber.isFinite,
              keyNumber.rounded(.towardZero) == keyNumber, modifierNumber.rounded(.towardZero) == modifierNumber,
              keyNumber >= 0, keyNumber <= 127, modifierNumber >= 0, modifierNumber <= Double(UInt32.max) else {
            throw StoreError(message: "Shortcut keyCode and modifiers must be valid non-negative integers.")
        }
        return try HotkeyChord(keyCode: UInt32(keyNumber), modifiers: UInt32(modifierNumber))
    }

    static let freshInstall = try! HotkeyChord(keyCode: keySpace, modifiers: control | shift)
    static let upgradedInstall = try! HotkeyChord(keyCode: keySpace, modifiers: control | option)
}

struct HotkeyPreferences {
    static let defaultsKey = "globalHotkey"
    private let defaults: any PreferencesStore
    private(set) var chord: HotkeyChord

    init(defaults: any PreferencesStore = UserDefaults.standard, existingLibrary: Bool) {
        self.defaults = defaults
        if let stored = defaults.object(forKey: Self.defaultsKey),
           let decoded = try? HotkeyChord.decode(stored) {
            chord = decoded
        } else {
            chord = existingLibrary ? .upgradedInstall : .freshInstall
            defaults.set(chord.bridgeValue, forKey: Self.defaultsKey)
        }
    }

    mutating func select(_ chord: HotkeyChord) {
        self.chord = chord
        defaults.set(chord.bridgeValue, forKey: Self.defaultsKey)
    }
}

struct HotkeyRegistration: Equatable {
    let registered: Bool
    let error: String?
}
