import Foundation

@main
struct OllamaResponsePolicySelfTest {
    static func main() throws {
        precondition(OllamaResponsePolicy.byteLimit(for: "api/tags") == 1_048_576)
        precondition(OllamaResponsePolicy.byteLimit(for: "api/version") == 1_048_576)
        precondition(OllamaResponsePolicy.byteLimit(for: "api/embed") == 32 * 1_048_576)
        try OllamaResponsePolicy.validateSize(Data(repeating: 0, count: OllamaResponsePolicy.metadataLimit), path: "api/tags")
        do {
            try OllamaResponsePolicy.validateSize(Data(repeating: 0, count: OllamaResponsePolicy.metadataLimit + 1), path: "api/tags")
            preconditionFailure("oversized metadata response accepted")
        } catch let error as SemanticSearchError { precondition(error.message.contains("1 MiB")) }
        do {
            try OllamaResponsePolicy.validateSize(Data(repeating: 0, count: OllamaResponsePolicy.embeddingLimit + 1), path: "api/embed")
            preconditionFailure("oversized embedding response accepted")
        } catch let error as SemanticSearchError { precondition(error.message.contains("32 MiB")) }

        let good = Data(#"{"embeddings":[[1.0,0.0],[0.0,1.0]]}"#.utf8)
        let vectors = try OllamaResponsePolicy.embeddings(from: good, expectedCount: 2, maximumDimension: 2)
        precondition(vectors == [[1, 0], [0, 1]])
        for (json, expected) in [(#"{"embeddings":[[1,0]]}"#, 2),
                                 (#"{"embeddings":[[1,0],[0,1,2]]}"#, 2),
                                 (#"{"embeddings":[[true,0]]}"#, 1),
                                 (#"{"embeddings":[[1,0,0]]}"#, 1)] {
            do {
                _ = try OllamaResponsePolicy.embeddings(from: Data(json.utf8), expectedCount: expected, maximumDimension: 2)
                preconditionFailure("invalid embedding response accepted: \(json)")
            } catch is SemanticSearchError {}
        }
        do {
            _ = try OllamaResponsePolicy.modelNames(from: Data(#"{"models":[{}]}"#.utf8))
            preconditionFailure("malformed model status accepted")
        } catch is SemanticSearchError {}
        print("Ollama response byte limits and vector-shape validation checks passed")
    }
}
