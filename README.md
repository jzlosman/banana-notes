<img src="assets/banana-notes-logo.svg" alt="Banana Notes logo" width="96" height="96">

# Banana Notes

A small, local-first Mac notepad with live Markdown, tagged notebooks, and a borderless floating window. Notes stay on your Mac; no account is required.

[MIT license](LICENSE) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## Run locally

Requirements: macOS 14+, Xcode command-line tools, Node 22+.

```sh
npm ci --ignore-scripts
npm run build
open "build/Banana Notes.app"
```

Install by copying `build/Banana Notes.app` into `~/Applications`. Open **Banana Notes** from Raycast or Finder. There is no Dock icon or normal Command–Tab entry: the menu-bar banana icon and the global shortcut summon the existing single window. The process stays running until **Quit Banana Notes**; closing the notepad only hides it. Launch-at-login is not enabled by the app.

## Controls

| Action | Shortcut |
| --- | --- |
| Show / hide globally | Control–Option–Space |
| New note | Command–N |
| Older / newer note | Command–[ / Command–] |
| Alternative navigation | Command–Shift–Left / Right |
| Flip note / explorer | Command–Shift–E |
| Find notes | Command–P |
| Markdown source / frontmatter | Command–Shift–M |
| Settings / themes | Command–, |
| Bigger / smaller note text | Command–+ (or Command–=) / Command–− |
| Reset note text size | Command–0 |
| Copy Markdown selection | Command–C |
| Copy formatted text | Command–Option–C |
| Trash focused note in list | Command–Delete |
| Hide | Escape or Command–W |
| Bold / italic | Command–B / Command–I |

Type Markdown directly: headings, bold, italic, strike-through, ordered/bullet/task lists, blockquotes, links, fenced code and tables. It renders in place. Press Return twice to leave a list. Command-click a link to open it externally. The source toggle is optional and replaces the editor; there is never a split preview.

Write `#work` in the note, add a tag using **Tag**, or use YAML frontmatter:

```markdown
---
title: Optional metadata
tags: [work, ideas]
---
# A thought

Normal Markdown follows.
```

Click a badge to open that notebook’s overview. The explorer supports multiple tag filters (AND/intersection), text search, edited/created ordering, and an exclusive **before date (UTC)** filter. New notes inherit every selected tag; previous/next navigation remains creation-ordered within the scope. Clear selected tag chips or the scope’s × to leave the notebook.

The list starts with search and notes, not a control panel. The filter icon reveals tags, before-date, sorting and search method; only active filters stay visible. The heading’s **…** opens Trash, the notebook overview, or **Select notes**. Selection checkboxes and bulk tag/archive/Trash/restore actions appear only in selection mode. **Select all filtered notes** selects the complete result set, not only visible rows. Right-click a note or use its hover/focus **…** for individual actions. Archive is the ordinary `#archive` tag; archived notes are hidden by default and reappear when that tag is selected, including alongside other tags. Trash retains the original note for 30 days. Expired notes cannot be restored and are purged on launch or hourly while Banana Notes runs.

The pad is a borderless card: no app title or traffic-light buttons. Notebook controls sit at the top left, with pin, explorer, new-note and `<>` source controls on the top right. Tags sit just underneath. Drag the empty space between the left and right controls to move it. Escape, Command–W, the hotkey or the menu bar can hide it.

The pin keeps the floating panel visible while switching apps. Otherwise it hides when focus leaves. The footer and formatting strip appear only while the notepad window is focused; the writing area expands when they disappear. Deep links: `banananotes://show`, `banananotes://new`, `banananotes://explorer`, `banananotes://tag/work`, `banananotes://themes`. Existing `foldnote://` links remain supported.

## Settings and appearance

Click the gear in the top toolbar, press **Command–,**, or choose **Settings…** in the menu bar. Formatting and note navigation share one bottom row. Notes save automatically; save failures show a persistent notice with a Retry action. There is no permanent save-status icon. At compact widths, Heading/Quote/Code are available under **Note actions (…) → Formatting…**. Search or filter the 30 bundled [Agent Paint](https://github.com/jzlosman/agent-paint) palettes by light/dark appearance. Choosing a palette updates the editor, explorer, controls and native Mac chrome immediately and survives relaunch. **Follow macOS** restores Banana Notes’ system-following light/dark appearance.

The **Code** tab selects an independent syntax palette from the same 30 themes, or **Match app**. Fenced code is highlighted locally. Put the cursor inside a code block to choose its language. The **Window** tab provides note typography and persistent text sizing; ⌘+/⌘− and ⌘0 work without modifying the note.

Notes default to **SF Mono · Medium** for slightly heavier monospaced writing. **Settings → Window → Note font** offers SF Mono, System, Avenir Next and Georgia, plus the weights each supports. Expand **Google Fonts**, enter any Google Fonts family name, and choose **Download and use**. Examples include IBM Plex Mono, DM Sans and Lora. Only this explicit action contacts Google; fonts are cached in the local data folder’s `fonts/` directory and work offline afterward. No note content is sent. Font choices persist separately from notes, affect PNG export, and do not change the interface or code/source font.

The **Window** tab has separate **Active window opacity** and **Inactive window opacity** sliders (5–100%), plus **Glass** (0–100%). Opacity fades the entire window, including text; glass blends in macOS’s native frosted desktop backdrop. Defaults are fully opaque with no glass, and the settings apply across themes. Unfocused opacity is visible when the note is pinned. **Reset to solid**, or **Reset Window Effects** in the menu bar, restores safe defaults without changing the theme or notes. Window preferences are saved separately under `windowStyle`; the browser preview simulates opacity but cannot render the native desktop backdrop.

Theme selection is stored independently in the app's preferences (`appearanceTheme`), not in any note or frontmatter. Themes are bundled: there are no runtime requests, plugins, or external installation steps. Theme provenance and licenses are retained under `vendor/agent-paint/` and included in the app bundle. Regenerate the pinned catalog offline with `node scripts/import-agent-paint.mjs`, or pass a checked-out Agent Paint directory explicitly when updating the source. Banana Notes adapts functional text contrast without replacing palette backgrounds or theme identities.

## Project overview, media and OCR

A notebook overview collects its notes (most recently edited first), open/completed Markdown tasks, media, and links. Checking a task updates only its source checkbox; stale task references are rejected rather than modifying another line. Every item links back to its source note.

Drop or paste local images into the note, or use **Note actions (…) → Attach file…** to choose images, audio or video. PNG/JPEG/GIF/WebP/HEIC, MP3/M4A/WAV and MP4/MOV/WebM are supported, with a 50 MiB per-file limit. Files are copied into the app’s `attachments/` folder and referenced by managed URLs; moving the original does not break the note. Audio/video have playback controls and never autoplay. Media survives Markdown editing and relaunch. Existing remote image source is preserved, but remote image loads are blocked by the app’s offline content policy.

**General → Local OCR** enables optional Apple Vision image text recognition. It is off by default, requires no model download, and sends nothing to a server. Recognize a managed image from its overview context menu, or use **Note actions (…) → Recognize image text…** to choose an image. Preview/edit the result before copying or inserting it.

## Copy and PNG export

Regular ⌘C in the live editor copies the selection as Markdown, without an HTML flavor that might override Markdown in a rich destination. Raw source and search fields keep ordinary text copying. **Copy as…** and **Edit → Copy As** offer Markdown, formatted text (HTML plus plain-text fallback), HTML source, and rendered plain text. With no selection, Copy as copies the whole note; whole-note Markdown preserves frontmatter and source bytes. Cut uses the same Markdown representation and remains undoable.

**Note actions (…) → Export image…** opens the gradient/width preview and saves a styled PNG through the Mac Save dialog; the last exported style is remembered. Export is intentionally absent from the everyday toolbar and settings tabs. The exported artwork has decorative Mac-window dots, gradient, padding, safe rendered content, and syntax colors—no traffic lights are added to the actual app. Managed images are rendered; audio/video become labelled placeholders. Long notes exceeding the explicit image bounds are rejected, not silently cropped.

## Optional local semantic search

**Settings → Search** provides opt-in vector search using [Ollama](https://ollama.com/download) on `127.0.0.1:11434`. It is disabled by default. Enable semantic search. Start Ollama explicitly if it is not running, and download a model if needed. Indexing starts automatically when both are available. The supported model choices are [all-minilm:22m](https://ollama.com/library/all-minilm) (about 46 MB) and [embeddinggemma:latest](https://ollama.com/library/embeddinggemma) (about 622 MB). No model downloads happen during normal note use or queries; note content never goes to a remote inference endpoint.

The settings panel guides Ollama → Model → Index, with only the next relevant action expanded. Once enabled and ready, the index updates on launch, on app focus and about 1.2 seconds after saved edits. Queries also ensure the index is current. Ready-state rebuild/clear controls live under **Manage index**. In the notes list, use **Filter & sort → Search using → Semantic** to query meaning while retaining tag/date/archive scope. Results are ranked before display, limited to a disclosed top 50, and trashed notes are excluded. The independent `semantic-index.json` cache reconciles edits and deletions using note IDs and content hashes. Unchanged notes reuse their embeddings; work is marked complete only after a successful atomic index write. Background updates, queries and manual rebuilds use one serialized queue. Rebuild forces fresh embeddings; clear/cancel controls are available. Cancellation stops subsequent work but cannot immediately stop a model pull already running in Ollama. Changing model weights externally under the same name requires an explicit rebuild.

## Startup

**Settings → General** has separate controls for opening at login and creating a new note on a cold launch. Reopening/summoning a running app does not create another note. Both remain off until selected. macOS may require Login Items approval; errors/status are shown rather than pretending registration succeeded.

## Data safety

Banana Notes was previously called Foldnote. Native data remains in `~/Library/Application Support/Foldnote/library.json` deliberately: no move, import, or new empty library is needed. The bundle identifier (`dev.local.foldnote`), preference keys, managed attachment/font URL schemes, and browser-preview storage keys also stay stable. Existing notes—including any old welcome note—are never rewritten by the rename. Quit the old app before replacing `Foldnote.app` with `Banana Notes.app`; do not keep two installed copies with the same bundle identity.

Content is Markdown in a versioned JSON envelope. Saves are serialized, atomically replaced, and maintain `library.json.bak` as the previous last-good snapshot. Save failures remain visible and retryable. Corrupt startup data is not replaced. **Help → Export Markdown** exports `.md` copies; **Data folder** opens the originals. No cloud service, account, remote editor resources, or telemetry.

The welcome note is sample content, not imported personal data. The browser preview uses separate localStorage and does not access the Mac app's library. `BANANA_NOTES_DATA_DIR=/absolute/path` isolates native testing. `BANANA_NOTES_DEBUG=1 npm run build` enables the optional WebKit inspector; release builds do not. The former `FOLDNOTE_DATA_DIR`, `FOLDNOTE_DEBUG`, and `FOLDNOTE_ICON` environment variables remain compatibility aliases; the corresponding `BANANA_NOTES_*` variables take precedence.

## Verification

```sh
npm test
npm run typecheck
bash scripts/native-tests.sh
npm run build
```

`npm run dev` serves the prebuilt browser preview on `http://127.0.0.1:4177` for editor interaction testing. It is not needed by the Mac app.

## Boundaries

- `web/src/domain.ts`: deterministic note commands and notebook/tag queries; no browser, native bridge, storage, or clocks.
- `web/src/persistence.ts`: repository port and serialized save pipeline, with failure/retry semantics.
- `web/src/editor.ts`: TipTap/ProseMirror Markdown adapter.
- `web/src/themes.ts` / `theme-catalog.json`: pinned theme definitions and deterministic theme queries.
- `web/src/appearance.ts`: DOM token adapter; separate from note commands and persistence.
- `web/src/window-style.ts`: deterministic effect preference normalization and a separate serialized preference-save port/pipeline.
- `web/src/note-font.ts`: typography validation and settings; managed local FontFace loading and DOM token adapter, independent of note content.
- `web/src/window-drag.ts`: toolbar-layout observation adapter; sends only the empty spacer rectangle to the native drag surface.
- `web/src/main.ts`: UI/application orchestration; supplies IDs and time, invokes commands and effect adapters.
- `native/LibraryStore.swift`: local filesystem adapter and envelope validation.
- `native/AppDelegate.swift`: AppKit/WebKit, hotkey, single-window lifecycle, external links and export adapters.
- `native/WindowContentView.swift`: native titlebar drag handling, independent of WebKit focus; excludes controls and editable text.
- `native/AppearancePreferences.swift`: validated bundled theme catalog and native appearance preference adapter.
- `native/WindowStylePreferences.swift`: independent effect preferences, validation and persistence; AppKit applies key-window opacity and a behind-window `NSVisualEffectView`.
- `native/NoteFontStore.swift`: typography preferences and explicit Google Fonts download/cache adapter; allowlisted URLs, bounded WOFF2 ingestion, atomic manifests and safe offline lookup. `FontSchemeHandler.swift` exposes only validated managed font files to WebKit and PNG export.
- `native/AppDeepLink.swift`: deterministic translation of current and legacy app links into editor commands.
- `native/BananaMark.swift` / `StatusItemIcon.swift`: approved banana geometry and an 18pt native template glyph, rendered at native 1x/2x menu-bar scale without raster resizing.

The logo lives in `assets/banana-notes-logo.svg`. Regenerate the app icon from the shared banana geometry with `bash scripts/build-icons.sh`. Branding is confined to the name, app/menu-bar icons, and documentation; the notepad’s layout, writing surface, and 30 themes are unchanged.

## License and release status

Banana Notes’ original code and artwork are [MIT licensed](LICENSE). Third-party code and palettes retain their respective licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).

This is a source release. The build is ad-hoc signed for local use, not notarized for public binary distribution. Sync, configurable hotkeys, general note import, and edit-version history are not included.
