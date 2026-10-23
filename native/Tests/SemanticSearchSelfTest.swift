import Foundation
@testable import BananaNotesCore
import Darwin

private struct FakeOllamaProcessInspector: OllamaProcessInspecting {
    func listener() -> OllamaListener? {
        OllamaListener(pid: getpid(), uid: UInt32(getuid()), executablePath: "/Applications/Ollama.app/Contents/MacOS/Ollama")
    }
}
private struct RogueOllamaProcessInspector: OllamaProcessInspecting {
    func listener() -> OllamaListener? { OllamaListener(pid: getpid(), uid: UInt32(getuid()), executablePath: "/tmp/unrelated-service") }
}

private actor FakeSemanticHTTP: SemanticHTTPClient {
    var vectors: [[Double]] = []
    var installed = ["all-minilm:22m"]
    var embeddingCalls = 0
    var failEmbedding = false
    var dimension = 2
    var pullCalls = 0
    var delayEmbedding = false
    var embeddingContinuation: CheckedContinuation<Void, Never>?
    var zeroVectors = false

    func callCount() -> Int { embeddingCalls }
    func pullCount() -> Int { pullCalls }
    func setDimension(_ value: Int) { dimension = value }
    func setDelayEmbedding(_ value: Bool) { delayEmbedding = value }
    func releaseEmbedding() { embeddingContinuation?.resume(); embeddingContinuation = nil }
    func setZeroVectors(_ value: Bool) { zeroVectors = value }
    func get(_ path: String) async throws -> Data {
        guard path == "api/tags" else { throw SemanticSearchError(message: "unexpected endpoint") }
        return try JSONSerialization.data(withJSONObject: ["models": installed.map { ["name": $0] }])
    }
    func post(_ path: String, body: Data) async throws -> Data {
        let object = try JSONSerialization.jsonObject(with: body) as! [String: Any]
        if path == "api/pull" { pullCalls += 1; installed.append(object["name"] as! String); return Data("{}".utf8) }
        guard path == "api/embed" else { throw SemanticSearchError(message: "unexpected endpoint") }
        if failEmbedding { throw SemanticSearchError(message: "fake runtime failure") }
        embeddingCalls += 1
        if delayEmbedding { await withCheckedContinuation { embeddingContinuation = $0 } }
        let inputs = object["input"] as! [String]
        let embeddings = inputs.map { input -> [Double] in
            let base: [Double]
            if input.localizedCaseInsensitiveContains("apple") { base = [1, 0] }
            else if input.localizedCaseInsensitiveContains("banana") { base = [0, 1] }
            else { base = [0.8, 0.2] }
            return zeroVectors ? Array(repeating: 0, count: dimension) : base + Array(repeating: 0, count: max(0, dimension - base.count))
        }
        return try JSONSerialization.data(withJSONObject: ["embeddings": embeddings])
    }
}

@main
struct SemanticSearchSelfTest {
    static func main() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("FoldnoteSemanticTest-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let suite = "FoldnoteSemanticTest-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set(true, forKey: "semanticSearch.enabled")
        defaults.set("ollama", forKey: "semanticSearch.provider")
        let fake = FakeSemanticHTTP()
        let service = SemanticSearchService(directory: root, defaults: defaults, httpClient: fake, processInspector: FakeOllamaProcessInspector())
        let status = try await service.handle(action: "semanticStatus", payload: [:])
        precondition(status["enabled"] as? Bool == true && status["provider"] as? String == "ollama", "explicit Ollama configuration is preserved")
        precondition((status["runtimePath"] as? String)?.contains("Ollama.app") == true, "status exposes the verified runtime executable")
        _ = try await service.handle(action: "semanticEnable", payload: ["enabled": true, "provider": "ollama"])
        let notes: [[String: Any]] = [
            ["id": "apple", "markdown": "# Apple\n\nFruit", "updatedAt": "2026-01-01T00:00:00Z"],
            ["id": "banana", "markdown": "# Banana\n\nFruit", "updatedAt": "2026-01-01T00:00:00Z"]
        ]
        let indexed = try await service.handle(action: "semanticIndex", payload: ["notes": notes])
        precondition(indexed["indexedNotes"] as? Int == 2, "indexes snapshots")
        let scoped = try await service.handle(action: "semanticSearch", payload: ["query": "apple", "candidateIDs": ["banana"]])
        let scopedHits = scoped["hits"] as! [[String: Any]]
        precondition(scopedHits.count == 1 && scopedHits[0]["id"] as? String == "banana", "candidate scope is applied")
        let ranked = try await service.handle(action: "semanticSearch", payload: ["query": "apple", "candidateIDs": ["apple", "banana"]])
        precondition(((ranked["hits"] as! [[String: Any]]).first?["id"] as? String) == "apple", "cosine ranking")
        precondition(ranked["totalMatches"] as? Int == 2 && ranked["limit"] as? Int == 50, "search response discloses total and cap")
        let pullCountAfterSearch = await fake.pullCount()
        precondition(pullCountAfterSearch == 0, "search does not download models")
        precondition(defaults.string(forKey: "semanticSearch.model") == nil, "read actions do not mutate selected model preference")
        let rogueHTTP = FakeSemanticHTTP()
        let rogueService = SemanticSearchService(directory: root.appendingPathComponent("rogue"), defaults: defaults, httpClient: rogueHTTP,
                                                 processInspector: RogueOllamaProcessInspector())
        do {
            _ = try await rogueService.handle(action: "semanticIndex", payload: ["notes": [notes[0]]])
            preconditionFailure("unrelated process on Ollama port must be rejected before indexing")
        } catch let error as SemanticSearchError { precondition(error.message.contains("Another process is using Ollama's port")) }
        let rogueCalls = await rogueHTTP.callCount()
        precondition(rogueCalls == 0, "unverified process receives no note text")
        precondition(SemanticSearchService.isAllowedLoopbackRedirect(from: URL(string: "http://127.0.0.1:11434/api/tags")!, to: URL(string: "http://127.0.0.1:11434/api/version")!), "same-port loopback redirect allowed")
        precondition(!SemanticSearchService.isAllowedLoopbackRedirect(from: URL(string: "http://127.0.0.1:11434/api/tags")!, to: URL(string: "http://example.com:11434/api/tags")!), "external redirect rejected")
        precondition(!SemanticSearchService.isAllowedLoopbackRedirect(from: URL(string: "http://127.0.0.1:11434/api/tags")!, to: URL(string: "http://127.0.0.1:1234/api/tags")!), "different-port redirect rejected")
        let callCount = await fake.callCount()
        _ = try await service.handle(action: "semanticIndex", payload: ["notes": notes])
        let cachedCallCount = await fake.callCount()
        precondition(cachedCallCount == callCount, "unchanged content uses cached vectors")
        let edited = [["id": "apple", "markdown": "# Banana edited", "updatedAt": "2026-02-01T00:00:00Z"]]
        let afterEdit = try await service.handle(action: "semanticIndex", payload: ["notes": edited])
        precondition(afterEdit["indexedNotes"] as? Int == 1, "deleted notes are reconciled")
        let callsAfterEdit = await fake.callCount()
        precondition(callsAfterEdit == callCount + 1, "content edits invalidate only the changed note's cached vectors")
        do {
            _ = try await service.handle(action: "semanticIndex", payload: ["notes": [["id": "x", "markdown": 4, "updatedAt": "now"]]])
            preconditionFailure("malformed note snapshot should reject")
        } catch is BridgeDecodeError {}
        do {
            _ = try await service.handle(action: "semanticEnable", payload: ["enabled": true, "model": "remote-model"])
            preconditionFailure("nonallowlisted model should reject")
        } catch is SemanticSearchError {}
        try Data("broken index".utf8).write(to: root.appendingPathComponent("semantic-index.json"))
        do {
            _ = try await service.handle(action: "semanticSearch", payload: ["query": "apple", "candidateIDs": ["apple"]])
            preconditionFailure("malformed index should be surfaced")
        } catch is SemanticSearchError {}
        let emptyRoot = root.appendingPathComponent("empty", isDirectory: true)
        try FileManager.default.createDirectory(at: emptyRoot, withIntermediateDirectories: true)
        let emptyHTTP = FakeSemanticHTTP()
        let emptyService = SemanticSearchService(directory: emptyRoot, defaults: defaults, httpClient: emptyHTTP, processInspector: FakeOllamaProcessInspector())
        let emptyNotes: [[String: Any]] = [["id": "blank", "markdown": " \n\t", "updatedAt": "2026-01-01T00:00:00Z"]]
        let emptyIndex = try await emptyService.handle(action: "semanticIndex", payload: ["notes": emptyNotes])
        precondition(emptyIndex["indexedNotes"] as? Int == 1 && emptyIndex["dimension"] as? Int == 0, "empty notes are retained without embeddings")
        do {
            _ = try await emptyService.handle(action: "semanticSearch", payload: ["query": "apple", "candidateIDs": ["blank"]])
            preconditionFailure("all-empty index should explain that there is no searchable content")
        } catch let error as SemanticSearchError { precondition(error.message.contains("no searchable content")) }
        let emptyEmbeddingCalls = await emptyHTTP.callCount()
        precondition(emptyEmbeddingCalls == 0, "empty indexing and rejected search make no embedding call")

        let dimensionRoot = root.appendingPathComponent("dimension", isDirectory: true)
        try FileManager.default.createDirectory(at: dimensionRoot, withIntermediateDirectories: true)
        let dimensionHTTP = FakeSemanticHTTP()
        let dimensionService = SemanticSearchService(directory: dimensionRoot, defaults: defaults, httpClient: dimensionHTTP, processInspector: FakeOllamaProcessInspector())
        _ = try await dimensionService.handle(action: "semanticIndex", payload: ["notes": [notes[0]]])
        await dimensionHTTP.setDimension(3)
        do {
            _ = try await dimensionService.handle(action: "semanticSearch", payload: ["query": "apple", "candidateIDs": ["apple"]])
            preconditionFailure("query vector dimension mismatch should reject")
        } catch is SemanticSearchError {}

        let boundedHTTP = FakeSemanticHTTP()
        await boundedHTTP.setDimension(4_097)
        let boundedRoot = root.appendingPathComponent("bounded", isDirectory: true)
        try FileManager.default.createDirectory(at: boundedRoot, withIntermediateDirectories: true)
        let boundedService = SemanticSearchService(directory: boundedRoot, defaults: defaults, httpClient: boundedHTTP, processInspector: FakeOllamaProcessInspector())
        do {
            _ = try await boundedService.handle(action: "semanticIndex", payload: ["notes": [notes[0]]])
            preconditionFailure("oversized vector dimension should reject")
        } catch is SemanticSearchError {}

        let zeroHTTP = FakeSemanticHTTP()
        await zeroHTTP.setZeroVectors(true)
        let zeroRoot = root.appendingPathComponent("zero", isDirectory: true)
        try FileManager.default.createDirectory(at: zeroRoot, withIntermediateDirectories: true)
        let zeroService = SemanticSearchService(directory: zeroRoot, defaults: defaults, httpClient: zeroHTTP, processInspector: FakeOllamaProcessInspector())
        do {
            _ = try await zeroService.handle(action: "semanticIndex", payload: ["notes": [notes[0]]])
            preconditionFailure("zero index vectors should reject")
        } catch is SemanticSearchError {}

        for invalidator in ["semanticClear", "semanticDisable", "semanticModelChange"] {
            let delayedHTTP = FakeSemanticHTTP()
            await delayedHTTP.setDelayEmbedding(true)
            let delayedRoot = root.appendingPathComponent("delayed-\(invalidator)", isDirectory: true)
            try FileManager.default.createDirectory(at: delayedRoot, withIntermediateDirectories: true)
            let delayedDefaults = UserDefaults(suiteName: "\(suite)-\(invalidator)")!
            defer { delayedDefaults.removePersistentDomain(forName: "\(suite)-\(invalidator)") }
            delayedDefaults.set("ollama", forKey: "semanticSearch.provider")
            let delayedService = SemanticSearchService(directory: delayedRoot, defaults: delayedDefaults, httpClient: delayedHTTP, processInspector: FakeOllamaProcessInspector())
            _ = try await delayedService.handle(action: "semanticEnable", payload: ["enabled": true])
            let delayedBuild = Task { try await delayedService.handle(action: "semanticIndex", payload: ["notes": [notes[0]]]) }
            for _ in 0..<100 {
                if await delayedHTTP.callCount() > 0 { break }
                try await Task.sleep(for: .milliseconds(5))
            }
            let delayedCalls = await delayedHTTP.callCount()
            precondition(delayedCalls > 0, "delayed index reached embedding call")
            do {
                _ = try await delayedService.handle(action: "semanticIndex", payload: ["notes": [notes[0]]])
                preconditionFailure("overlapping index job should be rejected")
            } catch is SemanticSearchError {}
            switch invalidator {
            case "semanticClear": _ = try await delayedService.handle(action: "semanticClear", payload: [:])
            case "semanticDisable": _ = try await delayedService.handle(action: "semanticEnable", payload: ["enabled": false])
            default: _ = try await delayedService.handle(action: "semanticEnable", payload: ["enabled": true, "model": "embeddinggemma:latest"])
            }
            await delayedHTTP.releaseEmbedding()
            do { _ = try await delayedBuild.value; preconditionFailure("invalidated index build must not commit: \(invalidator)") }
            catch is SemanticSearchError {}
            precondition(!FileManager.default.fileExists(atPath: delayedRoot.appendingPathComponent("semantic-index.json").path), "invalidated build did not write an index")
        }
        print("Native semantic search checks passed")
    }
}

private extension SemanticSearchService {
    func handle(action: String, payload: [String: Any]) async throws -> [String: Any] {
        var envelope = payload
        envelope["action"] = action
        guard case .semantic(let command) = try BridgeCommandDecoder.decode(envelope) else {
            throw StoreError(message: "Test request did not decode as a semantic capability.")
        }
        return try await handle(command)
    }
}
