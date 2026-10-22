import Foundation

@main
struct PNGExportPolicySelfTest {
    static func main() {
        let matching = #"<h1 class="title"><strong>Café</strong></h1><p>Body</p>"#
        let deduplicated = PNGExportPolicy.removingDuplicateLeadingTitle(from: matching, title: "Café")
        precondition(deduplicated == "<p>Body</p>", "matching H1 with nested markup is removed from content")
        let encoded = #"<h1 class="title"><strong>Caf&#233; &amp; notes</strong></h1>  <p>Body</p>"#
        precondition(PNGExportPolicy.removingDuplicateLeadingTitle(from: encoded, title: "Café & notes") == "<p>Body</p>",
                     "matching leading H1 supports nested markup and HTML entities")
        let nonmatching = "<h1>Other title</h1><p>Body</p>"
        precondition(PNGExportPolicy.removingDuplicateLeadingTitle(from: nonmatching, title: "Current title") == nonmatching)
        let notLeading = "<p>Intro</p><h1>Current title</h1>"
        precondition(PNGExportPolicy.removingDuplicateLeadingTitle(from: notLeading, title: "Current title") == notLeading)
        precondition(PNGExportPolicy.removingDuplicateLeadingTitle(from: "<h1>Title</h1><p>Body</p>", title: " title ") == "<p>Body</p>")

        guard let mark = PNGExportPolicy.markFrame(width: 760, height: 420, padding: 48) else { preconditionFailure("valid mark frame missing") }
        let cardRight = 760.0 - 48.0
        precondition(mark.x >= cardRight && mark.maxX <= 760 && mark.y >= 0 && mark.maxY <= 48,
                     "brand mark must stay within the bottom-right gradient gutter, outside the card")
        precondition(mark.side == 14 && PNGExportPolicy.markSide == 14)
        precondition(PNGExportPolicy.markFrame(width: 500, height: 400, padding: 24, side: 24) == nil)
        let light = PNGExportPolicy.markColor(backgroundStart: "#F6D6B8", backgroundEnd: "#F3C6D8")
        let dark = PNGExportPolicy.markColor(backgroundStart: "#101018", backgroundEnd: "#24202A")
        precondition(light?.hex == "#09080D" && dark?.hex == "#FFFFFF")
        precondition(light?.alpha == 0.55 && dark?.alpha == 0.55)
        precondition(PNGExportPolicy.markColor(backgroundStart: "invalid", backgroundEnd: "#FFFFFF") == nil)
        print("PNG export policy checks passed (duplicate title removal, gradient mark contrast, 14 pt gutter geometry)")
    }
}
