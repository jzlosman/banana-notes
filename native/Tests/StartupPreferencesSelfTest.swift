import Foundation
@testable import BananaNotesCore
import ServiceManagement

private final class LoginItemFake: LoginItemManaging {
    var status: SMAppService.Status = .notRegistered
    var registrations = 0
    var unregistrations = 0
    var failure: Error?
    func register() throws { registrations += 1; if let failure { throw failure }; status = .enabled }
    func unregister() throws { unregistrations += 1; if let failure { throw failure }; status = .notRegistered }
}

@main struct StartupPreferencesSelfTest {
    static func main() throws {
        let suite = "FoldnoteStartupTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let fake = LoginItemFake()
        let prefs = StartupPreferences(defaults: defaults, loginItem: fake)
        precondition(prefs.state.launchStatus == "notRegistered" && fake.registrations == 0, "reading preferences must not register a login item")
        fake.status = .requiresApproval
        precondition(prefs.state.launchStatus == "requiresApproval")
        try prefs.configureLaunchAtLogin(true)
        precondition(fake.registrations == 1 && prefs.state.launchAtLogin)
        try prefs.configureLaunchAtLogin(false)
        precondition(fake.unregistrations == 1 && !prefs.state.launchAtLogin)
        prefs.configureNewNoteOnLaunch(true)
        precondition(prefs.consumeColdLaunchNewNoteDecision())
        precondition(!prefs.consumeColdLaunchNewNoteDecision(), "reopen paths must not create a note again")
        precondition(StartupPreferences(defaults: defaults, loginItem: fake).consumeColdLaunchNewNoteDecision(), "the next cold launch must create a new note again")
        print("Startup preference checks passed")
    }
}
