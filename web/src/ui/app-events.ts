type AppView = 'note' | 'explorer' | 'project' | 'help' | 'themes';
type Shortcut = () => void | Promise<unknown>;

export interface KeyboardActions {
  isReady(): boolean;
  view(): AppView;
  handleTrash(event: KeyboardEvent): boolean;
  closePopover(restoreFocus: boolean): boolean;
  hasOCRDialog(): boolean;
  closeOCRDialog(): void;
  hasFind(): boolean;
  closeFind(): void;
  openFind(): void;
  findNext(direction: -1 | 1): void;
  sourceMode(): boolean;
  editorAvailable(): boolean;
  increaseFont(): void;
  decreaseFont(): void;
  resetFont(): void;
  copyFormatted(): Promise<void>;
  editLink(): void;
  newNote(): void;
  moveOlder(): void;
  moveNewer(): void;
  showExplorer(): void;
  flipView(): void;
  toggleSource(): void;
  openSettings(): void;
  save(): Promise<void>;
  goToNote(): void;
  hideWindow(): Promise<void>;
  error(error: unknown): void;
}

/** Keeps keyboard event interpretation in one UI adapter; action effects stay with the app. */
export function installKeyboardShortcuts(actions: KeyboardActions): () => void {
  const onKeydown = (event: KeyboardEvent) => {
    if (!actions.isReady() || event.isComposing) return;
    if (actions.view() === 'note' && actions.handleTrash(event)) return;
    if (event.target instanceof Element && event.target.closest('.hotkey-chord[data-recording="true"]')) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    const field = event.target instanceof Element ? event.target.closest('input,textarea,select') : null;
    if (event.key === 'Escape' && actions.closePopover(true)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (event.key === 'Escape' && actions.hasOCRDialog()) { event.preventDefault(); event.stopPropagation(); actions.closeOCRDialog(); return; }
    if (event.key === 'Escape' && actions.hasFind()) { event.preventDefault(); event.stopPropagation(); actions.closeFind(); return; }
    let run: Shortcut | undefined;
    if (mod && !event.altKey && key === 'f' && actions.view() === 'note' && (!field || field.matches('.source-editor,.note-find-input'))) run = actions.openFind;
    else if (mod && !event.altKey && key === 'g' && actions.view() === 'note' && actions.hasFind()) run = () => actions.findNext(event.shiftKey ? -1 : 1);
    else if (mod && !event.altKey && (key === '+' || key === '=')) run = actions.increaseFont;
    else if (mod && !event.altKey && key === '-') run = actions.decreaseFont;
    else if (mod && !event.altKey && key === '0') run = actions.resetFont;
    else if (mod && event.altKey && key === 'c') run = actions.copyFormatted;
    else if (mod && !event.altKey && !event.shiftKey && key === 'k' && actions.view() === 'note' && !actions.sourceMode() && actions.editorAvailable() && (!field || field.closest('.link-editor'))) run = actions.editLink;
    else if (mod && key === 'n' && !event.shiftKey) run = actions.newNote;
    else if (mod && ((key === '[' && !event.shiftKey) || (event.shiftKey && key === 'arrowleft'))) run = actions.moveOlder;
    else if (mod && ((key === ']' && !event.shiftKey) || (event.shiftKey && key === 'arrowright'))) run = actions.moveNewer;
    else if (mod && ((key === 'e' && event.shiftKey) || (key === 'p' && !event.shiftKey))) run = () => { if (key === 'p') actions.showExplorer(); else actions.flipView(); };
    else if (mod && key === 'm' && event.shiftKey) run = actions.toggleSource;
    else if (mod && key === ',') run = actions.openSettings;
    else if (mod && key === 's') run = actions.save;
    else if (event.key === 'Escape') run = () => { if (actions.view() !== 'note') actions.goToNote(); else return actions.hideWindow(); };
    if (!run) return;
    event.preventDefault(); event.stopPropagation();
    try { Promise.resolve(run()).catch(actions.error); } catch (error) { actions.error(error); }
  };
  document.addEventListener('keydown', onKeydown, true);
  return () => document.removeEventListener('keydown', onKeydown, true);
}
