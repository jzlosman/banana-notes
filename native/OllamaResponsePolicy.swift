import Foundation
import CoreFoundation

/// Validates untrusted local-runtime responses before model values enter indexing.
enum OllamaResponsePolicy {
    static let metadataLimit = 1_048_576
    static let embeddingLimit = 32 * 1_048_576

    static func byteLimit(for path: String) -> Int {
        path == "api/embed" || path == "api/embeddings" ? embeddingLimit : metadataLimit
    }

    static func validateSize(_ data: Data, path: String) throws {
        let limit = byteLimit(for: path)
        guard data.count <= limit else {
            throw SemanticSearchError(message: "Ollama response exceeds the \(limit / 1_048_576) MiB safety limit.")
        }
    }

    static func modelNames(from data: Data) throws -> [String] {
        try validateSize(data, path: "api/tags")
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let models = object["models"] as? [[String: Any]],
              models.allSatisfy({ $0["name"] is String }) else {
            throw SemanticSearchError(message: "Ollama returned invalid model status data.")
        }
        return models.compactMap { $0["name"] as? String }
    }

    static func embeddings(from data: Data, expectedCount: Int, maximumDimension: Int) throws -> [[Double]] {
        try validateSize(data, path: "api/embed")
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rawVectors = object["embeddings"] as? [Any], rawVectors.count == expectedCount,
              let first = rawVectors.first as? [Any], !first.isEmpty,
              first.count <= maximumDimension else {
            throw SemanticSearchError(message: "Local model response did not contain the expected embedding count and dimensions.")
        }
        let dimension = first.count
        var vectors: [[Double]] = []
        vectors.reserveCapacity(rawVectors.count)
        for raw in rawVectors {
            guard let values = raw as? [Any], values.count == dimension else {
                throw SemanticSearchError(message: "The embedding model returned inconsistent vector dimensions.")
            }
            var vector: [Double] = []
            vector.reserveCapacity(dimension)
            for value in values {
                guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue.isFinite else {
                    throw SemanticSearchError(message: "The embedding model returned a non-numeric or invalid vector value.")
                }
                vector.append(number.doubleValue)
            }
            vectors.append(vector)
        }
        return vectors
    }
}
