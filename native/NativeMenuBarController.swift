import AppKit

@MainActor
final class NativeMenuBarController {
    private weak var target: NSObject?
    let statusItem: NSStatusItem

    init(target: NSObject, hotkeyDisplay: String, hotkeyAvailable: Bool) {
        self.target = target
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = StatusItemIcon.make()
        statusItem.button?.imageScaling = .scaleNone
        statusItem.button?.imagePosition = .imageOnly
        installMenus(hotkeyDisplay: hotkeyDisplay, hotkeyAvailable: hotkeyAvailable)
    }

    func updateHotkey(display: String, registered: Bool) {
        statusItem.button?.toolTip = "Banana Notes · \(display) to show or hide"
        guard let menu = statusItem.menu else { return }
        for item in menu.items where item.title.localizedCaseInsensitiveContains("unavailable — use this menu") {
            menu.removeItem(item)
        }
        if !registered {
            if menu.items.last?.isSeparatorItem != true { menu.addItem(.separator()) }
            menu.addItem(item("\(display) unavailable — use this menu to open Banana Notes", "togglePanel"))
        }
    }

    private func installMenus(hotkeyDisplay: String, hotkeyAvailable: Bool) {
        let menu = NSMenu()
        menu.addItem(item("Show / Hide Banana Notes", "togglePanel"))
        menu.addItem(item("New Note", "newNote", key: "n"))
        menu.addItem(item("Notes", "openExplorer"))
        menu.addItem(item("Settings…", "openThemes"))
        menu.addItem(item("Reset Window Effects", "resetWindowEffects"))
        menu.addItem(item("Shortcuts", "showHelp"))
        menu.addItem(.separator())
        menu.addItem(item("Open Data Folder", "openDataFolder"))
        menu.addItem(.separator())
        menu.addItem(item("Quit Banana Notes", "quit", key: "q"))
        statusItem.menu = menu
        updateHotkey(display: hotkeyDisplay, registered: hotkeyAvailable)

        let mainMenu = NSMenu()
        let appRoot = NSMenuItem(title: "Banana Notes", action: nil, keyEquivalent: "")
        let appMenu = NSMenu(title: "Banana Notes")
        appMenu.addItem(item("About Banana Notes", "showAbout"))
        appMenu.addItem(.separator())
        appMenu.addItem(item("Settings…", "openThemes", key: ","))
        appMenu.addItem(item("Reset Window Effects", "resetWindowEffects"))
        appMenu.addItem(.separator())
        appMenu.addItem(item("Quit Banana Notes", "quit", key: "q"))
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
        copyMenu.addItem(item("Markdown", "copyMarkdown"))
        let formatted = item("Formatted Text", "copyFormatted", key: "c")
        formatted.keyEquivalentModifierMask = [.command, .option]
        copyMenu.addItem(formatted)
        copyMenu.addItem(item("HTML Source", "copyHTML"))
        copyMenu.addItem(item("Plain Text", "copyPlainText"))
        copyAs.submenu = copyMenu
        editRoot.submenu?.addItem(copyAs)
        editRoot.submenu?.addItem(item("Copy Entire Note as Markdown", "copyWholeNote"))
        mainMenu.addItem(editRoot)

        let viewRoot = NSMenuItem(title: "View", action: nil, keyEquivalent: "")
        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(item("Bigger Text", "biggerText", key: "+"))
        let biggerAlias = item("Bigger Text", "biggerText", key: "=")
        biggerAlias.isHidden = true
        biggerAlias.allowsKeyEquivalentWhenHidden = true
        viewMenu.addItem(biggerAlias)
        viewMenu.addItem(item("Smaller Text", "smallerText", key: "-"))
        viewMenu.addItem(item("Actual Text Size", "actualTextSize", key: "0"))
        viewRoot.submenu = viewMenu
        mainMenu.addItem(viewRoot)

        let windowRoot = NSMenuItem(title: "Window", action: nil, keyEquivalent: "")
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(item("Close Window", "hideAfterFlushMenu", key: "w"))
        windowRoot.submenu = windowMenu
        mainMenu.addItem(windowRoot)
        NSApp.mainMenu = mainMenu
    }

    private func item(_ title: String, _ actionName: String, key: String = "") -> NSMenuItem {
        let result = NSMenuItem(title: title, action: NSSelectorFromString(actionName), keyEquivalent: key)
        result.target = target
        return result
    }
}
