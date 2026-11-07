import './settings.css';
import { SYSTEM_THEME, resolveThemeID, themes, themeByID } from '../../domain/themes';
import { shortcutFromKeyEvent, type RecordedShortcut } from '../../domain/hotkey';
import { installThemeGridKeyboard, updateThemeGridTabStop } from '../../ui/theme-grid';
import type { TasksFacade, TasksState, CommandOutcome } from '../application/controller';
import type { CaptureProject, TasksHotkeyState, TasksPreferences } from '../application/ports';
import type { MountedTasksScreen, TasksScreenOptions } from './contracts';

type SettingsTab = 'General' | 'Themes' | 'Connections' | 'Sound & motion';
type ScreenNotice = { message: string; kind: 'status' | 'error' };
type HotkeyRecorderIssue = 'recording' | 'confirmation' | 'modifier-required' | 'unmapped-key';
type HotkeyCaptureIssue = Extract<HotkeyRecorderIssue, 'modifier-required' | 'unmapped-key'>;
type HotkeyRecorderPhase =
  | { kind: 'loading' }
  | { kind: 'load-failed' }
  | { kind: 'ready'; confirmed: TasksHotkeyState; issue?: Extract<HotkeyRecorderIssue, 'recording' | 'confirmation'> }
  | { kind: 'capture-start'; confirmed: TasksHotkeyState; generation: number }
  | { kind: 'recording'; confirmed: TasksHotkeyState; generation: number; captureIssue?: HotkeyCaptureIssue }
  | { kind: 'end-cancel'; confirmed: TasksHotkeyState; generation: number; issue?: 'recording' }
  | { kind: 'end-save'; confirmed: TasksHotkeyState; generation: number; shortcut: RecordedShortcut }
  | { kind: 'applying'; confirmed: TasksHotkeyState; generation: number; shortcut: RecordedShortcut }
  | { kind: 'resetting'; confirmed: TasksHotkeyState; generation: number };

const tabs: readonly SettingsTab[] = ['General', 'Themes', 'Connections', 'Sound & motion'];
let instanceSequence = 0;

function escapeHTML(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function stateError(state: TasksState): string | null {
  if (state.kind === 'recovery') return 'Saved Tasks data could not be read. Settings are unavailable.';
  if (state.kind === 'loading') return 'Loading settings…';
  if (state.kind === 'disposed') return 'Settings are closed.';
  return null;
}

function isReady(state: TasksState): state is Extract<TasksState, { kind: 'ready' }> {
  return state.kind === 'ready';
}

function settingsFaultMessage(state: Extract<TasksState, { kind: 'ready' }>): string | null {
  if (!state.preferencesError) return null;
  return 'A preference could not be saved or loaded. The last confirmed value remains active.';
}

function safeCommandFailure<T>(outcome: CommandOutcome<T>, operation: string): string {
  if (outcome.kind === 'unavailable') {
    if (operation.startsWith('calendar')) return 'Calendar access is unavailable in this environment.';
    return 'Todoist is unavailable. Local tasks are unchanged.';
  }
  if (outcome.kind === 'rejected') {
    if (outcome.reason === 'no_project') return 'Choose a Todoist project before refreshing.';
    if (outcome.reason === 'not_connected') return 'Connect Todoist before continuing.';
    if (outcome.reason === 'invalid_project') return 'That Todoist project is no longer available. Load projects and choose again.';
    if (outcome.reason === 'invalid_input') return 'Check the entered value and try again.';
    return 'The request could not be completed. Check the selection and try again.';
  }
  if (operation === 'todoist-connect') return 'Could not connect to Todoist. Check the API token and try again.';
  if (operation === 'todoist-projects') return 'Could not load Todoist projects. Try again.';
  if (operation === 'todoist-project') return 'Could not save that Todoist project. The confirmed project is unchanged.';
  if (operation === 'todoist-refresh') return 'Could not refresh Todoist. Local tasks are unchanged.';
  if (operation === 'todoist-disconnect') return 'Could not disconnect Todoist. The confirmed connection is unchanged.';
  if (operation === 'calendar-access') return 'Could not request Calendar access. Try again from this screen.';
  return 'The operation could not be completed.';
}

function projectName(projects: readonly CaptureProject[], projectID: string | null): string {
  if (!projectID) return 'No project selected';
  return projects.find(project => project.id === projectID)?.name ?? 'Selected project';
}

function integrationFaultMessage(state: Extract<TasksState, { kind: 'ready' }>): string | null {
  switch (state.fault?.operation) {
    case 'connect_todoist': return 'Could not connect to Todoist. Check the API token and try again.';
    case 'load_todoist_projects': return 'Could not load Todoist projects. Try again.';
    case 'select_todoist_project': return 'Could not save the Todoist project. The confirmed choice is unchanged.';
    case 'sync_todoist': return 'Could not refresh Todoist. Local tasks are unchanged.';
    case 'disconnect_todoist': return 'Could not disconnect Todoist. The confirmed connection is unchanged.';
    case 'todoist_connection': case 'todoist_outbox_connection': return 'Todoist could not be reached. Pending completion updates remain queued.';
    case 'todoist_writeback': return 'A Todoist completion update is still queued. It will be retried when Todoist is reachable.';
    case 'request_calendar_access': return 'Could not request Calendar access. Try again from this screen.';
    default: return null;
  }
}

function themeCard(id: string, name: string, appearance: string, selectedID: string, disabled: boolean, colors?: {
  paper: string; chrome: string; ink: string; muted: string; accent: string;
}): string {
  const selected = id === selectedID;
  const previewStyle = colors
    ? ` style="--preview-paper:${colors.paper};--preview-chrome:${colors.chrome};--preview-ink:${colors.ink};--preview-muted:${colors.muted};--preview-accent:${colors.accent}"`
    : '';
  const label = `${name}, ${appearance} appearance`;
  return `<button class="tasks-theme-choice${selected ? ' is-selected' : ''}" type="button" role="radio" aria-checked="${selected}" aria-label="${escapeHTML(label)}" data-theme-id="${escapeHTML(id)}" data-focus-key="theme:${escapeHTML(id)}"${disabled ? ' aria-disabled="true"' : ''}${previewStyle}>
    <span class="tasks-theme-sample-top" aria-hidden="true"><span class="tasks-theme-sample-ink"></span><span class="tasks-theme-sample-muted"></span><span class="tasks-theme-sample-accent"></span></span>
    <span class="tasks-theme-sample-bottom"><span class="tasks-theme-name">${escapeHTML(name)}</span>${selected ? '<svg class="tasks-theme-check" viewBox="0 0 12 12" aria-hidden="true"><path d="m2 6 2.5 2.5L10 3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>' : ''}</span>
  </button>`;
}

function radioOption(name: string, value: string, label: string, checked: boolean, disabled: boolean, focusKey: string): string {
  return `<label class="tasks-settings-segment${checked ? ' is-selected' : ''}"><input type="radio" name="${name}" value="${value}"${checked ? ' checked' : ''}${disabled ? ' aria-disabled="true"' : ''} data-preference-radio="${name}" data-focus-key="${focusKey}"><span>${label}</span></label>`;
}

function installSystemThemeKeyboard(group: HTMLElement, grid: HTMLElement): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    const view = group.ownerDocument.defaultView;
    const target = event.target;
    if (!view || !(target instanceof view.Element)) return;
    const current = target.closest<HTMLButtonElement>('[role="radio"][data-theme-id]');
    if (!current || !group.contains(current)) return;
    const system = group.querySelector<HTMLButtonElement>(`[data-theme-id="${SYSTEM_THEME}"]`);
    const palette = [...grid.querySelectorAll<HTMLButtonElement>('[role="radio"][data-theme-id]')];
    const first = palette[0];
    const last = palette.at(-1);
    if (!system || !first || !last) return;
    let next: HTMLButtonElement | null = null;
    if (event.key === 'Home') next = system;
    else if (event.key === 'End') next = last;
    else if (current === system && (event.key === 'ArrowRight' || event.key === 'ArrowDown')) next = first;
    else if (current === first && (event.key === 'ArrowLeft' || event.key === 'ArrowUp')) next = system;
    if (!next) return;
    event.preventDefault();
    event.stopPropagation();
    if (next !== current) { next.focus(); next.click(); }
  };
  group.addEventListener('keydown', onKeyDown, true);
  return () => group.removeEventListener('keydown', onKeyDown, true);
}

export function mountTasksSettings(root: HTMLElement, facade: TasksFacade, options: TasksScreenOptions): MountedTasksScreen {
  let state = facade.getState();
  let activeTab: SettingsTab = 'General';
  let notice: ScreenNotice | null = null;
  let tokenDraft = '';
  let showToken = false;
  let disposed = false;
  const pending = new Set<string>();
  const instanceID = ++instanceSequence;
  const tabsID = `tasks-settings-tabs-${instanceID}`;
  const panelID = `tasks-settings-panel-${instanceID}`;
  let removeThemeKeyboard: (() => void) | null = null;
  let rendering = false;
  let hotkeyPhase: HotkeyRecorderPhase = options.hotkeyPreferences ? { kind: 'loading' } : { kind: 'load-failed' };
  let recorderGeneration = 0;

  function preferenceReady(): boolean {
    return isReady(state) && !state.preferencesError;
  }

  function setNotice(message: string, kind: 'status' | 'error'): void {
    if (disposed) return;
    notice = { message, kind };
    options.notify(message, kind);
  }

  function renderNotice(): string {
    const fault = isReady(state) ? settingsFaultMessage(state) : null;
    const current = notice ?? (fault ? { message: fault, kind: 'error' as const } : null);
    if (!current) return '';
    const role = current.kind === 'error' ? 'alert' : 'status';
    return `<div class="tasks-settings-notice is-${current.kind}" role="${role}" aria-live="${current.kind === 'error' ? 'assertive' : 'polite'}">${escapeHTML(current.message)}</div>`;
  }

  function confirmedHotkey(): TasksHotkeyState | null {
    return hotkeyPhase.kind === 'loading' || hotkeyPhase.kind === 'load-failed' ? null : hotkeyPhase.confirmed;
  }

  function hotkeyIssue(): HotkeyRecorderIssue | undefined {
    if (hotkeyPhase.kind === 'recording') return hotkeyPhase.captureIssue;
    return hotkeyPhase.kind === 'ready' || hotkeyPhase.kind === 'end-cancel' ? hotkeyPhase.issue : undefined;
  }

  function hotkeyErrorMessage(): string | null {
    if (hotkeyPhase.kind === 'load-failed') return 'Could not load the global shortcut. Try again later.';
    if (hotkeyIssue() === 'modifier-required') return 'Include at least one of Command, Control, or Option.';
    if (hotkeyIssue() === 'unmapped-key') return 'That key is not supported. Try a letter, number, Space, Return, Tab, arrow, function, or punctuation key.';
    if (hotkeyIssue() === 'recording') return 'The shortcut recorder could not be started or stopped. Try again.';
    if (hotkeyIssue() === 'confirmation') return 'Could not confirm the shortcut change. Reopen Settings to check it.';
    const confirmed = confirmedHotkey();
    switch (confirmed?.error) {
      case 'verification-profile': return 'Global shortcuts are off in this verification build.';
      case 'registration-unavailable': case 'registration-failed':
        return confirmed.registered
          ? 'The shortcut could not be registered. Your previous shortcut remains active.'
          : 'The shortcut could not be registered. No global shortcut is active.';
      default: return null;
    }
  }

  function hotkeySettings(): string {
    if (!options.hotkeyPreferences) return '';
    const confirmed = confirmedHotkey();
    const recording = hotkeyPhase.kind === 'recording';
    const loading = hotkeyPhase.kind === 'loading';
    const starting = hotkeyPhase.kind === 'capture-start';
    const saving = hotkeyPhase.kind === 'end-save' || hotkeyPhase.kind === 'applying';
    const resetting = hotkeyPhase.kind === 'resetting';
    const busy = starting || hotkeyPhase.kind === 'end-cancel' || saving || resetting;
    const unavailable = !confirmed || !confirmed.available || confirmed.error === 'verification-profile' || hotkeyIssue() === 'confirmation';
    const display = recording ? 'Press a shortcut…'
      : saving || resetting ? 'Saving…'
        : loading ? 'Loading…' : confirmed?.display ?? 'Unavailable';
    const feedbackID = `tasks-hotkey-feedback-${instanceID}`;
    const error = hotkeyErrorMessage();
    const feedback = error
      ? `<p id="${feedbackID}" class="tasks-hotkey-feedback tasks-hotkey-error" role="alert" aria-live="assertive">${escapeHTML(error)}</p>`
      : confirmed && !confirmed.available
        ? `<p id="${feedbackID}" class="tasks-hotkey-feedback tasks-hotkey-status" role="status">Global shortcuts are unavailable here.</p>` : '';
    const disabled = unavailable || busy || recording;
    const describedBy = error || (confirmed && !confirmed.available) ? ` aria-describedby="${feedbackID}"` : '';
    const accessibleShortcut = hotkeyIssue() === 'confirmation' ? 'Last confirmed shortcut' : 'Current shortcut';
    const buttonLabel = recording ? 'Press a shortcut, or Escape to cancel'
      : `Record global shortcut${confirmed ? `. ${accessibleShortcut}: ${confirmed.display}` : ''}`;
    return `<section class="tasks-settings-section tasks-hotkey-section">
      <div class="tasks-setting-row tasks-hotkey-row">
        <span class="tasks-setting-copy"><span class="tasks-setting-title">Global shortcut</span><span class="tasks-setting-hint">Show or hide Banana Tasks from any app.</span></span>
        <div class="tasks-hotkey-controls">
          <button class="tasks-hotkey-chord" type="button" data-action="record-hotkey" data-focus-key="hotkey-record" data-recording="${recording}" aria-label="${escapeHTML(buttonLabel)}" aria-pressed="${recording}"${busy ? ' aria-disabled="true"' : unavailable ? ' disabled' : ''}${busy ? ' aria-busy="true"' : ''}${describedBy}>${escapeHTML(display)}</button>
          <button class="tasks-text-button tasks-hotkey-reset" type="button" data-action="reset-hotkey" data-focus-key="hotkey-reset" aria-label="Reset global shortcut"${disabled ? ' disabled' : ''}${busy ? ' aria-busy="true"' : ''}${describedBy}>Reset</button>
        </div>
      </div>
      ${feedback}
    </section>`;
  }

  function generalPanel(ready: Extract<TasksState, { kind: 'ready' }>): string {
    const preferences = ready.preferences;
    const pinDisabled = !preferenceReady() || pending.has('preference:pinned');
    const ripeningDisabled = !preferenceReady() || pending.has('preference:ripeningSpeed');
    return `<div class="tasks-settings-scroll tasks-general-panel quiet-scroll" data-scroll-key="general">
      ${hotkeySettings()}
      <section class="tasks-settings-section">
        <label class="tasks-setting-row" for="tasks-pin-${instanceID}">
          <span class="tasks-setting-copy"><span class="tasks-setting-title">Pin window</span><span class="tasks-setting-hint">Keep Banana Tasks visible above other windows.</span></span>
          <input id="tasks-pin-${instanceID}" class="tasks-setting-checkbox" type="checkbox" data-preference="pinned" data-focus-key="preference:pinned"${preferences.pinned ? ' checked' : ''}${pinDisabled ? ' aria-disabled="true"' : ''}>
        </label>
      </section>
      <section class="tasks-settings-section tasks-ripening-section">
        <div class="tasks-setting-copy"><h2 class="tasks-setting-title">Ripening pace</h2><p class="tasks-setting-hint">Choose how quickly inactivity moves an active task through its ripeness states.</p></div>
        <fieldset class="tasks-settings-segments" aria-label="Ripening pace" data-radio-group="ripeningSpeed">
          ${radioOption('ripeningSpeed', 'gentle', 'Gentle', preferences.ripeningSpeed === 'gentle', ripeningDisabled, 'ripening:gentle')}
          ${radioOption('ripeningSpeed', 'normal', 'Normal', preferences.ripeningSpeed === 'normal', ripeningDisabled, 'ripening:normal')}
          ${radioOption('ripeningSpeed', 'lively', 'Lively', preferences.ripeningSpeed === 'lively', ripeningDisabled, 'ripening:lively')}
        </fieldset>
      </section>
    </div>`;
  }

  function themesPanel(ready: Extract<TasksState, { kind: 'ready' }>): string {
    const selectedID = ready.preferences.appearanceTheme === null ? SYSTEM_THEME : resolveThemeID(ready.preferences.appearanceTheme);
    const disabled = !preferenceReady() || pending.has('preference:appearanceTheme');
    const selectedName = selectedID === SYSTEM_THEME ? 'Follow macOS' : themeByID(selectedID)?.name ?? 'Follow macOS';
    const systemSelected = selectedID === SYSTEM_THEME;
    const systemChoice = `<button class="tasks-system-theme-choice${systemSelected ? ' is-selected' : ''}" type="button" role="radio" aria-checked="${systemSelected}" aria-label="Follow macOS appearance" data-theme-id="${SYSTEM_THEME}" data-focus-key="theme:${SYSTEM_THEME}"${disabled ? ' aria-disabled="true"' : ''}><span>Follow macOS</span>${systemSelected ? '<span class="tasks-system-theme-check" aria-hidden="true">✓</span>' : ''}</button>`;
    const paletteCards = themes.map(theme => themeCard(theme.id, theme.name, theme.appearance, selectedID, disabled, theme.colors)).join('');
    return `<div class="tasks-theme-panel" role="radiogroup" aria-label="Appearance theme">
      <div class="tasks-theme-heading"><h2>32 themes</h2>${systemChoice}<span class="tasks-theme-selected" aria-live="polite">${escapeHTML(selectedName)} selected</span></div>
      <div class="tasks-theme-grid quiet-scroll" data-scroll-key="themes">${paletteCards}</div>
    </div>`;
  }

  function todoistPanel(ready: Extract<TasksState, { kind: 'ready' }>): string {
    const native = options.environment === 'native';
    const connected = ready.todoistConnection.kind === 'connected';
    const projectID = ready.todoistConnection.kind === 'connected' ? ready.todoistConnection.projectID : null;
    const todoistBusy = [...pending].some(key => key.startsWith('todoist:'));
    const status = !native ? 'Unavailable' : connected ? (projectID ? 'Connected' : 'Choose a project') : 'Not connected';
    let disclosure = 'Connections are available only in the native macOS app. Browser preview cannot connect accounts.';
    let tokenForm = '';
    let projectBlock = '';
    let actions = '';
    if (native && !connected) {
      const formID = `todoist-token-form-${instanceID}`;
      disclosure = 'Choose one Todoist project. Only linked tasks from it are imported. Completion and restore changes queue durably and sync when Todoist is reachable. Effort, history, and local tasks stay on this Mac.';
      tokenForm = `<form id="${formID}" class="tasks-token-form" data-form="todoist-connect" autocomplete="off">
        <label class="tasks-field-label" for="todoist-token-${instanceID}">API token</label>
        <div class="tasks-token-control"><input id="todoist-token-${instanceID}" class="tasks-text-input" type="${showToken ? 'text' : 'password'}" name="todoist-api-token" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="4096" aria-label="Todoist API token" data-token-field data-focus-key="todoist-token"${todoistBusy ? ' aria-disabled="true"' : ''}><button class="tasks-quiet-button" type="button" data-action="toggle-token" data-focus-key="token-visibility" aria-label="${showToken ? 'Hide' : 'Show'} API token" aria-pressed="${showToken}"${todoistBusy ? ' aria-disabled="true"' : ''}>${showToken ? 'Hide' : 'Show'}</button></div>
        <button class="tasks-visually-hidden" type="submit" tabindex="-1" aria-hidden="true">Connect Todoist</button>
      </form>`;
      projectBlock = `<div class="tasks-project-row"><label class="tasks-field-label" for="todoist-project-${instanceID}">Capture project</label><select id="todoist-project-${instanceID}" class="tasks-settings-select" aria-label="Capture project" disabled><option>Connect to choose a project</option></select></div>`;
      actions = `<div class="tasks-connected-actions"><button class="tasks-secondary-button" type="button" disabled>Refresh now</button><button class="tasks-primary-button" type="submit" form="${formID}" data-focus-key="todoist-connect"${todoistBusy ? ' aria-disabled="true"' : ''}>${pending.has('todoist:connect') ? 'Connecting…' : 'Connect Todoist'}</button></div>`;
    } else if (native) {
      const projects = ready.captureProjects;
      const selectedProjectExists = projectID !== null && projects.some(project => project.id === projectID);
      const optionsHTML = `${projectID && !selectedProjectExists ? `<option value="${escapeHTML(projectID)}" selected>${escapeHTML(projectName(projects, projectID))}</option>` : ''}<option value=""${projectID === null ? ' selected' : ''} disabled>${projects.length ? 'Choose a project' : projectID ? 'Selected project' : 'Load projects to choose'}</option>${projects.map(project => `<option value="${escapeHTML(project.id)}"${project.id === projectID ? ' selected' : ''}>${escapeHTML(project.name)}</option>`).join('')}`;
      disclosure = 'Only the selected project is imported. Completion and restore changes for linked tasks queue durably and sync when Todoist is reachable. Effort, history, and local tasks stay on this Mac.';
      projectBlock = `<div class="tasks-project-row"><label class="tasks-field-label" for="todoist-project-${instanceID}">Capture project</label><select id="todoist-project-${instanceID}" class="tasks-settings-select" aria-label="Capture project" data-project-select data-focus-key="todoist-project"${!projects.length ? ' disabled' : ''}${todoistBusy ? ' aria-disabled="true"' : ''}>${optionsHTML}</select></div>`;
      actions = `<div class="tasks-connected-actions"><button class="tasks-secondary-button" type="button" data-action="load-projects" data-focus-key="todoist-load-projects"${todoistBusy ? ' aria-disabled="true"' : ''}>${pending.has('todoist:projects') ? 'Loading…' : 'Load projects'}</button><button class="tasks-primary-button" type="button" data-action="refresh-todoist" data-focus-key="todoist-refresh"${!projectID ? ' disabled' : ''}${todoistBusy ? ' aria-disabled="true"' : ''}>${pending.has('todoist:refresh') ? 'Refreshing…' : 'Refresh now'}</button><button class="tasks-text-button" type="button" data-action="disconnect-todoist" data-focus-key="todoist-disconnect"${todoistBusy ? ' aria-disabled="true"' : ''}>${pending.has('todoist:disconnect') ? 'Disconnecting…' : 'Disconnect'}</button></div>`;
    }
    return `<section class="tasks-connection-intro">
      <div class="tasks-settings-section-heading"><h2>Todoist</h2><span class="tasks-settings-status">${status}</span></div>
      <p class="tasks-section-description">${escapeHTML(disclosure)}</p>
    </section>${tokenForm}<div class="tasks-project-block">${projectBlock}</div>${actions}`;
  }

  function calendarPanel(ready: Extract<TasksState, { kind: 'ready' }>): string {
    const native = options.environment === 'native';
    const authorization = ready.calendar.authorization;
    const pendingAccess = pending.has('calendar:access');
    const status = authorization === 'authorized' ? 'Access allowed' : authorization === 'denied' ? 'Access denied' : authorization === 'unavailable' || !native ? 'Unavailable' : 'Not requested';
    let controls = '';
    if (!native) {
      controls = '<p class="tasks-setting-hint">Calendar permission is available only in the native macOS app.</p>';
    } else if (authorization === 'notDetermined') {
      controls = `<button class="tasks-primary-button" type="button" data-action="calendar-access" data-focus-key="calendar-access"${pendingAccess ? ' aria-disabled="true"' : ''}>${pendingAccess ? 'Requesting…' : 'Allow Calendar access'}</button>`;
    } else if (authorization === 'denied') {
      controls = '<p class="tasks-setting-hint">Allow access in System Settings → Privacy &amp; Security → Calendars.</p>';
    } else if (authorization === 'unavailable') {
      controls = '<p class="tasks-setting-hint">Calendar access is not available on this Mac.</p>';
    } else {
      controls = '<p class="tasks-setting-hint">Access allowed. Planning is on the Calendar screen.</p>';
    }
    return `<section class="tasks-settings-section tasks-calendar-section">
      <div class="tasks-settings-section-heading"><h2>Apple Calendar</h2><span class="tasks-settings-status">${status}</span></div>
      <p class="tasks-section-description">Uses calendars already connected to macOS Calendar.</p>
      <div class="tasks-calendar-actions">${controls}</div>
    </section>`;
  }

  function connectionsPanel(ready: Extract<TasksState, { kind: 'ready' }>): string {
    const integrationBusy = [...pending].some(key => key.startsWith('todoist:') || key.startsWith('calendar:'));
    const fault = notice?.kind === 'error' ? null : integrationFaultMessage(ready);
    return `<div class="tasks-settings-scroll tasks-connections-panel quiet-scroll" data-scroll-key="connections"${integrationBusy ? ' aria-busy="true"' : ''}>
      ${fault ? `<p class="tasks-integration-fault" role="alert">${escapeHTML(fault)}</p>` : ''}
      ${todoistPanel(ready)}
      ${calendarPanel(ready)}
    </div>`;
  }

  function soundPanel(ready: Extract<TasksState, { kind: 'ready' }>): string {
    const preferences = ready.preferences;
    const motionDisabled = !preferenceReady() || pending.has('preference:motionEnabled');
    const soundDisabled = !preferenceReady() || pending.has('preference:soundEnabled');
    const motionAllowed = preferences.motionEnabled;
    return `<div class="tasks-settings-scroll tasks-sound-panel quiet-scroll" data-scroll-key="sound">
      <section class="tasks-settings-section tasks-sound-section">
        <div class="tasks-settings-section-heading"><h2>Completion motion</h2><span class="tasks-settings-status">One short moment</span></div>
        <p class="tasks-section-description">A quick mark-and-spark. No loops, flashing, or scorekeeping.</p>
        <div class="tasks-motion-controls">
          <fieldset class="tasks-settings-segments" aria-label="Completion motion" data-radio-group="motionEnabled">
            ${radioOption('motionEnabled', 'follow', 'Follow macOS', motionAllowed, motionDisabled, 'motion:follow')}
            ${radioOption('motionEnabled', 'reduce', 'Reduce motion', !motionAllowed, motionDisabled, 'motion:reduce')}
          </fieldset>
          <button class="tasks-secondary-button tasks-preview-motion" type="button" data-action="preview-motion" data-focus-key="preview-motion">Preview once</button>
        </div>
        <p class="tasks-setting-hint tasks-motion-explanation">Follow macOS respects the Reduce Motion setting. Choose Reduce motion to keep the finish still.</p>
        <div class="tasks-motion-sample" aria-hidden="true">
          <div class="tasks-motion-mark"><img src="tasks-brand/mark.svg" alt=""><svg class="tasks-motion-spark" viewBox="0 0 18 18" aria-hidden="true"><path d="M9 .8 10.8 7.2 17.2 9l-6.4 1.8L9 17.2l-1.8-6.4L.8 9l6.4-1.8L9 .8Z" fill="var(--accent)" /></svg></div>
          <div class="tasks-motion-copy"><span class="tasks-setting-title">One quick snap, then still</span><span class="tasks-setting-hint">Reduced motion keeps this same finish without movement.</span></div>
          <span class="tasks-motion-once">Once</span>
        </div>
      </section>
      <section class="tasks-settings-section tasks-sound-section">
        <div class="tasks-settings-section-heading"><h2>Completion sound</h2><span class="tasks-settings-status">${preferences.soundEnabled ? 'On' : 'Off'}</span></div>
        <p class="tasks-section-description">Optional short chime after a task is done. Nothing plays automatically in this panel.</p>
        <div class="tasks-setting-row tasks-sound-row">
          <span class="tasks-setting-copy"><span class="tasks-setting-title">Play a chime when a task is completed</span><span class="tasks-setting-hint">Off by default. Preview only plays when pressed.</span></span>
          <button class="tasks-secondary-button tasks-preview-sound" type="button" data-action="preview-sound" data-focus-key="preview-sound"${pending.has('sound:preview') ? ' aria-disabled="true"' : ''}>${pending.has('sound:preview') ? 'Playing…' : 'Preview chime'}</button>
          <button class="tasks-toggle" type="button" role="switch" aria-checked="${preferences.soundEnabled}" aria-label="Play a chime when a task is completed" data-preference="soundEnabled" data-focus-key="preference:soundEnabled"${soundDisabled ? ' aria-disabled="true"' : ''}><span class="tasks-toggle-thumb"></span></button>
        </div>
      </section>
    </div>`;
  }

  function panelContent(): string {
    const ready = isReady(state) ? state : null;
    const activeThemeID = ready?.preferences.appearanceTheme === null || !ready
      ? SYSTEM_THEME : resolveThemeID(ready.preferences.appearanceTheme);
    const logo = activeThemeID === SYSTEM_THEME
      ? '<picture><source media="(prefers-color-scheme: dark)" srcset="tasks-brand/logo-dark.svg"><img class="tasks-settings-logo" src="tasks-brand/logo.svg" alt="banana tasks"></picture>'
      : `<img class="tasks-settings-logo" src="tasks-brand/${themeByID(activeThemeID)?.appearance === 'dark' ? 'logo-dark.svg' : 'logo.svg'}" alt="banana tasks">`;
    const title = activeTab === 'Themes' ? 'Appearance' : activeTab;
    const subtitle = activeTab === 'Themes' ? 'A separate theme for Banana Tasks. Notes stays as it is.'
      : activeTab === 'Connections' ? 'Optional. Your task list works without them.'
        : activeTab === 'Sound & motion' ? 'A small finish, always on your terms.' : '';
    const body = renderNotice() + (ready
      ? activeTab === 'Themes' ? themesPanel(ready)
        : activeTab === 'Connections' ? connectionsPanel(ready)
          : activeTab === 'Sound & motion' ? soundPanel(ready) : generalPanel(ready)
      : `<div class="tasks-settings-unavailable" role="${state.kind === 'recovery' || state.kind === 'disposed' ? 'alert' : 'status'}" aria-live="${state.kind === 'recovery' || state.kind === 'disposed' ? 'assertive' : 'polite'}">${escapeHTML(stateError(state) ?? 'Settings are unavailable.')}</div>`);
    const footer: readonly [string, string] = activeTab === 'Themes' ? ['Tasks theme only · Saved on this Mac', '32 themes + system']
      : activeTab === 'Connections' ? ['Your tasks stay on this Mac. No Tasks server.', 'Optional']
        : activeTab === 'Sound & motion' ? ['Preferences apply to Banana Tasks only. Notes stays unchanged.', '']
          : ['Preferences apply to Banana Tasks only.', 'Saved on this Mac'];
    const footerText = footer[1] ? `<span class="tasks-settings-footer-detail">${footer[1]}</span>` : '';
    return `<div class="tasks-settings" data-motion-enabled="${ready?.preferences.motionEnabled ?? true}">
      <header class="tasks-settings-toolbar">${logo}<span class="tasks-toolbar-spacer" data-tasks-drag-region="true" aria-hidden="true"></span><button class="tasks-done-button" type="button" data-action="close" data-focus-key="close">Done</button></header>
      <div class="tasks-settings-title${activeTab === 'General' ? ' tasks-settings-title-general' : ''}"><div><h1 id="${panelID}-title">${title}</h1>${subtitle ? `<p>${subtitle}</p>` : ''}</div></div>
      <nav id="${tabsID}" class="tasks-settings-tabs" role="tablist" aria-label="Settings sections" aria-orientation="horizontal">
        ${tabs.map((tab, index) => `<button id="${panelID}-tab-${index}" class="tasks-settings-tab" type="button" role="tab" aria-selected="${activeTab === tab}" aria-controls="${panelID}" tabindex="${activeTab === tab ? 0 : -1}" data-tab="${tab}" data-focus-key="tab:${tab}">${tab}</button>`).join('')}
      </nav>
      <section id="${panelID}" class="tasks-settings-content" role="tabpanel" aria-labelledby="${panelID}-tab-${tabs.indexOf(activeTab)}" tabindex="0">${body}</section>
      <footer class="tasks-settings-footer"><span>${footer[0]}</span><span class="tasks-toolbar-spacer"></span>${footerText}</footer>
    </div>`;
  }

  function render(): void {
    if (disposed) return;
    rendering = true;
    try {
      const document = root.ownerDocument;
      const active = document.activeElement as HTMLElement | null;
      const focusKey = active && root.contains(active) ? active.dataset.focusKey : undefined;
      const selection = active && 'selectionStart' in active && 'selectionEnd' in active
        ? [(active as HTMLInputElement).selectionStart, (active as HTMLInputElement).selectionEnd] as const : null;
      const scrollPositions = new Map<string, number>();
      root.querySelectorAll<HTMLElement>('[data-scroll-key]').forEach(element => {
        if (element.dataset.scrollKey) scrollPositions.set(element.dataset.scrollKey, element.scrollTop);
      });
      removeThemeKeyboard?.(); removeThemeKeyboard = null;
      root.innerHTML = panelContent();
      const tokenInput = root.querySelector<HTMLInputElement>('[data-token-field]');
      if (tokenInput) tokenInput.value = tokenDraft;
      root.querySelectorAll<HTMLElement>('[data-scroll-key]').forEach(element => {
        const key = element.dataset.scrollKey;
        if (key && scrollPositions.has(key)) element.scrollTop = scrollPositions.get(key)!;
      });
      const themeGroup = root.querySelector<HTMLElement>('.tasks-theme-panel');
      const grid = root.querySelector<HTMLElement>('.tasks-theme-grid');
      if (themeGroup && grid && isReady(state)) {
        const selectedID = state.preferences.appearanceTheme === null ? SYSTEM_THEME : resolveThemeID(state.preferences.appearanceTheme);
        updateThemeGridTabStop(themeGroup, selectedID);
        const removeGridKeyboard = installThemeGridKeyboard(grid, () => 4);
        const removeSystemKeyboard = installSystemThemeKeyboard(themeGroup, grid);
        removeThemeKeyboard = () => { removeGridKeyboard(); removeSystemKeyboard(); };
      }
      if (focusKey) {
        const nextFocus = [...root.querySelectorAll<HTMLElement>('[data-focus-key]')].find(element => element.dataset.focusKey === focusKey);
        if (nextFocus && !nextFocus.hasAttribute('disabled')) {
          try { nextFocus.focus({ preventScroll: true }); } catch { nextFocus.focus(); }
          const view = document.defaultView;
          if (selection && view && nextFocus instanceof view.HTMLInputElement) {
            const input = nextFocus;
            if (input.type === 'password' || input.type === 'text') {
              try { input.setSelectionRange(selection[0], selection[1]); } catch { /* The control may not support a selection range. */ }
            }
          }
        }
      }
    } finally {
      rendering = false;
    }
  }

  function requestRecording(recording: boolean): Promise<void> {
    const port = options.hotkeyPreferences;
    if (!port) return Promise.resolve();
    try { return port.setRecording(recording); }
    catch (error) { return Promise.reject(error); }
  }

  function isCapturePhase(phase: HotkeyRecorderPhase = hotkeyPhase): phase is Extract<HotkeyRecorderPhase, { kind: 'capture-start' | 'recording' }> {
    return phase.kind === 'capture-start' || phase.kind === 'recording';
  }

  async function startHotkeyRecording(): Promise<void> {
    const port = options.hotkeyPreferences;
    const current = hotkeyPhase;
    if (!port || current.kind !== 'ready' || current.issue === 'confirmation' || !current.confirmed.available || current.confirmed.error === 'verification-profile') return;
    const generation = ++recorderGeneration;
    const confirmed = current.confirmed;
    hotkeyPhase = { kind: 'capture-start', confirmed, generation };
    render();
    root.querySelector<HTMLButtonElement>('[data-action="record-hotkey"]')?.focus({ preventScroll: true });
    try {
      await requestRecording(true);
    } catch {
      if (!disposed && hotkeyPhase.kind === 'capture-start' && hotkeyPhase.generation === generation) {
        void endHotkeyRecording({ kind: 'cancel', issue: 'recording' });
      }
      return;
    }
    if (disposed || hotkeyPhase.kind !== 'capture-start' || hotkeyPhase.generation !== generation) return;
    hotkeyPhase = { kind: 'recording', confirmed, generation };
    render();
  }

  async function applyHotkeyShortcut(generation: number, confirmed: TasksHotkeyState, shortcut: RecordedShortcut): Promise<void> {
    const port = options.hotkeyPreferences;
    if (!port) return;
    try {
      const next = await port.set(shortcut);
      if (disposed || hotkeyPhase.kind !== 'applying' || hotkeyPhase.generation !== generation) return;
      hotkeyPhase = { kind: 'ready', confirmed: next };
    } catch {
      if (disposed || hotkeyPhase.kind !== 'applying' || hotkeyPhase.generation !== generation) return;
      hotkeyPhase = { kind: 'ready', confirmed, issue: 'confirmation' };
    }
    render();
  }

  async function endHotkeyRecording(intent: { kind: 'cancel'; issue?: 'recording' } | { kind: 'save'; shortcut: RecordedShortcut }): Promise<void> {
    const current = hotkeyPhase;
    if (!isCapturePhase(current)) return;
    const port = options.hotkeyPreferences;
    if (!port) return;
    const generation = ++recorderGeneration;
    const confirmed = current.confirmed;
    hotkeyPhase = intent.kind === 'cancel'
      ? { kind: 'end-cancel', confirmed, generation, issue: intent.issue }
      : { kind: 'end-save', confirmed, generation, shortcut: intent.shortcut };
    const release = requestRecording(false);
    render();
    try {
      await release;
    } catch {
      if (!disposed && recorderGeneration === generation &&
          (hotkeyPhase.kind === 'end-cancel' || hotkeyPhase.kind === 'end-save') && hotkeyPhase.generation === generation) {
        hotkeyPhase = { kind: 'ready', confirmed, issue: 'recording' };
        render();
      }
      return;
    }
    if (disposed || recorderGeneration !== generation) return;
    if (intent.kind === 'cancel') {
      if (hotkeyPhase.kind === 'end-cancel' && hotkeyPhase.generation === generation) {
        hotkeyPhase = { kind: 'ready', confirmed, issue: intent.issue };
        render();
      }
      return;
    }
    if (hotkeyPhase.kind !== 'end-save' || hotkeyPhase.generation !== generation) return;
    hotkeyPhase = { kind: 'applying', confirmed, generation, shortcut: intent.shortcut };
    render();
    await applyHotkeyShortcut(generation, confirmed, intent.shortcut);
  }

  async function resetHotkey(): Promise<void> {
    const port = options.hotkeyPreferences;
    const current = hotkeyPhase;
    if (!port || current.kind !== 'ready' || current.issue === 'confirmation' || !current.confirmed.available || current.confirmed.error === 'verification-profile') return;
    const generation = ++recorderGeneration;
    const confirmed = current.confirmed;
    hotkeyPhase = { kind: 'resetting', confirmed, generation };
    render();
    try {
      const next = await port.reset();
      if (disposed || hotkeyPhase.kind !== 'resetting' || hotkeyPhase.generation !== generation) return;
      hotkeyPhase = { kind: 'ready', confirmed: next };
    } catch {
      if (disposed || hotkeyPhase.kind !== 'resetting' || hotkeyPhase.generation !== generation) return;
      hotkeyPhase = { kind: 'ready', confirmed, issue: 'confirmation' };
    }
    render();
  }

  async function loadHotkeyPreferences(): Promise<void> {
    const port = options.hotkeyPreferences;
    if (!port) return;
    try {
      const confirmed = await port.load();
      if (!disposed) hotkeyPhase = { kind: 'ready', confirmed };
    } catch {
      if (!disposed) hotkeyPhase = { kind: 'load-failed' };
    } finally {
      if (!disposed) render();
    }
  }

  async function savePreference(key: keyof TasksPreferences, value: TasksPreferences[keyof TasksPreferences]): Promise<void> {
    const pendingKey = `preference:${key}`;
    if (!preferenceReady() || pending.has(pendingKey)) { render(); return; }
    pending.add(pendingKey); notice = null; render();
    try {
      const outcome = await facade.updatePreferences({ [key]: value });
      if (outcome.kind !== 'applied') setNotice('Could not save that preference. The last confirmed value remains selected.', 'error');
    } catch {
      setNotice('Could not save that preference. The last confirmed value remains selected.', 'error');
    } finally {
      pending.delete(pendingKey); render();
    }
  }

  async function runCommand<T>(key: string, operation: string, command: () => Promise<CommandOutcome<T>>, success: (value: T) => string): Promise<void> {
    if (pending.has(key)) { render(); return; }
    pending.add(key); notice = null; render();
    try {
      const outcome = await command();
      if (outcome.kind === 'applied') setNotice(success(outcome.value), 'status');
      else setNotice(safeCommandFailure(outcome, operation), 'error');
    } catch {
      setNotice(safeCommandFailure({ kind: 'failed', error: { operation, message: '' } }, operation), 'error');
    } finally {
      pending.delete(key); render();
    }
  }

  function handleClick(event: MouseEvent): void {
    const view = root.ownerDocument.defaultView;
    const target = event.target;
    if (!view || !(target instanceof view.Element)) return;
    const button = target.closest<HTMLButtonElement>('button');
    if (!button || !root.contains(button)) return;
    if (button.dataset.preference === 'soundEnabled') {
      void savePreference('soundEnabled', !(isReady(state) && state.preferences.soundEnabled)); return;
    }
    const action = button.dataset.action;
    if (action === 'record-hotkey') {
      if (hotkeyPhase.kind === 'recording') void endHotkeyRecording({ kind: 'cancel' });
      else void startHotkeyRecording();
      return;
    }
    if (action === 'reset-hotkey') { void resetHotkey(); return; }
    if (action === 'close') { options.onClose(); return; }
    const tab = button.dataset.tab as SettingsTab | undefined;
    if (tab && tabs.includes(tab)) { activeTab = tab; render(); return; }
    const themeID = button.dataset.themeId;
    if (themeID) {
      if (themeID === SYSTEM_THEME || themes.some(theme => theme.id === themeID)) {
        void savePreference('appearanceTheme', themeID === SYSTEM_THEME ? null : themeID);
      }
      return;
    }
    if (action === 'toggle-token') {
      if (pending.has('todoist:connect')) return;
      showToken = !showToken; render(); return;
    }
    if (action === 'load-projects') {
      void runCommand('todoist:projects', 'todoist-projects', () => facade.loadTodoistProjects(), projects => `${projects.length} Todoist project${projects.length === 1 ? '' : 's'} loaded.`); return;
    }
    if (action === 'refresh-todoist') {
      void runCommand('todoist:refresh', 'todoist-refresh', () => facade.syncTodoist(), result => `Refresh complete. ${result.imported} task${result.imported === 1 ? '' : 's'} imported; ${result.pendingWritebacks} completion update${result.pendingWritebacks === 1 ? '' : 's'} pending.`); return;
    }
    if (action === 'disconnect-todoist') {
      void runCommand('todoist:disconnect', 'todoist-disconnect', () => facade.disconnectTodoist(), () => 'Todoist disconnected. Local tasks were kept.'); return;
    }
    if (action === 'calendar-access') {
      void runCommand('calendar:access', 'calendar-access', () => facade.requestCalendarAccess(), authorization => authorization === 'authorized'
        ? 'Calendar access allowed. Planning is available on the Calendar screen.'
        : authorization === 'denied' ? 'Calendar access was denied. Allow access in System Settings → Privacy & Security → Calendars.'
          : 'Calendar access is unavailable on this Mac.'); return;
    }
    if (action === 'preview-sound') {
      void runCommand('sound:preview', 'sound-preview', async () => {
        // Load the sound adapter only after the user explicitly asks to hear a preview.
        const { playCompletionSound } = await import('./feedback');
        await playCompletionSound();
        return { kind: 'applied', value: undefined } as const;
      }, () => 'Chime preview played.'); return;
    }
    if (action === 'preview-motion') {
      const sample = root.querySelector<HTMLElement>('.tasks-motion-sample');
      if (!sample) return;
      sample.classList.remove('is-playing');
      void sample.offsetWidth;
      const ready = isReady(state) ? state : null;
      const reducedByOS = root.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;
      const motionAllowed = ready?.preferences.motionEnabled ?? false;
      if (motionAllowed && !reducedByOS) sample.classList.add('is-playing');
      options.notify(motionAllowed && !reducedByOS ? 'Completion motion preview played once.' : 'Completion preview shown without movement.', 'status');
    }
  }

  function handleSubmit(event: SubmitEvent): void {
    const view = root.ownerDocument.defaultView;
    const target = event.target;
    if (!view || !(target instanceof view.HTMLFormElement) || target.dataset.form !== 'todoist-connect') return;
    event.preventDefault();
    if (options.environment !== 'native' || !isReady(state) || state.todoistConnection.kind === 'connected' || pending.has('todoist:connect')) return;
    const input = target.querySelector<HTMLInputElement>('[data-token-field]');
    const submittedToken = input?.value ?? '';
    if (!submittedToken.trim()) {
      setNotice('Enter a Todoist API token before connecting.', 'error');
      return;
    }
    tokenDraft = '';
    if (input) input.value = '';
    void runCommand('todoist:connect', 'todoist-connect', () => facade.connectTodoist(submittedToken.trim()), () => 'Connected to Todoist. Load projects and choose one to import.');
  }

  function handleInput(event: Event): void {
    const view = root.ownerDocument.defaultView;
    const target = event.target;
    if (!view || !(target instanceof view.HTMLInputElement) || !target.matches('[data-token-field]')) return;
    if (pending.has('todoist:connect')) { render(); return; }
    tokenDraft = target.value;
  }

  function handleChange(event: Event): void {
    const view = root.ownerDocument.defaultView;
    const target = event.target;
    if (!view || !(target instanceof view.HTMLElement)) return;
    if (target.matches('[data-preference="pinned"]')) {
      void savePreference('pinned', (target as HTMLInputElement).checked); return;
    }
    if (target.matches('[data-preference="soundEnabled"]')) {
      void savePreference('soundEnabled', !(isReady(state) && state.preferences.soundEnabled)); return;
    }
    if (target.matches('[data-preference-radio="motionEnabled"]')) {
      void savePreference('motionEnabled', (target as HTMLInputElement).value === 'follow'); return;
    }
    if (target.matches('[data-preference-radio="ripeningSpeed"]')) {
      const speed = (target as HTMLInputElement).value;
      if (speed === 'gentle' || speed === 'normal' || speed === 'lively') void savePreference('ripeningSpeed', speed);
      return;
    }
    if (target.matches('[data-project-select]')) {
      const projectID = (target as HTMLSelectElement).value;
      if (projectID) void runCommand('todoist:project', 'todoist-project', () => facade.selectTodoistProject(projectID), () => 'Capture project saved. Refresh imports tasks from this project.');
    }
  }

  function handleHotkeyKeyDown(event: KeyboardEvent): void {
    const phase = hotkeyPhase;
    if (!isCapturePhase(phase)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      void endHotkeyRecording({ kind: 'cancel' });
      return;
    }
    if (phase.kind !== 'recording' || event.isComposing) return;
    if (['Meta', 'Control', 'Alt', 'Shift'].includes(event.key) || event.repeat) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const result = shortcutFromKeyEvent({
      code: event.code, metaKey: event.metaKey, shiftKey: event.shiftKey,
      altKey: event.altKey, ctrlKey: event.ctrlKey,
    });
    if (result.ok) {
      void endHotkeyRecording({ kind: 'save', shortcut: result.shortcut });
    } else {
      hotkeyPhase = { ...phase, captureIssue: result.reason };
      render();
    }
  }

  function cancelHotkeyCapture(): void {
    if (isCapturePhase()) void endHotkeyRecording({ kind: 'cancel' });
  }

  function handleHotkeyFocusOut(event: FocusEvent): void {
    if (rendering || !isCapturePhase()) return;
    const view = root.ownerDocument.defaultView;
    if (!view || !(event.target instanceof view.Element) || !event.target.closest('[data-action="record-hotkey"]')) return;
    const next = event.relatedTarget;
    if (next instanceof view.Element && next.closest('[data-action="record-hotkey"]')) return;
    cancelHotkeyCapture();
  }

  function handleWindowBlur(): void { cancelHotkeyCapture(); }

  function handleVisibilityChange(): void {
    if (root.ownerDocument.visibilityState === 'hidden') cancelHotkeyCapture();
  }

  function handleKeyDown(event: KeyboardEvent): void {
    const view = root.ownerDocument.defaultView;
    const target = event.target;
    if (!view || !(target instanceof view.Element)) return;
    if (event.key === 'Escape') {
      event.preventDefault(); options.onClose(); return;
    }
    const current = target.closest<HTMLButtonElement>('[role="tab"]');
    if (!current || !root.contains(current) || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabButtons = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const index = tabButtons.indexOf(current);
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabButtons.length - 1
      : event.key === 'ArrowRight' ? (index + 1) % tabButtons.length : (index - 1 + tabButtons.length) % tabButtons.length;
    event.preventDefault(); tabButtons[nextIndex].focus(); tabButtons[nextIndex].click();
  }

  function handleAnimationEnd(event: AnimationEvent): void {
    const view = root.ownerDocument.defaultView;
    const target = event.target;
    if (view && target instanceof view.HTMLElement && target.classList.contains('tasks-motion-sample')) target.classList.remove('is-playing');
  }

  function handleRadioGroupKeyDown(event: KeyboardEvent): void {
    const view = root.ownerDocument.defaultView;
    const target = event.target;
    if (!view || !(target instanceof view.HTMLInputElement) || !target.matches('[data-preference-radio]')) return;
    const input = target as HTMLInputElement;
    const group = input.closest<HTMLElement>('[data-radio-group]');
    if (!group || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const radios = [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]:not(:disabled)')];
    const index = radios.indexOf(input); if (index < 0 || radios.length < 2) return;
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    let nextIndex = index;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = radios.length - 1;
    else if (forward) nextIndex = (index + 1) % radios.length;
    else if (backward) nextIndex = (index - 1 + radios.length) % radios.length;
    if (nextIndex !== index) {
      event.preventDefault(); radios[nextIndex].focus(); radios[nextIndex].click();
    }
  }

  const unsubscribe = facade.subscribe(next => {
    const wasConnected = isReady(state) && state.todoistConnection.kind === 'connected';
    const isConnected = isReady(next) && next.todoistConnection.kind === 'connected';
    if ((!wasConnected && isConnected) || next.kind !== 'ready') { tokenDraft = ''; showToken = false; }
    state = next; render();
  });
  root.addEventListener('click', handleClick);
  root.addEventListener('submit', handleSubmit);
  root.addEventListener('input', handleInput);
  root.addEventListener('change', handleChange);
  root.addEventListener('keydown', handleHotkeyKeyDown, true);
  root.addEventListener('focusout', handleHotkeyFocusOut, true);
  root.addEventListener('keydown', handleKeyDown);
  root.addEventListener('keydown', handleRadioGroupKeyDown);
  root.addEventListener('animationend', handleAnimationEnd);
  root.ownerDocument.defaultView?.addEventListener('blur', handleWindowBlur);
  root.ownerDocument.addEventListener('visibilitychange', handleVisibilityChange);
  render();
  void loadHotkeyPreferences();

  return {
    onWindowBlur(): void { cancelHotkeyCapture(); },
    dispose(): void {
      if (disposed) return;
      const releaseCapture = isCapturePhase();
      disposed = true;
      recorderGeneration++;
      if (releaseCapture) void requestRecording(false).catch(() => undefined);
      unsubscribe();
      removeThemeKeyboard?.(); removeThemeKeyboard = null;
      root.removeEventListener('click', handleClick);
      root.removeEventListener('submit', handleSubmit);
      root.removeEventListener('input', handleInput);
      root.removeEventListener('change', handleChange);
      root.removeEventListener('keydown', handleHotkeyKeyDown, true);
      root.removeEventListener('focusout', handleHotkeyFocusOut, true);
      root.removeEventListener('keydown', handleKeyDown);
      root.removeEventListener('keydown', handleRadioGroupKeyDown);
      root.removeEventListener('animationend', handleAnimationEnd);
      root.ownerDocument.defaultView?.removeEventListener('blur', handleWindowBlur);
      root.ownerDocument.removeEventListener('visibilitychange', handleVisibilityChange);
      tokenDraft = '';
      root.replaceChildren();
    },
  };
}
