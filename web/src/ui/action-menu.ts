import type { IconNode } from 'lucide';
import { renderIcon } from './icon';
import { trapFocusWithin } from './focus-management';

export interface MenuAction {
  label: string;
  run(): void | Promise<unknown>;
  icon?: IconNode;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
}
export type MenuItem = MenuAction | { separator: true };
let dismiss: ((restoreFocus?: boolean) => void) | undefined;

export function closePopover(restoreFocus = false): boolean {
  if (!dismiss) return false;
  dismiss(restoreFocus); return true;
}

/** Ephemeral view adapter: one anchored surface, with shared dismissal/focus behavior. */
export function openPopover(trigger: HTMLElement, content: HTMLElement, options: { label: string; point?: { x: number; y: number }; menu?: boolean; restoreFocus?: () => void }): void {
  closePopover();
  const doc = trigger.ownerDocument;
  const POPOVER_CLASSES = 'action-popover quiet-scroll';
  content.classList.add(...POPOVER_CLASSES.split(' '));
  content.setAttribute('role', options.menu ? 'menu' : 'dialog');
  content.setAttribute('aria-label', options.label);
  trigger.setAttribute('aria-expanded', 'true');
  doc.body.append(content);
  const rect = trigger.getBoundingClientRect();
  const viewportWidth = doc.documentElement.clientWidth || doc.defaultView?.innerWidth || 380;
  const viewportHeight = doc.documentElement.clientHeight || doc.defaultView?.innerHeight || 400;
  const bounds = content.getBoundingClientRect();
  const x = options.point?.x ?? rect.right - bounds.width;
  const y = options.point?.y ?? rect.bottom + 5;
  content.style.left = `${Math.max(8, Math.min(x, viewportWidth - bounds.width - 8))}px`;
  content.style.top = `${Math.max(8, Math.min(y, viewportHeight - bounds.height - 8))}px`;
  const close = (restoreFocus = false) => {
    content.remove(); trigger.setAttribute('aria-expanded', 'false');
    doc.removeEventListener('pointerdown', outside, true); doc.removeEventListener('keydown', keydown, true);
    dismiss = undefined;
    if (restoreFocus) {
      if (options.restoreFocus) options.restoreFocus();
      else if (trigger.isConnected) trigger.focus();
    }
  };
  const outside = (event: PointerEvent) => { if (!content.contains(event.target as Node) && !trigger.contains(event.target as Node)) close(); };
  const keydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(true); }
    else if (event.key === 'Tab' && !content.matches('.link-editor')) trapFocusWithin(event, content);
  };
  dismiss = close;
  doc.addEventListener('pointerdown', outside, true); doc.addEventListener('keydown', keydown, true);
  content.querySelector<HTMLElement>(options.menu ? '[role="menuitem"]:not(:disabled),[role="menuitemradio"]:not(:disabled)' : 'input,select,button')?.focus();
}

export function openActionMenu(trigger: HTMLElement, items: MenuItem[], options: { label: string; point?: { x: number; y: number }; onError?: (error: unknown) => void }): void {
  if (!options.point && trigger.getAttribute('aria-expanded') === 'true') { closePopover(true); return; }
  const doc = trigger.ownerDocument;
  const menu = doc.createElement('div'); menu.className = 'action-menu';
  for (const item of items) {
    if ('separator' in item) { const line = doc.createElement('div'); line.className = 'menu-separator'; line.setAttribute('role', 'separator'); menu.append(line); continue; }
    const option = doc.createElement('button'); option.type = 'button'; option.className = `menu-action${item.danger ? ' danger' : ''}`;
    option.setAttribute('role', item.checked === undefined ? 'menuitem' : 'menuitemradio');
    if (item.checked !== undefined) option.setAttribute('aria-checked', String(item.checked));
    option.disabled = !!item.disabled;
    if (item.icon) option.append(renderIcon(item.icon, 15));
    const label = doc.createElement('span'); label.textContent = item.label; option.append(label);
    if (item.shortcut) { const shortcut = doc.createElement('span'); shortcut.className = 'menu-shortcut'; shortcut.textContent = item.shortcut; option.append(shortcut); }
    option.onclick = () => { closePopover(true); try { Promise.resolve(item.run()).catch(error => options.onError?.(error)); } catch (error) { options.onError?.(error); } };
    menu.append(option);
  }
  menu.onkeydown = event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = buttons.indexOf(doc.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };
  openPopover(trigger, menu, { ...options, menu: true });
}
