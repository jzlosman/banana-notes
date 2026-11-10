import type { RecoveryBackupReadModel, RecoveryResolution, TasksFacade, TasksState } from '../application/controller';
import { makeElement } from './helpers';
import type { MountedTasksScreen } from './contracts';

type RecoveryState = Extract<TasksState, { kind: 'recovery' }>;
type RecoveryBackup = RecoveryBackupReadModel;
type RecoveryError = 'conflict' | 'failed';
type RecoveryOperation = 'restore' | 'check' | null;
export interface MountedTasksRecovery extends MountedTasksScreen {
  update(state: RecoveryState): void;
}

const COPY = {
  candidateTitle: 'Tasks need recovery',
  candidateBody: "The saved task list couldn't be opened. Nothing has been changed.",
  confirmTitle: 'Restore this backup?',
  confirmWarning: 'This restores the backup as your task list, replacing an unreadable file if one exists. The backup may not include your latest changes. If an original file exists, it is kept separately before restoration.',
  unavailable: "Banana Tasks couldn't check for a valid backup. Nothing has been changed.",
  noBackup: 'No valid backup is available. Nothing has been changed.',
  unsupported: "This task data isn't supported by this version of Banana Tasks. Use a compatible version to continue.",
  conflict: 'Task files changed while recovery was open. Nothing was restored. Check the backup again before choosing restore.',
  failed: "The restore couldn't finish. Check backup availability before choosing what to do next.",
  restoring: "Restoring backup. Banana Tasks will reload when it's ready.",
} as const;

function formatBackupCount(taskCount: number): string | null {
  if (!Number.isSafeInteger(taskCount) || taskCount < 0) return null;
  const category = new Intl.PluralRules().select(taskCount);
  const noun = category === 'one' ? 'task' : 'tasks';
  return `${new Intl.NumberFormat().format(taskCount)} ${noun}`;
}

function formatSavedAt(savedAt: number): string | null {
  if (!Number.isFinite(savedAt) || Math.abs(savedAt) > 8.64e15) return null;
  const date = new Date(savedAt);
  if (!Number.isFinite(date.getTime())) return null;
  return `Saved ${new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeStyle: 'short' }).format(date)}`;
}

export function mountTasksRecovery(root: HTMLElement, facade: TasksFacade, initialState: RecoveryState): MountedTasksRecovery {
  const document = root.ownerDocument;
  const toolbar = makeElement(document, 'header', 'tasks-toolbar');
  const logo = makeElement(document, 'img', 'tasks-brand-lockup');
  logo.src = 'tasks-brand/logo.svg'; logo.alt = 'Banana Tasks'; logo.width = 120;
  const dragSpacer = makeElement(document, 'span', 'tasks-toolbar-drag');
  dragSpacer.dataset.tasksDragRegion = 'true'; dragSpacer.setAttribute('aria-hidden', 'true');
  toolbar.append(logo, dragSpacer);

  const main = makeElement(document, 'main', 'tasks-recovery-main quiet-scroll');
  const region = makeElement(document, 'section', 'tasks-recovery-column');
  region.setAttribute('aria-labelledby', 'tasks-recovery-title');
  const heading = makeElement(document, 'h1', 'tasks-recovery-title');
  heading.id = 'tasks-recovery-title'; heading.tabIndex = -1;
  const body = makeElement(document, 'p', 'tasks-recovery-body');
  const warning = makeElement(document, 'p', 'tasks-recovery-warning');
  warning.id = 'tasks-recovery-warning';
  const backup = makeElement(document, 'section', 'tasks-recovery-backup');
  backup.setAttribute('aria-label', 'Available backup');
  const backupLabel = makeElement(document, 'h2', 'tasks-recovery-backup-label', 'Available backup');
  const backupMeta = makeElement(document, 'div', 'tasks-recovery-backup-meta');
  const backupCount = makeElement(document, 'span', 'tasks-recovery-backup-count');
  const backupSaved = makeElement(document, 'span', 'tasks-recovery-backup-saved');
  backupMeta.append(backupCount, backupSaved);
  backup.append(backupLabel, backupMeta);

  const actions = makeElement(document, 'div', 'tasks-startup-recovery-actions');
  const cancelButton = makeElement(document, 'button', 'tasks-recovery-cancel', 'Cancel');
  cancelButton.type = 'button';
  const primaryButton = makeElement(document, 'button', 'tasks-recovery-primary', 'Restore backup');
  primaryButton.type = 'button';
  const checkButton = makeElement(document, 'button', 'tasks-recovery-check', 'Check backup again');
  checkButton.type = 'button';
  actions.append(cancelButton, checkButton);
  region.append(heading, body, warning, backup, actions);
  main.append(region);

  const footer = makeElement(document, 'footer', 'tasks-recovery-footer');
  const footerDot = makeElement(document, 'span', 'tasks-footer-dot'); footerDot.setAttribute('aria-hidden', 'true');
  const footerStatus = makeElement(document, 'span', 'tasks-local-status', 'Recovery required');
  footer.append(footerDot, footerStatus);
  root.className = 'tasks-recovery-screen';
  root.replaceChildren(toolbar, main, footer);

  let state = initialState;
  let confirmationOpen = false;
  let operation: RecoveryOperation = null;
  let blockedAfterRestore: RecoveryError | null = null;
  let inspectionFailed = false;
  let disposed = false;
  let focusHeadingAfterRender = false;
  let hasRendered = false;

  function resolution(): RecoveryResolution {
    return state.resolution;
  }

  function selectedBackup(): RecoveryBackup | null {
    const current = resolution();
    return current.kind === 'candidate' || current.kind === 'restoring' ? current.backup : null;
  }

  function stateCanCheck(): boolean {
    if (blockedAfterRestore || inspectionFailed) return true;
    switch (resolution().kind) {
      case 'no-valid-backup':
      case 'inspection-failed':
      case 'primary-changed':
      case 'restore-failed':
        return true;
      default:
        return false;
    }
  }

  function renderBackupSummary(value: RecoveryBackup | null): void {
    if (!value) { backup.hidden = true; backupCount.textContent = ''; backupSaved.textContent = ''; return; }
    const count = formatBackupCount(value.taskCount);
    const saved = formatSavedAt(value.savedAt);
    if (!count || !saved) { backup.hidden = true; backupCount.textContent = ''; backupSaved.textContent = ''; return; }
    backup.hidden = false;
    backupCount.textContent = count;
    backupSaved.textContent = saved;
  }

  function render(): void {
    if (disposed) return;
    const current = resolution();
    const busy = operation !== null || current.kind === 'restoring';
    const restoring = operation === 'restore' || current.kind === 'restoring';
    const checking = operation === 'check' || current.kind === 'checking';
    const localError = blockedAfterRestore;
    const confirming = confirmationOpen && (current.kind === 'candidate' || restoring) && localError === null;
    let titleText: string = COPY.candidateTitle;
    let bodyText: string = COPY.candidateBody;
    let alertHeading = false;
    let canRestore = false;
    let showCheck = false;
    let summary: RecoveryBackup | null = selectedBackup();

    if (localError === 'conflict') {
      titleText = COPY.candidateTitle; bodyText = COPY.conflict; alertHeading = true; showCheck = true;
      summary = selectedBackup();
    } else if (localError === 'failed') {
      titleText = COPY.candidateTitle; bodyText = COPY.failed; alertHeading = true; showCheck = true;
      summary = selectedBackup();
    } else if (inspectionFailed) {
      titleText = COPY.candidateTitle; bodyText = COPY.unavailable; alertHeading = true; showCheck = true;
      summary = null;
    } else if (restoring) {
      titleText = COPY.restoring; bodyText = '';
      summary = selectedBackup();
    } else if (checking) {
      titleText = COPY.candidateTitle;
      bodyText = current.kind === 'checking' ? state.message : '';
      summary = null;
      showCheck = true;
    } else if (confirming) {
      titleText = COPY.confirmTitle; bodyText = '';
      summary = selectedBackup();
    } else {
      switch (current.kind) {
        case 'candidate':
          titleText = COPY.candidateTitle; bodyText = COPY.candidateBody; canRestore = true;
          summary = current.backup ?? null;
          break;
        case 'unavailable':
          titleText = COPY.candidateTitle; bodyText = COPY.unavailable; alertHeading = true; summary = null;
          break;
        case 'inspection-failed':
          titleText = COPY.candidateTitle; bodyText = COPY.unavailable; alertHeading = true; showCheck = true; summary = null;
          break;
        case 'unsupported-version':
          titleText = COPY.candidateTitle; bodyText = COPY.unsupported; alertHeading = true; summary = null;
          break;
        case 'no-valid-backup':
          titleText = COPY.candidateTitle; bodyText = COPY.noBackup; alertHeading = true; showCheck = true; summary = null;
          break;
        case 'primary-changed':
          titleText = COPY.candidateTitle; bodyText = state.message; alertHeading = true; showCheck = true; summary = null;
          break;
        case 'restore-failed':
          titleText = COPY.candidateTitle; bodyText = COPY.failed; alertHeading = true; showCheck = true;
          summary = null;
          break;
        default:
          titleText = COPY.candidateTitle; bodyText = COPY.unavailable; alertHeading = true; summary = null;
      }
    }

    heading.textContent = titleText;
    heading.removeAttribute('role'); heading.removeAttribute('aria-live'); heading.removeAttribute('aria-atomic');
    if (alertHeading) {
      heading.setAttribute('role', 'alert'); heading.setAttribute('aria-live', 'assertive');
    } else if (restoring) {
      heading.setAttribute('role', 'status'); heading.setAttribute('aria-live', 'polite'); heading.setAttribute('aria-atomic', 'true');
    }
    body.textContent = bodyText;
    body.hidden = bodyText.length === 0;
    body.removeAttribute('role'); body.removeAttribute('aria-live'); body.removeAttribute('aria-atomic');
    if (checking && bodyText) {
      body.setAttribute('role', 'status'); body.setAttribute('aria-live', 'polite'); body.setAttribute('aria-atomic', 'true');
    }
    warning.textContent = COPY.confirmWarning;
    warning.hidden = !confirming;
    renderBackupSummary(summary);
    region.setAttribute('aria-busy', String(busy));
    if (confirming) region.setAttribute('aria-describedby', warning.id);
    else region.removeAttribute('aria-describedby');
    actions.classList.toggle('is-confirmation', confirming || restoring);
    actions.hidden = !(canRestore || confirming || showCheck || restoring);
    cancelButton.hidden = !confirming && !restoring;
    const showPrimary = canRestore || confirming || restoring;
    if (showPrimary) {
      if (primaryButton.parentElement !== actions) actions.insertBefore(primaryButton, checkButton);
    } else primaryButton.remove();
    primaryButton.textContent = restoring ? 'Restoring…' : 'Restore backup';
    if (confirming) primaryButton.setAttribute('aria-describedby', warning.id);
    else primaryButton.removeAttribute('aria-describedby');
    checkButton.hidden = !showCheck;
    if (operation === 'check') checkButton.textContent = 'Checking…';

    if (focusHeadingAfterRender) {
      heading.focus();
      focusHeadingAfterRender = false;
    }
    cancelButton.disabled = busy;
    primaryButton.disabled = busy;
    checkButton.disabled = busy;
    if (operation !== 'check') checkButton.textContent = 'Check backup again';
    hasRendered = true;
  }

  function enterConfirmation(): void {
    if (disposed || operation || blockedAfterRestore || resolution().kind !== 'candidate') return;
    confirmationOpen = true;
    focusHeadingAfterRender = true;
    render();
  }

  function cancelConfirmation(): void {
    if (disposed || operation || !confirmationOpen) return;
    confirmationOpen = false;
    focusHeadingAfterRender = true;
    render();
  }

  async function restore(): Promise<void> {
    if (disposed || operation || !confirmationOpen || blockedAfterRestore || resolution().kind !== 'candidate') return;
    operation = 'restore';
    focusHeadingAfterRender = true;
    render();
    try {
      const outcome = await facade.restoreBackup();
      if (disposed) return;
      operation = null;
      confirmationOpen = false;
      if (outcome.kind === 'conflict') blockedAfterRestore = 'conflict';
      else if (outcome.kind === 'failed' || outcome.kind === 'unavailable') blockedAfterRestore = 'failed';
      render();
      if (blockedAfterRestore) { heading.focus(); }
    } catch {
      if (disposed) return;
      operation = null;
      confirmationOpen = false;
      blockedAfterRestore = 'failed';
      render(); heading.focus();
    }
  }

  async function checkAgain(): Promise<void> {
    if (disposed || operation || !stateCanCheck()) return;
    operation = 'check';
    confirmationOpen = false;
    blockedAfterRestore = null;
    inspectionFailed = false;
    focusHeadingAfterRender = true;
    render();
    try {
      const next = await facade.checkBackupAgain();
      if (disposed) return;
      operation = null;
      if (next.kind === 'recovery') {
        state = next;
        confirmationOpen = false;
      }
      render();
      if (next.kind === 'recovery') heading.focus();
    } catch {
      if (disposed) return;
      operation = null;
      inspectionFailed = true;
      render(); heading.focus();
    }
  }

  primaryButton.addEventListener('click', () => {
    if (confirmationOpen) void restore();
    else enterConfirmation();
  });
  cancelButton.addEventListener('click', cancelConfirmation);
  checkButton.addEventListener('click', () => { void checkAgain(); });
  const keydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    if (operation) { event.preventDefault(); event.stopPropagation(); return; }
    if (confirmationOpen) {
      event.preventDefault(); event.stopPropagation(); cancelConfirmation();
    }
  };
  document.addEventListener('keydown', keydown);

  function update(next: RecoveryState): void {
    if (disposed) return;
    const previousResolution = resolution().kind;
    state = next;
    const currentResolution = resolution().kind;
    if (operation === 'check' && currentResolution === 'candidate') {
      confirmationOpen = false;
      blockedAfterRestore = null;
      inspectionFailed = false;
    }
    if (currentResolution === 'restore-failed' && previousResolution !== 'restore-failed' && operation !== 'restore') {
      blockedAfterRestore = 'failed';
      focusHeadingAfterRender = true;
    }
    if (!hasRendered || previousResolution !== currentResolution && currentResolution !== 'restoring' && operation !== 'check') {
      focusHeadingAfterRender = true;
    }
    render();
  }

  cancelButton.hidden = true;
  checkButton.hidden = true;
  update(initialState);
  return {
    update(next) { update(next as RecoveryState); },
    dispose() {
      if (disposed) return;
      disposed = true;
      document.removeEventListener('keydown', keydown);
      root.replaceChildren();
    },
  };
}
