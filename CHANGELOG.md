# Changelog

All notable changes to Banana Notes are documented here.

## [Unreleased]

## [0.2.0] - 2026-10-23

### Added

- New brand: a cocoa app icon, a one-color menu-bar icon, and the lowercase **banana** notes logo. Brand files and usage live in `assets/brand/` and `BRAND.md`.
- Remove a tag from the current note with the × next to it; clicking the tag still opens its overview.
- Toggle the floating window's pin state from anywhere in the app with ⌘⇧P or **Window → Pin Window**.
- Configure the global shortcut in Settings → General, with a recorder and Reset button. New installs default to ⌃⇧Space; installs with an existing library and no saved shortcut retain the legacy ⌃⌥Space default.
- Find text within the current note with ⌘F, then move between matches with Return / Shift–Return or ⌘G / ⇧⌘G.
- Restore the last valid library backup from the recovery screen.
- Add the full-color Banana Notes logo and wordmark to PNG exports when the footer gutter has room.
- Add Banana Light and Banana Dark themes, listed first after Follow macOS.
- Bundle Space Mono, JetBrains Mono, Overpass Mono and Fira Code for offline use alongside Georgia and Avenir Next.

### Changed

- New bundle identifier `com.jzlosman.banana-notes`; existing preferences migrate automatically.
- Start new windows pinned by default; set inactive window opacity to 60% by default.
- Preserve untouched Markdown blocks byte-for-byte. Unsupported syntax, including raw HTML, footnotes, reference links, and math, appears as labelled source blocks; editing a block in source mode can normalize it.
- Enforce a 2 MB per-note limit and a 20,000-note library limit.
- Write library updates durably with atomic replacement, and wait for pending saves before quitting.
- Make Space Mono Regular the default note font and remove SF Mono and System from the font list. Existing selections of removed fonts move to Space Mono; downloaded Google copies of bundled fonts are hidden and selections move to the bundled version.

### Fixed

- Keep the note's text in the editor when a tag is added to a new note.
- Align quiet, theme-tinted scrollbars to the window edge across note, list, Settings, Help, project, and popover scrollers without shifting their content.
- Copy selected visible text with ⌘C without adding Markdown escapes; Markdown copying remains available through Copy as.
- Make note scrollbars less prominent and hide them while the note window is unfocused.
- Keep keyboard focus on the relevant view after navigation and improve contrast for theme-derived focus rings and syntax colors.

### Security

- Authorize native bridge messages from the bundled main frame and decode wire payloads into validated typed commands before capability dispatch.
- Harden local library and attachment storage, and validate requests and responses at font and semantic-search provider boundaries.

## [0.1.0]

- Initial development version of the local-first floating Markdown notepad, with tags, search, themes, media attachments, and export.
