import Foundation

/// Pure construction of the one supported diagnostics-only bug-report URL.
enum BugReportPolicy {
    static func reportURL(for diagnostics: BugReportDiagnostics) -> URL {
        var components = URLComponents(string: "https://tally.so/r/Nqq6rl")!
        components.queryItems = [
            URLQueryItem(name: "version", value: bounded("\(diagnostics.appVersion) (\(diagnostics.build))")),
            URLQueryItem(name: "macos", value: bounded(diagnostics.macOSVersion)),
            URLQueryItem(name: "mac", value: bounded(diagnostics.macArchitecture)),
            URLQueryItem(name: "theme", value: bounded(diagnostics.themeName))
        ]
        guard let url = components.url else {
            preconditionFailure("The prefilled bug-report URL must be valid.")
        }
        return url
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
}
