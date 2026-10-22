import Foundation

@main
struct WebCommandChannelSelfTest {
    @MainActor
    static func main() {
        var sent: [WebCommand] = []
        var flushRequests = 0
        var editorFlush: WebCommandChannel.Completion?
        let channel = WebCommandChannel(timeout: 0.1, send: { sent.append($0) }, flush: {
            flushRequests += 1
            editorFlush = $0
        })
        channel.send(.new)
        channel.send(.tag("work/project"))
        precondition(sent.isEmpty, "commands wait until the editor is ready")
        channel.markReady()
        precondition(sent == [.new, .tag("work/project")])
        channel.markReady()
        precondition(sent.count == 2, "readiness is idempotent")
        var completions = 0
        channel.flush { result in if case .success = result { completions += 1 } }
        channel.flush { result in if case .success = result { completions += 1 } }
        precondition(flushRequests == 1, "concurrent flush requests share one editor flush")
        editorFlush?(.success(()))
        RunLoop.main.run(until: Date().addingTimeInterval(0.03))
        precondition(completions == 2, "all flush waiters receive the shared completion")

        var timeoutFailed = false
        let timeoutChannel = WebCommandChannel(timeout: 0.01, send: { _ in }, flush: { _ in })
        timeoutChannel.markReady()
        timeoutChannel.flush { if case .failure = $0 { timeoutFailed = true } }
        RunLoop.main.run(until: Date().addingTimeInterval(0.05))
        precondition(timeoutFailed, "a stuck editor flush terminates with a bounded failure")
        print("Typed web command channel checks passed (queue, readiness, shared flush, timeout)")
    }
}
