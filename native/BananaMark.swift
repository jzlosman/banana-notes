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
