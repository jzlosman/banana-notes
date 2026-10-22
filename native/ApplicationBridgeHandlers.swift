import AppKit

@MainActor
final class ApplicationBridgeHandler: BridgeHandler {
    let capability = BridgeCapability.application
    private let store: any LibraryRepository
    private let features: NativeFeatures?
    private let appearance: AppearancePreferences
    private let window: WindowCoordinator
    private let fontSize: FontSizePreferences
    private let featurePreferences: FeaturePreferences
    private let hotkey: HotkeyCoordinator
    private let featureSetupError: String?

    init(store: any LibraryRepository, features: NativeFeatures?, appearance: AppearancePreferences,
         window: WindowCoordinator, fontSize: FontSizePreferences, featurePreferences: FeaturePreferences,
         hotkey: HotkeyCoordinator, featureSetupError: String?) {
        self.store = store
        self.features = features
        self.appearance = appearance
        self.window = window
        self.fontSize = fontSize
        self.featurePreferences = featurePreferences
        self.hotkey = hotkey
        self.featureSetupError = featureSetupError
    }

    func handle(_ command: BridgeCommand, reply: @escaping BridgeReply) throws {
        switch command {
        case .load:
            let library = try store.load()
            features?.scheduleAttachmentCollection(library: library)
            let libraryValue: Any = try library.map { try BridgeWireEncoder.foundationValue($0) } ?? NSNull()
            var state: [String: Any] = [
                "library": libraryValue,
                "pinned": window.isPinned,
                "hotkey": hotkey.chord.display,
                "hotkeyAvailable": hotkey.available,
                "hotkeyStatus": hotkey.available ? "\(hotkey.chord.display) toggles Banana Notes." : "\(hotkey.chord.display) could not be registered. Use the Banana Notes menu bar icon to open the app.",
                "dataDirectory": store.directory.path,
                "themeID": appearance.selectedID,
                "themeWarning": appearance.catalogError as Any? ?? NSNull(),
                "focused": window.isFocused,
                "windowStyle": window.style.bridgeValue,
                "fontSize": fontSize.size,
                "ocrEnabled": featurePreferences.ocrEnabled,
                "featureWarning": featureSetupError as Any? ?? NSNull()
            ]
            for (key, value) in features?.preferenceReply ?? [:] { state[key] = value }
            reply(state, nil)
        case .openData:
            guard NSWorkspace.shared.open(store.directory) else { throw StoreError(message: "The data folder could not be opened.") }
            reply(["ok": true], nil)
        case .quit:
            reply(["ok": true], nil)
            DispatchQueue.main.async { NSApp.terminate(nil) }
        default: throw StoreError(message: "Application bridge does not support this command.")
        }
    }
}

@MainActor
final class LibraryBridgeHandler: BridgeHandler {
    let capability = BridgeCapability.library
    private let store: any LibraryRepository
    private let features: NativeFeatures?
    private let isClosing: () -> Bool

    init(store: any LibraryRepository, features: NativeFeatures?, isClosing: @escaping () -> Bool) {
        self.store = store
        self.features = features
        self.isClosing = isClosing
    }

    func handle(_ command: BridgeCommand, reply: @escaping BridgeReply) throws {
        switch command {
        case .save(let library):
            guard !isClosing() else { throw StoreError(message: "Banana Notes is closing and cannot accept more saves.") }
            store.saveAsync(library) { [weak self] result in
                DispatchQueue.main.async {
                    switch result {
                    case .success:
                        self?.features?.scheduleAttachmentCollection(library: library)
                        reply(["saved": true], nil)
                    case .failure(let error): reply(nil, error.localizedDescription)
                    }
                }
            }
        case .libraryRecovery:
            let status = store.recoveryStatus()
            var value: [String: Any] = ["startupError": status.startupError as Any? ?? NSNull(), "backupAvailable": status.backupAvailable]
            if let updatedAt = status.backupUpdatedAt { value["backupUpdatedAt"] = updatedAt }
            if let noteCount = status.backupNoteCount { value["backupNoteCount"] = noteCount }
            reply(value, nil)
        case .restoreBackup:
            try store.restoreBackup()
            features?.scheduleAttachmentCollection(library: try store.load())
            reply(["restored": true], nil)
        default: throw StoreError(message: "Library bridge does not support this command.")
        }
    }
}

@MainActor
final class WindowBridgeHandler: BridgeHandler {
    let capability = BridgeCapability.window
    private let window: WindowCoordinator
    private let channel: WebCommandChannel
    private let windowStyle: WindowStylePreferences
    private let fontSize: FontSizePreferences

    init(window: WindowCoordinator, channel: WebCommandChannel,
         windowStyle: WindowStylePreferences, fontSize: FontSizePreferences) {
        self.window = window
        self.channel = channel
        self.windowStyle = windowStyle
        self.fontSize = fontSize
    }

    func handle(_ command: BridgeCommand, reply: @escaping BridgeReply) throws {
        switch command {
        case .ready:
            channel.markReady()
            window.updateFocus()
            window.publishFocus()
            reply(["ok": true], nil)
        case .hide:
            window.hideAfterFlush()
            reply(["ok": true], nil)
        case .dragRegion(let rect):
            guard let content = window.nativeWindow?.contentView as? WindowContentView,
                  content.updateDragRegion(NSRect(x: CGFloat(rect.x), y: CGFloat(rect.y),
                                                  width: CGFloat(rect.width), height: CGFloat(rect.height))) else {
                throw StoreError(message: "The toolbar drag area is invalid.")
            }
            reply(["ok": true], nil)
        case .pin(let value):
            window.setPinned(value)
            reply(["pinned": window.isPinned], nil)
        case .fontSize(let value):
            try fontSize.save(value)
            reply(["fontSize": fontSize.size], nil)
        case .windowStyle(let style):
            try windowStyle.save(style)
            window.applyWindowStyle()
            reply(["windowStyle": style.bridgeValue], nil)
        default: throw StoreError(message: "Window bridge does not support this command.")
        }
    }
}
