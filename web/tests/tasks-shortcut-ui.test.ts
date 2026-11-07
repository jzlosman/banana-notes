import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';
import { HOTKEY_MODIFIERS, type RecordedShortcut } from '../src/domain/hotkey';
import { DEFAULT_TASKS_PREFERENCES, type TasksFacade, type TasksState } from '../src/tasks/application/controller';
import type { TasksHotkeyPreferencesPort, TasksHotkeyState } from '../src/tasks/application/ports';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('/tasks/ui/settings.css')) return { format: 'module', source: 'export {};', shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { mountTasksSettings } = await import('../src/tasks/ui/settings');

function chordState(overrides: Partial<TasksHotkeyState> = {}): TasksHotkeyState {
  return {
    keyCode: 17,
    modifiers: HOTKEY_MODIFIERS.control | HOTKEY_MODIFIERS.option,
    display: '⌃⌥T',
    registered: true,
    available: true,
    error: null,
    ...overrides,
  };
}

const readyState: TasksState = {
  kind: 'ready',
  document: { version: 1, tasks: [], runningSession: null, todoistOutbox: [] },
  revision: 'test-revision',
  preferences: { ...DEFAULT_TASKS_PREFERENCES },
  persistenceError: null,
  preferencesError: null,
  fault: null,
  todoistConnection: { kind: 'disconnected' },
  captureProjects: [],
  calendar: { authorization: 'notDetermined', calendars: [], appointments: [] },
};

function facade(): TasksFacade {
  return {
    getState: () => readyState,
    subscribe: () => () => undefined,
    updatePreferences: async () => ({ kind: 'applied', value: { ...DEFAULT_TASKS_PREFERENCES } }),
  } as unknown as TasksFacade;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function harness(port?: TasksHotkeyPreferencesPort) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/tasks.html' });
  const root = dom.window.document.createElement('div');
  dom.window.document.body.append(root);
  let closed = 0;
  const mounted = mountTasksSettings(root, facade(), {
    environment: 'native',
    hotkeyPreferences: port,
    onClose: () => { closed++; },
    notify: () => undefined,
  });
  return { dom, root, mounted, closed: () => closed };
}

function hotkeyPort(options: {
  initial?: TasksHotkeyState;
  onLoad?: () => Promise<TasksHotkeyState>;
  onSet?: (shortcut: RecordedShortcut) => Promise<TasksHotkeyState>;
  onReset?: () => Promise<TasksHotkeyState>;
  onRecording?: (recording: boolean) => Promise<void>;
} = {}) {
  const calls = { loads: 0, sets: [] as RecordedShortcut[], resets: 0, recordings: [] as boolean[] };
  const initial = options.initial ?? chordState();
  const port: TasksHotkeyPreferencesPort = {
    load: async () => { calls.loads++; return options.onLoad ? options.onLoad() : initial; },
    set: async shortcut => {
      calls.sets.push({ ...shortcut });
      return options.onSet ? options.onSet(shortcut) : chordState({ ...shortcut, display: '⇧⌘2', modifiers: HOTKEY_MODIFIERS.command | HOTKEY_MODIFIERS.shift });
    },
    reset: async () => {
      calls.resets++;
      return options.onReset ? options.onReset() : chordState();
    },
    setRecording: recording => {
      calls.recordings.push(recording);
      return options.onRecording ? options.onRecording(recording) : Promise.resolve();
    },
  };
  return { port, calls };
}

async function until(condition: () => boolean, message: string): Promise<void> {
  for (let index = 0; index < 80; index++) {
    if (condition()) return;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  assert.fail(message);
}

function recordButton(root: HTMLElement): HTMLButtonElement {
  const button = root.querySelector<HTMLButtonElement>('[data-action="record-hotkey"]');
  assert.ok(button, 'The shortcut recorder should be present.');
  return button;
}

function rootError(root: HTMLElement): string | null {
  return root.querySelector('[role="alert"].tasks-hotkey-feedback')?.textContent ?? null;
}

function sendKey(dom: JSDOM, root: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
  const event = new dom.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  root.querySelector('[data-action="record-hotkey"]')?.dispatchEvent(event);
  return event;
}

test('General starts with the confirmed chord and records the physical Cmd+Shift+2 key', async () => {
  const { port, calls } = hotkeyPort();
  const { dom, root, mounted } = harness(port);
  try {
    assert.equal(root.querySelector('[data-tab="General"]')?.getAttribute('aria-selected'), 'true');
    assert.equal(recordButton(root).textContent, 'Loading…');
    await until(() => recordButton(root).textContent === '⌃⌥T', 'The native shortcut was not loaded.');
    assert.match(root.textContent ?? '', /Show or hide Banana Tasks from any app\./);

    recordButton(root).click();
    await until(() => recordButton(root).dataset.recording === 'true', 'Recording did not start after native suppression was confirmed.');
    assert.equal(dom.window.document.activeElement, recordButton(root), 'the mounted recorder owns keyboard focus after rerender');
    sendKey(dom, root, { key: 'Shift', code: 'ShiftLeft', shiftKey: true });
    sendKey(dom, root, { key: '@', code: 'Digit2', metaKey: true, shiftKey: true, repeat: true });
    assert.equal(calls.sets.length, 0, 'Modifier-only and repeated keys are ignored.');
    sendKey(dom, root, { key: '@', code: 'Digit2', metaKey: true, shiftKey: true });
    await until(() => calls.sets.length === 1, 'The captured shortcut was not saved.');
    await until(() => recordButton(root).textContent === '⇧⌘2', 'The confirmed native display was not rendered.');
    assert.deepEqual(calls.sets, [{ keyCode: 19, modifiers: HOTKEY_MODIFIERS.command | HOTKEY_MODIFIERS.shift }]);
    assert.deepEqual(calls.recordings, [true, false]);
    assert.equal(root.querySelector('[role="alert"].tasks-hotkey-feedback'), null);
  } finally {
    mounted.dispose(); dom.window.close();
  }
});

test('Escape stays in Settings, while Escape, element blur, and window blur all release recording suppression', async () => {
  const { port, calls } = hotkeyPort();
  const { dom, root, mounted, closed } = harness(port);
  try {
    await until(() => recordButton(root).textContent === '⌃⌥T', 'The native shortcut was not loaded.');
    recordButton(root).click();
    await until(() => recordButton(root).dataset.recording === 'true', 'Recording did not start.');
    const escape = sendKey(dom, root, { key: 'Escape', code: 'Escape' });
    await until(() => calls.recordings.filter(value => !value).length === 1 && recordButton(root).getAttribute('aria-busy') === null, 'Escape did not stop native recording mode.');
    assert.equal(escape.defaultPrevented, true);
    assert.equal(closed(), 0, 'Escape during recording must not close Settings.');
    assert.equal(root.querySelector('[data-tab="General"]')?.getAttribute('aria-selected'), 'true');

    recordButton(root).click();
    await until(() => recordButton(root).dataset.recording === 'true', 'Recording did not restart.');
    recordButton(root).focus();
    root.querySelector<HTMLButtonElement>('[data-tab="Themes"]')!.focus();
    await until(() => calls.recordings.filter(value => !value).length === 2 && recordButton(root).getAttribute('aria-busy') === null, 'Leaving the recorder did not cancel recording.');

    root.querySelector<HTMLButtonElement>('[data-tab="General"]')!.click();
    recordButton(root).click();
    await until(() => recordButton(root).dataset.recording === 'true', 'Recording did not restart after focus loss.');
    dom.window.dispatchEvent(new dom.window.Event('blur'));
    await until(() => calls.recordings.filter(value => !value).length === 3 && recordButton(root).getAttribute('aria-busy') === null, 'Window blur did not release recording suppression.');
    assert.deepEqual(calls.recordings, [true, false, true, false, true, false]);
  } finally {
    mounted.dispose(); dom.window.close();
  }
});

test('registration failure keeps the confirmed chord, reports whether one remains active, and reset uses native confirmation', async () => {
  const initial = chordState();
  const failed = chordState({ registered: false, available: true, error: 'registration-failed' });
  const { port, calls } = hotkeyPort({
    initial,
    onSet: async () => failed,
    onReset: async () => chordState(),
  });
  const { dom, root, mounted } = harness(port);
  try {
    await until(() => recordButton(root).textContent === initial.display, 'The native shortcut was not loaded.');
    recordButton(root).click();
    await until(() => recordButton(root).dataset.recording === 'true', 'A failed initial registration must still allow recovery recording when capability is available.');
    sendKey(dom, root, { key: 'a', code: 'KeyA', ctrlKey: true });
    await until(() => calls.sets.length === 1 && !!root.querySelector('[role="alert"].tasks-hotkey-feedback'), 'Failed registration replaced the confirmed chord.');
    assert.equal(recordButton(root).disabled, false, 'available is a capability and stays enabled even when nothing is registered.');
    assert.match(root.querySelector('[role="alert"].tasks-hotkey-feedback')?.textContent ?? '', /No global shortcut is active/);
    assert.doesNotMatch(root.querySelector('[role="alert"].tasks-hotkey-feedback')?.textContent ?? '', /previous shortcut remains active/);

    root.querySelector<HTMLButtonElement>('[data-action="reset-hotkey"]')!.click();
    await until(() => calls.resets === 1 && root.querySelector('[role="alert"].tasks-hotkey-feedback') === null, 'Reset was not confirmed by the native port.');
    assert.equal(recordButton(root).textContent, '⌃⌥T');
    assert.deepEqual(calls.sets, [{ keyCode: 0, modifiers: HOTKEY_MODIFIERS.control }]);
  } finally {
    mounted.dispose(); dom.window.close();
  }
});

test('a failed replacement keeps the last registered chord and reports it remains active', async () => {
  const initial = chordState({ keyCode: 40, modifiers: HOTKEY_MODIFIERS.command | HOTKEY_MODIFIERS.option, display: '⌥⌘K' });
  const failed = chordState({ ...initial, registered: true, available: true, error: 'registration-failed' });
  const { port } = hotkeyPort({ initial, onSet: async () => failed });
  const { dom, root, mounted } = harness(port);
  try {
    await until(() => recordButton(root).textContent === initial.display, 'The current native shortcut was not loaded.');
    recordButton(root).click();
    await until(() => recordButton(root).dataset.recording === 'true', 'Recording did not start.');
    sendKey(dom, root, { key: 'b', code: 'KeyB', metaKey: true });
    await until(() => root.querySelector('[role="alert"].tasks-hotkey-feedback')?.textContent?.includes('previous shortcut remains active') === true, 'The failure did not preserve the active chord.');
    assert.equal(recordButton(root).textContent, initial.display);
    assert.equal(recordButton(root).disabled, false);
  } finally {
    mounted.dispose(); dom.window.close();
  }
});

test('invalid physical shortcuts announce Notes validation copy without leaving recording mode', async () => {
  const { port, calls } = hotkeyPort();
  const { dom, root, mounted } = harness(port);
  try {
    await until(() => recordButton(root).textContent === '⌃⌥T', 'The native shortcut was not loaded.');
    recordButton(root).click();
    await until(() => recordButton(root).dataset.recording === 'true', 'Recording did not start.');
    sendKey(dom, root, { key: 'a', code: 'KeyA', shiftKey: true });
    assert.equal(root.querySelector('[role="alert"].tasks-hotkey-feedback')?.textContent, 'Include at least one of Command, Control, or Option.');
    assert.equal(recordButton(root).dataset.recording, 'true');
    assert.equal(calls.sets.length, 0);

    sendKey(dom, root, { key: '¥', code: 'IntlYen', ctrlKey: true });
    assert.equal(root.querySelector('[role="alert"].tasks-hotkey-feedback')?.textContent, 'That key is not supported. Try a letter, number, Space, Return, Tab, arrow, function, or punctuation key.');
    assert.equal(recordButton(root).dataset.recording, 'true');
    sendKey(dom, root, { key: '@', code: 'Digit2', metaKey: true, shiftKey: true });
    await until(() => calls.sets.length === 1 && recordButton(root).textContent === '⇧⌘2', 'A valid shortcut did not clear the capture error and save.');
    assert.equal(root.querySelector('[role="alert"].tasks-hotkey-feedback'), null);
  } finally {
    mounted.dispose(); dom.window.close();
  }
});

test('a set rejection after native commit keeps only last-confirmed copy until Settings is reopened', async () => {
  const initial = chordState({ keyCode: 40, modifiers: HOTKEY_MODIFIERS.command | HOTKEY_MODIFIERS.option, display: '⌥⌘K' });
  let actualNativeState = initial;
  const { port, calls } = hotkeyPort({
    initial,
    onLoad: async () => actualNativeState,
    onSet: async shortcut => {
      actualNativeState = chordState({ ...shortcut, display: '⌃X', registered: true, available: true, error: null });
      throw new Error('Native command committed but its reply was lost.');
    },
  });
  const first = harness(port);
  try {
    await until(() => recordButton(first.root).textContent === initial.display, 'The original shortcut was not loaded.');
    recordButton(first.root).click();
    await until(() => recordButton(first.root).dataset.recording === 'true', 'Recording did not start.');
    sendKey(first.dom, first.root, { key: 'x', code: 'KeyX', ctrlKey: true });
    await until(() => calls.sets.length === 1 && rootError(first.root) !== null, 'The lost set reply was not surfaced.');
    assert.equal(recordButton(first.root).textContent, initial.display, 'Only the last-confirmed chord remains displayed.');
    assert.equal(rootError(first.root), 'Could not confirm the shortcut change. Reopen Settings to check it.');
    assert.doesNotMatch(rootError(first.root)!, /previous shortcut remains active|No global shortcut is active/);
    assert.equal(calls.loads, 1, 'The UI does not pretend the original state is authoritative after a lost reply.');
  } finally {
    first.mounted.dispose(); first.dom.window.close();
  }

  const reopened = harness(port);
  try {
    await until(() => recordButton(reopened.root).textContent === actualNativeState.display, 'Reopening Settings did not load the actual native chord.');
    assert.equal(calls.loads, 2);
  } finally {
    reopened.mounted.dispose(); reopened.dom.window.close();
  }
});

test('unavailable and absent native ports never offer recording', async () => {
  const unavailable = chordState({
    registered: false, available: false, error: 'verification-profile',
  });
  const unavailablePort = hotkeyPort({ initial: unavailable });
  const first = harness(unavailablePort.port);
  try {
    await until(() => !!first.root.querySelector('[role="alert"].tasks-hotkey-feedback'), 'Unavailable shortcut status was not rendered.');
    assert.equal(recordButton(first.root).disabled, true);
    assert.match(first.root.querySelector('[role="alert"].tasks-hotkey-feedback')?.textContent ?? '', /Global shortcuts are off in this verification build/);
    recordButton(first.root).click();
    first.root.querySelector<HTMLButtonElement>('[data-action="reset-hotkey"]')!.click();
    assert.deepEqual(unavailablePort.calls.recordings, []);
    assert.equal(unavailablePort.calls.resets, 0);
  } finally {
    first.mounted.dispose(); first.dom.window.close();
  }

  const preview = harness();
  try {
    assert.equal(preview.root.querySelector('[data-action="record-hotkey"]'), null);
    assert.equal(preview.root.querySelector('.tasks-hotkey-section'), null);
  } finally {
    preview.mounted.dispose(); preview.dom.window.close();
  }
});

test('a shortcut save resolving after disposal cannot restore stale Settings DOM', async () => {
  const saveAck = deferred<TasksHotkeyState>();
  const { port, calls } = hotkeyPort({ onSet: () => saveAck.promise });
  const screen = harness(port);
  try {
    await until(() => recordButton(screen.root).textContent === '⌃⌥T', 'The shortcut was not loaded.');
    recordButton(screen.root).click();
    await until(() => recordButton(screen.root).dataset.recording === 'true', 'Recording did not start.');
    sendKey(screen.dom, screen.root, { key: 'x', code: 'KeyX', ctrlKey: true });
    await until(() => calls.sets.length === 1, 'The shortcut save was not dispatched.');
    screen.mounted.dispose();
    saveAck.resolve(chordState({ display: '⌃⌃X', keyCode: 7, modifiers: HOTKEY_MODIFIERS.control }));
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(screen.root.childElementCount, 0);
  } finally {
    screen.mounted.dispose(); screen.dom.window.close();
  }
});

test('late load and capture acknowledgements cannot revive a disposed recorder or release a newer mount', async () => {
  const delayedLoad = deferred<TasksHotkeyState>();
  const loadPort = hotkeyPort();
  loadPort.port.load = () => delayedLoad.promise;
  const first = harness(loadPort.port);
  first.mounted.dispose();
  delayedLoad.resolve(chordState());
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(first.root.childElementCount, 0, 'A stale load must not recreate a disposed Settings surface.');
  first.dom.window.close();

  const beginAck = deferred<void>();
  const releaseAck = deferred<void>();
  const oldCalls: boolean[] = [];
  const oldPort: TasksHotkeyPreferencesPort = {
    load: async () => chordState(),
    set: async () => chordState(),
    reset: async () => chordState(),
    setRecording: recording => {
      oldCalls.push(recording);
      return recording ? beginAck.promise : releaseAck.promise;
    },
  };
  const oldMount = harness(oldPort);
  try {
    await until(() => recordButton(oldMount.root).textContent === '⌃⌥T', 'The old recorder did not load.');
    recordButton(oldMount.root).click();
    await until(() => oldCalls.length === 1, 'The old recording begin was not dispatched.');
    oldMount.mounted.dispose();
    assert.deepEqual(oldCalls, [true, false], 'Disposal dispatches false immediately after the pending true request.');

    const newPort = hotkeyPort();
    const newMount = harness(newPort.port);
    try {
      await until(() => recordButton(newMount.root).textContent === '⌃⌥T', 'The replacement recorder did not load.');
      recordButton(newMount.root).click();
      await until(() => recordButton(newMount.root).dataset.recording === 'true', 'The replacement recorder did not enter recording mode.');
      beginAck.resolve();
      releaseAck.resolve();
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.deepEqual(oldCalls, [true, false], 'A stale begin acknowledgement must not send a late false after the replacement begins.');
      assert.deepEqual(newPort.calls.recordings, [true]);
      assert.equal(recordButton(newMount.root).dataset.recording, 'true');
    } finally {
      newMount.mounted.dispose(); newMount.dom.window.close();
    }
  } finally {
    oldMount.dom.window.close();
  }
});
