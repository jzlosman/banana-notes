import Foundation

@main
struct LibraryStorePerformanceSelfTest {
    static func main() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("LibraryPerf-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = LibraryStore(directory: root)
        let notes = (0..<5_000).map { index in
            LibraryNote(id: "note-\(index)", markdown: String(repeating: "Synthetic note text — ", count: 8),
                        createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z")
        }
        let library = try LibraryDocument(notes: notes, selectedID: "note-0", activeTag: nil)
        var durableMilliseconds: [Double] = []
        var submissionMilliseconds: [Double] = []
        var completionWasOffMain = true
        for _ in 0..<5 {
            let started = DispatchTime.now().uptimeNanoseconds
            let completed = DispatchSemaphore(value: 0)
            store.saveAsync(library) { result in
                if case .failure(let error) = result { preconditionFailure("synthetic durable save failed: \(error)") }
                completionWasOffMain = !Thread.isMainThread
                completed.signal()
            }
            let submitted = DispatchTime.now().uptimeNanoseconds
            precondition(completed.wait(timeout: .now() + 10) == .success, "synthetic durable save timed out")
            let finished = DispatchTime.now().uptimeNanoseconds
            submissionMilliseconds.append(Double(submitted - started) / 1_000_000)
            durableMilliseconds.append(Double(finished - started) / 1_000_000)
        }
        durableMilliseconds.sort(); submissionMilliseconds.sort()
        let p50 = durableMilliseconds[durableMilliseconds.count / 2]
        let mainP50 = submissionMilliseconds[submissionMilliseconds.count / 2]
        precondition(completionWasOffMain, "durable save completion should not run on the main thread")
        let saved = try store.load()
        precondition(saved?.notes.count == 5_000)
        print(String(format: "5,000-note durable save: p50 %.1f ms end-to-end; p50 %.3f ms main-thread submission; completion off-main: yes", p50, mainP50))
    }
}
