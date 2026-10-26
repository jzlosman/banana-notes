import AppKit

@MainActor
final class MenuActionCoordinator {
    private let window: WindowCoordinator
    private let channel: WebCommandChannel
    private let windowStyle: WindowStylePreferences
    private let dataDirectory: URL
    private let checkForUpdates: () -> Void
    private let reportBug: () -> Void

    init(window: WindowCoordinator, channel: WebCommandChannel, windowStyle: WindowStylePreferences,
         dataDirectory: URL, checkForUpdates: @escaping () -> Void = {}, reportBug: @escaping () -> Void = {}) {
        self.window = window
        self.channel = channel
        self.windowStyle = windowStyle
        self.dataDirectory = dataDirectory
        self.checkForUpdates = checkForUpdates
        self.reportBug = reportBug
    }

    func handle(_ action: MenuAction) {
        switch action {
        case .togglePanel: window.toggle()
        case .newNote: show(.new)
        case .openExplorer: show(.explorer)
        case .openThemes: show(.themes)
        case .showHelp: show(.help)
        case .resetWindowEffects:
            do {
                try windowStyle.reset()
                window.applyWindowStyle()
                channel.send(.windowStyle(windowStyle.style))
                window.show()
            } catch { window.onError?(error.localizedDescription) }
        case .togglePin:
            window.setPinned(!window.isPinned)
            channel.send(.pin(window.isPinned))
        case .openDataFolder:
            if !NSWorkspace.shared.open(dataDirectory) { window.onError?("The data folder could not be opened.") }
        case .checkForUpdates: checkForUpdates()
        case .reportBug: reportBug()
        case .quit: NSApp.terminate(nil)
        case .showAbout: showAbout()
        case .hideAfterFlush: window.hideAfterFlush()
        case .biggerText: channel.send(.fontIncrease)
        case .smallerText: channel.send(.fontDecrease)
        case .actualTextSize: channel.send(.fontReset)
        case .copyMarkdown: channel.send(.copy(.markdown, whole: false))
        case .copyFormatted: channel.send(.copy(.formatted, whole: false))
        case .copyHTML: channel.send(.copy(.html, whole: false))
        case .copyPlainText: channel.send(.copy(.text, whole: false))
        case .copyWholeNote: channel.send(.copy(.markdown, whole: true))
        }
    }

    private func show(_ command: WebCommand) {
        window.show()
        channel.send(command)
    }

    private func showAbout() {
        let info = Bundle.main.infoDictionary ?? [:]
        var options: [NSApplication.AboutPanelOptionKey: Any] = [.applicationName: "Banana Notes"]
        if let version = info["CFBundleShortVersionString"] as? String { options[.applicationVersion] = version }
        if let build = info["CFBundleVersion"] as? String { options[.version] = build }
        NSApp.orderFrontStandardAboutPanel(options: options)
    }
}
