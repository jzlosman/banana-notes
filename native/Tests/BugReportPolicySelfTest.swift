import Foundation
@testable import BananaNotesCore

@main
struct BugReportPolicySelfTest {
    static func main() {
        let diagnostics = BugReportDiagnostics(
            appVersion: "0.2.4",
            build: "8",
            macOSVersion: "15.3 (24D60)",
            macArchitecture: "arm64",
            themeName: "Rosé Pine Dawn")

        let reportURL = BugReportPolicy.reportURL(for: diagnostics)
        guard let form = URLComponents(url: reportURL, resolvingAgainstBaseURL: false) else {
            preconditionFailure("the Tally report URL must be available")
        }
        precondition(form.scheme == "https" && form.host == "tally.so" && form.path == "/r/Nqq6rl")
        let items = form.queryItems ?? []
        precondition(items.count == 4, "only the four approved hidden fields are sent")
        precondition(Set(items.map(\.name)) == ["version", "macos", "mac", "theme"],
                     "the report URL contains only the approved diagnostics")
        let fields = Dictionary(uniqueKeysWithValues: items.compactMap { item in
            item.value.map { (item.name, $0) }
        })
        precondition(fields["version"] == "0.2.4 (8)")
        precondition(fields["macos"] == diagnostics.macOSVersion)
        precondition(fields["mac"] == diagnostics.macArchitecture)
        precondition(fields["theme"] == diagnostics.themeName)

        let encodedURL = reportURL.absoluteString
        precondition(encodedURL.contains("version=0.2.4%20(8)"))
        precondition(encodedURL.contains("macos=15.3%20(24D60)"))
        precondition(encodedURL.contains("theme=Ros%C3%A9%20Pine%20Dawn"))
        precondition(!encodedURL.contains("Rosé") && !encodedURL.contains(" "))
        for privateNoteData in ["private note content", "private-note-title", "#private-tag", "/Users/example/notes.md"] {
            precondition(!encodedURL.contains(privateNoteData), "note content, titles, tags, and paths are never included")
        }

        print("Prefilled report URL: \(reportURL.absoluteString)")
        print("Native bug-report policy checks passed (Tally destination, encoded diagnostic allowlist)")
    }
}
