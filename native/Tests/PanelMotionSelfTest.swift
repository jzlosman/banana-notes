import Foundation

@main
struct PanelMotionSelfTest {
    static func main() {
        var state = PanelMotionStateMachine()
        guard case .summon(let summonToken, let summonDuration) = state.summon(reduceMotion: false) else {
            preconditionFailure("hidden panel should begin a summon transition")
        }
        precondition(state.phase == .summoning && summonDuration == PanelMotionStateMachine.summonDuration)
        precondition(state.summon(reduceMotion: false) == .none, "duplicate summon requests are idempotent")
        guard case .dismiss(let dismissToken, let dismissDuration) = state.dismiss(reduceMotion: false) else {
            preconditionFailure("summoning panel should be dismissible")
        }
        precondition(dismissDuration == PanelMotionStateMachine.dismissDuration && !state.complete(token: summonToken),
                     "reversed animation completion must not overwrite the latest intent")
        precondition(state.complete(token: dismissToken) && state.phase == .hidden)
        guard case .showImmediately(let visibleToken) = state.summon(reduceMotion: true) else {
            preconditionFailure("Reduce Motion should make summon immediate")
        }
        precondition(state.complete(token: visibleToken) == false && state.phase == .visible)
        guard case .hideImmediately(let hiddenToken) = state.dismiss(reduceMotion: true) else {
            preconditionFailure("Reduce Motion should make dismissal immediate")
        }
        precondition(state.phase == .hidden && !state.complete(token: hiddenToken))

        let target = PanelMotionFrame(x: 20, y: 40, width: 540, height: 650)
        let start = PanelMotionGeometry.summonStart(for: target)
        let end = PanelMotionGeometry.dismissEnd(from: target)
        precondition(start.width < target.width && start.height < target.height && start.y < target.y)
        precondition(end == start, "summon and dismiss use the same compact offset frame")
        print("Panel motion checks passed (reversal safety, Reduce Motion, summon/dismiss geometry)")
    }
}
