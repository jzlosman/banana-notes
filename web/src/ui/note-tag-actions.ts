import type { Library } from '../domain/library';
import { splitDocument } from '../domain/library';
import type { LibraryCommandResult, LibraryCommands } from '../application/library-commands';

export interface OpenNoteTagEffects {
  replaceLibrary(library: Library): void;
  setMarkdownPrefix(prefix: string, markdown: string): void;
  persist(): void;
  refreshBadges(): void;
  focusEditor(): void;
  renderNote(): void;
}

type TagChange = 'addTag' | 'removeTag';
function changeOpenNoteTag(
  change: TagChange,
  commands: LibraryCommands,
  library: Library,
  noteID: string,
  tag: string,
  effects: OpenNoteTagEffects,
): LibraryCommandResult {
  const before = library.notes.find(candidate => candidate.id === noteID && !candidate.trashedAt);
  if (!before) return { kind: 'applied', library };
  const result = commands[change](library, noteID, tag);
  if (result.kind === 'rejected') return result;
  const note = result.library.notes.find(candidate => candidate.id === noteID && !candidate.trashedAt);
  if (!note) return result;

  const next = { ...result.library, selectedID: noteID };
  effects.replaceLibrary(next);
  effects.persist();
  if (splitDocument(before.markdown).body !== splitDocument(note.markdown).body) {
    effects.renderNote();
  } else {
    const { frontmatter } = splitDocument(note.markdown);
    effects.setMarkdownPrefix(frontmatter && !frontmatter.endsWith('\n') ? `${frontmatter}\n` : frontmatter, note.markdown);
    effects.refreshBadges();
    effects.focusEditor();
  }
  return { kind: 'applied', library: next };
}

/** Apply a metadata-only tag change without tearing down the active TipTap editor. */
export function addTagToOpenNote(
  commands: LibraryCommands,
  library: Library,
  noteID: string,
  tag: string,
  effects: OpenNoteTagEffects,
): LibraryCommandResult {
  return changeOpenNoteTag('addTag', commands, library, noteID, tag, effects);
}

/** Keep the editor mounted for metadata-only removal; rehydrate only if inline text changed. */
export function removeTagFromOpenNote(
  commands: LibraryCommands,
  library: Library,
  noteID: string,
  tag: string,
  effects: OpenNoteTagEffects,
): LibraryCommandResult {
  return changeOpenNoteTag('removeTag', commands, library, noteID, tag, effects);
}
