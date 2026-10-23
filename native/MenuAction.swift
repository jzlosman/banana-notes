import Foundation

enum MenuAction: String, CaseIterable {
    case togglePanel, newNote, openExplorer, openThemes, resetWindowEffects, togglePin, showHelp
    case openDataFolder, checkForUpdates, quit, showAbout, hideAfterFlush
    case biggerText, smallerText, actualTextSize
    case copyMarkdown, copyFormatted, copyHTML, copyPlainText, copyWholeNote
}
