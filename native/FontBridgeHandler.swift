import Foundation

@MainActor
final class FontBridgeHandler: BridgeHandler {
    let capability = BridgeCapability.fonts
    private let fonts: NoteFontStore
    private var downloadTask: Task<Void, Never>?

    init(fonts: NoteFontStore) { self.fonts = fonts }

    func handle(_ command: BridgeCommand, reply: @escaping BridgeReply) throws {
        switch command {
        case .noteFonts: reply(fonts.state, nil)
        case .noteFont(let selection): reply(try fonts.select(selection), nil)
        case .downloadNoteFont(let family):
            guard downloadTask == nil else { throw StoreError(message: "A font download is already in progress.") }
            downloadTask = Task { [weak self] in
                guard let self else { return }
                defer { self.downloadTask = nil }
                do { reply(try await self.fonts.download(family: family), nil) }
                catch is CancellationError { reply(nil, "Font download canceled.") }
                catch { reply(nil, error.localizedDescription) }
            }
        case .cancelFontDownload:
            guard let task = downloadTask else { reply(["cancelled": true], nil); return }
            task.cancel()
            Task {
                await task.value
                reply(["cancelled": true], nil)
            }
        default: throw StoreError(message: "Font bridge does not support this command.")
        }
    }

    func shutdown() { downloadTask?.cancel() }
}
