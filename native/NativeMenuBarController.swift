import AppKit

@MainActor
final class NativeMenuBarController: NSObject {
    private let onAction: (MenuAction) -> Void
    private var pinMenuItem: NSMenuItem?
    let statusItem: NSStatusItem

    init(hotkeyDisplay: String, hotkeyAvailable: Bool, updatesAvailable: Bool = false, isPinned: Bool,
         onAction: @escaping (MenuAction) -> Void) {
        self.onAction = onAction
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        super.init()
        statusItem.button?.image = StatusItemIcon.make()
        statusItem.button?.imageScaling = .scaleNone
        statusItem.button?.imagePosition = .imageOnly
        installMenus(hotkeyDisplay: hotkeyDisplay, hotkeyAvailable: hotkeyAvailable, updatesAvailable: updatesAvailable, isPinned: isPinned)
    }

    func updatePinned(_ isPinned: Bool) {
        pinMenuItem?.state = isPinned ? .on : .off
    }

    func updateHotkey(display: String, registered: Bool) {
        statusItem.button?.toolTip = "Banana Notes · \(display) to show or hide"
        guard let menu = statusItem.menu else { return }
        for item in menu.items where item.title.localizedCaseInsensitiveContains("unavailable — use this menu") {
            menu.removeItem(item)
        }
        if !registered {
            if menu.items.last?.isSeparatorItem != true { menu.addItem(.separator()) }
            menu.addItem(item("\(display) unavailable — use this menu to open Banana Notes", .togglePanel))
        }
    }

    private func installMenus(hotkeyDisplay: String, hotkeyAvailable: Bool, updatesAvailable: Bool, isPinned: Bool) {
        let menu = NSMenu()
        menu.addItem(item("Show / Hide Banana Notes", .togglePanel))
        menu.addItem(item("New Note", .newNote, key: "n"))
        menu.addItem(item("Notes", .openExplorer))
        menu.addItem(item("Settings…", .openThemes))
        if updatesAvailable { menu.addItem(item("Check for Updates…", .checkForUpdates)) }
        menu.addItem(item("Reset Window Effects", .resetWindowEffects))
        menu.addItem(item("Shortcuts", .showHelp))
        menu.addItem(.separator())
        menu.addItem(item("Report a Bug…", .reportBug))
        menu.addItem(.separator())
        menu.addItem(item("Open Data Folder", .openDataFolder))
        menu.addItem(.separator())
        menu.addItem(item("Quit Banana Notes", .quit, key: "q"))
        statusItem.menu = menu
        updateHotkey(display: hotkeyDisplay, registered: hotkeyAvailable)

        let mainMenu = NSMenu()
        let appRoot = NSMenuItem(title: "Banana Notes", action: nil, keyEquivalent: "")
        let appMenu = NSMenu(title: "Banana Notes")
        appMenu.addItem(item("About Banana Notes", .showAbout))
        if updatesAvailable { appMenu.addItem(item("Check for Updates…", .checkForUpdates)) }
        appMenu.addItem(.separator())
        appMenu.addItem(item("Settings…", .openThemes, key: ","))
        appMenu.addItem(item("Reset Window Effects", .resetWindowEffects))
        appMenu.addItem(.separator())
        appMenu.addItem(item("Quit Banana Notes", .quit, key: "q"))
        appRoot.submenu = appMenu
        mainMenu.addItem(appRoot)

        let editRoot = NSMenuItem()
        editRoot.submenu = NSMenu(title: "Edit")
        for (title, selector, key) in [("Undo", "undo:", "z"), ("Redo", "redo:", "Z"), ("Cut", "cut:", "x"),
                                       ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            let menuItem = NSMenuItem(title: title, action: NSSelectorFromString(selector), keyEquivalent: key)
            menuItem.keyEquivalentModifierMask = title == "Redo" ? [.command, .shift] : .command
            editRoot.submenu?.addItem(menuItem)
        }
        editRoot.submenu?.addItem(.separator())
        let copyAs = NSMenuItem(title: "Copy As", action: nil, keyEquivalent: "")
        let copyMenu = NSMenu(title: "Copy As")
        copyMenu.addItem(item("Markdown", .copyMarkdown))
        let formatted = item("Formatted Text", .copyFormatted, key: "c")
        formatted.keyEquivalentModifierMask = [.command, .option]
        copyMenu.addItem(formatted)
        copyMenu.addItem(item("HTML Source", .copyHTML))
        copyMenu.addItem(item("Plain Text", .copyPlainText))
        copyAs.submenu = copyMenu
        editRoot.submenu?.addItem(copyAs)
        editRoot.submenu?.addItem(item("Copy Entire Note as Markdown", .copyWholeNote))
        mainMenu.addItem(editRoot)

        let viewRoot = NSMenuItem(title: "View", action: nil, keyEquivalent: "")
        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(item("Bigger Text", .biggerText, key: "+"))
        let biggerAlias = item("Bigger Text", .biggerText, key: "=")
        biggerAlias.isHidden = true
        biggerAlias.allowsKeyEquivalentWhenHidden = true
        viewMenu.addItem(biggerAlias)
        viewMenu.addItem(item("Smaller Text", .smallerText, key: "-"))
        viewMenu.addItem(item("Actual Text Size", .actualTextSize, key: "0"))
        viewRoot.submenu = viewMenu
        mainMenu.addItem(viewRoot)

        let windowRoot = NSMenuItem(title: "Window", action: nil, keyEquivalent: "")
        let windowMenu = NSMenu(title: "Window")
        let pin = item("Pin Window", .togglePin, key: "p")
        pin.keyEquivalentModifierMask = [.command, .shift]
        pin.state = isPinned ? .on : .off
        pinMenuItem = pin
        windowMenu.addItem(pin)
        windowMenu.addItem(item("Close Window", .hideAfterFlush, key: "w"))
        windowRoot.submenu = windowMenu
        mainMenu.addItem(windowRoot)

        let helpRoot = NSMenuItem(title: "Help", action: nil, keyEquivalent: "")
        let helpMenu = NSMenu(title: "Help")
        helpMenu.addItem(item("Shortcuts", .showHelp))
        helpMenu.addItem(.separator())
        helpMenu.addItem(item("Report a Bug…", .reportBug))
        helpRoot.submenu = helpMenu
        NSApp.helpMenu = helpMenu
        mainMenu.addItem(helpRoot)
        NSApp.mainMenu = mainMenu
    }

    private func item(_ title: String, _ menuAction: MenuAction, key: String = "") -> NSMenuItem {
        let result = NSMenuItem(title: title, action: #selector(dispatchMenuAction(_:)), keyEquivalent: key)
        result.keyEquivalentModifierMask = .command
        result.target = self
        result.representedObject = menuAction
        return result
    }

    @objc private func dispatchMenuAction(_ sender: NSMenuItem) {
        guard let action = sender.representedObject as? MenuAction else { return }
        onAction(action)
    }
}
