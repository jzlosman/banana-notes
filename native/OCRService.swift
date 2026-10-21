import Foundation
import Vision
import ImageIO

struct OCRService {
    func recognize(url: URL) async throws -> String {
        try await Task.detached(priority: .userInitiated) {
            guard url.isFileURL else { throw AttachmentError(message: "OCR accepts local image files only.") }
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            let handler = VNImageRequestHandler(url: url, options: [:])
            try handler.perform([request])
            return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
        }.value
    }
}
