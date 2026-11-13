import {
  addManualEffort, addProgress, changeTaskStatus, createTask, importCaptures, removeTodoistOperation,
  setSnoozeUntil, toggleTimer, stopTimer, updateTask, wakeSnoozedTasks,
  type CreateTaskInput, type Decision, type DomainFailure, type UpdateTaskInput,
} from '../domain/decisions';
import { decodeTaskDocument, EMPTY_TASK_DOCUMENT, validateTaskDocument, type TaskDocument, type TodoistOutboxOperation } from '../domain/model';
import { queryAgentBrief, queryTagCatalog, queryTaskDetail, queryTaskList, type AgentBrief, type TagCatalogEntry, type TaskDetailReadModel, type TaskListQuery, type TaskListReadModel } from '../domain/queries';
import type {
  CalendarAppointment, CalendarAuthorization, CalendarBlockDraft, CalendarBlockReceipt, CaptureProject,
  PlanningCalendar, TasksPorts, TasksPreferences, TasksRecoveryInspection, TasksWindowEvent, TodoistConnection,
} from './ports';

export const DEFAULT_TASKS_PREFERENCES: TasksPreferences = {
  appearanceTheme: null, pinned: false, soundEnabled: false, motionEnabled: true, ripeningSpeed: 'normal',
};

interface ValidatedRecoveryCandidate {
  primaryRevision: string | null;
  backupRevision: string;
  backup: RecoveryBackupReadModel;
}
function hasUnsupportedTaskVersion(value: unknown): boolean {
  const document = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  return !!document && Object.prototype.hasOwnProperty.call(document, 'version') && document.version !== 1;
}
function recoveryMessage(reason: RecoveryReason, resolution: RecoveryResolution): string {
  switch (resolution.kind) {
    case 'checking': return 'Saved Tasks data needs recovery. Checking for a safe backup.';
    case 'unavailable': return 'This environment does not provide a Tasks backup recovery capability.';
    case 'unsupported-version': return 'This Tasks file uses a newer or unrecognized format. Backup recovery is disabled to protect it.';
    case 'no-valid-backup': return 'Tasks could not be loaded. No semantically valid backup is available.';
    case 'primary-changed': return 'Tasks storage changed after it was inspected. Check the current file again before continuing; no backup was applied.';
    case 'candidate': return reason === 'unreadable' ? 'Saved Tasks data could not be read. A validated backup is available for explicit restoration.' :
      'Saved Tasks data is invalid. A validated backup is available for explicit restoration.';
    case 'restoring': return 'Restoring the validated Tasks backup. Tasks will remain unavailable until it is reloaded.';
    case 'restore-failed': return 'The backup was not confirmed as restored. Check for a fresh recovery option before trying again.';
    case 'inspection-failed': return 'Tasks storage could not be checked. Check again before continuing.';
  }
}

export type PersistenceError = { kind: 'saveFailed' | 'conflict'; message: string; localDocument: TaskDocument };
export type OperationalFault = { operation: string; message: string };
export interface RecoveryBackupReadModel { taskCount: number; savedAt: number }
export type RecoveryResolution =
  | { kind: 'checking' }
  | { kind: 'unavailable' }
  | { kind: 'unsupported-version' }
  | { kind: 'no-valid-backup' }
  | { kind: 'primary-changed' }
  | { kind: 'candidate'; backup: RecoveryBackupReadModel }
  | { kind: 'restoring'; backup: RecoveryBackupReadModel }
  | { kind: 'restore-failed' }
  | { kind: 'inspection-failed' };
export type RecoveryReason = 'unreadable' | 'loadFailed' | 'corrupt';
export type RecoveryRestoreOutcome = { kind: 'restored' } | { kind: 'conflict' } | { kind: 'unavailable' } | { kind: 'failed' };
export type TasksState =
  | { kind: 'loading' }
  | { kind: 'recovery'; reason: RecoveryReason; message: string; resolution: RecoveryResolution }
  | {
      kind: 'ready'; document: TaskDocument; revision: string; preferences: TasksPreferences;
      persistenceError: PersistenceError | null; preferencesError: OperationalFault | null;
      fault: OperationalFault | null; todoistConnection: TodoistConnection; captureProjects: CaptureProject[];
      calendar: { authorization: CalendarAuthorization; calendars: PlanningCalendar[]; appointments: CalendarAppointment[] };
    }
  | { kind: 'disposed' };

export type CommandOutcome<T = undefined> =
  | { kind: 'applied'; value: T }
  | { kind: 'rejected'; reason: DomainFailure | 'not_connected' | 'no_project' | 'invalid_project' | 'not_writable' | 'invalid_calendar_range' | 'task_not_schedulable' }
  | { kind: 'unavailable'; operation: string }
  | { kind: 'failed'; error: OperationalFault };
export type TasksEvent = { kind: 'window'; event: Exclude<TasksWindowEvent, { kind: 'flush' }> };
export type UpdatePreferencesInput = Partial<TasksPreferences>;

/** Concrete UI-facing contract; reads and state-changing commands are visibly separate. */
export interface TasksFacade {
  initialize(): Promise<TasksState>;
  getState(): TasksState;
  /** Explicitly recheck startup recovery; a newly valid primary is reloaded and decoded without writing task data. */
  checkBackupAgain(): Promise<TasksState>;
  /** Explicitly install the currently inspected, semantically valid backup. UI owns confirmation. */
  restoreBackup(): Promise<RecoveryRestoreOutcome>;
  subscribe(listener: (state: TasksState) => void): () => void;
  subscribeEvents(listener: (event: TasksEvent) => void): () => void;
  flush(): Promise<boolean>;
  dispose(): void;
  runClockStage(): Promise<CommandOutcome<{ woken: number }>>;
  queryTasks(query: TaskListQuery): TaskListReadModel;
  queryTagCatalog(): TagCatalogEntry[];
  queryTaskDetail(taskID: string): TaskDetailReadModel | null;
  queryAgentBrief(taskID: string): AgentBrief | null;
  create(input: CreateTaskInput): Promise<CommandOutcome<{ taskID: string }>>;
  update(taskID: string, patch: UpdateTaskInput): Promise<CommandOutcome>;
  changeStatus(taskID: string, status: 'active' | 'waiting' | 'completed' | 'composted'): Promise<CommandOutcome>;
  snooze(taskID: string, until: number): Promise<CommandOutcome>;
  restore(taskID: string): Promise<CommandOutcome>;
  progress(taskID: string, note?: string): Promise<CommandOutcome>;
  toggleTimer(taskID: string): Promise<CommandOutcome>;
  stopTimer(): Promise<CommandOutcome>;
  logEffort(taskID: string, durationMs: number): Promise<CommandOutcome>;
  updatePreferences(patch: UpdatePreferencesInput): Promise<CommandOutcome<TasksPreferences>>;
  copyAgentBrief(taskID: string): Promise<CommandOutcome>;
  connectTodoist(token: string): Promise<CommandOutcome<TodoistConnection>>;
  disconnectTodoist(): Promise<CommandOutcome>;
  loadTodoistProjects(): Promise<CommandOutcome<CaptureProject[]>>;
  selectTodoistProject(projectID: string): Promise<CommandOutcome<TodoistConnection>>;
  syncTodoist(): Promise<CommandOutcome<{ imported: number; pendingWritebacks: number }>>;
  requestCalendarAccess(): Promise<CommandOutcome<CalendarAuthorization>>;
  loadCalendar(start: number, end: number): Promise<CommandOutcome<{ calendars: PlanningCalendar[]; appointments: CalendarAppointment[] }>>;
  scheduleTask(taskID: string, calendarID: string, start: number, end: number): Promise<CommandOutcome<CalendarBlockReceipt>>;
  exportLocalChanges(): string | null;
}

const validPreferences = (value: unknown): value is TasksPreferences => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (item.appearanceTheme === null || (typeof item.appearanceTheme === 'string' && item.appearanceTheme.length <= 128 && !/[\u0000-\u001f\u007f]/.test(item.appearanceTheme))) &&
    typeof item.pinned === 'boolean' && typeof item.soundEnabled === 'boolean' && typeof item.motionEnabled === 'boolean' &&
    ['gentle', 'normal', 'lively'].includes(String(item.ripeningSpeed));
};
function validRevision(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 512; }
function fault(operation: string, error: unknown): OperationalFault {
  return { operation, message: error instanceof Error && error.message ? error.message : 'The operation failed.' };
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}
function copyDocument(document: TaskDocument): TaskDocument { return decodeTaskDocument(JSON.parse(JSON.stringify(document)) as unknown); }
function isFailure<T>(decision: Decision<T>): decision is Extract<Decision<T>, { kind: 'rejected' }> { return decision.kind === 'rejected'; }
function validConnection(value: unknown): value is TodoistConnection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const connection = value as Record<string, unknown>;
  if (connection.kind === 'disconnected') return true;
  return connection.kind === 'connected' && typeof connection.accountID === 'string' && connection.accountID.length > 0 && connection.accountID.length <= 128 &&
    (connection.projectID === null || (typeof connection.projectID === 'string' && connection.projectID.length > 0 && connection.projectID.length <= 128));
}
function sameConnection(left: TodoistConnection, right: TodoistConnection): boolean {
  return left.kind === 'disconnected' ? right.kind === 'disconnected' : right.kind === 'connected' &&
    left.accountID === right.accountID && left.projectID === right.projectID;
}
function todoistTaskKey(operation: TodoistOutboxOperation): string {
  return `${operation.source.accountID}\u0000${operation.source.projectID}\u0000${operation.source.taskID}`;
}
function validProjects(value: unknown): value is CaptureProject[] {
  return Array.isArray(value) && value.length <= 500 && value.every(project => !!project && typeof project.id === 'string' && project.id.length > 0 && project.id.length <= 128 &&
    typeof project.name === 'string' && project.name.trim().length > 0 && project.name.length <= 512);
}

/** Coordinates the local Tasks context with isolated local-mutation and integration-effect queues. */
export class TasksController implements TasksFacade {
  private state: TasksState = { kind: 'loading' };
  private readonly listeners = new Set<(state: TasksState) => void>();
  private readonly eventListeners = new Set<(event: TasksEvent) => void>();
  private localTail: Promise<unknown> = Promise.resolve();
  private integrationTail: Promise<unknown> = Promise.resolve();
  private outboxDrainScheduled = false;
  private initialization: Promise<TasksState> | null = null;
  private unsubscribeWindow: (() => void) | null = null;
  private pendingDocument: TaskDocument | null = null;
  private pendingPreferences: TasksPreferences | null = null;
  private revision = '';
  private writablePreferences = false;
  private disposed = false;
  private lifecycleGeneration = 0;
  private recoveryGeneration = 0;
  private recoveryCandidate: ValidatedRecoveryCandidate | null = null;
  private restoreInFlight = false;
  private checkInFlight = false;
  private initialIntegrationsStarted = false;

  constructor(private readonly ports: TasksPorts) {}

  initialize(): Promise<TasksState> {
    if (this.disposed) return Promise.resolve(this.state);
    if (this.initialization) return this.initialization;
    this.initialization = this.initializeOnce();
    return this.initialization;
  }

  private async initializeOnce(): Promise<TasksState> {
    const lifecycle = ++this.lifecycleGeneration;
    this.publish({ kind: 'loading' });
    this.unsubscribeWindow = this.ports.window.subscribe(event => {
      if (event.kind === 'flush') {
        void this.flush().then(saved => this.ports.window.acknowledgeFlush(event.requestID, saved).catch(error => {
          void this.enqueueLocal(() => this.setFault('flush_acknowledge', error));
        }));
      } else {
        for (const listener of this.eventListeners) listener({ kind: 'window', event });
      }
    });
    let stored;
    try { stored = await this.ports.store.load(); }
    catch {
      if (this.disposed || lifecycle !== this.lifecycleGeneration) return this.state;
      await this.enterRecovery('loadFailed');
      return this.getState();
    }
    if (this.disposed || lifecycle !== this.lifecycleGeneration) return this.state;
    if (stored.kind === 'unreadable') {
      await this.enterRecovery('unreadable');
      return this.getState();
    }
    if (!validRevision(stored.revision)) {
      await this.enterRecovery('corrupt');
      return this.getState();
    }
    let document: TaskDocument;
    try { document = decodeTaskDocument(stored.document === null ? EMPTY_TASK_DOCUMENT : stored.document); }
    catch {
      await this.enterRecovery('corrupt');
      return this.getState();
    }
    return this.activateReady(document, stored.revision, lifecycle);
  }

  private activateReady(document: TaskDocument, revision: string, lifecycle: number, startupEffects = true): Promise<TasksState> {
    return this.enqueueLocal(() => this.activateReadyInner(document, revision, lifecycle, startupEffects));
  }

  private async activateReadyInner(document: TaskDocument, revision: string, lifecycle: number, startupEffects: boolean): Promise<TasksState> {
    if (this.disposed || lifecycle !== this.lifecycleGeneration) return this.state;
    this.revision = revision;
    let preferences = { ...DEFAULT_TASKS_PREFERENCES };
    let preferencesError: OperationalFault | null = null;
    try {
      const loaded = await this.ports.preferences.load();
      if (!validPreferences(loaded)) throw new Error('Saved Tasks preferences are invalid.');
      preferences = { ...loaded };
      this.writablePreferences = true;
    } catch (error) {
      preferencesError = fault('load_preferences', error);
      this.writablePreferences = false;
    }
    if (this.disposed || lifecycle !== this.lifecycleGeneration) return this.state;
    this.publish({ kind: 'ready', document: freeze(document), revision, preferences: freeze(preferences),
      persistenceError: null, preferencesError, fault: null, todoistConnection: { kind: 'disconnected' }, captureProjects: [],
      calendar: { authorization: 'notDetermined', calendars: [], appointments: [] } });

    // The caller holds the local queue. Reconcile timers before integrations after a decoded startup/restore.
    if (startupEffects) await this.runClockStageInner();
    if (this.disposed || lifecycle !== this.lifecycleGeneration || !this.readyState()) return this.getState();
    if (!this.initialIntegrationsStarted) {
      this.initialIntegrationsStarted = true;
      if (startupEffects) this.scheduleIntegration(() => this.syncTodoistInner(false, true));
    }
    return this.getState();
  }

  private async enterRecovery(reason: RecoveryReason): Promise<void> {
    const lifecycle = ++this.lifecycleGeneration;
    const inspectionID = ++this.recoveryGeneration;
    this.recoveryCandidate = null;
    this.publish({ kind: 'recovery', reason, message: recoveryMessage(reason, { kind: 'checking' }), resolution: { kind: 'checking' } });
    const capability = this.ports.recovery;
    if (!capability) {
      this.publishRecoveryResolution(reason, { kind: 'unavailable' }, lifecycle, inspectionID);
      return;
    }
    let inspection: TasksRecoveryInspection;
    try { inspection = await capability.inspect(); }
    catch {
      this.publishRecoveryResolution(reason, { kind: 'inspection-failed' }, lifecycle, inspectionID);
      return;
    }
    if (!this.isCurrentRecovery(lifecycle, inspectionID)) return;
    if (inspection.kind === 'unavailable') {
      this.publishRecoveryResolution(reason, { kind: 'no-valid-backup' }, lifecycle, inspectionID);
      return;
    }
    if (inspection.kind === 'unsupported-version') {
      this.publishRecoveryResolution(reason, { kind: 'unsupported-version' }, lifecycle, inspectionID);
      return;
    }

    const primary = inspection.primary;
    let primaryIsValid = false;
    if (primary.kind === 'present') {
      try { decodeTaskDocument(primary.document); primaryIsValid = true; }
      catch { /* Preserve the invalid snapshot for the explicit backup decision below. */ }
    }
    let backupDocument: TaskDocument | null = null;
    try { backupDocument = decodeTaskDocument(inspection.backup.document); }
    catch { /* A v1 envelope does not imply a semantically valid Tasks document. */ }
    if (primaryIsValid) {
      this.publishRecoveryResolution(reason, { kind: 'primary-changed' }, lifecycle, inspectionID);
      return;
    }
    if ((primary.kind === 'present' && hasUnsupportedTaskVersion(primary.document)) || hasUnsupportedTaskVersion(inspection.backup.document)) {
      this.publishRecoveryResolution(reason, { kind: 'unsupported-version' }, lifecycle, inspectionID);
      return;
    }
    if (!backupDocument) {
      this.publishRecoveryResolution(reason, { kind: 'no-valid-backup' }, lifecycle, inspectionID);
      return;
    }
    const backup = { taskCount: backupDocument.tasks.length, savedAt: inspection.backup.savedAt };
    this.recoveryCandidate = { primaryRevision: primary.kind === 'missing' ? null : primary.revision,
      backupRevision: inspection.backup.revision, backup };
    this.publishRecoveryResolution(reason, { kind: 'candidate', backup }, lifecycle, inspectionID);
  }

  private isCurrentRecovery(lifecycle: number, inspectionID: number): boolean {
    return !this.disposed && lifecycle === this.lifecycleGeneration && inspectionID === this.recoveryGeneration && this.state.kind === 'recovery';
  }
  private publishRecoveryResolution(reason: RecoveryReason, resolution: RecoveryResolution, lifecycle: number, inspectionID: number): void {
    if (!this.isCurrentRecovery(lifecycle, inspectionID)) return;
    this.publish({ kind: 'recovery', reason, message: recoveryMessage(reason, resolution), resolution });
  }
  private requireRecoveryCheck(reason: RecoveryReason, resolution: 'restore-failed' | 'inspection-failed' = 'inspection-failed'): void {
    this.lifecycleGeneration++;
    this.recoveryGeneration++;
    this.recoveryCandidate = null;
    this.publish({ kind: 'recovery', reason, message: recoveryMessage(reason, { kind: resolution }), resolution: { kind: resolution } });
  }

  checkBackupAgain(): Promise<TasksState> {
    const current = this.state;
    if (this.disposed || current.kind !== 'recovery' || current.resolution.kind === 'unsupported-version' ||
        current.resolution.kind === 'unavailable' || current.resolution.kind === 'restoring' || this.restoreInFlight ||
        this.checkInFlight || this.pendingDocument !== null || this.pendingPreferences !== null) return Promise.resolve(current);
    this.checkInFlight = true;
    return this.enqueueLocal(async () => {
      try {
        const state = this.state;
        if (state.kind !== 'recovery' || state.resolution.kind === 'unsupported-version' || state.resolution.kind === 'unavailable' ||
            state.resolution.kind === 'restoring' || this.restoreInFlight || this.pendingDocument !== null || this.pendingPreferences !== null) return this.state;
        await this.enterRecovery(state.reason);
        const inspected = this.state;
        if (inspected.kind !== 'recovery' || inspected.resolution.kind !== 'primary-changed') return this.state;
        const lifecycle = this.lifecycleGeneration;
        let stored;
        try { stored = await this.ports.store.load(); }
        catch { this.requireRecoveryCheck(state.reason); return this.state; }
        if (this.disposed || lifecycle !== this.lifecycleGeneration) return this.state;
        // Inspection found a present, valid primary. A missing result is not a fresh-install empty document here.
        if (stored.kind !== 'ready' || stored.document === null || !validRevision(stored.revision)) {
          this.requireRecoveryCheck(state.reason);
          return this.state;
        }
        let document: TaskDocument;
        try { document = decodeTaskDocument(stored.document); }
        catch { this.requireRecoveryCheck('corrupt'); return this.state; }
        await this.activateReadyInner(document, stored.revision, lifecycle, false);
        return this.getState();
      } finally { this.checkInFlight = false; }
    });
  }

  restoreBackup(): Promise<RecoveryRestoreOutcome> {
    const admittedState = this.state;
    const admittedCandidate = this.recoveryCandidate;
    if (this.disposed || admittedState.kind !== 'recovery' || admittedState.resolution.kind !== 'candidate' || !admittedCandidate ||
        !this.ports.recovery || this.pendingDocument !== null || this.pendingPreferences !== null || this.restoreInFlight || this.checkInFlight) {
      return Promise.resolve({ kind: 'unavailable' });
    }
    // Reserve synchronously, before queueing, so two confirmations cannot become sequential retries.
    this.restoreInFlight = true;
    return this.enqueueLocal(async () => {
      const state = this.state;
      const candidate = this.recoveryCandidate;
      if (this.disposed || state.kind !== 'recovery' || state.resolution.kind !== 'candidate' ||
          !candidate || candidate !== admittedCandidate || !this.ports.recovery || this.pendingDocument !== null || this.pendingPreferences !== null) {
        this.restoreInFlight = false;
        return { kind: 'unavailable' };
      }
      const lifecycle = ++this.lifecycleGeneration;
      this.publish({ kind: 'recovery', reason: state.reason, message: recoveryMessage(state.reason, { kind: 'restoring', backup: candidate.backup }),
        resolution: { kind: 'restoring', backup: candidate.backup } });
      try {
        const restored = await this.ports.recovery.restore({ expectedPrimaryRevision: candidate.primaryRevision, expectedBackupRevision: candidate.backupRevision });
        if (this.disposed || lifecycle !== this.lifecycleGeneration) return { kind: 'unavailable' };
        if (restored.kind === 'conflict') {
          this.recoveryCandidate = null;
          this.publish({ kind: 'recovery', reason: state.reason, message: recoveryMessage(state.reason, { kind: 'primary-changed' }), resolution: { kind: 'primary-changed' } });
          return { kind: 'conflict' };
        }
        this.recoveryCandidate = null;
        let stored;
        try { stored = await this.ports.store.load(); }
        catch { this.requireRecoveryCheck('loadFailed'); return { kind: 'failed' }; }
        if (this.disposed || lifecycle !== this.lifecycleGeneration) return { kind: 'unavailable' };
        if (stored.kind !== 'ready' || stored.document === null || !validRevision(stored.revision)) {
          this.requireRecoveryCheck(stored.kind === 'unreadable' ? 'unreadable' : 'corrupt');
          return { kind: 'failed' };
        }
        let document: TaskDocument;
        try { document = decodeTaskDocument(stored.document); }
        catch { this.requireRecoveryCheck('corrupt'); return { kind: 'failed' }; }
        await this.activateReadyInner(document, stored.revision, lifecycle, true);
        return this.getState().kind === 'ready' ? { kind: 'restored' } : { kind: 'failed' };
      } catch {
        if (!this.disposed && lifecycle === this.lifecycleGeneration && this.state.kind === 'recovery') {
          this.requireRecoveryCheck(state.reason, 'restore-failed');
        }
        return { kind: 'failed' };
      } finally { this.restoreInFlight = false; }
    });
  }

  getState(): TasksState { return this.state; }
  subscribe(listener: (state: TasksState) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  subscribeEvents(listener: (event: TasksEvent) => void): () => void { this.eventListeners.add(listener); return () => this.eventListeners.delete(listener); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeWindow?.(); this.unsubscribeWindow = null;
    this.listeners.clear(); this.eventListeners.clear();
    this.publish({ kind: 'disposed' });
  }
  runClockStage(): Promise<CommandOutcome<{ woken: number }>> {
    return this.enqueueLocal(() => this.runClockStageInner());
  }

  queryTasks(query: TaskListQuery): TaskListReadModel {
    const state = this.readyState();
    if (!state) throw new Error('Tasks are not available until initialization completes.');
    return queryTaskList(state.document, query, this.ports.clock.now(), state.preferences.ripeningSpeed);
  }
  queryTagCatalog(): TagCatalogEntry[] {
    const state = this.readyState();
    return state ? queryTagCatalog(state.document) : [];
  }
  queryTaskDetail(taskID: string): TaskDetailReadModel | null {
    const state = this.readyState();
    return state ? queryTaskDetail(state.document, taskID, this.ports.clock.now(), state.preferences.ripeningSpeed) : null;
  }
  queryAgentBrief(taskID: string): AgentBrief | null {
    const state = this.readyState(); return state ? queryAgentBrief(state.document, taskID) : null;
  }

  create(input: CreateTaskInput): Promise<CommandOutcome<{ taskID: string }>> {
    return this.enqueueLocal(async () => {
      const state = this.commandState(); if (!state) return this.unavailable('create_task');
      try {
        const result = createTask(state.document, input, this.context());
        if (isFailure(result)) return this.rejected(result.reason);
        const taskID = result.value.tasks[result.value.tasks.length - 1].id;
        const saved = await this.commitDocument(result.value);
        return saved ? { kind: 'applied', value: { taskID } } : this.persistenceOutcome('create_task');
      } catch (error) { return this.failedOutcome('create_task', error); }
    });
  }
  update(taskID: string, patch: UpdateTaskInput): Promise<CommandOutcome> {
    return this.mutateDoc('update_task', doc => updateTask(doc, taskID, patch, this.context()));
  }
  changeStatus(taskID: string, status: 'active' | 'waiting' | 'completed' | 'composted'): Promise<CommandOutcome> {
    return this.enqueueLocal(async () => {
      const state = this.commandState(); if (!state) return this.unavailable('change_task_status');
      try {
        const result = changeTaskStatus(state.document, taskID, status, this.context());
        if (isFailure(result)) return this.rejected(result.reason);
        if (result.value === state.document) return { kind: 'applied', value: undefined };
        const saved = await this.commitDocument(result.value);
        if (!saved) return this.persistenceOutcome('change_task_status');
        if (result.value.todoistOutbox.length > state.document.todoistOutbox.length) this.scheduleOutboxDrain();
        return { kind: 'applied', value: undefined };
      } catch (error) { return this.failedOutcome('change_task_status', error); }
    });
  }
  snooze(taskID: string, until: number): Promise<CommandOutcome> {
    return this.mutateDoc('snooze_task', doc => setSnoozeUntil(doc, taskID, until, this.context()));
  }
  restore(taskID: string): Promise<CommandOutcome> {
    return this.changeStatus(taskID, 'active');
  }
  progress(taskID: string, note = ''): Promise<CommandOutcome> {
    return this.mutateDoc('record_progress', doc => addProgress(doc, taskID, note, this.context()));
  }
  toggleTimer(taskID: string): Promise<CommandOutcome> {
    return this.mutateDoc('toggle_timer', doc => toggleTimer(doc, taskID, this.context()));
  }
  stopTimer(): Promise<CommandOutcome> {
    return this.mutateDoc('stop_timer', doc => stopTimer(doc, this.context()));
  }
  logEffort(taskID: string, durationMs: number): Promise<CommandOutcome> {
    return this.mutateDoc('log_effort', doc => addManualEffort(doc, taskID, durationMs, this.context()));
  }

  updatePreferences(patch: UpdatePreferencesInput): Promise<CommandOutcome<TasksPreferences>> {
    return this.enqueueLocal(async () => {
      const state = this.commandState(); if (!state) return this.unavailable('update_preferences');
      if (!this.writablePreferences || state.preferencesError) return this.unavailable('preferences_unavailable');
      if (!patch || Object.keys(patch).length === 0 || Object.keys(patch).some(key => !['appearanceTheme', 'pinned', 'soundEnabled', 'motionEnabled', 'ripeningSpeed'].includes(key))) {
        return this.rejected('invalid_input');
      }
      const candidate = { ...state.preferences, ...patch };
      if (!validPreferences(candidate)) return this.rejected('invalid_input');
      try {
        const saved = await this.ports.preferences.save(candidate);
        if (!validPreferences(saved)) throw new Error('The saved Tasks preferences response was invalid.');
        this.pendingPreferences = null;
        this.publishReady({ ...state, preferences: freeze({ ...saved }), preferencesError: null });
        return { kind: 'applied', value: { ...saved } };
      } catch (error) {
        this.pendingPreferences = candidate;
        const issue = fault('save_preferences', error);
        this.publishReady({ ...state, preferencesError: issue });
        return { kind: 'failed', error: issue };
      }
    });
  }

  async copyAgentBrief(taskID: string): Promise<CommandOutcome> {
    const brief = this.queryAgentBrief(taskID);
    if (!brief) return this.rejected('not_found');
    try { await this.ports.window.copyText(brief.text); return { kind: 'applied', value: undefined }; }
    catch (error) { return { kind: 'failed', error: fault('copy_agent_brief', error) }; }
  }

  connectTodoist(token: string): Promise<CommandOutcome<TodoistConnection>> {
    return this.enqueueIntegration(async () => {
      const state = await this.enqueueLocal(() => this.commandState());
      if (!state) return this.unavailable('connect_todoist');
      if (typeof token !== 'string' || token.trim().length === 0 || token.length > 4096) return this.rejected('invalid_input');
      try {
        const result = await this.ports.todoist.connect(token);
        if (!validConnection(result.connection) || !validProjects(result.projects)) throw new Error('The Todoist connection response was invalid.');
        const connection = result.connection;
        if (connection.kind !== 'connected' || (connection.projectID !== null && !result.projects.some(project => project.id === connection.projectID))) {
          throw new Error('The Todoist connection response was invalid.');
        }
        const published = await this.enqueueLocal(() => {
          const latest = this.commandState(); if (!latest) return false;
          this.publishReady({ ...latest, todoistConnection: connection, captureProjects: result.projects, fault: null });
          return true;
        });
        if (!published) return this.unavailable('connect_todoist');
        this.scheduleOutboxDrain();
        return { kind: 'applied', value: connection };
      } catch (error) { return this.integrationFailure('connect_todoist', error); }
    });
  }
  disconnectTodoist(): Promise<CommandOutcome> {
    return this.enqueueIntegration(async () => {
      const state = await this.enqueueLocal(() => this.commandState());
      if (!state) return this.unavailable('disconnect_todoist');
      try {
        await this.ports.todoist.disconnect();
        const published = await this.enqueueLocal(() => {
          const latest = this.commandState(); if (!latest || !sameConnection(latest.todoistConnection, state.todoistConnection)) return false;
          this.publishReady({ ...latest, todoistConnection: { kind: 'disconnected' }, captureProjects: [], fault: null });
          return true;
        });
        return published ? { kind: 'applied', value: undefined } : this.unavailable('disconnect_todoist');
      } catch (error) { return this.integrationFailure('disconnect_todoist', error); }
    });
  }
  loadTodoistProjects(): Promise<CommandOutcome<CaptureProject[]>> {
    return this.enqueueIntegration(async () => {
      const state = await this.enqueueLocal(() => this.commandState()); if (!state) return this.unavailable('load_todoist_projects');
      if (state.todoistConnection.kind !== 'connected') return this.rejected('not_connected');
      try {
        const projects = await this.ports.todoist.projects();
        if (!validProjects(projects)) throw new Error('The Todoist projects response was invalid.');
        const verified = await this.ports.todoist.connection();
        if (!validConnection(verified)) throw new Error('The Todoist connection response was invalid.');
        if (!sameConnection(state.todoistConnection, verified)) {
          await this.reconcileConnection(state.todoistConnection, verified, false);
          return this.unavailable('load_todoist_projects');
        }
        const published = await this.enqueueLocal(() => {
          const latest = this.commandState();
          if (!latest || !sameConnection(latest.todoistConnection, state.todoistConnection)) return false;
          this.publishReady({ ...latest, captureProjects: projects, fault: null });
          return true;
        });
        return published ? { kind: 'applied', value: projects } : this.unavailable('load_todoist_projects');
      } catch (error) { return this.integrationFailure('load_todoist_projects', error); }
    });
  }
  selectTodoistProject(projectID: string): Promise<CommandOutcome<TodoistConnection>> {
    return this.enqueueIntegration(async () => {
      const state = await this.enqueueLocal(() => this.commandState()); if (!state) return this.unavailable('select_todoist_project');
      if (state.todoistConnection.kind !== 'connected') return this.rejected('not_connected');
      if (!state.captureProjects.some(project => project.id === projectID)) return this.rejected('invalid_project');
      try {
        const accountID = state.todoistConnection.accountID;
        const connection = await this.ports.todoist.selectProject(projectID);
        if (!validConnection(connection) || connection.kind !== 'connected' || connection.accountID !== accountID || connection.projectID !== projectID) {
          throw new Error('The selected Todoist project response was invalid.');
        }
        const published = await this.enqueueLocal(() => {
          const latest = this.commandState();
          if (!latest || latest.todoistConnection.kind !== 'connected' || latest.todoistConnection.accountID !== accountID) return false;
          this.publishReady({ ...latest, todoistConnection: connection, fault: null });
          return true;
        });
        if (!published) return this.unavailable('select_todoist_project');
        this.scheduleOutboxDrain();
        return { kind: 'applied', value: connection };
      } catch (error) { return this.integrationFailure('select_todoist_project', error); }
    });
  }
  syncTodoist(): Promise<CommandOutcome<{ imported: number; pendingWritebacks: number }>> {
    return this.enqueueIntegration(() => this.syncTodoistInner(true));
  }

  private async runClockStageInner(): Promise<CommandOutcome<{ woken: number }>> {
    const state = this.commandState(); if (!state) return this.unavailable('clock_stage');
    try {
      const now = this.ports.clock.now();
      const due = state.document.tasks.filter(task => task.status.kind === 'snoozed' && task.status.until <= now).length;
      const result = wakeSnoozedTasks(state.document, { now, nextID: () => this.ports.identities.next() });
      if (isFailure(result)) return this.rejected(result.reason);
      if (result.value === state.document) return { kind: 'applied', value: { woken: 0 } };
      if (!await this.commitDocument(result.value)) return this.persistenceOutcome('clock_stage');
      return { kind: 'applied', value: { woken: due } };
    } catch (error) { return this.failedOutcome('clock_stage', error); }
  }

  private async syncTodoistInner(returnOutcome = false, discover = false): Promise<CommandOutcome<{ imported: number; pendingWritebacks: number }>> {
    const initial = await this.enqueueLocal(() => this.commandState());
    if (!initial) return this.unavailable('sync_todoist');
    let connection: TodoistConnection;
    try { connection = await this.ports.todoist.connection(); }
    catch (error) { return this.integrationFailure('todoist_connection', error); }
    if (!validConnection(connection)) return this.integrationFailure('todoist_connection', new Error('The Todoist connection response was invalid.'));

    const selected = await this.reconcileConnection(initial.todoistConnection, connection, discover);
    if (!selected) return returnOutcome ? this.rejected('not_connected') : this.pendingWritebacksOutcome(0);
    if (connection.kind !== 'connected') {
      return returnOutcome ? this.rejected('not_connected') : this.pendingWritebacksOutcome(0);
    }
    if (!connection.projectID) return returnOutcome ? this.rejected('no_project') : this.pendingWritebacksOutcome(0);

    try {
      const captures = await this.ports.todoist.captures();
      const verified = await this.ports.todoist.connection();
      if (!validConnection(verified)) return this.integrationFailure('todoist_connection', new Error('The Todoist connection response was invalid.'));
      if (!sameConnection(connection, verified)) {
        await this.reconcileConnection(connection, verified, false);
        return returnOutcome ? this.rejected('not_connected') : this.pendingWritebacksOutcome(0);
      }
      const importedResult = await this.enqueueLocal(async () => {
        const current = this.commandState();
        if (!current || !sameConnection(current.todoistConnection, connection)) return { kind: 'stale' as const };
        const decision = importCaptures(current.document, captures, connection.accountID, connection.projectID!, this.context());
        if (isFailure(decision)) return { kind: 'rejected' as const, reason: decision.reason };
        const imported = decision.value.tasks.length - current.document.tasks.length;
        if (imported > 0 && !await this.commitDocument(decision.value)) return { kind: 'persistence' as const };
        return { kind: 'imported' as const, count: imported };
      });
      if (importedResult.kind === 'stale') return returnOutcome ? this.rejected('not_connected') : this.pendingWritebacksOutcome(0);
      if (importedResult.kind === 'rejected') return this.rejected(importedResult.reason);
      if (importedResult.kind === 'persistence') return this.persistenceOutcome('sync_todoist');
      const more = await this.drainOutboxInner();
      if (more) this.scheduleOutboxDrain();
      const after = await this.enqueueLocal(() => this.readyState()?.document.todoistOutbox.length ?? 0);
      return { kind: 'applied', value: { imported: importedResult.count, pendingWritebacks: after } };
    } catch (error) { return this.integrationFailure('sync_todoist', error); }
  }

  private async drainOutboxInner(): Promise<boolean> {
    for (let count = 0; count < 8; count++) {
      const snapshot = await this.enqueueLocal(() => {
        const state = this.commandState();
        return state ? { connection: state.todoistConnection, operations: state.document.todoistOutbox } : null;
      });
      if (!snapshot || snapshot.operations.length === 0) return false;
      let connection: TodoistConnection;
      try { connection = await this.ports.todoist.connection(); }
      catch (error) { await this.enqueueLocal(() => this.setFault('todoist_outbox_connection', error)); return false; }
      if (!validConnection(connection)) {
        await this.enqueueLocal(() => this.setFault('todoist_outbox_connection', new Error('The Todoist connection response was invalid.')));
        return false;
      }
      if (!sameConnection(snapshot.connection, connection)) await this.reconcileConnection(snapshot.connection, connection, false);
      if (connection.kind !== 'connected') return false;

      const blockedTasks = new Set<string>();
      const operation = snapshot.operations.find(candidate => {
        const key = todoistTaskKey(candidate);
        if (blockedTasks.has(key)) return false;
        if (candidate.source.accountID === connection.accountID && candidate.source.projectID === connection.projectID) return true;
        blockedTasks.add(key);
        return false;
      });
      if (!operation) return false;
      try {
        await this.ports.todoist.setCompleted(operation.source, operation.completed, operation.operationID);
      } catch (error) { await this.enqueueLocal(() => this.setFault('todoist_writeback', error)); return false; }
      const removed = await this.enqueueLocal(async () => {
        const latest = this.commandState();
        if (!latest || !latest.document.todoistOutbox.some(item => item.operationID === operation.operationID)) return false;
        const decision = removeTodoistOperation(latest.document, operation.operationID);
        return decision.kind !== 'rejected' && await this.commitDocument(decision.value);
      });
      if (!removed) return false;
    }
    return await this.enqueueLocal(() => !!this.commandState()?.document.todoistOutbox.length);
  }

  requestCalendarAccess(): Promise<CommandOutcome<CalendarAuthorization>> {
    return this.enqueueIntegration(async () => {
      const state = await this.enqueueLocal(() => this.commandState()); if (!state) return this.unavailable('request_calendar_access');
      try {
        const authorization = await this.ports.calendar.requestAccess();
        if (!['notDetermined', 'authorized', 'denied', 'unavailable'].includes(authorization)) throw new Error('The calendar authorization response was invalid.');
        const published = await this.enqueueLocal(() => {
          const latest = this.commandState(); if (!latest) return false;
          this.publishReady({ ...latest, calendar: { ...latest.calendar, authorization } });
          return true;
        });
        return published ? { kind: 'applied', value: authorization } : this.unavailable('request_calendar_access');
      } catch (error) { return this.integrationFailure('request_calendar_access', error); }
    });
  }
  loadCalendar(start: number, end: number): Promise<CommandOutcome<{ calendars: PlanningCalendar[]; appointments: CalendarAppointment[] }>> {
    return this.enqueueIntegration(() => this.loadCalendarInner(start, end));
  }
  private async loadCalendarInner(start: number, end: number): Promise<CommandOutcome<{ calendars: PlanningCalendar[]; appointments: CalendarAppointment[] }>> {
    const state = await this.enqueueLocal(() => this.commandState()); if (!state) return this.unavailable('load_calendar');
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end - start > 366 * 24 * 60 * 60 * 1000) return this.rejected('invalid_calendar_range');
    try {
      const authorization = await this.ports.calendar.authorization();
      if (!['notDetermined', 'authorized', 'denied', 'unavailable'].includes(authorization)) throw new Error('The calendar authorization response was invalid.');
      if (authorization !== 'authorized') {
        const published = await this.enqueueLocal(() => {
          const latest = this.commandState(); if (!latest) return false;
          this.publishReady({ ...latest, calendar: { authorization, calendars: [], appointments: [] } });
          return true;
        });
        return published ? { kind: 'applied', value: { calendars: [], appointments: [] } } : this.unavailable('load_calendar');
      }
      const [calendars, appointments] = await Promise.all([this.ports.calendar.calendars(), this.ports.calendar.appointments(start, end)]);
      if (!validCalendars(calendars) || !validAppointments(appointments, start, end)) throw new Error('The calendar data response was invalid.');
      const published = await this.enqueueLocal(() => {
        const latest = this.commandState(); if (!latest) return false;
        this.publishReady({ ...latest, calendar: { authorization, calendars, appointments } });
        return true;
      });
      return published ? { kind: 'applied', value: { calendars, appointments } } : this.unavailable('load_calendar');
    } catch (error) { return this.integrationFailure('load_calendar', error); }
  }
  scheduleTask(taskID: string, calendarID: string, start: number, end: number): Promise<CommandOutcome<CalendarBlockReceipt>> {
    return this.enqueueIntegration(async () => {
      const prepared = await this.enqueueLocal(() => {
        const state = this.commandState(); if (!state) return { kind: 'unavailable' as const };
        const task = state.document.tasks.find(item => item.id === taskID);
        const calendar = state.calendar.calendars.find(item => item.id === calendarID);
        if (!task || task.status.kind !== 'active') return { kind: 'rejected' as const, reason: 'task_not_schedulable' as const };
        if (!calendar || !calendar.writable) return { kind: 'rejected' as const, reason: 'not_writable' as const };
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < this.ports.clock.now() || end <= start || end - start > 12 * 60 * 60 * 1000) {
          return { kind: 'rejected' as const, reason: 'invalid_calendar_range' as const };
        }
        return { kind: 'ready' as const, draft: { blockID: this.ports.identities.next(), taskID, title: task.title, start, end, calendarID } satisfies CalendarBlockDraft };
      });
      if (prepared.kind === 'unavailable') return this.unavailable('schedule_task');
      if (prepared.kind === 'rejected') return this.rejected(prepared.reason);
      try {
        const receipt = await this.ports.calendar.createBlock(prepared.draft);
        if (!validReceipt(receipt) || receipt.start !== start || receipt.end !== end || receipt.calendarID !== calendarID) throw new Error('The calendar block receipt was invalid.');
        await this.enqueueLocal(() => {
          const latest = this.readyState();
          if (latest) this.publishReady({ ...latest, calendar: { ...latest.calendar, appointments: [...latest.calendar.appointments, {
            id: receipt.id, title: prepared.draft.title, start: receipt.start, end: receipt.end, allDay: false,
          }].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id, 'en')) } });
        });
        return { kind: 'applied', value: receipt };
      } catch (error) { return this.integrationFailure('schedule_task', error); }
    });
  }

  exportLocalChanges(): string | null {
    if (this.pendingDocument) return JSON.stringify(this.pendingDocument, null, 2);
    const state = this.readyState(); return state ? JSON.stringify(state.document, null, 2) : null;
  }

  flush(): Promise<boolean> {
    return this.enqueueLocal(async () => {
      // Startup recovery has no accepted local intent; hide/quit remains a no-op success.
      if (this.state.kind === 'recovery') return this.pendingDocument === null && this.pendingPreferences === null;
      if (!this.readyState()) return false;
      if (this.pendingDocument) {
        const state = this.readyState();
        if (!state?.persistenceError || state.persistenceError.kind !== 'saveFailed') return false;
        if (!await this.commitDocument(this.pendingDocument, true)) return false;
      }
      if (this.pendingPreferences) {
        const state = this.readyState(); if (!state || !this.writablePreferences) return false;
        try {
          const saved = await this.ports.preferences.save(this.pendingPreferences);
          if (!validPreferences(saved)) throw new Error('The saved Tasks preferences response was invalid.');
          this.pendingPreferences = null;
          this.publishReady({ ...state, preferences: freeze({ ...saved }), preferencesError: null });
        } catch (error) { this.setPreferenceFault(error); return false; }
      }
      const final = this.readyState(); return !!final && !final.persistenceError && this.pendingPreferences === null;
    });
  }

  private mutateDoc(operation: string, decide: (document: TaskDocument) => Decision<TaskDocument>): Promise<CommandOutcome> {
    return this.enqueueLocal(async () => {
      const state = this.commandState(); if (!state) return this.unavailable(operation);
      try {
        const result = decide(state.document);
        if (isFailure(result)) return this.rejected(result.reason);
        if (!await this.commitDocument(result.value)) return this.persistenceOutcome(operation);
        return { kind: 'applied', value: undefined };
      } catch (error) { return this.failedOutcome(operation, error); }
    });
  }

  private async commitDocument(candidate: TaskDocument, retry = false): Promise<boolean> {
    if (this.disposed) return false;
    const state = this.readyState();
    if (!state) return false;
    let document: TaskDocument;
    try { document = validateTaskDocument(candidate); }
    catch (error) { this.setFault('validate_tasks', error); return false; }
    if (this.pendingDocument && !retry) return false;
    try {
      const result = await this.ports.store.save(this.revision, document);
      if (this.disposed) return false;
      if (result.kind === 'conflict') {
        this.pendingDocument = copyDocument(document);
        const latest = this.readyState() ?? state;
        this.publishReady({ ...latest, persistenceError: { kind: 'conflict', message: 'Tasks changed in another writer. Local changes are preserved for export; this controller will not overwrite the newer revision.', localDocument: freeze(copyDocument(document)) } });
        return false;
      }
      if (result.kind !== 'saved' || !validRevision(result.revision)) throw new Error('The Tasks store returned an invalid save result.');
      this.revision = result.revision;
      this.pendingDocument = null;
      const latest = this.readyState() ?? state;
      this.publishReady({ ...latest, document: freeze(document), revision: result.revision, persistenceError: null });
      return true;
    } catch (error) {
      this.pendingDocument = copyDocument(document);
      const latest = this.readyState() ?? state;
      this.publishReady({ ...latest, persistenceError: { kind: 'saveFailed', message: fault('save_tasks', error).message, localDocument: freeze(copyDocument(document)) } });
      return false;
    }
  }

  private commandState(): Extract<TasksState, { kind: 'ready' }> | null {
    const state = this.readyState();
    return state && !state.persistenceError ? state : null;
  }
  private readyState(): Extract<TasksState, { kind: 'ready' }> | null { return this.state.kind === 'ready' ? this.state : null; }
  private context() { return { now: this.ports.clock.now(), nextID: () => this.ports.identities.next() }; }
  private enqueueLocal<T>(work: () => Promise<T> | T): Promise<T> {
    const run = this.localTail.then(work, work);
    this.localTail = run.then(() => undefined, () => undefined);
    return run;
  }
  private enqueueIntegration<T>(work: () => Promise<T>): Promise<T> {
    const run = this.integrationTail.then(work, work);
    this.integrationTail = run.then(() => undefined, () => undefined);
    return run;
  }
  private scheduleIntegration(work: () => Promise<unknown>): void {
    if (this.disposed) return;
    void this.enqueueIntegration(work).catch(() => undefined);
  }
  private scheduleOutboxDrain(): void {
    if (this.disposed || this.outboxDrainScheduled || !this.readyState()?.document.todoistOutbox.length) return;
    this.outboxDrainScheduled = true;
    this.scheduleIntegration(async () => {
      this.outboxDrainScheduled = false;
      if (await this.drainOutboxInner()) this.scheduleOutboxDrain();
    });
  }
  private async integrationFailure<T = never>(operation: string, error: unknown): Promise<CommandOutcome<T>> {
    const issue = fault(operation, error);
    await this.enqueueLocal(() => this.setFault(operation, error));
    return { kind: 'failed', error: issue };
  }
  private async reconcileConnection(expected: TodoistConnection, actual: TodoistConnection, discover: boolean): Promise<boolean> {
    return this.enqueueLocal(() => {
      const latest = this.commandState();
      if (!latest || !sameConnection(latest.todoistConnection, expected)) return false;
      const matches = sameConnection(expected, actual);
      if (!matches) {
        const sameAccount = expected.kind === 'connected' && actual.kind === 'connected' && expected.accountID === actual.accountID;
        this.publishReady({ ...latest, todoistConnection: actual, captureProjects: sameAccount ? latest.captureProjects : [], fault: null });
      }
      return matches || (discover && expected.kind === 'disconnected');
    });
  }
  private async pendingWritebacksOutcome(imported: number): Promise<CommandOutcome<{ imported: number; pendingWritebacks: number }>> {
    const pendingWritebacks = await this.enqueueLocal(() => this.readyState()?.document.todoistOutbox.length ?? 0);
    return { kind: 'applied', value: { imported, pendingWritebacks } };
  }
  private publish(state: TasksState): void {
    if (this.disposed && state.kind !== 'disposed') return;
    this.state = freeze(state);
    for (const listener of this.listeners) { try { listener(this.state); } catch { /* Observer faults do not cancel committed work. */ } }
  }
  private publishReady(state: Extract<TasksState, { kind: 'ready' }>): void { this.publish(state); }
  private setFault(operation: string, error: unknown): void {
    const state = this.readyState(); if (state) this.publishReady({ ...state, fault: fault(operation, error) });
  }
  private setPreferenceFault(error: unknown): void {
    const state = this.readyState(); if (state) this.publishReady({ ...state, preferencesError: fault('save_preferences', error) });
  }
  private failedOutcome<T = undefined>(operation: string, error: unknown): CommandOutcome<T> {
    const issue = fault(operation, error);
    this.setFault(operation, error);
    return { kind: 'failed', error: issue };
  }
  private rejected<T = undefined>(reason: DomainFailure | 'not_connected' | 'no_project' | 'invalid_project' | 'not_writable' | 'invalid_calendar_range' | 'task_not_schedulable'): CommandOutcome<T> {
    return { kind: 'rejected', reason };
  }
  private unavailable<T = undefined>(operation: string): CommandOutcome<T> { return { kind: 'unavailable', operation }; }
  private persistenceOutcome<T = undefined>(operation: string): CommandOutcome<T> {
    const state = this.readyState();
    return state?.persistenceError?.kind === 'conflict'
      ? { kind: 'failed', error: { operation, message: state.persistenceError.message } }
      : { kind: 'failed', error: { operation, message: state?.persistenceError?.message ?? 'The Tasks store is unavailable.' } };
  }
}

function validCalendars(value: unknown): value is PlanningCalendar[] {
  return Array.isArray(value) && value.length <= 500 && value.every(item => !!item && typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 128 &&
    typeof item.title === 'string' && item.title.length <= 512 && typeof item.sourceTitle === 'string' && item.sourceTitle.length <= 512 && typeof item.writable === 'boolean');
}
function validAppointments(value: unknown, start: number, end: number): value is CalendarAppointment[] {
  return Array.isArray(value) && value.length <= 100_000 && value.every(item => !!item && typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 128 &&
    typeof item.title === 'string' && item.title.length <= 1000 && Number.isSafeInteger(item.start) && Number.isSafeInteger(item.end) && item.start < item.end &&
    item.end >= start && item.start <= end && typeof item.allDay === 'boolean');
}
function validReceipt(value: unknown): value is CalendarBlockReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  return typeof receipt.id === 'string' && receipt.id.length > 0 && receipt.id.length <= 128 && Number.isSafeInteger(receipt.start) &&
    Number.isSafeInteger(receipt.end) && (receipt.end as number) > (receipt.start as number) && typeof receipt.calendarID === 'string' && receipt.calendarID.length > 0;
}
