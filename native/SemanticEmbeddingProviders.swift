import Foundation
import NaturalLanguage
import AppKit
import Darwin

protocol SemanticEmbeddingProvider: Sendable {
    func identity(for model: String) -> String
    func availability() -> (available: Bool, reason: String?)
    func embed(_ inputs: [String], model: String) async throws -> [[Double]]
}

struct AppleSemanticEmbeddingProvider: SemanticEmbeddingProvider {
    func identity(for model: String) -> String { "apple:nl-english:revision-\(NLEmbedding.sentenceEmbedding(for: .english)?.revision ?? 0)" }
    func availability() -> (available: Bool, reason: String?) {
        guard NLEmbedding.sentenceEmbedding(for: .english) != nil else {
            return (false, "Apple’s English language model is unavailable on this Mac. Ollama is available as an optional provider.")
        }
        return (true, nil)
    }
    func embed(_ inputs: [String], model: String) async throws -> [[Double]] {
        guard let embedding = NLEmbedding.sentenceEmbedding(for: .english) else {
            throw SemanticSearchError(message: "Apple’s English language model is unavailable on this Mac.")
        }
        let actualIdentity = "apple:nl-english:revision-\(embedding.revision)"
        guard model == actualIdentity else {
            throw SemanticSearchError(message: "Apple’s English embedding revision changed; rebuild the semantic index before using it.")
        }
        return try inputs.map { text in
            guard let vector = embedding.vector(for: text) else { throw SemanticSearchError(message: "Apple could not create an English sentence embedding.") }
            return vector.map { Double($0) }
        }
    }
}

struct OllamaListener: Sendable {
    let pid: Int32
    let uid: UInt32?
    let executablePath: String?
}
protocol OllamaProcessInspecting: Sendable { func listener() -> OllamaListener? }
struct NoOllamaProcessInspector: OllamaProcessInspecting { func listener() -> OllamaListener? { nil } }

struct SystemOllamaProcessInspector: OllamaProcessInspecting {
    func listener() -> OllamaListener? {
        guard let output = run("/usr/sbin/lsof", ["-nP", "-iTCP@127.0.0.1:11434", "-sTCP:LISTEN", "-Fpu"]) else { return nil }
        let lines = output.split(whereSeparator: \.isNewline).map(String.init)
        let pidLines = lines.filter { $0.hasPrefix("p") }
        let pids = Set(pidLines.compactMap { Int32($0.dropFirst()) })
        guard pids.count == 1, let pid = pids.first else {
            return OllamaListener(pid: 0, uid: nil, executablePath: nil)
        }
        let uidLine = lines.first(where: { $0.hasPrefix("u") })
        let uid = uidLine.flatMap { UInt32($0.dropFirst()) }
        let processFiles = run("/usr/sbin/lsof", ["-a", "-p", String(pid), "-d", "txt", "-Fn"])
        let executable = processFiles?.split(whereSeparator: \.isNewline).map(String.init).first(where: { $0.hasPrefix("n/") }).map { String($0.dropFirst()) }
        return OllamaListener(pid: pid, uid: uid, executablePath: executable)
    }

    private func run(_ path: String, _ arguments: [String]) -> String? {
        guard FileManager.default.isExecutableFile(atPath: path) else { return nil }
        let process = Process(); process.executableURL = URL(fileURLWithPath: path); process.arguments = arguments
        let output = Pipe(); process.standardOutput = output; process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            let data = output.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else { return nil }
            return String(data: data, encoding: .utf8)
        } catch { return nil }
    }
}

enum OllamaRuntimePolicy {
    static func isTrusted(_ listener: OllamaListener, currentUID: UInt32 = UInt32(getuid())) -> Bool {
        guard listener.pid > 0, listener.uid == currentUID, let path = listener.executablePath else { return false }
        let normalized = URL(fileURLWithPath: path).standardizedFileURL.path
        let basename = URL(fileURLWithPath: normalized).lastPathComponent.lowercased()
        let inOllamaBundle = normalized.contains("/Ollama.app/")
        return basename == "ollama" || inOllamaBundle
    }
}

protocol SemanticRuntimeStarter: Sendable { func start() async throws }
protocol OllamaRuntimeDiscovery: Sendable {
    func executablePath() -> String?
    func applicationPath() -> String?
}
protocol OllamaRuntimeLaunching: Sendable {
    func launchServe(executable: String) async throws
    func openApplication(path: String) async throws
    func openNamedApplication() async throws
}
struct SystemOllamaRuntimeDiscovery: OllamaRuntimeDiscovery {
    func executablePath() -> String? { ["/usr/local/bin/ollama", "/opt/homebrew/bin/ollama"].first { FileManager.default.isExecutableFile(atPath: $0) } }
    func applicationPath() -> String? { ["/Applications/Ollama.app", NSHomeDirectory() + "/Applications/Ollama.app"].first { FileManager.default.fileExists(atPath: $0) } }
}
struct SystemOllamaRuntimeLauncher: OllamaRuntimeLaunching {
    func launchServe(executable: String) async throws {
        let process = Process(); process.executableURL = URL(fileURLWithPath: executable); process.arguments = ["serve"]
        process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
        try process.run()
    }
    @MainActor func openApplication(path: String) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: path), configuration: NSWorkspace.OpenConfiguration()) { _, error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
    }
    func openNamedApplication() async throws {
        let process = Process(); process.executableURL = URL(fileURLWithPath: "/usr/bin/open"); process.arguments = ["-a", "Ollama"]
        process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            process.terminationHandler = { finished in
                if finished.terminationStatus == 0 { continuation.resume() }
                else { continuation.resume(throwing: SemanticSearchError(message: "open -a Ollama exited with status \(finished.terminationStatus).")) }
            }
            do { try process.run() } catch { continuation.resume(throwing: error) }
        }
    }
}
struct OllamaRuntimeStarter: SemanticRuntimeStarter {
    let discovery: any OllamaRuntimeDiscovery
    let launcher: any OllamaRuntimeLaunching
    init(discovery: any OllamaRuntimeDiscovery = SystemOllamaRuntimeDiscovery(), launcher: any OllamaRuntimeLaunching = SystemOllamaRuntimeLauncher()) {
        self.discovery = discovery; self.launcher = launcher
    }
    func start() async throws {
        do {
            if let executable = discovery.executablePath() { try await launcher.launchServe(executable: executable); return }
            if let app = discovery.applicationPath() { try await launcher.openApplication(path: app); return }
            try await launcher.openNamedApplication()
        } catch {
            throw SemanticSearchError(message: "Unable to start Ollama. Get Ollama, install it, or open the Ollama app, then retry. (\(error.localizedDescription))")
        }
    }
}

struct SemanticProviderPreferences {
    let defaults: any PreferencesStore
    var enabled: Bool { defaults.object(forKey: "semanticSearch.enabled") as? Bool ?? true }
    var provider: String {
        if let explicit = defaults.string(forKey: "semanticSearch.provider"), ["apple", "ollama"].contains(explicit) { return explicit }
        if defaults.object(forKey: "semanticSearch.enabled") != nil { return "ollama" }
        return "apple"
    }
    var ollamaModel: String { defaults.string(forKey: "semanticSearch.model") ?? "all-minilm:22m" }
}
