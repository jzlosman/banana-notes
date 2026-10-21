import Foundation
import NaturalLanguage

private actor NoSemanticHTTP: SemanticHTTPClient {
    private(set) var calls = 0
    func get(_ path: String) async throws -> Data { calls += 1; throw SemanticSearchError(message: "Unexpected HTTP") }
    func post(_ path: String, body: Data) async throws -> Data { calls += 1; throw SemanticSearchError(message: "Unexpected HTTP") }
    func count() -> Int { calls }
}
private struct FakeNativeProvider: SemanticEmbeddingProvider {
    let available: Bool
    let revision: Int
    func identity(for model: String) -> String { "apple:nl-english:revision-\(revision)" }
    func availability() -> (available: Bool, reason: String?) { (available, available ? nil : "native model unavailable") }
    func embed(_ inputs: [String], model: String) async throws -> [[Double]] { inputs.map { _ in [1, 0] } }
}
private actor RuntimeSpy: SemanticRuntimeStarter {
    private(set) var starts = 0
    func start() async throws { starts += 1 }
    func count() -> Int { starts }
}
private final class MutableRevisionProvider: SemanticEmbeddingProvider, @unchecked Sendable {
    private let lock = NSLock()
    private var revision = 1
    private var delayed = false
    private var continuation: CheckedContinuation<Void, Never>?
    func identity(for model: String) -> String { lock.lock(); defer { lock.unlock() }; return "apple:nl-english:revision-\(revision)" }
    func availability() -> (available: Bool, reason: String?) { (true, nil) }
    func setRevision(_ value: Int) { lock.lock(); revision = value; lock.unlock() }
    func setDelayed(_ value: Bool) { lock.lock(); delayed = value; lock.unlock() }
    func isWaiting() -> Bool { lock.withLock { continuation != nil } }
    func release() { lock.lock(); let pending = continuation; continuation = nil; lock.unlock(); pending?.resume() }
    func embed(_ inputs: [String], model: String) async throws -> [[Double]] {
        let shouldDelay = lock.withLock { delayed }
        if shouldDelay {
            await withCheckedContinuation { (pending: CheckedContinuation<Void, Never>) in
                lock.lock(); continuation = pending; lock.unlock()
            }
        }
        return inputs.map { _ in [1, 0] }
    }
}
private actor StartingSemanticHTTP: SemanticHTTPClient {
    private var checks = 0
    func get(_ path: String) async throws -> Data {
        checks += 1
        guard checks >= 3 else { throw SemanticSearchError(message: "server starting") }
        return Data(#"{"models":[]}"#.utf8)
    }
    func post(_ path: String, body: Data) async throws -> Data { preconditionFailure("runtime startup never downloads or embeds") }
}
private struct FakeOllamaDiscovery: OllamaRuntimeDiscovery {
    let executable: String?
    let app: String?
    func executablePath() -> String? { executable }
    func applicationPath() -> String? { app }
}
private actor FakeOllamaLauncher: OllamaRuntimeLaunching {
    private(set) var openedApps: [String] = []
    private(set) var namedLaunches = 0
    let failNamed: Bool
    init(failNamed: Bool = false) { self.failNamed = failNamed }
    func launchServe(executable: String) async throws {}
    func openApplication(path: String) async throws { openedApps.append(path) }
    func openNamedApplication() async throws {
        namedLaunches += 1
        if failNamed { throw SemanticSearchError(message: "application not found") }
    }
    func openedPaths() -> [String] { openedApps }
    func namedCount() -> Int { namedLaunches }
}

@main struct SemanticProviderSelfTest {
    static func main() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let suite = "SemanticProvider-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let http = NoSemanticHTTP()
        let runtime = RuntimeSpy()
        let appleRevision = NLEmbedding.sentenceEmbedding(for: .english)?.revision ?? 7
        let service = SemanticSearchService(directory: root, defaults: defaults, httpClient: http, appleProvider: FakeNativeProvider(available: true, revision: appleRevision), runtimeStarter: runtime)
        let initial = try await service.handle(action: "semanticStatus", payload: [:])
        precondition(initial["enabled"] as? Bool == true && initial["provider"] as? String == "apple", "fresh preferences default to enabled Apple")
        let actualAppleIdentity = "apple:nl-english:revision-\(appleRevision)"
        precondition(initial["model"] as? String == actualAppleIdentity, "Apple identity includes language and actual revision")
        let callsAfterStatus = await http.count()
        precondition(callsAfterStatus == 0, "Apple status makes no network calls")
        precondition(defaults.object(forKey: "semanticSearch.provider") == nil, "status does not migrate preferences")
        let explicitApple = try await service.handle(action: "semanticEnable", payload: ["enabled": true, "provider": "apple"])
        precondition(explicitApple["provider"] as? String == "apple" && defaults.string(forKey: "semanticSearch.provider") == "apple", "explicit no-op Apple choice persists")
        let freshOmittedSuite = "SemanticFreshOmitted-\(UUID().uuidString)"
        let freshOmittedDefaults = UserDefaults(suiteName: freshOmittedSuite)!
        defer { freshOmittedDefaults.removePersistentDomain(forName: freshOmittedSuite) }
        let freshOmittedService = SemanticSearchService(directory: root, defaults: freshOmittedDefaults, httpClient: http, appleProvider: FakeNativeProvider(available: true, revision: appleRevision), runtimeStarter: runtime)
        let omittedProvider = try await freshOmittedService.handle(action: "semanticEnable", payload: ["enabled": true])
        precondition(omittedProvider["provider"] as? String == "apple" && freshOmittedDefaults.string(forKey: "semanticSearch.provider") == "apple", "fresh omitted-provider enable persists Apple")
        let disabled = try await service.handle(action: "semanticEnable", payload: ["enabled": false, "provider": "apple"])
        precondition(disabled["provider"] as? String == "apple" && disabled["enabled"] as? Bool == false, "disabled retains provider selection")
        do { _ = try await service.handle(action: "semanticStartRuntime", payload: [:]); preconditionFailure("Apple cannot start Ollama") } catch is SemanticSearchError {}
        let startsInAppleMode = await runtime.count()
        precondition(startsInAppleMode == 0, "Apple does not dispatch runtime start")

        let callsBeforeLegacy = await http.count()
        precondition(callsBeforeLegacy == 0, "native provider actions never contact Ollama")

        let legacySuite = "SemanticLegacy-\(UUID().uuidString)"
        let legacy = UserDefaults(suiteName: legacySuite)!
        defer { legacy.removePersistentDomain(forName: legacySuite) }
        legacy.set(true, forKey: "semanticSearch.enabled")
        let legacyService = SemanticSearchService(directory: root, defaults: legacy, httpClient: http, appleProvider: FakeNativeProvider(available: true, revision: 7), runtimeStarter: runtime)
        let legacyStatus = try await legacyService.handle(action: "semanticStatus", payload: [:])
        precondition(legacyStatus["provider"] as? String == "ollama", "legacy enabled preference keeps Ollama")
        legacy.set(false, forKey: "semanticSearch.enabled")
        let beforeDisabledStatus = await http.count()
        let disabledLegacyStatus = try await legacyService.handle(action: "semanticStatus", payload: [:])
        let afterDisabledStatus = await http.count()
        precondition(disabledLegacyStatus["enabled"] as? Bool == false && disabledLegacyStatus["provider"] as? String == "ollama", "legacy explicit Disabled is preserved")
        precondition(beforeDisabledStatus == afterDisabledStatus, "Disabled search does not depend on or probe the Ollama server")

        let unavailable = SemanticSearchService(directory: root, defaults: defaults, httpClient: http, appleProvider: FakeNativeProvider(available: false, revision: appleRevision), runtimeStarter: runtime)
        _ = try await unavailable.handle(action: "semanticEnable", payload: ["enabled": true, "provider": "apple"])
        let unavailableStatus = try await unavailable.handle(action: "semanticStatus", payload: [:])
        precondition(unavailableStatus["installed"] as? Bool == false && unavailableStatus["unavailableReason"] as? String != nil, "unavailable Apple model reports reason")

        _ = try await service.handle(action: "semanticEnable", payload: ["enabled": true, "provider": "apple"])
        let notes: [[String: Any]] = [["id": "local", "markdown": "Synthetic private note", "updatedAt": "2026-01-01T00:00:00Z"]]
        _ = try await service.handle(action: "semanticIndex", payload: ["notes": notes])
        let result = try await service.handle(action: "semanticSearch", payload: ["query": "synthetic", "candidateIDs": ["local"]])
        precondition((result["hits"] as? [[String: Any]])?.first?["id"] as? String == "local", "native indexing and scoped search work")
        let revisionTwo = SemanticSearchService(directory: root, defaults: defaults, httpClient: http, appleProvider: FakeNativeProvider(available: true, revision: 8), runtimeStarter: runtime)
        let changedSpace = try await revisionTwo.handle(action: "semanticStatus", payload: [:])
        precondition(changedSpace["indexedNotes"] as? Int == 0 && changedSpace["actionableState"] as? String == "indexNotReady", "revision change cannot reuse old vectors")
        _ = try await revisionTwo.handle(action: "semanticIndex", payload: ["notes": notes])

        let changingSuite = "SemanticChangingRevision-\(UUID().uuidString)"
        let changingDefaults = UserDefaults(suiteName: changingSuite)!
        defer { changingDefaults.removePersistentDomain(forName: changingSuite) }
        changingDefaults.set(true, forKey: "semanticSearch.enabled")
        changingDefaults.set("apple", forKey: "semanticSearch.provider")
        let changingProvider = MutableRevisionProvider()
        let changingService = SemanticSearchService(directory: root.appendingPathComponent("changing"), defaults: changingDefaults, httpClient: http, appleProvider: changingProvider, runtimeStarter: runtime)
        _ = try await changingService.handle(action: "semanticIndex", payload: ["notes": notes])
        changingProvider.setDelayed(true)
        let pendingSearch = Task { try await changingService.handle(action: "semanticSearch", payload: ["query": "synthetic", "candidateIDs": ["local"]]) }
        for _ in 0..<100 {
            if changingProvider.isWaiting() { break }
            try await Task.sleep(for: .milliseconds(5))
        }
        precondition(changingProvider.isWaiting(), "query reached delayed native embedding")
        changingProvider.setRevision(2)
        changingProvider.release()
        do { _ = try await pendingSearch.value; preconditionFailure("search must reject a revision changed during embedding") }
        catch is SemanticSearchError {}

        let batchSuite = "SemanticBatchCancellation-\(UUID().uuidString)"
        let batchDefaults = UserDefaults(suiteName: batchSuite)!
        defer { batchDefaults.removePersistentDomain(forName: batchSuite) }
        let batchProvider = MutableRevisionProvider(); batchProvider.setDelayed(true)
        let batchRoot = root.appendingPathComponent("batch-cancel")
        let batchService = SemanticSearchService(directory: batchRoot, defaults: batchDefaults, httpClient: http, appleProvider: batchProvider, runtimeStarter: runtime)
        let largeNote: [[String: Any]] = [["id": "large", "markdown": String(repeating: "Synthetic words. ", count: 1_600), "updatedAt": "2026-01-01T00:00:00Z"]]
        let pendingBuild = Task { try await batchService.handle(action: "semanticIndex", payload: ["notes": largeNote]) }
        for _ in 0..<100 {
            if batchProvider.isWaiting() { break }
            try await Task.sleep(for: .milliseconds(5))
        }
        precondition(batchProvider.isWaiting(), "large note reached its first native embedding batch")
        _ = try await batchService.handle(action: "semanticEnable", payload: ["enabled": true, "provider": "ollama"])
        let callsBeforeRelease = await http.count()
        batchProvider.release()
        do { _ = try await pendingBuild.value; preconditionFailure("provider switch must cancel every remaining batch") } catch is SemanticSearchError {}
        let callsAfterRelease = await http.count()
        precondition(callsBeforeRelease == callsAfterRelease, "obsolete Apple batches must never be sent to the newly selected Ollama provider")
        precondition(!FileManager.default.fileExists(atPath: batchRoot.appendingPathComponent("semantic-index.json").path), "obsolete multi-batch index never commits")

        let ollamaSuite = "SemanticRuntime-\(UUID().uuidString)"
        let ollamaDefaults = UserDefaults(suiteName: ollamaSuite)!
        defer { ollamaDefaults.removePersistentDomain(forName: ollamaSuite) }
        ollamaDefaults.set(true, forKey: "semanticSearch.enabled")
        ollamaDefaults.set("ollama", forKey: "semanticSearch.provider")
        let ollamaRuntime = RuntimeSpy()
        let ollamaService = SemanticSearchService(directory: root, defaults: ollamaDefaults, httpClient: http, appleProvider: FakeNativeProvider(available: true, revision: 7), runtimeStarter: ollamaRuntime)
        _ = try await ollamaService.handle(action: "semanticStartRuntime", payload: [:])
        let ollamaStarts = await ollamaRuntime.count()
        precondition(ollamaStarts == 1, "explicit Ollama start dispatches the runtime port")

        _ = try await ollamaService.handle(action: "semanticEnable", payload: ["enabled": true, "provider": "ollama", "model": "embeddinggemma:latest"])
        _ = try await ollamaService.handle(action: "semanticEnable", payload: ["enabled": true, "provider": "apple"])
        let backToOllama = try await ollamaService.handle(action: "semanticEnable", payload: ["enabled": true, "provider": "ollama"])
        precondition(backToOllama["model"] as? String == "embeddinggemma:latest", "Ollama selection survives Apple provider switches")
        do {
            _ = try await ollamaService.handle(action: "semanticEnable", payload: ["enabled": true, "provider": "ollama", "model": 42])
            preconditionFailure("numeric model selection must reject")
        } catch is SemanticSearchError {}
        ollamaDefaults.set("unsupported-model", forKey: "semanticSearch.model")
        do {
            _ = try await ollamaService.handle(action: "semanticEnable", payload: ["enabled": true, "provider": "ollama"])
            preconditionFailure("unsupported persisted models must not bypass the allowlist when model is omitted")
        } catch is SemanticSearchError {}
        ollamaDefaults.set("embeddinggemma:latest", forKey: "semanticSearch.model")
        ollamaDefaults.set("future-provider", forKey: "semanticSearch.provider")
        let normalizedStatus = try await ollamaService.handle(action: "semanticStatus", payload: [:])
        precondition(normalizedStatus["provider"] as? String == "ollama", "unknown stored provider falls back to legacy Ollama selection")

        let startingService = SemanticSearchService(directory: root, defaults: ollamaDefaults, httpClient: StartingSemanticHTTP(), appleProvider: FakeNativeProvider(available: true, revision: 7), runtimeStarter: RuntimeSpy())
        let startedStatus = try await startingService.handle(action: "semanticStartRuntime", payload: [:])
        precondition(startedStatus["runtimeAvailable"] as? Bool == true, "one explicit start waits briefly for observed server readiness")

        let installedAppLauncher = FakeOllamaLauncher()
        let appStarter = OllamaRuntimeStarter(discovery: FakeOllamaDiscovery(executable: nil, app: "/Applications/Ollama.app"), launcher: installedAppLauncher)
        try await appStarter.start()
        let openedApps = await installedAppLauncher.openedPaths()
        precondition(openedApps == ["/Applications/Ollama.app"], "CLI-absent installed app path dispatches app opening")
        let missingLauncher = FakeOllamaLauncher(failNamed: true)
        let missingStarter = OllamaRuntimeStarter(discovery: FakeOllamaDiscovery(executable: nil, app: nil), launcher: missingLauncher)
        do {
            try await missingStarter.start()
            preconditionFailure("missing named app should report an install failure")
        } catch let error as SemanticSearchError {
            precondition(error.message.contains("Get Ollama") && error.message.contains("install"), "missing app failure contains installation guidance")
        }
        let namedLaunchCount = await missingLauncher.namedCount()
        precondition(namedLaunchCount == 1, "missing app uses deterministic named-open fallback")

        if let native = NLEmbedding.sentenceEmbedding(for: .english), let vector = native.vector(for: "A synthetic sentence for a local embedding smoke test.") {
            precondition(!vector.isEmpty, "NaturalLanguage synthetic sentence embedding")
            let actualIdentity = AppleSemanticEmbeddingProvider().identity(for: "")
            let adapterVector = try await AppleSemanticEmbeddingProvider().embed(["A synthetic sentence for a local embedding smoke test."], model: actualIdentity).first
            precondition(adapterVector?.count == vector.count, "Apple adapter embeds in the fingerprinted English revision")
            do {
                _ = try await AppleSemanticEmbeddingProvider().embed(["Synthetic revision check"], model: "apple:nl-english:revision-999999")
                preconditionFailure("Apple adapter must reject a requested revision it cannot load")
            } catch is SemanticSearchError {}
            precondition(actualIdentity == "apple:nl-english:revision-\(native.revision)", "native adapter fingerprint matches loaded revision")
            print("NaturalLanguage embedding smoke test passed (revision \(native.revision))")
        } else { print("NaturalLanguage embedding unavailable; smoke test skipped") }
        print("Native provider checks passed")
    }
}
