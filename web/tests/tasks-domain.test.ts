import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addManualEffort, addProgress, changeTaskStatus, createTask, importCaptures, setSnoozeUntil,
  toggleTimer, updateTask, wakeSnoozedTasks,
} from '../src/tasks/domain/decisions';
import { decodeTaskDocument, type TaskDocument } from '../src/tasks/domain/model';
import { queryTaskDetail, queryTaskList, ripenessFor } from '../src/tasks/domain/queries';

let nextTestID = 0;
function context(now: number) {
  return { now, nextID: () => `test-${++nextTestID}` };
}
function accepted<T>(result: { kind: 'accepted'; value: T } | { kind: 'rejected'; reason: string }): T {
  assert.equal(result.kind, 'accepted', result.kind === 'rejected' ? result.reason : '');
  return result.value;
}
function taskDocument(): TaskDocument {
  return { version: 1, tasks: [], runningSession: null, todoistOutbox: [] };
}
function create(document: TaskDocument, now: number, title: string) {
  return accepted(createTask(document, { title }, context(now)));
}

test('creation, progress and activity preserve capture age while priority weights inactivity', () => {
  const day = 86_400_000;
  let document = create(taskDocument(), 1_000, '  ship a small thing  ');
  const first = document.tasks[0];
  document = accepted(updateTask(document, first.id, { priority: 'high', tags: ['Focus', ' focus ', 'work'] }, context(2_000)));
  const updated = document.tasks[0];
  assert.equal(updated.title, 'ship a small thing');
  assert.deepEqual(updated.tags, ['Focus', 'work']);
  assert.equal(updated.createdAt, 1_000);

  const high = ripenessFor(updated, 1_000 + 8 * day, 'normal');
  const lowTask = { ...updated, priority: 'low' as const };
  assert.equal(high.ripeness, 'spotty');
  assert.equal(ripenessFor(lowTask, 1_000 + 8 * day, 'normal').ripeness, 'ripe');

  document = accepted(addProgress(document, first.id, 'Made the first pass', context(1_000 + 8 * day)));
  const progressed = document.tasks[0];
  const read = queryTaskList(document, { mode: 'active' }, 1_000 + 8 * day, 'normal').tasks[0];
  assert.equal(progressed.createdAt, 1_000);
  assert.equal(read.rawAgeMs, 8 * day);
  assert.equal(read.lastProgressAt, 1_000 + 8 * day);
  assert.equal(read.ripeness, 'fresh');
  assert.equal(progressed.activities.at(-1)?.kind, 'progress');
});

test('waiting and snoozing freeze attention across resume while capture age keeps advancing', () => {
  const day = 86_400_000;
  let document = create(taskDocument(), 0, 'Rest without a penalty');
  const id = document.tasks[0].id;
  document = accepted(changeTaskStatus(document, id, 'waiting', context(day)));
  document = accepted(changeTaskStatus(document, id, 'active', context(31 * day)));
  assert.deepEqual(ripenessFor(document.tasks[0], 32 * day, 'normal'), { ripeness: 'fresh', inactivityMs: 2 * day });
  document = accepted(setSnoozeUntil(document, id, 63 * day, context(32 * day)));
  document = accepted(wakeSnoozedTasks(document, context(63 * day)));
  const read = queryTaskList(document, { mode: 'active' }, 64 * day, 'normal').tasks[0];
  assert.equal(read.rawAgeMs, 64 * day);
  assert.equal(read.inactivityMs, 3 * day);
  assert.equal(read.ripeness, 'ripe');
  document = accepted(addProgress(document, id, 'A useful next step', context(64 * day)));
  assert.deepEqual(ripenessFor(document.tasks[0], 65 * day, 'normal'), { ripeness: 'fresh', inactivityMs: day });
});

test('timer switching records elapsed work once and task states pause sessions', () => {
  let document = create(taskDocument(), 100, 'A');
  document = accepted(createTask(document, { title: 'B' }, context(101)));
  const [a, b] = document.tasks;
  document = accepted(toggleTimer(document, a.id, context(1_000)));
  assert.equal(document.runningSession?.taskID, a.id);
  document = accepted(toggleTimer(document, b.id, context(1_250)));
  assert.equal(document.runningSession?.taskID, b.id);
  assert.equal(document.tasks[0].work.reduce((sum, entry) => sum + entry.durationMs, 0), 250);
  document = accepted(changeTaskStatus(document, b.id, 'waiting', context(1_750)));
  assert.equal(document.runningSession, null);
  assert.equal(document.tasks[1].work[0].durationMs, 500);
  assert.equal(document.tasks[1].activities.filter(activity => activity.kind === 'worked').length, 1);
  assert.equal(document.tasks[1].status.kind, 'waiting');
  assert.equal(queryTaskList(document, { mode: 'waiting' }, 2_000, 'normal').tasks[0].totalInvestedMs, 500);
});

test('resting transitions settle effort without mutating a frozen work history', () => {
  for (const status of ['waiting', 'snoozed', 'composted'] as const) {
    let document = create(taskDocument(), 100, 'Pause a running task');
    const id = document.tasks[0].id;
    document = accepted(toggleTimer(document, id, context(200)));
    Object.freeze(document.tasks[0].work);
    const next = accepted(status === 'snoozed'
      ? setSnoozeUntil(document, id, 2_000, context(700))
      : changeTaskStatus(document, id, status, context(700)));
    assert.equal(next.tasks[0].status.kind, status);
    assert.equal(next.runningSession, null);
    assert.equal(next.tasks[0].work[0].durationMs, 500);
    assert.equal(document.tasks[0].work.length, 0);
  }
});

test('clock rollback never creates negative work; manual effort is bounded; snoozes wake explicitly', () => {
  let document = create(taskDocument(), 1_000, 'Roll back safely');
  const id = document.tasks[0].id;
  document = accepted(toggleTimer(document, id, context(2_000)));
  document = accepted(toggleTimer(document, id, context(1_500)));
  assert.equal(document.tasks[0].work.length, 0);
  const rejectedEffort = addManualEffort(document, id, 12 * 60 * 60 * 1000 + 1, context(2_100));
  assert.equal(rejectedEffort.kind, 'rejected');
  document = accepted(addManualEffort(document, id, 4_000, context(2_200)));
  assert.equal(document.tasks[0].work[0].durationMs, 4_000);

  document = accepted(setSnoozeUntil(document, id, 5_000, context(2_300)));
  assert.equal(ripenessFor(document.tasks[0], 50_000, 'lively').ripeness, 'fresh');
  const before = document.tasks[0].createdAt;
  document = accepted(wakeSnoozedTasks(document, context(5_001)));
  assert.equal(document.tasks[0].status.kind, 'active');
  assert.equal(document.tasks[0].createdAt, before);
  assert.equal(wakeSnoozedTasks(document, context(5_001)).kind, 'accepted');
});

test('long-running timers split bounded entries without losing elapsed time', () => {
  const day = 86_400_000;
  let document = create(taskDocument(), 1_000, 'Long timer');
  const id = document.tasks[0].id;
  document = accepted(toggleTimer(document, id, context(2_000)));
  document = accepted(toggleTimer(document, id, context(2_000 + 31 * day + 123)));
  assert.deepEqual(document.tasks[0].work.map(entry => entry.durationMs), [30 * day, day + 123]);
  assert.equal(document.tasks[0].work.reduce((sum, entry) => sum + entry.durationMs, 0), 31 * day + 123);
});

test('Todoist capture import is scoped and idempotent; completion and restore queue ordered writebacks', () => {
  const capture = { source: { accountID: 'acct-1', projectID: 'project-1', taskID: 'remote-1' }, title: 'Imported', notes: '', tags: ['inbox'], priority: 'high' as const, createdAt: 42 };
  let document = accepted(importCaptures(taskDocument(), [capture], 'acct-1', 'project-1', context(100)));
  assert.equal(document.tasks[0].createdAt, 42, 'the provider capture age remains unchanged');
  assert.equal(accepted(importCaptures(document, [capture], 'acct-1', 'project-1', context(200))).tasks.length, 1);
  assert.equal(importCaptures(document, [capture], 'acct-2', 'project-1', context(200)).kind, 'rejected');

  document = accepted(updateTask(document, document.tasks[0].id, { title: 'Locally renamed' }, context(300)));
  document = accepted(importCaptures(document, [capture], 'acct-1', 'project-1', context(350)));
  assert.equal(document.tasks[0].title, 'Locally renamed', 'refresh does not overwrite locally edited tasks');
  const imported = document.tasks[0];
  assert.equal(imported.locallyEdited, true);
  document = accepted(changeTaskStatus(document, imported.id, 'completed', context(400)));
  document = accepted(changeTaskStatus(document, imported.id, 'active', context(500)));
  assert.deepEqual(document.todoistOutbox.map(operation => operation.completed), [true, false]);
  assert.notEqual(document.todoistOutbox[0].operationID, document.todoistOutbox[1].operationID);
  assert.equal(document.tasks[0].title, 'Locally renamed');
});

test('detail projects running time separately from recorded effort and owns its history copies', () => {
  let document = create(taskDocument(), 100, 'A focus session');
  const id = document.tasks[0].id;
  document = accepted(addManualEffort(document, id, 5_000, context(200)));
  document = accepted(toggleTimer(document, id, context(300)));
  const detail = queryTaskDetail(document, id, 800, 'normal')!;
  assert.equal(detail.totalInvestedMs, 5_000);
  assert.deepEqual(detail.running, { startedAt: 300, elapsedMs: 500 });
  assert.equal(detail.history[0].kind, 'worked');
  detail.history[0].at = 999;
  detail.workEntries[0].durationMs = 999;
  detail.status.kind = 'waiting';
  assert.equal(document.tasks[0].activities.at(-1)?.at, 200);
  assert.equal(document.tasks[0].work[0].durationMs, 5_000);
  assert.equal(document.tasks[0].status.kind, 'active');
  assert.equal(queryTaskDetail(document, 'missing', 800, 'normal'), null);
});

test('strict document decoding rejects invalid aggregate shapes and impossible timer ownership', () => {
  const valid = create(taskDocument(), 10, 'A');
  assert.throws(() => decodeTaskDocument({ ...valid, extra: true }), /invalid/i);
  assert.throws(() => decodeTaskDocument({ ...valid, tasks: [valid.tasks[0], valid.tasks[0]] }), /invalid/i);
  assert.throws(() => decodeTaskDocument({ ...valid, runningSession: { id: 'session', taskID: 'missing', startedAt: 1 } }), /running session/i);
  assert.throws(() => decodeTaskDocument({ ...valid, tasks: [{ ...valid.tasks[0], status: { kind: 'later' } }] }), /invalid/i);
  const task = valid.tasks[0];
  assert.throws(() => decodeTaskDocument({ ...valid, tasks: [{ ...task, updatedAt: 20, status: { kind: 'waiting' },
    activities: [...task.activities, { kind: 'stateChanged', at: 20, from: 'completed', to: 'waiting' }],
  }] }), /inconsistent/i);
  assert.throws(() => decodeTaskDocument({ ...valid, tasks: [{ ...task, updatedAt: 30,
    activities: [...task.activities, { kind: 'edited', at: 30 }, { kind: 'edited', at: 20 }],
  }] }), /inconsistent/i);
});
