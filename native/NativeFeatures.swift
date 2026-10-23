import WebKit

/// Feature adapters composed once by the native application root.
@MainActor
final class NativeFeatures {
    let attachments: any AttachmentRepository
    let syntax: SyntaxPreferences
    let startup: StartupPreferences
    let semantic: SemanticSearchService
    let noteFonts: NoteFontStore
    let png: PNGExportService
    private let defaults: any PreferencesStore
    private var garbageCollectionWork: DispatchWorkItem?

    init(directory: URL, catalogURL: URL, defaults: any PreferencesStore = UserDefaults.standard) throws {
        self.defaults = defaults
        let attachments = try AttachmentStore(directory: directory)
        self.attachments = attachments
        syntax = SyntaxPreferences(defaults: defaults, catalogURL: catalogURL)
        startup = StartupPreferences(defaults: defaults)
        semantic = SemanticSearchService(directory: directory, defaults: defaults)
        let fonts = NoteFontStore(directory: directory, defaults: defaults)
        noteFonts = fonts
        png = PNGExportService(configurationFactory: {
            let configuration = WKWebViewConfiguration()
            configuration.setURLSchemeHandler(MediaSchemeHandler(store: attachments), forURLScheme: "foldnote-asset")
            configuration.setURLSchemeHandler(FontSchemeHandler(store: fonts), forURLScheme: "foldnote-font")
            return configuration
        }, fontCSS: { fonts.exportCSS(fontSize: FontSizePreferences(defaults: defaults).size, addingFontIDs: ["space-mono"]) })
    }

    var preferenceReply: [String: Any] {
        let state = startup.state
        return ["syntaxThemeID": syntax.selectedID, "launchAtLogin": state.launchAtLogin,
                "launchStatus": state.launchStatus, "launchError": state.launchError as Any? ?? NSNull(),
                "newNoteOnLaunch": state.newNoteOnLaunch,
                "imageOptions": defaults.dictionary(forKey: "imageExportOptions") ?? [:],
                "noteFonts": noteFonts.state]
    }

    func configureMedia(_ configuration: WKWebViewConfiguration) {
        configuration.setURLSchemeHandler(MediaSchemeHandler(store: attachments), forURLScheme: "foldnote-asset")
        configuration.setURLSchemeHandler(FontSchemeHandler(store: noteFonts), forURLScheme: "foldnote-font")
    }

    func scheduleAttachmentCollection(library: LibraryDocument?) {
        garbageCollectionWork?.cancel()
        guard let library else { return }
        let store = attachments
        let markdown = library.notes.map(\.markdown)
        let work = DispatchWorkItem {
            _ = try? store.collectGarbage(referencedMarkdown: markdown, now: SystemClock().now, grace: 24 * 60 * 60)
        }
        garbageCollectionWork = work
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 1, execute: work)
    }
}
