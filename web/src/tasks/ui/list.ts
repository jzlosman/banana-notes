import { CalendarDays, Check, ListFilter, Pin, PinOff, Plus, Settings } from 'lucide';
import { renderIcon } from '../../ui/icon';
import type { CommandOutcome, TasksFacade, TasksState } from '../application/controller';
import type { TaskListMode, TaskReadModel, Ripeness } from '../domain/queries';
import { describeOutcome, formatAge, formatEffort, formatElapsed, isApplied, makeButton, makeElement } from './helpers';

export type TasksListMode = 'active' | 'waiting' | 'snoozed' | 'archive';
export type ArchiveMode = 'completed' | 'composted';

export interface TaskListCallbacks {
  create(title: string): Promise<CommandOutcome<{ taskID: string }>>;
  complete(taskID: string): void;
  open(taskID: string): void;
  pin(pinned: boolean): void;
  settings(): void;
  planning(): void;
  isPending(taskID: string, action: string): boolean;
  notify(message: string, kind?: 'status' | 'error'): void;
}

export interface MountedTaskList {
  update(state: TasksState): void;
  focusCapture(): void;
  setPinState(pinned: boolean, saving?: boolean): void;
  setAppearance(dark: boolean): void;
  setGlobalTimer(timer: { title: string; elapsedMs: number } | null): void;
  dispose(): void;
}

const severity: Record<Ripeness, number> = { veryRipe: 0, spotty: 1, ripe: 2, fresh: 3 };
const ripenessLabel: Record<Ripeness, string> = { fresh: 'Fresh', ripe: 'Ripe', spotty: 'Spotty', veryRipe: 'Very ripe' };
const ripenessClass: Record<Ripeness, string> = { fresh: 'fresh', ripe: 'ripe', spotty: 'spotty', veryRipe: 'very-ripe' };

function sortByAttention(tasks: TaskReadModel[]): TaskReadModel[] {
  return [...tasks].sort((left, right) => severity[left.ripeness] - severity[right.ripeness] ||
    right.inactivityMs - left.inactivityMs || left.createdAt - right.createdAt || left.id.localeCompare(right.id, 'en'));
}

function taskStatusLabel(task: TaskReadModel): string {
  if (task.status.kind === 'snoozed') return `Snoozed until ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(task.status.until))}`;
  if (task.status.kind === 'completed') return 'Completed';
  if (task.status.kind === 'composted') return 'Composted';
  return task.status.kind === 'waiting' ? 'Waiting' : ripenessLabel[task.ripeness];
}

export function mountTasksList(root: HTMLElement, facade: TasksFacade, callbacks: TaskListCallbacks): MountedTaskList {
  const document = root.ownerDocument;
  root.className = 'tasks-list-screen';

  const toolbar = makeElement(document, 'header', 'tasks-toolbar');
  const logo = makeElement(document, 'img', 'tasks-brand-lockup');
  logo.src = 'tasks-brand/logo.svg'; logo.alt = 'Banana Tasks'; logo.width = 120;
  const dragSpacer = makeElement(document, 'span', 'tasks-toolbar-drag'); dragSpacer.dataset.tasksDragRegion = 'true'; dragSpacer.setAttribute('aria-hidden', 'true');
  const planButton = makeButton(document, 'Plan tasks', 'tasks-toolbar-button tasks-plan-button', () => callbacks.planning(), CalendarDays);
  planButton.append(makeElement(document, 'span', 'tasks-toolbar-button-label', 'Plan'));
  const pinButton = makeButton(document, 'Pin window', 'tasks-toolbar-button tasks-pin-button', () => callbacks.pin(!pinButton.classList.contains('selected')), Pin);
  pinButton.append(makeElement(document, 'span', 'tasks-toolbar-button-label', 'Pin'));
  toolbar.append(logo, dragSpacer, planButton, pinButton);

  const heading = makeElement(document, 'section', 'tasks-list-heading');
  const titleGroup = makeElement(document, 'div', 'tasks-list-heading-copy');
  const title = makeElement(document, 'h1', 'tasks-list-title', 'Your tasks');
  const subtitle = makeElement(document, 'p', 'tasks-list-subtitle', 'A little room for what’s next.');
  titleGroup.append(title, subtitle);
  const count = makeElement(document, 'p', 'tasks-list-count');
  heading.append(titleGroup, count);

  const form = makeElement(document, 'form', 'tasks-capture-form');
  form.setAttribute('aria-label', 'Add task');
  const plus = makeElement(document, 'span', 'tasks-capture-icon'); plus.setAttribute('aria-hidden', 'true'); plus.append(renderIcon(Plus, 15));
  const captureInput = makeElement(document, 'input', 'tasks-capture-input');
  captureInput.name = 'title'; captureInput.type = 'text'; captureInput.maxLength = 240;
  captureInput.placeholder = 'Add a task to keep close…'; captureInput.setAttribute('aria-label', 'Task title');
  captureInput.autocomplete = 'off';
  const captureStatus = makeElement(document, 'span', 'tasks-capture-status');
  captureStatus.setAttribute('role', 'status'); captureStatus.setAttribute('aria-live', 'polite');
  const captureButton = makeElement(document, 'button', 'tasks-capture-submit', 'Add');
  captureButton.type = 'submit';
  form.append(plus, captureInput, captureStatus, captureButton);

  const tabs = makeElement(document, 'nav', 'tasks-state-tabs');
  tabs.setAttribute('aria-label', 'Task states');
  const modeButtons = new Map<TasksListMode, HTMLButtonElement>();
  for (const [mode, label] of [
    ['active', 'Active'], ['waiting', 'Waiting'], ['snoozed', 'Snoozed'], ['archive', 'Archive'],
  ] as const) {
    const button = makeElement(document, 'button', 'tasks-state-tab');
    button.type = 'button'; button.dataset.mode = mode; button.textContent = label;
    button.addEventListener('click', () => { currentMode = mode; showAllActive = false; render(); });
    modeButtons.set(mode, button); tabs.append(button);
  }
  const tabSpacer = makeElement(document, 'span', 'tasks-tabs-spacer');
  const groupButton = makeElement(document, 'button', 'tasks-group-toggle', 'Group by tag');
  groupButton.type = 'button'; groupButton.setAttribute('aria-pressed', 'false');
  groupButton.addEventListener('click', () => { grouped = !grouped; groupButton.setAttribute('aria-pressed', String(grouped)); render(); });
  groupButton.prepend(renderIcon(ListFilter, 14));
  tabs.append(tabSpacer, groupButton);

  const archiveTabs = makeElement(document, 'div', 'tasks-archive-tabs');
  archiveTabs.setAttribute('aria-label', 'Archive status');
  const archiveButtons = new Map<ArchiveMode, HTMLButtonElement>();
  for (const [mode, label] of [['completed', 'Completed'], ['composted', 'Composted']] as const) {
    const button = makeElement(document, 'button', 'tasks-archive-tab', label);
    button.type = 'button'; button.dataset.archive = mode;
    button.addEventListener('click', () => { archiveMode = mode; render(); });
    archiveButtons.set(mode, button); archiveTabs.append(button);
  }
  const tagFilter = makeElement(document, 'div', 'tasks-tag-filter');
  const tagFilterLabel = makeElement(document, 'span', 'tasks-tag-filter-label');
  const clearTag = makeElement(document, 'button', 'tasks-tag-filter-clear', 'Clear');
  clearTag.type = 'button'; clearTag.addEventListener('click', () => { selectedTag = null; render(); });
  tagFilter.append(tagFilterLabel, clearTag);

  const attentionHeading = makeElement(document, 'section', 'tasks-attention-heading');
  const attentionDot = makeElement(document, 'span', 'tasks-attention-dot'); attentionDot.setAttribute('aria-hidden', 'true');
  const attentionTitle = makeElement(document, 'h2', 'tasks-section-title', 'A little attention');
  const attentionSpacer = makeElement(document, 'span', 'tasks-section-spacer');
  const attentionHint = makeElement(document, 'span', 'tasks-attention-hint', 'sorted by pace');
  attentionHeading.append(attentionDot, attentionTitle, attentionSpacer, attentionHint);

  const scroll = makeElement(document, 'div', 'tasks-list-scroll quiet-scroll');
  scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', 'Tasks');
  const emptyState = makeElement(document, 'section', 'tasks-empty-state');
  const emptyTitle = makeElement(document, 'h2', 'tasks-empty-title');
  const emptyMessage = makeElement(document, 'p', 'tasks-empty-message');
  const emptyAction = makeElement(document, 'button', 'tasks-empty-action', 'Add a task');
  emptyAction.type = 'button'; emptyAction.addEventListener('click', () => captureInput.focus());
  emptyState.append(emptyTitle, emptyMessage, emptyAction);

  const resting = makeElement(document, 'section', 'tasks-resting-summary');
  const restingTitle = makeElement(document, 'h2', 'tasks-section-title', 'Resting');
  const restingSpacer = makeElement(document, 'span', 'tasks-section-spacer');
  const waitingLink = makeElement(document, 'button', 'tasks-resting-chip'); waitingLink.type = 'button';
  waitingLink.addEventListener('click', () => { currentMode = 'waiting'; render(); });
  const snoozedLink = makeElement(document, 'button', 'tasks-resting-chip'); snoozedLink.type = 'button';
  snoozedLink.addEventListener('click', () => { currentMode = 'snoozed'; render(); });
  resting.append(restingTitle, restingSpacer, waitingLink, snoozedLink);

  const footer = makeElement(document, 'footer', 'tasks-list-footer');
  const savedDot = makeElement(document, 'span', 'tasks-footer-dot'); savedDot.setAttribute('aria-hidden', 'true');
  const localStatus = makeElement(document, 'span', 'tasks-local-status');
  const globalTimer = makeElement(document, 'span', 'tasks-global-timer'); globalTimer.hidden = true;
  const footerSpacer = makeElement(document, 'span', 'tasks-footer-spacer');
  const settingsButton = makeButton(document, 'Settings', 'tasks-footer-icon', () => callbacks.settings(), Settings);
  footer.append(savedDot, localStatus, globalTimer, footerSpacer, settingsButton);

  root.append(toolbar, heading, form, tabs, archiveTabs, tagFilter, attentionHeading, scroll, resting, footer);

  let state: TasksState = facade.getState();
  let currentMode: TasksListMode = 'active';
  let archiveMode: ArchiveMode = 'completed';
  let selectedTag: string | null = null;
  let grouped = false;
  let showAllActive = false;
  let adding = false;
  let disposed = false;

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (adding || state.kind !== 'ready' || state.persistenceError) return;
    const submittedTitle = captureInput.value;
    if (!submittedTitle.trim()) { captureStatus.textContent = 'Enter a task title.'; captureInput.focus(); return; }
    adding = true; captureButton.disabled = true; captureButton.textContent = 'Adding…'; captureStatus.textContent = '';
    void callbacks.create(submittedTitle).then(outcome => {
      if (disposed) return;
      adding = false;
      captureButton.disabled = false; captureButton.textContent = 'Add';
      if (isApplied(outcome)) {
        if (captureInput.value === submittedTitle) captureInput.value = '';
        captureStatus.textContent = 'Task saved.';
        callbacks.notify('Task added.');
      } else captureStatus.textContent = describeOutcome(outcome, 'The task was not saved.');
      render();
    }).catch(error => {
      if (disposed) return;
      adding = false; captureButton.disabled = false; captureButton.textContent = 'Add';
      captureStatus.textContent = error instanceof Error ? error.message : 'The task was not saved.';
    });
  });

  function makeTagButton(tag: string): HTMLButtonElement {
    const button = makeElement(document, 'button', 'tasks-tag', tag);
    button.type = 'button'; button.setAttribute('aria-label', `Filter by tag ${tag}`);
    button.addEventListener('click', event => { event.stopPropagation(); selectedTag = tag; render(); });
    return button;
  }

  function renderRow(task: TaskReadModel, active: boolean): HTMLElement {
    const row = makeElement(document, 'article', 'tasks-row'); row.dataset.taskId = task.id;
    const action = makeElement(document, 'button', 'tasks-row-complete');
    action.type = 'button'; action.setAttribute('aria-label', `Complete task: ${task.title}`);
    action.title = active ? 'Complete task' : taskStatusLabel(task);
    action.disabled = !active || callbacks.isPending(task.id, 'complete');
    if (action.disabled && active) action.setAttribute('aria-busy', 'true');
    const check = makeElement(document, 'span', 'tasks-row-check'); check.setAttribute('aria-hidden', 'true');
    if (action.disabled && active) check.textContent = '…'; else check.append(renderIcon(Check, 13));
    action.append(check);
    if (active) action.addEventListener('click', event => { event.stopPropagation(); callbacks.complete(task.id); });

    const content = makeElement(document, 'div', 'tasks-row-content');
    const titleButton = makeElement(document, 'button', 'tasks-row-title', task.title);
    titleButton.type = 'button'; titleButton.addEventListener('click', () => callbacks.open(task.id));
    const stateBadge = makeElement(document, 'span', `tasks-ripeness ${ripenessClass[task.ripeness]}`, taskStatusLabel(task));
    const top = makeElement(document, 'div', 'tasks-row-top');
    top.append(titleButton, stateBadge);

    const meta = makeElement(document, 'div', 'tasks-row-meta');
    for (const tag of task.tags) meta.append(makeTagButton(tag));
    if (task.tags.length === 0) {
      const noTags = makeElement(document, 'span', 'tasks-row-no-tags', 'No tags');
      meta.append(noTags);
    }
    const age = makeElement(document, 'span', 'tasks-row-age', `Captured ${formatAge(task.rawAgeMs)}`);
    age.title = `Captured ${new Date(task.createdAt).toLocaleString()}`;
    const effort = makeElement(document, 'span', 'tasks-row-effort', formatEffort(task.totalInvestedMs));
    meta.append(age, effort);
    content.append(top, meta);
    row.append(action, content);
    row.addEventListener('dblclick', () => callbacks.open(task.id));
    return row;
  }

  function renderEmpty(titleText: string, body: string, allowCapture: boolean): void {
    emptyTitle.textContent = titleText; emptyMessage.textContent = body; emptyAction.hidden = !allowCapture;
    scroll.replaceChildren(emptyState);
  }

  function renderTasks(tasks: TaskReadModel[], options: { active: boolean; showHeading?: boolean; emptyTitle: string; emptyBody: string }): void {
    const nodes: HTMLElement[] = [];
    if (options.showHeading) nodes.push(attentionHeading);
    if (grouped && !selectedTag) {
      const byTag = new Map<string, TaskReadModel[]>();
      for (const task of tasks) {
        const labels = task.tags.length ? task.tags : ['Untagged'];
        for (const label of labels) {
          const group = byTag.get(label) ?? []; group.push(task); byTag.set(label, group);
        }
      }
      const entries = [...byTag.entries()].sort(([a], [b]) => a.localeCompare(b, 'en'));
      for (const [label, items] of entries) {
        const group = makeElement(document, 'section', 'tasks-tag-group');
        const groupHeading = makeElement(document, 'h3', 'tasks-tag-group-heading', label);
        const groupCount = makeElement(document, 'span', 'tasks-tag-group-count', String(items.length));
        groupHeading.append(groupCount); group.append(groupHeading);
        for (const task of sortByAttention(items)) group.append(renderRow(task, options.active));
        nodes.push(group);
      }
      if (!nodes.length || (options.showHeading && entries.length === 0)) {
        renderEmpty(options.emptyTitle, options.emptyBody, options.active); return;
      }
    } else {
      const ordered = options.active ? sortByAttention(tasks) : tasks;
      const visible = options.active && !showAllActive ? ordered.slice(0, 4) : ordered;
      for (const task of visible) nodes.push(renderRow(task, options.active));
      if (options.active && ordered.length > visible.length) {
        const more = makeElement(document, 'button', 'tasks-expand-list', `Show ${ordered.length - visible.length} more active tasks`);
        more.type = 'button'; more.addEventListener('click', () => { showAllActive = true; render(); });
        const arrow = makeElement(document, 'span', 'tasks-expand-arrow', '›'); arrow.setAttribute('aria-hidden', 'true'); more.append(arrow);
        nodes.push(more);
      }
      if (ordered.length === 0) { renderEmpty(options.emptyTitle, options.emptyBody, options.active); return; }
    }
    scroll.replaceChildren(...nodes);
  }

  function updateTabs(counts: { active: number; waiting: number; snoozed: number; completed: number; composted: number }): void {
    for (const [mode, button] of modeButtons) {
      button.setAttribute('aria-current', currentMode === mode ? 'page' : 'false');
      button.classList.toggle('selected', currentMode === mode);
      const label = mode === 'active' ? `Active ${counts.active}` : mode === 'waiting' ? `Waiting ${counts.waiting}` : mode === 'snoozed' ? `Snoozed ${counts.snoozed}` : `Archive ${counts.completed + counts.composted}`;
      button.setAttribute('aria-label', label);
      const counter = button.querySelector('.tasks-tab-count');
      const value = mode === 'active' ? counts.active : mode === 'waiting' ? counts.waiting : mode === 'snoozed' ? counts.snoozed : counts.completed + counts.composted;
      if (counter) counter.textContent = String(value);
      else { const span = makeElement(document, 'span', 'tasks-tab-count', String(value)); button.append(span); }
    }
    for (const [mode, button] of archiveButtons) {
      button.setAttribute('aria-pressed', String(archiveMode === mode));
      button.classList.toggle('selected', archiveMode === mode);
    }
    archiveTabs.hidden = currentMode !== 'archive';
    tagFilter.hidden = selectedTag === null;
    if (selectedTag) tagFilterLabel.textContent = `Tag · ${selectedTag}`;
    groupButton.disabled = currentMode === 'active' && counts.active === 0;
  }

  function renderFooter(ready: Extract<TasksState, { kind: 'ready' }>): void {
    const pendingWritebacks = ready.document.todoistOutbox.length;
    const status = ready.persistenceError
      ? ready.persistenceError.kind === 'conflict' ? 'Changes preserved · export local copy' : 'Local save failed'
      : pendingWritebacks ? `${pendingWritebacks} Todoist changes pending`
      : ready.todoistConnection.kind === 'connected' && ready.todoistConnection.projectID ? 'Todoist connected' :
        root.ownerDocument.documentElement.dataset.native === 'true' ? 'Saved on this Mac' : 'Saved in this browser';
    localStatus.textContent = status;
    footer.classList.toggle('has-error', !!ready.persistenceError);
  }

  function render(): void {
    if (disposed) return;
    if (state.kind === 'loading') {
      title.textContent = 'Your tasks'; subtitle.textContent = 'Opening your local task list…'; count.textContent = '';
      scroll.replaceChildren(); resting.hidden = true; attentionHeading.hidden = true; captureButton.disabled = true; captureInput.disabled = true;
      localStatus.textContent = 'Loading local tasks…'; return;
    }
    if (state.kind === 'recovery') {
      title.textContent = 'Tasks need recovery'; subtitle.textContent = 'Your saved data was not changed.'; count.textContent = '';
      captureButton.disabled = true; captureInput.disabled = true; tabs.hidden = true; archiveTabs.hidden = true; resting.hidden = true; attentionHeading.hidden = true;
      renderEmpty('The task list could not be opened', state.message, false);
      localStatus.textContent = 'Recovery required'; footer.classList.add('has-error'); return;
    }
    if (state.kind !== 'ready') return;
    title.textContent = 'Your tasks';
    subtitle.textContent = 'A little room for what’s next.';
    tabs.hidden = false; captureInput.disabled = !!state.persistenceError; captureButton.disabled = adding || !!state.persistenceError;
    groupButton.setAttribute('aria-pressed', String(grouped));
    const activeAll = facade.queryTasks({ mode: 'active' }).tasks;
    const waitingAll = facade.queryTasks({ mode: 'waiting' }).tasks;
    const completedAll = facade.queryTasks({ mode: 'completed' }).tasks;
    const compostedAll = facade.queryTasks({ mode: 'composted' }).tasks;
    const counts = {
      active: activeAll.filter(task => task.status.kind === 'active').length,
      waiting: waitingAll.length,
      snoozed: activeAll.filter(task => task.status.kind === 'snoozed').length,
      completed: completedAll.length, composted: compostedAll.length,
    };
    count.textContent = `${counts.active} active · ${counts.waiting + counts.snoozed} resting`;
    updateTabs(counts);
    renderFooter(state);
    if (selectedTag) {
      tagFilter.hidden = false;
      tagFilterLabel.textContent = `Tag · ${selectedTag}`;
    }

    if (currentMode === 'active') {
      const result = facade.queryTasks({ mode: 'active', ...(selectedTag ? { tag: selectedTag } : {}), groupByTag: grouped });
      const active = result.tasks.filter(task => task.status.kind === 'active');
      const snoozed = result.tasks.filter(task => task.status.kind === 'snoozed');
      attentionHeading.hidden = false;
      attentionTitle.textContent = 'A little attention';
      attentionHint.textContent = 'sorted by pace';
      resting.hidden = waitingAll.length + snoozed.length === 0;
      waitingLink.textContent = `Waiting ${waitingAll.length}`;
      snoozedLink.textContent = `Snoozed ${snoozed.length}`;
      if (result.groups && grouped && !selectedTag) {
        const activeGroups = result.groups.map(group => ({ ...group, tasks: group.tasks.filter(task => task.status.kind === 'active') })).filter(group => group.tasks.length);
        const nodes: HTMLElement[] = [];
        for (const groupModel of activeGroups) {
          const group = makeElement(document, 'section', 'tasks-tag-group');
          const groupName = groupModel.tag ?? 'Untagged';
          const groupHeading = makeElement(document, 'h3', 'tasks-tag-group-heading', groupName);
          const badge = makeElement(document, 'span', 'tasks-tag-group-count', String(groupModel.tasks.length)); groupHeading.append(badge); group.append(groupHeading);
          for (const task of sortByAttention(groupModel.tasks)) group.append(renderRow(task, true));
          nodes.push(group);
        }
        if (activeGroups.length === 0) renderEmpty('Nothing needs attention right now', 'Capture a task or let a resting task wait.', true);
        else scroll.replaceChildren(...nodes);
      } else renderTasks(active, { active: true, showHeading: false, emptyTitle: 'Nothing needs attention right now', emptyBody: 'Capture a task or let a resting task wait.' });
      if (active.length === 0 && (waitingAll.length || snoozed.length)) {
        emptyState.hidden = false;
      }
      return;
    }

    attentionHeading.hidden = true; resting.hidden = true;
    if (currentMode === 'waiting') {
      const tasks = facade.queryTasks({ mode: 'waiting', ...(selectedTag ? { tag: selectedTag } : {}), groupByTag: grouped }).tasks;
      renderTasks(tasks, { active: false, emptyTitle: 'No waiting tasks', emptyBody: 'Move a task to Waiting when it needs time or input.', showHeading: false });
      return;
    }
    if (currentMode === 'snoozed') {
      const tasks = facade.queryTasks({ mode: 'active', ...(selectedTag ? { tag: selectedTag } : {}), groupByTag: grouped }).tasks.filter(task => task.status.kind === 'snoozed');
      renderTasks(tasks, { active: false, emptyTitle: 'No snoozed tasks', emptyBody: 'Snoozed tasks stay here until you resume them or they wake.', showHeading: false });
      return;
    }
    const archiveQuery: TaskListMode = archiveMode;
    const tasks = facade.queryTasks({ mode: archiveQuery, ...(selectedTag ? { tag: selectedTag } : {}), groupByTag: grouped }).tasks;
    renderTasks(tasks, { active: false, emptyTitle: archiveMode === 'completed' ? 'No completed tasks' : 'No composted tasks', emptyBody: 'Completed and composted tasks stay in the archive.', showHeading: false });
  }

  function setPinState(pinned: boolean, saving = false): void {
    pinButton.setAttribute('aria-label', pinned ? 'Unpin window' : 'Pin window');
    pinButton.title = pinned ? 'Unpin window' : 'Pin window';
    pinButton.setAttribute('aria-pressed', String(pinned));
    pinButton.classList.toggle('selected', pinned);
    pinButton.querySelector('svg')?.replaceWith(renderIcon(pinned ? PinOff : Pin, 15));
    const label = pinButton.querySelector('.tasks-toolbar-button-label');
    if (label) label.textContent = pinned ? 'Pinned' : 'Pin';
    pinButton.disabled = saving;
  }

  function setAppearance(dark: boolean): void { logo.src = dark ? 'tasks-brand/logo-dark.svg' : 'tasks-brand/logo.svg'; }

  function setGlobalTimer(timer: { title: string; elapsedMs: number } | null): void {
    globalTimer.hidden = timer === null;
    if (timer) { globalTimer.textContent = `${formatElapsed(timer.elapsedMs)} · ${timer.title}`; globalTimer.title = `Focus timer running on ${timer.title}`; }
    else globalTimer.textContent = '';
  }

  captureInput.addEventListener('keydown', event => {
    if (event.key === 'Escape') captureInput.value = '';
  });
  return {
    update(next) { state = next; render(); },
    focusCapture() { if (!captureInput.disabled) captureInput.focus(); },
    setPinState,
    setAppearance,
    setGlobalTimer,
    dispose() { disposed = true; root.replaceChildren(); },
  };
}
