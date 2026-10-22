import Foundation

private struct LibraryCodingKey: CodingKey {
    let stringValue: String
    let intValue: Int?
    init?(stringValue: String) { self.stringValue = stringValue; intValue = nil }
    init?(intValue: Int) { self.intValue = intValue; stringValue = String(intValue) }
}

private func ensureKnownKeys(_ decoder: Decoder, allowed: Set<String>) throws {
    let container = try decoder.container(keyedBy: LibraryCodingKey.self)
    guard container.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
        throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Library contains fields outside the supported version 1 schema."))
    }
}

/// Validated library data crossing the application/persistence boundary.
struct LibraryDocument: Codable, Equatable, Sendable {
    let version: Int
    let notes: [LibraryNote]
    let selectedID: String?
    let activeTag: String?
    let activeTags: [String]?

    init(version: Int = 1, notes: [LibraryNote], selectedID: String?, activeTag: String?, activeTags: [String]? = nil) throws {
        self.version = version
        self.notes = notes
        self.selectedID = selectedID
        self.activeTag = activeTag
        self.activeTags = activeTags
        try LibraryStore.validate(self)
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case version, notes, selectedID, activeTag, activeTags
    }

    init(from decoder: Decoder) throws {
        try ensureKnownKeys(decoder, allowed: Set(CodingKeys.allCases.map(\.stringValue)))
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decode(Int.self, forKey: .version)
        notes = try container.decode([LibraryNote].self, forKey: .notes)
        guard container.contains(.selectedID), container.contains(.activeTag) else {
            throw DecodingError.keyNotFound(CodingKeys.selectedID,
                .init(codingPath: decoder.codingPath, debugDescription: "Library selection fields are required, even when null."))
        }
        selectedID = try container.decodeIfPresent(String.self, forKey: .selectedID)
        activeTag = try container.decodeIfPresent(String.self, forKey: .activeTag)
        activeTags = container.contains(.activeTags) ? try container.decode([String].self, forKey: .activeTags) : nil
        do { try LibraryStore.validate(self) }
        catch {
            throw DecodingError.dataCorruptedError(forKey: .notes, in: container, debugDescription: error.localizedDescription)
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(version, forKey: .version)
        try container.encode(notes, forKey: .notes)
        try container.encode(selectedID, forKey: .selectedID)
        try container.encode(activeTag, forKey: .activeTag)
        try container.encodeIfPresent(activeTags, forKey: .activeTags)
    }
}

struct LibraryNote: Codable, Equatable, Sendable {
    let id: String
    let markdown: String
    let createdAt: String
    let updatedAt: String
    let trashedAt: String?

    private enum CodingKeys: String, CodingKey, CaseIterable { case id, markdown, createdAt, updatedAt, trashedAt }

    init(id: String, markdown: String, createdAt: String, updatedAt: String, trashedAt: String? = nil) {
        self.id = id
        self.markdown = markdown
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.trashedAt = trashedAt
    }

    init(from decoder: Decoder) throws {
        try ensureKnownKeys(decoder, allowed: Set(CodingKeys.allCases.map(\.stringValue)))
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        markdown = try container.decode(String.self, forKey: .markdown)
        createdAt = try container.decode(String.self, forKey: .createdAt)
        updatedAt = try container.decode(String.self, forKey: .updatedAt)
        trashedAt = container.contains(.trashedAt) ? try container.decode(String.self, forKey: .trashedAt) : nil
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(markdown, forKey: .markdown)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encodeIfPresent(trashedAt, forKey: .trashedAt)
    }
}
