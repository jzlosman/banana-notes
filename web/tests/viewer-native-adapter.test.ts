import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { NativeViewerAdapter } from '../src/viewer/adapters/native-viewer';
import { DEFAULT_VIEWER_PREFERENCES } from '../src/viewer/domain/model';

function snapshot(preferences = DEFAULT_VIEWER_PREFERENCES) {
  return { document: { kind: 'empty' }, preferences };
}

test('native adapter sends full fractional preferences and validates snapshots and commands at the boundary', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const calls: unknown[] = [];
  let nextSnapshot: unknown = snapshot();
  Object.defineProperty(dom.window, 'webkit', { value: { messageHandlers: { viewer: { postMessage: async (message: unknown) => { calls.push(message); return nextSnapshot; } } } }, configurable: true });
  const adapter = new NativeViewerAdapter(dom.window as unknown as Window);
  const received: any[] = [];
  adapter.subscribe(event => received.push(event));
  const result = await adapter.bootstrap();
  assert.deepEqual(result.preferences, DEFAULT_VIEWER_PREFERENCES);
  const requested = { ...DEFAULT_VIEWER_PREFERENCES, focusedOpacity: 0.6, unfocusedOpacity: 0.35, glass: 0.5 };
  nextSnapshot = snapshot(requested);
  const saved = await adapter.savePreferences(requested);
  assert.deepEqual((calls.at(-1) as any).preferences, requested);
  assert.deepEqual(saved.preferences, requested);
  assert.equal(calls.at(0) instanceof Object && (calls.at(0) as any).action, 'bootstrap');

  dom.window.dispatchEvent(new dom.window.CustomEvent('banana-viewer-state', { detail: snapshot(requested) }));
  dom.window.dispatchEvent(new dom.window.CustomEvent('banana-viewer-command', { detail: 'zoomIn' }));
  assert.deepEqual(received.slice(-2).map(event => event.kind), ['snapshot', 'command']);
  assert.equal(received.at(-1).command, 'zoomIn');
  dom.window.dispatchEvent(new dom.window.CustomEvent('banana-viewer-command', { detail: 'save' }));
  assert.equal(received.at(-1).kind, 'fault');
  assert.match(received.at(-1).message, /command was invalid/);
  await assert.rejects(adapter.openLink('javascript:alert(1)'), /cannot be opened/);
  adapter.subscribe(() => {})();
  dom.window.close();
});
