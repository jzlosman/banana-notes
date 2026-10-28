import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  movePinnedTag, normalizePinnedTags, normalizeScopePreferences, pinTag, scopeKey, scopeTagsFromKey,
  unpinTag, type ScopeBookmarks,
} from '../src/domain/scope-preferences';
import {
  pruneScopeBookmarks, resolveScopeBookmark, selectNotebooks, updateScopeBookmark,
  type Library, type Note,
} from '../src/domain/library';

const note = (id: string, markdown: string, createdAt: string, updatedAt = createdAt, trashedAt?: string): Note => ({
  id, markdown, createdAt, updatedAt, ...(trashedAt ? { trashedAt } : {}),
});
const library = (notes: Note[], selectedID: string | null = null): Library => ({
  version: 1, notes, selectedID, activeTag: null,
});
const day = (day: number) => `2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`;

test('pin lists normalize tag spelling, discard invalid persisted values, and deduplicate in order', () => {
  assert.deepEqual(normalizePinnedTags([' #Launch ', 'launch', 'Café', 'invalid tag', '', 4]), ['launch', 'café']);
  assert.deepEqual(pinTag(['work', 'ideas'], '#LAUNCH'), ['work', 'ideas', 'launch']);
  assert.deepEqual(pinTag(['work', 'ideas'], 'WORK'), ['work', 'ideas']);
  assert.deepEqual(unpinTag(['work', 'ideas', 'launch'], '#IDEAS'), ['work', 'launch']);
  assert.throws(() => pinTag(['work'], 'not valid'));
});

test('pin reordering moves one tag by one slot, clamps boundaries, and preserves normalized order', () => {
  const pins = ['launch', 'work', 'ideas'];
  assert.deepEqual(movePinnedTag(pins, 'work', -1), ['work', 'launch', 'ideas']);
  assert.deepEqual(movePinnedTag(pins, 'work', 1), ['launch', 'ideas', 'work']);
  assert.deepEqual(movePinnedTag(pins, 'launch', -1), pins);
  assert.deepEqual(movePinnedTag(pins, 'ideas', 1), pins);
  assert.deepEqual(movePinnedTag(pins, 'missing', -1), pins);
});

test('scope keys are canonical for All, a tag, and multi-tag filters', () => {
  assert.equal(scopeKey([]), 'all');
  assert.equal(scopeKey(['#Work']), scopeKey(['work']));
  assert.equal(scopeKey(['work', 'ideas']), scopeKey(['ideas', 'work']));
  assert.deepEqual(scopeTagsFromKey('all'), []);
  assert.deepEqual(scopeTagsFromKey(scopeKey(['ideas', 'work'])), ['ideas', 'work']);
  assert.equal(scopeTagsFromKey('tags:["invalid tag"]'), null);
  assert.deepEqual(normalizeScopePreferences({ pinnedTags: ['Work', 'work', 'Bad tag'], bookmarks: { [scopeKey([])]: 'note-1', malformed: 'note-2' } }), {
    pinnedTags: ['work'], bookmarks: { all: 'note-1' },
  });
});

test('bookmark resolution prefers a live, nonblank in-scope note, otherwise the most recently edited note', () => {
  const notes = [
    note('newest-created', '#project\nOld edit', day(9), day(10)),
    note('recent-edit', '#project\nRecent edit', day(2), day(20)),
    note('trash', '#project\nTrashed', day(8), day(30), day(31)),
    note('blank', '---\ntags: [project]\n---\n', day(7), day(40)),
    note('other-scope', '#personal\nElsewhere', day(6), day(50)),
  ];
  const notesLibrary = library(notes);
  const project = scopeKey(['project']);
  assert.equal(resolveScopeBookmark(notesLibrary, ['project'], { [project]: 'newest-created' }), 'newest-created');
  assert.equal(resolveScopeBookmark(notesLibrary, ['project'], { [project]: 'trash' }), 'recent-edit');
  assert.equal(resolveScopeBookmark(notesLibrary, ['project'], { [project]: 'blank' }), 'recent-edit');
  assert.equal(resolveScopeBookmark(notesLibrary, ['project'], { [project]: 'other-scope' }), 'recent-edit');
  assert.equal(resolveScopeBookmark(notesLibrary, ['missing'], {}), null);
  assert.equal(resolveScopeBookmark(notesLibrary, [], {}), 'other-scope');
});

test('scope selection restores bookmarks and falls back by updatedAt rather than creation order', () => {
  const notes = [
    note('old-edit', '#project\nOlder', day(8), day(9)),
    note('recent-edit', '#project\nRecently edited', day(2), day(20)),
    note('all-latest', '#personal\nAll scope', day(3), day(30)),
  ];
  const base = library(notes, 'all-latest');
  const projectKey = scopeKey(['project']);
  const project = selectNotebooks(base, ['project'], { [projectKey]: 'old-edit' });
  assert.equal(project.selectedID, 'old-edit');
  assert.equal(selectNotebooks(base, ['project']).selectedID, 'recent-edit');
  assert.equal(selectNotebooks({ ...project, selectedID: 'recent-edit' }, ['project']).selectedID, 'recent-edit', 'reselecting the same scope preserves the current note');
});

test('bookmark updates are immutable and pruning ignores notes that are missing, trashed, or no longer in scope', () => {
  const key = scopeKey(['project']);
  const original: ScopeBookmarks = { [key]: 'keep', all: 'trashed', malformed: 'ignore' };
  const updated = updateScopeBookmark(original, ['project'], 'next');
  assert.deepEqual(original, { [key]: 'keep', all: 'trashed', malformed: 'ignore' });
  assert.equal(updated[key], 'next');
  assert.deepEqual(updateScopeBookmark(updated, [], null), { [key]: 'next' });

  const notesLibrary = library([
    note('keep', '#project\nHere', day(1)),
    note('trashed', '#personal\nGone', day(2), day(2), day(3)),
  ]);
  assert.deepEqual(pruneScopeBookmarks(original, notesLibrary), { [key]: 'keep' });
});
