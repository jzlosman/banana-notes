import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeBridge } from '../src/adapters/native-bridge';
import type { NativeAction } from '../src/adapters/native-wire';

type FakeReply = (action: NativeAction, message: Record<string, unknown>) => unknown;
function bridgeWith(replyFor: FakeReply) {
  const messages: Record<string, unknown>[] = [];
  const target = {
    webkit: { messageHandlers: { native: { postMessage: async (message: unknown) => {
      const payload = message as Record<string, unknown>; messages.push(payload);
      return replyFor(payload.action as NativeAction, payload);
    } } } },
  } as unknown as Window;
  return { bridge: new NativeBridge(target), messages, target: target as Window & { foldnoteCommand?: (command: unknown) => Promise<void> } };
}

const validStatus = {
  enabled: false, provider: 'apple', providers: [
    { id: 'apple', name: 'On-device', disclosure: 'local', available: true },
    { id: 'ollama', name: 'Ollama', disclosure: 'separate app', available: true },
  ], unavailableReason: null, model: 'all-minilm:22m', models: [{ name: 'all-minilm:22m', disclosure: '46 MB' }],
  installed: true, runtimeAvailable: true, indexedNotes: 0, progress: '', actionableState: 'disabled',
};

test('native capabilities preserve recovery, hotkey, and preference wire actions', async () => {
  const { bridge, messages } = bridgeWith(action => {
    if (action === 'libraryRecovery') return { startupError: 'Corrupt library', backupAvailable: true, backupUpdatedAt: '2026-05-01T12:00:00Z', backupNoteCount: 12 };
    if (action === 'restoreBackup') return { restored: true };
    if (action === 'load') return { hotkeyAvailable: true, hotkeyDisplay: '⌃⇧Space' };
    if (action === 'hotkeyPreferences') return { keyCode: 49, modifiers: 768, display: '⌃⇧Space', registered: false, error: 'Shortcut unavailable' };
    return {};
  });
  const recovery = await bridge.recovery!.state();
  assert.equal(recovery.backupAvailable, true); assert.equal(recovery.backupNoteCount, 12);
  await bridge.recovery!.restoreLastBackup();
  const hotkey = await bridge.hotkey!.load();
  assert.equal(hotkey.display, '⌃⇧Space'); assert.equal(hotkey.registered, false); assert.equal(hotkey.error, 'Shortcut unavailable');
  const attempted = await bridge.hotkey!.set({ keyCode: 40, modifiers: 1 << 8 });
  assert.equal(attempted.registered, false);
  assert.deepEqual(messages.at(-1), { action: 'hotkeyPreferences', shortcut: { keyCode: 40, modifiers: 1 << 8 } });
  assert.deepEqual(messages.map(message => message.action), ['libraryRecovery', 'restoreBackup', 'load', 'hotkeyPreferences', 'hotkeyPreferences']);
});

test('native library boundary validates untrusted data and requires durable save confirmation', async () => {
  const { bridge } = bridgeWith(action => action === 'load'
    ? { library: { version: 1, notes: [{ id: 'n', markdown: 4 }], selectedID: null, activeTag: null } } : {});
  await assert.rejects(bridge.library.load(), /invalid/i);
  await assert.rejects(bridge.library.save({ version: 1, notes: [], selectedID: null, activeTag: null }), /save could not be confirmed/i);
});

test('native semantic replies validate status and hit scores at the adapter boundary', async () => {
  const { bridge: malformedStatus } = bridgeWith(action => action === 'semanticStatus' ? { ...validStatus, indexedNotes: -1 } : {});
  await assert.rejects(malformedStatus.semanticSearch.status(), /malformed/i);
  const { bridge: unknownActionableState } = bridgeWith(action => action === 'semanticStatus' ? { ...validStatus, actionableState: 'new-native-state' } : {});
  await assert.rejects(unknownActionableState.semanticSearch.status(), /malformed/i);
  const { bridge: malformedHit } = bridgeWith(action => action === 'semanticSearch' ? { hits: [{ id: 'n', score: Infinity, snippet: 'bad' }] } : {});
  await assert.rejects(malformedHit.semanticSearch.search('query', ['n']), /invalid hit/i);
  const { bridge, messages } = bridgeWith(action => action === 'semanticEnable' ? { ...validStatus, enabled: true } : {});
  const status = await bridge.semanticSearch.configuration.set({ enabled: true, provider: 'apple' });
  assert.equal(status.enabled, true); assert.equal(messages[0].action, 'semanticEnable');
});

test('native command decoding maps the established wire command to a typed application command', async () => {
  const { bridge, target } = bridgeWith(() => ({}));
  let received: unknown;
  const dispose = bridge.window.bindCommands(async command => { received = command; });
  await target.foldnoteCommand!({ action: 'fontIncrease' });
  assert.deepEqual(received, { type: 'font-size', adjustment: 'increase' });
  await target.foldnoteCommand!({ action: 'flush' });
  assert.deepEqual(received, { type: 'flush' });
  await assert.rejects(target.foldnoteCommand!({ action: 'unknown' }), /Unknown application command/);
  dispose(); assert.equal(target.foldnoteCommand, undefined);
});
