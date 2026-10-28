import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createScopeBar, type ScopeBarOptions } from '../src/ui/scope-bar';

function rect(width: number) {
  return { x: 0, y: 0, top: 0, right: width, bottom: 24, left: 0, width, height: 24, toJSON() {} } as DOMRect;
}
function options(pinnedTags: string[]): ScopeBarOptions {
  return {
    pinnedTags, activeTags: [], inTrash: false,
    onAll() {}, onTag() {}, onClear() {}, onTogglePin() {}, onMovePin() {}, isPinned: () => false, onError(error) { throw error; },
  };
}

test('scope pin budget comes from 55% of titlebar content width, not the context width', () => {
  const dom = new JSDOM('<!doctype html><header id="titlebar" class="titlebar"><div id="context"></div></header>', { url: 'https://scope-layout.test' });
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  const titlebar = dom.window.document.querySelector<HTMLElement>('#titlebar')!;
  const context = dom.window.document.querySelector<HTMLElement>('#context')!;
  titlebar.style.padding = '0 12px 0 24px';
  titlebar.style.setProperty('--scope-max-share', '55%');
  let titlebarWidth = 400;
  Object.defineProperty(titlebar, 'clientWidth', { configurable: true, get: () => titlebarWidth });
  context.getBoundingClientRect = () => rect(18);
  const original = dom.window.HTMLElement.prototype.getBoundingClientRect;
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.classList.contains('scope-button')) return rect(40);
    if (this.classList.contains('scope-overflow')) return rect(42);
    if (this.classList.contains('scope-chip')) return rect((this.textContent?.length ?? 0) * 6 + 14);
    return original.call(this);
  };

  try {
    for (const width of [400, 700]) {
      titlebarWidth = width;
      for (const pins of [[], ['launch', 'work'], ['launch', 'work', 'ideas', 'notes']]) {
        const controller = createScopeBar(context, titlebar, options(pins));
        try {
          const visible = context.querySelectorAll('[data-pin-tag]').length;
          const overflow = context.querySelector<HTMLButtonElement>('.scope-overflow');
          if (pins.length === 4 && width === 400) {
            assert.equal(visible, 2, 'at 400px, only pins fitting in 55% of the titlebar content remain visible');
            assert.equal(overflow?.textContent, '+2');
          } else {
            assert.equal(visible, pins.length, `${pins.length} pins fit at ${width}px`);
            assert.equal(overflow, null);
          }
        } finally { controller.dispose(); }
      }
    }
  } finally {
    dom.window.HTMLElement.prototype.getBoundingClientRect = original;
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else delete (globalThis as { document?: Document }).document;
    dom.window.close();
  }
});

test('toolbar context uses an intrinsic flex basis so sparse pins leave room for dragging', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  const contextRule = css.match(/\.toolbar-context\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(contextRule, /flex:\s*0\s+1\s+auto\s*;/);
  assert.match(contextRule, /max-width:\s*var\(--scope-max-share\)\s*;/);
  assert.match(css, /\.titlebar\s*\{[^}]*--scope-max-share:\s*55%\s*;/);
});
