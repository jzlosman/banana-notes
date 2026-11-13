import CoreFoundation
import Foundation

struct TasksHotkeyChord: Equatable {
    static let command: UInt32 = 1 << 8
    static let shift: UInt32 = 1 << 9
    static let option: UInt32 = 1 << 11
    static let control: UInt32 = 1 << 12
    static let supportedModifiers = command | shift | option | control

    let keyCode: UInt32
    let modifiers: UInt32

    init(keyCode: UInt32, modifiers: UInt32) throws {
        guard keyCode <= 127, modifiers & ~Self.supportedModifiers == 0,
              modifiers & (Self.command | Self.control | Self.option) != 0 else {
            throw TasksHotkeyChordError.invalidChord
        }
        self.keyCode = keyCode
        self.modifiers = modifiers
    }

    static let defaultChord = try! TasksHotkeyChord(keyCode: 17, modifiers: control | option)

    var bridgeValue: [String: Any] { ["keyCode": keyCode, "modifiers": modifiers] }

    var display: String {
        var result = ""
        if modifiers & Self.control != 0 { result += "⌃" }
        if modifiers & Self.option != 0 { result += "⌥" }
        if modifiers & Self.shift != 0 { result += "⇧" }
        if modifiers & Self.command != 0 { result += "⌘" }
        result += Self.keyLabels[keyCode] ?? "Key \(keyCode)"
        return result
    }

    static func decode(_ value: Any?) throws -> TasksHotkeyChord {
        guard let object = value as? [String: Any], Set(object.keys) == ["keyCode", "modifiers"],
              let key = object["keyCode"] as? NSNumber, let modifiers = object["modifiers"] as? NSNumber,
              CFGetTypeID(key) != CFBooleanGetTypeID(), CFGetTypeID(modifiers) != CFBooleanGetTypeID() else {
            throw TasksHotkeyChordError.invalidChord
        }
        let keyNumber = key.doubleValue, modifierNumber = modifiers.doubleValue
        guard keyNumber.isFinite, modifierNumber.isFinite,
              keyNumber.rounded(.towardZero) == keyNumber, modifierNumber.rounded(.towardZero) == modifierNumber,
              keyNumber >= 0, keyNumber <= 127, modifierNumber >= 0, modifierNumber <= Double(UInt32.max) else {
            throw TasksHotkeyChordError.invalidChord
        }
        return try TasksHotkeyChord(keyCode: UInt32(keyNumber), modifiers: UInt32(modifierNumber))
    }

    private static let keyLabels: [UInt32: String] = [
        0: "A", 1: "S", 2: "D", 3: "F", 4: "H", 5: "G", 6: "Z", 7: "X", 8: "C", 9: "V", 11: "B",
        12: "Q", 13: "W", 14: "E", 15: "R", 16: "Y", 17: "T", 18: "1", 19: "2", 20: "3", 21: "4",
        22: "6", 23: "5", 24: "=", 25: "9", 26: "7", 27: "-", 28: "8", 29: "0", 30: "]", 31: "O",
        32: "U", 33: "[", 34: "I", 35: "P", 36: "Return", 37: "L", 38: "J", 39: "'", 40: "K", 41: ";",
        42: "\\", 43: ",", 44: "/", 45: "N", 46: "M", 47: ".", 48: "Tab", 49: "Space", 50: "`",
        51: "Delete", 96: "F5", 97: "F6", 98: "F7", 99: "F3", 100: "F8", 101: "F9", 103: "F11",
        109: "F10", 111: "F12", 118: "F4", 120: "F2", 122: "F1", 123: "←", 124: "→", 125: "↓", 126: "↑",
    ]
}

enum TasksHotkeyChordError: Error { case invalidChord }

enum TasksHotkeyError: String, Equatable {
    case registrationUnavailable = "registration-unavailable"
    case registrationFailed = "registration-failed"
    case verificationProfile = "verification-profile"
}

struct TasksHotkeyRegistration {
    let activeChord: TasksHotkeyChord?
    let error: TasksHotkeyError?

    var registered: Bool { activeChord != nil }
}

struct TasksHotkeyState {
    let chord: TasksHotkeyChord
    let registered: Bool
    let available: Bool
    let error: TasksHotkeyError?

    var display: String { chord.display }
}

protocol TasksHotkeyPreferencesPort {
    func load() -> TasksHotkeyChord
    func save(_ chord: TasksHotkeyChord)
}

final class UserDefaultsTasksHotkeyPreferences: TasksHotkeyPreferencesPort {
    static let defaultsKey = "bananaTasks.globalHotkey.v1"
    private let defaults: UserDefaults

    init(defaults: UserDefaults) { self.defaults = defaults }

    func load() -> TasksHotkeyChord {
        guard let value = defaults.object(forKey: Self.defaultsKey), let chord = try? TasksHotkeyChord.decode(value) else {
            return .defaultChord
        }
        return chord
    }

    func save(_ chord: TasksHotkeyChord) {
        defaults.set(chord.bridgeValue, forKey: Self.defaultsKey)
    }
}

@MainActor
protocol TasksHotkeyRegistrationPort {
    func register(_ chord: TasksHotkeyChord) -> TasksHotkeyRegistration
    func unregister()
}

@MainActor
final class TasksHotkeyCoordinator {
    private let preferences: TasksHotkeyPreferencesPort
    private let registrar: TasksHotkeyRegistrationPort
    private let registrationAllowed: Bool
    private(set) var state: TasksHotkeyState
    private(set) var isRecording = false
    var onChange: ((TasksHotkeyState) -> Void)?

    init(preferences: TasksHotkeyPreferencesPort, registrar: TasksHotkeyRegistrationPort, registrationAllowed: Bool) {
        self.preferences = preferences
        self.registrar = registrar
        self.registrationAllowed = registrationAllowed
        let configured = preferences.load()
        state = TasksHotkeyState(chord: configured, registered: false, available: false,
                                 error: registrationAllowed ? nil : .verificationProfile)
    }

    @discardableResult
    func registerInitial() -> TasksHotkeyState {
        let configured = preferences.load()
        guard registrationAllowed else {
            state = TasksHotkeyState(chord: configured, registered: false, available: false, error: .verificationProfile)
            notifyChange()
            return state
        }
        let result = registrar.register(configured)
        if result.activeChord == configured, result.error == nil { preferences.save(configured) }
        state = makeState(result, fallback: preferences.load())
        notifyChange()
        return state
    }

    @discardableResult
    func reset() -> TasksHotkeyState {
        isRecording = false
        return set(.defaultChord)
    }

    @discardableResult
    func set(_ chord: TasksHotkeyChord) -> TasksHotkeyState {
        isRecording = false
        guard registrationAllowed else {
            state = TasksHotkeyState(chord: preferences.load(), registered: false, available: false, error: .verificationProfile)
            notifyChange()
            return state
        }
        let result = registrar.register(chord)
        if result.activeChord == chord, result.error == nil { preferences.save(chord) }
        state = makeState(result, fallback: preferences.load())
        notifyChange()
        return state
    }

    func setRecording(_ recording: Bool) { isRecording = registrationAllowed && recording }

    func handleHotkey(_ action: () -> Void) {
        guard !isRecording else { return }
        action()
    }

    func unregister() { registrar.unregister(); isRecording = false }

    private func makeState(_ registration: TasksHotkeyRegistration, fallback: TasksHotkeyChord) -> TasksHotkeyState {
        let chord = registration.activeChord ?? fallback
        let registered = registration.registered
        let available = registered || registration.error == .registrationFailed
        return TasksHotkeyState(chord: chord, registered: registered, available: available, error: registration.error)
    }

    private func notifyChange() { onChange?(state) }
}

enum TasksHotkeyReplacementPolicy {
    static func replace<Handle>(current: Handle?, create: () -> Handle?, release: (Handle) -> Void) -> (handle: Handle?, replaced: Bool) {
        guard let replacement = create() else { return (current, false) }
        if let current { release(current) }
        return (replacement, true)
    }
}
