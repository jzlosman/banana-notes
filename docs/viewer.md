# Banana Viewer

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/viewer-brand/logo-dark.svg">
  <img src="../assets/viewer-brand/logo.svg" alt="banana viewer" width="340">
</picture>

Banana Viewer is a separately installed macOS app for reading Markdown files. It uses Banana Notes’ Markdown components, theme catalog, syntax colors, and bundled fonts without starting the notes runtime or opening its library.

![Banana Viewer reading a synthetic Markdown document in its native Mac window](media/banana-viewer-native.png)

The native app, opened through macOS with a synthetic Markdown file.

[Watch the 18-second announcement trailer](media/banana-viewer-announcement.mp4) · [Poster](media/banana-viewer-announcement-poster.png). The trailer is silent and uses real app captures with sample documents.

## Build and run

Requires macOS 14+, the Xcode command-line tools, and Node.js 22+.

```sh
npm ci --ignore-scripts
npm run build:viewer
open "build/Banana Viewer.app"
open -a "$PWD/build/Banana Viewer.app" "$PWD/README.md"
```

The companion version is independently recorded in `viewer/version.txt`; `VIEWER_VERSION` and `VIEWER_BUILD` optionally override local build metadata. The build produces a universal Apple silicon/Intel application with its own document-line banana icon. Local builds are ad-hoc signed, not notarized distribution releases. The [independent Viewer release workflow](viewer-releases.md) prepares signed, notarized drafts under `viewer-v…` tags without replacing Banana Notes downloads or its update feed.

To install the companion, copy `build/Banana Viewer.app` into Applications. Banana Notes does not need to be installed. To make Viewer the default for Markdown, select a `.md` file in Finder, choose **Get Info → Open with → Banana Viewer → Change All**. The app does not change file associations automatically.

## Reading files

Use **File → Open…** (⌘O), Finder’s **Open With**, or the Terminal command above. Each file has its own ordinary Mac window; opening the same file again brings its existing window forward. Closing a window does not quit Banana Notes or affect its floating panel.

- Read rendered Markdown, including code blocks, tables, and task lists.
- Use Find (⌘F) to search the current document.
- Switch to the read-only source view (⇧⌘M) to inspect the original Markdown.
- Reload (⌘R) or let the viewer detect changes made by another editor.
- Change text size with ⌘+, ⌘−, or ⌘0.

This first version is a **viewer, not an editor**. It has no Save command and does not rewrite, import, move, or delete files. Task checkboxes are read-only. Unsupported content remains available in source view.

Relative raster images resolve inside the document’s folder, including nested folders. Parent traversal, symlink escapes, arbitrary filesystem images, and remote image downloads are blocked. External web links open only after an explicit click. Keep images beside the document rather than linking to files outside its folder. In the browser preview, local image access is limited by the browser’s file picker; the native app is the full file-viewing experience.

## Independent appearance

Settings (⌘,) belongs to Banana Viewer:

- **Appearance:** system-following appearance, the shared theme catalog, and independently chosen code colors.
- **Text:** built-in and bundled font families, supported weights, and text size.
- **Window:** focused/inactive opacity and background translucency. Reduced opacity also fades text and may reduce legibility.

Viewer preferences use its own `com.jzlosman.banana-viewer` identity. There is no shared configuration file, preference migration, or connection to the Banana Notes library. Font downloads are not included in this version.

## Architecture and safety

The bounded context is an external file document, not a library note. The source file is authoritative. The native file adapter owns bounded reads, change detection, and document-scoped resource access; deterministic policies validate file types, preferences, and allowed resources. The application composes these capabilities independently of the notes application.

The web composition root is `web/src/viewer/main.ts`; the native companion lives in `viewer/native/`. Shared components retain their existing defaults for Banana Notes. Document content is untrusted: it cannot execute arbitrary HTML/scripts, invoke native bridge actions, or silently start network requests. Preference commands are separate from document queries; there is no document-write capability.

The normal `npm run build` still builds Banana Notes. `npm run build:viewer` builds the companion. Both use the shared web asset/font/license pipeline. Generated application bundles remain under ignored `build/`.

## Verification

```sh
npm run typecheck
npm test
npm run build:web
bash scripts/native-tests.sh
npm run test:viewer:native
bash scripts/build-app.sh
bash scripts/build-viewer.sh
npm run test:viewer:webkit
```

The WebKit smoke test exercises the native app with synthetic files and isolated preferences; it requires a local macOS graphical session. The other native tests cover file boundaries and preferences without opening the app.

Use synthetic Markdown files for document tests. Never substitute a personal Banana Notes library. The browser preview is at `http://127.0.0.1:4177/viewer.html` after `npm run dev`; its file picker and appearance preferences are independent of the Banana Notes browser preview.
