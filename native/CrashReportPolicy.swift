import Foundation

struct CrashReportDescriptor: Equatable {
    let filename: String
    let modifiedAt: Date
}

enum CrashReportPolicy {
    static func reportToPrompt(in reports: [CrashReportDescriptor], lastLaunchAt: Date?, shouldAsk: Bool,
                               bundleIdentifier: String?) -> CrashReportDescriptor? {
        guard shouldAsk,
              let bundleIdentifier,
              !bundleIdentifier.hasPrefix(PreferenceMigrationPolicy.verificationBundlePrefix),
              let lastLaunchAt else { return nil }

        return reports
            .filter { isSupportedFilename($0.filename) && $0.modifiedAt > lastLaunchAt }
            .max { lhs, rhs in
                if lhs.modifiedAt == rhs.modifiedAt { return lhs.filename < rhs.filename }
                return lhs.modifiedAt < rhs.modifiedAt
            }
    }

    static func isSupportedFilename(_ filename: String) -> Bool {
        guard filename.hasPrefix("Banana Notes-"),
              !filename.contains("/"), !filename.contains("\\") else { return false }
        let stem = filename.dropFirst("Banana Notes-".count)
        return stem.hasSuffix(".ips") && stem.count > ".ips".count
            || stem.hasSuffix(".crash") && stem.count > ".crash".count
    }
}
