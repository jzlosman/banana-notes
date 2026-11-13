import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TasksController, DEFAULT_TASKS_PREFERENCES } from '../src/tasks/application/controller';
import type {
  CalendarAppointment, CalendarAuthorization, CalendarBlockDraft, CalendarPort, CaptureProject, CapturedTask, Clock, IdentitySource, PlanningCalendar,
  TasksPorts, TasksPreferences, TasksPreferencesPort, TasksWindowEvent, TasksWindowPort, TaskStore, TodoistConnection, TodoistPort,
} from '../src/tasks/application/ports';
import type { Task, TaskDocument } from '../src/tasks/domain/model';

function documentOf(controller: TasksController): TaskDocument {
  const state = controller.getState();
  if (state.kind !== 'ready') throw new Error('Tasks did not initialize.');
  return state.document;
}
function importedTask(id: string, source: { accountID: string; projectID: string; taskID: string }): Task {
  return { id, title: id, notes: '', tags: [], priority: 'normal', status: { kind: 'active' }, createdAt: 10, updatedAt: 10,
    lastProgressAt: null, activities: [{ kind: 'created', at: 10 }], work: [], importedFrom: source, locallyEdited: false };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
function harness(options: {
  connection?: TodoistConnection; captures?: unknown[]; initialDocument?: TaskDocument;
  load?: TaskStore['load'];
  save?: (expected: string, document: TaskDocument) => Promise<{ kind: 'saved'; revision: string } | { kind: 'conflict' }>;
  todoist?: Partial<TodoistPort>; calendar?: Partial<CalendarPort>;
} = {}) {
  let now = 1_000;
  let id = 0;
  let revision = 'r0';
  let stored: TaskDocument | null = options.initialDocument ?? null;
  let currentConnection = options.connection ?? { kind: 'disconnected' as const };
  let captures = options.captures ?? [];
  let calendarAuthorization: CalendarAuthorization = 'unavailable';
  let calendarList: PlanningCalendar[] = [];
  let appointments: CalendarAppointment[] = [];
  const blocks: CalendarBlockDraft[] = [];
  const writes: Array<{ accountID: string; taskID: string; completed: boolean; operationID: string }> = [];
  const saveCalls: Array<{ expected: string; document: TaskDocument }> = [];
  const listeners = new Set<(event: TasksWindowEvent) => void>();
  const store: TaskStore = {
    load: options.load ?? (async () => ({ kind: 'ready', document: stored, revision })),
    save: async (expected, document) => {
      saveCalls.push({ expected, document });
      if (options.save) {
        const result = await options.save(expected, document);
        if (result.kind === 'saved') { revision = result.revision; stored = document; }
        return result;
      }
      if (expected !== revision) return { kind: 'conflict' };
      revision = `r${Number(revision.slice(1)) + 1}`;
      stored = document;
      return { kind: 'saved', revision };
    },
  };
  const preferences: TasksPreferencesPort = {
    load: async () => ({ ...DEFAULT_TASKS_PREFERENCES }),
    save: async (candidate: TasksPreferences) => ({ ...candidate }),
  };
  const todoist: TodoistPort = {
    connection: async () => currentConnection,
    connect: async (_token: string) => {
      currentConnection = { kind: 'connected', accountID: 'acct-A', projectID: null };
      return { connection: currentConnection, projects: [{ id: 'project-A', name: 'Selected' }] };
    },
    disconnect: async () => { currentConnection = { kind: 'disconnected' }; },
    projects: async (): Promise<CaptureProject[]> => [{ id: 'project-A', name: 'Selected' }],
    selectProject: async projectID => {
      if (currentConnection.kind !== 'connected') throw new Error('not connected');
      currentConnection = { ...currentConnection, projectID };
      return currentConnection;
    },
    captures: async () => captures as never,
    setCompleted: async (source, completed, operationID) => { writes.push({ accountID: source.accountID, taskID: source.taskID, completed, operationID }); },
    ...options.todoist,
  };
  const calendar: CalendarPort = {
    authorization: async () => calendarAuthorization, requestAccess: async () => calendarAuthorization, calendars: async () => calendarList,
    appointments: async (_start, _end) => appointments,
    createBlock: async (draft: CalendarBlockDraft) => {
      blocks.push(draft);
      return { id: `event-${blocks.length}`, start: draft.start, end: draft.end, calendarID: draft.calendarID };
    },
    ...options.calendar,
  };
  const windowPort: TasksWindowPort = {
    environment: 'preview', subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    acknowledgeFlush: async () => undefined, setDragRegion: async () => undefined, copyText: async () => undefined,
  };
  const clock: Clock = { now: () => now };
  const identities: IdentitySource = { next: () => `id-${++id}` };
  const ports: TasksPorts = { clock, identities, store, preferences, todoist, calendar, window: windowPort };
  const controller = new TasksController(ports);
  return {
    controller, writes, saveCalls, listeners, blocks,
    setNow(value: number) { now = value; },
    setConnection(value: TodoistConnection) { currentConnection = value; },
    setCaptures(value: unknown[]) { captures = value; },
    setCalendar(authorization: CalendarAuthorization, calendars: PlanningCalendar[] = [], events: CalendarAppointment[] = []) {
      calendarAuthorization = authorization; calendarList = calendars; appointments = events;
    },
    currentRevision: () => revision,
    currentDocument: () => stored,
  };
}

test('read-only startup recovery permits dismissal without overwriting corrupt or unavailable storage', async () => {
  const failures: TaskStore['load'][] = [
    async () => ({ kind: 'unreadable', message: 'Synthetic corrupt document' }),
    async () => ({ kind: 'ready', document: { version: 99 }, revision: 'r0' }),
    async () => { throw new Error('Synthetic unavailable store'); },
  ];
  for (const load of failures) {
    const app = harness({ load });
    assert.equal((await app.controller.initialize()).kind, 'recovery');
    assert.equal((await app.controller.create({ title: 'Must not overwrite recovery data' })).kind, 'unavailable');
    assert.equal(await app.controller.flush(), true, 'recovery with no accepted local intent is a no-op success for hide/quit');
    assert.equal(app.saveCalls.length, 0);
    app.controller.dispose();
  }
});

test('serialized commands publish only after save; a transient save error is retryable and flush reports it', async () => {
  const gate = deferred<{ kind: 'saved'; revision: string }>();
  const firstSaveStarted = deferred<void>();
  let invocation = 0;
  const app = harness({ save: async (expected, _document) => {
    invocation++;
    if (invocation === 1) { firstSaveStarted.resolve(); return gate.promise; }
    return { kind: 'saved', revision: `r${invocation}` };
  } });
  await app.controller.initialize();
  const first = app.controller.create({ title: 'First' });
  const second = app.controller.create({ title: 'Second' });
  await firstSaveStarted.promise;
  assert.equal(invocation, 1, 'second state change waits behind the first save');
  assert.equal(app.controller.getState().kind, 'ready');
  assert.equal(documentOf(app.controller).tasks.length, 0);
  gate.resolve({ kind: 'saved', revision: 'r1' });
  assert.equal((await first).kind, 'applied');
  assert.equal((await second).kind, 'applied');
  assert.equal(documentOf(app.controller).tasks.length, 2);
  app.controller.dispose();

  let failures = 1;
  const failing = harness({ save: async (_expected, _document) => {
    if (failures-- > 0) throw new Error('Synthetic disk fault');
    return { kind: 'saved', revision: 'r1' };
  } });
  await failing.controller.initialize();
  const outcome = await failing.controller.create({ title: 'Unsaved intent' });
  assert.equal(outcome.kind, 'failed');
  const state = failing.controller.getState();
  assert.equal(state.kind, 'ready');
  if (state.kind === 'ready') {
    assert.equal(state.document.tasks.length, 0, 'failed persistence is not reported as applied');
    assert.equal(state.persistenceError?.kind, 'saveFailed');
    assert.equal(state.persistenceError?.localDocument.tasks[0].title, 'Unsaved intent');
  }
  assert.equal(await failing.controller.flush(), true);
  assert.equal(documentOf(failing.controller).tasks.length, 1);
  failing.controller.dispose();
});

test('local create, timer and flush proceed while initial Todoist capture is stalled', async () => {
  const capturesStarted = deferred<void>();
  const capturesGate = deferred<CapturedTask[]>();
  const app = harness({ connection: { kind: 'connected', accountID: 'acct-A', projectID: 'project-A' }, todoist: {
    captures: async () => { capturesStarted.resolve(); return capturesGate.promise; },
  } });
  assert.equal((await app.controller.initialize()).kind, 'ready', 'local readiness does not wait for capture sync');
  await capturesStarted.promise;

  const created = await app.controller.create({ title: 'Created during sync' });
  assert.equal(created.kind, 'applied');
  if (created.kind !== 'applied') return;
  assert.equal((await app.controller.toggleTimer(created.value.taskID)).kind, 'applied');
  assert.equal(await app.controller.flush(), true);
  assert.equal(app.currentDocument()?.tasks[0].title, 'Created during sync');
  assert.equal(app.currentDocument()?.runningSession?.taskID, created.value.taskID);

  capturesGate.resolve([]);
  await app.controller.syncTodoist();
  assert.deepEqual(app.currentDocument()?.tasks.map(task => task.title), ['Created during sync']);
  app.controller.dispose();
});

test('local completion resolves durably during stalled Todoist writeback without losing later local writes', async () => {
  const capture = { source: { accountID: 'acct-A', projectID: 'project-A', taskID: 'remote-task' }, title: 'Imported', notes: '', tags: [], priority: 'normal' as const, createdAt: 10 };
  const writeStarted = deferred<void>();
  const writeGate = deferred<void>();
  const operationIDs: string[] = [];
  const app = harness({ connection: { kind: 'connected', accountID: 'acct-A', projectID: 'project-A' }, captures: [capture], todoist: {
    setCompleted: async (_source, _completed, operationID) => { operationIDs.push(operationID); writeStarted.resolve(); await writeGate.promise; },
  } });
  await app.controller.initialize();
  await app.controller.syncTodoist();
  const imported = documentOf(app.controller).tasks[0];
  const completion = app.controller.changeStatus(imported.id, 'completed');
  assert.deepEqual(await completion, { kind: 'applied', value: undefined }, 'the command acknowledges persisted local intent only');
  await writeStarted.promise;
  assert.equal(documentOf(app.controller).tasks[0].status.kind, 'completed');
  assert.equal(documentOf(app.controller).todoistOutbox.length, 1);

  const local = await app.controller.create({ title: 'Saved while writeback waits' });
  assert.equal(local.kind, 'applied');
  assert.equal(await app.controller.flush(), true);
  writeGate.resolve();
  await app.controller.syncTodoist();
  assert.deepEqual(documentOf(app.controller).tasks.map(task => task.title), ['Imported', 'Saved while writeback waits']);
  assert.equal(documentOf(app.controller).todoistOutbox.length, 0);
  assert.equal(operationIDs.length, 1);
  app.controller.dispose();
});

test('Todoist writeback retries the same durable outbox UUID after a remote failure', async () => {
  const capture = { source: { accountID: 'acct-A', projectID: 'project-A', taskID: 'retry-task' }, title: 'Retry me', notes: '', tags: [], priority: 'normal' as const, createdAt: 10 };
  const firstAttempt = deferred<void>();
  const operationIDs: string[] = [];
  let attempt = 0;
  const app = harness({ connection: { kind: 'connected', accountID: 'acct-A', projectID: 'project-A' }, captures: [capture], todoist: {
    setCompleted: async (_source, _completed, operationID) => {
      operationIDs.push(operationID);
      if (++attempt === 1) { firstAttempt.resolve(); throw new Error('temporary writeback fault'); }
    },
  } });
  await app.controller.initialize();
  await app.controller.syncTodoist();
  const taskID = documentOf(app.controller).tasks[0].id;
  assert.equal((await app.controller.changeStatus(taskID, 'completed')).kind, 'applied');
  await firstAttempt.promise;
  const queuedID = documentOf(app.controller).todoistOutbox[0]?.operationID;
  assert.ok(queuedID);
  await app.controller.syncTodoist();
  assert.deepEqual(operationIDs, [queuedID, queuedID]);
  assert.equal(documentOf(app.controller).todoistOutbox.length, 0);
  app.controller.dispose();
});

test('stale Todoist capture results are discarded after account/project identity changes', async () => {
  const captureA = { source: { accountID: 'acct-A', projectID: 'project-A', taskID: 'stale-task' }, title: 'Stale capture', notes: '', tags: [], priority: 'normal' as const, createdAt: 10 };
  const captureStarted = deferred<void>();
  const captureGate = deferred<CapturedTask[]>();
  let firstCapture = true;
  const app = harness({ connection: { kind: 'connected', accountID: 'acct-A', projectID: 'project-A' }, todoist: {
    captures: async () => {
      if (firstCapture) { firstCapture = false; captureStarted.resolve(); return captureGate.promise; }
      return [];
    },
  } });
  await app.controller.initialize();
  await captureStarted.promise;
  app.setConnection({ kind: 'connected', accountID: 'acct-B', projectID: 'project-B' });
  captureGate.resolve([captureA]);
  await app.controller.syncTodoist();
  const state = app.controller.getState();
  assert.equal(state.kind === 'ready' && state.todoistConnection.kind === 'connected' && state.todoistConnection.accountID, 'acct-B');
  assert.equal(documentOf(app.controller).tasks.length, 0, 'capture data is bound to the selected account and project that initiated it');
  app.controller.dispose();
});

test('Todoist skips ineligible account/project operations but preserves per-task outbox order', async () => {
  const sourceA = { accountID: 'acct-A', projectID: 'project-A', taskID: 'task-A' };
  const sourceB = { accountID: 'acct-B', projectID: 'project-B', taskID: 'task-B' };
  const initialDocument: TaskDocument = {
    version: 1, tasks: [importedTask('local-A', sourceA), importedTask('local-B', sourceB)], runningSession: null,
    todoistOutbox: [
      { operationID: 'op-A-1', source: sourceA, completed: true },
      { operationID: 'op-A-2', source: sourceA, completed: false },
      { operationID: 'op-B', source: sourceB, completed: true },
    ],
  };
  const app = harness({ connection: { kind: 'connected', accountID: 'acct-B', projectID: 'project-B' }, initialDocument, captures: [] });
  await app.controller.initialize();
  await app.controller.syncTodoist();
  assert.deepEqual(app.writes.map(write => write.operationID), ['op-B'], 'eligible work is not blocked by an older other-project item');
  assert.deepEqual(documentOf(app.controller).todoistOutbox.map(operation => operation.operationID), ['op-A-1', 'op-A-2']);

  app.setConnection({ kind: 'connected', accountID: 'acct-A', projectID: 'project-A' });
  await app.controller.syncTodoist(); // Reconcile the currently selected integration identity.
  await app.controller.syncTodoist();
  assert.deepEqual(app.writes.map(write => write.operationID), ['op-B', 'op-A-1', 'op-A-2']);
  assert.equal(documentOf(app.controller).todoistOutbox.length, 0);
  app.controller.dispose();
});

test('calendar permission and read prompts do not block local create, timer, or flush', async () => {
  const permissionStarted = deferred<void>();
  const permissionGate = deferred<CalendarAuthorization>();
  const calendarReadStarted = deferred<void>();
  const calendarsGate = deferred<PlanningCalendar[]>();
  const app = harness({ calendar: {
    requestAccess: async () => { permissionStarted.resolve(); return permissionGate.promise; },
    authorization: async () => 'authorized',
    calendars: async () => { calendarReadStarted.resolve(); return calendarsGate.promise; },
  } });
  await app.controller.initialize();
  const permission = app.controller.requestCalendarAccess();
  await permissionStarted.promise;
  const first = await app.controller.create({ title: 'During permission prompt' });
  assert.equal(first.kind, 'applied');
  if (first.kind !== 'applied') return;
  assert.equal((await app.controller.toggleTimer(first.value.taskID)).kind, 'applied');
  assert.equal(await app.controller.flush(), true);
  permissionGate.resolve('authorized');
  assert.deepEqual(await permission, { kind: 'applied', value: 'authorized' });

  const load = app.controller.loadCalendar(2_000, 4_000);
  await calendarReadStarted.promise;
  const second = await app.controller.create({ title: 'During calendar read' });
  assert.equal(second.kind, 'applied');
  if (second.kind !== 'applied') return;
  assert.equal((await app.controller.toggleTimer(second.value.taskID)).kind, 'applied');
  assert.equal(await app.controller.flush(), true);
  calendarsGate.resolve([]);
  assert.equal((await load).kind, 'applied');
  assert.deepEqual(documentOf(app.controller).tasks.map(task => task.title), ['During permission prompt', 'During calendar read']);
  app.controller.dispose();
});

test('a persisted explicit timer resumes across controller initialization and reconciles nonnegative elapsed work', async () => {
  const persisted: TaskDocument = {
    version: 1,
    tasks: [{ id: 'task-restarted', title: 'Running task', notes: '', tags: [], priority: 'normal', status: { kind: 'active' },
      createdAt: 100, updatedAt: 100, lastProgressAt: null, activities: [{ kind: 'created', at: 100 }], work: [], importedFrom: null, locallyEdited: false }],
    runningSession: { id: 'session-restarted', taskID: 'task-restarted', startedAt: 1_000 }, todoistOutbox: [],
  };
  const app = harness({ initialDocument: persisted });
  await app.controller.initialize();
  app.setNow(1_500);
  assert.equal((await app.controller.stopTimer()).kind, 'applied');
  assert.equal(documentOf(app.controller).tasks[0].work[0].durationMs, 500);
  assert.equal(documentOf(app.controller).runningSession, null);
  app.controller.dispose();
});

test('CAS conflict preserves local recovery data and never overwrites or acknowledges it as saved', async () => {
  const app = harness({ save: async () => ({ kind: 'conflict' }) });
  await app.controller.initialize();
  const result = await app.controller.create({ title: 'Local-only recovery' });
  assert.equal(result.kind, 'failed');
  const state = app.controller.getState();
  assert.equal(state.kind, 'ready');
  if (state.kind === 'ready') {
    assert.equal(state.persistenceError?.kind, 'conflict');
    assert.equal(state.persistenceError?.localDocument.tasks[0].title, 'Local-only recovery');
  }
  assert.match(app.controller.exportLocalChanges() ?? '', /Local-only recovery/);
  assert.equal(await app.controller.flush(), false);
  assert.equal(app.saveCalls.length, 1, 'a stale revision is not retried or overwritten');
  assert.equal(app.currentDocument(), null);
  app.controller.dispose();
});

test('Todoist imports selected-project captures once; wrong-account and disconnected outbox work stays queued in order', async () => {
  const capture = { source: { accountID: 'acct-A', projectID: 'project-A', taskID: 'task-1' }, title: 'Imported capture', notes: '', tags: ['inbox'], priority: 'normal' as const, createdAt: 25 };
  const app = harness({ captures: [capture] });
  await app.controller.initialize();
  assert.equal((await app.controller.connectTodoist('synthetic token')).kind, 'applied');
  assert.equal((await app.controller.loadTodoistProjects()).kind, 'applied');
  assert.equal((await app.controller.selectTodoistProject('project-A')).kind, 'applied');
  const firstSync = await app.controller.syncTodoist();
  assert.deepEqual(firstSync, { kind: 'applied', value: { imported: 1, pendingWritebacks: 0 } });
  assert.equal(documentOf(app.controller).tasks[0].createdAt, 25);
  app.setCaptures([capture]);
  assert.deepEqual(await app.controller.syncTodoist(), { kind: 'applied', value: { imported: 0, pendingWritebacks: 0 } });

  await app.controller.disconnectTodoist();
  await app.controller.changeStatus('id-1', 'completed');
  await app.controller.restore('id-1');
  assert.equal(app.writes.length, 0);
  let state = app.controller.getState();
  assert.equal(state.kind === 'ready' && state.document.todoistOutbox.length, 2, 'disconnect never drops pending writebacks');

  app.setConnection({ kind: 'connected', accountID: 'acct-B', projectID: 'project-B' });
  app.setCaptures([]);
  await app.controller.syncTodoist(); // Reconcile the controller's selected connection.
  await app.controller.syncTodoist();
  assert.equal(app.writes.length, 0, 'a different account/project cannot receive imported task writes');
  state = app.controller.getState();
  assert.equal(state.kind === 'ready' && state.document.todoistOutbox.length, 2);

  app.setConnection({ kind: 'connected', accountID: 'acct-A', projectID: 'project-A' });
  app.setCaptures([capture]);
  await app.controller.syncTodoist(); // Reconcile the selected account again.
  await app.controller.syncTodoist();
  assert.deepEqual(app.writes.map(write => [write.accountID, write.completed]), [['acct-A', true], ['acct-A', false]]);
  assert.notEqual(app.writes[0].operationID, app.writes[1].operationID);
  state = app.controller.getState();
  assert.equal(state.kind === 'ready' && state.document.todoistOutbox.length, 0);
  app.controller.dispose();
});

test('clock stage persists due snooze wakeups without changing capture age', async () => {
  const app = harness();
  await app.controller.initialize();
  const created = await app.controller.create({ title: 'Wake me later' });
  assert.equal(created.kind, 'applied');
  if (created.kind !== 'applied') return;
  await app.controller.snooze(created.value.taskID, 2_000);
  const ageOrigin = documentOf(app.controller).tasks[0].createdAt;
  app.setNow(2_000);
  assert.deepEqual(await app.controller.runClockStage(), { kind: 'applied', value: { woken: 1 } });
  assert.equal(documentOf(app.controller).tasks[0].status.kind, 'active');
  assert.equal(documentOf(app.controller).tasks[0].createdAt, ageOrigin);
  app.controller.dispose();
});

test('calendar access, loading and scheduling stay explicit and require an active task and writable selected calendar', async () => {
  const app = harness();
  await app.controller.initialize();
  app.setCalendar('authorized', [
    { id: 'calendar-write', title: 'Work', sourceTitle: 'Local', writable: true },
    { id: 'calendar-read', title: 'Read only', sourceTitle: 'Subscribed', writable: false },
  ], [{ id: 'event-existing', title: 'Existing', start: 2_100, end: 2_200, allDay: false }]);
  assert.deepEqual(await app.controller.requestCalendarAccess(), { kind: 'applied', value: 'authorized' });
  assert.equal((await app.controller.loadCalendar(2_000, 4_000)).kind, 'applied');
  const created = await app.controller.create({ title: 'Plan a work block' });
  assert.equal(created.kind, 'applied');
  if (created.kind !== 'applied') return;
  assert.deepEqual(await app.controller.scheduleTask(created.value.taskID, 'calendar-write', 2_500, 3_500), {
    kind: 'applied', value: { id: 'event-1', start: 2_500, end: 3_500, calendarID: 'calendar-write' },
  });
  assert.equal(app.blocks.length, 1);
  assert.equal((await app.controller.scheduleTask(created.value.taskID, 'calendar-read', 2_500, 3_500)).kind, 'rejected');
  await app.controller.changeStatus(created.value.taskID, 'completed');
  assert.deepEqual(await app.controller.scheduleTask(created.value.taskID, 'calendar-write', 2_500, 3_500), { kind: 'rejected', reason: 'task_not_schedulable' });
  assert.equal(app.blocks.length, 1);
  app.controller.dispose();
});

test('completion atomically settles a running timer from a frozen published document', async () => {
  const app = harness();
  await app.controller.initialize();
  await app.controller.create({ title: 'Finish a running session' });
  const taskID = documentOf(app.controller).tasks[0].id;
  await app.controller.toggleTimer(taskID);
  const before = documentOf(app.controller);
  assert.equal(Object.isFrozen(before.tasks[0].work), true);
  app.setNow(1_250);
  assert.equal((await app.controller.changeStatus(taskID, 'completed')).kind, 'applied');
  assert.equal(documentOf(app.controller).runningSession, null);
  assert.equal(app.controller.queryTaskDetail(taskID)?.totalInvestedMs, 250);
  assert.equal(before.tasks[0].work.length, 0, 'the prior aggregate remains unchanged');
  assert.equal((await app.controller.restore(taskID)).kind, 'applied');
  assert.equal(app.controller.queryTaskDetail(taskID)?.totalInvestedMs, 250, 'undo does not double-settle effort');
  app.controller.dispose();
});

test('task detail facade returns the pure projection with running elapsed separate from recorded work', async () => {
  const app = harness();
  await app.controller.initialize();
  const created = await app.controller.create({ title: 'Detail task' });
  assert.equal(created.kind, 'applied');
  if (created.kind !== 'applied') return;
  await app.controller.toggleTimer(created.value.taskID);
  app.setNow(1_500);
  const detail = app.controller.queryTaskDetail(created.value.taskID);
  assert.ok(detail);
  assert.deepEqual(detail.running, { startedAt: 1_000, elapsedMs: 500 });
  assert.equal(detail.totalInvestedMs, 0);
  assert.deepEqual(detail.workEntries, []);
  assert.equal(detail.history[0].kind, 'created');
  assert.equal(DEFAULT_TASKS_PREFERENCES.soundEnabled, false);
  app.controller.dispose();
});

test('local-created tasks never enter Todoist writeback and query facade preserves independent fields', async () => {
  const app = harness();
  await app.controller.initialize();
  const created = await app.controller.create({ title: 'Local task', tags: ['home'] });
  assert.equal(created.kind, 'applied');
  if (created.kind !== 'applied') return;
  const id = created.value.taskID;
  await app.controller.logEffort(id, 2_000);
  await app.controller.changeStatus(id, 'completed');
  assert.equal(app.writes.length, 0);
  const brief = app.controller.queryAgentBrief(id);
  assert.match(brief?.sections.permissions.canChangeTasks ? 'invalid' : 'read-only', /read-only/);
  assert.match(brief?.text ?? '', /Recorded effort: 2000 ms/);
  assert.equal(app.controller.queryTasks({ mode: 'completed', tag: 'HOME' }).tasks[0].totalInvestedMs, 2_000);
  app.controller.dispose();
});
