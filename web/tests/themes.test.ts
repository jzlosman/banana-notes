import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveThemeID, SYSTEM_THEME, themeByID, themes } from '../src/domain/themes';

const hex = /^#[\da-f]{6}$/i;
const luminance = (color: string) => color.match(/[\da-f]{2}/gi)!
  .map((channel) => parseInt(channel, 16) / 255)
  .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
const contrast = (a: string, b: string) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};

const upstreamThemeIDs = [
  'one-dark', 'one-light', 'ayu-dark', 'ayu-light', 'ayu-mirage', 'catppuccin-frappe', 'catppuccin-latte',
  'catppuccin-macchiato', 'catppuccin-mocha', 'dracula', 'dracula-alucard', 'everforest-dark', 'everforest-light',
  'github-dark', 'github-dark-dimmed', 'github-light', 'gruvbox-dark', 'gruvbox-light', 'kanagawa-wave', 'light-owl',
  'night-owl', 'nord', 'rose-pine', 'rose-pine-dawn', 'rose-pine-moon', 'solarized-dark', 'solarized-light',
  'tokyo-night-night', 'tokyo-night-day', 'tokyo-night-storm',
];

const bananaColors = {
  'banana-light': {
    paper: '#fffdf4', chrome: '#faf5e2', ink: '#2a2720', muted: '#6e6651', line: '#ece3c6', hover: '#f4edd3',
    accent: '#7a5a00', accentSoft: '#fcefb4', onAccent: '#fffdf4', ring: '#7a5a00', danger: '#a3352b',
    dangerSoft: '#fbe7df', selection: '#f4d447', selectionText: '#2a2720',
  },
  'banana-dark': {
    paper: '#1c1a15', chrome: '#23211a', ink: '#f3edda', muted: '#b0a68a', line: '#38342a', hover: '#2c2920',
    accent: '#f4d447', accentSoft: '#3a3218', onAccent: '#1c1a15', ring: '#f4d447', danger: '#ff9b8a',
    dangerSoft: '#3d2420', selection: '#f4d447', selectionText: '#1c1a15',
  },
} as const;

test('catalog starts with the two first-party themes and preserves all 30 Agent Paint identities', () => {
  assert.equal(themes.length, 32);
  assert.deepEqual(themes.slice(0, 2).map(({ id, name }) => [id, name]), [
    ['banana-light', 'Banana Light'], ['banana-dark', 'Banana Dark'],
  ]);
  assert.deepEqual(themes.slice(2).map(({ id }) => id), upstreamThemeIDs);
  assert.equal(new Set(themes.map(({ id }) => id)).size, 32);
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

test('Banana themes retain the exact first-party palettes and required contrast', () => {
  for (const [id, colors] of Object.entries(bananaColors)) {
    const theme = themeByID(id)!;
    assert.deepEqual(theme.colors, colors, `${id}: source colors must not be contrast-adjusted`);
    assert.equal(theme.name, id === 'banana-light' ? 'Banana Light' : 'Banana Dark');
    assert.equal(theme.appearance, id === 'banana-light' ? 'light' : 'dark');
    for (const surface of [colors.paper, colors.chrome, colors.hover]) {
      assert.ok(contrast(colors.ink, surface) >= 7, `${id}: ink on ${surface}`);
      assert.ok(contrast(colors.muted, surface) >= 4.5, `${id}: muted on ${surface}`);
    }
    assert.ok(contrast(colors.muted, colors.accentSoft) >= 4.5, `${id}: muted on accentSoft`);
    for (const surface of [colors.paper, colors.chrome, colors.hover, colors.accentSoft]) {
      assert.ok(contrast(colors.accent, surface) >= 4.5, `${id}: accent on ${surface}`);
      assert.ok(contrast(colors.ring, surface) >= 3, `${id}: ring on ${surface}`);
    }
    assert.ok(contrast(colors.onAccent, colors.accent) >= 4.5, `${id}: onAccent`);
    assert.ok(contrast(colors.selectionText, colors.selection) >= 4.5, `${id}: selection text`);
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

test('Agent Paint selection colors invert each palette and stand out against editor and control surfaces', () => {
  for (const { id, colors: c } of themes.slice(2)) {
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
