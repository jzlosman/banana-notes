import AppKit

@MainActor
final class ViewerMenuController: NSObject {
    var openDocument: (() -> Void)?
    var reloadDocument: (() -> Void)?
    var revealDocument: (() -> Void)?
    var closeWindow: (() -> Void)?
    var openRecentDocument: ((URL) -> Void)?
    var sendCommand: ((String) -> Void)?
    var clearRecentDocuments: (() -> Void)?
    var recentURLs: [URL] = [] { didSet { rebuildRecentMenu() } }

    private var recentMenu: NSMenu?
    private var editingItem: NSMenuItem?
    private var saveItem: NSMenuItem?
    private var editingState: ViewerEditingState = .locked

    func install() {
        let mainMenu = NSMenu()

        let appRoot = NSMenuItem(title: "Banana Viewer", action: nil, keyEquivalent: "")
        let appMenu = NSMenu(title: "Banana Viewer")
        appMenu.addItem(item("About Banana Viewer", #selector(showAbout)))
        appMenu.addItem(.separator())
        appMenu.addItem(item("Settings…", #selector(settings), key: ","))
        appMenu.addItem(.separator())
        appMenu.addItem(item("Quit Banana Viewer", #selector(quit), key: "q"))
        appRoot.submenu = appMenu
        mainMenu.addItem(appRoot)

        let fileRoot = NSMenuItem(title: "File", action: nil, keyEquivalent: "")
        let fileMenu = NSMenu(title: "File")
        fileMenu.addItem(item("Open…", #selector(open), key: "o"))
        let recentItem = NSMenuItem(title: "Open Recent", action: nil, keyEquivalent: "")
        recentMenu = NSMenu(title: "Open Recent")
        recentItem.submenu = recentMenu
        fileMenu.addItem(recentItem)
        fileMenu.addItem(.separator())
        saveItem = item("Save", #selector(save), key: "s")
        saveItem?.isEnabled = false
        fileMenu.addItem(saveItem!)
        fileMenu.addItem(item("Reload", #selector(reload), key: "r"))
        fileMenu.addItem(item("Reveal in Finder", #selector(reveal)))
        fileMenu.addItem(.separator())
        fileMenu.addItem(item("Close Window", #selector(close), key: "w"))
        fileRoot.submenu = fileMenu
        mainMenu.addItem(fileRoot)

        let editRoot = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(NSMenuItem(title: "Undo", action: nil, keyEquivalent: "z"))
        editMenu.addItem(NSMenuItem(title: "Redo", action: nil, keyEquivalent: "Z"))
        editMenu.items.last?.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editingItem = item("Unlock to Edit", #selector(toggleEditing), key: "e")
        editMenu.addItem(editingItem!)
        editMenu.addItem(.separator())
        for (title, selector, key) in [("Cut", "cut:", "x"), ("Copy", "copy:", "c"),
                                       ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            editMenu.addItem(NSMenuItem(title: title, action: NSSelectorFromString(selector), keyEquivalent: key))
        }
        editMenu.addItem(.separator())
        editMenu.addItem(item("Find…", #selector(find), key: "f"))
        editRoot.submenu = editMenu
        mainMenu.addItem(editRoot)

        let viewRoot = NSMenuItem(title: "View", action: nil, keyEquivalent: "")
        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(item("Bigger Text", #selector(zoomIn), key: "+"))
        let zoomAlias = item("Bigger Text", #selector(zoomIn), key: "=")
        zoomAlias.isHidden = true
        zoomAlias.allowsKeyEquivalentWhenHidden = true
        viewMenu.addItem(zoomAlias)
        viewMenu.addItem(item("Smaller Text", #selector(zoomOut), key: "-"))
        viewMenu.addItem(item("Actual Text Size", #selector(zoomReset), key: "0"))
        viewMenu.addItem(.separator())
        let source = item("View Source", #selector(showSource), key: "m")
        source.keyEquivalentModifierMask = [.command, .shift]
        viewMenu.addItem(source)
        viewRoot.submenu = viewMenu
        mainMenu.addItem(viewRoot)

        let windowRoot = NSMenuItem(title: "Window", action: nil, keyEquivalent: "")
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(item("Close Window", #selector(close), key: "w"))
        windowRoot.submenu = windowMenu
        mainMenu.addItem(windowRoot)
        NSApp.mainMenu = mainMenu
        rebuildRecentMenu()
    }

    @objc private func open() { openDocument?() }
    @objc private func reload() { reloadDocument?() }
    @objc private func reveal() { revealDocument?() }
    @objc private func close() { closeWindow?() }
    @objc private func settings() { sendCommand?("settings") }
    @objc private func toggleEditing() { sendCommand?("toggleEditing") }
    @objc private func save() { sendCommand?("save") }

    func setEditingState(_ state: ViewerEditingState) {
        editingState = state
        editingItem?.title = state.isUnlocked ? "Lock Editing" : "Unlock to Edit"
        saveItem?.isEnabled = state.isDirty
    }
    @objc private func find() { sendCommand?("find") }
    @objc private func zoomIn() { sendCommand?("zoomIn") }
    @objc private func zoomOut() { sendCommand?("zoomOut") }
    @objc private func zoomReset() { sendCommand?("zoomReset") }
    @objc private func showSource() { sendCommand?("source") }
    @objc private func quit() { NSApp.terminate(nil) }
    @objc private func showAbout() { NSApp.orderFrontStandardAboutPanel(nil) }

    @objc private func openRecent(_ sender: NSMenuItem) {
        guard let url = sender.representedObject as? URL else { return }
        openRecentDocument?(url)
    }

    private func item(_ title: String, _ action: Selector, key: String = "") -> NSMenuItem {
        let result = NSMenuItem(title: title, action: action, keyEquivalent: key)
        result.target = self
        result.keyEquivalentModifierMask = .command
        return result
    }

    private func rebuildRecentMenu() {
        guard let recentMenu else { return }
        recentMenu.removeAllItems()
        if recentURLs.isEmpty {
            let empty = NSMenuItem(title: "No Recent Documents", action: nil, keyEquivalent: "")
            empty.isEnabled = false
            recentMenu.addItem(empty)
            return
        }
        for url in recentURLs {
            let item = NSMenuItem(title: url.lastPathComponent, action: #selector(openRecent(_:)), keyEquivalent: "")
            item.representedObject = url
            item.target = self
            item.toolTip = url.path
            recentMenu.addItem(item)
        }
        let clear = NSMenuItem(title: "Clear Menu", action: #selector(clearRecent), keyEquivalent: "")
        clear.target = self
        recentMenu.addItem(.separator())
        recentMenu.addItem(clear)
    }

    @objc private func clearRecent() { recentURLs = []; clearRecentDocuments?() }
}
