import { openActionMenu } from './action-menu';

export interface TagPinMenuOptions {
  isPinned(tag: string): boolean;
  togglePin(tag: string): void | Promise<void>;
  onError(error: unknown): void;
  restoreFocus?: () => void;
}

/** Adds the shared pin/unpin context action to any rendered tag surface. */
export function installTagPinMenu(target: HTMLElement, tag: string, options: TagPinMenuOptions): () => void {
  target.setAttribute('aria-haspopup', 'menu');
  target.setAttribute('aria-keyshortcuts', 'Shift+F10');
  const open = (point?: { x: number; y: number }) => openActionMenu(target, [
    { label: options.isPinned(tag) ? 'Unpin from top bar' : 'Pin to top bar', run: () => options.togglePin(tag) },
  ], { label: `#${tag} actions`, point, onError: options.onError, restoreFocus: options.restoreFocus });
  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault(); event.stopPropagation();
    open(event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : undefined);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) return;
    event.preventDefault(); event.stopPropagation(); open();
  };
  target.addEventListener('contextmenu', onContextMenu);
  target.addEventListener('keydown', onKeyDown);
  return () => {
    target.removeEventListener('contextmenu', onContextMenu);
    target.removeEventListener('keydown', onKeyDown);
    target.removeAttribute('aria-haspopup'); target.removeAttribute('aria-keyshortcuts');
  };
}
