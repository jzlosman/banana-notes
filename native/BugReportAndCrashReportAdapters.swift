import AppKit
import Darwin
import Foundation

@MainActor
final class BugReportController {
    private let diagnostics: () -> BugReportDiagnostics

    init(diagnostics: @escaping () -> BugReportDiagnostics) {
        self.diagnostics = diagnostics
    }

    func reportBug() {
        NSWorkspace.shared.open(BugReportPolicy.reportURL(for: diagnostics()))
    }
}

enum BugReportDiagnosticsAdapter {
    static func current(themeName: String) -> BugReportDiagnostics {
        let info = Bundle.main.infoDictionary ?? [:]
        return BugReportDiagnostics(
            appVersion: info["CFBundleShortVersionString"] as? String ?? "Unknown",
            build: info["CFBundleVersion"] as? String ?? "Unknown",
            macOSVersion: macOSVersion,
            macArchitecture: macArchitecture,
            themeName: themeName)
    }

    private static var macOSVersion: String {
        let process = ProcessInfo.processInfo
        let version = process.operatingSystemVersion
        let number = version.patchVersion == 0
            ? "\(version.majorVersion).\(version.minorVersion)"
            : "\(version.majorVersion).\(version.minorVersion).\(version.patchVersion)"
        let raw = process.operatingSystemVersionString
        guard let range = raw.range(of: #"\(Build [^)]+\)"#, options: .regularExpression) else { return number }
        let build = raw[range].replacingOccurrences(of: "(Build ", with: "(")
        return "\(number) \(build)"
    }

    private static var macArchitecture: String {
        var supportsAppleSilicon: Int32 = 0
        var size = MemoryLayout<Int32>.size
        let result = sysctlbyname("hw.optional.arm64", &supportsAppleSilicon, &size, nil, 0)
        return result == 0 && supportsAppleSilicon == 1 ? "arm64" : "x86_64"
    }
}

final class CrashReportDirectoryAdapter: CrashReportRepository {
    private let directoryURL: URL
    private let fileManager: FileManager

    init(directoryURL: URL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/DiagnosticReports", isDirectory: true),
         fileManager: FileManager = .default) {
        self.directoryURL = directoryURL.standardizedFileURL
        self.fileManager = fileManager
    }

    func reports() throws -> [CrashReportDescriptor] {
        let files = try fileManager.contentsOfDirectory(
            at: directoryURL,
            includingPropertiesForKeys: [.contentModificationDateKey, .isRegularFileKey],
            options: [.skipsHiddenFiles])
        return files.compactMap { fileURL in
            guard CrashReportPolicy.isSupportedFilename(fileURL.lastPathComponent),
                  let values = try? fileURL.resourceValues(forKeys: [.contentModificationDateKey, .isRegularFileKey]),
                  values.isRegularFile == true,
                  let modifiedAt = values.contentModificationDate else { return nil }
            return CrashReportDescriptor(filename: fileURL.lastPathComponent, modifiedAt: modifiedAt)
        }
    }

    func url(for report: CrashReportDescriptor) -> URL? {
        guard CrashReportPolicy.isSupportedFilename(report.filename) else { return nil }
        let fileURL = directoryURL.appendingPathComponent(report.filename, isDirectory: false).standardizedFileURL
        guard fileURL.deletingLastPathComponent() == directoryURL else { return nil }
        return fileURL
    }
}

@MainActor
final class CrashReportPromptAdapter {
    private static let lastLaunchTimestampKey = "crashReport.lastLaunchTimestamp"
    private static let dontAskAgainKey = "crashReport.dontAskAgain"

    private let preferences: any PreferencesStore
    private let reports: any CrashReportRepository
    private let bugReports: BugReportController

    init(preferences: any PreferencesStore, reports: any CrashReportRepository,
         bugReports: BugReportController) {
        self.preferences = preferences
        self.reports = reports
        self.bugReports = bugReports
    }

    func promptIfNeeded(bundleIdentifier: String?, now: Date = Date()) {
        guard let bundleIdentifier,
              !bundleIdentifier.hasPrefix(PreferenceMigrationPolicy.verificationBundlePrefix) else { return }

        let discovered: [CrashReportDescriptor]
        do { discovered = try reports.reports() }
        catch { return }

        let lastLaunchAt = preferences.object(forKey: Self.lastLaunchTimestampKey) as? Date
        let report = CrashReportPolicy.reportToPrompt(
            in: discovered,
            lastLaunchAt: lastLaunchAt,
            shouldAsk: !preferences.bool(forKey: Self.dontAskAgainKey),
            bundleIdentifier: bundleIdentifier)

        guard let report else {
            preferences.set(now, forKey: Self.lastLaunchTimestampKey)
            return
        }

        let alert = NSAlert()
        alert.messageText = "Banana Notes quit unexpectedly last time. Report the problem?"
        alert.informativeText = "Describe what happened in the form; the crash file is shown in Finder in case we ask for it."
        alert.alertStyle = .informational
        alert.addButton(withTitle: "Report…")
        alert.addButton(withTitle: "Not Now")
        let dontAskAgain = NSButton(checkboxWithTitle: "Don't ask again", target: nil, action: nil)
        dontAskAgain.state = .off
        alert.accessoryView = dontAskAgain
        let response = alert.runModal()

        preferences.set(now, forKey: Self.lastLaunchTimestampKey)
        preferences.set(dontAskAgain.state == .on, forKey: Self.dontAskAgainKey)
        guard response == .alertFirstButtonReturn else { return }

        bugReports.reportBug()
        if let fileURL = reports.url(for: report) {
            NSWorkspace.shared.activateFileViewerSelecting([fileURL])
        }
    }
}
