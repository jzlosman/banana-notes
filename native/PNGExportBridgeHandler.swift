import AppKit

@MainActor
final class PNGExportBridgeHandler: BridgeHandler {
    let capability = BridgeCapability.pngExport
    private let exporter: PNGExportService
    private let window: WindowCoordinator

    init(exporter: PNGExportService, window: WindowCoordinator) {
        self.exporter = exporter
        self.window = window
    }

    func handle(_ command: BridgeCommand, reply: @escaping BridgeReply) throws {
        guard case .exportPNG(let request) = command, let presentingWindow = window.nativeWindow else {
            throw StoreError(message: "The note window is unavailable.")
        }
        window.setPresentingNativeUI(true)
        exporter.export(request: request, presenting: presentingWindow) { [weak self] result in
            self?.window.setPresentingNativeUI(false)
            switch result {
            case .success: reply(["exported": true], nil)
            case .failure(PNGExportError.saveCancelled): reply(["cancelled": true], nil)
            case .failure(let error): reply(nil, error.localizedDescription)
            }
        }
    }
}
