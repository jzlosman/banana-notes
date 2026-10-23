import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppCommandHandler } from '../src/ui/app-commands';
import type { AppCommand } from '../src/application/ports';

test('application commands queue until session readiness and await flush effects', async () => {
  let ready = false;
  const deferred: AppCommand[] = [];
  let flushed = false;
  const handler = createAppCommandHandler({
    isReady: () => ready, defer: command => deferred.push(command), newNote: () => {}, showExplorer: () => {},
    selectNotebook: () => {}, showHelp: () => {}, showSettings: () => {}, focusChanged: () => {}, pinChanged: () => {},
    changeWindowStyle: () => {}, changeFontSize: () => {}, copy: async () => {},
    flush: async () => { await Promise.resolve(); flushed = true; }, focusEditor: () => {}, move: () => {},
  });
  await handler({ type: 'flush' });
  assert.deepEqual(deferred, [{ type: 'flush' }]); assert.equal(flushed, false);
  ready = true;
  const queued = deferred.splice(0);
  await Promise.all(queued.map(handler));
  assert.equal(flushed, true);
});

test('native pin changes update the UI from the authoritative state', async () => {
  const received: boolean[] = [];
  const handler = createAppCommandHandler({
    isReady: () => true, defer: () => {}, newNote: () => {}, showExplorer: () => {},
    selectNotebook: () => {}, showHelp: () => {}, showSettings: () => {}, focusChanged: () => {},
    pinChanged: pinned => received.push(pinned), changeWindowStyle: () => {}, changeFontSize: () => {},
    copy: async () => {}, flush: async () => {}, focusEditor: () => {}, move: () => {},
  });
  await handler({ type: 'pin-change', pinned: true });
  await handler({ type: 'pin-change', pinned: false });
  assert.deepEqual(received, [true, false]);
});
