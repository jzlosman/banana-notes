import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { DEFAULT_NOTE_FONT_STATE } from '../src/domain/note-font';
import { applyNoteFont } from '../src/ui/note-font';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('a late bundled-font load cannot override a newer confirmed font selection', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const root = dom.window.document.createElement('div');
  const waitForOldFont = deferred<FontFace[]>();
  class FakeFontFace { constructor(_family: string, _source: string, _descriptors?: FontFaceDescriptors) {} }
  Object.defineProperty(dom.window.document, 'fonts', { value: {
    add() {}, delete() { return true; }, load: () => waitForOldFont.promise,
  }, configurable: true });
  Object.defineProperty(dom.window, 'FontFace', { value: FakeFontFace, configurable: true });
  let currentRevision = 1;
  const bundled = {
    ...DEFAULT_NOTE_FONT_STATE.fonts[0],
    faces: [{ url: 'fonts/space-mono-latin-400-normal.woff2', weight: '400', unicodeRange: 'U+0000-00FF' }],
  };
  const older = applyNoteFont(root as unknown as HTMLElement, {
    selection: { fontID: 'space-mono', weight: 400 }, fonts: [bundled, ...DEFAULT_NOTE_FONT_STATE.fonts.slice(1)],
  }, () => currentRevision === 1);
  currentRevision = 2;
  await applyNoteFont(root as unknown as HTMLElement, {
    selection: { fontID: 'georgia', weight: 400 }, fonts: DEFAULT_NOTE_FONT_STATE.fonts,
  }, () => currentRevision === 2);
  assert.match(root.style.getPropertyValue('--note-font-family'), /Georgia/);
  waitForOldFont.resolve([]); await older;
  assert.match(root.style.getPropertyValue('--note-font-family'), /Georgia/);
  dom.window.close();
});
