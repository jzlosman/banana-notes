import AppKit
import UniformTypeIdentifiers

@MainActor
final class ViewerApplicationRuntime {
    let webDirectory: URL
    let catalog: ViewerCatalog
    let preferencesStore: ViewerPreferencesStore
    private let menu = ViewerMenuController()
    private(set) var windowControllers: [ViewerWindowController] = []
    private var windowsByDocumentPath: [String: ViewerWindowController] = [:]
    private var started = false

    init(webDirectory: URL, defaults: UserDefaults = .standard) throws {
        self.webDirectory = webDirectory
        let themes = try Data(contentsOf: webDirectory.appendingPathComponent("theme-catalog.json"))
        let fonts = try Data(contentsOf: webDirectory.appendingPathComponent("note-font-catalog.json"))
        catalog = try ViewerCatalog(themeData: themes, fontData: fonts)
        preferencesStore = ViewerPreferencesStore(defaults: defaults, catalog: catalog)
    }

    func start(launchURLs: [URL] = []) {
        guard !started else { open(launchURLs); return }
        started = true
        menu.openDocument = { [weak self] in self?.presentOpenPanel() }
        menu.reloadDocument = { [weak self] in self?.activeController?.reloadDocument() }
        menu.revealDocument = { [weak self] in self?.activeController?.revealDocument() }
        menu.closeWindow = { [weak self] in self?.activeController?.window?.performClose(nil) }
        menu.openRecentDocument = { [weak self] in self?.open([$0]) }
        menu.clearRecentDocuments = { [weak self] in self?.preferencesStore.clearRecentDocuments() }
        menu.sendCommand = { [weak self] in self?.sendMenuCommand($0) }
        menu.install()
        menu.recentURLs = preferencesStore.recentDocumentURLs
        if launchURLs.isEmpty { createEmptyWindow().show() }
        else { open(launchURLs) }
    }

    func reopen() {
        if let controller = activeController { controller.show() }
        else if windowControllers.isEmpty { createEmptyWindow().show() }
    }

    func open(_ urls: [URL]) {
        for url in urls where url.isFileURL {
            let canonical = ViewerDocumentReader.canonicalURL(for: url)
            if let existing = windowsByDocumentPath[canonical.path] {
                existing.show()
                continue
            }
            let controller: ViewerWindowController
            if let empty = windowControllers.first(where: { $0.documentURL == nil }) {
                controller = empty
            } else {
                controller = createWindow()
            }
            controller.open(url, canonicalURL: canonical)
            windowsByDocumentPath[canonical.path] = controller
            menu.recentURLs = preferencesStore.recentDocumentURLs
            controller.show()
        }
    }

    func presentOpenPanel() {
        if windowControllers.isEmpty { createEmptyWindow().show() }
        let panel = NSOpenPanel()
        panel.title = "Open Markdown Document"
        panel.prompt = "Open"
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = true
        let types = ViewerDocumentReader.supportedExtensions.compactMap {
            UTType(filenameExtension: $0, conformingTo: .text)
        }
        panel.allowedContentTypes = types.isEmpty ? [.plainText] : types
        guard let parent = activeController?.window else {
            panel.begin { [weak self] response in
                if response == .OK { self?.open(panel.urls) }
            }
            return
        }
        panel.beginSheetModal(for: parent) { [weak self] response in
            if response == .OK { self?.open(panel.urls) }
        }
    }

    func sendMenuCommand(_ command: String) {
        guard command == "settings" || command == "find" || command == "source" ||
                command == "zoomIn" || command == "zoomOut" || command == "zoomReset" else { return }
        if command == "settings", windowControllers.isEmpty {
            let controller = createEmptyWindow()
            controller.show()
            controller.dispatchMenuCommand(command)
            return
        }
        activeController?.dispatchMenuCommand(command)
    }

    func broadcastPreferences() {
        for controller in windowControllers { controller.broadcastPreferences() }
    }

    func controller(for url: URL) -> ViewerWindowController? {
        windowsByDocumentPath[ViewerDocumentReader.canonicalURL(for: url).path]
    }

    func shutdown() {
        for controller in windowControllers { controller.window?.close() }
        windowControllers.removeAll()
        windowsByDocumentPath.removeAll()
    }

    private var activeController: ViewerWindowController? {
        if let keyWindow = NSApp.keyWindow,
           let controller = windowControllers.first(where: { $0.window === keyWindow }) { return controller }
        return windowControllers.last(where: { $0.window?.isVisible == true }) ?? windowControllers.last
    }

    @discardableResult
    private func createEmptyWindow() -> ViewerWindowController { createWindow() }

    @discardableResult
    private func createWindow() -> ViewerWindowController {
        let controller = ViewerWindowController(webDirectory: webDirectory, catalog: catalog,
                                                preferencesStore: preferencesStore)
        controller.onOpenDocument = { [weak self] in self?.open([$0]) }
        controller.onOpenPanel = { [weak self] in self?.presentOpenPanel() }
        controller.onPreferencesUpdated = { [weak self] in self?.broadcastPreferences() }
        controller.onClose = { [weak self, weak controller] in
            guard let self, let controller else { return }
            self.windowControllers.removeAll { $0 === controller }
            self.windowsByDocumentPath = self.windowsByDocumentPath.filter { $0.value !== controller }
        }
        windowControllers.append(controller)
        return controller
    }
}
