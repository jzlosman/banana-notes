import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { PreviewAdapter } from '../src/adapters/preview';

test('browser preview resolves bundled faces to local relative font assets without a network fetch', async () => {
  const { window } = new JSDOM('<!doctype html><html></html>', { url: 'http://localhost/' });
  const oldStorage = globalThis.localStorage;
  const oldManifest = (globalThis as typeof globalThis & { __BANANA_NOTE_FONT_MANIFEST__?: unknown }).__BANANA_NOTE_FONT_MANIFEST__;
  Object.defineProperty(globalThis, 'localStorage', { value: window.localStorage, configurable: true });
  Object.defineProperty(globalThis, '__BANANA_NOTE_FONT_MANIFEST__', { value: { fonts: [{
    id: 'space-mono', name: 'Space Mono', kind: 'bundled', family: 'Space Mono', weights: [400],
    faces: [{ file: 'space-mono-latin-400-normal.woff2', weight: '400', unicodeRange: 'U+0000-00FF' }],
  }] }, configurable: true });
  try {
    const { noteFonts } = await new PreviewAdapter().typography.load();
    assert.deepEqual(noteFonts.selection, { fontID: 'space-mono', weight: 400 });
    assert.deepEqual(noteFonts.fonts[0].faces, [{ url: 'fonts/space-mono-latin-400-normal.woff2', weight: '400', unicodeRange: 'U+0000-00FF' }]);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: oldStorage, configurable: true });
    if (oldManifest === undefined) delete (globalThis as typeof globalThis & { __BANANA_NOTE_FONT_MANIFEST__?: unknown }).__BANANA_NOTE_FONT_MANIFEST__;
    else Object.defineProperty(globalThis, '__BANANA_NOTE_FONT_MANIFEST__', { value: oldManifest, configurable: true });
    window.close();
  }
});
