# Third-party notices

Agent Paint contains unofficial semantic adaptations of third-party color palettes. It does not include upstream extension code, logos, icons, fonts, or wallpaper. Names identify source palettes and do not imply endorsement.

Terminal records are normalized primarily from [mbadolato/iTerm2-Color-Schemes](https://github.com/mbadolato/iTerm2-Color-Schemes) at commit `752a9c079396cc9939b86e893578ed81e80c140f`, using its Ghostty-format exports. The collection code and curation are MIT licensed by Mark Badolato; the repository states that each individual theme's copyright and license remain with its author. Canonical palette/editor sources remain listed below so individual provenance is not replaced by the collection license.

| Theme family | Canonical source | Pinned commit | License |
| --- | --- | --- | --- |
| Catppuccin | [catppuccin/palette](https://github.com/catppuccin/palette) | `07d02aa110ef9eb7e7427afca5c73ba9cf7f8ebd` | [MIT](https://github.com/catppuccin/palette/blob/07d02aa110ef9eb7e7427afca5c73ba9cf7f8ebd/LICENSE) |
| Dracula | [dracula/visual-studio-code](https://github.com/dracula/visual-studio-code), [dracula/dracula-theme](https://github.com/dracula/dracula-theme) | `1b9ecf4d7e0c8cc2e2e890a7a41ad1db5fff1e6c`, `2985f660b04e6961b0887ffac2f8d3f35f431698` | MIT |
| GitHub | [primer/github-vscode-theme](https://github.com/primer/github-vscode-theme), [primer/primitives](https://github.com/primer/primitives) | `cd78e5e4e7bcf132a6f428ae0f32264bb1b729cf`, `f82864eb33c37f8624704bd996bc21b97d3c311b` | MIT |
| Atom One | [atom/one-dark-ui](https://github.com/atom/one-dark-ui), [atom/one-light-ui](https://github.com/atom/one-light-ui) | `18c2143d41e17b337fff6dc7024562c4d999be17`, `a27bce35088ecd323e44f5c2510bcf2d4e9efcf8` | MIT |
| Tokyo Night | [folke/tokyonight.nvim](https://github.com/folke/tokyonight.nvim), derived from [enkia/tokyo-night-vscode-theme](https://github.com/enkia/tokyo-night-vscode-theme) | `cdc07ac78467a233fd62c493de29a17e0cf2b2b6`, `7c0f11eaef322f293621ca7befe462214b7ea468` | Apache-2.0, MIT |
| Nord | [nordtheme/visual-studio-code](https://github.com/nordtheme/visual-studio-code) | `8ead09822c02d0d49d0f764104505e5a34d3689f` | MIT |
| Gruvbox | [morhetz/gruvbox](https://github.com/morhetz/gruvbox) | `5d15b2765f59754d7ac263c88a0f6e3e58124951` | MIT/X11 |
| Solarized | [altercation/solarized](https://github.com/altercation/solarized) | `62f656a02f93c5190a8753159e34b385588d5ff3` | MIT |
| Rosé Pine | [rose-pine/rose-pine-palette](https://github.com/rose-pine/rose-pine-palette) | `92af52b465ab6e47437aca223c9b8d3009a2023b` | MIT |
| Ayu | [ayu-theme/ayu-colors](https://github.com/ayu-theme/ayu-colors) | `e3f44fdf2a1c83e3f183d4e8acd40c6a452dcb1c` | MIT |
| Night Owl | [sdras/night-owl-vscode-theme](https://github.com/sdras/night-owl-vscode-theme) | `cc291eba7976b20d7c66bde6883c27b902196b07` | MIT |
| Everforest | [sainnhe/everforest](https://github.com/sainnhe/everforest) | `85a86eb62409e3ec88713bff3d1b9d7374e112e4` | MIT |
| Kanagawa | [rebelot/kanagawa.nvim](https://github.com/rebelot/kanagawa.nvim) | `bb85e4bfc8d89b0e62c8fa53ccdd13d12e2f77b3` | MIT |

## Adaptation notes

- Upstream editor themes expose many roles that do not safely map across applications. Each canonical record preserves terminal background, foreground, selection, cursor, ANSI 0–15, and a representative accent.
- Target adapters generate the larger Pi and Superset schemas and Paseo's eight semantic colors. Functional primary and secondary text receive independent contrast floors.
- Catppuccin uses Mauve as the representative accent.
- Atom One combines the canonical UI and syntax palette values; the original Atom repositories are archived.
- Tokyo Night uses the canonical generated Night, Storm, and Day palettes. This adaptation is modified from upstream for Paseo's semantic API.
- Gruvbox and Everforest use their default medium-contrast palettes.
- Solarized Light uses `base01` for primary foreground rather than `base00` so normal text meets WCAG AA contrast against `base3`.
- Kanagawa uses `springViolet1` as Paseo's accent and focus color.

The gallery self-hosts [Mona Sans](https://github.com/github/mona-sans) at commit `0f7dc66ddd766605eb0e75c3f47bf9d1dd38ceca` under the SIL Open Font License 1.1. Its license text is included at `site/fonts/OFL.txt`.

The repository's MIT license applies only to the adapter code and original documentation. Upstream licenses govern their respective palette material. Trademark rights are not granted by these licenses.
