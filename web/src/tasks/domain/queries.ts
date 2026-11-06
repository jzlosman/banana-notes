import { totalEffortMs, type RipeningSpeed, type Task, type TaskActivity, type TaskDocument, type TaskStatus } from './model';

export type TaskListMode = 'active' | 'waiting' | 'completed' | 'composted';
export type TaskListQuery = { mode: TaskListMode; tag?: string; groupByTag?: boolean };
export type Ripeness = 'fresh' | 'ripe' | 'spotty' | 'veryRipe';
export type TaskReadModel = {
  id: string;
  title: string;
  notes: string;
  tags: string[];
  priority: Task['priority'];
  status: TaskStatus;
  createdAt: number;
  rawAgeMs: number;
  inactivityMs: number;
  totalInvestedMs: number;
  lastProgressAt: number | null;
  ripeness: Ripeness;
  imported: boolean;
};
export type TaskDetailReadModel = TaskReadModel & {
  history: TaskActivity[];
  workEntries: { id: string; recordedAt: number; durationMs: number; source: 'timer' | 'manual' }[];
  running: { startedAt: number; elapsedMs: number } | null;
};
export type TaskGroup = { tag: string | null; tasks: TaskReadModel[] };
export type TaskListReadModel = { mode: TaskListMode; tasks: TaskReadModel[]; groups: TaskGroup[] | null };

const DAY = 24 * 60 * 60 * 1000;
const thresholds: Record<RipeningSpeed, readonly [number, number, number]> = {
  gentle: [14, 30, 60], normal: [3, 7, 14], lively: [1, 3, 7],
};
function priorityWeight(priority: Task['priority']): number {
  return priority === 'high' ? 0.7 : priority === 'low' ? 1.3 : 1;
}

function activeInactivityMs(task: Task, now: number): number {
  let elapsed = 0;
  let cursor = task.createdAt;
  let status: TaskStatus['kind'] = 'active';
  for (const activity of task.activities) {
    if (activity.at > now) break;
    if (status === 'active') elapsed += Math.max(0, activity.at - cursor);
    cursor = activity.at;
    if (activity.kind === 'progress') elapsed = 0;
    else if (activity.kind === 'stateChanged') status = activity.to;
  }
  return elapsed + (status === 'active' ? Math.max(0, now - cursor) : 0);
}

export function ripenessFor(task: Task, now: number, speed: RipeningSpeed): { ripeness: Ripeness; inactivityMs: number } {
  const inactivityMs = activeInactivityMs(task, now);
  if (task.status.kind !== 'active') return { ripeness: 'fresh', inactivityMs };
  const days = inactivityMs / DAY / priorityWeight(task.priority);
  const [ripe, spotty, veryRipe] = thresholds[speed];
  return { ripeness: days < ripe ? 'fresh' : days < spotty ? 'ripe' : days < veryRipe ? 'spotty' : 'veryRipe', inactivityMs };
}

function toReadModel(task: Task, now: number, speed: RipeningSpeed): TaskReadModel {
  const ripeness = ripenessFor(task, now, speed);
  return {
    id: task.id, title: task.title, notes: task.notes, tags: [...task.tags], priority: task.priority,
    status: { ...task.status }, createdAt: task.createdAt, rawAgeMs: Math.max(0, now - task.createdAt),
    inactivityMs: ripeness.inactivityMs, totalInvestedMs: totalEffortMs(task), lastProgressAt: task.lastProgressAt,
    ripeness: ripeness.ripeness, imported: task.importedFrom !== null,
  };
}
/** Detail/history projection owns copies, not references into the aggregate. */
export function queryTaskDetail(library: TaskDocument, taskID: string, now: number, speed: RipeningSpeed): TaskDetailReadModel | null {
  const task = library.tasks.find(item => item.id === taskID);
  if (!task) return null;
  const session = library.runningSession;
  return {
    ...toReadModel(task, now, speed),
    history: task.activities.map(activity => ({ ...activity })).reverse(),
    workEntries: task.work.map(entry => ({ ...entry })),
    running: session?.taskID === taskID ? { startedAt: session.startedAt, elapsedMs: Math.max(0, now - session.startedAt) } : null,
  };
}

function matchesMode(task: Task, mode: TaskListMode): boolean {
  if (mode === 'active') return task.status.kind === 'active' || task.status.kind === 'snoozed';
  return task.status.kind === mode;
}
function normalizedTag(tag: string): string { return tag.trim().normalize('NFC').replace(/\s+/g, ' ').toLowerCase(); }
function stableSort(a: TaskReadModel, b: TaskReadModel): number {
  return b.createdAt - a.createdAt || a.id.localeCompare(b.id, 'en');
}

/** Pure purpose-built list model. Grouping is a view, not persisted task state. */
export function queryTaskList(library: TaskDocument, query: TaskListQuery, now: number, speed: RipeningSpeed): TaskListReadModel {
  const needle = query.tag === undefined ? null : normalizedTag(query.tag);
  const tasks = library.tasks.filter(task => matchesMode(task, query.mode) &&
      (needle === null || task.tags.some(tag => normalizedTag(tag) === needle)))
    .map(task => toReadModel(task, now, speed)).sort(stableSort);
  if (!query.groupByTag) return { mode: query.mode, tasks, groups: null };
  const grouped = new Map<string, { tag: string | null; tasks: TaskReadModel[] }>();
  for (const task of tasks) {
    const tags = task.tags.length ? task.tags : [''];
    for (const tag of tags) {
      if (needle !== null && normalizedTag(tag) !== needle) continue;
      const key = normalizedTag(tag);
      const group = grouped.get(key) ?? { tag: tag || null, tasks: [] };
      group.tasks.push(task); grouped.set(key, group);
    }
  }
  const groups = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([, group]) => ({ tag: group.tag, tasks: group.tasks.sort(stableSort) }));
  return { mode: query.mode, tasks, groups };
}

export type AgentBrief = {
  taskID: string;
  sections: {
    context: string;
    permissions: { canReadSelectedTask: true; canReadNotes: true; canReadTags: true; canReadEffort: true; canChangeTasks: false; canContactServices: false };
    outcome: string;
  };
  text: string;
};

/** A read-only, explicit briefing. It does not invoke a model or grant execution permissions. */
export function queryAgentBrief(library: TaskDocument, taskID: string): AgentBrief | null {
  const task = library.tasks.find(item => item.id === taskID);
  if (!task) return null;
  const duration = totalEffortMs(task);
  const context = [
    `Task: ${task.title}`,
    `Notes: ${task.notes.trim() || '(none)'}`,
    `Tags: ${task.tags.length ? task.tags.join(', ') : '(none)'}`,
    `Recorded effort: ${duration} ms`,
  ].join('\n');
  const permissions = {
    canReadSelectedTask: true as const, canReadNotes: true as const, canReadTags: true as const, canReadEffort: true as const,
    canChangeTasks: false as const, canContactServices: false as const,
  };
  const outcome = 'Read-only context only. No task changes, external actions, or autonomous execution are authorized.';
  return { taskID, sections: { context, permissions, outcome }, text: `${context}\n\nPermissions: read selected task, notes, tags, and recorded effort only; no task changes or service access.\n\nOutcome: ${outcome}` };
}
