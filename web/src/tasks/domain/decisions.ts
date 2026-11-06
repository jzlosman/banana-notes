import {
  LIMITS, normalizeNotes, normalizeTags, normalizeTitle, todoistReferenceKey,
  validateTaskDocument, type Task, type TaskDocument, type TaskPriority, type TaskStatus,
  type TodoistOutboxOperation, type TodoistReference,
} from './model';
export type CapturedTask = {
  source: TodoistReference;
  title: string;
  notes: string;
  tags: string[];
  priority: TaskPriority;
  createdAt: number | null;
};

export type DomainFailure =
  | 'invalid_input' | 'not_found' | 'invalid_transition' | 'task_not_active'
  | 'timer_not_running' | 'effort_limit' | 'activity_limit';
export type Decision<T> = { kind: 'accepted'; value: T } | { kind: 'rejected'; reason: DomainFailure };
export type DecisionContext = { now: number; nextID(): string };

const rejected = <T>(reason: DomainFailure): Decision<T> => ({ kind: 'rejected', reason });
const accepted = <T>(value: T): Decision<T> => ({ kind: 'accepted', value });
function taskIndex(library: TaskDocument, taskID: string): number { return library.tasks.findIndex(task => task.id === taskID); }
function addActivity(task: Task, activity: Task['activities'][number]): boolean {
  if (task.activities.length >= LIMITS.activitiesPerTask) return false;
  task.activities.push(activity);
  return true;
}
function appendTimerEffort(task: Task, session: NonNullable<TaskDocument['runningSession']>, now: number, context: DecisionContext): DomainFailure | null {
  const total = Math.max(0, now - session.startedAt);
  if (!Number.isSafeInteger(total)) return 'invalid_input';
  const count = Math.ceil(total / LIMITS.timerEffortMs);
  if (task.work.length + count > LIMITS.workEntriesPerTask) return 'effort_limit';
  if (task.activities.length + count > LIMITS.activitiesPerTask) return 'activity_limit';
  let remaining = total;
  let elapsed = 0;
  while (remaining > 0) {
    const durationMs = Math.min(remaining, LIMITS.timerEffortMs);
    elapsed += durationMs;
    const recordedAt = Math.max(session.startedAt + elapsed, task.updatedAt, now);
    task.work.push({ id: context.nextID(), recordedAt, durationMs, source: 'timer' });
    task.activities.push({ kind: 'worked', at: recordedAt, durationMs });
    remaining -= durationMs;
  }
  if (total > 0) {
    task.updatedAt = Math.max(task.updatedAt, now);
    if (task.importedFrom) task.locallyEdited = true;
  }
  return null;
}
function checkClock(now: number): boolean { return Number.isSafeInteger(now) && now >= 0; }
function updated(doc: TaskDocument): TaskDocument {
  return validateTaskDocument(doc);
}

export type CreateTaskInput = { title: string; notes?: string; tags?: string[]; priority?: TaskPriority };
export function createTask(library: TaskDocument, input: CreateTaskInput, context: DecisionContext): Decision<TaskDocument> {
  const title = normalizeTitle(input.title), notes = normalizeNotes(input.notes ?? ''), tags = normalizeTags(input.tags ?? []);
  if (!checkClock(context.now) || !title || notes === null || tags === null ||
      (input.priority !== undefined && !['low', 'normal', 'high'].includes(input.priority))) return rejected('invalid_input');
  if (library.tasks.length >= LIMITS.tasks) return rejected('effort_limit');
  const id = context.nextID();
  const task: Task = {
    id, title, notes, tags, priority: input.priority ?? 'normal', status: { kind: 'active' },
    createdAt: context.now, updatedAt: context.now, lastProgressAt: null,
    activities: [{ kind: 'created', at: context.now }], work: [], importedFrom: null, locallyEdited: false,
  };
  try { return accepted(updated({ ...library, tasks: [...library.tasks, task] })); }
  catch { return rejected('invalid_input'); }
}

export type UpdateTaskInput = { title?: string; notes?: string; tags?: string[]; priority?: TaskPriority };
export function updateTask(library: TaskDocument, taskID: string, patch: UpdateTaskInput, context: DecisionContext): Decision<TaskDocument> {
  const index = taskIndex(library, taskID);
  if (index < 0) return rejected('not_found');
  if (!checkClock(context.now) || context.now < library.tasks[index].updatedAt || !patch || Object.keys(patch).length === 0 ||
      Object.keys(patch).some(key => !['title', 'notes', 'tags', 'priority'].includes(key))) return rejected('invalid_input');
  const current = library.tasks[index];
  const title = patch.title === undefined ? current.title : normalizeTitle(patch.title);
  const notes = patch.notes === undefined ? current.notes : normalizeNotes(patch.notes);
  const tags = patch.tags === undefined ? current.tags : normalizeTags(patch.tags);
  if (!title || notes === null || tags === null || (patch.priority !== undefined && !['low', 'normal', 'high'].includes(patch.priority))) return rejected('invalid_input');
  const task = { ...current, title, notes, tags, priority: patch.priority ?? current.priority, updatedAt: context.now, locallyEdited: current.importedFrom ? true : current.locallyEdited,
    activities: [...current.activities] };
  if (!addActivity(task, { kind: 'edited', at: context.now })) return rejected('activity_limit');
  const tasks = [...library.tasks]; tasks[index] = task;
  try { return accepted(updated({ ...library, tasks })); } catch { return rejected('invalid_input'); }
}

export type RequestedTaskStatus = 'active' | 'waiting' | 'snoozed' | 'completed' | 'composted';
export function changeTaskStatus(library: TaskDocument, taskID: string, target: RequestedTaskStatus, context: DecisionContext): Decision<TaskDocument> {
  const index = taskIndex(library, taskID);
  if (index < 0) return rejected('not_found');
  if (!checkClock(context.now) || context.now < library.tasks[index].updatedAt || !['active', 'waiting', 'snoozed', 'completed', 'composted'].includes(target)) return rejected('invalid_input');
  const current = library.tasks[index];
  if (current.status.kind === target && target !== 'snoozed') return rejected('invalid_transition');
  if (current.status.kind === 'composted' && target !== 'active') return rejected('invalid_transition');
  const nextStatus: TaskStatus = target === 'snoozed'
    ? { kind: 'snoozed', until: context.now + 24 * 60 * 60 * 1000 }
    : target === 'completed' || target === 'composted' ? { kind: target, at: context.now } : { kind: target };
  const tasks = [...library.tasks];
  const task = { ...current, status: nextStatus, updatedAt: context.now, locallyEdited: current.importedFrom ? true : current.locallyEdited, activities: [...current.activities], work: [...current.work] };
  if (!addActivity(task, { kind: 'stateChanged', at: context.now, from: current.status.kind, to: target })) return rejected('activity_limit');
  tasks[index] = task;
  let runningSession = library.runningSession;
  let outbox = [...library.todoistOutbox];
  if (runningSession?.taskID === taskID && target !== 'active') {
    const failure = appendTimerEffort(task, runningSession, context.now, context);
    if (failure) return rejected(failure);
    runningSession = null;
  }
  if (current.importedFrom && ((current.status.kind !== 'completed' && target === 'completed') ||
      (current.status.kind === 'completed' && target !== 'completed' && target !== 'composted') ||
      (current.status.kind === 'composted' && target === 'active'))) {
    const operation: TodoistOutboxOperation = { operationID: context.nextID(), source: current.importedFrom, completed: target === 'completed' };
    if (outbox.length >= LIMITS.outbox) return rejected('effort_limit');
    outbox.push(operation);
  }
  try { return accepted(updated({ ...library, tasks, runningSession, todoistOutbox: outbox })); }
  catch { return rejected('invalid_input'); }
}

export function setSnoozeUntil(library: TaskDocument, taskID: string, until: number, context: DecisionContext): Decision<TaskDocument> {
  const index = taskIndex(library, taskID);
  if (index < 0) return rejected('not_found');
  if (!checkClock(context.now) || context.now < library.tasks[index].updatedAt || !Number.isSafeInteger(until) || until <= context.now) return rejected('invalid_input');
  const current = library.tasks[index];
  if (current.status.kind === 'composted' || current.status.kind === 'completed') return rejected('invalid_transition');
  const task = { ...current, status: { kind: 'snoozed' as const, until }, updatedAt: context.now, locallyEdited: current.importedFrom ? true : current.locallyEdited, activities: [...current.activities], work: [...current.work] };
  if (!addActivity(task, { kind: 'stateChanged', at: context.now, from: current.status.kind, to: 'snoozed' })) return rejected('activity_limit');
  const tasks = [...library.tasks]; tasks[index] = task;
  let runningSession = library.runningSession;
  if (runningSession?.taskID === taskID) {
    const failure = appendTimerEffort(task, runningSession, context.now, context);
    if (failure) return rejected(failure);
    runningSession = null;
  }
  try { return accepted(updated({ ...library, tasks, runningSession })); } catch { return rejected('invalid_input'); }
}

export function addProgress(library: TaskDocument, taskID: string, note: string, context: DecisionContext): Decision<TaskDocument> {
  const index = taskIndex(library, taskID);
  if (index < 0) return rejected('not_found');
  const cleanNote = note.trim();
  if (!checkClock(context.now) || context.now < library.tasks[index].updatedAt || cleanNote.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(cleanNote)) return rejected('invalid_input');
  const current = library.tasks[index];
  const task = { ...current, updatedAt: context.now, lastProgressAt: context.now, locallyEdited: current.importedFrom ? true : current.locallyEdited,
    activities: [...current.activities] };
  if (!addActivity(task, { kind: 'progress', at: context.now, note: cleanNote })) return rejected('activity_limit');
  const tasks = [...library.tasks]; tasks[index] = task;
  try { return accepted(updated({ ...library, tasks })); } catch { return rejected('invalid_input'); }
}

export function addManualEffort(library: TaskDocument, taskID: string, durationMs: number, context: DecisionContext): Decision<TaskDocument> {
  const index = taskIndex(library, taskID);
  if (index < 0) return rejected('not_found');
  if (!checkClock(context.now) || context.now < library.tasks[index].updatedAt || !Number.isSafeInteger(durationMs) || durationMs <= 0 || durationMs > LIMITS.manualEffortMs) return rejected('invalid_input');
  const current = library.tasks[index];
  if (current.work.length >= LIMITS.workEntriesPerTask || current.activities.length >= LIMITS.activitiesPerTask) return rejected('effort_limit');
  const entry = { id: context.nextID(), recordedAt: context.now, durationMs, source: 'manual' as const };
  const task = { ...current, updatedAt: context.now, locallyEdited: current.importedFrom ? true : current.locallyEdited,
    work: [...current.work, entry], activities: [...current.activities, { kind: 'worked' as const, at: context.now, durationMs }] };
  const tasks = [...library.tasks]; tasks[index] = task;
  try { return accepted(updated({ ...library, tasks })); } catch { return rejected('invalid_input'); }
}

function settleRunning(library: TaskDocument, now: number, context: DecisionContext): { tasks: Task[]; runningSession: TaskDocument['runningSession']; failure?: DomainFailure } {
  const tasks = library.tasks.map(task => ({ ...task, activities: [...task.activities], work: [...task.work] }));
  const session = library.runningSession;
  if (!session) return { tasks, runningSession: null };
  const task = tasks.find(item => item.id === session.taskID);
  if (!task || task.status.kind !== 'active') return { tasks, runningSession: null };
  const failure = appendTimerEffort(task, session, now, context);
  if (failure) return { tasks, runningSession: session, failure };
  return { tasks, runningSession: null };
}

export function toggleTimer(library: TaskDocument, taskID: string, context: DecisionContext): Decision<TaskDocument> {
  const index = taskIndex(library, taskID);
  if (index < 0) return rejected('not_found');
  if (!checkClock(context.now)) return rejected('invalid_input');
  if (library.runningSession?.taskID === taskID) {
    const settled = settleRunning(library, context.now, context);
    if (settled.failure) return rejected(settled.failure);
    return accepted(updated({ ...library, tasks: settled.tasks, runningSession: null }));
  }
  if (library.tasks[index].status.kind !== 'active') return rejected('task_not_active');
  if (context.now < library.tasks[index].updatedAt) return rejected('invalid_input');
  const settled = settleRunning(library, context.now, context);
  if (settled.failure) return rejected(settled.failure);
  const runningSession = { id: context.nextID(), taskID, startedAt: context.now };
  try { return accepted(updated({ ...library, tasks: settled.tasks, runningSession })); } catch { return rejected('invalid_input'); }
}

export function stopTimer(library: TaskDocument, context: DecisionContext): Decision<TaskDocument> {
  if (!checkClock(context.now)) return rejected('invalid_input');
  if (!library.runningSession) return rejected('timer_not_running');
  const settled = settleRunning(library, context.now, context);
  if (settled.failure) return rejected(settled.failure);
  try { return accepted(updated({ ...library, tasks: settled.tasks, runningSession: null })); } catch { return rejected('invalid_input'); }
}

/** A deterministic clock stage; due snoozes wake without modifying their original capture time. */
export function wakeSnoozedTasks(library: TaskDocument, context: DecisionContext): Decision<TaskDocument> {
  if (!checkClock(context.now)) return rejected('invalid_input');
  const changed: Task[] = [];
  let didChange = false;
  for (const current of library.tasks) {
    if (current.status.kind !== 'snoozed' || current.status.until > context.now) { changed.push(current); continue; }
    if (context.now < current.updatedAt) return rejected('invalid_input');
    if (current.activities.length >= LIMITS.activitiesPerTask) return rejected('activity_limit');
    changed.push({ ...current, status: { kind: 'active' }, updatedAt: context.now,
      activities: [...current.activities, { kind: 'stateChanged', at: context.now, from: 'snoozed', to: 'active' }] });
    didChange = true;
  }
  if (!didChange) return accepted(library);
  try { return accepted(updated({ ...library, tasks: changed })); } catch { return rejected('invalid_input'); }
}

function validCapture(capture: CapturedTask): boolean {
  return !!capture && !!capture.source && typeof capture.source.accountID === 'string' && typeof capture.source.projectID === 'string' &&
    typeof capture.source.taskID === 'string' && !!normalizeTitle(capture.title) && normalizeNotes(capture.notes) !== null &&
    normalizeTags(capture.tags) !== null && ['low', 'normal', 'high'].includes(capture.priority) &&
    (capture.createdAt === null || (Number.isSafeInteger(capture.createdAt) && capture.createdAt >= 0));
}

/** Explicit capture import only; local-origin tasks are never uploaded. */
export function importCaptures(library: TaskDocument, captures: CapturedTask[], accountID: string, projectID: string, context: DecisionContext): Decision<TaskDocument> {
  if (!checkClock(context.now) || !Array.isArray(captures) || !accountID || !projectID) return rejected('invalid_input');
  const currentKeys = new Set(library.tasks.flatMap(task => task.importedFrom ? [todoistReferenceKey(task.importedFrom)] : []));
  const tasks = [...library.tasks];
  for (const capture of captures) {
    if (!validCapture(capture) || capture.source.accountID !== accountID || capture.source.projectID !== projectID) return rejected('invalid_input');
    const key = todoistReferenceKey(capture.source);
    if (currentKeys.has(key)) continue;
    if (tasks.length >= LIMITS.tasks) return rejected('effort_limit');
    const id = context.nextID();
    const createdAt = capture.createdAt ?? context.now;
    tasks.push({ id, title: normalizeTitle(capture.title)!, notes: normalizeNotes(capture.notes)!, tags: normalizeTags(capture.tags)!,
      priority: capture.priority, status: { kind: 'active' }, createdAt, updatedAt: Math.max(createdAt, context.now), lastProgressAt: null,
      activities: [{ kind: 'created', at: createdAt }], work: [], importedFrom: capture.source, locallyEdited: false });
    currentKeys.add(key);
  }
  try { return accepted(updated({ ...library, tasks })); } catch { return rejected('invalid_input'); }
}

export function removeTodoistOperation(library: TaskDocument, operationID: string): Decision<TaskDocument> {
  const operation = library.todoistOutbox.find(item => item.operationID === operationID);
  if (!operation) return rejected('not_found');
  return accepted({ ...library, todoistOutbox: library.todoistOutbox.filter(item => item.operationID !== operationID) });
}
