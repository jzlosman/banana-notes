import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';
import { TasksController, DEFAULT_TASKS_PREFERENCES } from '../src/tasks/application/controller';
import type {
  CalendarAppointment, CalendarAuthorization, CalendarBlockDraft, CalendarPort, CaptureProject, CapturedTask, Clock, IdentitySource,
  PlanningCalendar, SaveTasksResult, TasksHotkeyPreferencesPort, TasksHotkeyState, TasksPorts, TasksPreferences, TasksPreferencesPort,
  TasksWindowEvent, TasksWindowPort, TaskStore, TodoistConnection, TodoistPort,
} from '../src/tasks/application/ports';
import { HOTKEY_MODIFIERS } from '../src/domain/hotkey';
import type { NoteFontState } from '../src/domain/note-font';
import { DEFAULT_NOTE_FONT_STATE } from '../src/domain/note-font';
import type { TaskDocument } from '../src/tasks/domain/model';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('/tasks/ui/settings.css') || url.endsWith('/tasks/ui/planning.css') || url.endsWith('/tasks/ui/detail.css') || url.endsWith('/tasks/ui/tag-picker.css')) {
      return { format: 'module', source: 'export {};', shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { mountTasksApp } = await import('../src/tasks/ui/app');

type HarnessOptions = { environment?: 'native' | 'preview'; copyError?: boolean };
function harness(options: HarnessOptions = {}) {
  let now = 1_000_000;
  let revision = 'r0';
  let nextID = 0;
  let stored: TaskDocument | null = null;
  let failSaves = 0;
  let failCopy = options.copyError ?? false;
  let preferences = { ...DEFAULT_TASKS_PREFERENCES };
  const windowListeners = new Set<(event: TasksWindowEvent) => void>();
  const acknowledgements: Array<{ requestID: string; saved: boolean }> = [];
  const copied: string[] = [];
  let saveCalls = 0;
  const store: TaskStore = {
    load: async () => ({ kind: 'ready', document: stored, revision }),
    save: async (expected, candidate): Promise<SaveTasksResult> => {
      saveCalls++;
      if (failSaves > 0) { failSaves--; throw new Error('Synthetic local disk failure.'); }
      if (expected !== revision) return { kind: 'conflict' };
      revision = `r${Number(revision.slice(1)) + 1}`;
      stored = structuredClone(candidate);
      return { kind: 'saved', revision };
    },
  };
  const preferencePort: TasksPreferencesPort = {
    load: async () => ({ ...preferences }),
    save: async next => { preferences = { ...next }; return { ...preferences }; },
  };
  const todoist: TodoistPort = {
    connection: async (): Promise<TodoistConnection> => ({ kind: 'disconnected' }),
    connect: async (_token: string) => { throw new Error('Todoist is intentionally unavailable in this test.'); },
    disconnect: async () => undefined,
    projects: async (): Promise<CaptureProject[]> => [],
    selectProject: async (_projectID: string) => { throw new Error('Todoist is intentionally unavailable in this test.'); },
    captures: async (): Promise<CapturedTask[]> => [],
    setCompleted: async () => undefined,
  };
  const calendar: CalendarPort = {
    authorization: async (): Promise<CalendarAuthorization> => 'unavailable',
    requestAccess: async (): Promise<CalendarAuthorization> => 'unavailable',
    calendars: async (): Promise<PlanningCalendar[]> => [],
    appointments: async (_start: number, _end: number): Promise<CalendarAppointment[]> => [],
    createBlock: async (_draft: CalendarBlockDraft) => { throw new Error('Calendar is intentionally unavailable in this test.'); },
  };
  const windowPort: TasksWindowPort = {
    environment: options.environment ?? 'native',
    subscribe: listener => { windowListeners.add(listener); return () => windowListeners.delete(listener); },
    acknowledgeFlush: async (requestID, saved) => { acknowledgements.push({ requestID, saved }); },
    setDragRegion: async () => undefined,
    copyText: async text => {
      if (failCopy) throw new Error('Synthetic clipboard failure.');
      copied.push(text);
    },
  };
  const clock: Clock = { now: () => now };
  const identities: IdentitySource = { next: () => `ui-task-${++nextID}` };
  const controller = new TasksController({ clock, identities, store, preferences: preferencePort, todoist, calendar, window: windowPort } satisfies TasksPorts);
  return {
    controller, windowPort, acknowledgements, copied,
    get saveCalls() { return saveCalls; },
    get stored() { return stored; },
    setNow(value: number) { now = value; },
    failNextSave() { failSaves++; },
    setCopyFailure(value: boolean) { failCopy = value; },
    emit(event: TasksWindowEvent) { for (const listener of [...windowListeners]) listener(event); },
    get listenerCount() { return windowListeners.size; },
  };
}

function mount(
  app: ReturnType<typeof harness>,
  fontState: NoteFontState = DEFAULT_NOTE_FONT_STATE,
  hotkeyPreferences?: TasksHotkeyPreferencesPort,
) {
  const dom = new JSDOM('<!doctype html><html><body><div id="app" aria-busy="true"></div></body></html>', {
    url: 'http://localhost/tasks.html', pretendToBeVisual: true,
  });
  const root = dom.window.document.querySelector<HTMLElement>('#app')!;
  const previousDocument = globalThis.document;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  const screen = mountTasksApp(root, app.controller, { window: app.windowPort, fontState, hotkeyPreferences });
  const close = dom.window.close.bind(dom.window);
  Object.defineProperty(dom.window, 'close', { configurable: true, value: () => {
    close(); Object.defineProperty(globalThis, 'document', { configurable: true, value: previousDocument });
  } });
  return { dom, root, screen };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 12; index++) await new Promise<void>(resolve => setImmediate(resolve));
}
async function until(condition: () => boolean, message: string): Promise<void> {
  for (let index = 0; index < 100; index++) {
    if (condition()) return;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  assert.fail(message);
}
function ready(app: ReturnType<typeof harness>): Extract<ReturnType<TasksController['getState']>, { kind: 'ready' }> {
  const state = app.controller.getState();
  assert.equal(state.kind, 'ready');
  if (state.kind !== 'ready') throw new Error('Tasks controller is not ready.');
  return state;
}
function task(app: ReturnType<typeof harness>, title: string) {
  return ready(app).document.tasks.find(item => item.title === title);
}
function event(dom: JSDOM, name: string): Event { return new dom.window.Event(name, { bubbles: true, cancelable: true }); }
function click(root: HTMLElement, selector: string): HTMLElement {
  const node = root.querySelector<HTMLElement>(selector);
  assert.ok(node, `Expected element ${selector}`);
  node.click();
  return node;
}

test('loading-to-ready clears busy state and replaces the opening placeholder with the task heading', async () => {
  const app = harness();
  const { dom, root, screen } = mount(app);
  try {
    assert.equal(root.getAttribute('aria-busy'), 'true');
    await app.controller.initialize();
    await until(() => root.getAttribute('aria-busy') === 'false', 'Tasks root remained busy after initialization.');
    assert.equal(root.querySelector('.tasks-list-title')?.textContent, 'Your tasks');
    assert.equal(root.querySelector('.tasks-list-subtitle')?.textContent, 'A little room for what’s next.');
    assert.doesNotMatch(root.textContent ?? '', /Opening your local task list/);
  } finally {
    screen.dispose(); app.controller.dispose(); dom.window.close();
  }
});

test('list capture, detail edits, timers, progress, undo, waiting, compost and recovery use durable commands', async () => {
  const app = harness();
  const { dom, root, screen } = mount(app);
  try {
    await app.controller.initialize();
    await until(() => root.querySelector<HTMLInputElement>('.tasks-capture-input')?.disabled === false, 'Task list did not become ready.');
    const capture = root.querySelector<HTMLInputElement>('.tasks-capture-input')!;
    capture.value = 'Ship one thoughtful thing';
    root.querySelector('form.tasks-capture-form')!.dispatchEvent(event(dom, 'submit'));
    await until(() => task(app, 'Ship one thoughtful thing') !== undefined, 'Captured task was not persisted.');
    assert.equal(capture.value, '', 'capture clears only after an applied local command');

    app.setNow(1_000_000 + 2 * 86_400_000);
    click(root, '[data-task-id] .tasks-row-title');
    await until(() => root.querySelector('.tasks-detail-screen') !== null && root.querySelector('.tasks-detail-title') !== null, 'Task detail did not open.');
    assert.equal(root.querySelector('.tasks-measure-value')?.textContent, '2d ago', 'capture age uses original creation time');

    const title = root.querySelector<HTMLInputElement>('.tasks-detail-title')!;
    title.value = 'A smaller, clear next step';
    title.dispatchEvent(event(dom, 'input'));
    const notes = root.querySelector<HTMLTextAreaElement>('.tasks-detail-notes')!;
    notes.value = 'Keep the note and task context together.';
    notes.dispatchEvent(event(dom, 'input'));
    click(root, '.tasks-save-button');
    await until(() => task(app, 'A smaller, clear next step') !== undefined, 'Detail edits were not saved.');
    assert.equal(ready(app).document.tasks[0].notes, 'Keep the note and task context together.');

    const progress = root.querySelector<HTMLInputElement>('.tasks-progress-input')!;
    progress.value = 'Sent a first version for review';
    root.querySelector<HTMLFormElement>('.tasks-progress-form')!.dispatchEvent(event(dom, 'submit'));
    await until(() => root.querySelector('.tasks-activity-copy')?.textContent?.includes('Sent a first version') === true, 'Progress note was not recorded.');
    assert.equal(ready(app).document.tasks[0].activities.at(-1)?.kind, 'progress');

    click(root, '.tasks-focus-toggle');
    await until(() => app.controller.queryTaskDetail(task(app, 'A smaller, clear next step')!.id)?.running !== null, 'Focus timer did not start.');
    app.setNow(1_000_000 + 2 * 86_400_000 + 65 * 60_000);
    click(root, '.tasks-focus-toggle');
    await until(() => app.controller.queryTaskDetail(task(app, 'A smaller, clear next step')!.id)?.running === null, 'Focus timer did not stop.');
    await until(() => root.querySelector<HTMLButtonElement>('.tasks-complete-button')?.disabled === false, 'Completion action did not become available.');
    click(root, '.tasks-complete-button');
    await until(() => root.querySelector('.tasks-completion-card') !== null, 'Completion confirmation did not appear after the durable command.');
    assert.equal(task(app, 'A smaller, clear next step')?.status.kind, 'completed');
    assert.match(root.querySelector('.tasks-completion-metrics')?.textContent ?? '', /1h 5m/, 'confirmation shows real post-settlement effort');
    assert.equal(root.querySelector('.tasks-completion-status')?.textContent, 'Task completed');
    click(root, '.tasks-completion-undo');
    await until(() => task(app, 'A smaller, clear next step')?.status.kind === 'active', 'Undo did not restore the task.');
    await until(() => root.querySelector<HTMLButtonElement>('.tasks-row-complete')?.disabled === false, 'Undo action did not settle.');
    assert.equal(root.querySelector('.tasks-completion-card'), null);

    click(root, '[data-task-id] .tasks-row-title');
    await until(() => root.querySelector('.tasks-detail-title') !== null, 'Restored task detail did not open.');
    await until(() => root.querySelector<HTMLButtonElement>('[aria-label="Move to Waiting"]')?.disabled === false, 'Waiting action did not become available.');
    click(root, '[aria-label="Move to Waiting"]');
    await until(() => task(app, 'A smaller, clear next step')?.status.kind === 'waiting', 'Task did not move to Waiting.');
    await until(() => root.querySelector<HTMLButtonElement>('[aria-label="Compost task"]')?.disabled === false, 'Compost action did not settle.');
    click(root, '[aria-label="Compost task"]');
    await until(() => task(app, 'A smaller, clear next step')?.status.kind === 'composted', 'Task did not move to compost.');
    await until(() => root.querySelector<HTMLButtonElement>('[aria-label="Recover task"]')?.disabled === false, 'Recovery action did not settle.');
    click(root, '[aria-label="Recover task"]');
    await until(() => task(app, 'A smaller, clear next step')?.status.kind === 'active', 'Composted task did not recover.');
  } finally {
    screen.dispose(); app.controller.dispose(); dom.window.close();
  }
});

test('tag chips and pending queries stay local through rerenders and native flush saves the draft', async () => {
  const app = harness();
  const { dom, root, screen } = mount(app);
  try {
    await app.controller.initialize();
    const target = await app.controller.create({ title: 'Tag draft target' });
    const source = await app.controller.create({ title: 'Tag catalog source', tags: ['Known tag'] });
    assert.equal(target.kind, 'applied');
    assert.equal(source.kind, 'applied');
    if (target.kind !== 'applied') return;
    click(root, `[data-task-id="${target.value.taskID}"] .tasks-row-title`);
    await until(() => root.querySelector('.tasks-detail-title') !== null, 'Tag detail did not open.');
    const input = root.querySelector<HTMLInputElement>('.tasks-tag-picker-input')!;
    const baselineSaves = app.saveCalls;

    input.focus(); input.click();
    const known = [...root.ownerDocument.body.querySelectorAll<HTMLElement>('.tasks-tag-picker-option')]
      .find(option => option.querySelector('.tasks-tag-picker-option-label')?.textContent === 'Known tag');
    assert.ok(known, 'catalog suggestion is available');
    const suggestionMouseDown = new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true });
    known.dispatchEvent(suggestionMouseDown);
    assert.equal(suggestionMouseDown.defaultPrevented, true, 'suggestion interaction retains input focus');
    assert.equal(dom.window.document.activeElement, input);
    known.click();
    assert.deepEqual(app.controller.queryTaskDetail(target.value.taskID)?.tags, [], 'selection edits only the draft');
    assert.equal(app.saveCalls, baselineSaves, 'selection does not save on input blur');
    const remove = root.querySelector<HTMLButtonElement>('[aria-label="Remove tag Known tag"]')!;
    remove.focus();
    assert.equal(dom.window.document.activeElement, remove, 'the remove chip is reachable within the tag editor');
    assert.equal(app.saveCalls, baselineSaves, 'focus moving from input to chip does not save');
    remove.click();
    assert.equal(app.saveCalls, baselineSaves, 'chip removal does not save while focus remains in the tag editor');

    input.value = 'New local tag'; input.dispatchEvent(event(dom, 'input'));
    input.focus();
    await app.controller.updatePreferences({ pinned: true });
    assert.equal(input.value, 'New local tag', 'controller rerender preserves the query');
    assert.equal(dom.window.document.activeElement, input, 'controller rerender preserves editor focus');
    assert.match(root.querySelector('.tasks-draft-status')?.textContent ?? '', /Unsaved changes/);

    app.emit({ kind: 'flush', requestID: 'flush-tags' });
    await until(() => app.acknowledgements.some(ack => ack.requestID === 'flush-tags'), 'Tag draft flush was not acknowledged.');
    assert.equal(app.acknowledgements.find(ack => ack.requestID === 'flush-tags')?.saved, true);
    assert.deepEqual(app.controller.queryTaskDetail(target.value.taskID)?.tags, ['New local tag']);
    assert.equal(input.value, '', 'flush chips pending query text before the save');
    assert.equal(app.saveCalls, baselineSaves + 1, 'flush persists the complete tag draft once');

    input.focus(); input.value = 'Blur saved tag'; input.dispatchEvent(event(dom, 'input'));
    root.querySelector<HTMLTextAreaElement>('.tasks-detail-notes')!.focus();
    await until(() => app.controller.queryTaskDetail(target.value.taskID)?.tags.includes('Blur saved tag') === true,
      'leaving the tag editor did not chip and save its pending query');
    assert.equal(app.saveCalls, baselineSaves + 2);

    input.focus(); input.value = 'Explicitly saved tag'; input.dispatchEvent(event(dom, 'input'));
    click(root, '.tasks-save-button');
    await until(() => app.controller.queryTaskDetail(target.value.taskID)?.tags.includes('Explicitly saved tag') === true,
      'explicit Save did not commit the pending tag query');
    assert.equal(app.saveCalls, baselineSaves + 3, 'blur and explicit Save share one draft commit each');
  } finally {
    screen.dispose(); app.controller.dispose(); dom.window.close();
  }
});

test('native flush commits a valid detail draft first and leaves an invalid draft explicitly unsaved', async () => {
  const app = harness();
  const { dom, root, screen } = mount(app);
  try {
    await app.controller.initialize();
    const created = await app.controller.create({ title: 'Draft flush target' });
    assert.equal(created.kind, 'applied');
    click(root, '[data-task-id] .tasks-row-title');
    await until(() => root.querySelector('.tasks-detail-title') !== null, 'Task detail did not open.');
    const title = root.querySelector<HTMLInputElement>('.tasks-detail-title')!;
    title.value = 'Flushed before hide'; title.dispatchEvent(event(dom, 'input'));
    app.emit({ kind: 'flush', requestID: 'flush-valid' });
    await until(() => app.acknowledgements.some(ack => ack.requestID === 'flush-valid'), 'Native flush was not acknowledged.');
    assert.equal(app.acknowledgements.find(ack => ack.requestID === 'flush-valid')?.saved, true);
    assert.equal(task(app, 'Flushed before hide')?.title, 'Flushed before hide');

    title.value = '   '; title.dispatchEvent(event(dom, 'input'));
    app.emit({ kind: 'flush', requestID: 'flush-invalid' });
    await until(() => app.acknowledgements.some(ack => ack.requestID === 'flush-invalid'), 'Second native flush was not acknowledged.');
    assert.equal(task(app, 'Flushed before hide')?.title, 'Flushed before hide', 'invalid draft did not enter the durable document');
    assert.match(root.querySelector('.tasks-draft-status')?.textContent ?? '', /title is required/i);
    assert.equal(root.querySelector('.tasks-detail-footer-status')?.textContent, 'Unsaved task edits');
  } finally {
    screen.dispose(); app.controller.dispose(); dom.window.close();
  }
});

test('save failure keeps capture text and selectable recovery JSON; failed clipboard copy remains an error', async () => {
  const app = harness({ copyError: true });
  const { dom, root, screen } = mount(app);
  try {
    await app.controller.initialize();
    const capture = root.querySelector<HTMLInputElement>('.tasks-capture-input')!;
    capture.value = 'Keep this unsaved capture';
    app.failNextSave();
    root.querySelector('form.tasks-capture-form')!.dispatchEvent(event(dom, 'submit'));
    await until(() => ready(app).persistenceError?.kind === 'saveFailed', 'Synthetic save failure was not surfaced.');
    assert.equal(capture.value, 'Keep this unsaved capture', 'the capture draft is preserved after a failed command');
    const json = root.querySelector<HTMLTextAreaElement>('.tasks-preserved-json')!;
    assert.equal(json.readOnly, true);
    assert.match(json.value, /Keep this unsaved capture/, 'recovery JSON contains the uncommitted local intent');
    click(root, '.tasks-preserved-details summary');
    click(root, '.tasks-recovery-button:not([hidden]):not(:disabled):nth-of-type(2)');
    await until(() => root.querySelector('.tasks-recovery-status')?.textContent?.includes('Copy failed') === true, 'Clipboard failure was not reported.');
    assert.match(json.value, /Keep this unsaved capture/, 'copy failure leaves the JSON available for selection');
    app.setCopyFailure(false);
    click(root, '.tasks-recovery-button:not([hidden]):not(:disabled):nth-of-type(2)');
    await until(() => app.copied.length === 1, 'Preserved JSON was not copied through the supported command.');
    assert.equal(app.copied.length, 1, 'one user action issues exactly one clipboard command');

    click(root, '.tasks-recovery-button:first-of-type');
    await until(() => ready(app).persistenceError === null, 'Retry did not save the preserved local document.');
    assert.equal(task(app, 'Keep this unsaved capture')?.title, 'Keep this unsaved capture');
    assert.equal(root.querySelector<HTMLElement>('.tasks-persistence-notice')?.hidden, true);
  } finally {
    screen.dispose(); app.controller.dispose(); dom.window.close();
  }
});

test('clipboard bridge enforces its 100k text limit without hiding or chunking preserved JSON', async () => {
  const app = harness();
  await app.controller.initialize();
  for (let index = 0; index < 6; index++) {
    const result = await app.controller.create({ title: `Large ${index}`, notes: 'x'.repeat(20_000) });
    assert.equal(result.kind, 'applied');
  }
  const { dom, root, screen } = mount(app);
  try {
    await settle();
    click(root, '[data-task-id] .tasks-row-title');
    await until(() => root.querySelector('.tasks-detail-title') !== null, 'Large task detail did not open.');
    app.failNextSave();
    const title = root.querySelector<HTMLInputElement>('.tasks-detail-title')!;
    title.value = 'Large 0 updated'; title.dispatchEvent(event(dom, 'input'));
    click(root, '.tasks-save-button');
    await until(() => ready(app).persistenceError?.kind === 'saveFailed', 'Large local changes were not preserved.');
    const json = root.querySelector<HTMLTextAreaElement>('.tasks-preserved-json')!;
    assert.ok(json.value.length > 100_000);
    assert.equal(json.readOnly, true);
    assert.equal(root.querySelector<HTMLButtonElement>('.tasks-recovery-button:nth-of-type(2)')?.disabled, true);
    assert.match(root.querySelector('.tasks-preserved-help')?.textContent ?? '', /100,000 characters/);
    const copyCount = app.copied.length;
    root.querySelector<HTMLButtonElement>('.tasks-recovery-button:nth-of-type(2)')!.click();
    await settle();
    assert.equal(app.copied.length, copyCount, 'oversized content is not sent through the native bridge');
    assert.ok(json.value.length > 100_000, 'the full recovery JSON remains available for selection');
  } finally {
    screen.dispose(); app.controller.dispose(); dom.window.close();
  }
});

test('native focus loss cancels the Settings recorder even when the DOM window does not blur', async () => {
  const app = harness();
  const calls: boolean[] = [];
  const confirmed: TasksHotkeyState = {
    keyCode: 17,
    modifiers: HOTKEY_MODIFIERS.control | HOTKEY_MODIFIERS.option,
    display: '⌃⌥T',
    registered: true,
    available: true,
    error: null,
  };
  const hotkeys: TasksHotkeyPreferencesPort = {
    load: async () => confirmed,
    set: async () => confirmed,
    reset: async () => confirmed,
    setRecording: async recording => { calls.push(recording); },
  };
  const { dom, root, screen } = mount(app, DEFAULT_NOTE_FONT_STATE, hotkeys);
  let browserBlurred = false;
  dom.window.addEventListener('blur', () => { browserBlurred = true; });
  try {
    await app.controller.initialize();
    app.emit({ kind: 'command', command: 'settings' });
    await until(() => root.querySelector<HTMLButtonElement>('[data-action="record-hotkey"]')?.textContent === '⌃⌥T', 'Settings recorder did not load.');
    root.querySelector<HTMLButtonElement>('[data-action="record-hotkey"]')!.click();
    await until(() => root.querySelector<HTMLButtonElement>('[data-action="record-hotkey"]')?.dataset.recording === 'true', 'Recorder did not start.');

    app.emit({ kind: 'focus', focused: false });
    await until(() => calls.length === 2 && calls[1] === false, 'Native focus loss did not release recording suppression.');
    assert.deepEqual(calls, [true, false]);
    assert.ok(root.querySelector('.tasks-settings'), 'Settings remains mounted after native focus loss.');
    assert.equal(browserBlurred, false, 'the native focus event is the only blur signal in this test.');
  } finally {
    screen.dispose(); app.controller.dispose(); dom.window.close();
  }
});

test('window pin command and toolbar use preference commands; disposal removes UI listeners and timers', async () => {
  const app = harness();
  const { dom, root, screen } = mount(app);
  try {
    await app.controller.initialize();
    const taskWritesBefore = app.saveCalls;
    app.emit({ kind: 'command', command: 'togglePin' });
    await until(() => ready(app).preferences.pinned, 'Native pin command did not persist.');
    assert.equal(root.querySelector('.tasks-pin-button')?.getAttribute('aria-pressed'), 'true');
    assert.equal(app.saveCalls, taskWritesBefore, 'pinning uses the preference port, not task persistence');
    click(root, '.tasks-pin-button');
    await until(() => !ready(app).preferences.pinned, 'Toolbar did not toggle the persisted pin state.');
    assert.equal(root.querySelector('.tasks-pin-button')?.getAttribute('aria-pressed'), 'false');

    const listenersBeforeDispose = app.listenerCount;
    screen.dispose();
    assert.equal(root.childElementCount, 0);
    assert.equal(app.listenerCount, listenersBeforeDispose - 1, 'the app removed its direct native-flush listener');
    app.emit({ kind: 'command', command: 'newTask' });
    assert.equal(root.childElementCount, 0, 'disposed UI does not react to window commands');
  } finally {
    screen.dispose(); app.controller.dispose(); dom.window.close();
  }
});
