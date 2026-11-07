import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeTasksAdapter } from '../src/tasks/adapters/native-tasks';
import { loadTasksFontState } from '../src/tasks/adapters/font-catalog';
import { DEFAULT_NOTE_FONT_STATE } from '../src/domain/note-font';
import { PreviewTasksAdapter, PREVIEW_TASKS_PREFERENCES_KEY, PREVIEW_TASKS_STORAGE_KEY } from '../src/tasks/adapters/preview-tasks';
import { TasksController } from '../src/tasks/application/controller';
import { EMPTY_TASK_DOCUMENT, type TaskDocument } from '../src/tasks/domain/model';
import { HOTKEY_MODIFIERS, shortcutFromKeyEvent } from '../src/domain/hotkey';
import type { NativeTasksMessage } from '../src/tasks/adapters/native-contract';

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: key => data.get(key) ?? null,
    key: index => [...data.keys()][index] ?? null,
    removeItem: key => { data.delete(key); },
    setItem: (key, value) => { data.set(key, String(value)); },
  } as Storage;
}
function eventWindow(handler: { postMessage(message: NativeTasksMessage): Promise<unknown> }): Window {
  const target = new EventTarget() as EventTarget & { webkit: { messageHandlers: { bananaTasks: typeof handler } } };
  target.webkit = { messageHandlers: { bananaTasks: handler } };
  return target as unknown as Window;
}

test('Tasks typography accepts bundled faces, not remote or escaping font sources', () => {
  const builtin = DEFAULT_NOTE_FONT_STATE.fonts.find(font => font.id === 'space-mono')!;
  const manifest = (file: string) => ({ fonts: [{ ...builtin, faces: [{ file, weight: '400', unicodeRange: 'U+0000-00FF' }] }] });
  const accepted = loadTasksFontState(manifest('space-mono-latin-400-normal.woff2'));
  assert.equal(accepted.fonts.find(font => font.id === builtin.id)?.faces[0].url, 'fonts/space-mono-latin-400-normal.woff2');
  for (const file of ['../secret.woff2', 'https://example.com/font.woff2', 'unexpected.woff2']) {
    assert.deepEqual(loadTasksFontState(manifest(file)).fonts.find(font => font.id === builtin.id)?.faces, []);
  }
});

test('preview store uses isolated namespace, strict documents and revision CAS', async () => {
  const storage = fakeStorage();
  const target = new EventTarget() as unknown as Window;
  const adapter = new PreviewTasksAdapter(target, storage);
  const empty = await adapter.store.load();
  assert.deepEqual(empty, { kind: 'ready', document: null, revision: 'empty' });
  const document: TaskDocument = { ...EMPTY_TASK_DOCUMENT, tasks: [] };
  const saved = await adapter.store.save('empty', document);
  assert.equal(saved.kind, 'saved');
  assert.ok(storage.getItem(PREVIEW_TASKS_STORAGE_KEY));
  assert.equal(storage.getItem(PREVIEW_TASKS_PREFERENCES_KEY), null);
  assert.deepEqual(await adapter.store.save('empty', document), { kind: 'conflict' });

  const broken = fakeStorage({ [PREVIEW_TASKS_STORAGE_KEY]: '{broken' });
  const brokenAdapter = new PreviewTasksAdapter(target, broken);
  assert.deepEqual(await brokenAdapter.store.load(), { kind: 'unreadable', message: 'Preview Tasks storage contains unreadable data; it was left untouched.' });
  await assert.rejects(brokenAdapter.store.save('empty', document), /refusing to overwrite/i);
  assert.equal(broken.getItem(PREVIEW_TASKS_STORAGE_KEY), '{broken');
});

test('browser persistence exceptions surface as recovery rather than silently becoming an empty library', async () => {
  const storage = {
    getItem: (_key: string) => { throw new Error('Synthetic browser storage denial'); },
    setItem: (_key: string, _value: string) => { throw new Error('Synthetic browser storage denial'); },
    removeItem: (_key: string) => undefined,
    clear: () => undefined,
    key: (_index: number) => null,
    length: 0,
  } as Storage;
  const adapter = new PreviewTasksAdapter(new EventTarget() as unknown as Window, storage);
  const controller = new TasksController(adapter);
  const state = await controller.initialize();
  assert.equal(state.kind, 'recovery');
  if (state.kind === 'recovery') {
    assert.equal(state.reason, 'loadFailed');
    assert.match(state.message, /Synthetic browser storage denial/);
  }
  controller.dispose();
});

test('preview save failure stays visible and prevents a task command or hide from claiming durability', async () => {
  const storage = {
    getItem: (_key: string) => null,
    setItem: (_key: string, _value: string) => { throw new Error('Synthetic quota exhaustion'); },
    removeItem: (_key: string) => undefined,
    clear: () => undefined,
    key: (_index: number) => null,
    length: 0,
  } as Storage;
  const adapter = new PreviewTasksAdapter(new EventTarget() as unknown as Window, storage);
  const controller = new TasksController(adapter);
  await controller.initialize();
  assert.equal((await controller.create({ title: 'Not yet durable' })).kind, 'failed');
  assert.equal(await controller.flush(), false);
  const state = controller.getState();
  assert.equal(state.kind, 'ready');
  if (state.kind === 'ready') {
    assert.equal(state.document.tasks.length, 0);
    assert.equal(state.persistenceError?.kind, 'saveFailed');
    assert.equal(state.persistenceError?.localDocument.tasks[0].title, 'Not yet durable');
  }
  controller.dispose();
});

test('native adapter decodes storage and preferences before exposing values', async () => {
  let response: unknown = { kind: 'ready', document: null, revision: 'revision-1' };
  const handler = { postMessage: async (_message: NativeTasksMessage) => response };
  const adapter = new NativeTasksAdapter(eventWindow(handler));
  assert.deepEqual(await adapter.store.load(), { kind: 'ready', document: null, revision: 'revision-1' });
  response = { kind: 'ready', document: { ...EMPTY_TASK_DOCUMENT, extra: 'not supported' }, revision: 'revision-1' };
  await assert.rejects(adapter.store.load(), /invalid/i);

  response = { appearanceTheme: null, pinned: false, soundEnabled: true, motionEnabled: true, ripeningSpeed: 'normal' };
  assert.equal((await adapter.preferences.load()).ripeningSpeed, 'normal');
  response = { appearanceTheme: null, pinned: false, soundEnabled: true, motionEnabled: true, ripeningSpeed: 'wild' };
  await assert.rejects(adapter.preferences.load(), /invalid/i);
});

test('Tasks native hotkey capability maps Cmd-Shift-2, delegates reset, validates wire state, and suppresses during recording', async () => {
  const requests: NativeTasksMessage[] = [];
  let response: unknown = { keyCode: 17, modifiers: HOTKEY_MODIFIERS.control | HOTKEY_MODIFIERS.option,
    display: '⌃⌥T', registered: false, available: true, error: 'registration-failed' };
  const adapter = new NativeTasksAdapter(eventWindow({ postMessage: async message => { requests.push(message); return response; } }));
  const initial = await adapter.hotkeyPreferences.load();
  assert.deepEqual(initial, { keyCode: 17, modifiers: HOTKEY_MODIFIERS.control | HOTKEY_MODIFIERS.option,
    display: '⌃⌥T', registered: false, available: true, error: 'registration-failed' });
  assert.deepEqual(requests[0], { action: 'hotkeyPreferences' });

  const recorded = shortcutFromKeyEvent({ code: 'Digit2', metaKey: true, shiftKey: true, altKey: false, ctrlKey: false });
  assert.deepEqual(recorded, { ok: true, shortcut: { keyCode: 19, modifiers: HOTKEY_MODIFIERS.command | HOTKEY_MODIFIERS.shift } });
  response = { keyCode: 19, modifiers: HOTKEY_MODIFIERS.command | HOTKEY_MODIFIERS.shift,
    display: '⇧⌘2', registered: true, available: true, error: null };
  const updated = await adapter.hotkeyPreferences.set(recorded.shortcut);
  assert.equal(updated.display, '⇧⌘2');
  assert.deepEqual(requests[1], { action: 'hotkeyPreferences', shortcut: recorded.shortcut });
  response = null;
  await adapter.hotkeyPreferences.setRecording(true);
  assert.deepEqual(requests[2], { action: 'hotkeyPreferences', recording: true });
  response = { keyCode: 17, modifiers: HOTKEY_MODIFIERS.control | HOTKEY_MODIFIERS.option,
    display: '⌃⌥T', registered: true, available: true, error: null };
  const reset = await adapter.hotkeyPreferences.reset();
  assert.equal(reset.display, '⌃⌥T');
  assert.deepEqual(requests[3], { action: 'resetHotkeyPreferences' });

  const beforeInvalid = requests.length;
  await assert.rejects(adapter.hotkeyPreferences.set({ keyCode: 19, modifiers: HOTKEY_MODIFIERS.shift }), /invalid/i);
  assert.equal(requests.length, beforeInvalid, 'invalid shortcuts never cross the adapter boundary');
  assert.equal('hotkeyPreferences' in new PreviewTasksAdapter(new EventTarget() as unknown as Window, fakeStorage()), false,
    'browser preview must not pretend to register an OS shortcut');

  response = { keyCode: 17, modifiers: HOTKEY_MODIFIERS.control | HOTKEY_MODIFIERS.option,
    display: '⌃⌥T', registered: true, available: true, error: 'registration-failed' };
  assert.equal((await adapter.hotkeyPreferences.load()).registered, true, 'a failed replacement can report its retained active shortcut');
  response = { keyCode: 17, modifiers: HOTKEY_MODIFIERS.control | HOTKEY_MODIFIERS.option,
    display: '⌃⌥T', registered: false, available: false, error: 'verification-profile' };
  assert.equal((await adapter.hotkeyPreferences.load()).available, false, 'verification profiles stay unavailable');

  for (const invalid of [
    { keyCode: 19, modifiers: 768, display: '⇧⌘2', registered: true, available: false, error: null },
    { keyCode: 19, modifiers: 768, display: '⇧⌘2', registered: false, available: true, error: null },
    { keyCode: 19, modifiers: 768, display: '⇧⌘2', registered: false, available: true, error: 'registration-unavailable' },
    { keyCode: 19, modifiers: 768, display: '⇧⌘2', registered: false, available: false, error: 'registration-failed' },
    { keyCode: 19, modifiers: 768, display: '⇧⌘2', registered: true, available: true, error: 'verification-profile' },
    { keyCode: 19, modifiers: 768, display: '⇧⌘2', registered: true, available: true, error: 'OSStatus 123' },
    { keyCode: 19, modifiers: 768, display: '⇧⌘2', registered: true, available: true, error: null, providerValue: 'secret' },
  ]) {
    response = invalid;
    await assert.rejects(adapter.hotkeyPreferences.load(), /invalid/i);
  }
});

test('native window boundary drops malformed events and rejects invalid remote payloads', async () => {
  let response: unknown = 'invalid';
  const target = eventWindow({ postMessage: async (_message: NativeTasksMessage) => response });
  const adapter = new NativeTasksAdapter(target);
  await assert.rejects(adapter.calendar.authorization(), /authorization response was invalid/i);
  const seen: unknown[] = [];
  adapter.window.subscribe(event => seen.push(event));
  target.dispatchEvent(new CustomEvent('banana-tasks-event', { detail: { kind: 'command', command: 'deleteEverything' } }));
  target.dispatchEvent(new CustomEvent('banana-tasks-event', { detail: { kind: 'command', command: 'newTask' } }));
  target.dispatchEvent(new CustomEvent('banana-tasks-event', { detail: { kind: 'command', command: 'togglePin' } }));
  assert.deepEqual(seen, [{ kind: 'command', command: 'newTask' }, { kind: 'command', command: 'togglePin' }]);
});
