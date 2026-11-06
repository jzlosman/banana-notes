import type { TaskDocument } from '../domain/model';

/** Effects owned by the Tasks companion, never by the Notes or Viewer runtime. */
export interface Clock { now(): number }
export interface IdentitySource { next(): string }

export type StoredTasks =
  | { kind: 'ready'; document: unknown | null; revision: string }
  | { kind: 'unreadable'; message: string };
export type SaveTasksResult = { kind: 'saved'; revision: string } | { kind: 'conflict' };
export interface TaskStore {
  load(): Promise<StoredTasks>;
  save(expectedRevision: string, document: TaskDocument): Promise<SaveTasksResult>;
}

export interface TasksPreferences {
  appearanceTheme: string | null;
  pinned: boolean;
  soundEnabled: boolean;
  motionEnabled: boolean;
  ripeningSpeed: 'gentle' | 'normal' | 'lively';
}
export interface TasksPreferencesPort {
  load(): Promise<TasksPreferences>;
  save(preferences: TasksPreferences): Promise<TasksPreferences>;
}

export interface TodoistReference {
  accountID: string;
  projectID: string;
  taskID: string;
}
export type TodoistConnection =
  | { kind: 'disconnected' }
  | { kind: 'connected'; accountID: string; projectID: string | null };
export interface CaptureProject { id: string; name: string }
export interface CapturedTask {
  source: TodoistReference;
  title: string;
  notes: string;
  tags: string[];
  priority: 'low' | 'normal' | 'high';
  createdAt: number | null;
}
export interface TodoistPort {
  connection(): Promise<TodoistConnection>;
  connect(token: string): Promise<{ connection: TodoistConnection; projects: CaptureProject[] }>;
  disconnect(): Promise<void>;
  projects(): Promise<CaptureProject[]>;
  selectProject(projectID: string): Promise<TodoistConnection>;
  captures(): Promise<CapturedTask[]>;
  setCompleted(source: TodoistReference, completed: boolean, operationID: string): Promise<void>;
}

export type CalendarAuthorization = 'notDetermined' | 'authorized' | 'denied' | 'unavailable';
export interface PlanningCalendar { id: string; title: string; sourceTitle: string; writable: boolean }
export interface CalendarAppointment { id: string; title: string; start: number; end: number; allDay: boolean }
export interface CalendarBlockDraft {
  blockID: string;
  taskID: string;
  title: string;
  start: number;
  end: number;
  calendarID: string;
}
export interface CalendarBlockReceipt { id: string; start: number; end: number; calendarID: string }
export interface CalendarPort {
  authorization(): Promise<CalendarAuthorization>;
  requestAccess(): Promise<CalendarAuthorization>;
  calendars(): Promise<PlanningCalendar[]>;
  appointments(start: number, end: number): Promise<CalendarAppointment[]>;
  createBlock(draft: CalendarBlockDraft): Promise<CalendarBlockReceipt>;
}

export type TasksWindowEvent =
  | { kind: 'focus'; focused: boolean }
  | { kind: 'command'; command: 'newTask' | 'settings' | 'toggleTimer' | 'togglePin' }
  | { kind: 'flush'; requestID: string };
export interface TasksWindowPort {
  readonly environment: 'native' | 'preview';
  subscribe(listener: (event: TasksWindowEvent) => void): () => void;
  acknowledgeFlush(requestID: string, saved: boolean): Promise<void>;
  setDragRegion(rect: { x: number; y: number; width: number; height: number } | null): Promise<void>;
  copyText(text: string): Promise<void>;
}
export interface TasksPorts {
  clock: Clock;
  identities: IdentitySource;
  store: TaskStore;
  preferences: TasksPreferencesPort;
  todoist: TodoistPort;
  calendar: CalendarPort;
  window: TasksWindowPort;
}
