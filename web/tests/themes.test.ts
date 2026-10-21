import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveThemeID, SYSTEM_THEME, themeByID, themes } from '../src/themes';

const hex = /^#[\da-f]{6}$/i;
const luminance = (color: string) => color.match(/[\da-f]{2}/gi)!
  .map((channel) => parseInt(channel, 16) / 255)
  .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
const contrast = (a: string, b: string) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};

test('catalog has all 30 upstream identities and valid semantic colors', () => {
  assert.equal(themes.length, 30);
  assert.equal(new Set(themes.map(({ id }) => id)).size, 30);
  for (const theme of themes) {
    assert.ok(theme.id && theme.name);
    assert.ok(theme.appearance === 'light' || theme.appearance === 'dark');
    assert.deepEqual(Object.keys(theme.colors).sort(), [
      'accent', 'accentSoft', 'chrome', 'danger', 'dangerSoft', 'hover', 'ink', 'line',
      'muted', 'onAccent', 'paper', 'ring', 'selection', 'selectionText',
    ].sort());
    for (const [role, color] of Object.entries(theme.colors)) assert.match(color, hex, `${theme.id}.${role}`);
  }
});

test('adapted colors meet readable foreground/background contrast combinations', () => {
  for (const { id, colors: c } of themes) {
    for (const surface of [c.paper, c.chrome, c.hover]) assert.ok(contrast(c.ink, surface) >= 4.5, `${id}: ink on ${surface}`);
    for (const surface of [c.paper, c.chrome, c.hover, c.accentSoft]) assert.ok(contrast(c.muted, surface) >= 4.5, `${id}: muted on ${surface}`);
    for (const surface of [c.paper, c.chrome, c.accentSoft]) assert.ok(contrast(c.accent, surface) >= 4.5, `${id}: accent on ${surface}`);
    for (const surface of [c.paper, c.chrome, c.dangerSoft]) assert.ok(contrast(c.danger, surface) >= 4.5, `${id}: danger on ${surface}`);
    assert.ok(contrast(c.onAccent, c.accent) >= 4.5, `${id}: button foreground`);
    assert.ok(contrast(c.selectionText, c.selection) >= 4.5, `${id}: selection text`);
  }
});

test('selection inverts each theme and stands out against both editor and control surfaces', () => {
  for (const { id, colors: c } of themes) {
    assert.equal(c.selection, c.ink, `${id}: highlight uses the theme's text color`);
    assert.equal(c.selectionText, c.paper, `${id}: selected text uses the theme's page color`);
    for (const surface of [c.paper, c.chrome, c.hover]) {
      assert.ok(contrast(c.selection, surface) >= 4.5, `${id}: highlight must be distinct from ${surface}`);
    }
    assert.ok(contrast(c.selectionText, c.selection) >= 4.5, `${id}: selected text stays readable`);
  }
});

test('known palette backgrounds retain upstream identity', () => {
  const known = {
    nord: ['dark', '#2e3440'],
    'catppuccin-mocha': ['dark', '#1e1e2e'],
    'catppuccin-latte': ['light', '#eff1f5'],
    'github-dark': ['dark', '#0d1117'],
    'github-light': ['light', '#ffffff'],
  } as const;
  for (const [id, [appearance, paper]] of Object.entries(known)) {
    const theme = themeByID(id)!;
    assert.equal(theme.appearance, appearance);
    assert.equal(theme.colors.paper, paper);
  }
});

test('theme resolution safely falls back to system and system has no fixed definition', () => {
  assert.equal(resolveThemeID(undefined), SYSTEM_THEME);
  assert.equal(resolveThemeID(null), SYSTEM_THEME);
  assert.equal(resolveThemeID('unknown'), SYSTEM_THEME);
  assert.equal(resolveThemeID('nord'), 'nord');
  assert.equal(themeByID(SYSTEM_THEME), undefined);
  assert.equal(themeByID('missing'), undefined);
  assert.equal(themeByID('nord')?.id, 'nord');
});
