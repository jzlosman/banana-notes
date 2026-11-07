import type {
  CalendarAppointment, CalendarAuthorization, CalendarBlockDraft, CalendarBlockReceipt, CalendarPort, CaptureProject,
  CapturedTask, Clock, IdentitySource, PlanningCalendar, StoredTasks, TasksHotkeyError, TasksHotkeyPreferencesPort,
  TasksHotkeyState, TasksPorts, TasksPreferences, TasksPreferencesPort, TasksWindowEvent, TasksWindowPort, TaskStore,
  TodoistConnection, TodoistPort, TodoistReference,
} from '../application/ports';
import { HOTKEY_MODIFIERS, type RecordedShortcut } from '../../domain/hotkey';
import { decodeTaskDocument, normalizeNotes, normalizeTags, normalizeTitle } from '../domain/model';
import { RandomTaskIdentity, SystemTasksClock } from './effects';
import { TASKS_BRIDGE_NAME, TASKS_EVENT_NAME, type NativeTasksMessage } from './native-contract';

interface NativeHandler { postMessage(message: NativeTasksMessage): Promise<unknown> }
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function validString(value: unknown, max = 512): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max; }
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).sort().join(',') === [...keys].sort().join(','); }
function decodeConnection(value: unknown): TodoistConnection {
  const raw = record(value);
  if (!raw || typeof raw.kind !== 'string') throw new Error('The native Todoist connection response was invalid.');
  if (raw.kind === 'disconnected' && exactKeys(raw, ['kind'])) return { kind: 'disconnected' };
  if (raw.kind === 'connected' && exactKeys(raw, ['kind', 'accountID', 'projectID']) && validString(raw.accountID, 128) &&
      (raw.projectID === null || validString(raw.projectID, 128))) {
    return { kind: 'connected', accountID: raw.accountID, projectID: raw.projectID as string | null };
  }
  throw new Error('The native Todoist connection response was invalid.');
}
function decodeProjects(value: unknown): CaptureProject[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error('The native project list was invalid.');
  const ids = new Set<string>();
  return value.map(item => {
    const project = record(item);
    if (!project || !exactKeys(project, ['id', 'name']) || !validString(project.id, 128) || !validString(project.name, 512) || ids.has(project.id)) throw new Error('The native project list was invalid.');
    ids.add(project.id); return { id: project.id, name: project.name };
  });
}
function decodeCaptured(value: unknown): CapturedTask[] {
  if (!Array.isArray(value) || value.length > 10_000) throw new Error('The native capture list was invalid.');
  return value.map(item => {
    const raw = record(item), source = raw && record(raw.source);
    if (!raw || !source || !exactKeys(raw, ['source', 'title', 'notes', 'tags', 'priority', 'createdAt']) ||
        !exactKeys(source, ['accountID', 'projectID', 'taskID']) || !validString(source.accountID, 128) || !validString(source.projectID, 128) ||
        !validString(source.taskID, 128) || !normalizeTitle(raw.title) || normalizeNotes(raw.notes) === null || normalizeTags(raw.tags) === null ||
        !['low', 'normal', 'high'].includes(String(raw.priority)) || !(raw.createdAt === null || (Number.isSafeInteger(raw.createdAt) && (raw.createdAt as number) >= 0))) {
      throw new Error('The native capture list was invalid.');
    }
    return { source: { accountID: source.accountID, projectID: source.projectID, taskID: source.taskID }, title: normalizeTitle(raw.title)!,
      notes: normalizeNotes(raw.notes)!, tags: normalizeTags(raw.tags)!, priority: raw.priority as CapturedTask['priority'], createdAt: raw.createdAt as number | null };
  });
}
const TASKS_HOTKEY_ERRORS: readonly TasksHotkeyError[] = [
  'registration-unavailable', 'registration-failed', 'verification-profile',
];
function validHotkeyShortcut(value: unknown): value is RecordedShortcut {
  const shortcut = record(value);
  const modifiersMask = HOTKEY_MODIFIERS.command | HOTKEY_MODIFIERS.shift | HOTKEY_MODIFIERS.option | HOTKEY_MODIFIERS.control;
  const requiredMask = HOTKEY_MODIFIERS.command | HOTKEY_MODIFIERS.option | HOTKEY_MODIFIERS.control;
  return !!shortcut && exactKeys(shortcut, ['keyCode', 'modifiers']) && Number.isInteger(shortcut.keyCode) &&
    (shortcut.keyCode as number) >= 0 && (shortcut.keyCode as number) <= 127 && Number.isInteger(shortcut.modifiers) &&
    (shortcut.modifiers as number) >= 0 && (shortcut.modifiers as number) <= 0xffff_ffff &&
    (((shortcut.modifiers as number) & ~modifiersMask) === 0) && (((shortcut.modifiers as number) & requiredMask) !== 0);
}
function hotkeyAvailabilityIsCoherent(state: Record<string, unknown>): boolean {
  if (typeof state.registered !== 'boolean' || typeof state.available !== 'boolean') return false;
  if (state.registered) return state.available && state.error !== 'verification-profile';
  if (state.error === 'registration-failed') return state.available;
  return !state.available;
}
function decodeHotkeyState(value: unknown): TasksHotkeyState {
  const state = record(value);
  const keys = ['keyCode', 'modifiers', 'display', 'registered', 'available', 'error'];
  if (!state || !exactKeys(state, keys) || !validHotkeyShortcut({ keyCode: state.keyCode, modifiers: state.modifiers }) ||
      typeof state.display !== 'string' || state.display.length === 0 || state.display.length > 32 ||
      [...state.display].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
      typeof state.registered !== 'boolean' || typeof state.available !== 'boolean' ||
      !(state.error === null || (typeof state.error === 'string' && TASKS_HOTKEY_ERRORS.includes(state.error as TasksHotkeyError))) ||
      !hotkeyAvailabilityIsCoherent(state)) {
    throw new Error('The native Tasks shortcut response was invalid.');
  }
  return { keyCode: state.keyCode as number, modifiers: state.modifiers as number, display: state.display,
    registered: state.registered, available: state.available, error: state.error as TasksHotkeyError | null };
}
function decodePreferences(value: unknown): TasksPreferences {
  const prefs = record(value);
  if (!prefs || !exactKeys(prefs, ['appearanceTheme', 'pinned', 'soundEnabled', 'motionEnabled', 'ripeningSpeed']) ||
      !(prefs.appearanceTheme === null || (typeof prefs.appearanceTheme === 'string' && prefs.appearanceTheme.length <= 128 && !/[\u0000-\u001f\u007f]/.test(prefs.appearanceTheme))) ||
      typeof prefs.pinned !== 'boolean' || typeof prefs.soundEnabled !== 'boolean' || typeof prefs.motionEnabled !== 'boolean' ||
      !['gentle', 'normal', 'lively'].includes(String(prefs.ripeningSpeed))) throw new Error('The native Tasks preferences response was invalid.');
  return { appearanceTheme: prefs.appearanceTheme as string | null, pinned: prefs.pinned, soundEnabled: prefs.soundEnabled,
    motionEnabled: prefs.motionEnabled, ripeningSpeed: prefs.ripeningSpeed as TasksPreferences['ripeningSpeed'] };
}
function decodeProjectsOrCalendars(value: unknown): PlanningCalendar[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error('The native calendar list was invalid.');
  return value.map(item => {
    const calendar = record(item);
    if (!calendar || !exactKeys(calendar, ['id', 'title', 'sourceTitle', 'writable']) || !validString(calendar.id, 128) ||
        typeof calendar.title !== 'string' || calendar.title.length > 512 || typeof calendar.sourceTitle !== 'string' || calendar.sourceTitle.length > 512 ||
        typeof calendar.writable !== 'boolean') throw new Error('The native calendar list was invalid.');
    return { id: calendar.id, title: calendar.title, sourceTitle: calendar.sourceTitle, writable: calendar.writable };
  });
}
function decodeAppointments(value: unknown): CalendarAppointment[] {
  if (!Array.isArray(value) || value.length > 100_000) throw new Error('The native calendar appointments were invalid.');
  return value.map(item => {
    const appointment = record(item);
    if (!appointment || !exactKeys(appointment, ['id', 'title', 'start', 'end', 'allDay']) || !validString(appointment.id, 128) ||
        typeof appointment.title !== 'string' || appointment.title.length > 1000 || !Number.isSafeInteger(appointment.start) ||
        !Number.isSafeInteger(appointment.end) || (appointment.end as number) <= (appointment.start as number) || typeof appointment.allDay !== 'boolean') {
      throw new Error('The native calendar appointments were invalid.');
    }
    return { id: appointment.id, title: appointment.title, start: appointment.start as number, end: appointment.end as number, allDay: appointment.allDay };
  });
}
function decodeAuthorization(value: unknown): CalendarAuthorization {
  if (value === 'notDetermined' || value === 'authorized' || value === 'denied' || value === 'unavailable') return value;
  throw new Error('The native calendar authorization response was invalid.');
}
function decodeReceipt(value: unknown): CalendarBlockReceipt {
  const receipt = record(value);
  if (!receipt || !exactKeys(receipt, ['id', 'start', 'end', 'calendarID']) || !validString(receipt.id, 128) ||
      !Number.isSafeInteger(receipt.start) || !Number.isSafeInteger(receipt.end) || (receipt.end as number) <= (receipt.start as number) || !validString(receipt.calendarID, 128)) {
    throw new Error('The native calendar block response was invalid.');
  }
  return { id: receipt.id, start: receipt.start as number, end: receipt.end as number, calendarID: receipt.calendarID };
}
function decodeWindowEvent(value: unknown): TasksWindowEvent | null {
  const event = record(value);
  if (!event || typeof event.kind !== 'string') return null;
  if (event.kind === 'focus' && exactKeys(event, ['kind', 'focused']) && typeof event.focused === 'boolean') return { kind: 'focus', focused: event.focused };
  if (event.kind === 'command' && exactKeys(event, ['kind', 'command']) && ['newTask', 'settings', 'toggleTimer', 'togglePin'].includes(String(event.command))) {
    return { kind: 'command', command: event.command as 'newTask' | 'settings' | 'toggleTimer' | 'togglePin' };
  }
  if (event.kind === 'flush' && exactKeys(event, ['kind', 'requestID']) && validString(event.requestID, 128)) return { kind: 'flush', requestID: event.requestID };
  return null;
}

function nativeHandler(target: Window): NativeHandler {
  const handler = (target as Window & { webkit?: { messageHandlers?: Record<string, NativeHandler | undefined> } }).webkit?.messageHandlers?.[TASKS_BRIDGE_NAME];
  if (!handler || typeof handler.postMessage !== 'function') throw new Error('The Banana Tasks native bridge is unavailable.');
  return handler;
}

/** One boundary translator for all split native effects. No wire DTO crosses into the domain. */
export class NativeTasksAdapter implements TasksPorts {
  readonly clock: Clock;
  readonly identities: IdentitySource;
  readonly store: TaskStore;
  readonly preferences: TasksPreferencesPort;
  readonly hotkeyPreferences: TasksHotkeyPreferencesPort;
  readonly todoist: TodoistPort;
  readonly calendar: CalendarPort;
  readonly window: TasksWindowPort;
  private readonly handler: NativeHandler;

  constructor(private readonly target: Window = window) {
    this.handler = nativeHandler(target);
    this.clock = new SystemTasksClock();
    this.identities = new RandomTaskIdentity();
    this.store = {
      load: async () => {
        const raw = record(await this.post({ action: 'loadTasks' }));
        if (!raw) throw new Error('The native Tasks storage response was invalid.');
        if (raw.kind === 'unreadable' && exactKeys(raw, ['kind', 'message']) && typeof raw.message === 'string' && raw.message.length <= 2000) return { kind: 'unreadable', message: raw.message };
        if (raw.kind === 'ready' && exactKeys(raw, ['kind', 'document', 'revision']) && validString(raw.revision, 512)) {
          const document = raw.document === null ? null : decodeTaskDocument(raw.document);
          return { kind: 'ready', document, revision: raw.revision };
        }
        throw new Error('The native Tasks storage response was invalid.');
      },
      save: async (expectedRevision, document) => {
        if (!validString(expectedRevision, 512)) throw new Error('The Tasks revision is invalid.');
        const validated = decodeTaskDocument(document);
        const raw = record(await this.post({ action: 'saveTasks', expectedRevision, document: validated }));
        if (raw && exactKeys(raw, ['kind']) && raw.kind === 'conflict') return { kind: 'conflict' };
        if (raw && exactKeys(raw, ['kind', 'revision']) && raw.kind === 'saved' && validString(raw.revision, 512)) return { kind: 'saved', revision: raw.revision };
        throw new Error('The native Tasks save response was invalid.');
      },
    };
    this.preferences = {
      load: async () => decodePreferences(await this.post({ action: 'loadPreferences' })),
      save: async preferences => decodePreferences(await this.post({ action: 'savePreferences', preferences: decodePreferences(preferences) })),
    };
    this.hotkeyPreferences = {
      load: async () => decodeHotkeyState(await this.post({ action: 'hotkeyPreferences' })),
      set: async shortcut => {
        if (!validHotkeyShortcut(shortcut)) throw new Error('The Tasks shortcut is invalid.');
        return decodeHotkeyState(await this.post({ action: 'hotkeyPreferences', shortcut }));
      },
      reset: async () => decodeHotkeyState(await this.post({ action: 'resetHotkeyPreferences' })),
      setRecording: async recording => {
        if (typeof recording !== 'boolean') throw new Error('The Tasks shortcut recording state is invalid.');
        const result = await this.post({ action: 'hotkeyPreferences', recording });
        if (result !== null) throw new Error('The native Tasks shortcut recording response was invalid.');
      },
    };
    this.todoist = {
      connection: async () => decodeConnection(await this.post({ action: 'todoistConnection' })),
      connect: async token => {
        if (typeof token !== 'string' || token.trim().length === 0 || token.length > 4096) throw new Error('The Todoist token input is invalid.');
        const raw = record(await this.post({ action: 'connectTodoist', token }));
        if (!raw || !exactKeys(raw, ['connection', 'projects'])) throw new Error('The native Todoist connect response was invalid.');
        return { connection: decodeConnection(raw.connection), projects: decodeProjects(raw.projects) };
      },
      disconnect: async () => { await this.expectNull({ action: 'disconnectTodoist' }); },
      projects: async () => decodeProjects(await this.post({ action: 'todoistProjects' })),
      selectProject: async projectID => {
        if (!validString(projectID, 128)) throw new Error('The Todoist project ID is invalid.');
        return decodeConnection(await this.post({ action: 'selectTodoistProject', projectID }));
      },
      captures: async () => decodeCaptured(await this.post({ action: 'todoistCaptures' })),
      setCompleted: async (source: TodoistReference, completed, operationID) => {
        if (!validString(source.accountID, 128) || !validString(source.projectID, 128) || !validString(source.taskID, 128) ||
            typeof completed !== 'boolean' || !validString(operationID, 128)) throw new Error('The Todoist writeback request is invalid.');
        await this.post({ action: 'setTodoistCompleted', source, completed, operationID }).then(value => {
          if (value !== null) throw new Error('The native Todoist writeback response was invalid.');
        });
      },
    };
    this.calendar = {
      authorization: async () => decodeAuthorization(await this.post({ action: 'calendarAuthorization' })),
      requestAccess: async () => decodeAuthorization(await this.post({ action: 'requestCalendarAccess' })),
      calendars: async () => decodeProjectsOrCalendars(await this.post({ action: 'planningCalendars' })),
      appointments: async (start, end) => {
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) throw new Error('The calendar query range is invalid.');
        return decodeAppointments(await this.post({ action: 'calendarAppointments', start, end }));
      },
      createBlock: async (draft: CalendarBlockDraft) => {
        if (!validString(draft.blockID, 128) || !validString(draft.taskID, 128) || !validString(draft.calendarID, 128) ||
            !validString(draft.title, 240) || !Number.isSafeInteger(draft.start) || !Number.isSafeInteger(draft.end) || draft.start < 0 || draft.end <= draft.start) {
          throw new Error('The calendar block request is invalid.');
        }
        return decodeReceipt(await this.post({ action: 'createCalendarBlock', draft }));
      },
    };
    this.window = {
      environment: 'native',
      subscribe: listener => {
        const receive = (event: Event) => {
          const decoded = decodeWindowEvent((event as CustomEvent<unknown>).detail);
          if (decoded) listener(decoded);
        };
        this.target.addEventListener(TASKS_EVENT_NAME, receive);
        return () => this.target.removeEventListener(TASKS_EVENT_NAME, receive);
      },
      acknowledgeFlush: async (requestID, saved) => { await this.expectNull({ action: 'flushAcknowledged', requestID, saved }); },
      setDragRegion: async rect => {
        if (rect !== null && (!Number.isFinite(rect.x) || !Number.isFinite(rect.y) || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0)) {
          throw new Error('The window drag region is invalid.');
        }
        await this.expectNull({ action: 'dragRegion', rect });
      },
      copyText: async text => {
        if (typeof text !== 'string' || text.length > 100_000) throw new Error('The clipboard text is invalid.');
        await this.expectNull({ action: 'copyText', text });
      },
    };
  }

  private async post(message: NativeTasksMessage): Promise<unknown> {
    return await this.handler.postMessage(message);
  }
  private async expectNull(message: Extract<NativeTasksMessage, { action: 'disconnectTodoist' | 'flushAcknowledged' | 'dragRegion' | 'copyText' }>): Promise<null> {
    const result = await this.post(message);
    if (result !== null) throw new Error(`The native ${message.action} response was invalid.`);
    return null;
  }
}
