# Banana Notes brand

Banana Notes is a small, warm tool that keeps a thought within reach while you work. The brand should feel the same way: friendly and a little playful, never loud. The person writing is the hero. Banana Notes is just the notepad at their side.

All brand files live in [`assets/brand/`](assets/brand/) and are generated from one shared geometry by `bash scripts/build-icons.sh`. Don't edit them by hand.

## Logo

The logo is the banana note and the name in lowercase Space Mono: **banana** in Bold, notes in Regular. The mark carries all of the color, so the name stays in one dark ink.

| File | Use it for |
| --- | --- |
| `logo.svg` | The main logo, on white and other light backgrounds |
| `logo-dark.svg` | Dark backgrounds, such as GitHub's dark mode. It uses the app icon in place of the bare note. |
| `logo-on-cocoa.svg` | Banners and social images on cocoa |
| `mark.svg` | The note on its own, on light backgrounds |
| `mark-on-cocoa.svg` | The note on its own, on cocoa |
| `app-icon.svg`, `app-icon-1024.png` | The app icon, on Apple's macOS icon grid |
| `menu-bar.svg` | The one-color menu-bar icon. macOS tints it for light and dark menu bars. |

**Clear space.** Keep at least half the mark's height clear on every side of the logo.

**Minimum sizes.** The mark and the app icon hold up down to 16 px. Keep the full logo at least 120 px wide.

**On light backgrounds** the note has a thin espresso outline. Without it, banana yellow is almost invisible on white (1.3:1).

**On dark backgrounds** use the app icon or the note on cocoa. The note's espresso tip disappears on espresso, black and near-black.

### Don't

- Don't use the note without its outline on white or other light backgrounds.
- Don't put the bare note on espresso or black. Use the app icon.
- Don't capitalize the wordmark, or set it in another typeface.
- Don't set "banana" in yellow on a light background. Yellow type is fine on cocoa and espresso.
- Don't recolor, stretch, re-tilt, outline or add effects to the mark.

## Color

| Name | Hex | Role |
| --- | --- | --- |
| Banana | `#FBE122` | The note. The one pop of color, and buttons on dark |
| Peel | `#D9A00A` | The note's curved edge. Rules and small accents; never text |
| Espresso | `#2E1D12` | The note's tip. Deepest background |
| Cocoa | `#5A3A22` | The app-icon tile. Primary dark background |
| Caramel | `#8B5A2B` | Secondary text and accents on light |
| Cream | `#F7EFDF` | Soft sections on light; text on dark |
| Ink | `#2A1D14` | Text on light backgrounds |
| White | `#FFFFFF` | Page background |

Contrast that matters:

| Pair | Ratio |
| --- | --- |
| Ink on white | 16.4:1 |
| Ink on banana | 12.4:1 |
| Cocoa on white | 10.2:1 |
| Cream on cocoa | 8.9:1 |
| Banana on cocoa | 7.7:1 |
| Caramel on white | 5.8:1 |
| Banana on white | 1.3:1, so never use it for text or thin lines |

Use yellow sparingly: one pop per screen, usually the note itself or a single button.

## Type

**Space Mono** is the brand typeface, Regular (400) and Bold (700). It's also the app's default note font. Use it for the wordmark, headings, buttons and short copy. In long documentation, the platform's own text font is fine.

The wordmark is set with −0.04em letter-spacing, with a gap of a third of the type size between the two words. Use the generated logo files rather than typing it out.

## Voice

The reader is the hero; we're the guide. Talk about what they're doing, not about the app.

- **Start with their moment.** "You're mid-call and someone says a number" beats "Banana Notes is a powerful note-taking solution."
- **Short, plain words.** Say "it saves as you type," not "seamless auto-persistence."
- **Show, don't boast.** Name the shortcut, the click, the result. No "revolutionary," "supercharge," "effortless" or "unlock."
- **Be honest about what it isn't.** No sync, no account, no cloud. Say so plainly; it's part of the appeal.
- **A little fun, never cute.** One banana joke per page, at most.

## Banana Viewer companion

Banana Viewer keeps the same note shape, tilt, colors, and lowercase Space Mono wordmark, adding three document lines inside the note and using **banana** viewer. Its source is the same shared geometry and generator, selected with `bash scripts/build-icons.sh viewer`; its assets live in [`assets/viewer-brand/`](assets/viewer-brand/).

The standalone `mark.svg` and all Viewer wordmark variants have transparent backgrounds: no cocoa square behind the mark. The rounded cocoa tile belongs only to `app-icon.svg`, `app-icon-1024.png`, and the macOS `AppIcon.icns`. Use `logo.svg` on light backgrounds and `logo-dark.svg` on dark ones. Viewer branding does not alter the Banana Notes assets or defaults.
