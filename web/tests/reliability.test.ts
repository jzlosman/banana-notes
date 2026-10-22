import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_LIBRARY_NOTES,
  MAX_NOTE_MARKDOWN_BYTES,
  markdownByteLength,
  purgeExpiredTrash,
  restoreNote,
  trashNote,
  type Library,
} from '../src/domain/library';
import { LibraryCommands } from '../src/application/library-commands';
import type { Clock, IdGenerator } from '../src/application/ports';

const date = (days: number) => new Date(Date.parse('2026-01-01T00:00:00.000Z') + days * 86_400_000).toISOString();
const libraryWith = (...notes: Library['notes']): Library => ({ version: 1, notes, selectedID: notes[0]?.id ?? null, activeTag: null });

test('UTF-8 markdown size uses bytes and the shared 2 MB boundary', () => {
  assert.equal(markdownByteLength('a😀'), 5);
  const exact = 'x'.repeat(MAX_NOTE_MARKDOWN_BYTES);
  assert.equal(markdownByteLength(exact), MAX_NOTE_MARKDOWN_BYTES);
  const clock: Clock = { now: () => date(2) };
  const ids: IdGenerator = { next: () => 'created' };
  const commands = new LibraryCommands(clock, ids);
  const current = libraryWith({ id: 'n', markdown: 'old', createdAt: date(0), updatedAt: date(0) });
  const refused = commands.edit(current, 'n', `${exact}x`);
  assert.equal(refused.kind, 'rejected');
  if (refused.kind === 'rejected') assert.equal(refused.reason, 'note-too-large');
  assert.equal(current.notes[0].markdown, 'old');
  const accepted = commands.edit(current, 'n', exact);
  assert.equal(accepted.kind, 'applied');
  if (accepted.kind === 'applied') assert.equal(accepted.library.notes[0].markdown.length, MAX_NOTE_MARKDOWN_BYTES);
});

test('creating note 20,001 is refused before changing the library', () => {
  const notes = Array.from({ length: MAX_LIBRARY_NOTES }, (_, index) => ({
    id: `n-${index}`, markdown: `Note ${index}`, createdAt: date(0), updatedAt: date(0),
  }));
  const current = libraryWith(...notes);
  const commands = new LibraryCommands({ now: () => date(1) }, { next: () => 'n-20000' });
  const result = commands.create(current);
  assert.equal(result.kind, 'rejected');
  if (result.kind === 'rejected') assert.equal(result.reason, 'note-limit');
  assert.equal(current.notes.length, MAX_LIBRARY_NOTES);
});

test('trash purge clamps forward wall-clock jumps to one day after latest library activity', () => {
  const trashedAt = date(0);
  const current = libraryWith(
    { id: 'trashed', markdown: 'deleted', createdAt: date(0), updatedAt: date(0), trashedAt },
    { id: 'active', markdown: 'recent enough', createdAt: date(4), updatedAt: date(4) },
  );
  const purged = purgeExpiredTrash(current, date(90));
  assert.equal(purged.notes.some(note => note.id === 'trashed'), true);
  const restored = restoreNote(current, 'trashed', date(90));
  assert.equal(restored.notes.some(note => note.id === 'trashed' && !note.trashedAt), true);
});

test('trash expires only after more than 30 days of effective time', () => {
  const current = libraryWith(
    { id: 'trashed', markdown: 'deleted', createdAt: date(0), updatedAt: date(0), trashedAt: date(0) },
    { id: 'active', markdown: 'activity', createdAt: date(0), updatedAt: date(0) },
  );
  assert.equal(purgeExpiredTrash(current, date(30)).notes.length, 2);
  const later = { ...current, notes: current.notes.map(note => note.id === 'active' ? { ...note, updatedAt: date(30) } : note) };
  assert.equal(purgeExpiredTrash(later, date(90)).notes.some(note => note.id === 'trashed'), false);
});
