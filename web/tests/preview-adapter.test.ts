import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { PreviewAdapter } from '../src/adapters/preview';
import type { Library } from '../src/domain/library';

test('preview adapter retains the established localStorage keys and exposes recovery/hotkey defaults', async () => {
  const dom = new JSDOM('<!doctype html><main></main>', { url: 'https://banana-preview.test' });
  const previous = {
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'),
  };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: dom.window.localStorage });
  try {
    const adapter = new PreviewAdapter();
    const loaded = await adapter.request('load');
    assert.equal(loaded.library, null);
    assert.equal((await adapter.request('libraryRecovery')).backupAvailable, false);
    assert.equal((await adapter.request('hotkeyPreferences')).display, '⌃⇧Space');
    const library: Library = { version: 1, notes: [{ id: 'n', markdown: 'Preview note', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }], selectedID: 'n', activeTag: null };
    await adapter.request('save', { library });
    assert.equal(dom.window.localStorage.getItem('foldnote-preview-v1') !== null, true);
    await adapter.request('theme', { themeID: 'system' });
    assert.equal(dom.window.localStorage.getItem('foldnote-preview-theme-v1'), 'system');
  } finally {
    if (previous.document) Object.defineProperty(globalThis, 'document', previous.document); else delete (globalThis as { document?: Document }).document;
    if (previous.localStorage) Object.defineProperty(globalThis, 'localStorage', previous.localStorage); else delete (globalThis as { localStorage?: Storage }).localStorage;
    dom.window.close();
  }
});
