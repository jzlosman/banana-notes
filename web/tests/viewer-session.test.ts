import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ViewerSession } from '../src/viewer/application/session';
import { DEFAULT_VIEWER_PREFERENCES, type ViewerSnapshot } from '../src/viewer/domain/model';
import type { ViewerEvent, ViewerPort } from '../src/viewer/application/ports';

function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
class StubPort implements ViewerPort {
  current: ViewerSnapshot = { document: { kind: 'empty' }, preferences: { ...DEFAULT_VIEWER_PREFERENCES } };
  pending: Array<ReturnType<typeof deferred<ViewerSnapshot>>> = [];
  requested: any[] = [];
  defaultAppQueries = 0;
  defaultAppChanges = 0;
  listener?: (event: ViewerEvent) => void;
  async bootstrap() { return this.current; }
  async open() { return null; }
  async reload() { return null; }
  async reveal() { return null; }
  async openLink(_href: string) { return null; }
  async queryDefaultAppStatus() { this.defaultAppQueries++; return { kind: 'available' as const, state: 'off' as const, currentAppName: 'Preview', canToggle: true }; }
  async setDefaultApp(_enabled: boolean) { this.defaultAppChanges++; return { kind: 'changed' as const }; }
  async savePreferences(preferences: any) { this.requested.push(preferences); const request = deferred<ViewerSnapshot>(); this.pending.push(request); return request.promise; }
  subscribe(listener: (event: ViewerEvent) => void) { this.listener = listener; return () => { this.listener = undefined; }; }
}

test('default-app status queries and change commands stay separate through the session', async () => {
  const port = new StubPort(); const session = new ViewerSession(port);
  await session.bootstrap();
  assert.deepEqual(await session.queryDefaultAppStatus(), { kind: 'available', state: 'off', currentAppName: 'Preview', canToggle: true });
  assert.equal(port.defaultAppQueries, 1);
  assert.deepEqual(await session.setDefaultApp(true), { kind: 'changed' });
  assert.equal(port.defaultAppChanges, 1);
  assert.equal(port.defaultAppQueries, 1, 'a command does not silently masquerade as a status query');
  session.dispose();
});

test('preference commands serialize and merge on the latest confirmed snapshot; failures are surfaced', async () => {
  const port = new StubPort(); const session = new ViewerSession(port); const events: string[] = [];
  session.subscribe(event => { if (event.kind === 'preferences-saving' || event.kind === 'preferences-saved') events.push(event.kind); });
  await session.bootstrap();
  const first = session.updatePreferences({ themeID: 'banana-light' });
  const second = session.updatePreferences({ syntaxThemeID: 'one-dark', glass: 0.5 });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(port.requested.length, 1);
  assert.equal(port.requested[0].themeID, 'banana-light');
  assert.equal(port.requested[0].glass, 0);
  const confirmedFirst: ViewerSnapshot = { document: { kind: 'empty' }, preferences: { ...port.requested[0] } };
  port.pending[0].resolve(confirmedFirst); await first;
  await Promise.resolve(); await Promise.resolve();
  assert.equal(port.requested.length, 2);
  assert.equal(port.requested[1].themeID, 'banana-light');
  assert.equal(port.requested[1].syntaxThemeID, 'one-dark');
  assert.equal(port.requested[1].glass, 0.5);
  port.pending[1].reject(new Error('Settings disk is unavailable.'));
  await assert.rejects(second, /Settings disk is unavailable/);
  assert.deepEqual(session.snapshot?.preferences, confirmedFirst.preferences);
  assert.deepEqual(events, ['preferences-saving', 'preferences-saved', 'preferences-saving', 'preferences-saved']);
  session.dispose();
});
