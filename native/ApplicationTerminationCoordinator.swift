import AppKit

@MainActor
final class ApplicationTerminationCoordinator {
    private let store: any LibraryRepository
    private let channel: WebCommandChannel
    private(set) var isClosing = false
    private var replySent = false

    init(store: any LibraryRepository, channel: WebCommandChannel) {
        self.store = store
        self.channel = channel
    }

    func request() -> NSApplication.TerminateReply {
        guard !isClosing else { return .terminateLater }
        isClosing = true
        channel.flush { [weak self] result in
            guard let self else { return }
            if case .failure(let error) = result {
                NSLog("Banana Notes editor flush failed; waiting for queued library writes before terminating: %@", error.localizedDescription)
            }
            self.store.afterPendingWrites { [weak self] in
                DispatchQueue.main.async { self?.replyToApplication() }
            }
        }
        return .terminateLater
    }

    private func replyToApplication() {
        guard !replySent else { return }
        replySent = true
        NSApp.reply(toApplicationShouldTerminate: true)
    }
}
