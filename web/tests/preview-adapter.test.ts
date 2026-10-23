import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { PreviewAdapter } from '../src/adapters/preview';
import { loadWorkspace } from '../src/application/workspace-query';
import type { Library } from '../src/domain/library';

test('preview adapter retains the established localStorage keys and models native-only capabilities as absent', async () => {
  const dom = new JSDOM('<!doctype html><main></main>', { url: 'https://banana-preview.test' });
  const previous = {
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'),
  };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: dom.window.localStorage });
  try {
    const adapter = new PreviewAdapter();
    assert.equal(await adapter.library.load(), null);
    const workspace = await loadWorkspace(adapter);
    assert.equal(workspace.pinned, true, 'browser preview uses the pinned-by-default preference state');
    assert.equal(workspace.windowStyle.unfocusedOpacity, 0.6, 'browser preview inherits the inactive-opacity default');
    assert.equal(adapter.recovery, null); assert.equal(adapter.startup, null); assert.equal(adapter.attachments, null);
    assert.equal(adapter.ocr, null); assert.equal(adapter.pngExport, null); assert.equal(adapter.dataFolder, null);
    assert.equal(adapter.hotkey, null);
    const library: Library = { version: 1, notes: [{ id: 'n', markdown: 'Preview note', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }], selectedID: 'n', activeTag: null };
    await adapter.library.save(library);
    assert.equal(dom.window.localStorage.getItem('foldnote-preview-v1') !== null, true);
    await adapter.appearance.saveTheme('system');
    assert.equal(dom.window.localStorage.getItem('foldnote-preview-theme-v1'), 'system');
  } finally {
    if (previous.document) Object.defineProperty(globalThis, 'document', previous.document); else delete (globalThis as { document?: Document }).document;
    if (previous.localStorage) Object.defineProperty(globalThis, 'localStorage', previous.localStorage); else delete (globalThis as { localStorage?: Storage }).localStorage;
    dom.window.close();
  }
});
