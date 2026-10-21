import Foundation
import ServiceManagement

protocol LoginItemManaging {
    var status: SMAppService.Status { get }
    func register() throws
    func unregister() throws
}

private struct MainAppLoginItem: LoginItemManaging {
    var status: SMAppService.Status { SMAppService.mainApp.status }
    func register() throws { try SMAppService.mainApp.register() }
    func unregister() throws { try SMAppService.mainApp.unregister() }
}

/// User-controlled startup behavior; reading state never changes system registration.
final class StartupPreferences {
    struct State {
        let launchAtLogin: Bool
        let launchStatus: String
        let launchError: String?
        let newNoteOnLaunch: Bool
    }

    private let defaults: UserDefaults
    private let loginItem: LoginItemManaging
    private let launchKey = "launchAtLogin"
    private let newNoteKey = "newNoteOnLaunch"
    private var consumedColdLaunch = false

    init(defaults: UserDefaults = .standard, loginItem: LoginItemManaging? = nil) {
        self.defaults = defaults
        self.loginItem = loginItem ?? MainAppLoginItem()
    }

    var state: State {
        let status = loginItem.status
        return State(launchAtLogin: status == .enabled,
                     launchStatus: Self.statusName(status),
                     launchError: defaults.string(forKey: "launchAtLoginError"),
                     newNoteOnLaunch: defaults.bool(forKey: newNoteKey))
    }

    @discardableResult
    func configureLaunchAtLogin(_ enabled: Bool) throws -> State {
        do {
            if enabled { try loginItem.register() } else { try loginItem.unregister() }
            defaults.set(nil, forKey: "launchAtLoginError")
            defaults.set(enabled, forKey: launchKey)
        } catch {
            defaults.set(error.localizedDescription, forKey: "launchAtLoginError")
            throw StoreError(message: "Launch at login could not be changed: \(error.localizedDescription)")
        }
        return state
    }

    func configureNewNoteOnLaunch(_ enabled: Bool) { defaults.set(enabled, forKey: newNoteKey) }

    /// Called once by the app's cold-start path, never from window reopen handling.
    func consumeColdLaunchNewNoteDecision() -> Bool {
        guard !consumedColdLaunch else { return false }
        consumedColdLaunch = true
        return defaults.bool(forKey: newNoteKey)
    }

    private static func statusName(_ status: SMAppService.Status) -> String {
        switch status {
        case .notRegistered: return "notRegistered"
        case .enabled: return "enabled"
        case .requiresApproval: return "requiresApproval"
        case .notFound: return "notFound"
        @unknown default: return "unknown"
        }
    }
}
