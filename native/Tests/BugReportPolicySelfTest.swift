import Foundation
@testable import BananaNotesCore

@main
struct BugReportPolicySelfTest {
    static func main() {
        let diagnostics = BugReportDiagnostics(
            appVersion: "0.2.2",
            build: "42",
            macOSVersion: "Version 15.3 (Build 24D60)",
            macArchitecture: "arm64",
            themeName: "Rosé Pine Dawn")
        precondition(BugReportPolicy.bugReportEmail == nil, "email reporting stays disabled until configured")

        let githubOnly = BugReportPolicy.destinations(for: diagnostics)
        precondition(githubOnly.count == 1, "nil email exposes only the GitHub route")
        guard case let .github(issueURL) = githubOnly[0],
              let issue = URLComponents(url: issueURL, resolvingAgainstBaseURL: false) else {
            preconditionFailure("the GitHub report URL must be available")
        }
        let fields = Dictionary(uniqueKeysWithValues: (issue.queryItems ?? []).compactMap { item in
            item.value.map { (item.name, $0) }
        })
        precondition(Set(fields.keys) == ["template", "app-version", "app-build", "macos-version", "mac", "theme"],
                     "only the form template and approved diagnostics are sent")
        precondition(fields["template"] == "bug_report.yml")
        precondition(fields["app-version"] == diagnostics.appVersion && fields["app-build"] == diagnostics.build)
        precondition(fields["macos-version"] == diagnostics.macOSVersion && fields["mac"] == diagnostics.macArchitecture)
        precondition(fields["theme"] == diagnostics.themeName)
        precondition(issueURL.absoluteString.utf8.count < BugReportPolicy.maximumIssueURLBytes)

        let withEmail = BugReportPolicy.destinations(for: diagnostics, email: "bugs@example.com")
        precondition(withEmail.count == 2, "a configured email exposes GitHub and email routes")
        guard case let .github(emailChoiceIssue) = withEmail[0], emailChoiceIssue == issueURL,
              case let .email(emailURL) = withEmail[1],
              let email = URLComponents(url: emailURL, resolvingAgainstBaseURL: false) else {
            preconditionFailure("configured email must add a mailto route without replacing GitHub")
        }
        let emailBody = email.queryItems?.first(where: { $0.name == "body" })?.value ?? ""
        for value in [diagnostics.appVersion, diagnostics.build, diagnostics.macOSVersion,
                      diagnostics.macArchitecture, diagnostics.themeName] {
            precondition(emailBody.contains(value), "email includes the same approved diagnostics")
        }
        precondition(email.scheme == "mailto" && email.path == "bugs@example.com")
        print("Prefilled report URL: \(issueURL.absoluteString)")
        print("Native bug-report policy checks passed (GitHub-only default, optional email, diagnostic allowlist)")
    }
}
