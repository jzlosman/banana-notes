/** Keyboard adapter; the existing Trash use case owns state changes. */
export function handleNoteTrashShortcut(event: KeyboardEvent, noteID: string | null, trash: (id: string) => void): boolean {
  if (!noteID || event.defaultPrevented || event.isComposing || event.key !== 'Backspace'
    || !event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  const target = event.target as Element | null;
  if (target?.closest?.('[role="dialog"], [role="menu"], .action-popover, .ocr-result')) return false;
  const field = target?.closest?.('input, textarea, select, [contenteditable]');
  if (field && !field.matches('.markdown-editor, .source-editor')) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  // A held key must not trash the neighboring notes selected by the first press.
  if (!event.repeat) trash(noteID);
  return true;
}
