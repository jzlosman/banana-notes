# Third-party notices

Banana Notes’ MIT license covers its original code and artwork, not third-party components or trademarks.

## Web dependencies

The editor uses the MIT-licensed TipTap/ProseMirror packages, Marked, YAML, and Lowlight; Highlight.js is BSD-3-Clause licensed, and Lucide is ISC licensed. Other transitive dependencies retain their own licenses.

The web build collects license and notice files from every npm package in its dependency graph. The app includes these, with a name/version/license inventory, under `Contents/Resources/web/third-party/dependencies/` and `dependencies.json`. Dependency source and license metadata are pinned in `package-lock.json`; the packages themselves are installed from npm, not vendored here.

## Palettes

The bundled palette adaptations come from [Agent Paint](https://github.com/jzlosman/agent-paint). Its [source record](vendor/agent-paint/SOURCE.md), [MIT license](vendor/agent-paint/LICENSE), [upstream attribution](vendor/agent-paint/THIRD_PARTY_NOTICES.md), and [upstream license texts](vendor/agent-paint/licenses/README.md) are preserved. These notices and license texts are also included in the app.

The upstream Agent Paint notice mentions its separate web gallery and Mona Sans font. Neither that gallery nor its font is distributed with Banana Notes.

## System and optional resources

macOS frameworks and system fonts are provided by the operating system, not redistributed here. Google Fonts are downloaded only at the user's request and cached in the user's data directory; they are not included in this repository or app bundle and remain subject to their respective font licenses. Optional Ollama models are likewise not bundled and retain their own licenses.
