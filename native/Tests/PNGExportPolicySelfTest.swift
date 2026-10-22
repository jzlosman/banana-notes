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

        let lockup = PNGExportPolicy.signature(padding: 48)
        precondition(lockup == .lockup(logoSide: 18) && lockup?.showsWordmark == true)
        precondition(PNGExportPolicy.signature(padding: 32) == .logo(side: 16), "narrow gutters keep only the logo")
        precondition(PNGExportPolicy.signature(padding: 16) == nil)
        guard let frame = PNGExportPolicy.signatureFrame(width: 760, padding: 48, signature: lockup!) else { preconditionFailure("valid signature frame missing") }
        precondition(frame.maxX == 760 - 48, "signature aligns with the card's right edge")
        precondition(frame.y >= 0 && frame.maxY <= 48, "signature stays inside the bottom gradient gutter, below the card")
        precondition(abs(frame.y - (48 - frame.maxY)) < 0.001, "signature is vertically centred in the gutter")
        precondition(PNGExportPolicy.signatureFrame(width: 90, padding: 48, signature: lockup!) == nil)
        let light = PNGExportPolicy.wordmarkColor(backgroundStart: "#F6D6B8", backgroundEnd: "#F3C6D8")
        let dark = PNGExportPolicy.wordmarkColor(backgroundStart: "#101018", backgroundEnd: "#24202A")
        precondition(light?.hex == "#09080D" && dark?.hex == "#FFFFFF")
        precondition(light?.alpha == PNGExportPolicy.wordmarkAlpha)
        precondition(PNGExportPolicy.wordmarkColor(backgroundStart: "invalid", backgroundEnd: "#FFFFFF") == nil)
        print("PNG export policy checks passed (duplicate title removal, signature sizing, gutter geometry and wordmark contrast)")
    }
}
