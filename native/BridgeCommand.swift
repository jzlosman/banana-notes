import Foundation

enum BridgeCapability: Hashable, CaseIterable {
    case application, library, window, preferences, clipboard, markdownExport
    case attachments, fonts, pngExport, semantic
}

enum BridgeCommand {
    case load, openData, quit
    case save(LibraryDocument), libraryRecovery, restoreBackup
    case ready, hide, dragRegion(BridgeRect), pin(Bool), fontSize(Int), windowStyle(WindowStyle)
    case featurePreferences(ocrEnabled: Bool), theme(String), hotkeyPreferences(HotkeyChord?)
    case imagePreferences(ImageExportPreferences), syntaxTheme(String), startupPreferences(StartupPreferencesPatch), openLoginSettings
    case clipboard(ClipboardPayload), markdownExport([MarkdownExportNote])
    case importAttachment(AttachmentImportRequest), pickAttachments, pickOCRImage
    case ocrAttachment(AttachmentURLRequest), openAttachment(AttachmentURLRequest)
    case noteFonts, noteFont(NoteFontSelection), downloadNoteFont(String), cancelFontDownload
    case exportPNG(NoteImageRequest), semantic(SemanticCommand)

    var capability: BridgeCapability {
        switch self {
        case .load, .openData, .quit: .application
        case .save, .libraryRecovery, .restoreBackup: .library
        case .ready, .hide, .dragRegion, .pin, .fontSize, .windowStyle: .window
        case .featurePreferences, .theme, .hotkeyPreferences, .imagePreferences, .syntaxTheme,
             .startupPreferences, .openLoginSettings: .preferences
        case .clipboard: .clipboard
        case .markdownExport: .markdownExport
        case .importAttachment, .pickAttachments, .pickOCRImage, .ocrAttachment, .openAttachment: .attachments
        case .noteFonts, .noteFont, .downloadNoteFont, .cancelFontDownload: .fonts
        case .exportPNG: .pngExport
        case .semantic: .semantic
        }
    }
}

typealias BridgeReply = (Any?, String?) -> Void

@MainActor
protocol BridgeHandler: AnyObject {
    var capability: BridgeCapability { get }
    func handle(_ command: BridgeCommand, reply: @escaping BridgeReply) throws
}

@MainActor
struct BridgeRouter {
    private let handlers: [BridgeCapability: any BridgeHandler]

    init(handlers: [any BridgeHandler]) {
        var indexed: [BridgeCapability: any BridgeHandler] = [:]
        for handler in handlers {
            precondition(indexed[handler.capability] == nil, "Only one bridge handler may own each capability.")
            indexed[handler.capability] = handler
        }
        self.handlers = indexed
    }

    func route(_ command: BridgeCommand, reply: @escaping BridgeReply) throws {
        guard let handler = handlers[command.capability] else {
            throw StoreError(message: "The native \(command.capability) capability is unavailable.")
        }
        try handler.handle(command, reply: reply)
    }
}

struct BridgeDecodeError: Error, LocalizedError {
    enum Kind { case invalidJSON, missingAction, unknownAction, missingPayload, invalidPayload }
    let kind: Kind
    let action: String?

    var errorDescription: String? {
        switch kind {
        case .invalidJSON: "Native request must contain JSON values only."
        case .missingAction: "Invalid native request: action is required."
        case .unknownAction: "Unknown native action: \(action ?? "(missing)")"
        case .missingPayload: "Native action \(action ?? "") is missing its required payload."
        case .invalidPayload: "Native action \(action ?? "") contains an invalid payload."
        }
    }

    static let invalidJSON = BridgeDecodeError(kind: .invalidJSON, action: nil)
    static func missing(_ action: String) -> BridgeDecodeError { .init(kind: .missingPayload, action: action) }
    static func invalid(_ action: String) -> BridgeDecodeError { .init(kind: .invalidPayload, action: action) }
    static func unknown(_ action: String) -> BridgeDecodeError { .init(kind: .unknownAction, action: action) }
}

enum BridgeCommandDecoder {
    static func decode(_ untrustedBody: Any) throws -> BridgeCommand {
        guard let body = untrustedBody as? [String: Any], JSONSerialization.isValidJSONObject(body),
              let action = body["action"] as? String, !action.isEmpty else {
            if let body = untrustedBody as? [String: Any], JSONSerialization.isValidJSONObject(body) {
                throw BridgeDecodeError(kind: .missingAction, action: nil)
            }
            throw BridgeDecodeError.invalidJSON
        }

        switch action {
        case "load": return .load
        case "openData": return .openData
        case "quit": return .quit
        case "save": return .save(try payload(field("library", in: body, action: action), as: LibraryDocument.self, action: action))
        case "libraryRecovery": return .libraryRecovery
        case "restoreBackup": return .restoreBackup
        case "ready": return .ready
        case "hide": return .hide
        case "dragRegion": return .dragRegion(try payload(field("rect", in: body, action: action), as: BridgeRect.self, action: action))
        case "pin": return .pin(try payload(field("pinned", in: body, action: action), as: Bool.self, action: action))
        case "fontSize":
            let size: Int = try payload(field("fontSize", in: body, action: action), as: Int.self, action: action)
            guard (10...32).contains(size) else { throw BridgeDecodeError.invalid(action) }
            return .fontSize(size)
        case "windowStyle":
            let style: WindowStyle = try payload(field("style", in: body, action: action), as: WindowStyle.self, action: action)
            do { try WindowStyle.validate(style) } catch { throw BridgeDecodeError.invalid(action) }
            return .windowStyle(style)
        case "featurePreferences":
            return .featurePreferences(ocrEnabled: try payload(field("ocrEnabled", in: body, action: action), as: Bool.self, action: action))
        case "theme": return .theme(try payload(field("themeID", in: body, action: action), as: String.self, action: action))
        case "hotkeyPreferences":
            guard body.keys.contains("shortcut") else { return .hotkeyPreferences(nil) }
            return .hotkeyPreferences(try payload(field("shortcut", in: body, action: action), as: HotkeyShortcutPayload.self, action: action).chord)
        case "imagePreferences":
            return .imagePreferences(try payload(field("imageOptions", in: body, action: action), as: ImageExportPreferences.self, action: action))
        case "syntaxTheme": return .syntaxTheme(try payload(field("syntaxThemeID", in: body, action: action), as: String.self, action: action))
        case "startupPreferences": return .startupPreferences(try payload(body, as: StartupPreferencesPatch.self, action: action))
        case "openLoginSettings": return .openLoginSettings
        case "clipboard": return .clipboard(try payload(field("content", in: body, action: action), as: ClipboardPayload.self, action: action))
        case "export": return .markdownExport(try payload(field("notes", in: body, action: action), as: [MarkdownExportNote].self, action: action))
        case "importAttachment": return .importAttachment(try payload(body, as: AttachmentImportRequest.self, action: action))
        case "pickAttachments": return .pickAttachments
        case "pickOCRImage": return .pickOCRImage
        case "ocrAttachment": return .ocrAttachment(try payload(body, as: AttachmentURLRequest.self, action: action))
        case "openAttachment": return .openAttachment(try payload(body, as: AttachmentURLRequest.self, action: action))
        case "noteFonts": return .noteFonts
        case "noteFont": return .noteFont(try payload(field("selection", in: body, action: action), as: NoteFontSelection.self, action: action))
        case "downloadNoteFont": return .downloadNoteFont(try payload(field("family", in: body, action: action), as: String.self, action: action))
        case "cancelFontDownload": return .cancelFontDownload
        case "exportPNG": return .exportPNG(try payload(field("request", in: body, action: action), as: NoteImageRequest.self, action: action))
        case "semanticStatus": return .semantic(.status)
        case "semanticEnable":
            let request: SemanticEnablePayload = try payload(body, as: SemanticEnablePayload.self, action: action)
            return .semantic(.enable(enabled: request.enabled, provider: request.provider, model: request.model))
        case "semanticStartRuntime": return .semantic(.startRuntime)
        case "semanticDownload":
            let request: SemanticDownloadPayload = try payload(body, as: SemanticDownloadPayload.self, action: action)
            return .semantic(.download(model: request.model))
        case "semanticIndex":
            let request: SemanticIndexPayload = try payload(body, as: SemanticIndexPayload.self, action: action)
            return .semantic(.index(notes: request.notes, force: request.force))
        case "semanticSearch":
            let request: SemanticSearchPayload = try payload(body, as: SemanticSearchPayload.self, action: action)
            return .semantic(.search(query: request.query, candidateIDs: request.candidateIDs))
        case "semanticClear": return .semantic(.clear)
        case "semanticCancel": return .semantic(.cancel)
        default: throw BridgeDecodeError.unknown(action)
        }
    }

    private static func field(_ key: String, in body: [String: Any], action: String) throws -> Any {
        guard let value = body[key] else { throw BridgeDecodeError.missing(action) }
        return value
    }

    private static func payload<T: Decodable>(_ value: Any, as type: T.Type, action: String) throws -> T {
        do {
            let data = try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
            return try JSONDecoder().decode(type, from: data)
        } catch { throw BridgeDecodeError.invalid(action) }
    }
}
