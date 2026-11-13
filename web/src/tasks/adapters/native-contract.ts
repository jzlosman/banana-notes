import type {
  CalendarBlockDraft, TasksPreferences, TodoistReference,
} from '../application/ports';
import type { RecordedShortcut } from '../../domain/hotkey';
import type { TaskDocument } from '../domain/model';

/** WKScriptMessageHandlerWithReply, registered only for the bundled Tasks page. */
export const TASKS_BRIDGE_NAME = 'bananaTasks';
export const TASKS_EVENT_NAME = 'banana-tasks-event';
export type NativeTasksMessage =
  | { action: 'loadTasks' }
  | { action: 'inspectTasksRecovery' }
  | { action: 'restoreTasksBackup'; expectedPrimaryRevision: string | null; expectedBackupRevision: string }
  | { action: 'saveTasks'; expectedRevision: string; document: TaskDocument }
  | { action: 'loadPreferences' }
  | { action: 'savePreferences'; preferences: TasksPreferences }
  | { action: 'hotkeyPreferences'; shortcut?: never; recording?: never }
  | { action: 'resetHotkeyPreferences' }
  | { action: 'hotkeyPreferences'; shortcut: RecordedShortcut; recording?: never }
  | { action: 'hotkeyPreferences'; recording: boolean; shortcut?: never }
  | { action: 'todoistConnection' }
  | { action: 'connectTodoist'; token: string }
  | { action: 'disconnectTodoist' }
  | { action: 'todoistProjects' }
  | { action: 'selectTodoistProject'; projectID: string }
  | { action: 'todoistCaptures' }
  | { action: 'setTodoistCompleted'; source: TodoistReference; completed: boolean; operationID: string }
  | { action: 'calendarAuthorization' }
  | { action: 'requestCalendarAccess' }
  | { action: 'planningCalendars' }
  | { action: 'calendarAppointments'; start: number; end: number }
  | { action: 'createCalendarBlock'; draft: CalendarBlockDraft }
  | { action: 'flushAcknowledged'; requestID: string; saved: boolean }
  | { action: 'dragRegion'; rect: { x: number; y: number; width: number; height: number } | null }
  | { action: 'copyText'; text: string };
