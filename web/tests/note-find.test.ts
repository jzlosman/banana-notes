import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { findMatchesInText } from '../src/ui/note-find';

test('find matching ignores case and diacritics while retaining source UTF-16 ranges', () => {
  assert.deepEqual(findMatchesInText('Café café CAFÉ', 'cafe'), [
    { from: 0, to: 4 }, { from: 5, to: 10 }, { from: 11, to: 15 },
  ]);
  assert.deepEqual(findMatchesInText('one two one', 'ONE'), [{ from: 0, to: 3 }, { from: 8, to: 11 }]);
  assert.deepEqual(findMatchesInText('nothing', ''), []);
});

test('ProseMirror decorations highlight matches across marks and expose the active selection', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  const globals: Record<string, PropertyDescriptor | undefined> = {};
  for (const key of ['window', 'document', 'navigator', 'Node', 'HTMLElement', 'Element', 'MutationObserver', 'DOMParser', 'getComputedStyle'] as const) {
    globals[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value: (dom.window as any)[key] });
  }
  globalThis.requestAnimationFrame = callback => setTimeout(() => callback(0), 0) as any;
  globalThis.cancelAnimationFrame = id => clearTimeout(id);
  try {
    const [{ Editor }, StarterKitModule, find] = await Promise.all([
      import('@tiptap/core'), import('@tiptap/starter-kit'), import('../src/ui/note-find'),
    ]);
    const element = document.createElement('div'); document.body.append(element);
    const editor = new Editor({ element, extensions: [StarterKitModule.default, find.NoteFindExtension], content: {
      type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'Caf' }, { type: 'text', marks: [{ type: 'bold' }], text: 'é' }, { type: 'text', text: ' and café' },
      ] }],
    } });
    const matches = find.setNoteFind(editor, 'cafe', 1);
    assert.equal(matches.length, 2);
    assert.deepEqual([...new Set([...element.querySelectorAll<HTMLElement>('.note-find-match')].map(node => node.dataset.findIndex))].sort(), ['0', '1']);
    assert.ok(element.querySelectorAll('.note-find-current').length >= 1);
    find.selectNoteFindMatch(editor, matches[1]);
    assert.equal(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to), 'café');
    editor.destroy();
  } finally {
    for (const [key, descriptor] of Object.entries(globals)) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key];
    dom.window.close();
  }
});
