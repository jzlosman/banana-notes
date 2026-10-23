import Foundation
@testable import BananaNotesCore

@main
struct PanelMotionSelfTest {
    static func main() {
        var state = PanelMotionStateMachine()
        guard case .summon(let summonToken, let summonDuration, let summonMoves) = state.summon(reduceMotion: false) else {
            preconditionFailure("hidden panel should begin a summon transition")
        }
        precondition(state.phase == .summoning && summonDuration == 0.16 && summonMoves)
        precondition(state.summon(reduceMotion: false) == .none, "duplicate summon requests are idempotent")

        guard case .dismiss(let dismissToken, let dismissDuration, let dismissMoves) = state.dismiss(reduceMotion: false) else {
            preconditionFailure("summoning panel should be dismissible")
        }
        precondition(dismissDuration == 0.11 && dismissMoves && !state.complete(token: summonToken),
                     "reversed animation completion must not overwrite the latest intent")
        precondition(state.complete(token: dismissToken) && state.phase == .hidden)

        guard case .summon(let reducedSummonToken, let reducedSummonDuration, let reducedSummonMoves) = state.summon(reduceMotion: true) else {
            preconditionFailure("Reduce Motion summon should remain an animated transition")
        }
        precondition(reducedSummonDuration == 0.10 && !reducedSummonMoves)
        precondition(state.complete(token: reducedSummonToken) && state.phase == .visible)
        guard case .dismiss(let reducedDismissToken, let reducedDismissDuration, let reducedDismissMoves) = state.dismiss(reduceMotion: true) else {
            preconditionFailure("Reduce Motion dismissal should remain an animated transition")
        }
        precondition(reducedDismissDuration == 0.08 && !reducedDismissMoves)
        precondition(state.complete(token: reducedDismissToken) && state.phase == .hidden)

        guard case .summon(let firstToken, _, _) = state.summon(reduceMotion: false),
              case .dismiss(let middleToken, _, _) = state.dismiss(reduceMotion: false),
              case .summon(let lastToken, _, _) = state.summon(reduceMotion: false) else {
            preconditionFailure("rapid summon/dismiss/summon should follow the latest intent")
        }
        precondition(!state.complete(token: firstToken) && !state.complete(token: middleToken))
        precondition(state.complete(token: lastToken) && state.phase == .visible)

        let target = PanelMotionFrame(x: 20, y: 40, width: 540, height: 650)
        let start = PanelMotionGeometry.summonStart(for: target)
        let end = PanelMotionGeometry.dismissEnd(from: target)
        precondition(start == PanelMotionFrame(x: 20, y: 35, width: 540, height: 650),
                     "summon begins 5 points below target without resizing")
        precondition(end == PanelMotionFrame(x: 20, y: 37, width: 540, height: 650),
                     "dismiss drifts down 3 points without resizing")
        print("Panel motion checks passed (durations, interruption safety, Reduce Motion fades, fixed-size geometry)")
    }
}
