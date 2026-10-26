import Foundation

/// The only user-provided contact destination for optional bug-report email.
/// Keep nil to offer GitHub issues only.
enum BugReportPolicy {
    static let bugReportEmail: String? = nil
    static let githubIssueTemplate = "bug_report.yml"
    static let maximumIssueURLBytes = 8_000

    static func destinations(for diagnostics: BugReportDiagnostics, email: String? = bugReportEmail) -> [BugReportDestination] {
        var destinations = [BugReportDestination.github(issueURL(for: diagnostics))]
        if let email = email?.trimmingCharacters(in: .whitespacesAndNewlines), !email.isEmpty,
           let emailURL = emailURL(address: email, diagnostics: diagnostics) {
            destinations.append(.email(emailURL))
        }
        return destinations
    }

    static func issueURL(for diagnostics: BugReportDiagnostics) -> URL {
        var components = URLComponents(string: "https://github.com/jzlosman/banana-notes/issues/new")!
        components.queryItems = [
            URLQueryItem(name: "template", value: githubIssueTemplate),
            URLQueryItem(name: "app-version", value: bounded(diagnostics.appVersion)),
            URLQueryItem(name: "app-build", value: bounded(diagnostics.build)),
            URLQueryItem(name: "macos-version", value: bounded(diagnostics.macOSVersion)),
            URLQueryItem(name: "mac", value: bounded(diagnostics.macArchitecture)),
            URLQueryItem(name: "theme", value: bounded(diagnostics.themeName))
        ]
        guard let url = components.url, url.absoluteString.utf8.count < maximumIssueURLBytes else {
            preconditionFailure("The prefilled bug-report URL must be valid and shorter than 8,000 bytes.")
        }
        return url
    }

    private static func emailURL(address: String, diagnostics: BugReportDiagnostics) -> URL? {
        var components = URLComponents()
        components.scheme = "mailto"
        components.path = address
        components.queryItems = [
            URLQueryItem(name: "subject", value: "Banana Notes bug report"),
            URLQueryItem(name: "body", value: diagnostics.emailSummary)
        ]
        return components.url
    }

    private static func bounded(_ value: String) -> String {
        let singleLine = value.replacingOccurrences(of: "\r", with: " ").replacingOccurrences(of: "\n", with: " ")
        return String(singleLine.unicodeScalars.prefix(96))
    }
}

struct BugReportDiagnostics: Equatable {
    let appVersion: String
    let build: String
    let macOSVersion: String
    let macArchitecture: String
    let themeName: String

    var emailSummary: String {
        [
            "Banana Notes bug report diagnostics:",
            "App version: \(appVersion)",
            "Build: \(build)",
            "macOS version: \(macOSVersion)",
            "Mac: \(macArchitecture)",
            "Theme: \(themeName)"
        ].joined(separator: "\n")
    }
}

enum BugReportDestination: Equatable {
    case github(URL)
    case email(URL)
}
