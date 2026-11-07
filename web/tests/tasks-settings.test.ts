import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';
import { TasksController, DEFAULT_TASKS_PREFERENCES } from '../src/tasks/application/controller';
import type {
  CalendarAppointment, CalendarAuthorization, CalendarBlockDraft, CalendarPort, CaptureProject, CapturedTask, Clock, IdentitySource,
  PlanningCalendar, SaveTasksResult, StoredTasks, TasksPorts, TasksPreferences, TasksPreferencesPort, TasksWindowEvent,
  TasksWindowPort, TaskStore, TodoistConnection, TodoistPort,
} from '../src/tasks/application/ports';
import type { TaskDocument } from '../src/tasks/domain/model';
import { themes, SYSTEM_THEME } from '../src/domain/themes';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('/tasks/ui/settings.css')) return { format: 'module', source: 'export {};', shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { mountTasksSettings } = await import('../src/tasks/ui/settings');

type HarnessOptions = {
  failPreferences?: (preferences: TasksPreferences) => boolean;
  calendarResult?: CalendarAuthorization;
};

function harness(options: HarnessOptions = {}) {
  let revision = 'r0';
  let stored: TaskDocument | null = null;
  let currentPreferences = { ...DEFAULT_TASKS_PREFERENCES };
  let currentConnection: TodoistConnection = { kind: 'disconnected' };
  let calendarAuthorization: CalendarAuthorization = 'notDetermined';
  let nextID = 0;
  const calls = {
    preferenceSaves: [] as TasksPreferences[],
    taskSaves: 0,
    tokens: [] as string[],
    projectLoads: 0,
    selectedProjects: [] as string[],
    refreshes: 0,
    disconnects: 0,
    calendarRequests: 0,
    calendarConnections: 0,
  };
  const store: TaskStore = {
    load: async (): Promise<StoredTasks> => ({ kind: 'ready', document: stored, revision }),
    save: async (expected, document): Promise<SaveTasksResult> => {
      if (expected !== revision) return { kind: 'conflict' };
      calls.taskSaves++;
      stored = structuredClone(document);
      revision = `r${Number(revision.slice(1)) + 1}`;
      return { kind: 'saved', revision };
    },
  };
  const preferences: TasksPreferencesPort = {
    load: async () => ({ ...currentPreferences }),
    save: async candidate => {
      calls.preferenceSaves.push({ ...candidate });
      if (options.failPreferences?.(candidate)) throw new Error('Synthetic preference save fault.');
      currentPreferences = { ...candidate };
      return { ...currentPreferences };
    },
  };
  const projects: CaptureProject[] = [{ id: 'project-A', name: 'Selected project' }, { id: 'project-B', name: 'Second project' }];
  const todoist: TodoistPort = {
    connection: async () => currentConnection,
    connect: async token => {
      calls.tokens.push(token);
      currentConnection = { kind: 'connected', accountID: 'synthetic-account', projectID: null };
      return { connection: currentConnection, projects };
    },
    disconnect: async () => { calls.disconnects++; currentConnection = { kind: 'disconnected' }; },
    projects: async () => { calls.projectLoads++; return projects; },
    selectProject: async projectID => {
      calls.selectedProjects.push(projectID);
      if (currentConnection.kind !== 'connected') throw new Error('Synthetic disconnected state.');
      currentConnection = { ...currentConnection, projectID };
      return currentConnection;
    },
    captures: async (): Promise<CapturedTask[]> => { calls.refreshes++; return []; },
    setCompleted: async () => undefined,
  };
  const calendar: CalendarPort = {
    authorization: async () => calendarAuthorization,
    requestAccess: async () => { calls.calendarRequests++; calendarAuthorization = options.calendarResult ?? 'denied'; return calendarAuthorization; },
    calendars: async (): Promise<PlanningCalendar[]> => [],
    appointments: async (_start: number, _end: number): Promise<CalendarAppointment[]> => [],
    createBlock: async (draft: CalendarBlockDraft) => ({ id: 'synthetic-event', start: draft.start, end: draft.end, calendarID: draft.calendarID }),
  };
  const windowListeners = new Set<(event: TasksWindowEvent) => void>();
  const windowPort: TasksWindowPort = {
    environment: 'native',
    subscribe: listener => { windowListeners.add(listener); return () => windowListeners.delete(listener); },
    acknowledgeFlush: async () => undefined,
    setDragRegion: async () => undefined,
    copyText: async () => undefined,
  };
  const clock: Clock = { now: () => 10_000 };
  const identities: IdentitySource = { next: () => `synthetic-${++nextID}` };
  const controller = new TasksController({ clock, identities, store, preferences, todoist, calendar, window: windowPort } satisfies TasksPorts);
  return { controller, calls, getStored: () => stored, getPreferences: () => ({ ...currentPreferences }) };
}

function domRoot() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/tasks.html' });
  const root = dom.window.document.createElement('div');
  dom.window.document.body.append(root);
  return { dom, root };
}

function mount(root: HTMLElement, controller: TasksController, environment: 'native' | 'preview' = 'native') {
  const notices: Array<{ message: string; kind?: 'status' | 'error' }> = [];
  let closed = 0;
  const mounted = mountTasksSettings(root, controller, {
    environment,
    onClose: () => { closed++; },
    notify: (message, kind) => notices.push({ message, kind }),
  });
  return { ...mounted, notices, closed: () => closed };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index++) await new Promise<void>(resolve => setImmediate(resolve));
}

async function until(condition: () => boolean, message: string): Promise<void> {
  for (let index = 0; index < 60; index++) {
    if (condition()) return;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  assert.fail(message);
}

function readyPreferences(controller: TasksController): TasksPreferences {
  const state = controller.getState();
  assert.equal(state.kind, 'ready');
  if (state.kind !== 'ready') throw new Error('Tasks controller is not ready.');
  return state.preferences;
}

function button(root: HTMLElement, selector: string): HTMLButtonElement {
  const found = root.querySelector<HTMLButtonElement>(selector);
  assert.ok(found, `Expected button ${selector}`);
  return found;
}

test('theme choices include all 32 palettes plus system and persist independently of task data', async () => {
  const app = harness();
  await app.controller.initialize();
  const { dom, root } = domRoot();
  const screen = mount(root, app.controller);
  try {
    root.querySelector<HTMLButtonElement>('[data-tab="Themes"]')!.click();
    const radios = [...root.querySelectorAll<HTMLButtonElement>('[role="radio"][data-theme-id]')];
    const group = root.querySelector<HTMLElement>('.tasks-theme-panel');
    const grid = root.querySelector<HTMLElement>('.tasks-theme-grid');
    const system = root.querySelector<HTMLButtonElement>('[data-theme-id="system"]');
    assert.equal(themes.length, 32);
    assert.equal(radios.length, 33);
    assert.equal(root.querySelectorAll('[role="radiogroup"]').length, 1);
    assert.ok(group?.contains(system));
    assert.ok(system?.closest('.tasks-theme-heading'));
    assert.equal(system?.closest('.tasks-theme-grid'), null);
    assert.deepEqual([...grid!.querySelectorAll<HTMLButtonElement>('[role="radio"][data-theme-id]')].map(radio => radio.dataset.themeId), themes.map(theme => theme.id));
    assert.equal(radios.filter(radio => radio.tabIndex === 0).length, 1);
    assert.equal(system?.getAttribute('aria-checked'), 'true');
    assert.equal(system?.tabIndex, 0);
    const taskWrites = app.calls.taskSaves;
    const chosen = themes.find(theme => theme.id === 'banana-dark')!;
    root.querySelector<HTMLButtonElement>(`[data-theme-id="${chosen.id}"]`)!.click();
    await until(() => readyPreferences(app.controller).appearanceTheme === chosen.id, 'Theme preference was not saved.');
    assert.equal(app.calls.preferenceSaves.at(-1)?.appearanceTheme, chosen.id);
    assert.equal(app.calls.taskSaves, taskWrites, 'theme changes use the preferences port, not task persistence');
    const state = app.controller.getState();
    assert.equal(state.kind === 'ready' ? state.document.tasks.length : -1, 0);
  } finally {
    screen.dispose(); app.controller.dispose(); dom.window.close();
  }
});

test('theme radio grid supports keyboard selection and preserves its single tab stop', async () => {
  const app = harness();
  await app.controller.initialize();
  const { dom, root } = domRoot();
  const screen = mount(root, app.controller);
  try {
    root.querySelector<HTMLButtonElement>('[data-tab="Themes"]')!.click();
    const system = root.querySelector<HTMLButtonElement>(`[data-theme-id="${SYSTEM_THEME}"]`)!;
    system.focus();
    system.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    await until(() => readyPreferences(app.controller).appearanceTheme === themes[0].id, 'Arrow key did not select the first catalog theme.');
    assert.equal(dom.window.document.activeElement?.getAttribute('data-theme-id'), themes[0].id);
    const first = root.querySelector<HTMLButtonElement>(`[data-theme-id="${themes[0].id}"]`)!;
    first.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    await until(() => readyPreferences(app.controller).appearanceTheme === null, 'Arrow up did not return to Follow macOS.');
    assert.equal(dom.window.document.activeElement?.getAttribute('data-theme-id'), SYSTEM_THEME);
    root.querySelector<HTMLButtonElement>(`[data-theme-id="${SYSTEM_THEME}"]`)!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    await until(() => readyPreferences(app.controller).appearanceTheme === themes.at(-1)?.id, 'End did not move selection to the last theme.');
    const last = root.querySelector<HTMLButtonElement>(`[data-theme-id="${themes.at(-1)?.id}"]`)!;
    last.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    await until(() => readyPreferences(app.controller).appearanceTheme === null, 'Home did not move selection to Follow macOS.');
    assert.equal(dom.window.document.activeElement?.getAttribute('data-theme-id'), SYSTEM_THEME);
    assert.equal([...root.querySelectorAll<HTMLButtonElement>('[role="radio"][data-theme-id]')].filter(radio => radio.tabIndex === 0).length, 1);
  } finally {
    screen.dispose(); app.controller.dispose(); dom.window.close();
  }
});

test('preview integrations are honestly native-only and make no account or permission attempts', async () => {
  const app = harness();
  await app.controller.initialize();
  const { dom, root } = domRoot();
  const screen = mount(root, app.controller, 'preview');
  try {
    root.querySelector<HTMLButtonElement>('[data-tab="Connections"]')!.click();
    await settle();
    assert.equal(root.querySelector('[data-token-field]'), null);
    assert.equal(root.querySelector('[data-action="calendar-access"]'), null);
    assert.equal(root.querySelector('[data-action="load-projects"]'), null);
    assert.equal(root.querySelector('[data-action="refresh-todoist"]'), null);
    assert.match(root.textContent ?? '', /Browser preview cannot connect accounts/);
    assert.match(root.textContent ?? '', /Calendar permission is available only in the native macOS app/);
    assert.equal(app.calls.tokens.length, 0);
    assert.equal(app.calls.projectLoads, 0);
    assert.equal(app.calls.refreshes, 0);
    assert.equal(app.calls.calendarRequests, 0);
  } finally {
    screen.dispose(); app.controller.dispose(); dom.window.close();
  }
});

test('Todoist token is sent once, cleared on submit, never enters facade state, and draft/focus survive unrelated publications', async () => {
  const app = harness();
  await app.controller.initialize();
  const { dom, root } = domRoot();
  const screen = mount(root, app.controller);
  try {
    root.querySelector<HTMLButtonElement>('[data-tab="Connections"]')!.click();
    const input = root.querySelector<HTMLInputElement>('[data-token-field]')!;
    assert.equal(input.type, 'password');
    assert.equal(input.autocomplete, 'off');
    const token = 'synthetic-token-not-a-real-credential';
    input.focus(); input.value = token;
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    input.setSelectionRange(8, 8);
    const created = await app.controller.create({ title: 'Local task' });
    assert.equal(created.kind, 'applied');
    const restored = root.querySelector<HTMLInputElement>('[data-token-field]')!;
    assert.equal(restored.value, token);
    assert.equal(dom.window.document.activeElement, restored);
    assert.equal(restored.selectionStart, 8);

    button(root, '[data-focus-key="todoist-connect"]').click();
    await until(() => app.calls.tokens.length === 1, 'Todoist connect command was not called.');
    await until(() => root.querySelector('[data-token-field]') === null, 'Connected form remained visible after connection.');
    assert.deepEqual(app.calls.tokens, [token]);
    assert.equal(JSON.stringify(app.controller.getState()).includes(token), false);
    assert.equal(root.textContent?.includes(token), false);
    assert.equal(root.querySelector<HTMLInputElement>('[data-token-field]')?.value ?? '', '');
    assert.equal(app.getPreferences().appearanceTheme, null);
    assert.equal(app.calls.preferenceSaves.some(preferences => JSON.stringify(preferences).includes(token)), false);
    assert.equal(JSON.stringify(app.getStored()).includes(token), false);
    assert.equal(dom.window.localStorage.length, 0);
  } finally {
    screen.dispose(); app.controller.dispose(); dom.window.close();
  }
});

test('native Todoist flow loads/selects a project, refreshes manually, and disconnect keeps local tasks', async () => {
  const app = harness();
  await app.controller.initialize();
  const local = await app.controller.create({ title: 'Keep this local' });
  assert.equal(local.kind, 'applied');
  const { dom, root } = domRoot();
  const screen = mount(root, app.controller);
  try {
    root.querySelector<HTMLButtonElement>('[data-tab="Connections"]')!.click();
    const input = root.querySelector<HTMLInputElement>('[data-token-field]')!;
    input.value = 'synthetic-token';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    button(root, '[data-focus-key="todoist-connect"]').click();
    await until(() => {
      const state = app.controller.getState();
      return state.kind === 'ready' && state.todoistConnection.kind === 'connected';
    }, 'Todoist did not connect.');
    button(root, '[data-action="load-projects"]').click();
    await until(() => app.calls.projectLoads === 1, 'Project list was not loaded.');
    const projectSelect = root.querySelector<HTMLSelectElement>('[data-project-select]')!;
    projectSelect.value = 'project-A';
    projectSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await until(() => {
      const state = app.controller.getState();
      return state.kind === 'ready' && state.todoistConnection.kind === 'connected' && state.todoistConnection.projectID === 'project-A';
    }, 'Capture project was not selected.');
    button(root, '[data-action="refresh-todoist"]').click();
    await until(() => app.calls.refreshes === 1, 'Manual refresh did not run.');
    button(root, '[data-action="disconnect-todoist"]').click();
    await until(() => app.calls.disconnects === 1, 'Disconnect did not run.');
    assert.deepEqual(app.controller.queryTasks({ mode: 'active' }).tasks.map(task => task.title), ['Keep this local']);
    assert.equal(app.calls.selectedProjects[0], 'project-A');
    assert.equal(root.querySelector('[role="switch"]'), null, 'there is no independent Todoist writeback toggle');
  } finally {
    screen.dispose(); app.controller.dispose(); dom.window.close();
  }
});

test('failed preference save leaves the confirmed theme selected', async () => {
  const app = harness({ failPreferences: candidate => candidate.appearanceTheme === 'banana-dark' });
  await app.controller.initialize();
  const { dom, root } = domRoot();
  const screen = mount(root, app.controller);
  try {
    root.querySelector<HTMLButtonElement>('[data-tab="Themes"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-theme-id="banana-dark"]')!.click();
    await until(() => {
      const state = app.controller.getState();
      return state.kind === 'ready' && state.preferencesError !== null;
    }, 'Preference failure was not published.');
    assert.equal(readyPreferences(app.controller).appearanceTheme, null);
    assert.equal(root.querySelector('[data-theme-id="system"]')?.getAttribute('aria-checked'), 'true');
    assert.equal(root.querySelector('[data-theme-id="banana-dark"]')?.getAttribute('aria-checked'), 'false');
    assert.match(root.textContent ?? '', /last confirmed value remains selected/);
  } finally {
    screen.dispose(); app.controller.dispose(); dom.window.close();
  }
});

test('pin, sound, motion, and ripening controls save and show confirmed facade values', async () => {
  const app = harness();
  await app.controller.initialize();
  const { dom, root } = domRoot();
  const screen = mount(root, app.controller);
  try {
    root.querySelector<HTMLButtonElement>('[data-tab="General"]')!.click();
    root.querySelector<HTMLInputElement>('[data-preference="pinned"]')!.click();
    await until(() => readyPreferences(app.controller).pinned, 'Pin preference was not saved.');
    root.querySelector<HTMLInputElement>('[data-preference-radio="ripeningSpeed"][value="lively"]')!.click();
    await until(() => readyPreferences(app.controller).ripeningSpeed === 'lively', 'Ripening pace was not saved.');
    root.querySelector<HTMLButtonElement>('[data-tab="Sound & motion"]')!.click();
    root.querySelector<HTMLInputElement>('[data-preference-radio="motionEnabled"][value="reduce"]')!.click();
    await until(() => readyPreferences(app.controller).motionEnabled === false, 'Motion preference was not saved.');
    root.querySelector<HTMLButtonElement>('[data-preference="soundEnabled"]')!.click();
    await until(() => readyPreferences(app.controller).soundEnabled, 'Sound preference was not saved.');
    assert.equal(root.querySelector('[data-preference-radio="motionEnabled"][value="reduce"]')?.getAttribute('checked'), '');
    assert.equal(root.querySelector('[data-preference="soundEnabled"]')?.getAttribute('aria-checked'), 'true');
  } finally {
    screen.dispose(); app.controller.dispose(); dom.window.close();
  }
});

test('sound stays off on mount and loads a one-shot preview only after explicit press', async () => {
  const originalAudioContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  let contextsCreated = 0;
  let tonesStarted = 0;
  let contextsClosed = 0;
  let signalAudioClosed: () => void = () => {};
  const audioClosed = new Promise<void>(resolve => { signalAudioClosed = resolve; });
  const FakeAudioContext = class {
    state: AudioContextState = 'running';
    currentTime = 0;
    destination = {} as AudioDestinationNode;
    constructor() { contextsCreated++; }
    createOscillator() {
      return {
        type: 'sine' as OscillatorType,
        frequency: { setValueAtTime: () => undefined },
        connect: () => undefined,
        start: () => { tonesStarted++; },
        stop: () => undefined,
      } as unknown as OscillatorNode;
    }
    createGain() {
      return {
        gain: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined },
        connect: () => undefined,
      } as unknown as GainNode;
    }
    async close(): Promise<void> { contextsClosed++; this.state = 'closed'; signalAudioClosed(); }
    async resume(): Promise<void> { this.state = 'running'; }
  };
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, writable: true, value: FakeAudioContext });
  const app = harness();
  await app.controller.initialize();
  const { dom, root } = domRoot();
  const screen = mount(root, app.controller);
  try {
    root.querySelector<HTMLButtonElement>('[data-tab="Sound & motion"]')!.click();
    assert.equal(readyPreferences(app.controller).soundEnabled, false);
    assert.equal(root.querySelector('[role="switch"]')?.getAttribute('aria-checked'), 'false');
    await settle();
    assert.equal(contextsCreated, 0, 'mounting settings does not open an audio context');
    button(root, '[data-action="preview-sound"]').click();
    await until(() => contextsCreated === 1, 'Explicit preview did not initialize local audio.');
    await audioClosed;
    await until(() => screen.notices.some(notice => notice.message === 'Chime preview played.'), 'Preview did not report completion.');
    assert.equal(tonesStarted, 2);
    assert.equal(contextsClosed, 1);
    assert.equal(readyPreferences(app.controller).soundEnabled, false);
  } finally {
    screen.dispose(); app.controller.dispose(); dom.window.close();
    if (originalAudioContext) Object.defineProperty(globalThis, 'AudioContext', originalAudioContext);
    else Reflect.deleteProperty(globalThis, 'AudioContext');
  }
});

test('Calendar permission is requested only by an explicit native action and denial is described', async () => {
  const app = harness({ calendarResult: 'denied' });
  await app.controller.initialize();
  const { dom, root } = domRoot();
  const screen = mount(root, app.controller);
  try {
    root.querySelector<HTMLButtonElement>('[data-tab="Connections"]')!.click();
    assert.equal(app.calls.calendarRequests, 0);
    assert.match(root.textContent ?? '', /calendars already connected to macOS Calendar/);
    button(root, '[data-action="calendar-access"]').click();
    await until(() => app.calls.calendarRequests === 1, 'Calendar access was not requested.');
    await until(() => root.textContent?.includes('Access denied') ?? false, 'Denied Calendar access was not rendered.');
    assert.match(root.textContent ?? '', /System Settings/);
    assert.equal(app.calls.calendarRequests, 1);
  } finally {
    screen.dispose(); app.controller.dispose(); dom.window.close();
  }
});

test('dispose removes facade subscription and DOM listeners', async () => {
  const app = harness();
  await app.controller.initialize();
  const { dom, root } = domRoot();
  let unsubscribeCount = 0;
  const subscribe = app.controller.subscribe.bind(app.controller);
  app.controller.subscribe = ((listener: (state: ReturnType<typeof app.controller.getState>) => void) => {
    const unsubscribe = subscribe(listener);
    return () => { unsubscribeCount++; unsubscribe(); };
  }) as typeof app.controller.subscribe;
  const mounted = mount(root, app.controller);
  const closeButton = button(root, '[data-action="close"]');
  mounted.dispose();
  root.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  closeButton.click();
  assert.equal(unsubscribeCount, 1);
  assert.equal(mounted.closed(), 0);
  assert.equal(root.childElementCount, 0);
  app.controller.dispose(); dom.window.close();
});
