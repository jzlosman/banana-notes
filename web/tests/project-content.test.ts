import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNote, updateNote, type Library, type Note } from '../src/domain';
import { projectContent, toggleProjectedTask } from '../src/domain/project-content';
import { createProjectViewState, renderProjectView } from '../src/ui/project-view';
import { JSDOM } from 'jsdom';
const time = '2026-10-01T12:00:00.000Z';
const note = (id: string, markdown: string): Note => ({ id, markdown, createdAt: time, updatedAt: time });
function library(notes: Note[]): Library { return { version: 1, notes, selectedID: notes[0]?.id ?? null, activeTag: null }; }
test('projects tasks across a five-note tag-scoped input with note metadata and media/links', () => {
  const notes = [
    note('a', '---\ntags: [work]\n---\n# Alpha\n- [ ] first task\n- [x] done\n![diagram](foldnote-asset://media/123e4567-e89b-12d3-a456-426614174000.png)\n[site](https://example.com)'),
    note('b', '# Beta\n  - [ ] nested task\n<https://example.org/path>'),
    note('c', '# Gamma\n1. [ ] numbered task\n[audio](foldnote-asset://media/123e4567-e89b-12d3-a456-426614174001.mp3)'),
    note('d', '# Delta\n- [ ] same duplicate task'), note('e', '# Epsilon\n- [ ] same duplicate task'),
  ];
  const content = projectContent(notes);
  assert.equal(content.counts.notes, 5); assert.equal(content.counts.tasks, 6);
  assert.deepEqual(content.tasks.filter(t => t.label === 'same duplicate task').map(t => t.noteID), ['d', 'e']);
  assert.ok(content.tasks[0].tags.includes('work')); assert.equal(content.media.length, 2);
  assert.deepEqual(content.media.map(m => m.kind), ['image', 'audio']);
  assert.deepEqual(content.links.map(l => l.url), ['https://example.com', 'https://example.org/path']);
});
test('ignores valid YAML frontmatter, fenced and indented code, and inline examples', () => {
  const content = projectContent([note('n', '---\ntitle: "- [ ] yaml example"\ntags: [tasks]\n---\n```md\n- [ ] fenced\n[hidden](https://hidden.test)\n```\n\n    - [ ] indented\n\nAn inline example: `- [ ] inline` and `https://inline.test`.\n- [ ] visible')]);
  assert.deepEqual(content.tasks.map(t => t.label), ['visible']); assert.deepEqual(content.links, []);
});
test('task write-through checks full source freshness and changes only the referenced marker', () => {
  const markdown = '---\r\ntags: [work]\r\ncustom: keep\r\n---\r\n# Tasks\r\n- [ ] duplicate\r\n- [ ] duplicate\r\n';
  const original = note('n', markdown), lib = library([original]);
  const [first, second] = projectContent([original]).tasks;
  assert.notEqual(first.markerOffset, second.markerOffset);
  const result = toggleProjectedTask(lib, first, true, '2026-10-02T12:00:00.000Z');
  assert.equal(result.ok, true);
  if (result.ok) {
    const next = result.library.notes[0].markdown;
    assert.equal(next, markdown.replace('- [ ] duplicate', '- [x] duplicate'));
    assert.equal(next.replace(/[^\r]/g, '').length, markdown.replace(/[^\r]/g, '').length);
    assert.ok(next.startsWith('---\r\ntags: [work]\r\ncustom: keep\r\n---\r\n'));
  }
  const changed = updateNote(lib, 'n', markdown + 'new content', time);
  assert.deepEqual(toggleProjectedTask(changed, first, true, time), { ok: false, error: 'stale-source' });
  const trashed = { ...lib, notes: [{ ...original, trashedAt: time }] };
  assert.deepEqual(toggleProjectedTask(trashed, first, true, time), { ok: false, error: 'trashed-note' });
  assert.equal(second.noteID, first.noteID);
});
test('deduplicates links per note, excludes managed assets from links, and marks unsafe schemes', () => {
  const result = projectContent([note('n', '[one](https://same.test) [again](https://same.test) [mail](mailto:a@example.com) [bad](javascript:alert(1))\n[x](foldnote-asset://media/123e4567-e89b-12d3-a456-426614174001.mp4)')]);
  assert.equal(result.links.length, 3); assert.equal(result.links[0].safe, true); assert.equal(result.links[1].safe, true);
  assert.equal(result.links[2].safe, false); assert.equal(result.media.length, 1); assert.equal(result.media[0].kind, 'video');
});
test('task spans preserve UTF-16 and CRLF offsets, nested tasks survive while code and examples do not', () => {
  const markdown = '---\r\ntags: [work]\r\n---\r\n😀 before\r\n- [ ] first\r\n- parent\r\n    - [ ] nested\r\n\r\n    - [ ] standalone code\r\n\\- [ ] escaped example\r\n';
  const original = note('n', markdown), tasks = projectContent([original]).tasks;
  assert.deepEqual(tasks.map(task => task.label), ['first', 'nested']);
  for (const task of tasks) assert.equal(markdown[task.markerOffset], ' ');
  const result = toggleProjectedTask(library([original]), tasks[0], true, time);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.library.notes[0].markdown, markdown.replace('- [ ] first', '- [x] first'));
});
test('projects bare autolinks and deduplicates media and links per note', () => {
  const url = 'foldnote-asset://media/123e4567-e89b-12d3-a456-426614174000.png';
  const result = projectContent([note('n', `😀 https://example.test/path <https://example.test/path> ![one](${url}) ![two](${url})`)]);
  assert.equal(result.links.length, 1); assert.equal(result.media.length, 1);
});
test('project view preserves external state and reports failed task callbacks with rollback', async () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  Object.assign(globalThis, { document: dom.window.document });
  const state = createProjectViewState(); state.section = 'tasks';
  const errors: Error[] = [];
  const view = renderProjectView({ notes: [note('n', '- [ ] task')], state, onOpenNote() {}, onToggleTask: async () => { throw new Error('failed'); }, onError: error => errors.push(error) });
  assert.equal(view.querySelector('#project-panel')?.id, 'project-panel');
  assert.equal(view.querySelector('[role="tab"][aria-selected="true"]')?.id, 'project-tab-tasks');
  const checkbox = view.querySelector('input[type="checkbox"]') as HTMLInputElement;
  checkbox.checked = true; checkbox.dispatchEvent(new dom.window.Event('change'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(checkbox.checked, false); assert.equal(errors[0]?.message, 'failed');
  dom.window.close(); delete (globalThis as { document?: Document }).document;
});
test('safe audio/video HTML syntax projects only managed media URLs', () => {
  const result = projectContent([note('n', '<audio controls src="foldnote-asset://media/123e4567-e89b-12d3-a456-426614174001.mp3"></audio>\n<video src="https://outside.test/a.mp4"></video>')]);
  assert.equal(result.media.length, 1); assert.equal(result.media[0].kind, 'audio');
});
