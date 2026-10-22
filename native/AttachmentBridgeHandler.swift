import AppKit
import UniformTypeIdentifiers

@MainActor
final class AttachmentBridgeHandler: BridgeHandler {
    let capability = BridgeCapability.attachments
    private let attachments: any AttachmentRepository
    private let window: WindowCoordinator
    private let ocrEnabled: FeaturePreferences

    init(attachments: any AttachmentRepository, window: WindowCoordinator, ocrEnabled: FeaturePreferences) {
        self.attachments = attachments
        self.window = window
        self.ocrEnabled = ocrEnabled
    }

    func handle(_ command: BridgeCommand, reply: @escaping BridgeReply) throws {
        switch command {
        case .importAttachment(let request):
            let store = attachments
            Task {
                do {
                    let record = try await Task.detached(priority: .userInitiated) {
                        try store.importBase64(name: request.name, mimeType: request.mimeType, base64: request.dataBase64)
                    }.value
                    reply(["attachment": record.bridgeValue], nil)
                } catch { reply(nil, error.localizedDescription) }
            }
        case .pickAttachments: try pick(isOCR: false, reply: reply)
        case .pickOCRImage: try pick(isOCR: true, reply: reply)
        case .ocrAttachment(let request):
            guard ocrEnabled.ocrEnabled else { throw StoreError(message: "Enable image text recognition in Settings → General.") }
            let (file, mime) = try attachments.resolveAssetURL(request.url)
            guard mime.hasPrefix("image/") else { throw StoreError(message: "OCR requires an image.") }
            Task {
                do { reply(["text": try await OCRService().recognize(url: file)], nil) }
                catch { reply(nil, error.localizedDescription) }
            }
        case .openAttachment(let request):
            let (file, _) = try attachments.resolveAssetURL(request.url)
            guard NSWorkspace.shared.open(file) else { throw StoreError(message: "This attachment could not be opened.") }
            reply(["ok": true], nil)
        default: throw StoreError(message: "Attachment bridge does not support this command.")
        }
    }

    private func pick(isOCR: Bool, reply: @escaping BridgeReply) throws {
        if isOCR && !ocrEnabled.ocrEnabled { throw StoreError(message: "Enable image text recognition in Settings → General.") }
        guard let window = window.nativeWindow else { throw StoreError(message: "The note window is unavailable.") }
        let picker = NSOpenPanel()
        picker.title = isOCR ? "Recognize Image Text" : "Attach Images, Audio or Video"
        picker.canChooseDirectories = false
        picker.canChooseFiles = true
        picker.allowsMultipleSelection = !isOCR
        picker.allowedContentTypes = isOCR ? [.image] : [.image, .audio, .movie]
        self.window.setPresentingNativeUI(true)
        picker.beginSheetModal(for: window) { [weak self] response in
            guard let self else { return }
            self.window.setPresentingNativeUI(false)
            guard response == .OK else { reply(["cancelled": true, "attachments": []], nil); return }
            let urls = picker.urls
            let store = self.attachments
            Task {
                do {
                    if isOCR {
                        guard let url = urls.first else { throw StoreError(message: "Choose an image.") }
                        reply(["text": try await OCRService().recognize(url: url)], nil)
                    } else {
                        let records = try await Task.detached(priority: .userInitiated) { try store.importURLs(urls) }.value
                        reply(["attachments": records.map(\.bridgeValue)], nil)
                    }
                } catch { reply(nil, error.localizedDescription) }
            }
        }
    }
}
