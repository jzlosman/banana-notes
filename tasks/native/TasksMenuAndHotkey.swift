import AppKit
import Carbon

@MainActor
enum TasksMenuAction { case toggleWindow, newTask, settings, toggleTimer, togglePin, quit }

@MainActor
final class TasksMenuController: NSObject {
    private let statusItem: NSStatusItem
    private var pinItem: NSMenuItem?
    var onAction: ((TasksMenuAction) -> Void)?

    init(isPinned: Bool, hotkeyState: TasksHotkeyState) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        super.init()
        let iconURL = Bundle.main.resourceURL?.appendingPathComponent("TasksMenuBar.svg")
        let image = iconURL.flatMap(NSImage.init(contentsOf:)) ?? NSImage(systemSymbolName: "checklist", accessibilityDescription: "Banana Tasks")
        image?.size = NSSize(width: 18, height: 18)
        image?.isTemplate = true
        statusItem.button?.image = image
        statusItem.button?.toolTip = Self.hotkeyTooltip(for: hotkeyState)
        let menu = NSMenu(title: "Banana Tasks")
        menu.addItem(item("Show / Hide Banana Tasks", .toggleWindow))
        menu.addItem(item("New Task", .newTask, key: "n"))
        menu.addItem(item("Settings…", .settings, key: ","))
        menu.addItem(item("Start / Stop Timer", .toggleTimer))
        menu.addItem(.separator())
        let pin = item("Pin Window", .togglePin)
        pin.state = isPinned ? .on : .off
        pinItem = pin
        menu.addItem(pin)
        menu.addItem(.separator())
        menu.addItem(item("Quit Banana Tasks", .quit, key: "q"))
        statusItem.menu = menu
    }

    func updatePinned(_ value: Bool) { pinItem?.state = value ? .on : .off }
    func updateHotkey(_ state: TasksHotkeyState) { statusItem.button?.toolTip = Self.hotkeyTooltip(for: state) }

    private static func hotkeyTooltip(for state: TasksHotkeyState) -> String {
        guard state.registered else {
            let status = state.error == .verificationProfile ? "Global shortcut disabled in verification profile" : "Global shortcut unavailable"
            return "Banana Tasks · \(status) (\(state.display))"
        }
        return "Banana Tasks · \(state.display) to show or hide"
    }

    private func item(_ title: String, _ action: TasksMenuAction, key: String = "") -> NSMenuItem {
        let item = NSMenuItem(title: title, action: #selector(dispatch(_:)), keyEquivalent: key)
        item.target = self
        item.representedObject = action
        item.keyEquivalentModifierMask = .command
        return item
    }

    @objc private func dispatch(_ sender: NSMenuItem) {
        guard let action = sender.representedObject as? TasksMenuAction else { return }
        onAction?(action)
    }
}

@MainActor
final class TasksGlobalHotkeyService: TasksHotkeyRegistrationPort {
    private var hotKey: EventHotKeyRef?
    private var handler: EventHandlerRef?
    private var activeChord: TasksHotkeyChord?
    var onHotkey: (() -> Void)?

    func register(_ requested: TasksHotkeyChord) -> TasksHotkeyRegistration {
        if activeChord == requested { return TasksHotkeyRegistration(activeChord: activeChord, error: nil) }
        installHandler()
        guard handler != nil else {
            return TasksHotkeyRegistration(activeChord: activeChord, error: .registrationUnavailable)
        }
        let identifier = EventHotKeyID(signature: OSType(0x4254534B), id: 1)
        let replacement = TasksHotkeyReplacementPolicy.replace(current: hotKey, create: {
            var candidate: EventHotKeyRef?
            let status = RegisterEventHotKey(requested.keyCode, requested.modifiers, identifier,
                                             GetApplicationEventTarget(), 0, &candidate)
            guard status == noErr else { return nil }
            return candidate
        }, release: { current in _ = UnregisterEventHotKey(current) })
        guard replacement.replaced, let newHotKey = replacement.handle else {
            if hotKey == nil { removeHandlerIfUnused() }
            return TasksHotkeyRegistration(activeChord: activeChord, error: .registrationFailed)
        }
        hotKey = newHotKey
        activeChord = requested
        return TasksHotkeyRegistration(activeChord: activeChord, error: nil)
    }

    func unregister() {
        if let hotKey { _ = UnregisterEventHotKey(hotKey); self.hotKey = nil }
        activeChord = nil
        removeHandlerIfUnused()
    }

    private func installHandler() {
        guard handler == nil else { return }
        var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: OSType(kEventHotKeyPressed))
        let callback: EventHandlerProcPtr = { _, event, userData in
            guard let event, let userData else { return OSStatus(eventNotHandledErr) }
            var identifier = EventHotKeyID()
            let status = GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil,
                                           MemoryLayout<EventHotKeyID>.size, nil, &identifier)
            guard status == noErr, identifier.signature == OSType(0x4254534B), identifier.id == 1 else {
                return OSStatus(eventNotHandledErr)
            }
            let service = Unmanaged<TasksGlobalHotkeyService>.fromOpaque(userData).takeUnretainedValue()
            Task { @MainActor in service.onHotkey?() }
            return noErr
        }
        let status = InstallEventHandler(GetApplicationEventTarget(), callback, 1, &eventType,
                                         Unmanaged.passUnretained(self).toOpaque(), &handler)
        if status != noErr { handler = nil }
    }

    private func removeHandlerIfUnused() {
        guard hotKey == nil, let handler else { return }
        RemoveEventHandler(handler)
        self.handler = nil
    }
}
