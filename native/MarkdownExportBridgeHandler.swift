import AppKit

@MainActor
final class MarkdownExportBridgeHandler: BridgeHandler {
    let capability = BridgeCapability.markdownExport
    private let window: WindowCoordinator

    init(window: WindowCoordinator) { self.window = window }

    func handle(_ command: BridgeCommand, reply: @escaping BridgeReply) throws {
        guard case .markdownExport(let notes) = command else {
            throw StoreError(message: "Markdown export bridge does not support this command.")
        }
        let panel = NSOpenPanel()
        panel.title = "Export Notes"
        panel.prompt = "Export"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        guard let parent = window.nativeWindow else { throw StoreError(message: "The note window is unavailable.") }
        window.setPresentingNativeUI(true)
        panel.beginSheetModal(for: parent) { [weak self] response in
            guard let self else { return }
            self.window.setPresentingNativeUI(false)
            guard response == .OK, let folder = panel.url else { reply(["exported": false], nil); return }
            do {
                let names = Set(try FileManager.default.contentsOfDirectory(atPath: folder.path))
                for file in MarkdownExportService.plan(notes, avoiding: names) {
                    try Data(file.markdown.utf8).write(to: folder.appendingPathComponent(file.filename), options: .atomic)
                }
                reply(["exported": true], nil)
            } catch { reply(nil, error.localizedDescription) }
        }
    }
}
