import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TASKS_PREFERENCES, TasksController } from '../src/tasks/application/controller';
import type { TasksPorts } from '../src/tasks/application/ports';
import type { Task, TaskDocument } from '../src/tasks/domain/model';
import { queryTagCatalog } from '../src/tasks/domain/queries';

function task(
  id: string,
  updatedAt: number,
  tags: string[],
  status: Task['status']['kind'] = 'active',
): Task {
  const taskStatus: Task['status'] = status === 'active' || status === 'waiting'
    ? { kind: status }
    : status === 'snoozed' ? { kind: status, until: updatedAt + 1 } : { kind: status, at: updatedAt };
  return {
    id, title: id, notes: '', tags, priority: 'normal', status: taskStatus, createdAt: 0, updatedAt,
    lastProgressAt: null,
    activities: [
      { kind: 'created', at: 0 },
      ...(status === 'active' ? [] : [{ kind: 'stateChanged' as const, at: updatedAt, from: 'active' as const, to: status }]),
    ],
    work: [], importedFrom: null, locallyEdited: false,
  };
}
function document(tasks: Task[]): TaskDocument {
  return { version: 1, tasks, runningSession: null, todoistOutbox: [] };
}

function appPorts(initialDocument: TaskDocument): TasksPorts {
  return {
    clock: { now: () => 10_000 },
    identities: { next: () => 'unused-id' },
    store: {
      load: async () => ({ kind: 'ready', document: initialDocument, revision: 'r0' }),
      save: async () => ({ kind: 'saved', revision: 'r1' }),
    },
    preferences: {
      load: async () => ({ ...DEFAULT_TASKS_PREFERENCES }),
      save: async candidate => ({ ...candidate }),
    },
    todoist: {
      connection: async () => ({ kind: 'disconnected' }),
      connect: async () => ({ connection: { kind: 'disconnected' }, projects: [] }),
      disconnect: async () => undefined,
      projects: async () => [],
      selectProject: async () => ({ kind: 'disconnected' }),
      captures: async () => [],
      setCompleted: async () => undefined,
    },
    calendar: {
      authorization: async () => 'unavailable',
      requestAccess: async () => 'unavailable',
      calendars: async () => [],
      appointments: async () => [],
      createBlock: async draft => ({ id: draft.blockID, start: draft.start, end: draft.end, calendarID: draft.calendarID }),
    },
    window: {
      environment: 'preview', subscribe: () => () => undefined,
      acknowledgeFlush: async () => undefined, setDragRegion: async () => undefined, copyText: async () => undefined,
    },
  };
}

test('tag catalog normalizes identity, counts each task once, and includes completed but excludes composted work', () => {
  const catalog = queryTagCatalog(document([
    task('active', 300, ['  Project   X ', 'project x', 'CAFÉ', 'Cafe\u0301']),
    task('waiting', 100, ['project x', 'café'], 'waiting'),
    task('snoozed', 250, ['Resting'], 'snoozed'),
    task('completed', 400, ['Project X', 'Ship'], 'completed'),
    task('composted', 900, ['Project X', 'Discarded'], 'composted'),
  ]));

  assert.deepEqual(catalog, [
    { key: 'project x', label: 'Project X', taskCount: 3, lastTaskActivityAt: 400 },
    { key: 'café', label: 'CAFÉ', taskCount: 2, lastTaskActivityAt: 300 },
    { key: 'ship', label: 'Ship', taskCount: 1, lastTaskActivityAt: 400 },
    { key: 'resting', label: 'Resting', taskCount: 1, lastTaskActivityAt: 250 },
  ]);
  assert.equal(catalog.some(entry => entry.key === 'discarded'), false);
});

test('popularity sorts first, then recency and canonical name; ties choose a stable recent-task label', () => {
  const tasks = [
    task('popular-old', 100, ['popular', 'pair']),
    task('popular-new', 300, ['POPULAR', 'Pair']),
    task('recent', 500, ['recent', 'Beta', 'alpha']),
    task('older', 400, ['older', 'BETA', 'Alpha']),
    task('tie-z', 600, ['LABEL']),
    task('tie-a', 600, ['Label']),
  ];
  const forward = queryTagCatalog(document(tasks));
  const reversed = queryTagCatalog(document([...tasks].reverse()));

  assert.deepEqual(forward, reversed, 'catalog order and labels do not depend on document order');
  assert.deepEqual(forward.map(entry => entry.key), ['label', 'alpha', 'beta', 'pair', 'popular', 'recent', 'older']);
  assert.equal(forward.find(entry => entry.key === 'label')?.label, 'Label', 'equal activity uses the lexically first task ID');
  assert.deepEqual(forward.find(entry => entry.key === 'pair'), {
    key: 'pair', label: 'Pair', taskCount: 2, lastTaskActivityAt: 300,
  });
});

test('catalog is a non-mutating projection with fresh result copies', () => {
  const source = document([task('one', 10, ['Work']), task('two', 20, ['work'])]);
  const frozenTasks = source.tasks.map(item => Object.freeze({ ...item, tags: Object.freeze([...item.tags]) as unknown as string[] }));
  const frozen = Object.freeze({ ...source, tasks: Object.freeze(frozenTasks) as unknown as Task[] }) as TaskDocument;
  const before = JSON.stringify(frozen);
  const first = queryTagCatalog(frozen);
  first[0].label = 'changed';
  first.pop();

  assert.equal(JSON.stringify(frozen), before);
  assert.deepEqual(queryTagCatalog(frozen), [
    { key: 'work', label: 'work', taskCount: 2, lastTaskActivityAt: 20 },
  ]);
});

test('facade query returns a copied catalog and an empty list while unavailable', async () => {
  const controller = new TasksController(appPorts(document([task('seed', 42, ['Focus'])])));
  assert.deepEqual(controller.queryTagCatalog(), []);

  await controller.initialize();
  const first = controller.queryTagCatalog();
  first[0].label = 'mutated';
  first.length = 0;
  assert.deepEqual(controller.queryTagCatalog(), [
    { key: 'focus', label: 'Focus', taskCount: 1, lastTaskActivityAt: 42 },
  ]);

  controller.dispose();
  assert.deepEqual(controller.queryTagCatalog(), []);
});
