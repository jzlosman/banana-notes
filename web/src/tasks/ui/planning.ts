import './planning.css';
import { resolveThemeID, themeByID } from '../../domain/themes';
import type { TasksFacade } from '../application/controller';
import type { CalendarAppointment, CalendarAuthorization, CalendarBlockReceipt, PlanningCalendar } from '../application/ports';
import type { TaskReadModel } from '../domain/queries';
import type { MountedTasksScreen, TasksScreenOptions } from './contracts';

type CalendarDayData = {
  authorization: CalendarAuthorization;
  calendars: PlanningCalendar[];
  appointments: CalendarAppointment[];
};

type LocalDayRange = { start: number; end: number };

function localDate(year: number, monthIndex: number, day: number, hour = 0, minute = 0): Date {
  const date = new Date(0);
  date.setFullYear(year, monthIndex, day);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function dateFromInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = localDate(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
}

function dateInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localDayRange(date: Date): LocalDayRange {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  return {
    start: localDate(year, month, day).getTime(),
    end: localDate(year, month, day + 1).getTime(),
  };
}

function addLocalDays(date: Date, amount: number): Date {
  return localDate(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

function formatLongDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date);
}

function formatAppointmentTime(appointment: CalendarAppointment, dayRange: LocalDayRange): { lane: string; detail: string } {
  if (appointment.allDay) {
    const notes = [
      appointment.start < dayRange.start ? 'Continues from the previous day' : '',
      appointment.end > dayRange.end ? 'Continues into the next day' : '',
    ].filter(Boolean);
    return { lane: 'All day', detail: notes.join(' · ') || 'All day' };
  }

  const startsEarlier = appointment.start < dayRange.start;
  const endsLater = appointment.end > dayRange.end;
  const start = formatTime(new Date(appointment.start));
  const end = formatTime(new Date(appointment.end));
  if (startsEarlier && endsLater) return { lane: 'Overnight', detail: 'Continues from the previous day · Ends the next day' };
  if (startsEarlier) return { lane: 'Overnight', detail: `Continues from the previous day · Ends at ${end}` };
  if (endsLater) return { lane: start, detail: `${start} · Continues into the next day at ${end}` };
  return { lane: start, detail: `${start}–${end}` };
}

function iconButton(document: Document, label: string, direction: 'previous' | 'next'): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'planning-icon-button';
  button.setAttribute('aria-label', label);
  button.title = label;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', direction === 'previous' ? 'm10 3-5 5 5 5' : 'm6 3 5 5-5 5');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.6');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  button.append(svg);
  return button;
}

function activeTasks(facade: TasksFacade): TaskReadModel[] {
  const result = facade.queryTasks({ mode: 'active' });
  return result.tasks.filter(task => task.status.kind === 'active');
}

function describeOutcome(outcome: Awaited<ReturnType<TasksFacade['loadCalendar']>>): string {
  if (outcome.kind === 'failed') return outcome.error.message;
  if (outcome.kind === 'unavailable') return 'Calendar is unavailable in this environment.';
  if (outcome.kind === 'rejected') return 'Calendar could not be loaded for this day.';
  return 'Calendar could not be loaded for this day.';
}

function receiptDescription(receipt: CalendarBlockReceipt, taskTitle: string, calendarTitle: string, day: Date): string {
  const interval = `${formatTime(new Date(receipt.start))}–${formatTime(new Date(receipt.end))}`;
  return `Task block created for ${taskTitle} on ${formatLongDate(day)} in ${calendarTitle}, ${interval}. Receipt ${receipt.id}.`;
}

export function mountTasksPlanning(root: HTMLElement, facade: TasksFacade, options: TasksScreenOptions): MountedTasksScreen {
  const document = root.ownerDocument;
  const screen = document.createElement('section');
  screen.className = 'tasks-planning';
  screen.setAttribute('aria-label', 'Calendar planning');

  const toolbar = document.createElement('header');
  toolbar.className = 'planning-toolbar';
  const logoPicture = document.createElement('picture');
  const darkLogoSource = document.createElement('source');
  darkLogoSource.media = '(prefers-color-scheme: dark)';
  darkLogoSource.srcset = 'tasks-brand/logo-dark.svg';
  const logo = document.createElement('img');
  logo.className = 'planning-logo';
  logo.src = 'tasks-brand/logo.svg';
  logo.alt = 'banana tasks';
  const spacer = document.createElement('span');
  spacer.className = 'planning-toolbar-spacer';
  spacer.setAttribute('data-tasks-drag-region', 'true');
  spacer.setAttribute('aria-hidden', 'true');
  const doneButton = document.createElement('button');
  doneButton.type = 'button';
  doneButton.className = 'planning-done-button';
  doneButton.textContent = 'Done';
  logoPicture.append(darkLogoSource, logo);
  toolbar.append(logoPicture, spacer, doneButton);

  const heading = document.createElement('header');
  heading.className = 'planning-heading';
  const headingCopy = document.createElement('div');
  const title = document.createElement('h1');
  title.textContent = 'Plan time';
  const subtitle = document.createElement('p');
  subtitle.textContent = 'Appointments and planned task blocks.';
  headingCopy.append(title, subtitle);
  heading.append(headingCopy);

  const dayControls = document.createElement('nav');
  dayControls.className = 'planning-day-controls';
  dayControls.setAttribute('aria-label', 'Choose a day');
  const previousButton = iconButton(document, 'Previous day', 'previous');
  const todayButton = document.createElement('button');
  todayButton.type = 'button';
  todayButton.className = 'planning-small-button planning-today';
  todayButton.textContent = 'Today';
  const nextButton = iconButton(document, 'Next day', 'next');
  const dateLabel = document.createElement('label');
  dateLabel.className = 'planning-date-label';
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.className = 'planning-date-input';
  dateInput.setAttribute('aria-label', 'Selected day');
  dateLabel.append(dateInput);
  dayControls.append(previousButton, todayButton, nextButton, dateLabel);

  const content = document.createElement('div');
  content.className = 'planning-content quiet-scroll';
  content.tabIndex = 0;
  content.setAttribute('aria-label', 'Calendar plan and available tasks');

  const availability = document.createElement('section');
  availability.className = 'planning-availability';
  availability.setAttribute('aria-label', 'Calendar access');
  const calendarStatus = document.createElement('p');
  calendarStatus.className = 'planning-calendar-status';
  calendarStatus.setAttribute('role', 'status');
  calendarStatus.setAttribute('aria-live', 'polite');
  const calendarError = document.createElement('p');
  calendarError.className = 'planning-inline-error';
  calendarError.setAttribute('role', 'alert');
  const accessButton = document.createElement('button');
  accessButton.type = 'button';
  accessButton.className = 'planning-small-button planning-access-button';
  accessButton.textContent = 'Allow Calendar access';
  const reloadButton = document.createElement('button');
  reloadButton.type = 'button';
  reloadButton.className = 'planning-text-button planning-reload-button';
  reloadButton.textContent = 'Reload calendar';
  availability.append(calendarStatus, calendarError, accessButton, reloadButton);

  const schedule = document.createElement('section');
  schedule.className = 'planning-schedule';
  schedule.setAttribute('aria-labelledby', 'planning-schedule-title');
  const scheduleHeader = document.createElement('header');
  scheduleHeader.className = 'planning-section-heading';
  const scheduleTitle = document.createElement('h2');
  scheduleTitle.id = 'planning-schedule-title';
  scheduleTitle.textContent = 'Your schedule';
  const scheduleCount = document.createElement('span');
  scheduleCount.className = 'planning-count';
  scheduleHeader.append(scheduleTitle, scheduleCount);
  const appointmentsList = document.createElement('div');
  appointmentsList.className = 'planning-appointments';
  appointmentsList.setAttribute('aria-live', 'polite');
  schedule.append(scheduleHeader, appointmentsList);

  const tasksSection = document.createElement('section');
  tasksSection.className = 'planning-tasks';
  tasksSection.setAttribute('aria-labelledby', 'planning-tasks-title');
  const tasksHeader = document.createElement('header');
  tasksHeader.className = 'planning-section-heading';
  const tasksTitle = document.createElement('h2');
  tasksTitle.id = 'planning-tasks-title';
  tasksTitle.textContent = 'Available tasks';
  const tasksHint = document.createElement('span');
  tasksHint.className = 'planning-count';
  tasksHint.textContent = 'Choose one to plan';
  tasksHeader.append(tasksTitle, tasksHint);
  const taskList = document.createElement('div');
  taskList.className = 'planning-task-list';
  tasksSection.append(tasksHeader, taskList);

  const form = document.createElement('form');
  form.className = 'planning-block-form';
  form.setAttribute('aria-labelledby', 'planning-block-title');
  const formTitle = document.createElement('h2');
  formTitle.id = 'planning-block-title';
  formTitle.textContent = 'Create a time block';
  const formFields = document.createElement('div');
  formFields.className = 'planning-form-fields';

  const taskLabel = document.createElement('label');
  taskLabel.className = 'planning-field';
  const taskLabelText = document.createElement('span');
  taskLabelText.textContent = 'Task';
  const taskSelect = document.createElement('select');
  taskSelect.className = 'planning-select';
  taskSelect.setAttribute('aria-label', 'Task');
  taskLabel.append(taskLabelText, taskSelect);

  const calendarLabel = document.createElement('label');
  calendarLabel.className = 'planning-field';
  const calendarLabelText = document.createElement('span');
  calendarLabelText.textContent = 'Writable calendar';
  const calendarSelect = document.createElement('select');
  calendarSelect.className = 'planning-select';
  calendarSelect.setAttribute('aria-label', 'Writable calendar');
  calendarLabel.append(calendarLabelText, calendarSelect);

  const startLabel = document.createElement('label');
  startLabel.className = 'planning-field';
  const startLabelText = document.createElement('span');
  startLabelText.textContent = 'Start time (local)';
  const startInput = document.createElement('input');
  startInput.className = 'planning-input';
  startInput.type = 'time';
  startInput.required = true;
  startInput.setAttribute('aria-label', 'Start time (local)');
  startLabel.append(startLabelText, startInput);

  const durationLabel = document.createElement('label');
  durationLabel.className = 'planning-field';
  const durationLabelText = document.createElement('span');
  durationLabelText.textContent = 'Duration in minutes';
  const durationInput = document.createElement('input');
  durationInput.className = 'planning-input';
  durationInput.type = 'number';
  durationInput.min = '1';
  durationInput.max = '720';
  durationInput.step = '1';
  durationInput.value = '25';
  durationInput.required = true;
  durationInput.setAttribute('aria-label', 'Duration in minutes');
  durationLabel.append(durationLabelText, durationInput);

  formFields.append(taskLabel, calendarLabel, startLabel, durationLabel);
  const submitButton = document.createElement('button');
  submitButton.type = 'submit';
  submitButton.className = 'planning-primary-button';
  submitButton.textContent = 'Schedule task';
  const formHint = document.createElement('p');
  formHint.className = 'planning-form-hint';
  formHint.textContent = 'Task blocks are a guide, not a deadline. They do not record effort.';
  const formError = document.createElement('p');
  formError.className = 'planning-inline-error';
  formError.setAttribute('role', 'alert');
  const formConfirmation = document.createElement('p');
  formConfirmation.className = 'planning-confirmation';
  formConfirmation.setAttribute('role', 'status');
  formConfirmation.setAttribute('aria-live', 'polite');
  form.append(formTitle, formFields, submitButton, formHint, formError, formConfirmation);

  content.append(availability, schedule, tasksSection, form);
  screen.append(toolbar, heading, dayControls, content);
  root.replaceChildren(screen);

  let selectedDay = dateFromInput(dateInputValue(new Date()))!;
  dateInput.value = dateInputValue(selectedDay);
  let dayData: CalendarDayData | null = null;
  let calendarLoading = false;
  let calendarErrorMessage = '';
  let calendarRequest = 0;
  let permissionPending = false;
  let submissionPending = false;
  let formErrorMessage = '';
  let confirmationMessage = '';
  let appState = facade.getState();
  function updateLogo(state: ReturnType<TasksFacade['getState']>): void {
    const theme = state.kind === 'ready' ? themeByID(resolveThemeID(state.preferences.appearanceTheme)) : undefined;
    if (theme) {
      logoPicture.replaceChildren(logo);
      logo.src = theme.appearance === 'dark' ? 'tasks-brand/logo-dark.svg' : 'tasks-brand/logo.svg';
    } else {
      logo.src = 'tasks-brand/logo.svg';
      logoPicture.replaceChildren(darkLogoSource, logo);
    }
  }
  updateLogo(appState);
  let currentTasks: TaskReadModel[] = [];
  let activeCalendarIDs: string[] = [];
  const createdBlockIDs = new Set<string>();
  let disposed = false;
  let unsubscribe: (() => void) | null = null;

  function announce(message: string, kind: 'status' | 'error' = 'status'): void {
    try { options.notify(message, kind); } catch { /* The in-screen status remains available if a host notification fails. */ }
  }

  function stateAuthorization(): CalendarAuthorization {
    const state = facade.getState();
    return state.kind === 'ready' ? state.calendar.authorization : 'notDetermined';
  }

  function renderAppointments(): void {
    if (disposed) return;
    schedule.setAttribute('aria-label', `Your schedule for ${formatLongDate(selectedDay)}`);
    const appointments = dayData?.appointments ?? [];
    scheduleCount.textContent = dayData ? `${appointments.length} ${appointments.length === 1 ? 'calendar item' : 'calendar items'}` : '';
    appointmentsList.replaceChildren();
    if (calendarLoading && !dayData) {
      const loading = document.createElement('p');
      loading.className = 'planning-empty';
      loading.textContent = 'Loading appointments…';
      appointmentsList.append(loading);
      return;
    }
    if (dayData?.authorization !== 'authorized') {
      const empty = document.createElement('p');
      empty.className = 'planning-empty';
      empty.textContent = 'Appointments will appear here when Calendar access is available.';
      appointmentsList.append(empty);
      return;
    }
    if (!appointments.length) {
      const empty = document.createElement('p');
      empty.className = 'planning-empty';
      empty.textContent = 'No appointments for this day.';
      appointmentsList.append(empty);
      return;
    }

    const range = localDayRange(selectedDay);
    const sorted = [...appointments].sort((left, right) => left.start - right.start || left.end - right.end || left.id.localeCompare(right.id, 'en'));
    for (const appointment of sorted) {
      const row = document.createElement('article');
      const created = createdBlockIDs.has(appointment.id);
      row.className = `planning-appointment${created ? ' planning-appointment-block' : ''}`;
      const times = formatAppointmentTime(appointment, range);
      const lane = document.createElement('div');
      lane.className = 'planning-appointment-time';
      lane.textContent = times.lane;
      const body = document.createElement('div');
      body.className = 'planning-appointment-body';
      const titleRow = document.createElement('div');
      titleRow.className = 'planning-appointment-title-row';
      const appointmentTitle = document.createElement('span');
      appointmentTitle.className = 'planning-appointment-title';
      appointmentTitle.textContent = appointment.title;
      const category = document.createElement('span');
      category.className = 'planning-appointment-kind';
      category.textContent = created ? 'Task block' : 'Calendar';
      titleRow.append(appointmentTitle, category);
      const details = document.createElement('p');
      details.className = 'planning-appointment-details';
      details.textContent = times.detail;
      body.append(titleRow, details);
      row.append(lane, body);
      appointmentsList.append(row);
    }
  }

  function renderAvailability(): void {
    if (disposed) return;
    const authorization = dayData?.authorization ?? stateAuthorization();
    calendarStatus.textContent = '';
    accessButton.hidden = true;
    reloadButton.hidden = true;
    accessButton.disabled = permissionPending;
    reloadButton.disabled = calendarLoading;
    calendarError.textContent = calendarErrorMessage;
    calendarError.hidden = !calendarErrorMessage;

    if (appState.kind === 'loading') {
      calendarStatus.textContent = 'Loading Tasks and Calendar state…';
    } else if (appState.kind === 'recovery') {
      calendarStatus.textContent = `Tasks are unavailable: ${appState.message}`;
    } else if (appState.kind === 'disposed') {
      calendarStatus.textContent = 'Tasks are no longer available.';
    } else if (options.environment === 'preview') {
      calendarStatus.textContent = 'Calendar is unavailable in browser preview. Use the Mac app for Calendar planning.';
    } else if (authorization === 'notDetermined') {
      calendarStatus.textContent = 'Calendar access has not been requested.';
      accessButton.hidden = false;
    } else if (authorization === 'denied') {
      calendarStatus.textContent = 'Calendar access is denied. Enable access for Banana Tasks in System Settings.';
    } else if (authorization === 'unavailable') {
      calendarStatus.textContent = 'Calendar access is unavailable in this app environment.';
    } else if (calendarLoading) {
      calendarStatus.textContent = 'Loading appointments…';
    } else if (calendarErrorMessage) {
      calendarStatus.textContent = 'Calendar could not be loaded.';
      reloadButton.hidden = false;
    } else if (dayData?.authorization === 'authorized' && !dayData.calendars.some(calendar => calendar.writable)) {
      calendarStatus.textContent = 'No writable calendars are available. You can still view appointments and tasks.';
    } else if (dayData?.authorization === 'authorized') {
      calendarStatus.textContent = 'Appointments are shown in your local time zone.';
      reloadButton.hidden = false;
    } else {
      calendarStatus.textContent = 'Calendar state is not confirmed yet.';
    }
    renderAppointments();
  }

  function renderTaskOptions(tasks: TaskReadModel[]): void {
    const selected = taskSelect.value;
    taskSelect.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = tasks.length ? 'Choose a task' : 'No active tasks';
    taskSelect.append(placeholder);
    for (const task of tasks) {
      const option = document.createElement('option');
      option.value = task.id;
      option.textContent = task.title;
      taskSelect.append(option);
    }
    taskSelect.value = tasks.some(task => task.id === selected) ? selected : '';
    taskSelect.disabled = tasks.length === 0;
  }

  function renderCalendarOptions(calendars: PlanningCalendar[]): void {
    const selected = calendarSelect.value;
    const writable = calendars.filter(calendar => calendar.writable);
    activeCalendarIDs = writable.map(calendar => calendar.id);
    calendarSelect.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = writable.length ? 'Choose a calendar' : 'No writable calendars';
    calendarSelect.append(placeholder);
    for (const calendar of writable) {
      const option = document.createElement('option');
      option.value = calendar.id;
      option.textContent = calendar.title;
      calendarSelect.append(option);
    }
    calendarSelect.value = writable.some(calendar => calendar.id === selected) ? selected : '';
    calendarSelect.disabled = writable.length === 0;
  }

  function renderTasks(): void {
    if (disposed) return;
    const state = facade.getState();
    appState = state;
    taskList.replaceChildren();
    currentTasks = [];
    if (state.kind === 'ready') {
      try { currentTasks = activeTasks(facade); }
      catch (error) {
        formErrorMessage = error instanceof Error ? error.message : 'Active tasks could not be loaded.';
      }
    }
    renderTaskOptions(currentTasks);
    if (state.kind === 'loading') {
      const message = document.createElement('p');
      message.className = 'planning-empty';
      message.textContent = 'Loading tasks…';
      taskList.append(message);
    } else if (state.kind === 'recovery') {
      const message = document.createElement('p');
      message.className = 'planning-empty';
      message.textContent = 'Tasks are unavailable until saved data can be read.';
      taskList.append(message);
    } else if (currentTasks.length === 0) {
      const message = document.createElement('p');
      message.className = 'planning-empty';
      message.textContent = 'No active tasks to plan.';
      taskList.append(message);
    } else {
      for (const task of currentTasks) {
        const row = document.createElement('div');
        row.className = 'planning-task-row';
        const taskTitle = document.createElement('span');
        taskTitle.className = 'planning-task-title';
        taskTitle.textContent = task.title;
        const ripeness = document.createElement('span');
        ripeness.className = `planning-ripeness planning-ripeness-${task.ripeness}`;
        ripeness.textContent = task.ripeness === 'veryRipe' ? 'Very ripe' : task.ripeness[0].toUpperCase() + task.ripeness.slice(1);
        const choose = document.createElement('button');
        choose.type = 'button';
        choose.className = 'planning-text-button planning-find-time';
        choose.textContent = 'Find a time';
        choose.setAttribute('aria-label', `Find a time for ${task.title}`);
        choose.addEventListener('click', () => {
          if (disposed || !currentTasks.some(item => item.id === task.id)) return;
          taskSelect.value = task.id;
          formErrorMessage = '';
          updateFormStatus();
          startInput.focus();
        });
        row.append(taskTitle, ripeness, choose);
        taskList.append(row);
      }
    }

    updateFormStatus();
    renderAvailability();
  }

  async function loadSelectedDay(): Promise<void> {
    if (disposed || facade.getState().kind !== 'ready') return;
    const generation = ++calendarRequest;
    const dayKey = dateInputValue(selectedDay);
    const range = localDayRange(selectedDay);
    calendarLoading = true;
    calendarErrorMessage = '';
    dayData = null;
    renderAvailability();
    updateFormStatus();
    try {
      const outcome = await facade.loadCalendar(range.start, range.end);
      if (disposed || generation !== calendarRequest || dayKey !== dateInputValue(selectedDay)) return;
      calendarLoading = false;
      if (outcome.kind === 'applied') {
        const state = facade.getState();
        const authorization = options.environment === 'preview' ? 'unavailable' : state.kind === 'ready' ? state.calendar.authorization : 'unavailable';
        dayData = { authorization, calendars: authorization === 'authorized' ? outcome.value.calendars : [], appointments: authorization === 'authorized' ? outcome.value.appointments : [] };
        renderCalendarOptions(dayData.calendars);
      } else {
        calendarErrorMessage = describeOutcome(outcome);
        renderCalendarOptions([]);
      }
      renderAvailability();
      renderTasks();
    } catch (error) {
      if (disposed || generation !== calendarRequest || dayKey !== dateInputValue(selectedDay)) return;
      calendarLoading = false;
      calendarErrorMessage = error instanceof Error ? error.message : 'Calendar could not be loaded for this day.';
      renderCalendarOptions([]);
      renderAvailability();
    }
  }

  async function requestAccess(): Promise<void> {
    if (disposed || permissionPending || options.environment === 'preview') return;
    permissionPending = true;
    calendarErrorMessage = '';
    renderAvailability();
    try {
      const outcome = await facade.requestCalendarAccess();
      if (disposed) return;
      if (outcome.kind === 'applied') {
        announce(outcome.value === 'authorized' ? 'Calendar access is available.' : 'Calendar access was not granted.', outcome.value === 'authorized' ? 'status' : 'error');
        if (outcome.value === 'authorized') {
          permissionPending = false;
          await loadSelectedDay();
          return;
        }
        const state = facade.getState();
        if (state.kind === 'ready') {
          dayData = { authorization: state.calendar.authorization, calendars: [], appointments: [] };
          renderCalendarOptions(dayData.calendars);
        }
      } else {
        calendarErrorMessage = outcome.kind === 'failed' ? outcome.error.message : outcome.kind === 'unavailable'
          ? 'Calendar permission is unavailable in this environment.'
          : 'Calendar permission could not be requested.';
        announce(calendarErrorMessage, 'error');
      }
    } catch (error) {
      if (disposed) return;
      calendarErrorMessage = error instanceof Error ? error.message : 'Calendar permission could not be requested.';
      announce(calendarErrorMessage, 'error');
    }
    permissionPending = false;
    updateFormStatus();
    renderAvailability();
  }

  function changeSelectedDay(date: Date): void {
    if (disposed) return;
    selectedDay = date;
    dateInput.value = dateInputValue(date);
    formErrorMessage = '';
    confirmationMessage = '';
    renderAvailability();
    void loadSelectedDay();
  }

  function updateFormStatus(): void {
    if (disposed) return;
    formError.textContent = formErrorMessage;
    formError.hidden = !formErrorMessage;
    formConfirmation.textContent = confirmationMessage;
    formConfirmation.hidden = !confirmationMessage;
    renderTaskOptions(currentTasks);
    const state = facade.getState();
    submitButton.disabled = options.environment === 'preview' || submissionPending || state.kind !== 'ready' || state.calendar.authorization !== 'authorized' || dayData?.authorization !== 'authorized' || activeCalendarIDs.length === 0 || currentTasks.length === 0;
    submitButton.textContent = submissionPending ? 'Scheduling…' : 'Schedule task';
  }

  function draftError(): string | null {
    const state = facade.getState();
    if (options.environment === 'preview') return 'Calendar scheduling is unavailable in browser preview.';
    if (state.kind !== 'ready') return 'Tasks are not ready. Try again when the task list is available.';
    if (state.calendar.authorization !== 'authorized' || dayData?.authorization !== 'authorized') return 'Calendar access is not available.';
    const task = currentTasks.find(candidate => candidate.id === taskSelect.value && candidate.status.kind === 'active');
    if (!task) return 'Choose an active task.';
    const calendar = dayData.calendars.find(candidate => candidate.id === calendarSelect.value && candidate.writable && activeCalendarIDs.includes(candidate.id));
    if (!calendar) return 'Choose a writable calendar.';
    const durationMinutes = Number(durationInput.value);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 12 * 60) return 'Enter a whole-minute duration from 1 to 720 minutes.';
    const time = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(startInput.value);
    if (!time) return 'Choose a local start time.';
    const startDate = localDate(selectedDay.getFullYear(), selectedDay.getMonth(), selectedDay.getDate(), Number(time[1]), Number(time[2]));
    if (startDate.getFullYear() !== selectedDay.getFullYear() || startDate.getMonth() !== selectedDay.getMonth() || startDate.getDate() !== selectedDay.getDate() ||
        startDate.getHours() !== Number(time[1]) || startDate.getMinutes() !== Number(time[2])) {
      return 'That local time does not exist on this date. Choose another time.';
    }
    if (startDate.getTime() <= Date.now()) return 'Choose a future start time.';
    return null;
  }

  async function submitBlock(event: Event): Promise<void> {
    event.preventDefault();
    if (disposed || submissionPending) return;
    const issue = draftError();
    if (issue) {
      formErrorMessage = issue;
      confirmationMessage = '';
      updateFormStatus();
      announce(issue, 'error');
      return;
    }
    const task = currentTasks.find(candidate => candidate.id === taskSelect.value)!;
    const calendar = dayData!.calendars.find(candidate => candidate.id === calendarSelect.value && candidate.writable)!;
    const [hours, minutes] = startInput.value.split(':').map(Number);
    const start = localDate(selectedDay.getFullYear(), selectedDay.getMonth(), selectedDay.getDate(), hours, minutes).getTime();
    const durationMs = Number(durationInput.value) * 60 * 1000;
    const end = start + durationMs;
    const submittedDay = new Date(selectedDay.getTime());
    const submittedDayKey = dateInputValue(submittedDay);
    submissionPending = true;
    formErrorMessage = '';
    confirmationMessage = '';
    updateFormStatus();
    try {
      const outcome = await facade.scheduleTask(task.id, calendar.id, start, end);
      if (disposed) return;
      if (outcome.kind === 'applied') {
        const receipt = outcome.value;
        const confirmation = receiptDescription(receipt, task.title, calendar.title, submittedDay);
        confirmationMessage = confirmation;
        formErrorMessage = '';
        createdBlockIDs.add(receipt.id);
        if (submittedDayKey === dateInputValue(selectedDay) && dayData) {
          const appointment = { id: receipt.id, title: task.title, start: receipt.start, end: receipt.end, allDay: false };
          dayData = { ...dayData, appointments: [...dayData.appointments.filter(item => item.id !== receipt.id), appointment] };
          renderAvailability();
        }
        announce(confirmation, 'status');
      } else {
        formErrorMessage = outcome.kind === 'rejected'
          ? outcome.reason === 'not_writable' ? 'That calendar is read-only. Choose a writable calendar.'
            : outcome.reason === 'task_not_schedulable' ? 'Choose an active task.'
              : outcome.reason === 'invalid_calendar_range' ? 'Choose a future start and a duration no longer than 12 hours.'
                : 'The task block could not be created.'
          : outcome.kind === 'failed' ? outcome.error.message
            : outcome.kind === 'unavailable' ? 'Calendar is unavailable in this environment.'
              : 'The task block could not be created.';
        announce(formErrorMessage, 'error');
      }
    } catch (error) {
      if (disposed) return;
      formErrorMessage = error instanceof Error ? error.message : 'The task block could not be created.';
      announce(formErrorMessage, 'error');
    }
    if (disposed) return;
    submissionPending = false;
    updateFormStatus();
  }

  previousButton.addEventListener('click', () => changeSelectedDay(addLocalDays(selectedDay, -1)));
  todayButton.addEventListener('click', () => changeSelectedDay(dateFromInput(dateInputValue(new Date()))!));
  nextButton.addEventListener('click', () => changeSelectedDay(addLocalDays(selectedDay, 1)));
  dateInput.addEventListener('change', () => {
    if (disposed) return;
    const date = dateFromInput(dateInput.value);
    if (date) changeSelectedDay(date);
    else dateInput.value = dateInputValue(selectedDay);
  });
  accessButton.addEventListener('click', () => { void requestAccess(); });
  reloadButton.addEventListener('click', () => { void loadSelectedDay(); });
  form.addEventListener('submit', event => { void submitBlock(event); });
  taskSelect.addEventListener('change', () => { formErrorMessage = ''; updateFormStatus(); });
  calendarSelect.addEventListener('change', () => { formErrorMessage = ''; updateFormStatus(); });
  startInput.addEventListener('input', () => { formErrorMessage = ''; updateFormStatus(); });
  durationInput.addEventListener('input', () => { formErrorMessage = ''; updateFormStatus(); });

  function onState(state: ReturnType<TasksFacade['getState']>): void {
    if (disposed) return;
    appState = state;
    updateLogo(state);
    renderTasks();
    if (state.kind === 'ready' && !calendarDataStarted) {
      calendarDataStarted = true;
      void loadSelectedDay();
    }
  }

  function closeScreen(): void {
    if (!disposed) options.onClose();
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (disposed || event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    options.onClose();
  }

  doneButton.addEventListener('click', closeScreen);
  root.addEventListener('keydown', handleKeyDown);
  let calendarDataStarted = false;
  unsubscribe = facade.subscribe(onState);
  appState = facade.getState();
  renderTasks();
  if (appState.kind === 'ready') {
    calendarDataStarted = true;
    void loadSelectedDay();
  }

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      calendarRequest++;
      unsubscribe?.();
      unsubscribe = null;
      doneButton.removeEventListener('click', closeScreen);
      root.removeEventListener('keydown', handleKeyDown);
      root.replaceChildren();
    },
  };
}
