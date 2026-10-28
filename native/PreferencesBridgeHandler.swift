import ServiceManagement

@MainActor
final class PreferencesBridgeHandler: BridgeHandler {
    let capability = BridgeCapability.preferences
    private let appearance: AppearancePreferences
    private let features: NativeFeatures?
    private let window: WindowCoordinator
    private let featurePreferences: FeaturePreferences
    private let hotkey: HotkeyCoordinator
    private let defaults: any PreferencesStore

    init(appearance: AppearancePreferences, features: NativeFeatures?, window: WindowCoordinator,
         featurePreferences: FeaturePreferences, hotkey: HotkeyCoordinator,
         defaults: any PreferencesStore = UserDefaults.standard) {
        self.appearance = appearance
        self.features = features
        self.window = window
        self.featurePreferences = featurePreferences
        self.hotkey = hotkey
        self.defaults = defaults
    }

    func handle(_ command: BridgeCommand, reply: @escaping BridgeReply) throws {
        switch command {
        case .featurePreferences(let enabled):
            featurePreferences.setOCR(enabled)
            reply(["ocrEnabled": featurePreferences.ocrEnabled], nil)
        case .scopePreferences(let value):
            let preferences = value ?? storedScopePreferences()
            if value != nil { defaults.set(preferences.storedValue, forKey: "scopePreferences") }
            reply(["scopePreferences": preferences.storedValue], nil)
        case .theme(let id):
            window.apply(theme: try appearance.select(id))
            reply(["themeID": appearance.selectedID], nil)
        case .hotkeyPreferences(let chord):
            reply(chord.map { hotkey.select($0) } ?? hotkey.reply(), nil)
        case .imagePreferences(let options):
            defaults.set(options.storedValue, forKey: "imageExportOptions")
            reply(["saved": true], nil)
        case .syntaxTheme(let id):
            guard let syntax = features?.syntax else { throw StoreError(message: "Syntax themes are unavailable.") }
            try syntax.select(id)
            reply(["syntaxThemeID": syntax.selectedID], nil)
        case .startupPreferences(let patch):
            guard let features else { throw StoreError(message: "Startup preferences are unavailable.") }
            if let enabled = patch.launchAtLogin { _ = try features.startup.configureLaunchAtLogin(enabled) }
            if let enabled = patch.newNoteOnLaunch { features.startup.configureNewNoteOnLaunch(enabled) }
            reply(features.preferenceReply, nil)
        case .openLoginSettings:
            SMAppService.openSystemSettingsLoginItems()
            reply(["ok": true], nil)
        default: throw StoreError(message: "Preferences bridge does not support this command.")
        }
    }

    private func storedScopePreferences() -> ScopePreferencesPayload {
        guard let stored = defaults.dictionary(forKey: "scopePreferences"),
              let pinnedTags = stored["pinnedTags"] as? [String],
              let bookmarks = stored["bookmarks"] as? [String: String],
              let preferences = try? ScopePreferencesPayload(pinnedTags: pinnedTags, bookmarks: bookmarks) else {
            return .empty
        }
        return preferences
    }
}

@MainActor
final class ClipboardBridgeHandler: BridgeHandler {
    let capability = BridgeCapability.clipboard

    func handle(_ command: BridgeCommand, reply: @escaping BridgeReply) throws {
        guard case .clipboard(let payload) = command else {
            throw StoreError(message: "Clipboard bridge does not support this command.")
        }
        try ClipboardContent(payload).write()
        reply(["copied": true], nil)
    }
}
