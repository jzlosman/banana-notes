import Foundation
@testable import BananaNotesCore

@main
struct WindowPreferenceSelfTest {
    @MainActor
    static func main() {
        precondition(WindowPreferencePolicy.pinned(from: nil), "an absent pin preference defaults to pinned")
        precondition(WindowPreferencePolicy.pinned(from: true))
        precondition(!WindowPreferencePolicy.pinned(from: false), "an explicitly saved false remains unpinned")

        let suite = "FoldnoteWindowPreference-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let style = WindowStylePreferences(defaults: defaults)
        let freshWindow = WindowCoordinator(stylePreferences: style, preferences: defaults, reduceMotionSource: { false })
        precondition(freshWindow.isPinned, "the coordinator must apply the absent-key default")

        var reportedStates: [Bool] = []
        freshWindow.onPinnedChange = { reportedStates.append($0) }
        freshWindow.setPinned(false)
        precondition(!freshWindow.isPinned && defaults.object(forKey: "pinned") as? Bool == false)
        precondition(reportedStates == [false], "pin changes publish state for native menu synchronization")
        let explicitlyUnpinned = WindowCoordinator(stylePreferences: style, preferences: defaults, reduceMotionSource: { false })
        precondition(!explicitlyUnpinned.isPinned, "an explicit false survives coordinator initialization")

        freshWindow.setPinned(true)
        let explicitlyPinned = WindowCoordinator(stylePreferences: style, preferences: defaults, reduceMotionSource: { false })
        precondition(explicitlyPinned.isPinned)
        precondition(reportedStates == [false, true])
        print("Native pin preference checks passed (absent default, explicit values, persistence and state publication)")
    }
}
