import { Check } from 'lucide';
import { applyAppearance } from '../../ui/appearance';
import { renderIcon } from '../../ui/icon';
import { applyNoteFont } from '../../ui/note-font';
import { themeByID, resolveThemeID } from '../../domain/themes';
import type { NoteFontState } from '../../domain/note-font';
import type { TasksFacade, TasksState, CommandOutcome } from '../application/controller';
import type { TasksWindowPort } from '../application/ports';
import type { TaskDetailReadModel } from '../domain/queries';
import { describeOutcome, formatAge, formatEffort, isApplied, makeButton, makeElement } from './helpers';
import { mountTasksList, type MountedTaskList } from './list';
import { mountTaskDetail, type GlobalTimerReadModel, type MountedTaskDetail } from './detail';
import { mountTasksSettings } from './settings';
import { mountTasksPlanning } from './planning';
import { observeWindowDragRegion } from '../../ui/window-drag';
import { playCompletionSound } from './feedback';
import type { MountedTasksScreen, TasksScreenOptions } from './contracts';

const COMPLETION_MOTION = {
  backdropAt: 0,
  backdropDuration: 140,
  cardAt: 0,
  cardDuration: 220,
  markAt: 60,
  markDuration: 260,
  sparkAt: 120,
  sparkDuration: 280,
} as const;

export function mountTasksApp(
  root: HTMLElement,
  facade: TasksFacade,
  options: { window: TasksWindowPort; fontState: NoteFontState },
): MountedTasksScreen {
  const document = root.ownerDocument;
  const viewHost = makeElement(document, 'div', 'tasks-view-host');
  const globalAlerts = makeElement(document, 'div', 'tasks-global-alerts');
  globalAlerts.setAttribute('aria-label', 'Tasks status');
  const persistenceNotice = makeElement(document, 'section', 'tasks-persistence-notice');
  persistenceNotice.setAttribute('role', 'alert');
  persistenceNotice.setAttribute('aria-live', 'assertive');
  const persistenceMessage = makeElement(document, 'p', 'tasks-persistence-message');
  const recoveryDetails = makeElement(document, 'details', 'tasks-preserved-details');
  const recoverySummary = makeElement(document, 'summary', 'tasks-preserved-summary', 'Review preserved JSON');
  const preservedJSON = makeElement(document, 'textarea', 'tasks-preserved-json');
  preservedJSON.readOnly = true; preservedJSON.spellcheck = false; preservedJSON.setAttribute('aria-label', 'Preserved local task JSON');
  const exportHelp = makeElement(document, 'p', 'tasks-preserved-help');
  const recoveryActions = makeElement(document, 'div', 'tasks-recovery-actions');
  const retrySaveButton = makeElement(document, 'button', 'tasks-recovery-button', 'Retry local save');
  retrySaveButton.type = 'button';
  const copyJSONButton = makeElement(document, 'button', 'tasks-recovery-button', 'Copy JSON');
  copyJSONButton.type = 'button';
  const previewDownloadButton = makeElement(document, 'button', 'tasks-recovery-button', 'Download JSON');
  previewDownloadButton.type = 'button'; previewDownloadButton.hidden = options.window.environment !== 'preview';
  const recoveryActionStatus = makeElement(document, 'span', 'tasks-recovery-status');
  recoveryActionStatus.setAttribute('role', 'status'); recoveryActionStatus.setAttribute('aria-live', 'polite');
  recoveryActions.append(retrySaveButton, copyJSONButton, previewDownloadButton, recoveryActionStatus);
  recoveryDetails.append(recoverySummary, preservedJSON, exportHelp, recoveryActions);
  persistenceNotice.append(persistenceMessage, recoveryDetails);

  const integrationNotice = makeElement(document, 'p', 'tasks-integration-notice');
  integrationNotice.setAttribute('role', 'status'); integrationNotice.setAttribute('aria-live', 'polite');
  const announcer = makeElement(document, 'div', 'visually-hidden tasks-announcer');
  announcer.setAttribute('role', 'status'); announcer.setAttribute('aria-live', 'polite'); announcer.setAttribute('aria-atomic', 'true');
  globalAlerts.append(persistenceNotice, integrationNotice);
  root.classList.add('tasks-app-root');
  root.replaceChildren(viewHost, globalAlerts, announcer);

  let state: TasksState = facade.getState();
  let currentScreen: 'list' | 'detail' | 'settings' | 'planning' = 'list';
  let listView: MountedTaskList | null = null;
  let detailView: MountedTaskDetail | null = null;
  let childScreen: MountedTasksScreen | null = null;
  let detailTaskID: string | null = null;
  let lastTaskID: string | null = null;
  let completionOverlay: HTMLElement | null = null;
  let pendingTaskActions = new Map<string, string>();
  let focused = document.documentElement.dataset.focused !== 'false';
  let visible = document.visibilityState !== 'hidden';
  let disposed = false;
  let dragDisposer: (() => void) | null = null;
  let timerInterval: number | null = null;
  let clockStagePending = false;
  let previousClockReady = false;
  let fontApplied = false;
  let lastThemeID: string | null = null;
  const downloadURLs = new Set<string>();
  const downloadTimers = new Set<number>();
  let lastCompletionFocus: HTMLElement | null = null;

  const appWindow = document.defaultView;
  const reducedMotionQuery = appWindow?.matchMedia?.('(prefers-reduced-motion: reduce)');
  const systemDarkQuery = appWindow?.matchMedia?.('(prefers-color-scheme: dark)');

  function notify(message: string, kind: 'status' | 'error' = 'status'): void {
    if (disposed) return;
    announcer.textContent = message;
    announcer.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  }

  function motionAllowed(): boolean {
    return state.kind === 'ready' && state.preferences.motionEnabled && !reducedMotionQuery?.matches && focused && visible;
  }

  function updateMotionAttributes(): void {
    document.documentElement.dataset.focused = String(focused);
    document.documentElement.dataset.tasksVisible = String(visible);
    document.documentElement.dataset.tasksMotion = motionAllowed() ? 'enabled' : 'disabled';
    if (completionOverlay && (!focused || !visible || reducedMotionQuery?.matches)) completionOverlay.dataset.motion = 'disabled';
  }

  function appearanceFor(current: TasksState): { id: string; dark: boolean } {
    const selected = current.kind === 'ready' ? current.preferences.appearanceTheme : null;
    const id = resolveThemeID(selected);
    const theme = themeByID(id);
    return { id, dark: theme ? theme.appearance === 'dark' : !!systemDarkQuery?.matches };
  }

  function updateAppearance(current: TasksState): void {
    if (current.kind !== 'ready') return;
    const { id, dark } = appearanceFor(current);
    if (lastThemeID !== id) {
      applyAppearance(document.documentElement, current.preferences.appearanceTheme);
      lastThemeID = id;
    }
    listView?.setAppearance(dark);
    const detailLogo = viewHost.querySelector<HTMLImageElement>('.tasks-detail-screen .tasks-brand-lockup');
    if (detailLogo) detailLogo.src = dark ? 'tasks-brand/logo-dark.svg' : 'tasks-brand/logo.svg';
    updateMotionAttributes();
  }

  function currentGlobalTimer(): GlobalTimerReadModel | null {
    if (state.kind !== 'ready') return null;
    // Only the singleton session identity is read from state; task display comes from the detail query.
    const session = state.document.runningSession;
    if (!session) return null;
    const detail = facade.queryTaskDetail(session.taskID);
    return detail?.running ? { taskID: detail.id, title: detail.title, elapsedMs: detail.running.elapsedMs } : null;
  }

  function updateTimerDisplays(): void {
    if (disposed) return;
    const timer = currentGlobalTimer();
    listView?.setGlobalTimer(timer);
    detailView?.tick();
    const canTick = !!timer && focused && visible && !disposed;
    if (canTick && timerInterval === null && appWindow) {
      timerInterval = appWindow.setInterval(updateTimerDisplays, 1000);
    } else if (!canTick && timerInterval !== null && appWindow) {
      appWindow.clearInterval(timerInterval); timerInterval = null;
    }
  }

  function observeDragRegion(): void {
    dragDisposer?.(); dragDisposer = null;
    if (disposed || options.window.environment !== 'native' || typeof ResizeObserver === 'undefined') return;
    const spacer = viewHost.querySelector<HTMLElement>('[data-tasks-drag-region]');
    if (!spacer) return;
    dragDisposer = observeWindowDragRegion(spacer, rect => {
      void options.window.setDragRegion(rect).catch(() => undefined);
    });
  }

  function isPending(taskID: string, _action: string): boolean {
    return pendingTaskActions.has(taskID);
  }

  function updateCurrentView(): void {
    if (disposed) return;
    if (currentScreen === 'list') {
      listView?.update(state);
      if (state.kind === 'ready') listView?.setPinState(state.preferences.pinned, pendingTaskActions.has('@preferences'));
    } else if (currentScreen === 'detail') {
      detailView?.update(state);
      if (state.kind === 'ready') detailView?.setPinState(state.preferences.pinned, pendingTaskActions.has('@preferences'));
    }
    renderNotices(state);
    updateAppearance(state);
    updateTimerDisplays();
  }

  async function perform<T = undefined>(taskID: string, action: string, command: () => Promise<CommandOutcome<T>>): Promise<CommandOutcome<T>> {
    if (disposed) return { kind: 'unavailable', operation: 'tasks_disposed' };
    if (pendingTaskActions.has(taskID)) return { kind: 'unavailable', operation: 'action_pending' };
    pendingTaskActions.set(taskID, action);
    updateCurrentView();
    try {
      const outcome = await command();
      if (!isApplied(outcome)) notify(describeOutcome(outcome, 'That task action was not saved.'), 'error');
      return outcome;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'That task action was not saved.';
      notify(message, 'error');
      return { kind: 'failed', error: { operation: action, message } };
    } finally {
      pendingTaskActions.delete(taskID);
      updateCurrentView();
    }
  }

  function clearCompletionOverlay(): void {
    completionOverlay?.remove(); completionOverlay = null;
    if (lastCompletionFocus?.isConnected) lastCompletionFocus.focus();
    else listView?.focusCapture();
    lastCompletionFocus = null;
  }

  async function completeTask(taskID: string): Promise<void> {
    if (currentScreen === 'detail' && detailTaskID === taskID && detailView && !(await detailView.commitDraft())) return;
    const before = facade.queryTaskDetail(taskID);
    lastCompletionFocus = [...viewHost.querySelectorAll<HTMLElement>('[data-task-id]')]
      .find(row => row.dataset.taskId === taskID)?.querySelector<HTMLElement>('.tasks-row-complete') ?? null;
    const outcome = await perform(taskID, 'complete', () => facade.changeStatus(taskID, 'completed'));
    if (!isApplied(outcome)) { lastCompletionFocus = null; return; }
    const completed = facade.queryTaskDetail(taskID);
    if (!completed) { lastCompletionFocus = null; return; }
    if (currentScreen === 'detail') mountListScreen();
    showCompletionCard(completed, before);
    if (state.kind === 'ready' && state.preferences.soundEnabled) void playCompletionSound();
  }

  function exportJSON(): string | null {
    try { return facade.exportLocalChanges(); } catch { return null; }
  }

  function exportInPreview(): void {
    if (options.window.environment !== 'preview') return;
    const content = exportJSON();
    if (content === null) { recoveryActionStatus.textContent = 'No preserved local JSON is available.'; return; }
    const browserURL = appWindow?.URL;
    if (!appWindow || typeof appWindow.Blob !== 'function' || typeof browserURL?.createObjectURL !== 'function') {
      recoveryActionStatus.textContent = 'A browser download is unavailable here. The preserved JSON remains available below.';
      return;
    }
    let url = '';
    try {
      url = browserURL.createObjectURL(new appWindow.Blob([content], { type: 'application/json' }));
      downloadURLs.add(url);
      const link = makeElement(document, 'a', 'tasks-download-link');
      link.href = url; link.download = 'banana-tasks-local-changes.json';
      document.body.append(link); link.click(); link.remove();
      recoveryActionStatus.textContent = 'Browser download requested; local changes remain preserved.';
      const timer = appWindow.setTimeout(() => {
        browserURL.revokeObjectURL(url); downloadURLs.delete(url); downloadTimers.delete(timer);
      }, 1000);
      downloadTimers.add(timer);
    } catch {
      if (url) { browserURL.revokeObjectURL(url); downloadURLs.delete(url); }
      recoveryActionStatus.textContent = 'The browser could not start the download. The preserved JSON remains available below.';
    }
  }

  function updateRecoveryExport(): void {
    const content = exportJSON();
    const available = content !== null;
    recoveryDetails.hidden = !available;
    if (!available) {
      preservedJSON.value = '';
      exportHelp.textContent = '';
      return;
    }
    if (preservedJSON.value !== content) preservedJSON.value = content;
    const withinClipboardLimit = content.length <= 100_000;
    copyJSONButton.disabled = !withinClipboardLimit;
    exportHelp.textContent = withinClipboardLimit
      ? 'This read-only copy contains local task data. Copying is an explicit action.'
      : 'The native clipboard bridge allows 100,000 characters at a time. Select and copy only the part you need.';
  }

  async function copyPreservedJSON(): Promise<void> {
    const content = exportJSON();
    if (content === null) { recoveryActionStatus.textContent = 'No preserved local JSON is available.'; return; }
    if (content.length > 100_000) {
      recoveryActionStatus.textContent = 'This JSON exceeds the 100,000-character clipboard limit. Select a smaller part of the read-only text.';
      return;
    }
    try {
      await options.window.copyText(content);
      recoveryActionStatus.textContent = 'Preserved local JSON copied.';
      notify('Preserved local JSON copied.');
    } catch (error) {
      recoveryActionStatus.textContent = error instanceof Error ? `Copy failed: ${error.message}` : 'Copy failed. The JSON remains available below.';
      notify(recoveryActionStatus.textContent, 'error');
    }
  }

  function renderNotices(current: TasksState): void {
    if (current.kind === 'ready' && current.persistenceError) {
      const issue = current.persistenceError;
      persistenceNotice.hidden = false;
      persistenceMessage.textContent = issue.kind === 'conflict'
        ? 'Tasks changed in another writer. Your local changes are preserved; this view will not overwrite the newer revision.'
        : 'The latest local task changes could not be saved. Retry the local save or export the preserved copy.';
      retrySaveButton.hidden = issue.kind !== 'saveFailed';
      retrySaveButton.disabled = pendingTaskActions.has('@flush');
      updateRecoveryExport();
    } else {
      persistenceNotice.hidden = true;
      recoveryActionStatus.textContent = '';
    }

    if (current.kind === 'ready' && current.fault) {
      integrationNotice.hidden = false;
      if (current.fault.operation.startsWith('todoist')) integrationNotice.textContent = 'Todoist needs attention. Local task work remains available.';
      else if (current.fault.operation.startsWith('calendar') || current.fault.operation.startsWith('schedule')) integrationNotice.textContent = 'Calendar needs attention. Local task work remains available.';
      else integrationNotice.textContent = 'A Tasks operation needs attention. Local task work remains available.';
    } else integrationNotice.hidden = true;
  }

  function showCompletionCard(detail: TaskDetailReadModel, before: TaskDetailReadModel | null): void {
    clearCompletionOverlay();
    const overlay = makeElement(document, 'div', 'tasks-completion-overlay');
    overlay.dataset.motion = motionAllowed() ? 'enabled' : 'disabled';
    overlay.style.setProperty('--tasks-backdrop-duration', `${COMPLETION_MOTION.backdropDuration}ms`);
    overlay.style.setProperty('--tasks-backdrop-delay', `${COMPLETION_MOTION.backdropAt}ms`);
    overlay.style.setProperty('--tasks-card-duration', `${COMPLETION_MOTION.cardDuration}ms`);
    overlay.style.setProperty('--tasks-card-delay', `${COMPLETION_MOTION.cardAt}ms`);
    overlay.style.setProperty('--tasks-mark-duration', `${COMPLETION_MOTION.markDuration}ms`);
    overlay.style.setProperty('--tasks-mark-delay', `${COMPLETION_MOTION.markAt}ms`);
    overlay.style.setProperty('--tasks-spark-duration', `${COMPLETION_MOTION.sparkDuration}ms`);
    overlay.style.setProperty('--tasks-spark-delay', `${COMPLETION_MOTION.sparkAt}ms`);
    overlay.setAttribute('aria-label', 'Task completed');

    const card = makeElement(document, 'section', 'tasks-completion-card');
    card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-labelledby', 'tasks-completion-title'); card.setAttribute('tabindex', '-1');
    const cardHeader = makeElement(document, 'div', 'tasks-completion-header');
    const status = makeElement(document, 'h2', 'tasks-completion-status', 'Task completed');
    const saved = makeElement(document, 'span', 'tasks-completion-saved', options.window.environment === 'native' ? 'Saved on this Mac' : 'Saved in this browser');
    cardHeader.append(status, saved);

    const markLane = makeElement(document, 'div', 'tasks-completion-mark-lane');
    markLane.setAttribute('aria-hidden', 'true');
    const sparkOne = makeElement(document, 'span', 'tasks-completion-spark spark-one');
    const mark = makeElement(document, 'img', 'tasks-completion-mark'); mark.src = 'tasks-brand/mark.svg'; mark.alt = '';
    const sparkTwo = makeElement(document, 'span', 'tasks-completion-spark spark-two');
    const check = makeElement(document, 'span', 'tasks-completion-check'); check.append(renderIcon(Check, 14));
    markLane.append(sparkOne, mark, sparkTwo, check);

    const copy = makeElement(document, 'div', 'tasks-completion-copy');
    const title = makeElement(document, 'p', 'tasks-completion-title', 'Done!'); title.id = 'tasks-completion-title';
    const taskTitle = makeElement(document, 'p', 'tasks-completion-task-title', detail.title);
    const subtitle = makeElement(document, 'p', 'tasks-completion-subtitle', 'Every step is saved with this task.');
    copy.append(title, taskTitle, subtitle);

    const metrics = makeElement(document, 'div', 'tasks-completion-metrics');
    const captured = makeElement(document, 'div', 'tasks-completion-metric');
    captured.append(makeElement(document, 'span', 'tasks-completion-metric-label', 'Captured'), makeElement(document, 'strong', 'tasks-completion-metric-value', formatAge(detail.rawAgeMs)));
    const metricDivider = makeElement(document, 'span', 'tasks-completion-divider'); metricDivider.setAttribute('aria-hidden', 'true');
    const effort = makeElement(document, 'div', 'tasks-completion-metric');
    effort.append(makeElement(document, 'span', 'tasks-completion-metric-label', 'Logged effort'), makeElement(document, 'strong', 'tasks-completion-metric-value', formatEffort(detail.totalInvestedMs)));
    metrics.append(captured, metricDivider, effort);

    const timerNote = makeElement(document, 'p', 'tasks-completion-timer-note');
    const settledMs = before && before.running ? Math.max(0, detail.totalInvestedMs - before.totalInvestedMs) : 0;
    timerNote.hidden = !(before?.running);
    if (before?.running) {
      timerNote.dataset.settledEffort = formatEffort(settledMs);
      timerNote.textContent = settledMs > 0 ? `Focus timer stopped · ${formatEffort(settledMs)} added` : 'Focus timer stopped.';
    }

    const actions = makeElement(document, 'div', 'tasks-completion-actions');
    const undo = makeElement(document, 'button', 'tasks-completion-undo', 'Undo completion'); undo.type = 'button';
    const done = makeElement(document, 'button', 'tasks-completion-done', 'Done'); done.type = 'button';
    const actionError = makeElement(document, 'p', 'tasks-completion-error'); actionError.setAttribute('role', 'alert'); actionError.hidden = true;
    undo.addEventListener('click', () => {
      undo.disabled = true; done.disabled = true; actionError.hidden = true;
      void perform(detail.id, 'undo-completion', () => facade.restore(detail.id)).then(outcome => {
        if (isApplied(outcome)) {
          clearCompletionOverlay(); listView?.update(state);
          [...viewHost.querySelectorAll<HTMLElement>('[data-task-id]')].find(row => row.dataset.taskId === detail.id)?.querySelector<HTMLElement>('.tasks-row-title')?.focus();
        } else { undo.disabled = false; done.disabled = false; actionError.textContent = describeOutcome(outcome, 'The task was not restored.'); actionError.hidden = false; }
      });
    });
    done.addEventListener('click', () => clearCompletionOverlay());
    actions.append(undo, done);
    card.append(cardHeader, markLane, copy, metrics, timerNote, actions, actionError);
    overlay.append(card);
    completionOverlay = overlay;
    viewHost.append(overlay);
    announcer.textContent = 'Task completed';
    announcer.setAttribute('role', 'status');
    card.focus();
  }

  function disposeMountedView(): void {
    dragDisposer?.(); dragDisposer = null;
    completionOverlay?.remove(); completionOverlay = null;
    listView?.dispose(); listView = null;
    detailView?.dispose(); detailView = null;
    childScreen?.dispose(); childScreen = null;
  }

  function mountListScreen(): void {
    if (disposed) return;
    disposeMountedView(); currentScreen = 'list'; detailTaskID = null;
    const callbacks = {
      create: (title: string) => perform('@capture', 'capture', () => facade.create({ title })),
      complete: (taskID: string) => { void completeTask(taskID); },
      open: (taskID: string) => { void openDetail(taskID); },
      pin: (pinned: boolean) => { void perform('@preferences', 'pin', () => facade.updatePreferences({ pinned })); },
      settings: () => { void openSettings(); },
      planning: () => { void openPlanning(); },
      isPending,
      notify,
    };
    listView = mountTasksList(viewHost, facade, callbacks);
    updateCurrentView();
    observeDragRegion();
  }

  async function openDetail(taskID: string): Promise<void> {
    if (disposed || currentScreen === 'detail' && detailTaskID === taskID) return;
    if (detailView && !(await detailView.commitDraft())) return;
    disposeMountedView(); currentScreen = 'detail'; detailTaskID = taskID; lastTaskID = taskID;
    detailView = mountTaskDetail(viewHost, facade, taskID, {
      back: () => mountListScreen(),
      complete: id => { void completeTask(id); },
      perform,
      notify,
      globalTimer: currentGlobalTimer,
      isPending,
    });
    updateCurrentView(); observeDragRegion();
  }

  async function openSettings(): Promise<void> {
    if (disposed) return;
    if (detailView && !(await detailView.commitDraft())) return;
    disposeMountedView(); currentScreen = 'settings'; detailTaskID = null;
    const childOptions: TasksScreenOptions = { environment: options.window.environment, onClose: mountListScreen, notify };
    childScreen = mountTasksSettings(viewHost, facade, childOptions);
    observeDragRegion();
  }

  async function openPlanning(): Promise<void> {
    if (disposed) return;
    if (detailView && !(await detailView.commitDraft())) return;
    disposeMountedView(); currentScreen = 'planning'; detailTaskID = null;
    const childOptions: TasksScreenOptions = { environment: options.window.environment, onClose: mountListScreen, notify };
    childScreen = mountTasksPlanning(viewHost, facade, childOptions);
    observeDragRegion();
  }

  function showMainForNewTask(): void {
    if (currentScreen === 'list') { listView?.focusCapture(); return; }
    if (detailView) { void detailView.commitDraft().then(saved => { if (saved) { mountListScreen(); listView?.focusCapture(); } }); return; }
    mountListScreen(); listView?.focusCapture();
  }

  function toggleGlobalTimer(): void {
    if (state.kind !== 'ready') return;
    const current = currentGlobalTimer();
    const target = current?.taskID ?? (currentScreen === 'detail' ? detailTaskID : lastTaskID);
    const fallback = target ?? facade.queryTasks({ mode: 'active' }).tasks.find(task => task.status.kind === 'active')?.id ?? null;
    if (!fallback) { notify('Open an active task before starting a focus timer.'); return; }
    void perform(fallback, 'timer', () => facade.toggleTimer(fallback));
  }

  function scheduleClockStage(): void {
    if (disposed || !focused || !visible || state.kind !== 'ready' || clockStagePending) return;
    clockStagePending = true;
    void facade.runClockStage().catch(error => notify(error instanceof Error ? error.message : 'The local task clock could not run.', 'error'))
      .finally(() => { clockStagePending = false; });
  }

  function handleWindowEvent(event: { kind: 'focus'; focused: boolean } | { kind: 'command'; command: 'newTask' | 'settings' | 'toggleTimer' | 'togglePin' }): void {
    if (event.kind === 'focus') {
      const becameFocused = !focused && event.focused;
      focused = event.focused; updateMotionAttributes();
      if (!focused && detailView) void detailView.commitDraft();
      updateTimerDisplays();
      if (becameFocused) scheduleClockStage();
      return;
    }
    switch (event.command) {
      case 'newTask': showMainForNewTask(); break;
      case 'settings': void openSettings(); break;
      case 'toggleTimer': toggleGlobalTimer(); break;
      case 'togglePin': {
        if (state.kind !== 'ready') return;
        const next = !state.preferences.pinned;
        void perform('@preferences', 'pin', () => facade.updatePreferences({ pinned: next }));
        break;
      }
    }
  }

  function applyState(next: TasksState): void {
    if (disposed) return;
    state = next;
    root.setAttribute('aria-busy', String(next.kind === 'loading'));
    updateMotionAttributes();
    updateAppearance(next);
    if (next.kind === 'ready' && !fontApplied) {
      fontApplied = true;
      void applyNoteFont(document.documentElement, options.fontState, () => !disposed)
        .catch(() => notify('The Tasks font could not be applied.', 'error'));
    }
    if (next.kind === 'ready') {
      if (!previousClockReady) scheduleClockStage();
      previousClockReady = true;
    }
    if (currentScreen === 'list') listView?.update(next);
    if (currentScreen === 'detail') detailView?.update(next);
    if (next.kind === 'ready') {
      listView?.setPinState(next.preferences.pinned, pendingTaskActions.has('@preferences'));
      detailView?.setPinState(next.preferences.pinned, pendingTaskActions.has('@preferences'));
    }
    renderNotices(next);
    updateTimerDisplays();
  }

  retrySaveButton.addEventListener('click', () => {
    if (pendingTaskActions.has('@flush')) return;
    pendingTaskActions.set('@flush', 'flush'); retrySaveButton.disabled = true;
    void facade.flush().then(saved => {
      if (saved) recoveryActionStatus.textContent = 'Local changes were saved.';
      else recoveryActionStatus.textContent = 'The local save is still unavailable. Your preserved JSON remains below.';
    }).catch(error => {
      recoveryActionStatus.textContent = error instanceof Error ? error.message : 'The local save is still unavailable.';
    }).finally(() => {
      pendingTaskActions.delete('@flush'); applyState(facade.getState());
    });
  });
  copyJSONButton.addEventListener('click', () => { void copyPreservedJSON(); });
  previewDownloadButton.addEventListener('click', exportInPreview);

  // Direct listener is registered before controller initialization so a valid detail draft
  // queues its local update ahead of the controller's native flush request.
  const unsubscribeFlush = options.window.subscribe(event => {
    if (event.kind === 'flush' && detailView) void detailView.commitDraft();
  });
  const unsubscribeEvents = facade.subscribeEvents(event => handleWindowEvent(event.event));
  const unsubscribeState = facade.subscribe(applyState);
  const visibilityChange = (): void => {
    const wasVisible = visible;
    visible = document.visibilityState !== 'hidden';
    updateMotionAttributes();
    if (!visible && detailView) void detailView.commitDraft();
    updateTimerDisplays();
    if (!wasVisible && visible) scheduleClockStage();
  };
  document.addEventListener('visibilitychange', visibilityChange);
  const keydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    if (completionOverlay) { event.preventDefault(); clearCompletionOverlay(); return; }
    if (currentScreen === 'detail' && detailView) { event.preventDefault(); void detailView.commitDraft().then(saved => { if (saved) mountListScreen(); }); return; }
    if (currentScreen === 'list') return;
  };
  document.addEventListener('keydown', keydown);
  const preferenceMotionChange = (): void => { updateMotionAttributes(); };
  reducedMotionQuery?.addEventListener?.('change', preferenceMotionChange);
  const systemDarkChange = (): void => {
    if (state.kind === 'ready' && resolveThemeID(state.preferences.appearanceTheme) === 'system') updateAppearance(state);
  };
  systemDarkQuery?.addEventListener?.('change', systemDarkChange);

  retrySaveButton.hidden = true;
  persistenceNotice.hidden = true;
  integrationNotice.hidden = true;
  updateMotionAttributes();
  mountListScreen();
  const initialization = facade.initialize();
  void initialization.then(applyState).catch(error => notify(error instanceof Error ? error.message : 'Tasks could not be opened.', 'error'));

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeFlush(); unsubscribeEvents(); unsubscribeState();
      document.removeEventListener('visibilitychange', visibilityChange);
      document.removeEventListener('keydown', keydown);
      reducedMotionQuery?.removeEventListener?.('change', preferenceMotionChange);
      systemDarkQuery?.removeEventListener?.('change', systemDarkChange);
      if (timerInterval !== null && appWindow) appWindow.clearInterval(timerInterval);
      timerInterval = null;
      dragDisposer?.(); dragDisposer = null;
      for (const timer of downloadTimers) appWindow?.clearTimeout(timer);
      downloadTimers.clear();
      for (const url of downloadURLs) appWindow?.URL.revokeObjectURL(url);
      downloadURLs.clear();
      disposeMountedView();
      root.replaceChildren();
      root.setAttribute('aria-busy', 'false');
      delete document.documentElement.dataset.focused;
      delete document.documentElement.dataset.tasksVisible;
      delete document.documentElement.dataset.tasksMotion;
    },
  };
}
