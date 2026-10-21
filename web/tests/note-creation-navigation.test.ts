import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNote, updateNote, navigate, noteNavigation, selectNotebook, selectNotebooks, trashNote, validateLibrary, type Library } from '../src/domain';

const at = (day: number) => `2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`;
const empty = (): Library => ({ version: 1, notes: [], selectedID: null, activeTag: null });
function written(library: Library, id: string, day: number, markdown = `# ${id}`): Library {
  return updateNote(createNote(library, id, at(day)), id, markdown, at(day));
}

test('new-note requests create once, then select the newest blank without changing its bytes or timestamps', () => {
  const older = written(empty(), 'older', 1);
  const first = createNote(older, 'blank', at(2));
  const before = structuredClone(first.notes);
  let library: Library = { ...first, selectedID: 'older' };
  for (let day = 3; day <= 6; day++) {
    library = createNote(validateLibrary(library), `unused-${day}`, at(day));
    assert.equal(library.selectedID, 'blank');
    assert.deepEqual(library.notes, before);
  }
  const dirty = updateNote(library, 'blank', 'Started writing', at(7));
  assert.equal(createNote(dirty, 'next', at(8)).notes.length, 3);
});

test('blank is based on content, not save state; deleting content allows reuse after reloading', () => {
  const dirty = written(empty(), 'one', 1);
  const blank = updateNote(dirty, 'one', ' \n\t', at(2));
  const reused = createNote(validateLibrary(blank), 'unused', at(3));
  assert.equal(reused.selectedID, 'one');
  assert.deepEqual(reused.notes, blank.notes);
});

test('only the newest note is considered; an older blank never swallows a new-note request', () => {
  const newest = written(empty(), 'newest', 2);
  const library: Library = { ...newest, notes: [
    ...newest.notes,
    { id: 'older-blank', markdown: '', createdAt: at(1), updatedAt: at(1) },
  ], selectedID: 'older-blank' };
  const next = createNote(library, 'new', at(3));
  assert.equal(next.selectedID, 'new');
  assert.equal(next.notes.length, 3);
});

test('scoped blank notes inherit tags, are reused, and never cross notebook or trash boundaries', () => {
  let library = selectNotebooks(written(empty(), 'personal', 1, 'Private #personal'), ['work', 'urgent']);
  library = createNote(library, 'work-blank', at(2));
  const before = structuredClone(library.notes);
  library = createNote(validateLibrary(library), 'unused', at(3));
  assert.equal(library.selectedID, 'work-blank');
  assert.deepEqual(library.notes, before);
  library = createNote(selectNotebook(library, 'personal'), 'personal-blank', at(4));
  assert.equal(library.selectedID, 'personal-blank');
  const trashed = trashNote(library, 'personal-blank', at(5));
  assert.equal(createNote(trashed, 'replacement', at(6)).selectedID, 'replacement');
});

test('tag-only user metadata is not mistaken for the current notebook’s inherited scaffold', () => {
  let library = createNote(selectNotebook(empty(), 'project'), 'project-blank', at(1));
  assert.equal(createNote(selectNotebook(library, null), 'all-blank', at(2)).selectedID, 'all-blank');
  library = createNote(selectNotebooks(library, ['project', 'urgent']), 'both-blank', at(2));
  assert.equal(createNote(selectNotebook(library, 'project'), 'project-only', at(3)).selectedID, 'project-only');
  const reversedScope = selectNotebooks(library, ['urgent', 'project']);
  assert.equal(createNote(reversedScope, 'unused', at(3)).selectedID, 'both-blank');
});

test('metadata, malformed source, formatting, and attachments are content, even without prose', () => {
  for (const markdown of [
    '---\ntitle: Important\n---\n', '---\ntags: [oops\n---\n', '---\ntags: [42]\n---\n',
    '#', '- [ ]', '![Photo](foldnote-asset://media/photo.png)',
    '<audio controls src="foldnote-asset://media/audio.mp3"></audio>',
  ]) {
    const library = written(empty(), 'one', 1, markdown);
    assert.equal(createNote(library, 'next', at(2)).selectedID, 'next', markdown);
  }
});

test('chronological page numbers remain fixed on creation and editing; left lowers and right raises the number', () => {
  let library = written(written(written(empty(), 'one', 1), 'two', 2), 'three', 3);
  assert.deepEqual(noteNavigation(library), { position: 3, total: 3, canMoveOlder: true, canMoveNewer: false });
  library = navigate(library, 1);
  assert.equal(library.selectedID, 'two');
  assert.equal(noteNavigation(library).position, 2);
  const expanded = createNote(library, 'four', at(4));
  assert.equal(noteNavigation({ ...expanded, selectedID: 'two' }).position, 2);
  library = updateNote({ ...expanded, selectedID: 'two' }, 'two', '# Edited', at(9));
  assert.equal(noteNavigation(library).position, 2);
  assert.equal(noteNavigation(navigate(library, -1)).position, 3);
  library = navigate(library, 10);
  assert.deepEqual(noteNavigation(library), { position: 1, total: 4, canMoveOlder: false, canMoveNewer: true });
  assert.equal(noteNavigation(navigate(library, 1)).position, 1);
  const removed = trashNote(library, 'one', at(10));
  assert.equal(noteNavigation({ ...removed, selectedID: 'two' }).position, 1);
});

test('simultaneous creation uses persisted insertion order, not random IDs, to keep earlier page numbers stable', () => {
  const first = written(empty(), 'z-first', 1);
  const second = written(first, 'a-second', 1);
  assert.equal(noteNavigation(second).position, 2);
  assert.equal(noteNavigation({ ...second, selectedID: 'z-first' }).position, 1);
  const third = createNote(validateLibrary(second), 'm-third', at(1));
  assert.equal(third.selectedID, 'm-third');
  assert.equal(noteNavigation(third).position, 3);
  assert.equal(noteNavigation({ ...third, selectedID: 'a-second' }).position, 2);
  assert.equal(createNote(validateLibrary(third), 'unused', at(2)).selectedID, 'm-third');
});

test('page numbers follow the notebook scope, exclude trash/archive, and handle empty or outside selections', () => {
  let library = written(written(written(empty(), 'one', 1, '#work'), 'other', 2, '#personal'), 'three', 3, '#work');
  library = written(library, 'archived', 4, '#archive');
  library = selectNotebook(library, 'work');
  assert.deepEqual(noteNavigation(library), { position: 2, total: 2, canMoveOlder: true, canMoveNewer: false });
  library = trashNote(library, 'three', at(5));
  assert.deepEqual(noteNavigation(library), { position: 1, total: 1, canMoveOlder: false, canMoveNewer: false });
  assert.equal(noteNavigation({ ...library, selectedID: 'other' }).position, null);
  assert.deepEqual(noteNavigation(selectNotebook(library, 'missing')), { position: null, total: 0, canMoveOlder: false, canMoveNewer: false });
});
