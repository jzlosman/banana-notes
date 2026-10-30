import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { NativeViewerAdapter } from '../src/viewer/adapters/native-viewer';
import { DEFAULT_VIEWER_PREFERENCES } from '../src/viewer/domain/model';

function snapshot(preferences = DEFAULT_VIEWER_PREFERENCES) {
  return { document: { kind: 'empty' }, preferences, editing: { kind: 'locked' }, externalChange: false };
}

test('native adapter validates snapshots, default-app messages, and commands at the boundary', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const calls: unknown[] = [];
  let nextSnapshot: unknown = snapshot();
  Object.defineProperty(dom.window, 'webkit', { value: { messageHandlers: { viewer: { postMessage: async (message: unknown) => { calls.push(message); return nextSnapshot; } } } }, configurable: true });
  const adapter = new NativeViewerAdapter(dom.window as unknown as Window);
  const received: any[] = [];
  adapter.subscribe(event => received.push(event));
  const result = await adapter.bootstrap();
  assert.deepEqual(result.preferences, DEFAULT_VIEWER_PREFERENCES);
  const anchor = { x: 12.5, y: 8, width: 30, height: 30 };
  nextSnapshot = null;
  assert.equal(await adapter.openMenu(anchor), null);
  assert.deepEqual(calls.at(-1), { action: 'openMenu', rect: anchor }, 'the bridge sends only the button geometry, never document paths');
  nextSnapshot = snapshot();
  const requested = { ...DEFAULT_VIEWER_PREFERENCES, focusedOpacity: 0.6, unfocusedOpacity: 0.35, glass: 0.5 };
  nextSnapshot = snapshot(requested);
  const saved = await adapter.savePreferences(requested);
  assert.deepEqual((calls.at(-1) as any).preferences, requested);
  assert.deepEqual(saved.preferences, requested);

  nextSnapshot = { isViewerDefault: false, currentAppName: 'Preview', canToggle: true, previousAppName: null };
  assert.deepEqual(await adapter.queryDefaultAppStatus(), { kind: 'available', state: 'off', currentAppName: 'Preview', canToggle: true });
  assert.equal((calls.at(-1) as any).action, 'defaultAppStatus');
  nextSnapshot = 'changed';
  assert.deepEqual(await adapter.setDefaultApp(true), { kind: 'changed' });
  assert.deepEqual(calls.at(-1), { action: 'setDefaultApp', enabled: true });
  nextSnapshot = { isViewerDefault: true, currentAppName: null, canToggle: true, previousAppName: 'Preview' };
  assert.deepEqual(await adapter.queryDefaultAppStatus(), { kind: 'available', state: 'on', canToggle: true, previousAppName: 'Preview' });
  nextSnapshot = { isViewerDefault: true, currentAppName: null, canToggle: false, previousAppName: 'Preview', applicationURL: '/Applications/Banana Viewer.app' };
  await assert.rejects(adapter.queryDefaultAppStatus(), /default app response is invalid/);
  nextSnapshot = '/Applications/Banana Viewer.app';
  await assert.rejects(adapter.setDefaultApp(false), /default app result is invalid/);
  assert.equal(calls.at(0) instanceof Object && (calls.at(0) as any).action, 'bootstrap');

  dom.window.dispatchEvent(new dom.window.CustomEvent('banana-viewer-state', { detail: snapshot(requested) }));
  dom.window.dispatchEvent(new dom.window.CustomEvent('banana-viewer-command', { detail: 'zoomIn' }));
  assert.deepEqual(received.slice(-2).map(event => event.kind), ['snapshot', 'command']);
  assert.equal(received.at(-1).command, 'zoomIn');
  dom.window.dispatchEvent(new dom.window.CustomEvent('banana-viewer-command', { detail: 'not-supported' }));
  assert.equal(received.at(-1).kind, 'fault');
  assert.match(received.at(-1).message, /command was invalid/);
  dom.window.dispatchEvent(new dom.window.CustomEvent('banana-viewer-command', { detail: 'setDefaultApp' }));
  assert.equal(received.at(-1).kind, 'fault', 'the native menu-command channel cannot invoke the settings-only system command');
  assert.match(received.at(-1).message, /command was invalid/);
  await assert.rejects(adapter.openLink('javascript:alert(1)'), /cannot be opened/);
  nextSnapshot = { kind: 'saved', revision: 'a'.repeat(64) };
  assert.deepEqual(await adapter.saveDocument('b'.repeat(64), '# Saved'), { kind: 'saved', revision: 'a'.repeat(64) });
  assert.deepEqual(calls.at(-1), { action: 'saveDocument', expectedRevision: 'b'.repeat(64), markdown: '# Saved' });
  nextSnapshot = { kind: 'failed', reason: 'token-like-error' };
  await assert.rejects(adapter.saveDocument('b'.repeat(64), '# Saved'), /save response was invalid/);
  await assert.rejects(adapter.saveDocument('bad', '# Saved'), /request is invalid/);
  adapter.subscribe(() => {})();
  dom.window.close();
});
