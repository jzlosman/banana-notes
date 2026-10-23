import {
  bulkArchiveNotes,
  bulkRestoreNotes,
  bulkTagNotes,
  bulkTrashNotes,
  createNote,
  markdownByteLength,
  MAX_LIBRARY_NOTES,
  MAX_NOTE_MARKDOWN_BYTES,
  navigate,
  purgeExpiredTrash,
  restoreNote,
  removeTag as withoutTag,
  selectNotebook,
  selectNotebooks,
  trashNote,
  updateNote,
  withTag,
  type Library,
} from '../domain/library';
import type { Clock, IdGenerator } from './ports';

export type LibraryCommandResult =
  | { kind: 'applied'; library: Library }
  | { kind: 'rejected'; reason: 'note-too-large' | 'note-limit'; message: string };

/** Application commands keep library state changes and effect inputs out of the UI. */
export class LibraryCommands {
  constructor(private readonly clock: Clock, private readonly ids: IdGenerator) {}

  create(library: Library): LibraryCommandResult {
    if (library.notes.length >= MAX_LIBRARY_NOTES) {
      return { kind: 'rejected', reason: 'note-limit', message: `Banana Notes can store up to ${MAX_LIBRARY_NOTES.toLocaleString()} notes.` };
    }
    return { kind: 'applied', library: createNote(library, this.ids.next(), this.clock.now()) };
  }

  edit(library: Library, id: string, markdown: string): LibraryCommandResult {
    if (markdownByteLength(markdown) > MAX_NOTE_MARKDOWN_BYTES) {
      return { kind: 'rejected', reason: 'note-too-large', message: "This note is larger than 2 MB and can't be saved. Move some content into another note." };
    }
    return { kind: 'applied', library: updateNote(library, id, markdown, this.clock.now()) };
  }

  addTag(library: Library, id: string, tag: string): LibraryCommandResult {
    const note = library.notes.find(candidate => candidate.id === id && !candidate.trashedAt);
    if (!note) return { kind: 'applied', library };
    const markdown = withTag(note.markdown, tag);
    return markdown === note.markdown ? { kind: 'applied', library } : this.edit(library, id, markdown);
  }

  removeTag(library: Library, id: string, tag: string): LibraryCommandResult {
    const note = library.notes.find(candidate => candidate.id === id && !candidate.trashedAt);
    if (!note) return { kind: 'applied', library };
    const markdown = withoutTag(note.markdown, tag);
    return markdown === note.markdown ? { kind: 'applied', library } : this.edit(library, id, markdown);
  }

  navigate(library: Library, delta: number): Library { return navigate(library, delta); }
  selectNotebook(library: Library, tag: string | null): Library { return selectNotebook(library, tag); }
  selectNotebooks(library: Library, tags: string[]): Library { return selectNotebooks(library, tags); }
  trash(library: Library, id: string): Library { return trashNote(library, id, this.clock.now()); }
  restore(library: Library, id: string): Library { return restoreNote(library, id, this.clock.now()); }
  trashMany(library: Library, ids: string[]): Library { return bulkTrashNotes(library, ids, this.clock.now()); }
  restoreMany(library: Library, ids: string[]): Library { return bulkRestoreNotes(library, ids, this.clock.now()); }
  archiveMany(library: Library, ids: string[]): Library { return bulkArchiveNotes(library, ids, this.clock.now()); }
  tagMany(library: Library, ids: string[], tag: string): Library { return bulkTagNotes(library, ids, tag, this.clock.now()); }
  purgeExpiredTrash(library: Library): Library { return purgeExpiredTrash(library, this.clock.now()); }
}
