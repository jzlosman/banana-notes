import Foundation

enum SemanticCommand: Sendable {
    case status
    case enable(enabled: Bool, provider: String?, model: String?)
    case startRuntime
    case download(model: String?)
    case index(notes: [SemanticIndexNote], force: Bool)
    case search(query: String, candidateIDs: [String])
    case clear
    case cancel
}

struct SemanticIndexNote: Codable, Equatable, Sendable {
    let id: String
    let markdown: String
    let updatedAt: String

    private enum CodingKeys: String, CodingKey { case id, markdown, updatedAt }
    init(id: String, markdown: String, updatedAt: String) throws {
        guard !id.isEmpty, id.utf8.count <= 512, markdown.utf8.count <= SemanticSearchService.maximumMarkdownBytes,
              updatedAt.count <= 128, Self.isISO8601(updatedAt) else {
            throw SemanticSearchError(message: "A note has an invalid identity, Markdown value, or update time.")
        }
        self.id = id
        self.markdown = markdown
        self.updatedAt = updatedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(id: container.decode(String.self, forKey: .id), markdown: container.decode(String.self, forKey: .markdown),
                      updatedAt: container.decode(String.self, forKey: .updatedAt))
    }

    private static func isISO8601(_ value: String) -> Bool {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if formatter.date(from: value) != nil { return true }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value) != nil
    }
}

struct SemanticEnablePayload: Decodable {
    let enabled: Bool
    let provider: String?
    let model: String?

    private enum CodingKeys: String, CodingKey { case enabled, provider, model }
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        enabled = try container.decode(Bool.self, forKey: .enabled)
        provider = container.contains(.provider) ? try container.decode(String.self, forKey: .provider) : nil
        model = container.contains(.model) ? try container.decode(String.self, forKey: .model) : nil
    }
}

struct SemanticDownloadPayload: Decodable {
    let model: String?
    private enum CodingKeys: String, CodingKey { case model }
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        model = container.contains(.model) ? try container.decode(String.self, forKey: .model) : nil
    }
}

struct SemanticIndexPayload: Decodable {
    let notes: [SemanticIndexNote]
    let force: Bool
    private enum CodingKeys: String, CodingKey { case notes, force }
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        notes = try container.decode([SemanticIndexNote].self, forKey: .notes)
        force = container.contains(.force) ? try container.decode(Bool.self, forKey: .force) : false
        guard notes.count <= SemanticSearchService.maximumNotes, Set(notes.map(\.id)).count == notes.count,
              let encoded = try? JSONEncoder().encode(notes), encoded.count <= SemanticSearchService.maximumSnapshotBytes else {
            throw StoreError(message: "Index input must contain no more than 20,000 unique notes and fit within 20 MB.")
        }
    }
}

struct SemanticSearchPayload: Decodable {
    let query: String
    let candidateIDs: [String]
    private enum CodingKeys: String, CodingKey { case query, candidateIDs }
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        query = try container.decode(String.self, forKey: .query)
        candidateIDs = try container.decode([String].self, forKey: .candidateIDs)
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, query.utf8.count <= 16_000,
              candidateIDs.count <= SemanticSearchService.maximumNotes,
              candidateIDs.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 512 }) else {
            throw StoreError(message: "Candidate note IDs are invalid.")
        }
    }
}
