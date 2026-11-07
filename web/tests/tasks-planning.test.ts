import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';
import type { TasksFacade, TasksState, CommandOutcome } from '../src/tasks/application/controller';
import { DEFAULT_TASKS_PREFERENCES } from '../src/tasks/application/controller';
import type { CalendarAppointment, CalendarAuthorization, CalendarBlockReceipt, PlanningCalendar } from '../src/tasks/application/ports';
import type { TaskReadModel } from '../src/tasks/domain/queries';
import type { TasksScreenOptions } from '../src/tasks/ui/contracts';

registerHooks({
  load(url, context, nextLoad) {
    if (new URL(url).pathname.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { mountTasksPlanning } = await import('../src/tasks/ui/planning');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

function task(id: string, title = `Task ${id}`, status: TaskReadModel['status'] = { kind: 'active' }): TaskReadModel {
  return {
    id, title, notes: '', tags: [], priority: 'normal', status, createdAt: 1, rawAgeMs: 10, inactivityMs: 10,
    totalInvestedMs: 0, lastProgressAt: null, ripeness: 'fresh', imported: false,
  };
}

function appointment(id: string, title: string, start: number, end: number, allDay = false): CalendarAppointment {
  return { id, title, start, end, allDay };
}

const writableCalendar: PlanningCalendar = { id: 'calendar-write', title: 'Work', sourceTitle: 'Local', writable: true };
const readOnlyCalendar: PlanningCalendar = { id: 'calendar-readonly', title: 'Shared', sourceTitle: 'Subscribed', writable: false };

function readyState(authorization: CalendarAuthorization = 'notDetermined', calendars: PlanningCalendar[] = [], appointments: CalendarAppointment[] = []): TasksState {
  return {
    kind: 'ready', document: { version: 1, tasks: [], runningSession: null, todoistOutbox: [] }, revision: 'r1',
    preferences: { ...DEFAULT_TASKS_PREFERENCES }, persistenceError: null, preferencesError: null, fault: null,
    todoistConnection: { kind: 'disconnected' }, captureProjects: [], calendar: { authorization, calendars, appointments },
  };
}

type HarnessOptions = {
  environment?: 'native' | 'preview';
  authorization?: CalendarAuthorization;
  tasks?: TaskReadModel[];
  calendars?: PlanningCalendar[];
  events?: CalendarAppointment[];
  loadCalendar?: (start: number, end: number, invocation: number) => Promise<CommandOutcome<{ calendars: PlanningCalendar[]; appointments: CalendarAppointment[] }>>;
  requestAccess?: () => Promise<CommandOutcome<CalendarAuthorization>>;
  schedule?: (taskID: string, calendarID: string, start: number, end: number) => Promise<CommandOutcome<CalendarBlockReceipt>>;
};

function harness(config: HarnessOptions = {}) {
  const dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>', {
    url: 'https://planning.test', pretendToBeVisual: true,
  });
  const root = dom.window.document.querySelector<HTMLElement>('#root')!;
  const listeners = new Set<(state: TasksState) => void>();
  const initialAuth = config.authorization ?? 'notDetermined';
  let authorization = initialAuth;
  let calendars = config.calendars ?? (initialAuth === 'authorized' ? [writableCalendar, readOnlyCalendar] : []);
  let state = readyState(authorization, calendars, config.events ?? []);
  const calls = {
    loads: [] as Array<{ start: number; end: number }>,
    requests: 0,
    schedules: [] as Array<{ taskID: string; calendarID: string; start: number; end: number }>,
    notifications: [] as Array<{ message: string; kind: 'status' | 'error' }>,
    closes: 0,
  };
  const facade = {
    getState: () => state,
    subscribe: (listener: (value: TasksState) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    queryTasks: (query: { mode: string }) => {
      assert.equal(query.mode, 'active');
      const all = config.tasks ?? [task('task-1', 'Write the outline')];
      return { mode: 'active', tasks: all, groups: null };
    },
    loadCalendar: async (start: number, end: number) => {
      const invocation = calls.loads.length;
      calls.loads.push({ start, end });
      if (config.loadCalendar) return config.loadCalendar(start, end, invocation);
      const appointments = config.events ?? [];
      state = readyState(authorization, calendars, appointments);
      return { kind: 'applied', value: { calendars, appointments } } as const;
    },
    requestCalendarAccess: async () => {
      calls.requests++;
      if (config.requestAccess) return config.requestAccess();
      authorization = 'authorized';
      calendars = config.calendars ?? [writableCalendar];
      state = readyState(authorization, calendars, config.events ?? []);
      for (const listener of listeners) listener(state);
      return { kind: 'applied', value: 'authorized' } as const;
    },
    scheduleTask: async (taskID: string, calendarID: string, start: number, end: number) => {
      calls.schedules.push({ taskID, calendarID, start, end });
      if (config.schedule) return config.schedule(taskID, calendarID, start, end);
      return { kind: 'applied', value: { id: `receipt-${calls.schedules.length}`, start, end, calendarID } } as const;
    },
  } as unknown as TasksFacade;
  const options: TasksScreenOptions = {
    environment: config.environment ?? 'native',
    onClose: () => { calls.closes++; },
    notify: (message, kind = 'status') => calls.notifications.push({ message, kind }),
  };
  const mounted = mountTasksPlanning(root, facade, options);
  return { dom, root, facade, calls, mounted, state: () => state, setState(value: TasksState) { state = value; for (const listener of listeners) listener(state); } };
}

function click(dom: JSDOM, element: Element): void {
  element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
}
function submit(dom: JSDOM, form: HTMLFormElement): void {
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
}
function setInput(dom: JSDOM, selector: string, value: string, event = 'input'): HTMLInputElement {
  const input = dom.window.document.querySelector<HTMLInputElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new dom.window.Event(event, { bubbles: true }));
  return input;
}
async function settle(): Promise<void> { await new Promise(resolve => setTimeout(resolve, 0)); }
function tomorrowDateValue(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
test('Done and Escape close planning, the toolbar exposes its drag region, and disposal removes close handlers', () => {
  const instance = harness();
  const dragRegion = instance.root.querySelector<HTMLElement>('[data-tasks-drag-region]');
  assert.ok(dragRegion);
  assert.equal(dragRegion.getAttribute('data-tasks-drag-region'), 'true');

  const doneButton = instance.root.querySelector<HTMLButtonElement>('.planning-done-button')!;
  assert.equal(doneButton.textContent, 'Done');
  click(instance.dom, doneButton);
  assert.equal(instance.calls.closes, 1);

  const escape = new instance.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  instance.root.dispatchEvent(escape);
  assert.equal(instance.calls.closes, 2);
  assert.equal(escape.defaultPrevented, true);

  const alreadyHandled = new instance.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  alreadyHandled.preventDefault();
  instance.root.dispatchEvent(alreadyHandled);
  assert.equal(instance.calls.closes, 2, 'an earlier Escape handler can prevent closing');

  instance.mounted.dispose();
  click(instance.dom, doneButton);
  instance.root.dispatchEvent(new instance.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(instance.calls.closes, 2, 'disposed screens no longer react to close controls');
  instance.dom.window.close();
});

async function fillValidBlockForm(instance: ReturnType<typeof harness>): Promise<void> {
  const { dom } = instance;
  const taskSelect = dom.window.document.querySelector<HTMLSelectElement>('[aria-label="Task"]')!;
  taskSelect.value = 'task-1';
  taskSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  const calendarSelect = dom.window.document.querySelector<HTMLSelectElement>('[aria-label="Writable calendar"]')!;
  calendarSelect.value = 'calendar-write';
  calendarSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  setInput(dom, '[aria-label="Selected day"]', tomorrowDateValue(), 'change');
  await settle();
  setInput(dom, '[aria-label="Start time (local)"]', '10:00');
  setInput(dom, '[aria-label="Duration in minutes"]', '25');
}

test('browser preview and denied access stay honest; permission requests require an explicit action', async () => {
  const preview = harness({
    environment: 'preview', authorization: 'authorized', calendars: [writableCalendar],
    events: [appointment('preview-only', 'Preview-only fixture', Date.now(), Date.now() + 1_000)],
  });
  assert.equal(preview.root.querySelector<HTMLButtonElement>('.planning-access-button')?.hidden, true);
  await settle();
  assert.match(preview.root.textContent ?? '', /unavailable in browser preview/i);
  assert.doesNotMatch(preview.root.textContent ?? '', /Preview-only fixture|sample data/i);
  assert.equal(preview.calls.requests, 0);
  assert.equal(preview.calls.schedules.length, 0);
  assert.equal(preview.root.querySelector<HTMLButtonElement>('.planning-primary-button')?.disabled, true);
  preview.mounted.dispose();
  preview.dom.window.close();

  const denied = harness({ authorization: 'denied' });
  await settle();
  assert.match(denied.root.textContent ?? '', /access is denied/i);
  assert.equal(denied.root.querySelector<HTMLButtonElement>('.planning-access-button')?.hidden, true);
  assert.equal(denied.root.querySelector<HTMLButtonElement>('.planning-primary-button')?.disabled, true);
  denied.mounted.dispose();
  denied.dom.window.close();

  const undecided = harness({ authorization: 'notDetermined' });
  await settle();
  assert.equal(undecided.calls.requests, 0, 'mount and day reads never request permission');
  click(undecided.dom, undecided.root.querySelector('.planning-access-button')!);
  await settle();
  assert.equal(undecided.calls.requests, 1, 'only the explicit permission button requests access');
  assert.match(undecided.root.textContent ?? '', /Appointments are shown in your local time zone/);
  undecided.mounted.dispose();
  undecided.dom.window.close();
});

test('day navigation and calendar choice are reads/local drafts, not writes', async () => {
  const instance = harness({ authorization: 'authorized', calendars: [writableCalendar, readOnlyCalendar] });
  await settle();
  const initialReads = instance.calls.loads.length;
  click(instance.dom, instance.root.querySelector('[aria-label="Next day"]')!);
  await settle();
  assert.ok(instance.calls.loads.length > initialReads);
  const calendarSelect = instance.root.querySelector<HTMLSelectElement>('[aria-label="Writable calendar"]')!;
  assert.deepEqual([...calendarSelect.options].map(option => option.value), ['', 'calendar-write']);
  calendarSelect.value = 'calendar-write';
  calendarSelect.dispatchEvent(new instance.dom.window.Event('change', { bubbles: true }));
  assert.equal(instance.calls.schedules.length, 0);
  assert.equal(instance.calls.requests, 0);
  instance.mounted.dispose();
  instance.dom.window.close();
});

test('calendar day ranges use local midnight and remain DST-safe', async () => {
  const previousZone = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    const instance = harness({ authorization: 'authorized', calendars: [writableCalendar] });
    setInput(instance.dom, '[aria-label="Selected day"]', '2025-03-09', 'change');
    await settle();
    const range = instance.calls.loads.at(-1)!;
    assert.equal(new Date(range.start).getFullYear(), 2025);
    assert.equal(new Date(range.start).getMonth(), 2);
    assert.equal(new Date(range.start).getDate(), 9);
    assert.equal(new Date(range.start).getHours(), 0);
    assert.equal(new Date(range.end).getDate(), 10);
    assert.equal(range.end - range.start, 23 * 60 * 60 * 1000, 'spring-forward day is 23 hours, not a fixed 24-hour duration');
    instance.mounted.dispose();
    instance.dom.window.close();
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
});

test('appointments clearly label all-day and cross-midnight ranges in local time', async () => {
  const previousZone = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    const previousEvening = new Date(2025, 5, 9, 23, 30).getTime();
    const nextMorning = new Date(2025, 5, 10, 1, 0).getTime();
    const allDayStart = new Date(2025, 5, 9, 0, 0).getTime();
    const allDayEnd = new Date(2025, 5, 12, 0, 0).getTime();
    const instance = harness({ authorization: 'authorized', calendars: [writableCalendar], events: [
      appointment('overnight', 'Overnight event', previousEvening, nextMorning),
      appointment('all-day', 'Multi-day event', allDayStart, allDayEnd, true),
    ] });
    setInput(instance.dom, '[aria-label="Selected day"]', '2025-06-10', 'change');
    await settle();
    assert.match(instance.root.textContent ?? '', /Overnight event/);
    assert.match(instance.root.textContent ?? '', /Continues from the previous day · Ends at 1:00 AM/);
    assert.match(instance.root.textContent ?? '', /All day/);
    assert.match(instance.root.textContent ?? '', /Continues into the next day/);
    instance.mounted.dispose();
    instance.dom.window.close();
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
});

test('late day responses cannot replace appointments for the currently selected day', async () => {
  const first = deferred<CommandOutcome<{ calendars: PlanningCalendar[]; appointments: CalendarAppointment[] }>>();
  const second = deferred<CommandOutcome<{ calendars: PlanningCalendar[]; appointments: CalendarAppointment[] }>>();
  const instance = harness({
    authorization: 'authorized', calendars: [writableCalendar],
    loadCalendar: (_start, _end, invocation) => invocation === 0 ? first.promise : second.promise,
  });
  const dateInput = instance.root.querySelector<HTMLInputElement>('[aria-label="Selected day"]')!;
  const tomorrow = tomorrowDateValue();
  dateInput.value = tomorrow;
  dateInput.dispatchEvent(new instance.dom.window.Event('change', { bubbles: true }));
  const selectedDate = new Date(`${tomorrow}T12:00:00`);
  const selectedEvent = appointment('selected', 'Current day appointment', selectedDate.getTime(), selectedDate.getTime() + 30 * 60_000);
  second.resolve({ kind: 'applied', value: { calendars: [writableCalendar], appointments: [selectedEvent] } });
  await settle();
  assert.match(instance.root.textContent ?? '', /Current day appointment/);
  const staleDate = new Date(`${tomorrow}T12:00:00`);
  staleDate.setDate(staleDate.getDate() - 1);
  first.resolve({ kind: 'applied', value: { calendars: [writableCalendar], appointments: [appointment('stale', 'Stale day appointment', staleDate.getTime(), staleDate.getTime() + 30 * 60_000)] } });
  await settle();
  assert.match(instance.root.textContent ?? '', /Current day appointment/);
  assert.doesNotMatch(instance.root.textContent ?? '', /Stale day appointment/);
  instance.mounted.dispose();
  instance.dom.window.close();
});

test('only active tasks and confirmed writable calendars can be selected', async () => {
  const instance = harness({
    authorization: 'authorized', calendars: [writableCalendar, readOnlyCalendar],
    tasks: [task('task-1', 'Active task'), task('snoozed', 'Snoozed task', { kind: 'snoozed', until: Date.now() + 100_000 })],
  });
  await settle();
  const tasks = instance.root.querySelector<HTMLSelectElement>('[aria-label="Task"]')!;
  assert.deepEqual([...tasks.options].map(option => option.value), ['', 'task-1']);
  const calendars = instance.root.querySelector<HTMLSelectElement>('[aria-label="Writable calendar"]')!;
  assert.deepEqual([...calendars.options].map(option => option.value), ['', 'calendar-write']);
  tasks.value = 'task-1';
  tasks.dispatchEvent(new instance.dom.window.Event('change', { bubbles: true }));
  calendars.value = 'calendar-readonly';
  submit(instance.dom, instance.root.querySelector('form')!);
  await settle();
  assert.equal(instance.calls.schedules.length, 0);
  assert.match(instance.root.textContent ?? '', /Choose a writable calendar/);
  instance.mounted.dispose();
  instance.dom.window.close();
});

test('calendar loads and state changes preserve the selected task, calendar, and form drafts', async () => {
  const nextDay = deferred<CommandOutcome<{ calendars: PlanningCalendar[]; appointments: CalendarAppointment[] }>>();
  const instance = harness({
    authorization: 'authorized', calendars: [writableCalendar],
    loadCalendar: (_start, _end, invocation) => invocation === 0
      ? Promise.resolve({ kind: 'applied', value: { calendars: [writableCalendar], appointments: [] } })
      : invocation === 1 ? nextDay.promise
        : Promise.resolve({ kind: 'applied', value: { calendars: [readOnlyCalendar], appointments: [] } }),
  });
  await settle();
  const taskSelect = instance.root.querySelector<HTMLSelectElement>('[aria-label="Task"]')!;
  const calendarSelect = instance.root.querySelector<HTMLSelectElement>('[aria-label="Writable calendar"]')!;
  taskSelect.value = 'task-1';
  calendarSelect.value = 'calendar-write';
  setInput(instance.dom, '[aria-label="Start time (local)"]', '10:45');
  setInput(instance.dom, '[aria-label="Duration in minutes"]', '40');
  setInput(instance.dom, '[aria-label="Selected day"]', tomorrowDateValue(), 'change');
  instance.setState(readyState('authorized', [writableCalendar]));
  nextDay.resolve({ kind: 'applied', value: { calendars: [writableCalendar], appointments: [] } });
  await settle();
  assert.equal(taskSelect.value, 'task-1');
  assert.equal(calendarSelect.value, 'calendar-write');
  assert.equal(instance.root.querySelector<HTMLInputElement>('[aria-label="Start time (local)"]')?.value, '10:45');
  assert.equal(instance.root.querySelector<HTMLInputElement>('[aria-label="Duration in minutes"]')?.value, '40');
  click(instance.dom, instance.root.querySelector('.planning-reload-button')!);
  await settle();
  assert.equal(calendarSelect.value, '', 'a calendar selection is cleared when it is no longer writable');
  assert.equal(instance.root.querySelector<HTMLButtonElement>('.planning-primary-button')?.disabled, true);
  instance.mounted.dispose();
  instance.dom.window.close();
});

test('explicit submission schedules one future local block and confirms the actual receipt', async () => {
  const instance = harness({ authorization: 'authorized', calendars: [writableCalendar, readOnlyCalendar] });
  await settle();
  await fillValidBlockForm(instance);
  const selected = instance.root.querySelector<HTMLInputElement>('[aria-label="Selected day"]')!.value;
  const expectedStart = new Date(`${selected}T10:00:00`).getTime();
  submit(instance.dom, instance.root.querySelector('form')!);
  await settle();
  assert.deepEqual(instance.calls.schedules, [{ taskID: 'task-1', calendarID: 'calendar-write', start: expectedStart, end: expectedStart + 25 * 60_000 }]);
  assert.match(instance.root.textContent ?? '', /Task block created for Write the outline/);
  assert.match(instance.root.textContent ?? '', /Receipt receipt-1/);
  assert.match(instance.root.textContent ?? '', /Write the outline/);
  assert.match(instance.root.textContent ?? '', /Task block/);
  assert.equal(instance.calls.notifications.at(-1)?.kind, 'status');
  instance.mounted.dispose();
  instance.dom.window.close();
});

test('pending creation blocks duplicate effects; rejected outcomes never show success', async () => {
  const gate = deferred<CommandOutcome<CalendarBlockReceipt>>();
  const instance = harness({ authorization: 'authorized', calendars: [writableCalendar], schedule: () => gate.promise });
  await settle();
  await fillValidBlockForm(instance);
  const form = instance.root.querySelector('form')!;
  submit(instance.dom, form);
  submit(instance.dom, form);
  assert.equal(instance.calls.schedules.length, 1);
  assert.equal(instance.root.querySelector<HTMLButtonElement>('.planning-primary-button')?.disabled, true);
  gate.resolve({ kind: 'rejected', reason: 'invalid_calendar_range' });
  await settle();
  assert.equal(instance.calls.schedules.length, 1);
  assert.match(instance.root.querySelector('.planning-block-form .planning-inline-error')?.textContent ?? '', /future start/i);
  assert.equal(instance.root.querySelector('.planning-confirmation')?.textContent, '');
  assert.equal(instance.calls.notifications.at(-1)?.kind, 'error');
  instance.mounted.dispose();
  instance.dom.window.close();
});

test('future validation and DST gaps reject invalid local starts before any calendar write', async () => {
  const previousZone = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    const instance = harness({ authorization: 'authorized', calendars: [writableCalendar] });
    await settle();
    const date = instance.root.querySelector<HTMLInputElement>('[aria-label="Selected day"]')!;
    date.value = '2025-03-09';
    date.dispatchEvent(new instance.dom.window.Event('change', { bubbles: true }));
    await settle();
    const taskSelect = instance.root.querySelector<HTMLSelectElement>('[aria-label="Task"]')!;
    taskSelect.value = 'task-1';
    const calendarSelect = instance.root.querySelector<HTMLSelectElement>('[aria-label="Writable calendar"]')!;
    calendarSelect.value = 'calendar-write';
    setInput(instance.dom, '[aria-label="Start time (local)"]', '02:30');
    setInput(instance.dom, '[aria-label="Duration in minutes"]', '25');
    submit(instance.dom, instance.root.querySelector('form')!);
    await settle();
    assert.equal(instance.calls.schedules.length, 0);
    assert.match(instance.root.textContent ?? '', /does not exist on this date/i);
    instance.mounted.dispose();
    instance.dom.window.close();
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
});

test('past local start times are rejected before calendar writes', async () => {
  const instance = harness({ authorization: 'authorized', calendars: [writableCalendar] });
  await settle();
  await fillValidBlockForm(instance);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayValue = `${String(yesterday.getFullYear()).padStart(4, '0')}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  setInput(instance.dom, '[aria-label="Selected day"]', yesterdayValue, 'change');
  await settle();
  setInput(instance.dom, '[aria-label="Start time (local)"]', '10:00');
  submit(instance.dom, instance.root.querySelector('form')!);
  await settle();
  assert.equal(instance.calls.schedules.length, 0);
  assert.match(instance.root.querySelector('.planning-block-form .planning-inline-error')?.textContent ?? '', /future start/i);
  instance.mounted.dispose();
  instance.dom.window.close();
});

test('a duration beyond twelve hours is rejected before calendar writes', async () => {
  const instance = harness({ authorization: 'authorized', calendars: [writableCalendar] });
  await settle();
  await fillValidBlockForm(instance);
  setInput(instance.dom, '[aria-label="Duration in minutes"]', '721');
  submit(instance.dom, instance.root.querySelector('form')!);
  await settle();
  assert.equal(instance.calls.schedules.length, 0);
  assert.match(instance.root.querySelector('.planning-block-form .planning-inline-error')?.textContent ?? '', /1 to 720 minutes/);
  instance.mounted.dispose();
  instance.dom.window.close();
});

test('untrusted appointment and task titles are rendered as text', async () => {
  const hostileTitle = '<img src=x onerror=alert(1)>';
  const instance = harness({ authorization: 'authorized', calendars: [writableCalendar], tasks: [task('task-1', hostileTitle)], events: [appointment('hostile', hostileTitle, Date.now(), Date.now() + 10_000)] });
  await settle();
  assert.equal(instance.root.querySelector('img:not(.planning-logo)'), null);
  assert.equal(instance.root.textContent?.match(/<img src=x onerror=alert\(1\)>/g)?.length, 3);
  instance.mounted.dispose();
  instance.dom.window.close();
});

test('disposal prevents late calendar results from touching the mounted root', async () => {
  const gate = deferred<CommandOutcome<{ calendars: PlanningCalendar[]; appointments: CalendarAppointment[] }>>();
  const instance = harness({ authorization: 'authorized', loadCalendar: () => gate.promise });
  const root = instance.root;
  instance.mounted.dispose();
  assert.equal(root.childElementCount, 0);
  gate.resolve({ kind: 'applied', value: { calendars: [writableCalendar], appointments: [appointment('late', 'Late response', Date.now(), Date.now() + 1_000)] } });
  await settle();
  assert.equal(root.childElementCount, 0);
  assert.equal(instance.calls.notifications.length, 0);
  instance.dom.window.close();
});

test('disposal ignores a pending block receipt without updating DOM or notifying', async () => {
  const gate = deferred<CommandOutcome<CalendarBlockReceipt>>();
  const instance = harness({ authorization: 'authorized', calendars: [writableCalendar], schedule: () => gate.promise });
  await settle();
  await fillValidBlockForm(instance);
  submit(instance.dom, instance.root.querySelector('form')!);
  assert.equal(instance.calls.schedules.length, 1);
  instance.mounted.dispose();
  gate.resolve({ kind: 'applied', value: { id: 'late-receipt', start: Date.now(), end: Date.now() + 25 * 60_000, calendarID: 'calendar-write' } });
  await settle();
  assert.equal(instance.root.childElementCount, 0);
  assert.equal(instance.calls.notifications.length, 0);
  instance.dom.window.close();
});
