# Changelog

All notable changes to Banana Notes are documented here.

## [Unreleased]

### Added

- Configure the global shortcut in Settings → General, with a recorder and Reset button. New installs default to ⌃⇧Space; installs with an existing library and no saved shortcut retain the legacy ⌃⌥Space default.
- Find text within the current note with ⌘F, then move between matches with Return / Shift–Return or ⌘G / ⇧⌘G.
- Restore the last valid library backup from the recovery screen.
- Add the full-color Banana Notes logo and wordmark to PNG exports when the footer gutter has room.

### Changed

- Preserve untouched Markdown blocks byte-for-byte. Unsupported syntax, including raw HTML, footnotes, reference links, and math, appears as labelled source blocks; editing a block in source mode can normalize it.
- Enforce a 2 MB per-note limit and a 20,000-note library limit.
- Write library updates durably with atomic replacement, and wait for pending saves before quitting.

### Fixed

- Copy selected visible text with ⌘C without adding Markdown escapes; Markdown copying remains available through Copy as.
- Make note scrollbars less prominent and hide them while the note window is unfocused.
- Keep keyboard focus on the relevant view after navigation and improve contrast for theme-derived focus rings and syntax colors.

### Security

- Authorize native bridge messages from the bundled main frame and decode wire payloads into validated typed commands before capability dispatch.
- Harden local library and attachment storage, and validate requests and responses at font and semantic-search provider boundaries.

## [0.1.0]

- Initial macOS release of the local-first floating Markdown notepad, with tags, search, themes, media attachments, and export.
