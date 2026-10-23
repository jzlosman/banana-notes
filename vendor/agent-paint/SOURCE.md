# Vendored palette source

Repository: https://github.com/jzlosman/agent-paint
Pinned commit: `2d90ea33992aa19093ea64c2d5525ee4f2e8ee57`

`themes.json` is copied from the pinned repository's generated `site/themes.json`. The upstream MIT license is included as `LICENSE`; upstream palette provenance and individual source licenses are documented in `THIRD_PARTY_NOTICES.md`.

Regenerate `web/src/theme-catalog.json` offline from this vendored snapshot, or use an explicitly supplied checkout (no network or build-time dependency):

```sh
node scripts/import-agent-paint.mjs
node scripts/import-agent-paint.mjs /path/to/agent-paint
```

The adapter maps upstream Paseo semantic colors to Banana Notes roles and applies deterministic WCAG contrast corrections. Upstream source colors are not modified.
