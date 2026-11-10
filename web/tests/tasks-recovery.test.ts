import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TasksController, DEFAULT_TASKS_PREFERENCES } from '../src/tasks/application/controller';
import type {
  CalendarPort, Clock, IdentitySource, TasksPorts, TasksPreferencesPort, TasksRecoveryInspection, TasksRecoveryPort, TasksRecoveryPrimary,
  TasksWindowPort, TaskStore, TodoistPort,
} from '../src/tasks/application/ports';
import type { TaskDocument } from '../src/tasks/domain/model';
import { NativeTasksAdapter } from '../src/tasks/adapters/native-tasks';
import { PreviewTasksAdapter } from '../src/tasks/adapters/preview-tasks';
import type { NativeTasksMessage } from '../src/tasks/adapters/native-contract';

const PRIMARY_HASH = 'a'.repeat(64);
const BACKUP_HASH = 'b'.repeat(64);
const ZERO_BYTE_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function validDocument(): TaskDocument {
  return {
    version: 1,
    tasks: [{ id: 'task-backup', title: 'Validated backup', notes: '', tags: ['important'], priority: 'high', status: { kind: 'active' },
      createdAt: 10, updatedAt: 20, lastProgressAt: 15, activities: [
        { kind: 'created', at: 10 }, { kind: 'progress', at: 15, note: 'Keep the history' }, { kind: 'worked', at: 20, durationMs: 5 },
      ], work: [{ id: 'work-1', recordedAt: 20, durationMs: 5, source: 'timer' }],
      importedFrom: { accountID: 'acct-1', projectID: 'project-1', taskID: 'todo-1' }, locallyEdited: true }],
    runningSession: { id: 'session-1', taskID: 'task-backup', startedAt: 21 },
    todoistOutbox: [{ operationID: 'operation-1', source: { accountID: 'acct-1', projectID: 'project-1', taskID: 'todo-1' }, completed: true }],
  };
}
function candidate(backup: unknown = validDocument(), primary: TasksRecoveryPrimary = { kind: 'missing' }): TasksRecoveryInspection {
  return { kind: 'candidate', primary, backup: { revision: BACKUP_HASH, document: backup, savedAt: 1_700_000_000_000 } };
}
function inspectCandidate(backup: unknown, primary: { kind: 'missing' } | { kind: 'present'; revision: string; document: unknown }): TasksRecoveryInspection {
  return { kind: 'candidate', primary, backup: { revision: BACKUP_HASH, document: backup, savedAt: 1_700_000_000_000 } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(options: {
  load?: TaskStore['load'];
  inspect?: () => Promise<TasksRecoveryInspection>;
  restore?: TasksRecoveryPort['restore'];
  preferences?: TasksPreferencesPort;
  todoist?: Partial<TodoistPort>;
  omitRecovery?: boolean;
} = {}) {
  let loads = 0;
  let saves = 0;
  let inspections = 0;
  const restoreCalls: Array<{ expectedPrimaryRevision: string | null; expectedBackupRevision: string }> = [];
  const integrationCalls: string[] = [];
  const store: TaskStore = {
    load: async () => {
      loads++;
      return options.load ? options.load() : { kind: 'unreadable', message: 'not displayed to users' };
    },
    save: async () => { saves++; return { kind: 'saved', revision: 'saved-revision' }; },
  };
  const recovery: TasksRecoveryPort = {
    inspect: async () => { inspections++; return options.inspect ? options.inspect() : candidate(); },
    restore: async input => {
      restoreCalls.push(input);
      return options.restore ? options.restore(input) : { kind: 'restored' };
    },
  };
  const preferences: TasksPreferencesPort = options.preferences ?? {
    load: async () => ({ ...DEFAULT_TASKS_PREFERENCES }), save: async value => value,
  };
  const windowPort: TasksWindowPort = {
    environment: 'preview', subscribe: () => () => undefined, acknowledgeFlush: async () => undefined,
    setDragRegion: async () => undefined, copyText: async () => undefined,
  };
  const todoist: TodoistPort = {
    connection: async () => { integrationCalls.push('connection'); return { kind: 'disconnected' }; },
    connect: async () => { integrationCalls.push('connect'); return { connection: { kind: 'disconnected' }, projects: [] }; },
    disconnect: async () => { integrationCalls.push('disconnect'); },
    projects: async () => { integrationCalls.push('projects'); return []; },
    selectProject: async () => { integrationCalls.push('select'); return { kind: 'disconnected' }; },
    captures: async () => { integrationCalls.push('captures'); return []; },
    setCompleted: async () => { integrationCalls.push('writeback'); },
    ...options.todoist,
  };
  const ports: TasksPorts = {
    clock: { now: () => 30 } satisfies Clock,
    identities: { next: () => 'generated-id' } satisfies IdentitySource,
    store, ...(options.omitRecovery ? {} : { recovery }), preferences, todoist, calendar: {} as CalendarPort, window: windowPort,
  };
  const controller = new TasksController(ports);
  return { controller, restoreCalls, integrationCalls, counts: () => ({ loads, saves, inspections }) };
}

function recoveredState(app: ReturnType<typeof harness>) {
  const state = app.controller.getState();
  assert.equal(state.kind, 'recovery');
  if (state.kind !== 'recovery') throw new Error('Expected recovery state');
  return state;
}

function testAsync(name: string, run: () => Promise<void>): void { test(name, { timeout: 12_000 }, run); }

testAsync('validated recovery exposes only the backup summary and explicit restore preserves the full task document', async () => {
  const backup = validDocument();
  const integrationStarted = deferred<void>();
  let stateAtIntegration: string | null = null;
  let app!: ReturnType<typeof harness>;
  app = harness({
    inspect: async () => candidate(backup),
    load: async () => app.counts().loads === 1 ? { kind: 'unreadable', message: 'private native detail' } :
      { kind: 'ready', document: backup, revision: 'restored-primary-revision' },
    todoist: { connection: async () => { stateAtIntegration = app.controller.getState().kind; integrationStarted.resolve(); return { kind: 'disconnected' }; } },
  });
  await app.controller.initialize();
  const recovery = recoveredState(app);
  assert.deepEqual(recovery.resolution, { kind: 'candidate', backup: { taskCount: 1, savedAt: 1_700_000_000_000 } });
  assert.equal('document' in recovery, false);
  assert.equal(JSON.stringify(recovery).includes(BACKUP_HASH), false, 'raw CAS revisions stay private');
  assert.equal(app.counts().saves, 0);

  assert.deepEqual(await app.controller.restoreBackup(), { kind: 'restored' });
  assert.deepEqual(app.restoreCalls, [{ expectedPrimaryRevision: null, expectedBackupRevision: BACKUP_HASH }]);
  const ready = app.controller.getState();
  assert.equal(ready.kind, 'ready');
  if (ready.kind === 'ready') assert.deepEqual(ready.document, backup, 'history, timer, tags, Todoist identity and outbox survive recovery unchanged');
  assert.equal(app.counts().saves, 0, 'recovery never saves or rewrites the restored document');
  await integrationStarted.promise;
  assert.equal(stateAtIntegration, 'ready', 'integration orchestration starts only after full reload and decode');
  app.controller.dispose();
});

testAsync('a semantically invalid backup is rejected even when the native recovery envelope is a candidate', async () => {
  const invalid = validDocument() as TaskDocument & { extra?: string };
  invalid.tasks[0].id = '';
  const app = harness({ inspect: async () => candidate(invalid) });
  await app.controller.initialize();
  assert.equal(recoveredState(app).resolution.kind, 'no-valid-backup');
  assert.deepEqual(await app.controller.restoreBackup(), { kind: 'unavailable' });
  assert.equal(app.restoreCalls.length, 0);
  app.controller.dispose();
});

testAsync('future or unrecognized primary/backup schemas fail closed without offering restoration', async () => {
  const future = { ...validDocument(), version: 99 };
  for (const inspection of [candidate(future), inspectCandidate(validDocument(), { kind: 'present', revision: PRIMARY_HASH, document: future })]) {
    const app = harness({ inspect: async () => inspection });
    await app.controller.initialize();
    assert.equal(recoveredState(app).resolution.kind, 'unsupported-version');
    assert.deepEqual(await app.controller.restoreBackup(), { kind: 'unavailable' });
    assert.equal(app.restoreCalls.length, 0);
    app.controller.dispose();
  }
});

testAsync('a semantically valid current primary is reloaded only after explicit Check, never rolled back', async () => {
  let app!: ReturnType<typeof harness>;
  app = harness({
    inspect: async () => inspectCandidate(validDocument(), { kind: 'present', revision: PRIMARY_HASH, document: validDocument() }),
    load: async () => app.counts().loads === 1 ? { kind: 'unreadable', message: 'initial failure' } :
      { kind: 'ready', document: validDocument(), revision: 'reloaded-primary' },
  });
  await app.controller.initialize();
  assert.equal(recoveredState(app).resolution.kind, 'primary-changed');
  assert.deepEqual(await app.controller.restoreBackup(), { kind: 'unavailable' });
  const ready = await app.controller.checkBackupAgain();
  assert.equal(ready.kind, 'ready');
  if (ready.kind === 'ready') assert.equal(ready.revision, 'reloaded-primary');
  assert.equal(app.restoreCalls.length, 0);
  assert.equal(app.counts().loads, 2);
  assert.equal(app.counts().saves, 0, 'Check reloads without task-data writes');
  app.controller.dispose();
});

testAsync('missing primary and present zero-byte primary remain distinct CAS expectations', async () => {
  for (const [primary, expected] of [
    [{ kind: 'missing' } as const, null],
    [{ kind: 'present' as const, revision: ZERO_BYTE_HASH, document: null }, ZERO_BYTE_HASH],
  ] as const) {
    let app!: ReturnType<typeof harness>;
    app = harness({
      inspect: async () => inspectCandidate(validDocument(), primary),
      load: async () => app.counts().loads === 1 ? { kind: 'unreadable', message: 'initial failure' } :
        { kind: 'ready', document: validDocument(), revision: 'restored-primary' },
    });
    await app.controller.initialize();
    assert.equal(recoveredState(app).resolution.kind, 'candidate');
    assert.deepEqual(await app.controller.restoreBackup(), { kind: 'restored' });
    assert.deepEqual(app.restoreCalls, [{ expectedPrimaryRevision: expected, expectedBackupRevision: BACKUP_HASH }]);
    app.controller.dispose();
  }
});

testAsync('native conflict blocks restoration until an explicit Check gets fresh snapshots', async () => {
  const inspections = [
    inspectCandidate(validDocument(), { kind: 'present', revision: PRIMARY_HASH, document: null }),
    inspectCandidate(validDocument(), { kind: 'missing' }),
  ];
  const app = harness({
    inspect: async () => inspections.shift() ?? { kind: 'unavailable' },
    load: async () => app.counts().loads === 1 ? { kind: 'unreadable', message: 'corrupt' } :
      { kind: 'ready', document: validDocument(), revision: 'r-restored' },
    restore: async () => app.restoreCalls.length === 1 ? { kind: 'conflict' } : { kind: 'restored' },
  });
  await app.controller.initialize();
  assert.deepEqual(await app.controller.restoreBackup(), { kind: 'conflict' });
  assert.equal(app.restoreCalls.length, 1, 'conflict is never retried automatically');
  assert.equal(recoveredState(app).resolution.kind, 'primary-changed');
  assert.deepEqual(await app.controller.restoreBackup(), { kind: 'unavailable' });
  assert.equal(app.counts().inspections, 1, 'conflict does not auto-inspect into a second offer');
  await app.controller.checkBackupAgain();
  assert.equal(recoveredState(app).resolution.kind, 'candidate');
  assert.deepEqual(await app.controller.restoreBackup(), { kind: 'restored' });
  assert.deepEqual(app.restoreCalls, [
    { expectedPrimaryRevision: PRIMARY_HASH, expectedBackupRevision: BACKUP_HASH },
    { expectedPrimaryRevision: null, expectedBackupRevision: BACKUP_HASH },
  ]);
  app.controller.dispose();
});

testAsync('failed restore requires a fresh explicit check and keeps safe failure copy', async () => {
  const app = harness({ restore: async () => { throw new Error('sensitive provider-owned message'); } });
  await app.controller.initialize();
  assert.deepEqual(await app.controller.restoreBackup(), { kind: 'failed' });
  const state = recoveredState(app);
  assert.equal(state.resolution.kind, 'restore-failed');
  assert.doesNotMatch(state.message, /sensitive|provider-owned/);
  assert.deepEqual(await app.controller.restoreBackup(), { kind: 'unavailable' }, 'failure clears the private candidate');
  assert.equal(app.counts().inspections, 1, 'failure does not silently reinspect');
  await app.controller.checkBackupAgain();
  assert.equal(recoveredState(app).resolution.kind, 'candidate');
  assert.equal(app.counts().inspections, 2);
  assert.equal(app.counts().loads, 1);
  assert.equal(app.counts().saves, 0);
  app.controller.dispose();
});

testAsync('invalid post-restore reload remains in recovery and starts no integrations', async () => {
  const invalid = { ...validDocument(), tasks: [{ id: '' }] };
  const app = harness({
    inspect: async () => inspectCandidate(validDocument(), { kind: 'present', revision: PRIMARY_HASH, document: null }),
    load: async () => app.counts().loads === 1 ? { kind: 'unreadable', message: 'corrupt' } :
      { kind: 'ready', document: invalid, revision: 'r-bad' },
  });
  await app.controller.initialize();
  assert.deepEqual(await app.controller.restoreBackup(), { kind: 'failed' });
  assert.equal(recoveredState(app).resolution.kind, 'inspection-failed', 'invalid reload requires an explicit fresh check');
  assert.deepEqual(await app.controller.restoreBackup(), { kind: 'unavailable' });
  assert.equal(app.counts().loads, 2);
  assert.equal(app.counts().saves, 0);
  assert.deepEqual(app.integrationCalls, []);
  app.controller.dispose();
});

testAsync('mutations and integrations are denied while recovery is pending; an empty flush is a no-op success', async () => {
  const started = deferred<void>();
  const gate = deferred<TasksRecoveryInspection>();
  const app = harness({ inspect: async () => { started.resolve(); return gate.promise; } });
  const initialized = app.controller.initialize();
  await started.promise;
  assert.equal((await app.controller.create({ title: 'Not accepted' })).kind, 'unavailable');
  assert.equal((await app.controller.connectTodoist('never-forward-this')).kind, 'unavailable');
  assert.equal((await app.controller.syncTodoist()).kind, 'unavailable');
  assert.equal(await app.controller.flush(), true, 'an empty recovery flush is a safe no-op for hide/quit');
  assert.equal(app.counts().saves, 0);
  assert.deepEqual(app.integrationCalls, []);
  gate.resolve(candidate());
  await initialized;
  assert.equal(recoveredState(app).resolution.kind, 'candidate');
  app.controller.dispose();
});

testAsync('late inspection cannot replace disposal and duplicate restore calls produce only one native command', async () => {
  const inspection = deferred<TasksRecoveryInspection>();
  const started = deferred<void>();
  const stale = harness({ inspect: async () => { started.resolve(); return inspection.promise; } });
  const startup = stale.controller.initialize();
  await started.promise;
  stale.controller.dispose();
  inspection.resolve(candidate());
  await startup;
  assert.equal(stale.controller.getState().kind, 'disposed');

  const restoreGate = deferred<{ kind: 'restored' } | { kind: 'conflict' }>();
  const restoreStarted = deferred<void>();
  let duplicate!: ReturnType<typeof harness>;
  duplicate = harness({
    load: async () => duplicate.counts().loads === 1 ? { kind: 'unreadable', message: 'corrupt' } :
      { kind: 'ready', document: validDocument(), revision: 'r-restored' },
    restore: async () => { restoreStarted.resolve(); return restoreGate.promise; },
  });
  await duplicate.controller.initialize();
  const first = duplicate.controller.restoreBackup();
  const second = duplicate.controller.restoreBackup();
  assert.deepEqual(await second, { kind: 'unavailable' }, 'double confirmation is rejected synchronously, before queueing');
  await restoreStarted.promise;
  assert.equal(duplicate.restoreCalls.length, 1);
  restoreGate.resolve({ kind: 'restored' });
  assert.deepEqual(await first, { kind: 'restored' });
  assert.deepEqual(await second, { kind: 'unavailable' });
  assert.equal(duplicate.restoreCalls.length, 1);
  duplicate.controller.dispose();
});

testAsync('post-restore missing/null storage is blocked instead of becoming a fresh empty Tasks document', async () => {
  let app!: ReturnType<typeof harness>;
  app = harness({
    load: async () => app.counts().loads === 1 ? { kind: 'unreadable', message: 'initial corruption' } :
      { kind: 'ready', document: null, revision: 'empty-after-restore' },
  });
  await app.controller.initialize();
  assert.deepEqual(await app.controller.restoreBackup(), { kind: 'failed' });
  assert.equal(recoveredState(app).resolution.kind, 'inspection-failed');
  assert.equal(app.counts().loads, 2);
  assert.equal(app.counts().saves, 0);
  assert.deepEqual(app.integrationCalls, []);
  assert.deepEqual(await app.controller.restoreBackup(), { kind: 'unavailable' });
  app.controller.dispose();
});

testAsync('duplicate confirmations queued before a restore failure cannot trigger a second native restore', async () => {
  const started = deferred<void>();
  const restoreGate = deferred<{ kind: 'restored' } | { kind: 'conflict' }>();
  const app = harness({ restore: async () => { started.resolve(); return restoreGate.promise; } });
  await app.controller.initialize();
  const first = app.controller.restoreBackup();
  const second = app.controller.restoreBackup();
  assert.deepEqual(await second, { kind: 'unavailable' });
  await started.promise;
  restoreGate.reject(new Error('private native failure'));
  assert.deepEqual(await first, { kind: 'failed' });
  assert.equal(app.restoreCalls.length, 1);
  assert.equal(recoveredState(app).resolution.kind, 'restore-failed');
  assert.deepEqual(await app.controller.restoreBackup(), { kind: 'unavailable' });
  app.controller.dispose();
});

testAsync('absent recovery capability, unavailable snapshots and thrown inspections have distinct check states', async () => {
  const absent = harness({ omitRecovery: true });
  await absent.controller.initialize();
  assert.equal(recoveredState(absent).resolution.kind, 'unavailable');
  await absent.controller.checkBackupAgain();
  assert.equal(absent.counts().inspections, 0, 'no capability means no fabricated Check action');
  absent.controller.dispose();

  let calls = 0;
  const unavailable = harness({ inspect: async () => ++calls === 1 ? { kind: 'unavailable' } : candidate() });
  await unavailable.controller.initialize();
  assert.equal(recoveredState(unavailable).resolution.kind, 'no-valid-backup');
  await unavailable.controller.checkBackupAgain();
  assert.equal(recoveredState(unavailable).resolution.kind, 'candidate');
  unavailable.controller.dispose();

  let failureCalls = 0;
  const failed = harness({ inspect: async () => { if (++failureCalls === 1) throw new Error('private inspection fault'); return candidate(); } });
  await failed.controller.initialize();
  assert.equal(recoveredState(failed).resolution.kind, 'inspection-failed');
  await failed.controller.checkBackupAgain();
  assert.equal(recoveredState(failed).resolution.kind, 'candidate');
  failed.controller.dispose();
});

testAsync('native recovery adapter validates bounded snapshots and sends exact CAS hashes', async () => {
  const messages: NativeTasksMessage[] = [];
  let response: unknown = { kind: 'candidate', primary: { kind: 'missing' },
    backup: { revision: BACKUP_HASH, document: validDocument(), savedAt: 1_700_000_000_000 } };
  const target = new EventTarget() as EventTarget & { webkit: { messageHandlers: { bananaTasks: { postMessage(message: NativeTasksMessage): Promise<unknown> } } } };
  target.webkit = { messageHandlers: { bananaTasks: { postMessage: async message => { messages.push(message); return response; } } } };
  const adapter = new NativeTasksAdapter(target as unknown as Window);
  assert.deepEqual(await adapter.recovery.inspect(), { kind: 'candidate', primary: { kind: 'missing' },
    backup: { revision: BACKUP_HASH, document: validDocument(), savedAt: 1_700_000_000_000 } });
  assert.deepEqual(messages[0], { action: 'inspectTasksRecovery' });
  response = { kind: 'conflict' };
  assert.deepEqual(await adapter.recovery.restore({ expectedPrimaryRevision: null, expectedBackupRevision: BACKUP_HASH }), { kind: 'conflict' });
  assert.deepEqual(messages[1], { action: 'restoreTasksBackup', expectedPrimaryRevision: null, expectedBackupRevision: BACKUP_HASH });

  response = { kind: 'candidate', primary: { kind: 'present', revision: '0'.repeat(64), document: null },
    backup: { revision: BACKUP_HASH.toUpperCase(), document: validDocument(), savedAt: 1 } };
  await assert.rejects(adapter.recovery.inspect(), /invalid/i);
  response = { kind: 'candidate', primary: { kind: 'missing' }, backup: { revision: BACKUP_HASH, document: validDocument(), savedAt: Number.MAX_SAFE_INTEGER + 1 } };
  await assert.rejects(adapter.recovery.inspect(), /invalid/i);
  response = null;
  await assert.rejects(adapter.recovery.restore({ expectedPrimaryRevision: 'not-a-hash', expectedBackupRevision: BACKUP_HASH }), /revision is invalid/i);
});

testAsync('native load leaves semantic validation to the application decoder, and preview has no recovery capability', async () => {
  const future = { version: 99, tasks: [], runningSession: null, todoistOutbox: [] };
  const target = new EventTarget() as EventTarget & { webkit: { messageHandlers: { bananaTasks: { postMessage(message: NativeTasksMessage): Promise<unknown> } } } };
  target.webkit = { messageHandlers: { bananaTasks: { postMessage: async () => ({ kind: 'ready', document: future, revision: 'native-revision' }) } } };
  const native = new NativeTasksAdapter(target as unknown as Window);
  assert.deepEqual(await native.store.load(), { kind: 'ready', document: future, revision: 'native-revision' });
  const preview = new PreviewTasksAdapter(new EventTarget() as unknown as Window, {} as Storage);
  assert.equal('recovery' in preview, false, 'preview does not fabricate a backup capability');
});
