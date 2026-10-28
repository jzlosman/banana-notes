import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installKeyboardShortcuts, type KeyboardActions } from '../src/ui/app-events';

test('in-note find shortcuts remain separate from Find notes', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ['document', 'Element'] as const) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: (dom.window as any)[key] });
  }
  const calls: string[] = [];
  const actions: KeyboardActions = {
    isReady: () => true, view: () => 'note', handleTrash: () => false, closePopover: () => false,
    hasOCRDialog: () => false, closeOCRDialog() {}, hasFind: () => true, closeFind() {},
    openFind: () => calls.push('find-note'), findNext: direction => calls.push(direction === 1 ? 'next' : 'previous'),
    sourceMode: () => false, editorAvailable: () => true, increaseFont() {}, decreaseFont() {}, resetFont() {},
    copyFormatted: async () => {}, editLink() {}, newNote() {}, moveOlder() {}, moveNewer() {},
    showExplorer: () => calls.push('find-notes'), goToScopeShortcut: position => calls.push(`scope-${position}`), flipView() {}, toggleSource() {}, openSettings() {}, save: async () => {},
    goToNote() {}, hideWindow: async () => {}, error(error) { throw error; },
  };
  const dispose = installKeyboardShortcuts(actions);
  const press = (key: string, shiftKey = false) => dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, metaKey: true, shiftKey, bubbles: true, cancelable: true }));
  press('f'); press('g'); press('g', true); press('p'); press('p', true); press('1'); press('2');
  assert.deepEqual(calls, ['find-note', 'next', 'previous', 'find-notes', 'scope-1', 'scope-2'], 'scope shortcuts are distinct from editor and explorer commands');
  const editor = dom.window.document.createElement('textarea'); dom.window.document.body.append(editor);
  const whileTyping = new dom.window.KeyboardEvent('keydown', { key: '3', metaKey: true, bubbles: true, cancelable: true }); editor.dispatchEvent(whileTyping);
  assert.equal(whileTyping.defaultPrevented, true, 'scope shortcuts work while focus is in a typing field');
  assert.equal(calls.at(-1), 'scope-3');
  const recorder = dom.window.document.createElement('button'); recorder.className = 'hotkey-chord'; recorder.dataset.recording = 'true'; dom.window.document.body.append(recorder);
  const recorded = new dom.window.KeyboardEvent('keydown', { key: 'n', metaKey: true, bubbles: true, cancelable: true }); recorder.dispatchEvent(recorded);
  assert.deepEqual(calls, ['find-note', 'next', 'previous', 'find-notes', 'scope-1', 'scope-2', 'scope-3']); assert.equal(recorded.defaultPrevented, false);
  dispose();
  for (const [key, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key];
  dom.window.close();
});
