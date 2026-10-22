import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { themes } from '../src/domain/themes';
import { accessibleFocusRing, contrastRatio } from '../src/domain/theme-accessibility';

const tokenVariables = ['keyword', 'string', 'comment', 'number', 'type', 'function'];

test('all syntax token colors meet 4.5:1 against each theme code background in Match app and explicit modes', async () => {
  const dom = new JSDOM('<!doctype html><html></html>');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  try {
    const { applyCodeAppearance } = await import('../src/ui/code-highlighting');
    for (const theme of themes) {
      for (const syntaxID of ['app', theme.id]) {
        const root = dom.window.document.createElement('div');
        applyCodeAppearance(root, syntaxID, theme.id, theme.appearance === 'dark');
        const background = root.style.getPropertyValue('--code-bg');
        assert.equal(background.toLowerCase(), theme.colors.paper.toLowerCase(), `${theme.id} ${syntaxID} background`);
        const colors = tokenVariables.map(name => root.style.getPropertyValue(`--code-${name}`));
        assert.equal(new Set(colors).size, colors.length, `${theme.id} keeps its syntax roles distinct`);
        for (const [index, color] of colors.entries()) {
          assert.ok(contrastRatio(color, background) >= 4.5, `${theme.id} ${syntaxID} ${tokenVariables[index]}: ${contrastRatio(color, background).toFixed(2)}:1`);
        }
      }
    }
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else delete (globalThis as { document?: Document }).document;
    dom.window.close();
  }
});

test('focus rings retain at least 3:1 against paper, chrome, hover, and selected surfaces in every theme', () => {
  for (const theme of themes) {
    const ring = accessibleFocusRing(theme);
    for (const [surface, color] of Object.entries({ paper: theme.colors.paper, chrome: theme.colors.chrome, hover: theme.colors.hover, selected: theme.colors.accentSoft })) {
      assert.ok(contrastRatio(ring, color) >= 3, `${theme.name} ${surface}: ${contrastRatio(ring, color).toFixed(2)}:1`);
    }
  }
});
