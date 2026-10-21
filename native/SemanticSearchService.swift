import Foundation
import CryptoKit

struct SemanticSearchError: Error, LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

protocol SemanticHTTPClient: Sendable {
    func get(_ path: String) async throws -> Data
    func post(_ path: String, body: Data) async throws -> Data
}

private final class LoopbackRedirectDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard let original = task.currentRequest?.url, let target = request.url,
              SemanticSearchService.isAllowedLoopbackRedirect(from: original, to: target) else {
            completionHandler(nil)
            return
        }
        completionHandler(request)
    }
}

private struct LoopbackOllamaClient: SemanticHTTPClient {
    private let base = URL(string: "http://127.0.0.1:11434")!
    func get(_ path: String) async throws -> Data { try await request(path, method: "GET", body: nil) }
    func post(_ path: String, body: Data) async throws -> Data { try await request(path, method: "POST", body: body) }
    private func request(_ path: String, method: String, body: Data?) async throws -> Data {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.connectionProxyDictionary = ["HTTPEnable": 0, "HTTPSEnable": 0, "SOCKSEnable": 0,
                                                   "ProxyAutoConfigEnable": 0]
        let delegate = LoopbackRedirectDelegate()
        let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: base.appendingPathComponent(path))
        request.httpMethod = method
        request.httpBody = body
        request.timeoutInterval = 120
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else {
            throw SemanticSearchError(message: "Unable to connect to Ollama. Start Ollama and try again.")
        }
        return data
    }
}

private struct VectorChunk: Codable {
    let id: String
    let hash: String
    let snippet: String
    let vector: [Double]
}
private struct IndexedNote: Codable {
    let updatedAt: String
    let contentHash: String
    let chunks: [VectorChunk]
}
private struct SemanticIndex: Codable {
    var version: Int = 1
    var model: String
    var dimension: Int
    var notes: [String: IndexedNote]
}

/// Coordinates local indexing through native embeddings or explicitly selected loopback Ollama.
/// Provider I/O stays behind ports; the separate index cache remains in this app's data directory.
public actor SemanticSearchService {
    static let models: [(name: String, disclosure: String)] = [
        ("all-minilm:22m", "22M parameters · approximately 46 MB"),
        ("embeddinggemma:latest", "300M parameters · approximately 622 MB")
    ]
    static let maximumNotes = 20_000
    static let maximumMarkdownBytes = 1_000_000
    static let maximumSnapshotBytes = 20_000_000
    static let maximumVectorDimension = 4_096
    static func isAllowedLoopbackRedirect(from source: URL, to target: URL) -> Bool {
        let loopbackHosts: Set<String> = ["127.0.0.1", "::1"]
        return source.scheme == "http" && target.scheme == "http"
            && loopbackHosts.contains((target.host ?? "").lowercased())
            && target.port == 11434
            && source.port == target.port
    }
    private let directory: URL
    private let defaults: UserDefaults
    private let http: any SemanticHTTPClient
    private let apple: any SemanticEmbeddingProvider
    private let runtimeStarter: any SemanticRuntimeStarter
    private var generation = 0
    private var progress = ""
    private var indexing = false

    public init(directory: URL, defaults: UserDefaults) {
        self.directory = directory
        self.defaults = defaults
        self.http = LoopbackOllamaClient()
        self.apple = AppleSemanticEmbeddingProvider()
        self.runtimeStarter = OllamaRuntimeStarter()
    }

    init(directory: URL, defaults: UserDefaults, httpClient: any SemanticHTTPClient,
         appleProvider: any SemanticEmbeddingProvider = AppleSemanticEmbeddingProvider(),
         runtimeStarter: any SemanticRuntimeStarter = OllamaRuntimeStarter()) {
        self.directory = directory
        self.defaults = defaults
        self.http = httpClient
        self.apple = appleProvider
        self.runtimeStarter = runtimeStarter
    }

    public func handle(action: String, payload: [String: Any]) async throws -> [String: Any] {
        switch action {
        case "semanticStatus": return try await status()
        case "semanticEnable":
            guard let enabled = payload["enabled"] as? Bool else { throw SemanticSearchError(message: "Enable action requires a boolean enabled value.") }
            if payload["provider"] != nil, !(payload["provider"] is String) { throw SemanticSearchError(message: "Select Apple or Ollama as the semantic provider.") }
            let selectedProvider = payload["provider"] as? String ?? provider
            guard ["apple", "ollama"].contains(selectedProvider) else { throw SemanticSearchError(message: "Select Apple or Ollama as the semantic provider.") }
            let selectedModel = selectedProvider == "ollama" ? try resolveModel(payload["model"]) : ollamaModel
            if selectedProvider == "apple", payload["model"] != nil { throw SemanticSearchError(message: "Apple uses its built-in English embedding model.") }
            if selectedProvider != provider || selectedModel != ollamaModel || enabled != self.enabled { generation += 1 }
            defaults.set(selectedProvider, forKey: "semanticSearch.provider")
            if selectedProvider == "ollama", payload["model"] != nil { defaults.set(selectedModel, forKey: "semanticSearch.model") }
            defaults.set(enabled, forKey: "semanticSearch.enabled")
            return try await status()
        case "semanticStartRuntime": return try await startRuntime()
        case "semanticDownload":
            guard provider == "ollama", enabled else { throw SemanticSearchError(message: "Enable semantic search and select Ollama before downloading a model.") }
            let generationAtStart = generation
            let model = try resolveModel(payload["model"])
            progress = "Downloading \(model)"
            let body = try json(["name": model, "stream": false])
            _ = try await http.post("api/pull", body: body)
            guard generation == generationAtStart else { throw SemanticSearchError(message: "Download cancellation requested; check model status before retrying.") }
            progress = "Model download complete"
            return try await status()
        case "semanticIndex": return try await buildIndex(payload)
        case "semanticSearch": return try await search(payload)
        case "semanticClear":
            generation += 1
            if FileManager.default.fileExists(atPath: indexURL.path) { try FileManager.default.removeItem(at: indexURL) }
            progress = "Index cleared"
            return ["ok": true, "indexedNotes": 0]
        case "semanticCancel":
            generation += 1
            progress = "Cancellation requested"
            return ["ok": true, "progress": progress]
        default: throw SemanticSearchError(message: "Unknown semantic search action.")
        }
    }

    private var indexURL: URL { directory.appendingPathComponent("semantic-index.json") }
    private var preferences: SemanticProviderPreferences { SemanticProviderPreferences(defaults: defaults) }
    private var enabled: Bool { preferences.enabled }
    private var provider: String { preferences.provider }
    private var ollamaModel: String { preferences.ollamaModel }
    private var currentModel: String { provider == "apple" ? apple.identity(for: "") : ollamaModel }
    private var selectedOllamaModel: String { ollamaModel }
    private func resolveModel(_ value: Any?) throws -> String {
        if value != nil, !(value is String) { throw SemanticSearchError(message: "Select a supported embedding model in Settings → Search.") }
        let name = value as? String ?? ollamaModel
        guard Self.models.contains(where: { $0.name == name }) else {
            throw SemanticSearchError(message: "Select a supported embedding model in Settings → Search.")
        }
        return name
    }

    private func status() async throws -> [String: Any] {
        let installed: [String]
        let runtimeAvailable: Bool
        var unavailableReason: String?
        if !enabled {
            installed = []
            runtimeAvailable = false
        } else if provider == "apple" {
            let availability = apple.availability()
            installed = []
            runtimeAvailable = availability.available
            unavailableReason = availability.reason
        } else {
            do {
                let data = try await http.get("api/tags")
                let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                installed = (object?["models"] as? [[String: Any]] ?? []).compactMap { $0["name"] as? String }
                runtimeAvailable = true
            } catch { installed = []; runtimeAvailable = false; unavailableReason = "Ollama is unavailable. Get Ollama, install it, or open the Ollama app." }
        }
        let model = currentModel
        let localMatches = provider == "apple" ? runtimeAvailable : installed.contains { $0 == selectedOllamaModel || $0 == selectedOllamaModel.replacingOccurrences(of: ":latest", with: "") }
        let index: SemanticIndex?
        var indexError: String?
        do { index = try loadIndex() }
        catch { index = nil; indexError = error.localizedDescription }
        let indexedCount = index?.notes.count ?? 0
        let matchingIndex = index?.model == model
        let state = !enabled ? "disabled" : (!localMatches ? "modelMissing" : (indexError != nil ? "indexMalformed" : (matchingIndex ? "ready" : "indexNotReady")))
        return ["enabled": enabled, "provider": provider, "providers": [
                    ["id": "apple", "name": "Apple", "disclosure": "Built-in English embeddings; processed on this Mac.", "available": apple.availability().available],
                    ["id": "ollama", "name": "Ollama", "disclosure": "Optional local runtime; model download is explicit.", "available": true]],
                "unavailableReason": unavailableReason as Any? ?? NSNull(), "model": model,
                "models": Self.models.map { ["name": $0.name, "disclosure": $0.disclosure] },
                "installed": localMatches, "runtimeAvailable": runtimeAvailable,
                "indexedNotes": matchingIndex ? indexedCount : 0, "progress": progress, "indexError": indexError as Any? ?? NSNull(),
                "actionableState": state]
    }

    private func startRuntime() async throws -> [String: Any] {
        guard provider == "ollama", enabled else { throw SemanticSearchError(message: "Select Ollama and enable semantic search before starting its runtime.") }
        var state = try await status()
        if state["runtimeAvailable"] as? Bool == true { return state }
        let generationAtStart = generation
        try await runtimeStarter.start()
        // The desktop app may need a moment to start its server. Readiness is observed,
        // never inferred from a successful process/app launch request.
        for attempt in 0..<10 {
            guard generation == generationAtStart, provider == "ollama", enabled else { throw SemanticSearchError(message: "Ollama startup check cancelled because settings changed.") }
            state = try await status()
            if state["runtimeAvailable"] as? Bool == true { return state }
            if attempt < 9 { try await Task.sleep(for: .milliseconds(250)) }
        }
        return state
    }

    private func buildIndex(_ payload: [String: Any]) async throws -> [String: Any] {
        guard enabled else { throw SemanticSearchError(message: "Enable semantic search before building its local index.") }
        guard let notes = payload["notes"] as? [[String: Any]], notes.count <= Self.maximumNotes else {
            throw SemanticSearchError(message: "Index input must contain no more than 20,000 notes.")
        }
        guard let inputData = try? JSONSerialization.data(withJSONObject: ["notes": notes]), inputData.count <= Self.maximumSnapshotBytes else {
            throw SemanticSearchError(message: "Index snapshot exceeds the 20 MB safety limit.")
        }
        guard !indexing else { throw SemanticSearchError(message: "An index build is already in progress.") }
        indexing = true
        defer { indexing = false }
        guard provider != "apple" || apple.availability().available else {
            throw SemanticSearchError(message: "Apple’s English language model is unavailable on this Mac. Text search is still available.")
        }
        let model = provider == "ollama" ? try resolveModel(nil) : currentModel
        let prior = payload["force"] as? Bool == true ? nil : try loadIndex()
        var next = SemanticIndex(model: model, dimension: 0, notes: [:])
        if prior?.model == model { next = prior! }
        let generationAtStart = generation
        var seen = Set<String>()
        let validNotes = try notes.map { item -> (String, String, String) in
            guard let id = item["id"] as? String, !id.isEmpty, id.utf8.count <= 512,
                  let markdown = item["markdown"] as? String, markdown.utf8.count <= Self.maximumMarkdownBytes,
                  let updated = item["updatedAt"] as? String, updated.count <= 128, Self.isISO8601(updated) else {
                throw SemanticSearchError(message: "A note has an invalid identity, Markdown value, or update time; preserved note data was not modified.")
            }
            guard seen.insert(id).inserted else { throw SemanticSearchError(message: "Duplicate note identity in index snapshot.") }
            return (id, markdown, updated)
        }
        // Reconcile deletions before generating vectors; trashed notes must already be excluded by caller.
        next.notes = next.notes.filter { seen.contains($0.key) }
        for (index, note) in validNotes.enumerated() {
            try Task.checkCancellation()
            guard generation == generationAtStart else { throw SemanticSearchError(message: "Indexing cancelled.") }
            let hash = digest(note.1)
            if next.notes[note.0]?.contentHash == hash && next.model == model { continue }
            let pieces = chunks(note.1)
            progress = "Indexing \(index + 1) of \(validNotes.count)"
            let vectors = try await embedBatched(pieces.map(\.text), model: model)
            try Task.checkCancellation()
            guard generation == generationAtStart, enabled, currentModel == model else { throw SemanticSearchError(message: "Indexing cancelled because settings changed.") }
            guard vectors.count == pieces.count else { throw SemanticSearchError(message: "The local model returned no embeddings.") }
            let dimension = vectors.first?.count ?? next.dimension
            if !vectors.isEmpty {
                guard dimension > 0, dimension <= Self.maximumVectorDimension,
                      vectors.allSatisfy({ $0.count == dimension && $0.contains(where: { $0 != 0 }) && $0.allSatisfy(\.isFinite) }) else {
                    throw SemanticSearchError(message: "The embedding model returned invalid or unsupported vectors.")
                }
                guard next.dimension == 0 || next.dimension == dimension else { throw SemanticSearchError(message: "Embedding dimension changed; rebuild using one consistent model.") }
                next.dimension = dimension
            }
            next.notes[note.0] = IndexedNote(updatedAt: note.2, contentHash: hash,
                chunks: zip(pieces, vectors).map { VectorChunk(id: note.0, hash: hash, snippet: $0.0.snippet, vector: $0.1) })
        }
        guard generation == generationAtStart, enabled, currentModel == model else { throw SemanticSearchError(message: "Indexing cancelled because settings changed.") }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(next).write(to: indexURL, options: .atomic)
        progress = "Index up to date"
        return ["ok": true, "indexedNotes": next.notes.count, "model": model, "dimension": next.dimension]
    }

    private func search(_ payload: [String: Any]) async throws -> [String: Any] {
        guard enabled else { throw SemanticSearchError(message: "Semantic search is disabled. Enable it in settings first.") }
        guard let query = payload["query"] as? String, !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              query.utf8.count <= 16_000 else { throw SemanticSearchError(message: "Enter a query under 16 KB.") }
        guard let index = try loadIndex(), index.model == currentModel else {
            throw SemanticSearchError(message: "The local semantic index is not ready. Build or rebuild it in settings.")
        }
        guard index.dimension > 0, index.notes.values.contains(where: { !$0.chunks.isEmpty }) else {
            throw SemanticSearchError(message: "There is no searchable content in the local index. Add non-empty notes and rebuild it.")
        }
        guard let candidateArray = payload["candidateIDs"] as? [String], candidateArray.count <= Self.maximumNotes else {
            throw SemanticSearchError(message: "Search requires a valid candidate note ID list.")
        }
        guard candidateArray.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 512 }) else {
            throw SemanticSearchError(message: "Candidate note IDs are invalid.")
        }
        let candidateIDs = Set(candidateArray)
        let generationAtStart = generation
        let queryVector = try await embed([query], model: index.model).first ?? []
        guard generation == generationAtStart, enabled, currentModel == index.model else { throw SemanticSearchError(message: "Search cancelled because semantic settings or embedding space changed.") }
        guard queryVector.count == index.dimension, queryVector.count <= Self.maximumVectorDimension,
              queryVector.allSatisfy(\.isFinite), queryVector.contains(where: { $0 != 0 }) else {
            throw SemanticSearchError(message: "Query embedding is zero, invalid, or has an unsupported dimension.")
        }
        var scores: [(String, Double, String)] = []
        // Apply candidate scope before scoring/ranking.
        for (id, note) in index.notes where candidateIDs.contains(id) {
            let best = note.chunks.map { (cosine(queryVector, $0.vector), $0.snippet) }.max { $0.0 < $1.0 }
            if let best { scores.append((id, best.0, best.1)) }
        }
        let top = scores.sorted { $0.1 == $1.1 ? $0.0 < $1.0 : $0.1 > $1.1 }.prefix(50)
        return ["hits": top.map { ["id": $0.0, "score": $0.1, "snippet": $0.2] }, "model": index.model,
                "totalMatches": scores.count, "limit": 50]
    }

    private func embedBatched(_ inputs: [String], model: String) async throws -> [[Double]] {
        guard !inputs.isEmpty else { return [] }
        var output: [[Double]] = []
        let generationAtStart = generation
        for batchStart in stride(from: 0, to: inputs.count, by: 32) {
            try Task.checkCancellation()
            guard generation == generationAtStart, enabled, currentModel == model else { throw SemanticSearchError(message: "Indexing cancelled because settings changed.") }
            let batch = Array(inputs[batchStart..<min(batchStart + 32, inputs.count)])
            output.append(contentsOf: try await embed(batch, model: model))
            try Task.checkCancellation()
            guard generation == generationAtStart, enabled, currentModel == model else { throw SemanticSearchError(message: "Indexing cancelled because settings changed.") }
        }
        return output
    }
    private func embed(_ inputs: [String], model: String) async throws -> [[Double]] {
        guard !inputs.isEmpty else { return [] }
        if provider == "apple" { return try await apple.embed(inputs, model: model) }
        let data = try json(["model": model, "input": inputs, "truncate": true])
        let responseData = try await http.post("api/embed", body: data)
        try Task.checkCancellation()
        let response = try JSONSerialization.jsonObject(with: responseData) as? [String: Any]
        guard let vectors = response?["embeddings"] as? [[NSNumber]], vectors.count == inputs.count else {
            throw SemanticSearchError(message: "Local model response did not contain the expected embeddings.")
        }
        let result = vectors.map { $0.map(\.doubleValue) }
        guard result.allSatisfy({ !$0.isEmpty && $0.count <= Self.maximumVectorDimension && $0.allSatisfy(\.isFinite) }) else {
            throw SemanticSearchError(message: "The local model returned an invalid or oversized embedding vector.")
        }
        return result
    }
    private func loadIndex() throws -> SemanticIndex? {
        guard FileManager.default.fileExists(atPath: indexURL.path) else { return nil }
        let data = try Data(contentsOf: indexURL)
        guard data.count <= 100_000_000 else { throw SemanticSearchError(message: "Semantic index file exceeds the safety limit and was left untouched.") }
        do {
            let index = try JSONDecoder().decode(SemanticIndex.self, from: data)
            guard index.version == 1, index.dimension >= 0, index.dimension <= Self.maximumVectorDimension,
                  (Self.models.contains(where: { $0.name == index.model }) || index.model.range(of: #"^apple:nl-english:revision-[1-9][0-9]*$"#, options: .regularExpression) != nil),
                  index.notes.allSatisfy({ id, note in
                      note.chunks.allSatisfy { $0.id == id && $0.hash == note.contentHash && $0.hash.count == 64
                          && $0.vector.count == index.dimension && $0.vector.allSatisfy(\.isFinite)
                          && ($0.vector.isEmpty || $0.vector.contains(where: { $0 != 0 })) }
                  }) else {
                throw SemanticSearchError(message: "Semantic index is malformed and was left untouched; clear it explicitly to rebuild.")
            }
            return index
        } catch let error as SemanticSearchError { throw error }
        catch { throw SemanticSearchError(message: "Semantic index is malformed and was left untouched; clear it explicitly to rebuild.") }
    }
    private func chunks(_ markdown: String) -> [(text: String, snippet: String)] {
        let normalized = markdown.replacingOccurrences(of: "\r\n", with: "\n")
        guard !normalized.isEmpty else { return [] }
        var result: [(String, String)] = [], start = normalized.startIndex
        while start < normalized.endIndex {
            let end = normalized.index(start, offsetBy: 700, limitedBy: normalized.endIndex) ?? normalized.endIndex
            let text = String(normalized[start..<end]).trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty { result.append((text, String(text.prefix(240)))) }
            start = end
        }
        return result
    }
    private static func isISO8601(_ value: String) -> Bool {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if formatter.date(from: value) != nil { return true }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value) != nil
    }
    private func digest(_ value: String) -> String { SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined() }
    private func cosine(_ lhs: [Double], _ rhs: [Double]) -> Double {
        guard lhs.count == rhs.count else { return -1 }
        let dot = zip(lhs, rhs).reduce(0) { $0 + $1.0 * $1.1 }
        let norms = sqrt(lhs.reduce(0) { $0 + $1 * $1 }) * sqrt(rhs.reduce(0) { $0 + $1 * $1 })
        return norms > 0 ? dot / norms : 0
    }
    private func json(_ value: [String: Any]) throws -> Data { try JSONSerialization.data(withJSONObject: value) }
}
