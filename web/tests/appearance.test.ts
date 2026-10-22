import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { applyAppearance } from '../src/ui/appearance';
import { themes } from '../src/domain/themes';
import { contrastRatio } from '../src/domain/theme-accessibility';

test('theme adapter maps every bundled palette to the entire editor surface', () => {
  const root = new JSDOM('<!doctype html><html></html>').window.document.documentElement;
  for (const theme of themes) {
    assert.equal(applyAppearance(root, theme.id), theme.id);
    assert.equal(root.style.getPropertyValue('--paper'), theme.colors.paper);
    assert.equal(root.style.getPropertyValue('--on-accent'), theme.colors.onAccent);
    assert.equal(root.style.getPropertyValue('--selection-text'), theme.colors.selectionText);
    assert.equal(root.style.colorScheme, theme.appearance);
    assert.equal(root.dataset.theme, theme.id);
  }
});
test('accessible focus rings remain at least 3:1 against adjacent theme surfaces', () => {
  const root = new JSDOM('<!doctype html><html></html>').window.document.documentElement;
  for (const theme of themes) {
    applyAppearance(root, theme.id);
    const ring = root.style.getPropertyValue('--ring');
    for (const surface of [theme.colors.paper, theme.colors.chrome, theme.colors.hover, theme.colors.accentSoft]) {
      assert.ok(contrastRatio(ring, surface) >= 3, `${theme.id}: ${contrastRatio(ring, surface).toFixed(2)}:1`);
    }
  }
});

test('system and unknown choices remove all explicit theme overrides without disturbing unrelated styles', () => {
  const root = new JSDOM('<!doctype html><html></html>').window.document.documentElement;
  root.style.setProperty('--unrelated', 'keep');
  applyAppearance(root, 'nord');
  assert.equal(applyAppearance(root, 'system'), 'system');
  assert.equal(root.style.getPropertyValue('--paper'), '');
  assert.equal(root.style.getPropertyValue('--danger-soft'), '');
  assert.equal(root.style.colorScheme, '');
  assert.equal(root.style.getPropertyValue('--unrelated'), 'keep');
  applyAppearance(root, 'nord');
  assert.equal(applyAppearance(root, 'removed-theme'), 'system');
  assert.equal(root.style.getPropertyValue('--accent'), '');
});
