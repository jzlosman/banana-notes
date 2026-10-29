import Foundation

@main
struct MakeBrandAssets {
    static func main() throws {
        guard (2...3).contains(CommandLine.arguments.count) else {
            fatalError("usage: make-brand-assets.swift REPOSITORY_ROOT [notes|viewer]")
        }
        let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let product = CommandLine.arguments.count == 3
            ? BananaMark.Product(rawValue: CommandLine.arguments[2])
            : .notes
        guard let product else { fatalError("product must be notes or viewer") }
        let directory = product == .notes ? "brand" : "viewer-brand"
        let output = root.appendingPathComponent("assets/\(directory)", isDirectory: true)
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        for (name, svg) in try BananaBrandSVG.generatedFiles(repositoryRoot: root, product: product) {
            try Data(svg.utf8).write(to: output.appendingPathComponent(name), options: .atomic)
        }
    }
}
