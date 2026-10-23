import { test } from 'node:test';
import assert from 'node:assert/strict';
import { excerptOf, groupNotesByLocalDay, isBlankMarkdown, noteTaskProgress, notebookTags, queryNotes, recentNotebookTags, titleOf, type Library, type Note } from '../src/domain';

const note = (id: string, markdown: string, updatedAt: string, extra: Partial<Note> = {}): Note => ({
  id, markdown, createdAt: updatedAt, updatedAt, ...extra,
});
const library = (...notes: Note[]): Library => ({ version: 1, notes, selectedID: null, activeTag: null });

test('titles are plain text for headings, tasks, emphasis, links, and inline code', () => {
  assert.equal(titleOf('---\ntags: [launch]\n---\n# **[Ship the `new` app](https://example.test)**\n\nDetails'), 'Ship the new app');
  assert.equal(titleOf('- [x] **Review** the [release](https://example.test)'), 'Review the release');
  assert.equal(titleOf('[ ] **Draft** the `first` note'), 'Draft the first note');
  assert.equal(titleOf('---\ntags: [launch]\n---\n#launch\n\n## Real title'), 'Real title');
});

test('previews strip frontmatter and formatting, remove tag tokens, and never repeat the title', () => {
  const markdown = '---\ntags: [work]\n---\n# **Release plan**\n\nRelease plan\n\n- [ ] Publish the [announcement](https://example.test) #launch\n\nRead `the notes` at <https://example.test/docs>.';
  assert.equal(excerptOf(markdown), 'Publish the announcement, Read the notes at https://example.test/docs.');
  assert.equal(excerptOf('---\ntags: [work]\n---\n#work\n\n# A title\n\nA title\n\nBody **text**'), 'Body text');
});

test('previews separate source lines with commas', () => {
  assert.equal(excerptOf('# Weekly plan\n\nReview the weekly plan\nFix the pricing typo\nConfirm next steps'), 'Review the weekly plan, Fix the pricing typo, Confirm next steps');
});

test('task progress counts real Markdown task list items, including nested tasks', () => {
  assert.deepEqual(noteTaskProgress('---\ntags: [work]\n---\n# Checklist\n- [x] Done\n- [ ] Open\n  - [X] Nested\n\n```md\n- [ ] Example\n```\n\n`- [ ] Inline example`'), { done: 2, total: 3 });
  assert.equal(noteTaskProgress('A plain note\n- regular item'), null);
});

test('blank notes are excluded from queries and tag counts but remain identifiable as blank', () => {
  const active = note('active', '---\ntags: [work]\n---\n# Meeting\n\nFollow up', '2026-10-03T12:00:00.000Z');
  const empty = note('empty', '  \n\t', '2026-10-04T12:00:00.000Z');
  const emptyFrontmatter = note('frontmatter', '---\ntags: [ghost]\n---\n  ', '2026-10-05T12:00:00.000Z');
  const trashed = note('trashed', '# Gone\n#gone', '2026-10-06T12:00:00.000Z', { trashedAt: '2026-10-07T12:00:00.000Z' });
  const notes = library(active, empty, emptyFrontmatter, trashed);
  assert.equal(isBlankMarkdown(empty.markdown), true);
  assert.equal(isBlankMarkdown(emptyFrontmatter.markdown), true);
  assert.equal(isBlankMarkdown(active.markdown), false);
  assert.deepEqual(queryNotes(notes).map(item => item.id), ['active']);
  assert.deepEqual(queryNotes(notes, { includeTrash: true }).map(item => item.id), ['trashed', 'active']);
  assert.deepEqual(notebookTags(notes), [{ tag: 'work', count: 1 }]);
  assert.deepEqual(queryNotes(notes, { query: 'ghost' }), []);
});

test('recent tags are ordered by the latest updated nonblank, nontrashed note and counted once per note', () => {
  const notes = library(
    note('launch-old', '# Launch\n#launch #work #launch', '2026-10-02T12:00:00.000Z'),
    note('work-new', '# Work\n#work #archive', '2026-10-04T12:00:00.000Z'),
    note('personal', '# Personal\n#personal', '2026-10-03T12:00:00.000Z'),
    note('blank', '---\ntags: [ghost]\n---\n', '2026-10-08T12:00:00.000Z'),
    note('trashed', '# Trash\n#recent', '2026-10-09T12:00:00.000Z', { trashedAt: '2026-10-10T12:00:00.000Z' }),
  );
  assert.deepEqual(recentNotebookTags(notes), [
    { tag: 'archive', count: 1 }, { tag: 'work', count: 2 }, { tag: 'personal', count: 1 }, { tag: 'launch', count: 1 },
  ]);
});

test('archive remains excluded from ordinary scopes and selectable as its own tag', () => {
  const notes = library(
    note('current', '# Current\n\nVisible note', '2026-10-02T12:00:00.000Z'),
    note('archived', '---\ntags: [archive]\n---\n# Archived\n\nArchived note', '2026-10-03T12:00:00.000Z'),
  );
  assert.deepEqual(queryNotes(notes).map(item => item.id), ['current']);
  assert.deepEqual(queryNotes(notes, { tags: ['archive'] }).map(item => item.id), ['archived']);
});

test('notes group by their local calendar day with Today, Yesterday, and year-aware labels', () => {
  const notes = [
    note('today', '# Today', '2026-10-15T18:00:00.000Z'),
    note('yesterday', '# Yesterday', '2026-10-14T18:00:00.000Z'),
    note('older', '# Older', '2025-10-20T18:00:00.000Z'),
  ];
  const groups = groupNotesByLocalDay(notes, item => item.updatedAt, '2026-10-15T20:00:00.000Z', 'en-US', 'UTC');
  assert.deepEqual(groups.map(group => group.label), ['Today', 'Yesterday', 'Monday, Oct 20, 2025']);
  assert.deepEqual(groups.map(group => group.notes.map(item => item.id)), [['today'], ['yesterday'], ['older']]);
});
