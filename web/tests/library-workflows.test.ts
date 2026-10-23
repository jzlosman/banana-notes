import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bulkArchiveNotes, bulkRestoreNotes, bulkTagNotes, bulkTrashNotes, createNote, notebookTags,
  orderedNotes, purgeExpiredTrash, queryNotes, restoreNote, selectNotebook, selectNotebooks,
  tagsOf, trashExpiresAt, trashNote, updateNote, validateLibrary, type Library,
} from '../src/domain';

const at = (day: number, hour = 12) => `2026-10-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`;
const empty = (): Library => ({ version: 1, notes: [], selectedID: null, activeTag: null });
function fixture(): Library {
  let lib = empty();
  for (const [id, markdown, day] of [
    ['a', '# Alpha\n#work #urgent', 1], ['b', '# Beta\n#work #later', 2],
    ['c', '# Gamma\n#personal', 3], ['d', '# Archived\n#work #archive', 4],
  ] as const) {
    lib = createNote(lib, id, at(day));
    lib = updateNote(lib, id, markdown, at(day));
  }
  return lib;
}

test('legacy activeTag migrates through helper and multi-tag selection uses AND scope', () => {
  const legacy = { ...fixture(), activeTag: 'work' } as Library;
  delete legacy.activeTags;
  const migrated = validateLibrary(legacy);
  assert.equal(migrated.activeTag, 'work');
  assert.equal(migrated.selectedID, 'b');
  assert.deepEqual(selectNotebooks(legacy, ['#WORK', 'work', 'urgent']).activeTags, ['work', 'urgent']);
  const scoped = selectNotebooks(legacy, ['work', 'urgent']);
  assert.deepEqual(orderedNotes(scoped).map(n => n.id), ['a']);
  assert.equal(scoped.activeTag, 'work');
  assert.equal(scoped.selectedID, 'a');
});

test('archive is explicit scope, counts as a notebook, and new notes inherit every selection', () => {
  const lib = fixture();
  assert.deepEqual(orderedNotes(lib).map(n => n.id), ['c', 'b', 'a']);
  assert.ok(notebookTags(lib).some(({ tag, count }) => tag === 'archive' && count === 1));
  assert.deepEqual(orderedNotes(selectNotebook(lib, 'archive')).map(n => n.id), ['d']);
  const created = createNote(selectNotebooks(lib, ['work', 'urgent']), 'new', at(5));
  assert.deepEqual(tagsOf(created.notes.find(n => n.id === 'new')!.markdown), ['urgent', 'work']);
});

test('query supports edited ordering, strict exclusive UTC date boundary, text and tag intersection', () => {
  const lib = updateNote(fixture(), 'a', '# Alpha changed\n#work #urgent', at(5, 1));
  assert.deepEqual(queryNotes(lib, { tags: ['work'], query: 'alpha' }).map(n => n.id), ['a']);
  assert.deepEqual(queryNotes(lib, { sort: 'edited', before: '2026-10-06', tags: ['work'] }).map(n => n.id), ['a', 'b']);
  assert.deepEqual(queryNotes(lib, { sort: 'created', before: '2026-10-03' }).map(n => n.id), ['b', 'a']);
  assert.throws(() => queryNotes(lib, { before: '2026-02-30' }));
});

test('bulk edits are atomic on malformed frontmatter and safely ignore stale IDs', () => {
  const lib = fixture();
  const corrupt: Library = { ...lib, notes: lib.notes.map(n => n.id === 'b' ? { ...n, markdown: '---\ntags: [broken\n---\nKeep this' } : n) };
  assert.throws(() => bulkTagNotes(corrupt, ['a', 'b', 'missing'], 'added', at(10)));
  const tagged = bulkTagNotes(lib, ['a', 'missing'], 'added', at(10));
  assert.deepEqual(tagsOf(tagged.notes.find(n => n.id === 'a')!.markdown), ['added', 'urgent', 'work']);
  assert.equal(tagged.notes.find(n => n.id === 'a')!.updatedAt, at(10));
  assert.deepEqual(bulkArchiveNotes(lib, ['missing'], at(10)), lib);
});

test('bulk trash, restore, and purge honor strict 30-day expiry and conservative effective time', () => {
  const base = fixture();
  const lib = { ...base, notes: base.notes.map(note => note.id === 'b' ? { ...note, updatedAt: at(31) } : note) };
  const trashed = bulkTrashNotes(lib, ['a', 'stale'], at(1));
  const note = trashed.notes.find(n => n.id === 'a')!;
  assert.deepEqual(note, { ...lib.notes.find(n => n.id === 'a')!, trashedAt: at(1) });
  assert.equal(trashExpiresAt(note), '2026-10-31T12:00:00.000Z');
  assert.deepEqual(restoreNote(trashed, 'a', '2026-10-31T11:59:59.999Z').notes.find(n => n.id === 'a'), lib.notes.find(n => n.id === 'a'));
  assert.equal(bulkRestoreNotes(trashed, ['a'], '2026-10-31T12:00:00.000Z').notes.find(n => n.id === 'a')!.trashedAt, undefined);
  const restored = bulkRestoreNotes(trashed, ['a', 'missing'], '2026-10-31T11:59:59.999Z');
  assert.deepEqual(restored.notes.find(n => n.id === 'a'), lib.notes.find(n => n.id === 'a'));
  const exactRetention = purgeExpiredTrash(trashed, '2026-10-31T12:00:00.000Z');
  assert.equal(exactRetention.notes.some(n => n.id === 'a'), true);
  const purged = purgeExpiredTrash(trashed, '2026-10-31T12:00:00.001Z');
  assert.equal(purged.notes.some(n => n.id === 'a'), false);
  assert.equal(purged.notes.some(n => n.id === 'b'), true);
  assert.deepEqual(purgeExpiredTrash(trashed, '2026-10-31T11:59:59.999Z'), trashed);
});

test('bulk archive is a tag edit and selected note is repaired when moved out of scope', () => {
  const selected = { ...selectNotebook(fixture(), 'work'), selectedID: 'a' };
  const archived = bulkArchiveNotes(selected, ['a'], at(8));
  assert.deepEqual(tagsOf(archived.notes.find(n => n.id === 'a')!.markdown), ['archive', 'urgent', 'work']);
  assert.equal(archived.notes.find(n => n.id === 'a')!.updatedAt, at(8));
  assert.equal(archived.selectedID, 'b');
  const trash = trashNote({ ...selected, selectedID: 'a' }, 'a', at(9));
  assert.equal(trash.selectedID, 'b');
});
