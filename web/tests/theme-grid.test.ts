import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installThemeGridKeyboard, updateThemeGridTabStop } from '../src/ui/theme-grid';

test('theme picker has one tab stop and supports two-dimensional arrows, Home, and End', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const grid = dom.window.document.createElement('div'); grid.setAttribute('role', 'radiogroup'); dom.window.document.body.append(grid);
  let selected = 'theme-0';
  const options = Array.from({ length: 6 }, (_, index) => {
    const option = dom.window.document.createElement('button'); option.setAttribute('role', 'radio'); option.dataset.themeId = `theme-${index}`;
    option.addEventListener('click', () => { selected = option.dataset.themeId!; updateThemeGridTabStop(grid, selected); }); grid.append(option); return option;
  });
  updateThemeGridTabStop(grid, selected);
  assert.equal(options.filter(option => option.tabIndex === 0).length, 1);
  const dispose = installThemeGridKeyboard(grid, () => 2);
  const key = (index: number, value: string) => options[index].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  options[0].focus(); key(0, 'ArrowRight'); assert.equal(selected, 'theme-1'); assert.equal(dom.window.document.activeElement, options[1]);
  key(1, 'ArrowDown'); assert.equal(selected, 'theme-3'); assert.equal(dom.window.document.activeElement, options[3]);
  key(3, 'ArrowUp'); assert.equal(selected, 'theme-1');
  key(1, 'End'); assert.equal(selected, 'theme-5');
  key(5, 'Home'); assert.equal(selected, 'theme-0');
  assert.equal(options.filter(option => option.tabIndex === 0).length, 1);
  dispose(); dom.window.close();
});
