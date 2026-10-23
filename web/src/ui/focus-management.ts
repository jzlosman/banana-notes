export type FocusView = 'note' | 'explorer' | 'project' | 'settings' | 'help';

/** Give each replacement view a stable keyboard and screen-reader entry point. */
export function focusPrimaryView(container: ParentNode, view: FocusView, options: { sourceMode?: boolean; findOpen?: boolean; focusEditor?: () => void } = {}): void {
  if (view === 'note') {
    if (options.findOpen) { const find = container.querySelector<HTMLElement>('.note-find-input'); if (find) { find.focus(); return; } }
    if (options.sourceMode) { const source = container.querySelector<HTMLTextAreaElement>('.source-editor'); if (source) { source.focus(); return; } }
    if (options.focusEditor) { options.focusEditor(); return; }
    const emptyAction = container.querySelector<HTMLElement>('.empty-state .primary-button');
    emptyAction?.focus(); return;
  }
  const target = view === 'explorer' ? container.querySelector<HTMLElement>('.library-search input') : container.querySelector<HTMLElement>('main h1');
  if (target) { if (target.tagName === 'H1') target.tabIndex = -1; target.focus(); }
}

/** Keep Tab navigation inside a modal-like surface, while leaving normal movement untouched. */
export function trapFocusWithin(event: KeyboardEvent, container: HTMLElement): boolean {
  if (event.key !== 'Tab') return false;
  const targets = [...container.querySelectorAll<HTMLElement>('input:not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])')]
    .sort((a, b) => a.compareDocumentPosition(b) & 4 ? -1 : 1);
  if (!targets.length) {
    event.preventDefault(); container.tabIndex = -1; container.focus(); return true;
  }
  const index = targets.indexOf(container.ownerDocument.activeElement as HTMLElement);
  if (event.shiftKey && index <= 0) { event.preventDefault(); targets[targets.length - 1].focus(); return true; }
  if (!event.shiftKey && (index === targets.length - 1 || index < 0)) { event.preventDefault(); targets[0].focus(); return true; }
  return false;
}
