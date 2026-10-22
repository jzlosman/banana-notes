import AppKit

/// The approved Banana Notes mark, expressed as native paths for AppKit adapters.
enum BananaMark {
    static func draw(in bounds: NSRect, color: NSColor) {
        let paths = sourcePaths()
        var transform = AffineTransform.identity
        transform.translate(x: bounds.minX, y: bounds.minY + bounds.height)
        transform.scale(x: bounds.width / CGFloat(1024), y: -bounds.height / CGFloat(1024))
        color.setFill()
        for path in paths {
            let scaled = path.copy() as! NSBezierPath
            scaled.transform(using: transform)
            scaled.fill()
        }
    }

    /// Full-color logo paths, identical to `assets/banana-notes-logo.svg` (enforced by BananaMarkSelfTest).
    static let logoPaths: [(d: String, fill: String)] = [
        (d: "M818 233C811 206 798 181 783 160C779 155 783 150 790 144C804 133 821 122 833 119C841 117 845 121 849 130C862 157 867 185 880 214L856 230Z", fill: "#27251E"),
        (d: "M162 722C146 720 132 719 121 727C110 734 105 744 107 757C109 773 119 785 135 794L155 770Z", fill: "#27251E"),
        (d: "M818 232L807 281C805 313 802 338 793 364C776 415 748 452 713 474C736 437 753 400 769 362C790 314 806 268 818 232Z", fill: "#F4D447"),
        (d: "M161 722C253 731 334 728 411 710C501 689 572 645 634 585C665 555 690 517 713 474C750 459 790 449 829 430C843 423 850 418 849 405C846 369 827 324 807 285L818 232L880 213C907 256 924 304 932 353C941 406 935 455 920 507C896 591 847 671 780 740C713 810 642 855 561 882C489 906 419 910 352 901C265 890 193 848 135 794C145 771 155 745 161 722Z", fill: "#F4D447")
    ]

    static func logoSVG(side: Double) -> String {
        let paths = logoPaths.map { "<path d=\"\($0.d)\" fill=\"\($0.fill)\"/>" }.joined()
        return "<svg viewBox=\"0 0 1024 1024\" width=\"\(side)\" height=\"\(side)\" aria-hidden=\"true\">\(paths)</svg>"
    }

    /// SVG paths are derived from the same native geometry for export surfaces that cannot share an AppKit bitmap.
    static func svgPathData() -> [String] {
        sourcePaths().map { path in
            var result = ""
            for index in 0..<path.elementCount {
                var points = [NSPoint](repeating: .zero, count: 3)
                let element = points.withUnsafeMutableBufferPointer {
                    path.element(at: index, associatedPoints: $0.baseAddress!)
                }
                func point(_ value: NSPoint) -> String {
                    "\(Int(value.x.rounded())) \(1024 - Int(value.y.rounded()))"
                }
                switch element {
                case .moveTo: result += "M \(point(points[0])) "
                case .lineTo: result += "L \(point(points[0])) "
                case .curveTo, .cubicCurveTo: result += "C \(point(points[0])) \(point(points[1])) \(point(points[2])) "
                case .quadraticCurveTo: result += "Q \(point(points[0])) \(point(points[1])) "
                case .closePath: result += "Z "
                @unknown default: break
                }
            }
            return result.trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }

    private static func sourcePaths() -> [NSBezierPath] {
        func path(_ build: (NSBezierPath) -> Void) -> NSBezierPath {
            let result = NSBezierPath()
            build(result)
            result.windingRule = .evenOdd
            return result
        }
        return [
            path { p in
                p.move(to: NSPoint(x:818,y:233)); p.curve(to:NSPoint(x:783,y:160),controlPoint1:NSPoint(x:811,y:206),controlPoint2:NSPoint(x:798,y:181))
                p.curve(to:NSPoint(x:790,y:144),controlPoint1:NSPoint(x:779,y:155),controlPoint2:NSPoint(x:783,y:150)); p.curve(to:NSPoint(x:833,y:119),controlPoint1:NSPoint(x:804,y:133),controlPoint2:NSPoint(x:821,y:122))
                p.curve(to:NSPoint(x:849,y:130),controlPoint1:NSPoint(x:841,y:117),controlPoint2:NSPoint(x:845,y:121)); p.curve(to:NSPoint(x:880,y:214),controlPoint1:NSPoint(x:862,y:157),controlPoint2:NSPoint(x:867,y:185)); p.line(to:NSPoint(x:856,y:230)); p.close()
            },
            path { p in
                p.move(to:NSPoint(x:162,y:722)); p.curve(to:NSPoint(x:121,y:727),controlPoint1:NSPoint(x:146,y:720),controlPoint2:NSPoint(x:132,y:719)); p.curve(to:NSPoint(x:107,y:757),controlPoint1:NSPoint(x:110,y:734),controlPoint2:NSPoint(x:105,y:744)); p.curve(to:NSPoint(x:135,y:794),controlPoint1:NSPoint(x:109,y:773),controlPoint2:NSPoint(x:119,y:785)); p.line(to:NSPoint(x:155,y:770)); p.close()
            },
            path { p in
                p.move(to:NSPoint(x:818,y:232)); p.line(to:NSPoint(x:807,y:281)); p.curve(to:NSPoint(x:793,y:364),controlPoint1:NSPoint(x:805,y:313),controlPoint2:NSPoint(x:802,y:338)); p.curve(to:NSPoint(x:713,y:474),controlPoint1:NSPoint(x:776,y:415),controlPoint2:NSPoint(x:748,y:452)); p.curve(to:NSPoint(x:769,y:362),controlPoint1:NSPoint(x:736,y:437),controlPoint2:NSPoint(x:753,y:400)); p.curve(to:NSPoint(x:818,y:232),controlPoint1:NSPoint(x:790,y:314),controlPoint2:NSPoint(x:806,y:268)); p.close()
            },
            path { p in
                p.move(to:NSPoint(x:161,y:722)); p.curve(to:NSPoint(x:411,y:710),controlPoint1:NSPoint(x:253,y:731),controlPoint2:NSPoint(x:334,y:728)); p.curve(to:NSPoint(x:634,y:585),controlPoint1:NSPoint(x:501,y:689),controlPoint2:NSPoint(x:572,y:645)); p.curve(to:NSPoint(x:713,y:474),controlPoint1:NSPoint(x:665,y:555),controlPoint2:NSPoint(x:690,y:517)); p.curve(to:NSPoint(x:829,y:430),controlPoint1:NSPoint(x:750,y:459),controlPoint2:NSPoint(x:790,y:449)); p.curve(to:NSPoint(x:849,y:405),controlPoint1:NSPoint(x:843,y:423),controlPoint2:NSPoint(x:850,y:418)); p.curve(to:NSPoint(x:807,y:285),controlPoint1:NSPoint(x:846,y:369),controlPoint2:NSPoint(x:827,y:324)); p.line(to:NSPoint(x:818,y:232)); p.line(to:NSPoint(x:880,y:213));
                p.curve(to:NSPoint(x:932,y:353),controlPoint1:NSPoint(x:907,y:256),controlPoint2:NSPoint(x:924,y:304)); p.curve(to:NSPoint(x:920,y:507),controlPoint1:NSPoint(x:941,y:406),controlPoint2:NSPoint(x:935,y:455)); p.curve(to:NSPoint(x:780,y:740),controlPoint1:NSPoint(x:896,y:591),controlPoint2:NSPoint(x:847,y:671)); p.curve(to:NSPoint(x:561,y:882),controlPoint1:NSPoint(x:713,y:810),controlPoint2:NSPoint(x:642,y:855)); p.curve(to:NSPoint(x:352,y:901),controlPoint1:NSPoint(x:489,y:906),controlPoint2:NSPoint(x:419,y:910)); p.curve(to:NSPoint(x:135,y:794),controlPoint1:NSPoint(x:265,y:890),controlPoint2:NSPoint(x:193,y:848)); p.curve(to:NSPoint(x:161,y:722),controlPoint1:NSPoint(x:145,y:771),controlPoint2:NSPoint(x:155,y:745)); p.close()
            }
        ]
    }
}
