export type TaskPriority = 'low' | 'normal' | 'high';
export type RipeningSpeed = 'gentle' | 'normal' | 'lively';

export type TaskStatus =
  | { kind: 'active' }
  | { kind: 'waiting' }
  | { kind: 'snoozed'; until: number }
  | { kind: 'completed'; at: number }
  | { kind: 'composted'; at: number };

export type TaskActivity =
  | { kind: 'created'; at: number }
  | { kind: 'progress'; at: number; note: string }
  | { kind: 'worked'; at: number; durationMs: number }
  | { kind: 'stateChanged'; at: number; from: TaskStatus['kind']; to: TaskStatus['kind'] }
  | { kind: 'edited'; at: number };

export type TodoistReference = { accountID: string; projectID: string; taskID: string };
export type TaskWorkEntry = { id: string; recordedAt: number; durationMs: number; source: 'timer' | 'manual' };
export type Task = {
  id: string;
  title: string;
  notes: string;
  tags: string[];
  priority: TaskPriority;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  lastProgressAt: number | null;
  activities: TaskActivity[];
  work: TaskWorkEntry[];
  importedFrom: TodoistReference | null;
  locallyEdited: boolean;
};

export type TodoistOutboxOperation = {
  operationID: string;
  source: TodoistReference;
  completed: boolean;
};

/** Local Tasks aggregate. No Notes or Viewer data is represented here. */
export type TaskDocument = {
  version: 1;
  tasks: Task[];
  runningSession: { id: string; taskID: string; startedAt: number } | null;
  todoistOutbox: TodoistOutboxOperation[];
};

export const EMPTY_TASK_DOCUMENT: TaskDocument = {
  version: 1,
  tasks: [],
  runningSession: null,
  todoistOutbox: [],
};

export const LIMITS = {
  title: 240,
  notes: 20_000,
  tags: 32,
  tag: 48,
  tasks: 10_000,
  activitiesPerTask: 2_000,
  workEntriesPerTask: 2_000,
  outbox: 10_000,
  id: 128,
  manualEffortMs: 12 * 60 * 60 * 1000,
  timerEffortMs: 30 * 24 * 60 * 60 * 1000,
} as const;

export function normalizeTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const title = value.trim();
  return title.length > 0 && title.length <= LIMITS.title && !/[\u0000-\u001f\u007f]/.test(title) ? title : null;
}

export function normalizeNotes(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > LIMITS.notes || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return null;
  return value;
}

export function normalizeTags(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > LIMITS.tags) return null;
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const tag = item.trim().normalize('NFC').replace(/\s+/g, ' ');
    if (!tag || tag.length > LIMITS.tag || /[\u0000-\u001f\u007f]/.test(tag)) return null;
    const key = tag.toLowerCase();
    if (!seen.has(key)) { seen.add(key); tags.push(tag); }
  }
  return tags;
}

export function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function validID(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= LIMITS.id && /^[\p{L}\p{N}._:-]+$/u.test(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}
function decodeReference(value: unknown): TodoistReference | null {
  const ref = record(value);
  return ref && exactKeys(ref, ['accountID', 'projectID', 'taskID']) && validID(ref.accountID) && validID(ref.projectID) && validID(ref.taskID)
    ? { accountID: ref.accountID, projectID: ref.projectID, taskID: ref.taskID } : null;
}
function validReference(value: unknown): value is TodoistReference { return decodeReference(value) !== null; }
function decodeStatus(value: unknown): TaskStatus | null {
  const status = record(value);
  if (!status) return null;
  if ((status.kind === 'active' || status.kind === 'waiting') && exactKeys(status, ['kind'])) return { kind: status.kind };
  if ((status.kind === 'snoozed' && exactKeys(status, ['kind', 'until']) && isFiniteTimestamp(status.until)) ||
      ((status.kind === 'completed' || status.kind === 'composted') && exactKeys(status, ['kind', 'at']) && isFiniteTimestamp(status.at))) {
    return status.kind === 'snoozed' ? { kind: 'snoozed', until: status.until as number } : { kind: status.kind, at: status.at as number };
  }
  return null;
}
function decodeActivity(value: unknown): TaskActivity | null {
  const activity = record(value);
  if (!activity || !isFiniteTimestamp(activity.at)) return null;
  if ((activity.kind === 'created' || activity.kind === 'edited') && exactKeys(activity, ['kind', 'at'])) return { kind: activity.kind, at: activity.at };
  if (activity.kind === 'progress' && exactKeys(activity, ['kind', 'at', 'note']) && typeof activity.note === 'string' && activity.note.length <= 1000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(activity.note)) {
    return { kind: 'progress', at: activity.at, note: activity.note };
  }
  if (activity.kind === 'worked' && exactKeys(activity, ['kind', 'at', 'durationMs']) && Number.isSafeInteger(activity.durationMs) && (activity.durationMs as number) > 0 && (activity.durationMs as number) <= LIMITS.timerEffortMs) {
    return { kind: 'worked', at: activity.at, durationMs: activity.durationMs as number };
  }
  if (activity.kind === 'stateChanged' && exactKeys(activity, ['kind', 'at', 'from', 'to']) && ['active', 'waiting', 'snoozed', 'completed', 'composted'].includes(String(activity.from)) &&
      ['active', 'waiting', 'snoozed', 'completed', 'composted'].includes(String(activity.to))) {
    return { kind: 'stateChanged', at: activity.at, from: activity.from as TaskStatus['kind'], to: activity.to as TaskStatus['kind'] };
  }
  return null;
}
function decodeWork(value: unknown): TaskWorkEntry | null {
  const entry = record(value);
  if (!entry || !exactKeys(entry, ['id', 'recordedAt', 'durationMs', 'source']) || !validID(entry.id) || !isFiniteTimestamp(entry.recordedAt) || !Number.isSafeInteger(entry.durationMs) ||
      (entry.durationMs as number) <= 0 || (entry.source !== 'timer' && entry.source !== 'manual') ||
      (entry.source === 'manual' ? (entry.durationMs as number) > LIMITS.manualEffortMs : (entry.durationMs as number) > LIMITS.timerEffortMs)) return null;
  return { id: entry.id, recordedAt: entry.recordedAt, durationMs: entry.durationMs as number, source: entry.source };
}
/** Strict adapter boundary decoder. Invalid or future-shaped data is rejected, never repaired silently. */
export function decodeTaskDocument(value: unknown): TaskDocument {
  const doc = record(value);
  if (!doc || !exactKeys(doc, ['version', 'tasks', 'runningSession', 'todoistOutbox']) || doc.version !== 1 || !Array.isArray(doc.tasks) || doc.tasks.length > LIMITS.tasks ||
      !Array.isArray(doc.todoistOutbox) || doc.todoistOutbox.length > LIMITS.outbox) throw new Error('The Tasks document is invalid.');
  const tasks: Task[] = [];
  const taskIDs = new Set<string>();
  const importedKeys = new Set<string>();
  for (const raw of doc.tasks) {
    const task = record(raw);
    if (!task || !exactKeys(task, ['id', 'title', 'notes', 'tags', 'priority', 'status', 'createdAt', 'updatedAt', 'lastProgressAt', 'activities', 'work', 'importedFrom', 'locallyEdited']) || !validID(task.id) || taskIDs.has(task.id) || !isFiniteTimestamp(task.createdAt) || !isFiniteTimestamp(task.updatedAt) ||
        (task.lastProgressAt !== null && !isFiniteTimestamp(task.lastProgressAt)) || !Array.isArray(task.activities) ||
        task.activities.length === 0 || task.activities.length > LIMITS.activitiesPerTask || !Array.isArray(task.work) ||
        task.work.length > LIMITS.workEntriesPerTask || !['low', 'normal', 'high'].includes(String(task.priority)) ||
        typeof task.locallyEdited !== 'boolean') throw new Error('The Tasks document is invalid.');
    const rawTags = task.tags as unknown[];
    const title = normalizeTitle(task.title), notes = normalizeNotes(task.notes), tags = normalizeTags(rawTags), status = decodeStatus(task.status);
    if (title === null || title !== task.title || notes === null || notes !== task.notes || tags === null ||
        tags.length !== rawTags.length || tags.some((tag, index) => tag !== rawTags[index]) || status === null) throw new Error('The Tasks document is invalid.');
    const activities = task.activities.map(decodeActivity);
    const work = task.work.map(decodeWork);
    if (activities.some(item => item === null) || work.some(item => item === null) ||
        activities[0]?.kind !== 'created' || activities[0].at !== task.createdAt || activities.filter(item => item?.kind === 'created').length !== 1) {
      throw new Error('The Tasks document is invalid.');
    }
    const importedFrom = task.importedFrom === null ? null : decodeReference(task.importedFrom);
    if (task.importedFrom !== null && importedFrom === null) throw new Error('The Tasks document is invalid.');
    if (importedFrom) {
      const key = `${importedFrom.accountID}\u0000${importedFrom.projectID}\u0000${importedFrom.taskID}`;
      if (importedKeys.has(key)) throw new Error('The Tasks document contains duplicate imported tasks.');
      importedKeys.add(key);
    }
    if (task.lastProgressAt !== null && !activities.some(item => item?.kind === 'progress' && item.at === task.lastProgressAt)) throw new Error('The Tasks document is invalid.');
    taskIDs.add(task.id);
    tasks.push({ id: task.id, title, notes, tags, priority: task.priority as TaskPriority, status,
      createdAt: task.createdAt, updatedAt: task.updatedAt, lastProgressAt: task.lastProgressAt as number | null,
      activities: activities as TaskActivity[], work: work as TaskWorkEntry[], importedFrom, locallyEdited: task.locallyEdited });
  }

  let runningSession: TaskDocument['runningSession'] = null;
  if (doc.runningSession !== null) {
    const session = record(doc.runningSession);
    if (!session || !exactKeys(session, ['id', 'taskID', 'startedAt']) || !validID(session.id) || !validID(session.taskID) || !isFiniteTimestamp(session.startedAt) ||
        !taskIDs.has(session.taskID) || tasks.find(task => task.id === session.taskID)?.status.kind !== 'active') throw new Error('The Tasks document has an invalid running session.');
    runningSession = { id: session.id, taskID: session.taskID, startedAt: session.startedAt };
  }
  const operations: TodoistOutboxOperation[] = [];
  const operationIDs = new Set<string>();
  for (const raw of doc.todoistOutbox) {
    const operation = record(raw);
    if (!operation || !exactKeys(operation, ['operationID', 'source', 'completed']) || !validID(operation.operationID) || operationIDs.has(operation.operationID) || !validReference(operation.source) || typeof operation.completed !== 'boolean' ||
        !importedKeys.has(todoistReferenceKey(operation.source))) {
      throw new Error('The Tasks document contains an invalid Todoist outbox operation.');
    }
    operationIDs.add(operation.operationID);
    operations.push({ operationID: operation.operationID, source: decodeReference(operation.source)!, completed: operation.completed });
  }
  if (tasks.some(task => {
    const progressTimes = task.activities.filter((item): item is Extract<TaskActivity, { kind: 'progress' }> => item.kind === 'progress').map(item => item.at);
    const latestProgress = progressTimes.length ? Math.max(...progressTimes) : null;
    const stateHistory = task.activities.filter((item): item is Extract<TaskActivity, { kind: 'stateChanged' }> => item.kind === 'stateChanged');
    const latestState = stateHistory.at(-1);
    const worked = task.activities.filter((item): item is Extract<TaskActivity, { kind: 'worked' }> => item.kind === 'worked');
    const workKeys = new Map<string, number>();
    for (const entry of task.work) workKeys.set(`${entry.recordedAt}:${entry.durationMs}`, (workKeys.get(`${entry.recordedAt}:${entry.durationMs}`) ?? 0) + 1);
    for (const entry of worked) {
      const key = `${entry.at}:${entry.durationMs}`;
      const count = workKeys.get(key) ?? 0;
      if (count < 1) return true;
      workKeys.set(key, count - 1);
    }
    return task.updatedAt < task.createdAt || (task.lastProgressAt !== null && task.lastProgressAt < task.createdAt) ||
      task.lastProgressAt !== latestProgress || (latestState ? latestState.to !== task.status.kind : task.status.kind !== 'active') ||
      ((task.status.kind === 'completed' || task.status.kind === 'composted') && latestState?.at !== task.status.at) ||
      (task.status.kind === 'snoozed' && (!latestState || task.status.until <= latestState.at)) ||
      worked.length !== task.work.length || [...workKeys.values()].some(count => count !== 0) ||
      task.activities.some((item, index) => item.at < task.createdAt || item.at > task.updatedAt ||
        (index > 0 && item.at < task.activities[index - 1].at)) ||
      stateHistory.some((item, index) => item.from !== (index === 0 ? 'active' : stateHistory[index - 1].to)) ||
      task.work.some(item => item.recordedAt < task.createdAt || item.recordedAt > task.updatedAt) ||
      new Set(task.work.map(item => item.id)).size !== task.work.length;
  })) throw new Error('The Tasks document contains inconsistent timestamps or task history.');
  return { version: 1, tasks, runningSession, todoistOutbox: operations };
}

export function totalEffortMs(task: Task): number {
  return task.work.reduce((total, entry) => total + entry.durationMs, 0);
}

export function todoistReferenceKey(reference: TodoistReference): string {
  return `${reference.accountID}\u0000${reference.projectID}\u0000${reference.taskID}`;
}

export function validateTaskDocument(value: unknown): TaskDocument {
  return decodeTaskDocument(value);
}
