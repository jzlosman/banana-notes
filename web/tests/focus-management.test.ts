import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { focusPrimaryView, trapFocusWithin } from '../src/ui/focus-management';
import { openActionMenu } from '../src/ui/action-menu';

test('replacement views focus their primary control or a programmatically focusable heading', () => {
  const dom = new JSDOM('<!doctype html><main><h1>Notes</h1><label class="library-search"><input aria-label="Search notes"></label></main>');
  const root = dom.window.document.querySelector('main')!;
  const search = root.querySelector('input')!;
  focusPrimaryView(root, 'explorer'); assert.equal(dom.window.document.activeElement, search);
  const heading = root.querySelector('h1')!;
  focusPrimaryView(root, 'help'); assert.equal(dom.window.document.activeElement, heading); assert.equal(heading.tabIndex, -1);
  dom.window.document.body.innerHTML = '<main><textarea class="source-editor"></textarea><input class="note-find-input"></main>';
  const note = dom.window.document.querySelector('main')!;
  focusPrimaryView(note, 'note', { sourceMode: true }); assert.equal(dom.window.document.activeElement, note.querySelector('textarea'));
  focusPrimaryView(note, 'note', { findOpen: true }); assert.equal(dom.window.document.activeElement, note.querySelector('.note-find-input'));
  let editorFocused = false; focusPrimaryView(note, 'note', { focusEditor: () => { editorFocused = true; } }); assert.equal(editorFocused, true);
  dom.window.close();
});

test('modal-like dialogs trap forward and reverse Tab while normal focus travel remains available', () => {
  const dom = new JSDOM('<div role="dialog"><button>First</button><input><button>Last</button></div>');
  const dialog = dom.window.document.querySelector<HTMLElement>('[role=dialog]')!;
  const [first, , last] = [...dialog.querySelectorAll<HTMLElement>('button,input')];
  first.focus();
  const backwards = new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
  assert.equal(trapFocusWithin(backwards, dialog), true); assert.equal(dom.window.document.activeElement, last); assert.equal(backwards.defaultPrevented, true);
  first.focus();
  const forwards = new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  assert.equal(trapFocusWithin(forwards, dialog), false); assert.equal(forwards.defaultPrevented, false);
  last.focus();
  const wrap = new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  assert.equal(trapFocusWithin(wrap, dialog), true); assert.equal(dom.window.document.activeElement, first);
  dom.window.close();
});

test('popover menus keep Tab traversal inside until dismissed', () => {
  const dom = new JSDOM('<button id="trigger">Open menu</button>');
  const document = dom.window.document;
  const trigger = document.querySelector<HTMLButtonElement>('#trigger')!;
  openActionMenu(trigger, [{ label: 'First', run() {} }, { label: 'Last', run() {} }], { label: 'Actions' });
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
  const [first, last] = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  first.focus();
  const backwards = new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
  first.dispatchEvent(backwards);
  assert.equal(document.activeElement, last); assert.equal(backwards.defaultPrevented, true); assert.equal(menu.isConnected, true);
  last.focus();
  const forwards = new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  last.dispatchEvent(forwards);
  assert.equal(document.activeElement, first); assert.equal(forwards.defaultPrevented, true); assert.equal(menu.isConnected, true);
  dom.window.close();
});
