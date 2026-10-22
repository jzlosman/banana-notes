import Foundation

/// Pure visibility state machine for interruptible summon/dismiss transitions.
enum PanelMotionPhase: Equatable { case hidden, summoning, visible, dismissing }
enum PanelMotionPlan: Equatable {
    case none
    case summon(token: UInt64, duration: Double, moves: Bool)
    case dismiss(token: UInt64, duration: Double, moves: Bool)
}

struct PanelMotionStateMachine {
    static let summonDuration = 0.16
    static let dismissDuration = 0.11
    static let reduceMotionSummonDuration = 0.10
    static let reduceMotionDismissDuration = 0.08
    static let summonOffset = 5.0
    static let dismissOffset = 3.0

    private(set) var phase: PanelMotionPhase = .hidden
    private(set) var token: UInt64 = 0

    mutating func summon(reduceMotion: Bool) -> PanelMotionPlan {
        guard phase != .visible && phase != .summoning else { return .none }
        token &+= 1
        phase = .summoning
        return .summon(token: token,
                       duration: reduceMotion ? Self.reduceMotionSummonDuration : Self.summonDuration,
                       moves: !reduceMotion)
    }

    mutating func dismiss(reduceMotion: Bool) -> PanelMotionPlan {
        guard phase != .hidden && phase != .dismissing else { return .none }
        token &+= 1
        phase = .dismissing
        return .dismiss(token: token,
                        duration: reduceMotion ? Self.reduceMotionDismissDuration : Self.dismissDuration,
                        moves: !reduceMotion)
    }

    mutating func complete(token completedToken: UInt64) -> Bool {
        guard completedToken == token else { return false }
        switch phase {
        case .summoning: phase = .visible; return true
        case .dismissing: phase = .hidden; return true
        case .hidden, .visible: return false
        }
    }
}

struct PanelMotionFrame: Equatable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

enum PanelMotionGeometry {
    static func summonStart(for target: PanelMotionFrame) -> PanelMotionFrame {
        offset(target, verticalOffset: -PanelMotionStateMachine.summonOffset)
    }

    static func dismissEnd(from target: PanelMotionFrame) -> PanelMotionFrame {
        offset(target, verticalOffset: -PanelMotionStateMachine.dismissOffset)
    }

    private static func offset(_ frame: PanelMotionFrame, verticalOffset: Double) -> PanelMotionFrame {
        PanelMotionFrame(x: frame.x, y: frame.y + verticalOffset, width: frame.width, height: frame.height)
    }
}
