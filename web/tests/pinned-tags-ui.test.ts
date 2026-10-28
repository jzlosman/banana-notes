import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { closePopover } from '../src/ui/action-menu';
import { createScopeBar, type ScopeBarOptions } from '../src/ui/scope-bar';
import { installTagPinMenu } from '../src/ui/tag-pin-menu';

function installDocument(dom: JSDOM) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  return () => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete (globalThis as { document?: Document }).document; };
}
function rect(width: number) {
  return { x: 0, y: 0, top: 0, right: width, bottom: 24, left: 0, width, height: 24, toJSON() {} } as DOMRect;
}
function setGeometry(dom: JSDOM, root: HTMLElement, width: () => number) {
  root.getBoundingClientRect = () => rect(width());
  const original = dom.window.HTMLElement.prototype.getBoundingClientRect;
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.classList.contains('scope-button')) return rect(40);
    if (this.classList.contains('scope-overflow')) return rect(42);
    if (this.classList.contains('scope-active-measure')) return rect(70);
    if (this.classList.contains('scope-chip')) return rect((this.textContent?.length ?? 0) * 6 + 14);
    return original.call(this);
  };
  return () => { dom.window.HTMLElement.prototype.getBoundingClientRect = original; };
}
function options(patch: Partial<ScopeBarOptions> = {}): ScopeBarOptions {
  return {
    pinnedTags: ['launch', 'work', 'ideas'], activeTags: [], inTrash: false,
    onAll() {}, onTag() {}, onClear() {}, onTogglePin() {}, onMovePin() {}, isPinned: () => false, onError(error) { throw error; },
    ...patch,
  };
}

test('scope bar folds pins into a shortcut menu and keeps active scopes accessible', () => {
  const dom = new JSDOM('<!doctype html><div id="bar"></div>', { url: 'https://pinned-tags.test' });
  const restoreDocument = installDocument(dom); const root = dom.window.document.querySelector<HTMLElement>('#bar')!;
  let width = 180; const restoreGeometry = setGeometry(dom, root, () => width);
  const calls: string[] = [];
  const controller = createScopeBar(root, options({
    onTag: (tag, active) => calls.push(`${tag}:${active}`),
    onAll: active => calls.push(`all:${active}`),
    onTogglePin: tag => calls.push(`unpin:${tag}`),
  }));
  try {
    assert.equal(root.querySelector('.scope-label')?.textContent, 'All');
    assert.equal(root.querySelector('.scope-button')?.getAttribute('aria-pressed'), 'true');
    assert.equal(root.querySelector('.scope-button')?.getAttribute('aria-keyshortcuts'), 'Meta+1');
    assert.equal(root.querySelectorAll('[data-pin-tag]').length, 1);
    assert.match(root.querySelector('[data-pin-tag="launch"]')?.getAttribute('aria-keyshortcuts') ?? '', /Meta\+2/);
    const more = root.querySelector<HTMLButtonElement>('.scope-overflow')!;
    assert.equal(more.textContent, '+2'); more.click();
    const menu = dom.window.document.querySelector<HTMLElement>('[role="menu"]')!;
    assert.deepEqual([...menu.querySelectorAll('button')].map(item => [item.textContent, item.querySelector('.menu-shortcut')?.textContent]), [
      ['#work⌘3', '⌘3'], ['#ideas⌘4', '⌘4'],
    ]);
    menu.querySelector<HTMLButtonElement>('[role="menuitemradio"]')!.click();
    assert.deepEqual(calls, ['work:false']);

    controller.update(options({ pinnedTags: ['launch', 'work'], activeTags: ['work'], onTag: (tag, active) => calls.push(`${tag}:${active}`) }));
    assert.equal(root.querySelector('.scope-label')?.textContent, 'All');
    assert.equal(root.querySelector('[data-pin-tag="work"]')?.getAttribute('aria-pressed'), 'true');
    root.querySelector<HTMLButtonElement>('[data-pin-tag="work"]')!.click();
    assert.equal(calls.at(-1), 'work:true');

    width = 500; dom.window.dispatchEvent(new dom.window.Event('resize'));
    assert.equal(root.querySelectorAll('[data-pin-tag]').length, 2, 'ResizeObserver fallback reveals newly fitting pins');
  } finally {
    controller.dispose(); closePopover(); restoreGeometry(); restoreDocument(); dom.window.close();
  }
});

test('tag context menus expose pin state through pointer and keyboard interaction', () => {
  const dom = new JSDOM('<!doctype html><button id="tag">#launch</button>', { url: 'https://pinned-tags.test' });
  const restoreDocument = installDocument(dom); const target = dom.window.document.querySelector<HTMLElement>('#tag')!;
  let pinned = false; let toggles = 0;
  const dispose = installTagPinMenu(target, 'launch', { isPinned: () => pinned, togglePin: () => { pinned = !pinned; toggles++; }, onError(error) { throw error; } });
  try {
    assert.equal(target.getAttribute('aria-haspopup'), 'menu');
    assert.equal(target.getAttribute('aria-keyshortcuts'), 'Shift+F10');
    target.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 30 }));
    assert.equal(dom.window.document.querySelector('[role="menu"] .menu-action span')?.textContent, 'Pin to top bar');
    dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click();
    assert.equal(pinned, true); assert.equal(toggles, 1);
    target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
    assert.equal(dom.window.document.querySelector('[role="menu"] .menu-action span')?.textContent, 'Unpin from top bar');
    dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click();
    assert.equal(pinned, false); assert.equal(toggles, 2);
  } finally { dispose(); closePopover(); restoreDocument(); dom.window.close(); }
});

test('pointer drag reorders pins while context menu supplies keyboard reorder actions', () => {
  const dom = new JSDOM('<!doctype html><div id="bar"></div>', { url: 'https://pinned-tags.test' });
  const restoreDocument = installDocument(dom); const root = dom.window.document.querySelector<HTMLElement>('#bar')!;
  const restoreGeometry = setGeometry(dom, root, () => 500);
  const moved: [string, number][] = [];
  const controller = createScopeBar(root, options({ pinnedTags: ['launch', 'work'], onMovePin: (tag, delta) => moved.push([tag, delta]) }));
  try {
    const [launch, work] = [...root.querySelectorAll<HTMLElement>('[data-pin-tag]')];
    Object.defineProperty(dom.window.document, 'elementFromPoint', { configurable: true, value: () => work });
    const pointerEvent = (type: string, props: Record<string, number | boolean> = {}) => {
      const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
      for (const [key, value] of Object.entries({ pointerId: 1, isPrimary: true, button: 0, clientX: 0, clientY: 0, ...props })) Object.defineProperty(event, key, { value });
      return event;
    };
    launch.dispatchEvent(pointerEvent('pointerdown'));
    dom.window.document.dispatchEvent(pointerEvent('pointermove', { clientX: 20 }));
    dom.window.document.dispatchEvent(pointerEvent('pointerup', { clientX: 20 }));
    assert.deepEqual(moved, [['launch', 1]]);

    launch.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
    const menu = dom.window.document.querySelector<HTMLElement>('[role="menu"]')!;
    assert.equal(menu.querySelectorAll('button').length, 3);
    const right = [...menu.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.includes('Move right'))!;
    right.click();
    assert.deepEqual(moved.at(-1), ['launch', 1]);
  } finally { controller.dispose(); closePopover(); restoreGeometry(); restoreDocument(); dom.window.close(); }
});
