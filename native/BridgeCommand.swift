import Foundation
import CoreFoundation

indirect enum BridgeJSONValue {
    case null
    case bool(Bool)
    case number(NSNumber)
    case string(String)
    case array([BridgeJSONValue])
    case object([String: BridgeJSONValue])

    init(any value: Any) throws {
        if value is NSNull { self = .null; return }
        if let number = value as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() { self = .bool(number.boolValue) }
            else if number.doubleValue.isFinite { self = .number(number) }
            else { throw BridgeDecodeError.invalidJSON }
            return
        }
        if let string = value as? String { self = .string(string); return }
        if let array = value as? [Any] { self = .array(try array.map(BridgeJSONValue.init(any:))); return }
        if let object = value as? [String: Any] {
            self = .object(try object.mapValues(BridgeJSONValue.init(any:))); return
        }
        throw BridgeDecodeError.invalidJSON
    }

    var foundationValue: Any {
        switch self {
        case .null: NSNull()
        case .bool(let value): NSNumber(value: value)
        case .number(let value): value
        case .string(let value): value
        case .array(let values): values.map(\.foundationValue)
        case .object(let values): values.mapValues(\.foundationValue)
        }
    }
}

struct BridgeDecodeError: Error, LocalizedError {
    enum Kind { case invalidJSON, invalidLibrary, missingAction, unknownAction }
    let kind: Kind
    let action: String?
    var errorDescription: String? {
        switch kind {
        case .invalidJSON: "Native request must contain JSON values only."
        case .invalidLibrary: "Library must be a JSON object."
        case .missingAction: "Invalid native request: action is required."
        case .unknownAction: "Unknown native action: \(action ?? "(missing)")"
        }
    }
    static let invalidJSON = BridgeDecodeError(kind: .invalidJSON, action: nil)
    static let invalidLibrary = BridgeDecodeError(kind: .invalidLibrary, action: nil)
    static let missingAction = BridgeDecodeError(kind: .missingAction, action: nil)
    static func unknown(_ action: String) -> BridgeDecodeError { BridgeDecodeError(kind: .unknownAction, action: action) }
}

enum SemanticBridgeAction: String {
    case status = "semanticStatus"
    case enable = "semanticEnable"
    case startRuntime = "semanticStartRuntime"
    case download = "semanticDownload"
    case index = "semanticIndex"
    case search = "semanticSearch"
    case clear = "semanticClear"
    case cancel = "semanticCancel"
}

enum NativeFeatureCommand {
    case noteFonts
    case noteFont
    case downloadNoteFont
    case cancelFontDownload
    case imagePreferences
    case syntaxTheme
    case startupPreferences
    case openLoginSettings
    case importAttachment
    case pickAttachments
    case pickOCRImage
    case ocrAttachment
    case openAttachment
    case exportPNG
    case semantic(SemanticBridgeAction)
}

enum BridgeCommand {
    case load
    case save([String: Any]?)
    case hide
    case dragRegion(BridgeJSONValue?)
    case pin(BridgeJSONValue?)
    case featurePreferences(BridgeJSONValue?)
    case clipboard(BridgeJSONValue?)
    case fontSize(BridgeJSONValue?)
    case windowStyle(BridgeJSONValue?)
    case theme(BridgeJSONValue?)
    case export(BridgeJSONValue?)
    case openData
    case ready
    case quit
    case libraryRecovery
    case restoreBackup
    case hotkeyPreferences(BridgeJSONValue?)
    case feature(NativeFeatureCommand, BridgeJSONValue)
}

struct DecodedBridgeRequest {
    let command: BridgeCommand
    let body: [String: Any]
}

enum BridgeCommandDecoder {
    static func decode(_ untrustedBody: Any) throws -> DecodedBridgeRequest {
        guard let body = untrustedBody as? [String: Any] else { throw BridgeDecodeError.invalidJSON }
        guard let action = body["action"] as? String, !action.isEmpty else { throw BridgeDecodeError.missingAction }
        if action == "save" {
            guard let raw = body["library"] else { return DecodedBridgeRequest(command: .save(nil), body: body) }
            guard let library = raw as? [String: Any] else { throw BridgeDecodeError.invalidLibrary }
            return DecodedBridgeRequest(command: .save(library), body: body)
        }
        let validated = try BridgeJSONValue(any: body)
        guard case .object(let fields) = validated else { throw BridgeDecodeError.invalidJSON }
        let command: BridgeCommand
        switch action {
        case "load": command = .load
        case "save": throw BridgeDecodeError.invalidJSON
        case "hide": command = .hide
        case "dragRegion": command = .dragRegion(fields["rect"])
        case "pin": command = .pin(fields["pinned"])
        case "featurePreferences": command = .featurePreferences(fields["ocrEnabled"])
        case "clipboard": command = .clipboard(fields["content"])
        case "fontSize": command = .fontSize(fields["fontSize"])
        case "windowStyle": command = .windowStyle(fields["style"])
        case "theme": command = .theme(fields["themeID"])
        case "export": command = .export(fields["notes"])
        case "openData": command = .openData
        case "ready": command = .ready
        case "quit": command = .quit
        case "libraryRecovery": command = .libraryRecovery
        case "restoreBackup": command = .restoreBackup
        case "hotkeyPreferences": command = .hotkeyPreferences(fields["shortcut"])
        case "noteFonts": command = .feature(.noteFonts, validated)
        case "noteFont": command = .feature(.noteFont, validated)
        case "downloadNoteFont": command = .feature(.downloadNoteFont, validated)
        case "cancelFontDownload": command = .feature(.cancelFontDownload, validated)
        case "imagePreferences": command = .feature(.imagePreferences, validated)
        case "syntaxTheme": command = .feature(.syntaxTheme, validated)
        case "startupPreferences": command = .feature(.startupPreferences, validated)
        case "openLoginSettings": command = .feature(.openLoginSettings, validated)
        case "importAttachment": command = .feature(.importAttachment, validated)
        case "pickAttachments": command = .feature(.pickAttachments, validated)
        case "pickOCRImage": command = .feature(.pickOCRImage, validated)
        case "ocrAttachment": command = .feature(.ocrAttachment, validated)
        case "openAttachment": command = .feature(.openAttachment, validated)
        case "exportPNG": command = .feature(.exportPNG, validated)
        case let value where SemanticBridgeAction(rawValue: value) != nil:
            command = .feature(.semantic(SemanticBridgeAction(rawValue: value)!), validated)
        default: throw BridgeDecodeError.unknown(action)
        }
        return DecodedBridgeRequest(command: command, body: body)
    }
}

@MainActor
protocol ApplicationBridgeCapability: AnyObject {
    func handleApplicationBridge(_ request: DecodedBridgeRequest, reply: @escaping (Any?, String?) -> Void) throws
}

@MainActor
protocol FeatureBridgeCapability: AnyObject {
    func handleFeatureBridge(_ command: NativeFeatureCommand, body: [String: Any],
                             presenting: @escaping (Bool) -> Void, reply: @escaping (Any?, String?) -> Void) throws
}

/// Routes authenticated, typed bridge requests to the app and feature capabilities.
@MainActor
struct BridgeRouter {
    func route(_ request: DecodedBridgeRequest, application: ApplicationBridgeCapability,
               features: FeatureBridgeCapability?, presenting: @escaping (Bool) -> Void,
               reply: @escaping (Any?, String?) -> Void) throws {
        if case .feature(let command, _) = request.command {
            guard let features else { throw StoreError(message: "Native features are unavailable.") }
            try features.handleFeatureBridge(command, body: request.body, presenting: presenting, reply: reply)
        } else {
            try application.handleApplicationBridge(request, reply: reply)
        }
    }
}
