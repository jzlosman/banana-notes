import Foundation

@main
struct MakeBrandAssets {
    static func main() throws {
        guard CommandLine.arguments.count == 2 else {
            fatalError("usage: make-brand-assets.swift REPOSITORY_ROOT")
        }
        let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let output = root.appendingPathComponent("assets/brand", isDirectory: true)
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        for (name, svg) in try BananaBrandSVG.generatedFiles(repositoryRoot: root) {
            try Data(svg.utf8).write(to: output.appendingPathComponent(name), options: .atomic)
        }
    }
}
