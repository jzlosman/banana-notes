import AppKit
import Carbon

@MainActor
final class GlobalHotkeyService {
    private var hotKeyRef: EventHotKeyRef?
    private var eventHandler: EventHandlerRef?
    private(set) var chord: HotkeyChord?
    private(set) var registration = HotkeyRegistration(registered: false, error: nil)
    var onHotkey: (() -> Void)?

    func register(_ requested: HotkeyChord) -> HotkeyRegistration {
        installHandlerIfNeeded()
        guard eventHandler != nil else {
            if let current = hotKeyRef { UnregisterEventHotKey(current); hotKeyRef = nil }
            registration = HotkeyRegistration(registered: false, error: "The system hotkey handler could not be installed.")
            return registration
        }
        let identifier = EventHotKeyID(signature: OSType(0x464E4F54), id: 1)
        var replacement: EventHotKeyRef?
        let status = RegisterEventHotKey(requested.keyCode, requested.modifiers, identifier,
                                         GetApplicationEventTarget(), 0, &replacement)
        guard status == noErr, let replacement else {
            if let current = hotKeyRef { UnregisterEventHotKey(current); hotKeyRef = nil }
            registration = HotkeyRegistration(registered: false, error: "Shortcut registration failed (\(status)).")
            removeHandlerIfUnused()
            return registration
        }
        if let current = hotKeyRef { UnregisterEventHotKey(current) }
        hotKeyRef = replacement
        chord = requested
        registration = HotkeyRegistration(registered: true, error: nil)
        return registration
    }

    func unregister() {
        if let hotKeyRef { UnregisterEventHotKey(hotKeyRef); self.hotKeyRef = nil }
        removeHandlerIfUnused()
        registration = HotkeyRegistration(registered: false, error: nil)
    }

    private func installHandlerIfNeeded() {
        guard eventHandler == nil else { return }
        var type = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: OSType(kEventHotKeyPressed))
        let callback: EventHandlerProcPtr = { _, event, userData in
            guard let event, let userData else { return OSStatus(eventNotHandledErr) }
            var identifier = EventHotKeyID()
            let status = GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil,
                                           MemoryLayout<EventHotKeyID>.size, nil, &identifier)
            guard status == noErr, identifier.id == 1 else { return OSStatus(eventNotHandledErr) }
            let service = Unmanaged<GlobalHotkeyService>.fromOpaque(userData).takeUnretainedValue()
            Task { @MainActor in service.onHotkey?() }
            return noErr
        }
        let status = InstallEventHandler(GetApplicationEventTarget(), callback, 1, &type,
                                         Unmanaged.passUnretained(self).toOpaque(), &eventHandler)
        if status != noErr { eventHandler = nil }
    }

    private func removeHandlerIfUnused() {
        guard hotKeyRef == nil, let eventHandler else { return }
        RemoveEventHandler(eventHandler)
        self.eventHandler = nil
    }
}
