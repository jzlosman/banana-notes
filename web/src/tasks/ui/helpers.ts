import type { IconNode } from 'lucide';
import type { CommandOutcome } from '../application/controller';
import { renderIcon } from '../../ui/icon';

export function makeElement<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function makeButton(
  document: Document,
  label: string,
  className: string,
  onClick: (event: MouseEvent) => void,
  icon?: IconNode,
): HTMLButtonElement {
  const button = makeElement(document, 'button', className);
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.title = label;
  if (icon) button.append(renderIcon(icon, 15));
  else button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

export function formatAge(rawAgeMs: number): string {
  const minutes = Math.floor(Math.max(0, rawAgeMs) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function formatElapsed(durationMs: number): string {
  const seconds = Math.floor(Math.max(0, durationMs) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export function formatEffort(durationMs: number): string {
  const minutes = Math.floor(Math.max(0, durationMs) / 60_000);
  if (minutes < 1) return durationMs > 0 ? '<1m' : 'No time logged';
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return hours > 0 ? `${hours}h ${remaining}m` : `${minutes}m`;
}

export function formatHistoryTime(at: number, now: number): string {
  const elapsed = Math.max(0, now - at);
  if (elapsed < 60_000) return 'Now';
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 24 * 60 * 60_000) return `${Math.floor(elapsed / (60 * 60_000))}h ago`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(at));
}

export function describeOutcome<T>(outcome: CommandOutcome<T>, fallback: string): string {
  if (outcome.kind === 'failed') return outcome.error.message || fallback;
  if (outcome.kind === 'unavailable') return 'Tasks are not ready for that action.';
  if (outcome.kind === 'rejected') {
    switch (outcome.reason) {
      case 'invalid_input': return 'Check the task fields and try again.';
      case 'not_found': return 'That task is no longer available.';
      case 'invalid_transition': return 'That task state changed. Refresh the task and try again.';
      case 'task_not_active': return 'Only active tasks can start a focus timer.';
      case 'timer_not_running': return 'No focus timer is running.';
      case 'activity_limit': return 'This task has reached its activity limit.';
      case 'effort_limit': return 'This task has reached its recorded-effort limit.';
      case 'not_connected': return 'Connect Todoist before using this action.';
      case 'no_project': return 'Choose a Todoist project before using this action.';
      case 'invalid_project': return 'Choose an available Todoist project.';
      case 'not_writable': return 'Choose a writable calendar.';
      case 'invalid_calendar_range': return 'Choose a valid time range.';
      case 'task_not_schedulable': return 'Only active tasks can be scheduled.';
    }
  }
  return fallback;
}

export function isApplied<T>(outcome: CommandOutcome<T>): outcome is Extract<CommandOutcome<T>, { kind: 'applied' }> {
  return outcome.kind === 'applied';
}
