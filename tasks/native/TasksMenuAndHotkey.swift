import AppKit
import Carbon

@MainActor
enum TasksMenuAction { case toggleWindow, newTask, settings, toggleTimer, togglePin, quit }

@MainActor
final class TasksMenuController: NSObject {
    private let statusItem: NSStatusItem
    private var pinItem: NSMenuItem?
    var onAction: ((TasksMenuAction) -> Void)?

    init(isPinned: Bool) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        super.init()
        let iconURL = Bundle.main.resourceURL?.appendingPathComponent("TasksMenuBar.svg")
        let image = iconURL.flatMap(NSImage.init(contentsOf:)) ?? NSImage(systemSymbolName: "checklist", accessibilityDescription: "Banana Tasks")
        image?.size = NSSize(width: 18, height: 18)
        image?.isTemplate = true
        statusItem.button?.image = image
        statusItem.button?.toolTip = "Banana Tasks · Control–Option–T to show or hide"
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
final class TasksGlobalHotkeyService {
    private var hotKey: EventHotKeyRef?
    private var handler: EventHandlerRef?
    var onHotkey: (() -> Void)?
    private(set) var registered = false

    func register() -> Bool {
        installHandler()
        guard handler != nil else { return false }
        let identifier = EventHotKeyID(signature: OSType(0x4254534B), id: 1)
        var replacement: EventHotKeyRef?
        let status = RegisterEventHotKey(UInt32(kVK_ANSI_T), UInt32(controlKey | optionKey), identifier,
                                         GetApplicationEventTarget(), 0, &replacement)
        guard status == noErr, let replacement else {
            unregister()
            return false
        }
        if let hotKey { UnregisterEventHotKey(hotKey) }
        hotKey = replacement
        registered = true
        return true
    }

    func unregister() {
        if let hotKey { UnregisterEventHotKey(hotKey); self.hotKey = nil }
        if let handler { RemoveEventHandler(handler); self.handler = nil }
        registered = false
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
}
