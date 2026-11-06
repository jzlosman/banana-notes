import { ArrowLeft, Check, Pause, Pin, PinOff, Play, RotateCcw, Save, Trash2 } from 'lucide';
import type { CommandOutcome, TasksFacade, TasksState } from '../application/controller';
import type { TaskDetailReadModel } from '../domain/queries';
import type { TaskPriority } from '../domain/model';
import { describeOutcome, formatAge, formatEffort, formatElapsed, formatHistoryTime, isApplied, makeButton, makeElement } from './helpers';
import { renderIcon } from '../../ui/icon';

export interface GlobalTimerReadModel {
  taskID: string;
  title: string;
  elapsedMs: number;
}

export interface TaskDetailCallbacks {
  back(): void;
  complete(taskID: string): void;
  perform<T = undefined>(taskID: string, action: string, command: () => Promise<CommandOutcome<T>>): Promise<CommandOutcome<T>>;
  notify(message: string, kind?: 'status' | 'error'): void;
  globalTimer(): GlobalTimerReadModel | null;
  isPending(taskID: string, action: string): boolean;
}

export interface MountedTaskDetail {
  update(state: TasksState): void;
  tick(): void;
  commitDraft(): Promise<boolean>;
  focusTitle(): void;
  setPinState(pinned: boolean, saving?: boolean): void;
  dispose(): void;
}

const statusLabel = (detail: TaskDetailReadModel): string => {
  if (detail.status.kind === 'snoozed') return `Snoozed until ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(detail.status.until))}`;
  if (detail.status.kind === 'completed') return 'Completed';
  if (detail.status.kind === 'composted') return 'Composted';
  return detail.status.kind === 'waiting' ? 'Waiting' : 'Active';
};
const ripenessLabel: Record<TaskDetailReadModel['ripeness'], string> = { fresh: 'Fresh', ripe: 'Ripe', spotty: 'Spotty', veryRipe: 'Very ripe' };
const DAY = 24 * 60 * 60 * 1000;

function progressText(note: string): string {
  return note ? `Progress · ${note}` : 'Progress recorded';
}

function historyText(
  activity: TaskDetailReadModel['history'][number],
  workEntries: TaskDetailReadModel['workEntries'],
): string {
  switch (activity.kind) {
    case 'created': return 'Task captured';
    case 'edited': return 'Task details edited';
    case 'progress': return progressText(activity.note);
    case 'stateChanged':
      if (activity.to === 'completed') return 'Task completed';
      if (activity.to === 'composted') return 'Task composted';
      if (activity.to === 'snoozed') return 'Task snoozed';
      if (activity.to === 'waiting') return 'Moved to Waiting';
      return 'Task resumed';
    case 'worked': {
      const entry = workEntries.find(item => item.recordedAt === activity.at && item.durationMs === activity.durationMs);
      return `${entry?.source === 'manual' ? 'Manual effort' : 'Focus timer'} · ${formatEffort(activity.durationMs)}`;
    }
  }
}

export function mountTaskDetail(root: HTMLElement, facade: TasksFacade, taskID: string, callbacks: TaskDetailCallbacks): MountedTaskDetail {
  const document = root.ownerDocument;
  root.className = 'tasks-detail-screen';

  const toolbar = makeElement(document, 'header', 'tasks-toolbar');
  const logo = makeElement(document, 'img', 'tasks-brand-lockup');
  logo.src = 'tasks-brand/logo.svg'; logo.alt = 'Banana Tasks';
  logo.width = 120;
  const dragSpacer = makeElement(document, 'span', 'tasks-toolbar-drag'); dragSpacer.dataset.tasksDragRegion = 'true'; dragSpacer.setAttribute('aria-hidden', 'true');
  const pinButton = makeButton(document, 'Pin window', 'tasks-toolbar-button tasks-pin-button', () => undefined, Pin);
  const pinLabel = makeElement(document, 'span', 'tasks-toolbar-button-label', 'Pin'); pinButton.append(pinLabel);
  toolbar.append(logo, dragSpacer, pinButton);

  const backLane = makeElement(document, 'div', 'tasks-detail-back-lane');
  const backButton = makeButton(document, 'Back to tasks', 'tasks-back-button', () => undefined, ArrowLeft);
  const backLabel = makeElement(document, 'span', 'tasks-back-label', 'All tasks'); backButton.append(backLabel); backLane.append(backButton);

  const scroll = makeElement(document, 'main', 'tasks-detail-scroll quiet-scroll');
  scroll.setAttribute('aria-label', 'Task details');

  const summary = makeElement(document, 'section', 'tasks-detail-summary');
  const topLine = makeElement(document, 'div', 'tasks-detail-top-line');
  const stateBadge = makeElement(document, 'span', 'tasks-detail-state');
  const tagPreview = makeElement(document, 'div', 'tasks-detail-tag-preview');
  const titleInput = makeElement(document, 'input', 'tasks-detail-title');
  titleInput.type = 'text'; titleInput.maxLength = 240; titleInput.setAttribute('aria-label', 'Task title');
  titleInput.autocomplete = 'off';
  const notesInput = makeElement(document, 'textarea', 'tasks-detail-notes');
  notesInput.maxLength = 20_000; notesInput.rows = 2; notesInput.setAttribute('aria-label', 'Task notes');
  notesInput.placeholder = 'Add a note…';
  const draftStatus = makeElement(document, 'p', 'tasks-draft-status'); draftStatus.setAttribute('aria-live', 'polite'); draftStatus.setAttribute('role', 'status');
  const saveButton = makeButton(document, 'Save task details', 'tasks-save-button', () => undefined, Save);
  saveButton.append(makeElement(document, 'span', 'tasks-save-label', 'Save changes'));
  topLine.append(stateBadge, tagPreview);
  summary.append(topLine, titleInput, notesInput, draftStatus, saveButton);

  const properties = makeElement(document, 'section', 'tasks-detail-properties');
  const propertiesHeading = makeElement(document, 'h2', 'tasks-section-title', 'Attention pace');
  const propertiesHint = makeElement(document, 'p', 'tasks-section-hint', 'Choose what feels right');
  const paceLine = makeElement(document, 'div', 'tasks-pace-line');
  const paceBadge = makeElement(document, 'span', 'tasks-ripeness');
  const priorityLabel = makeElement(document, 'label', 'tasks-priority-label', 'Task priority');
  const prioritySelect = makeElement(document, 'select', 'tasks-priority-select');
  prioritySelect.setAttribute('aria-label', 'Task priority');
  for (const [value, label] of [['low', 'Low'], ['normal', 'Normal'], ['high', 'High']] as const) {
    const option = makeElement(document, 'option', '', label); option.value = value; prioritySelect.append(option);
  }
  priorityLabel.append(prioritySelect); paceLine.append(paceBadge, propertiesHint, makeElement(document, 'span', 'tasks-section-spacer'), priorityLabel);
  properties.append(propertiesHeading, paceLine);

  const timerSection = makeElement(document, 'section', 'tasks-focus-section');
  const timerCopy = makeElement(document, 'div', 'tasks-focus-copy');
  const timerLabel = makeElement(document, 'p', 'tasks-focus-label');
  const timerValue = makeElement(document, 'p', 'tasks-focus-time', '00:00');
  timerValue.setAttribute('aria-label', 'Focus timer elapsed');
  timerCopy.append(timerLabel, timerValue);
  const timerActions = makeElement(document, 'div', 'tasks-focus-actions');
  const timerButton = makeButton(document, 'Start focus timer', 'tasks-focus-toggle', () => undefined, Play);
  const timerButtonLabel = makeElement(document, 'span', 'tasks-focus-toggle-label', 'Start timer'); timerButton.append(timerButtonLabel);
  const globalTimerHint = makeElement(document, 'p', 'tasks-global-timer-hint'); globalTimerHint.hidden = true;
  const effortForm = makeElement(document, 'form', 'tasks-manual-effort-form');
  const effortInput = makeElement(document, 'input', 'tasks-manual-effort-input');
  effortInput.type = 'number'; effortInput.min = '1'; effortInput.max = '720'; effortInput.step = '1'; effortInput.placeholder = 'Minutes';
  effortInput.setAttribute('aria-label', 'Minutes of manual effort');
  const effortButton = makeElement(document, 'button', 'tasks-manual-effort-submit', 'Log time'); effortButton.type = 'submit';
  effortForm.append(effortInput, effortButton);
  timerActions.append(timerButton, effortForm);
  timerSection.append(timerCopy, timerActions, globalTimerHint);

  const ageEffort = makeElement(document, 'section', 'tasks-age-effort');
  const capturedBlock = makeElement(document, 'div', 'tasks-measure');
  const capturedLabel = makeElement(document, 'span', 'tasks-measure-label', 'Captured');
  const capturedValue = makeElement(document, 'strong', 'tasks-measure-value');
  capturedBlock.append(capturedLabel, capturedValue);
  const separator = makeElement(document, 'span', 'tasks-measure-divider'); separator.setAttribute('aria-hidden', 'true');
  const effortBlock = makeElement(document, 'div', 'tasks-measure');
  const effortLabel = makeElement(document, 'span', 'tasks-measure-label', 'Logged effort');
  const effortValue = makeElement(document, 'strong', 'tasks-measure-value');
  effortBlock.append(effortLabel, effortValue);
  ageEffort.append(capturedBlock, separator, effortBlock);
  const separationNote = makeElement(document, 'p', 'tasks-section-footnote', 'Progress can change the pace. It never changes when this task was captured.');

  const progressSection = makeElement(document, 'section', 'tasks-progress-section');
  const progressTitle = makeElement(document, 'h2', 'tasks-section-title', 'Progress');
  const progressForm = makeElement(document, 'form', 'tasks-progress-form');
  const progressInput = makeElement(document, 'input', 'tasks-progress-input');
  progressInput.type = 'text'; progressInput.maxLength = 1000; progressInput.placeholder = 'Record a progress note…';
  progressInput.setAttribute('aria-label', 'Progress note'); progressInput.autocomplete = 'off';
  const progressButton = makeElement(document, 'button', 'tasks-progress-submit', 'Add progress'); progressButton.type = 'submit';
  progressForm.append(progressInput, progressButton); progressSection.append(progressTitle, progressForm);

  const actionSection = makeElement(document, 'section', 'tasks-status-actions');
  const waitingButton = makeButton(document, 'Move to Waiting', 'tasks-secondary-action', () => undefined);
  const snoozeButton = makeButton(document, 'Snooze until tomorrow', 'tasks-secondary-action', () => undefined);
  const restoreButton = makeButton(document, 'Resume task', 'tasks-secondary-action', () => undefined, RotateCcw);
  const compostButton = makeButton(document, 'Compost task', 'tasks-destructive-action', () => undefined, Trash2);
  actionSection.append(waitingButton, snoozeButton, restoreButton, compostButton);

  const activitySection = makeElement(document, 'section', 'tasks-activity-section');
  const activityHeading = makeElement(document, 'div', 'tasks-activity-heading');
  const activityTitle = makeElement(document, 'h2', 'tasks-section-title', 'Activity');
  const activityHint = makeElement(document, 'span', 'tasks-section-hint', 'History stays with the task');
  activityHeading.append(activityTitle, activityHint);
  const historyList = makeElement(document, 'ol', 'tasks-activity-list');
  activitySection.append(activityHeading, historyList);
  scroll.append(summary, properties, timerSection, ageEffort, separationNote, progressSection, actionSection, activitySection);

  const footer = makeElement(document, 'footer', 'tasks-detail-footer');
  const footerDot = makeElement(document, 'span', 'tasks-footer-dot'); footerDot.setAttribute('aria-hidden', 'true');
  const footerStatus = makeElement(document, 'span', 'tasks-detail-footer-status');
  const footerSpacer = makeElement(document, 'span', 'tasks-footer-spacer');
  const completeButton = makeButton(document, 'Mark complete', 'tasks-complete-button', () => callbacks.complete(taskID), Check);
  const completeLabel = makeElement(document, 'span', 'tasks-complete-label', 'Mark complete'); completeButton.append(completeLabel);
  footer.append(footerDot, footerStatus, footerSpacer, completeButton);
  root.append(toolbar, backLane, scroll, footer);

  let state: TasksState = facade.getState();
  let current: TaskDetailReadModel | null = null;
  let baseline = { title: '', notes: '', tags: '' };
  let draftDirty = false;
  let savingDraft: Promise<boolean> | null = null;
  let disposed = false;
  let timerIconRunning = false;

  const draftValue = () => ({ title: titleInput.value, notes: notesInput.value, tags: tagInput.value });
  const tagInput = makeElement(document, 'input', 'tasks-detail-tags');
  tagInput.type = 'text'; tagInput.maxLength = 32 * 48; tagInput.setAttribute('aria-label', 'Task tags');
  tagInput.placeholder = 'Add tags, separated by commas'; tagInput.autocomplete = 'off';
  const tagsLabel = makeElement(document, 'label', 'tasks-detail-tags-label', 'Tags'); tagsLabel.append(tagInput);
  summary.insertBefore(tagsLabel, draftStatus);

  function setDraftFromModel(detail: TaskDetailReadModel): void {
    baseline = { title: detail.title, notes: detail.notes, tags: detail.tags.join(', ') };
    titleInput.value = baseline.title; notesInput.value = baseline.notes; tagInput.value = baseline.tags;
    draftDirty = false; draftStatus.textContent = ''; saveButton.disabled = true;
  }

  function updateDraftState(): void {
    const value = draftValue();
    draftDirty = value.title !== baseline.title || value.notes !== baseline.notes || value.tags !== baseline.tags;
    saveButton.disabled = !draftDirty || !!savingDraft;
    if (draftDirty) draftStatus.textContent = 'Unsaved changes';
    if (state.kind === 'ready' && !state.persistenceError) footerStatus.textContent = draftDirty ? 'Unsaved task edits'
      : root.ownerDocument.documentElement.dataset.native === 'true' ? 'Saved on this Mac' : 'Saved in this browser';
    draftStatus.setAttribute('role', 'status');
  }
  titleInput.addEventListener('input', updateDraftState);
  notesInput.addEventListener('input', updateDraftState);
  tagInput.addEventListener('input', updateDraftState);

  async function commitDraft(): Promise<boolean> {
    if (savingDraft) return savingDraft;
    if (!draftDirty || !current) return true;
    const snapshot = draftValue();
    const titleValue = snapshot.title.trim();
    const tags = snapshot.tags.split(',').map(tag => tag.trim()).filter(Boolean);
    if (!titleValue) {
      draftStatus.textContent = 'A task title is required.'; draftStatus.setAttribute('role', 'alert'); titleInput.focus();
      return false;
    }
    draftStatus.setAttribute('role', 'status'); draftStatus.textContent = 'Saving…'; saveButton.disabled = true;
    const patch = { title: titleValue, notes: snapshot.notes, tags };
    const operation = callbacks.perform(taskID, 'save-details', () => facade.update(taskID, patch));
    savingDraft = operation.then(outcome => {
      if (disposed) return false;
      if (!isApplied(outcome)) {
        draftStatus.textContent = describeOutcome(outcome, 'Task details were not saved.');
        draftStatus.setAttribute('role', 'alert');
        saveButton.disabled = false;
        return false;
      }
      baseline = { title: titleValue, notes: snapshot.notes, tags: tags.join(', ') };
      const currentValue = draftValue();
      draftDirty = currentValue.title !== snapshot.title || currentValue.notes !== snapshot.notes || currentValue.tags !== snapshot.tags;
      draftStatus.textContent = draftDirty ? 'New edits are still unsaved.' : 'Saved on this device.';
      draftStatus.setAttribute('role', 'status');
      saveButton.disabled = !draftDirty;
      render();
      callbacks.notify('Task details saved.');
      return !draftDirty;
    }).catch(error => {
      draftStatus.textContent = error instanceof Error ? error.message : 'Task details were not saved.';
      draftStatus.setAttribute('role', 'alert'); saveButton.disabled = false; return false;
    }).finally(() => { savingDraft = null; if (draftDirty) saveButton.disabled = false; });
    return savingDraft;
  }

  for (const field of [titleInput, notesInput, tagInput]) field.addEventListener('blur', () => { if (draftDirty) void commitDraft(); });

  backButton.onclick = () => { void commitDraft().then(saved => { if (saved) callbacks.back(); }); };
  saveButton.onclick = () => { void commitDraft(); };
  prioritySelect.addEventListener('change', () => {
    const priority = prioritySelect.value as TaskPriority;
    void commitDraft().then(saved => {
      if (!saved || !current) { prioritySelect.value = current?.priority ?? 'normal'; return; }
      void callbacks.perform(taskID, 'priority', () => facade.update(taskID, { priority })).then(outcome => {
        if (!isApplied(outcome)) callbacks.notify(describeOutcome(outcome, 'Priority was not saved.'), 'error');
        else callbacks.notify('Task priority saved.');
      });
    });
  });
  timerButton.addEventListener('click', () => {
    if (!current) return;
    const wasRunning = current.running !== null;
    void callbacks.perform(taskID, 'timer', () => facade.toggleTimer(taskID)).then(outcome => {
      if (isApplied(outcome)) callbacks.notify(wasRunning ? 'Focus timer stopped.' : 'Focus timer started.');
    });
  });
  effortForm.addEventListener('submit', event => {
    event.preventDefault();
    const minutes = Number(effortInput.value);
    if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 720) {
      effortInput.setCustomValidity('Enter a whole number from 1 to 720 minutes.'); effortInput.reportValidity(); return;
    }
    effortInput.setCustomValidity('');
    void callbacks.perform(taskID, 'manual-effort', () => facade.logEffort(taskID, minutes * 60_000)).then(outcome => {
      if (isApplied(outcome)) { effortInput.value = ''; callbacks.notify('Effort recorded.'); }
    });
  });
  progressForm.addEventListener('submit', event => {
    event.preventDefault();
    const note = progressInput.value.trim();
    if (!note) { progressInput.focus(); return; }
    void callbacks.perform(taskID, 'progress', () => facade.progress(taskID, note)).then(outcome => {
      if (isApplied(outcome)) { progressInput.value = ''; callbacks.notify('Progress saved.'); }
    });
  });
  waitingButton.addEventListener('click', () => {
    void callbacks.perform(taskID, 'waiting', () => facade.changeStatus(taskID, 'waiting')).then(outcome => { if (isApplied(outcome)) callbacks.notify('Task moved to Waiting.'); });
  });
  snoozeButton.addEventListener('click', () => {
    void callbacks.perform(taskID, 'snooze', () => facade.snooze(taskID, Date.now() + DAY)).then(outcome => { if (isApplied(outcome)) callbacks.notify('Task snoozed until tomorrow.'); });
  });
  restoreButton.addEventListener('click', () => {
    void callbacks.perform(taskID, 'restore', () => facade.restore(taskID)).then(outcome => { if (isApplied(outcome)) callbacks.notify('Task resumed.'); });
  });
  compostButton.addEventListener('click', () => {
    void callbacks.perform(taskID, 'compost', () => facade.changeStatus(taskID, 'composted')).then(outcome => { if (isApplied(outcome)) callbacks.notify('Task moved to compost.'); });
  });

  function renderHistory(detail: TaskDetailReadModel): void {
    const now = Date.now();
    const entries = detail.history.slice(0, 12);
    const nodes = entries.map(activity => {
      const item = makeElement(document, 'li', 'tasks-activity-item');
      const dot = makeElement(document, 'span', `tasks-activity-dot tasks-activity-${activity.kind}`); dot.setAttribute('aria-hidden', 'true');
      const when = makeElement(document, 'time', 'tasks-activity-time', formatHistoryTime(activity.at, now));
      when.dateTime = new Date(activity.at).toISOString();
      const text = makeElement(document, 'span', 'tasks-activity-copy', historyText(activity, detail.workEntries));
      item.append(dot, when, text); return item;
    });
    historyList.replaceChildren(...nodes);
    historyList.hidden = entries.length === 0;
  }

  function render(): void {
    if (disposed) return;
    if (state.kind !== 'ready') {
      current = null; titleInput.disabled = true; notesInput.disabled = true; tagInput.disabled = true; saveButton.disabled = true;
      footerStatus.textContent = state.kind === 'recovery' ? 'Recovery required' : 'Loading local tasks…';
      return;
    }
    current = facade.queryTaskDetail(taskID);
    if (!current) { callbacks.back(); return; }
    titleInput.disabled = !!state.persistenceError; notesInput.disabled = !!state.persistenceError; tagInput.disabled = !!state.persistenceError;
    if (!draftDirty && !savingDraft) setDraftFromModel(current);
    stateBadge.textContent = statusLabel(current);
    stateBadge.className = `tasks-detail-state state-${current.status.kind}`;
    tagPreview.replaceChildren(...current.tags.map(tag => makeElement(document, 'span', 'tasks-tag', tag)));
    if (!current.tags.length) tagPreview.append(makeElement(document, 'span', 'tasks-row-no-tags', 'No tags'));
    paceBadge.textContent = ripenessLabel[current.ripeness];
    paceBadge.className = `tasks-ripeness ${current.ripeness === 'veryRipe' ? 'very-ripe' : current.ripeness}`;
    prioritySelect.value = current.priority;
    capturedValue.textContent = formatAge(current.rawAgeMs);
    capturedValue.title = `Captured ${new Date(current.createdAt).toLocaleString()}`;
    effortValue.textContent = formatEffort(current.totalInvestedMs);

    const global = callbacks.globalTimer();
    const isRunning = current.running !== null;
    timerLabel.textContent = isRunning ? 'Focus timer · running' : 'Focus timer';
    timerValue.textContent = formatElapsed(current.running?.elapsedMs ?? 0);
    timerValue.hidden = !isRunning;
    timerButton.setAttribute('aria-label', isRunning ? 'Stop focus timer' : 'Start focus timer');
    timerButton.title = isRunning ? 'Stop focus timer' : 'Start focus timer';
    timerButton.classList.toggle('is-running', isRunning);
    timerButton.querySelector('.tasks-focus-toggle-label')!.textContent = isRunning ? 'Stop timer' : 'Start timer';
    if (timerIconRunning !== isRunning) {
      timerButton.querySelector('svg')?.replaceWith(renderIcon(isRunning ? Pause : Play, 15));
      timerIconRunning = isRunning;
    }
    timerButton.disabled = !!state.persistenceError || callbacks.isPending(taskID, 'timer');
    prioritySelect.disabled = !!state.persistenceError || callbacks.isPending(taskID, 'priority');
    effortButton.disabled = !!state.persistenceError || callbacks.isPending(taskID, 'manual-effort');
    progressButton.disabled = !!state.persistenceError || callbacks.isPending(taskID, 'progress');
    globalTimerHint.hidden = !global || global.taskID === taskID;
    if (global && global.taskID !== taskID) globalTimerHint.textContent = `Focus running on “${global.title}” · ${formatElapsed(global.elapsedMs)}`;

    const isActive = current.status.kind === 'active';
    waitingButton.hidden = !isActive;
    snoozeButton.hidden = !isActive && current.status.kind !== 'waiting';
    restoreButton.hidden = isActive || current.status.kind === 'completed';
    compostButton.hidden = current.status.kind === 'completed' || current.status.kind === 'composted';
    restoreButton.textContent = current.status.kind === 'composted' ? 'Recover task' : 'Resume task';
    restoreButton.setAttribute('aria-label', current.status.kind === 'composted' ? 'Recover task' : 'Resume task');
    waitingButton.disabled = !!state.persistenceError || callbacks.isPending(taskID, 'waiting');
    snoozeButton.disabled = !!state.persistenceError || callbacks.isPending(taskID, 'snooze');
    restoreButton.disabled = !!state.persistenceError || callbacks.isPending(taskID, 'restore');
    compostButton.disabled = !!state.persistenceError || callbacks.isPending(taskID, 'compost');
    completeButton.hidden = current.status.kind === 'completed' || current.status.kind === 'composted';
    completeButton.disabled = !!state.persistenceError || callbacks.isPending(taskID, 'complete');
    footerStatus.textContent = state.persistenceError
      ? state.persistenceError.kind === 'conflict' ? 'Local changes preserved for export' : 'Local save failed'
      : savingDraft ? 'Saving task edits…' : draftDirty ? 'Unsaved task edits'
      : root.ownerDocument.documentElement.dataset.native === 'true' ? 'Saved on this Mac' : 'Saved in this browser';
    renderHistory(current);
  }

  const refreshTimer = (): void => {
    if (!current) return;
    const latest = facade.queryTaskDetail(taskID);
    if (latest) {
      current = latest;
      timerValue.textContent = formatElapsed(latest.running?.elapsedMs ?? 0);
      const global = callbacks.globalTimer();
      globalTimerHint.hidden = !global || global.taskID === taskID;
      if (global && global.taskID !== taskID) globalTimerHint.textContent = `Focus running on “${global.title}” · ${formatElapsed(global.elapsedMs)}`;
      effortValue.textContent = formatEffort(latest.totalInvestedMs);
    }
  };

  function setPinState(pinned: boolean, saving = false): void {
    pinButton.setAttribute('aria-label', pinned ? 'Unpin window' : 'Pin window');
    pinButton.title = pinned ? 'Unpin window' : 'Pin window';
    pinButton.setAttribute('aria-pressed', String(pinned));
    pinButton.classList.toggle('selected', pinned);
    pinButton.querySelector('svg')?.replaceWith(renderIcon(pinned ? PinOff : Pin, 15));
    pinLabel.textContent = pinned ? 'Pinned' : 'Pin';
    pinButton.disabled = saving || callbacks.isPending(taskID, 'pin');
  }
  pinButton.onclick = () => {
    const pinned = pinButton.getAttribute('aria-pressed') === 'true';
    callbacks.notify('Updating window pin…');
    void callbacks.perform(taskID, 'pin', () => facade.updatePreferences({ pinned: !pinned })).then(outcome => {
      if (!isApplied(outcome)) callbacks.notify(describeOutcome(outcome, 'Pin preference was not saved.'), 'error');
    });
  };

  return {
    update(next) { state = next; render(); refreshTimer(); },
    tick: refreshTimer,
    commitDraft,
    focusTitle() { titleInput.focus(); },
    setPinState,
    dispose() { disposed = true; root.replaceChildren(); },
  };
}
