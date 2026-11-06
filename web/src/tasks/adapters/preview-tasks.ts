import type {
  CalendarAppointment, CalendarAuthorization, CalendarBlockDraft, CalendarBlockReceipt, CalendarPort, CaptureProject,
  CapturedTask, Clock, IdentitySource, PlanningCalendar, SaveTasksResult, StoredTasks, TasksPreferences, TasksPreferencesPort, TasksPorts,
  TasksWindowEvent, TasksWindowPort, TaskStore, TodoistConnection, TodoistPort,
} from '../application/ports';
import { decodeTaskDocument } from '../domain/model';
import { RandomTaskIdentity, SystemTasksClock } from './effects';

export const PREVIEW_TASKS_STORAGE_KEY = 'banana.tasks.preview.v1';
export const PREVIEW_TASKS_PREFERENCES_KEY = 'banana.tasks.preview.preferences.v1';
const DEFAULT_PREFERENCES: TasksPreferences = { appearanceTheme: null, pinned: false, soundEnabled: false, motionEnabled: true, ripeningSpeed: 'normal' };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function decodePreferences(value: unknown): TasksPreferences {
  const raw = record(value);
  if (!raw || Object.keys(raw).sort().join(',') !== 'appearanceTheme,motionEnabled,pinned,ripeningSpeed,soundEnabled' ||
      !(raw.appearanceTheme === null || (typeof raw.appearanceTheme === 'string' && raw.appearanceTheme.length <= 128 && !/[\u0000-\u001f\u007f]/.test(raw.appearanceTheme))) ||
      typeof raw.pinned !== 'boolean' || typeof raw.soundEnabled !== 'boolean' || typeof raw.motionEnabled !== 'boolean' ||
      !['gentle', 'normal', 'lively'].includes(String(raw.ripeningSpeed))) throw new Error('Preview Tasks preferences are invalid.');
  return { appearanceTheme: raw.appearanceTheme as string | null, pinned: raw.pinned, soundEnabled: raw.soundEnabled,
    motionEnabled: raw.motionEnabled, ripeningSpeed: raw.ripeningSpeed as TasksPreferences['ripeningSpeed'] };
}
function newRevision(storage: Storage, key: string): string {
  const current = storage.getItem(key);
  let sequence = 0;
  if (current !== null) {
    try {
      const wrapper = record(JSON.parse(current) as unknown);
      if (wrapper && Number.isSafeInteger(wrapper.sequence) && (wrapper.sequence as number) >= 0) sequence = wrapper.sequence as number;
    } catch { /* Existing corruption is surfaced by load/save, never treated as empty. */ }
  }
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `${sequence + 1}:${random}`;
}

function decodePreviewEvent(value: unknown): TasksWindowEvent | null {
  const event = record(value);
  if (!event) return null;
  if (event.kind === 'focus' && typeof event.focused === 'boolean' && Object.keys(event).sort().join(',') === 'focused,kind') return { kind: 'focus', focused: event.focused };
  if (event.kind === 'command' && ['newTask', 'settings', 'toggleTimer', 'togglePin'].includes(String(event.command)) && Object.keys(event).sort().join(',') === 'command,kind') {
    return { kind: 'command', command: event.command as 'newTask' | 'settings' | 'toggleTimer' | 'togglePin' };
  }
  if (event.kind === 'flush' && typeof event.requestID === 'string' && event.requestID.length > 0 && event.requestID.length <= 128 && Object.keys(event).sort().join(',') === 'kind,requestID') {
    return { kind: 'flush', requestID: event.requestID };
  }
  return null;
}

/** Browser fallback with a private storage namespace and strict read/write boundaries. */
export class PreviewTasksAdapter implements TasksPorts {
  readonly clock: Clock;
  readonly identities: IdentitySource;
  readonly store: TaskStore;
  readonly preferences: TasksPreferencesPort;
  readonly todoist: TodoistPort;
  readonly calendar: CalendarPort;
  readonly window: TasksWindowPort;
  private readonly storageSource: () => Storage;

  constructor(private readonly target: Window = window, storage?: Storage) {
    this.clock = new SystemTasksClock();
    this.identities = new RandomTaskIdentity();
    this.storageSource = () => storage ?? target.localStorage;
    this.store = {
      load: async (): Promise<StoredTasks> => {
        const storage = this.storageSource();
        const serialized = storage.getItem(PREVIEW_TASKS_STORAGE_KEY);
        if (serialized === null) return { kind: 'ready', document: null, revision: 'empty' };
        let wrapper: Record<string, unknown> | null;
        try { wrapper = record(JSON.parse(serialized) as unknown); }
        catch { return { kind: 'unreadable', message: 'Preview Tasks storage contains unreadable data; it was left untouched.' }; }
        if (!wrapper || Object.keys(wrapper).sort().join(',') !== 'document,revision,sequence' || typeof wrapper.revision !== 'string' ||
            wrapper.revision.length === 0 || wrapper.revision.length > 512 || !Number.isSafeInteger(wrapper.sequence) || (wrapper.sequence as number) < 1) {
          return { kind: 'unreadable', message: 'Preview Tasks storage has an invalid record; it was left untouched.' };
        }
        try { return { kind: 'ready', document: decodeTaskDocument(wrapper.document), revision: wrapper.revision }; }
        catch { return { kind: 'unreadable', message: 'Preview Tasks data is invalid; it was left untouched.' }; }
      },
      save: async (expectedRevision, document): Promise<SaveTasksResult> => {
        const storage = this.storageSource();
        let currentRevision = 'empty', sequence = 0;
        const existing = storage.getItem(PREVIEW_TASKS_STORAGE_KEY);
        if (existing !== null) {
          let wrapper: Record<string, unknown> | null;
          try { wrapper = record(JSON.parse(existing) as unknown); }
          catch { throw new Error('Preview Tasks storage is unreadable; refusing to overwrite it.'); }
          if (!wrapper || Object.keys(wrapper).sort().join(',') !== 'document,revision,sequence' || typeof wrapper.revision !== 'string' ||
              !Number.isSafeInteger(wrapper.sequence) || (wrapper.sequence as number) < 1) throw new Error('Preview Tasks storage is invalid; refusing to overwrite it.');
          decodeTaskDocument(wrapper.document);
          currentRevision = wrapper.revision;
          sequence = wrapper.sequence as number;
        }
        if (expectedRevision !== currentRevision) return { kind: 'conflict' };
        const validated = decodeTaskDocument(document);
        const revision = newRevision(storage, PREVIEW_TASKS_STORAGE_KEY);
        const wrapper = { document: validated, revision, sequence: sequence + 1 };
        storage.setItem(PREVIEW_TASKS_STORAGE_KEY, JSON.stringify(wrapper));
        return { kind: 'saved', revision };
      },
    };
    this.preferences = {
      load: async () => {
        const stored = this.storageSource().getItem(PREVIEW_TASKS_PREFERENCES_KEY);
        if (stored === null) return { ...DEFAULT_PREFERENCES };
        try { return decodePreferences(JSON.parse(stored) as unknown); }
        catch { throw new Error('Preview Tasks preferences are unreadable; they were left untouched.'); }
      },
      save: async preferences => {
        const valid = decodePreferences(preferences);
        this.storageSource().setItem(PREVIEW_TASKS_PREFERENCES_KEY, JSON.stringify(valid));
        return { ...valid };
      },
    };
    this.todoist = {
      connection: async (): Promise<TodoistConnection> => ({ kind: 'disconnected' }),
      connect: async (_token: string) => { throw new Error('Todoist is unavailable in the browser preview.'); },
      disconnect: async () => undefined,
      projects: async (): Promise<CaptureProject[]> => { throw new Error('Todoist is unavailable in the browser preview.'); },
      selectProject: async (_projectID: string) => { throw new Error('Todoist is unavailable in the browser preview.'); },
      captures: async (): Promise<CapturedTask[]> => { throw new Error('Todoist is unavailable in the browser preview.'); },
      setCompleted: async () => { throw new Error('Todoist is unavailable in the browser preview.'); },
    };
    this.calendar = {
      authorization: async (): Promise<CalendarAuthorization> => 'unavailable',
      requestAccess: async (): Promise<CalendarAuthorization> => 'unavailable',
      calendars: async (): Promise<PlanningCalendar[]> => [],
      appointments: async (_start: number, _end: number): Promise<CalendarAppointment[]> => [],
      createBlock: async (_draft: CalendarBlockDraft): Promise<CalendarBlockReceipt> => { throw new Error('Calendar is unavailable in the browser preview.'); },
    };
    this.window = {
      environment: 'preview',
      subscribe: listener => {
        const receive = (event: Event) => {
          const decoded = decodePreviewEvent((event as CustomEvent<unknown>).detail);
          if (decoded) listener(decoded);
        };
        target.addEventListener('banana-tasks-event', receive);
        return () => target.removeEventListener('banana-tasks-event', receive);
      },
      acknowledgeFlush: async (_requestID, _saved) => undefined,
      setDragRegion: async (_rect) => undefined,
      copyText: async text => {
        if (typeof text !== 'string' || text.length > 100_000) throw new Error('The clipboard text is invalid.');
        const clipboard = target.navigator?.clipboard;
        if (!clipboard?.writeText) throw new Error('Clipboard access is unavailable in the browser preview.');
        await clipboard.writeText(text);
      },
    };
  }
}
