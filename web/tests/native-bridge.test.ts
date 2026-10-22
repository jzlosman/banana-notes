import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeBridge } from '../src/adapters/native-bridge';
import type { PlatformAction } from '../src/application/platform';

type FakeReply = (action: PlatformAction, payload: Record<string, unknown>) => unknown;
function bridgeWith(replyFor: FakeReply) {
  const messages: Record<string, unknown>[] = [];
  const target = {
    webkit: { messageHandlers: { native: { postMessage: async (message: unknown) => {
      const payload = message as Record<string, unknown>; messages.push(payload);
      return replyFor(payload.action as PlatformAction, payload);
    } } } },
  } as unknown as Window;
  return { bridge: new NativeBridge(target), messages };
}

test('native recovery and hotkey replies are validated at the bridge boundary', async () => {
  const { bridge, messages } = bridgeWith(action => {
    if (action === 'libraryRecovery') return { startupError: 'Corrupt library', backupAvailable: true, backupUpdatedAt: '2026-05-01T12:00:00Z', backupNoteCount: 12 };
    if (action === 'restoreBackup') return { restored: true };
    if (action === 'hotkeyPreferences') return { keyCode: 49, modifiers: 768, display: '⌃⇧Space', registered: false, error: 'Shortcut unavailable' };
    return {};
  });
  const recovery = await bridge.request('libraryRecovery');
  assert.equal(recovery.backupAvailable, true);
  assert.equal(recovery.backupNoteCount, 12);
  assert.deepEqual(await bridge.request('restoreBackup'), { restored: true });
  const shortcut = await bridge.request('hotkeyPreferences', { shortcut: { keyCode: 49, modifiers: 768 } });
  assert.equal(shortcut.display, '⌃⇧Space');
  assert.equal(shortcut.registered, false);
  assert.equal(shortcut.error, 'Shortcut unavailable');
  assert.deepEqual(messages.map(message => message.action), ['libraryRecovery', 'restoreBackup', 'hotkeyPreferences']);
  assert.deepEqual(messages[2].shortcut, { keyCode: 49, modifiers: 768 });
});

test('native load validates untrusted library data and save requires durable confirmation', async () => {
  const { bridge } = bridgeWith(action => action === 'load' ? { library: { version: 1, notes: [{ id: 'n', markdown: 4 }], selectedID: null, activeTag: null } } : {});
  await assert.rejects(bridge.request('load'), /invalid/i);
  await assert.rejects(bridge.request('save', { library: { version: 1, notes: [], selectedID: null, activeTag: null } }), /save could not be confirmed/i);
});

test('malformed native recovery and shortcut payloads never cross into the application', async () => {
  const { bridge } = bridgeWith(action => action === 'libraryRecovery'
    ? { startupError: null, backupAvailable: true, backupNoteCount: -1 }
    : { keyCode: '49', modifiers: 0, display: '⌃⇧Space', registered: true });
  await assert.rejects(bridge.request('libraryRecovery'), /recovery response is invalid/i);
  await assert.rejects(bridge.request('hotkeyPreferences'), /hotkey preferences response is invalid/i);
});
