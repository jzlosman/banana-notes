import Foundation
@testable import BananaNotesCore

@main
struct CrashReportPolicySelfTest {
    static func main() throws {
        let lastLaunch = Date(timeIntervalSince1970: 1_700_000_000)
        let earlier = CrashReportDescriptor(filename: "Banana Notes-before.crash", modifiedAt: lastLaunch.addingTimeInterval(-1))
        let ips = CrashReportDescriptor(filename: "Banana Notes-new.ips", modifiedAt: lastLaunch.addingTimeInterval(1))
        let crash = CrashReportDescriptor(filename: "Banana Notes-newer.crash", modifiedAt: lastLaunch.addingTimeInterval(2))
        let unrelated = CrashReportDescriptor(filename: "Other App-new.ips", modifiedAt: lastLaunch.addingTimeInterval(3))
        let reports = [earlier, ips, crash, unrelated]

        precondition(CrashReportPolicy.reportToPrompt(
            in: reports, lastLaunchAt: lastLaunch, shouldAsk: true,
            bundleIdentifier: PreferenceMigrationPolicy.currentBundleIdentifier) == crash,
            "the newest supported crash report after the previous launch is selected")
        precondition(CrashReportPolicy.reportToPrompt(
            in: reports, lastLaunchAt: lastLaunch, shouldAsk: false,
            bundleIdentifier: PreferenceMigrationPolicy.currentBundleIdentifier) == nil,
            "Don't ask again suppresses the prompt")
        precondition(CrashReportPolicy.reportToPrompt(
            in: reports, lastLaunchAt: lastLaunch, shouldAsk: true,
            bundleIdentifier: "\(PreferenceMigrationPolicy.verificationBundlePrefix)test") == nil,
            "verification apps never prompt")
        precondition(CrashReportPolicy.reportToPrompt(
            in: reports, lastLaunchAt: nil, shouldAsk: true,
            bundleIdentifier: PreferenceMigrationPolicy.currentBundleIdentifier) == nil,
            "the first launch establishes a timestamp rather than reporting old logs")
        precondition(CrashReportPolicy.reportToPrompt(
            in: [earlier], lastLaunchAt: lastLaunch, shouldAsk: true,
            bundleIdentifier: PreferenceMigrationPolicy.currentBundleIdentifier) == nil,
            "a report from before the prior launch is ignored")
        precondition(!CrashReportPolicy.isSupportedFilename("Banana Notes-../private.ips"))
        precondition(!CrashReportPolicy.isSupportedFilename("Banana Notes-live.txt"))

        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("BananaNotesCrashReportTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let fixtureURL = directory.appendingPathComponent("Banana Notes-fixture.ips")
        try Data().write(to: fixtureURL)
        let modifiedAt = lastLaunch.addingTimeInterval(5)
        try FileManager.default.setAttributes([.modificationDate: modifiedAt], ofItemAtPath: fixtureURL.path)
        try Data().write(to: directory.appendingPathComponent("Unrelated App-fixture.ips"))

        let adapter = CrashReportDirectoryAdapter(directoryURL: directory)
        let discovered = try adapter.reports()
        precondition(discovered == [CrashReportDescriptor(filename: fixtureURL.lastPathComponent, modifiedAt: modifiedAt)],
                     "the filesystem adapter lists matching file names and metadata only")
        precondition(adapter.url(for: discovered[0]) == fixtureURL.standardizedFileURL)
        precondition(adapter.url(for: CrashReportDescriptor(filename: "../private.ips", modifiedAt: modifiedAt)) == nil,
                     "Finder selection cannot escape the DiagnosticReports directory")
        print("Native crash-report policy checks passed (one-time discovery, suppression, verification isolation, temp-file adapter)")
    }
}
