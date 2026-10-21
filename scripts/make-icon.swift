import AppKit
let out = CommandLine.arguments[1]
let image = NSImage(size: NSSize(width: 1024, height: 1024))
image.lockFocus()
NSColor(calibratedRed: 0.15, green: 0.38, blue: 0.30, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 96, y: 96, width: 832, height: 832), xRadius: 185, yRadius: 185).fill()
let page = NSBezierPath()
page.move(to: NSPoint(x: 300, y: 232)); page.line(to: NSPoint(x: 724, y: 232)); page.line(to: NSPoint(x: 724, y: 640)); page.line(to: NSPoint(x: 572, y: 792)); page.line(to: NSPoint(x: 300, y: 792)); page.close()
NSColor(calibratedWhite: 0.98, alpha: 1).setFill(); page.fill()
let fold = NSBezierPath(); fold.move(to: NSPoint(x: 572, y: 792)); fold.line(to: NSPoint(x: 572, y: 640)); fold.line(to: NSPoint(x: 724, y: 640)); fold.close()
NSColor(calibratedRed: 0.69, green: 0.83, blue: 0.74, alpha: 1).setFill(); fold.fill()
NSColor(calibratedRed: 0.15, green: 0.38, blue: 0.30, alpha: 1).setStroke()
for (y,width) in [(528.0,264.0),(434.0,264.0),(340.0,164.0)] { let line=NSBezierPath(); line.lineWidth=23; line.lineCapStyle = .round; line.move(to:NSPoint(x:380,y:y)); line.line(to:NSPoint(x:380+width,y:y)); line.stroke() }
image.unlockFocus()
let rep = NSBitmapImageRep(data: image.tiffRepresentation!)!
try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
