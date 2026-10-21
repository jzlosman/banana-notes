import AppKit
import WebKit
import ServiceManagement
import UniformTypeIdentifiers
import CoreFoundation

/// The web application invokes feature use cases through this native effect boundary.
@MainActor final class NativeFeatures {
    let attachments: AttachmentStore
    let syntax: SyntaxPreferences
    let startup: StartupPreferences
    let semantic: SemanticSearchService
    let noteFonts: NoteFontStore
    private var fontDownloadTask: Task<Void, Never>?
    private let png: PNGExportService
    private let defaults: UserDefaults

    init(directory: URL, catalogURL: URL, defaults: UserDefaults = .standard) throws {
        self.defaults = defaults
        let store = try AttachmentStore(directory: directory)
        attachments = store
        syntax = SyntaxPreferences(defaults: defaults, catalogURL: catalogURL)
        startup = StartupPreferences(defaults: defaults)
        semantic = SemanticSearchService(directory: directory, defaults: defaults)
        let fonts = NoteFontStore(directory: directory, defaults: defaults)
        noteFonts = fonts
        png = PNGExportService(configurationFactory: {
            let config = WKWebViewConfiguration()
            config.setURLSchemeHandler(MediaSchemeHandler(store: store), forURLScheme: "foldnote-asset")
            config.setURLSchemeHandler(FontSchemeHandler(store: fonts), forURLScheme: "foldnote-font")
            return config
        }, fontCSS: { fonts.exportCSS(fontSize: FontSizePreferences(defaults: defaults).size) })
    }

    var preferences: [String: Any] {
        let state = startup.state
        return ["syntaxThemeID": syntax.selectedID, "launchAtLogin": state.launchAtLogin,
                "launchStatus": state.launchStatus, "launchError": state.launchError as Any? ?? NSNull(),
                "newNoteOnLaunch": state.newNoteOnLaunch, "imageOptions": defaults.dictionary(forKey: "imageExportOptions") ?? [:],
                "noteFonts": noteFonts.state]
    }
    func configureMedia(_ config: WKWebViewConfiguration) {
        config.setURLSchemeHandler(MediaSchemeHandler(store: attachments), forURLScheme: "foldnote-asset")
        config.setURLSchemeHandler(FontSchemeHandler(store: noteFonts), forURLScheme: "foldnote-font")
    }
    func cancelFontDownload() { fontDownloadTask?.cancel() }
    private func boolean(_ value: Any?, _ label: String) throws -> Bool {
        guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else {
            throw StoreError(message: "\(label) must be enabled or disabled.")
        }
        return number.boolValue
    }

    @discardableResult
    func handle(action: String, body: [String: Any], window: NSWindow, ocrEnabled: Bool,
                presenting: @escaping (Bool) -> Void, reply: @escaping (Any?, String?) -> Void) throws -> Bool {
        switch action {
        case "noteFonts":
            reply(noteFonts.state, nil)
        case "noteFont":
            reply(try noteFonts.select(body["selection"]), nil)
        case "downloadNoteFont":
            guard let family = body["family"] as? String else { throw StoreError(message: "Enter a Google Fonts family name.") }
            guard fontDownloadTask == nil else { throw StoreError(message: "A font download is already in progress.") }
            fontDownloadTask = Task { @MainActor in
                defer { fontDownloadTask = nil }
                do { reply(try await noteFonts.download(family: family), nil) }
                catch is CancellationError { reply(nil, "Font download canceled.") }
                catch { reply(nil, error.localizedDescription) }
            }
        case "cancelFontDownload":
            if let task = fontDownloadTask {
                task.cancel()
                Task { @MainActor in await task.value; reply(["cancelled": true], nil) }
            } else { reply(["cancelled": true], nil) }
        case "imagePreferences":
            guard let values = body["imageOptions"] as? [String: Any], let gradient = values["gradient"] as? String,
                  ["dawn", "lavender", "ocean"].contains(gradient), let width = values["width"] as? Int,
                  (480...1200).contains(width), let padding = values["padding"] as? Int, (24...120).contains(padding) else {
                throw StoreError(message: "Choose a supported image style, width and padding.")
            }
            defaults.set(["gradient": gradient, "width": width, "padding": padding], forKey: "imageExportOptions")
            reply(["saved": true], nil)
        case "syntaxTheme":
            guard let id = body["syntaxThemeID"] as? String else { throw StoreError(message: "Choose a code theme.") }
            try syntax.select(id); reply(["syntaxThemeID": syntax.selectedID], nil)
        case "startupPreferences":
            let login = try body["launchAtLogin"].map { try boolean($0, "Launch at login") }
            let newNote = try body["newNoteOnLaunch"].map { try boolean($0, "New note on launch") }
            if let login { try startup.configureLaunchAtLogin(login) }
            if let newNote { startup.configureNewNoteOnLaunch(newNote) }
            reply(preferences, nil)
        case "openLoginSettings":
            SMAppService.openSystemSettingsLoginItems(); reply(["ok": true], nil)
        case "importAttachment":
            guard let name = body["name"] as? String, let mime = body["mimeType"] as? String,
                  let data = body["dataBase64"] as? String else { throw StoreError(message: "Attachment name, type and data are required.") }
            let store = attachments
            Task {
                do {
                    let record = try await Task.detached(priority: .userInitiated) { try store.importBase64(name: name, mimeType: mime, base64: data) }.value
                    reply(["attachment": record.bridgeValue], nil)
                } catch { reply(nil, error.localizedDescription) }
            }
        case "pickAttachments", "pickOCRImage":
            if action == "pickOCRImage" && !ocrEnabled { throw StoreError(message: "Enable image text recognition in Settings → General.") }
            let picker = NSOpenPanel(); picker.title = action == "pickOCRImage" ? "Recognize Image Text" : "Attach Images, Audio or Video"
            picker.canChooseDirectories = false; picker.canChooseFiles = true
            picker.allowsMultipleSelection = action == "pickAttachments"
            picker.allowedContentTypes = action == "pickOCRImage" ? [.image] : [.image, .audio, .movie]
            presenting(true)
            picker.beginSheetModal(for: window) { [weak self] response in
                guard let self else { return }
                presenting(false)
                guard response == .OK else { reply(["cancelled": true, "attachments": []], nil); return }
                let urls = picker.urls, store = self.attachments
                Task {
                    do {
                        if action == "pickOCRImage" {
                            guard let url = urls.first else { throw StoreError(message: "Choose an image.") }
                            let text = try await OCRService().recognize(url: url)
                            reply(["text": text], nil)
                        } else {
                            let records = try await Task.detached(priority: .userInitiated) { try urls.map { try store.importURL($0) } }.value
                            reply(["attachments": records.map(\.bridgeValue)], nil)
                        }
                    } catch { reply(nil, error.localizedDescription) }
                }
            }
        case "ocrAttachment":
            guard ocrEnabled else { throw StoreError(message: "Enable image text recognition in Settings → General.") }
            guard let raw = body["url"] as? String, let url = URL(string: raw) else { throw StoreError(message: "Select an image attachment.") }
            let (file, mime) = try attachments.resolveAssetURL(url)
            guard mime.hasPrefix("image/") else { throw StoreError(message: "OCR requires an image.") }
            Task { do { reply(["text": try await OCRService().recognize(url: file)], nil) } catch { reply(nil, error.localizedDescription) } }
        case "openAttachment":
            guard let raw = body["url"] as? String, let url = URL(string: raw) else { throw StoreError(message: "Select an attachment.") }
            let (file, _) = try attachments.resolveAssetURL(url)
            guard NSWorkspace.shared.open(file) else { throw StoreError(message: "This attachment could not be opened.") }
            reply(["ok": true], nil)
        case "exportPNG":
            guard let fields = body["request"] as? [String: Any], let html = fields["html"] as? String,
                  let title = fields["title"] as? String, let start = fields["backgroundStart"] as? String,
                  let end = fields["backgroundEnd"] as? String, let paper = fields["paper"] as? String,
                  let text = fields["text"] as? String, let accent = fields["accent"] as? String,
                  let width = fields["width"] as? Int, let padding = fields["padding"] as? Int else {
                throw StoreError(message: "Image export content and settings are required.")
            }
            let request = NoteImageRequest(html: html, title: title, backgroundStart: start, backgroundEnd: end,
                                           paper: paper, text: text, accent: accent, width: width, padding: padding)
            presenting(true)
            png.export(request: request, presenting: window) { result in
                presenting(false)
                switch result {
                case .success: reply(["exported": true], nil)
                case .failure(PNGExportError.saveCancelled): reply(["cancelled": true], nil)
                case .failure(let error): reply(nil, error.localizedDescription)
                }
            }
        case "semanticStatus", "semanticEnable", "semanticStartRuntime", "semanticDownload", "semanticIndex", "semanticSearch", "semanticClear", "semanticCancel":
            Task { do { reply(try await semantic.handle(action: action, payload: body), nil) } catch { reply(nil, error.localizedDescription) } }
        default: return false
        }
        return true
    }
}
