import AppKit
import UniformTypeIdentifiers

@MainActor
final class ViewerApplicationRuntime {
    let webDirectory: URL
    let catalog: ViewerCatalog
    let preferencesStore: ViewerPreferencesStore
    private let defaultApplicationManager: ViewerDefaultApplicationManager
    private let menu: ViewerMenuController
    private(set) var windowControllers: [ViewerWindowController] = []
    private var windowsByDocumentPath: [String: ViewerWindowController] = [:]
    private weak var presentedController: ViewerWindowController?
    private var started = false

    init(webDirectory: URL, defaults: UserDefaults = .standard, launchServices: ViewerLaunchServices? = nil,
         menuPresenter: ViewerMenuPresenter? = nil) throws {
        self.menu = ViewerMenuController(presenter: menuPresenter)
        self.webDirectory = webDirectory
        let themes = try Data(contentsOf: webDirectory.appendingPathComponent("theme-catalog.json"))
        let fonts = try Data(contentsOf: webDirectory.appendingPathComponent("note-font-catalog.json"))
        catalog = try ViewerCatalog(themeData: themes, fontData: fonts)
        preferencesStore = ViewerPreferencesStore(defaults: defaults, catalog: catalog)
        defaultApplicationManager = ViewerDefaultApplicationManager(launchServices: launchServices ?? SystemViewerLaunchServices(), memory: preferencesStore)
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
        if launchURLs.isEmpty { present(createEmptyWindow()) }
        else { open(launchURLs) }
    }

    func reopen() {
        if let controller = activeController { present(controller) }
        else if windowControllers.isEmpty { present(createEmptyWindow()) }
    }

    func open(_ urls: [URL]) {
        for url in urls where url.isFileURL {
            let canonical = ViewerDocumentReader.canonicalURL(for: url)
            if let existing = windowsByDocumentPath[canonical.path] {
                if existing.window != nil {
                    present(existing)
                    continue
                }
                windowsByDocumentPath.removeValue(forKey: canonical.path)
                windowControllers.removeAll { $0 === existing }
                if presentedController === existing { presentedController = nil }
            }
            let controller: ViewerWindowController
            if let empty = windowControllers.first(where: { $0.documentURL == nil }) {
                controller = empty
            } else {
                controller = createWindow()
            }
            presentedController = controller
            controller.open(url, canonicalURL: canonical)
            windowsByDocumentPath[canonical.path] = controller
            menu.recentURLs = preferencesStore.recentDocumentURLs
            present(controller)
        }
    }

    func presentOpenPanel() {
        if windowControllers.isEmpty { present(createEmptyWindow()) }
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
                command == "zoomIn" || command == "zoomOut" || command == "zoomReset" ||
                command == "toggleEditing" || command == "save" || command == "saveForClose" else { return }
        if command == "settings", windowControllers.isEmpty {
            let controller = createEmptyWindow()
            present(controller)
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

    func confirmTermination(_ completion: @escaping (Bool) -> Void) {
        let dirtyControllers = windowControllers.filter(\.hasUnsavedEdits)
        func confirm(_ index: Int) {
            guard index < dirtyControllers.count else { completion(true); return }
            dirtyControllers[index].confirmTermination { accepted in
                guard accepted else { completion(false); return }
                confirm(index + 1)
            }
        }
        confirm(0)
    }

    func shutdown() {
        for controller in windowControllers { controller.window?.close() }
        windowControllers.removeAll()
        windowsByDocumentPath.removeAll()
        presentedController = nil
    }

    private var activeController: ViewerWindowController? {
        if let keyWindow = NSApp.keyWindow,
           let controller = windowControllers.first(where: { $0.window === keyWindow }) { return controller }
        if let presentedController, presentedController.window?.isVisible == true { return presentedController }
        return windowControllers.last(where: { $0.window?.isVisible == true }) ?? windowControllers.last
    }

    private func present(_ controller: ViewerWindowController) {
        presentedController = controller
        menu.currentDocumentURL = controller.documentURL
        controller.show()
        menu.setEditingState(controller.currentEditingState)
    }

    @discardableResult
    private func createEmptyWindow() -> ViewerWindowController { createWindow() }

    @discardableResult
    private func createWindow() -> ViewerWindowController {
        let controller = ViewerWindowController(webDirectory: webDirectory, catalog: catalog,
                                                preferencesStore: preferencesStore,
                                                defaultApplicationManager: defaultApplicationManager)
        controller.onOpenDocument = { [weak self] in self?.open([$0]) }
        controller.onOpenPanel = { [weak self] in self?.presentOpenPanel() }
        controller.onOpenMenu = { [weak self, weak controller] point in
            guard let self, let controller else { return }
            self.menu.currentDocumentURL = controller.documentURL
            self.menu.presentOpenMenu(at: point, in: controller.webView, currentDocumentURL: controller.documentURL)
        }
        controller.onWindowBecameKey = { [weak self, weak controller] _ in
            guard let self, let controller else { return }
            self.menu.currentDocumentURL = controller.documentURL
        }
        controller.onPreferencesUpdated = { [weak self] in self?.broadcastPreferences() }
        controller.onEditingStateChanged = { [weak self, weak controller] state in
            guard let self, let controller, self.activeController === controller else { return }
            self.menu.setEditingState(state)
        }
        controller.onClose = { [weak self, weak controller] in
            guard let self, let controller else { return }
            self.windowControllers.removeAll { $0 === controller }
            self.windowsByDocumentPath = self.windowsByDocumentPath.filter { $0.value !== controller }
            if self.presentedController === controller {
                self.presentedController = self.windowControllers.last(where: { $0.window?.isVisible == true })
                if let active = self.activeController { self.menu.setEditingState(active.currentEditingState) }
            }
        }
        windowControllers.append(controller)
        return controller
    }
}
