import Foundation

/// Pure visibility state machine for interruptible summon/dismiss transitions.
enum PanelMotionPhase: Equatable { case hidden, summoning, visible, dismissing }
enum PanelMotionPlan: Equatable {
    case none
    case summon(token: UInt64, duration: Double)
    case dismiss(token: UInt64, duration: Double)
    case showImmediately(token: UInt64)
    case hideImmediately(token: UInt64)
}

struct PanelMotionStateMachine {
    static let summonDuration = 0.18
    static let dismissDuration = 0.14
    static let verticalOffset = 8.0
    static let scale = 0.985

    private(set) var phase: PanelMotionPhase = .hidden
    private(set) var token: UInt64 = 0

    mutating func summon(reduceMotion: Bool) -> PanelMotionPlan {
        guard phase != .visible && phase != .summoning else { return .none }
        token &+= 1
        if reduceMotion {
            phase = .visible
            return .showImmediately(token: token)
        }
        phase = .summoning
        return .summon(token: token, duration: Self.summonDuration)
    }

    mutating func dismiss(reduceMotion: Bool) -> PanelMotionPlan {
        guard phase != .hidden && phase != .dismissing else { return .none }
        token &+= 1
        if reduceMotion {
            phase = .hidden
            return .hideImmediately(token: token)
        }
        phase = .dismissing
        return .dismiss(token: token, duration: Self.dismissDuration)
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
        scaled(target, verticalOffset: -PanelMotionStateMachine.verticalOffset)
    }

    static func dismissEnd(from target: PanelMotionFrame) -> PanelMotionFrame {
        scaled(target, verticalOffset: -PanelMotionStateMachine.verticalOffset)
    }

    private static func scaled(_ frame: PanelMotionFrame, verticalOffset: Double) -> PanelMotionFrame {
        let width = frame.width * PanelMotionStateMachine.scale
        let height = frame.height * PanelMotionStateMachine.scale
        return PanelMotionFrame(x: frame.x + (frame.width - width) / 2,
                                y: frame.y + verticalOffset + (frame.height - height) / 2,
                                width: width, height: height)
    }
}
