import Foundation

/// Only commands accepted by the editor are representable at the native/web boundary.
enum WebCommand: Equatable, Encodable {
    enum ClipboardFormat: String, Encodable { case markdown, formatted, html, text }
    case new, explorer, themes, help, show, older, newer, flush
    case tag(String), focus(Bool), pin(Bool), windowStyle(WindowStyle), copy(ClipboardFormat, whole: Bool)
    case fontIncrease, fontDecrease, fontReset

    private enum CodingKeys: String, CodingKey { case action, tag, focused, pinned, style, format, whole }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .new: try container.encode("new", forKey: .action)
        case .explorer: try container.encode("explorer", forKey: .action)
        case .themes: try container.encode("themes", forKey: .action)
        case .help: try container.encode("help", forKey: .action)
        case .show: try container.encode("show", forKey: .action)
        case .older: try container.encode("older", forKey: .action)
        case .newer: try container.encode("newer", forKey: .action)
        case .flush: try container.encode("flush", forKey: .action)
        case .tag(let tag):
            try container.encode("tag", forKey: .action)
            try container.encode(tag, forKey: .tag)
        case .focus(let focused):
            try container.encode("focus", forKey: .action)
            try container.encode(focused, forKey: .focused)
        case .pin(let pinned):
            try container.encode("pin", forKey: .action)
            try container.encode(pinned, forKey: .pinned)
        case .windowStyle(let style):
            try container.encode("windowStyle", forKey: .action)
            try container.encode(style.bridgeValue, forKey: .style)
        case .copy(let format, let whole):
            try container.encode("copy", forKey: .action)
            try container.encode(format, forKey: .format)
            try container.encode(whole, forKey: .whole)
        case .fontIncrease: try container.encode("fontIncrease", forKey: .action)
        case .fontDecrease: try container.encode("fontDecrease", forKey: .action)
        case .fontReset: try container.encode("fontReset", forKey: .action)
        }
    }

    func jsonArgument() throws -> String {
        let data = try JSONEncoder().encode(self)
        guard let value = String(data: data, encoding: .utf8) else { throw StoreError(message: "The editor command could not be encoded.") }
        return value
    }
}

@MainActor
final class WebCommandChannel {
    typealias Completion = (Result<Void, Error>) -> Void
    private let sendCommand: (WebCommand) -> Void
    private let flushEditor: (@escaping Completion) -> Void
    private let timeout: TimeInterval
    private var isReady = false
    private var queued: [WebCommand] = []
    private var flushInProgress = false
    private var generation = 0
    private var completions: [Completion] = []

    init(timeout: TimeInterval = 3,
         send: @escaping (WebCommand) -> Void,
         flush: @escaping (@escaping Completion) -> Void) {
        self.timeout = timeout
        sendCommand = send
        flushEditor = flush
    }

    func send(_ command: WebCommand) {
        guard isReady else { queued.append(command); return }
        sendCommand(command)
    }

    func markReady() {
        guard !isReady else { return }
        isReady = true
        let pending = queued
        queued.removeAll()
        pending.forEach(sendCommand)
    }

    func flush(_ completion: @escaping Completion) {
        guard isReady else { completion(.success(())); return }
        completions.append(completion)
        guard !flushInProgress else { return }
        flushInProgress = true
        generation += 1
        let current = generation
        flushEditor { [weak self] result in
            DispatchQueue.main.async { self?.finish(result, generation: current) }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { [weak self] in
            self?.finish(.failure(StoreError(message: "Timed out waiting for the editor to finish saving.")), generation: current)
        }
    }

    private func finish(_ result: Result<Void, Error>, generation current: Int) {
        guard flushInProgress, current == generation else { return }
        flushInProgress = false
        let pending = completions
        completions.removeAll()
        pending.forEach { $0(result) }
    }
}
