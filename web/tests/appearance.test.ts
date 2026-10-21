import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { applyAppearance } from '../src/appearance';
import { themes } from '../src/themes';

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
