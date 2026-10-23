import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as libraryDomain from '../src/domain/library';
import { LibraryCommands } from '../src/application/library-commands';
import { addTagToOpenNote, removeTagFromOpenNote } from '../src/ui/note-tag-actions';
import { renderNoteTagControls } from '../src/ui/note-tag-controls';
import type { Library } from '../src/domain/library';

const dom = new JSDOM('<!doctype html><main id="root"></main>', { url: 'https://tag-editing.test' });
const previous = {
  window: Object.getOwnPropertyDescriptor(globalThis, 'window'),
  document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
  requestAnimationFrame: Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame'),
  cancelAnimationFrame: Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame'),
};
Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(0), 0) as any;
globalThis.cancelAnimationFrame = id => clearTimeout(id);
const { createMarkdownEditor } = await import('../src/ui/editor');
const now = '2026-10-23T12:00:00.000Z';
const makeLibrary = (markdown = ''): Library => ({
  version: 1,
  activeTag: null,
  selectedID: 'note-1',
  notes: [{ id: 'note-1', markdown, createdAt: now, updatedAt: now }],
});
const commands = () => new LibraryCommands({ now: () => now }, { next: () => 'unused' });

test('tagging a freshly written note keeps the live editor and syncs its frontmatter for later edits', () => {

  let library = makeLibrary();
  let prefix = '';
  let syncedMarkdown = '';
  let persisted = '';
  const editorHost = document.createElement('div'); document.body.append(editorHost);
  const editor = createMarkdownEditor(editorHost, '', markdown => {
    const result = commands().edit(library, 'note-1', prefix + markdown);
    assert.equal(result.kind, 'applied');
    if (result.kind === 'applied') { library = result.library; persisted = library.notes[0].markdown; }
  });
  editor.commands.insertContent('Fresh note content stays visible.');
  const originalDOM = editor.view.dom;
  const originalMarkdown = editor.getMarkdown();
  assert.equal(persisted, originalMarkdown);

  addTagToOpenNote(commands(), library, 'note-1', 'launch', {
    replaceLibrary: next => { library = next; },
    setMarkdownPrefix: (next, markdown) => { prefix = next; syncedMarkdown = markdown; },
    persist: () => { persisted = library.notes[0].markdown; },
    refreshBadges: () => {},
    focusEditor: () => { editor.commands.focus(); },
    renderNote: () => {},
  });

  assert.equal(editor.view.dom, originalDOM, 'metadata-only tag edits must not tear down the editor');
  assert.equal(editor.getMarkdown(), originalMarkdown);
  assert.equal(library.notes[0].markdown, '---\ntags:\n  - launch\n---\nFresh note content stays visible.');
  assert.equal(persisted, library.notes[0].markdown);
  assert.equal(syncedMarkdown, library.notes[0].markdown);
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  editor.commands.insertContent(' More text after tagging.');
  assert.equal(persisted, '---\ntags:\n  - launch\n---\nFresh note content stays visible. More text after tagging.');
  assert.equal(editor.view.dom.textContent, 'Fresh note content stays visible. More text after tagging.');
  editor.destroy(); editorHost.remove();
});

test('removing a frontmatter-only tag keeps the live editor attached and preserves subsequent edits', () => {
  let library = makeLibrary('---\ntags: [launch, work]\n---\nExisting note content.');
  let prefix = library.notes[0].markdown.slice(0, library.notes[0].markdown.indexOf('Existing'));
  let persisted = library.notes[0].markdown;
  const editorHost = document.createElement('div'); document.body.append(editorHost);
  const editor = createMarkdownEditor(editorHost, 'Existing note content.', markdown => {
    const result = commands().edit(library, 'note-1', prefix + markdown);
    assert.equal(result.kind, 'applied');
    if (result.kind === 'applied') { library = result.library; persisted = library.notes[0].markdown; }
  });
  const originalDOM = editor.view.dom;
  let rendered = false;
  const result = removeTagFromOpenNote(commands(), library, 'note-1', 'launch', {
    replaceLibrary: next => { library = next; },
    setMarkdownPrefix: next => { prefix = next; },
    persist: () => { persisted = library.notes[0].markdown; },
    refreshBadges: () => {},
    focusEditor: () => { editor.commands.focus(); },
    renderNote: () => { rendered = true; },
  });
  assert.equal(result.kind, 'applied');
  assert.equal(rendered, false);
  assert.equal(editor.view.dom, originalDOM);
  assert.equal(persisted, '---\ntags: [work]\n---\nExisting note content.');
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  editor.commands.insertContent(' Added after removal.');
  assert.equal(persisted, '---\ntags: [work]\n---\nExisting note content. Added after removal.');
  editor.destroy(); editorHost.remove();
});

test('typing an inline tag in a new note and continuing to type keeps the content in the editor and library', () => {
  let library = makeLibrary();
  let persisted = '';
  const editorHost = document.createElement('div'); document.body.append(editorHost);
  const editor = createMarkdownEditor(editorHost, '', markdown => {
    const result = commands().edit(library, 'note-1', markdown);
    assert.equal(result.kind, 'applied');
    if (result.kind === 'applied') { library = result.library; persisted = library.notes[0].markdown; }
  });
  editor.commands.insertContent('Inline content #launch stays visible.');
  assert.deepEqual(libraryDomain.tagsOf(library.notes[0].markdown), ['launch']);
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  editor.commands.insertContent(' Further typing is safe.');
  assert.equal(persisted, 'Inline content #launch stays visible. Further typing is safe.');
  assert.equal(editor.view.dom.textContent, persisted);
  editor.destroy(); editorHost.remove();
});

test('domain tag removal deletes frontmatter and inline tags without changing unrelated Markdown bytes', () => {
  const markdown = '---\ntags:\n  - launch\n  - work\ntitle: Keep this title\n---\n# Keep this heading\n\nA #launch tag, and `#launch` code.\n';
  const updated = libraryDomain.removeTag(markdown, 'launch');
  const parts = libraryDomain.splitDocument(updated);
  assert.deepEqual(libraryDomain.tagsOf(updated), ['work']);
  assert.equal(parts.body, '# Keep this heading\n\nA  tag, and `#launch` code.\n');
  assert.deepEqual(parts.metadata, { tags: ['work'], title: 'Keep this title' });
});

test('scalar tag frontmatter removes one value without reserializing neighboring YAML or the Markdown body', () => {
  const markdown = '---\ntag: launch, work\ntitle :  Keep this spacing\n---\nBody #launch remains only if inline; `#launch` stays code.';
  const updated = libraryDomain.removeTag(markdown, 'launch');
  assert.equal(updated, '---\ntag: work\ntitle :  Keep this spacing\n---\nBody  remains only if inline; `#launch` stays code.');
});

test('removing the final frontmatter tag drops the generated tag-only scaffold but preserves note bytes', () => {
  assert.equal(libraryDomain.removeTag('---\ntags:\n  - launch\n---\nKeep  every other byte.\r\n', 'launch'), 'Keep  every other byte.\r\n');
});

test('library command removes a tag from only the requested note', () => {
  const useCases = commands();
  assert.equal(typeof useCases.removeTag, 'function', 'tag removal belongs in the library command boundary');
  const library: Library = { ...makeLibrary('---\ntags: [launch, work]\n---\nBody #launch'), notes: [
    { id: 'note-1', markdown: '---\ntags: [launch, work]\n---\nBody #launch', createdAt: now, updatedAt: now },
    { id: 'note-2', markdown: '---\ntags: [launch]\n---\nOther note', createdAt: now, updatedAt: now },
  ] };
  const result = useCases.removeTag(library, 'note-1', 'launch');
  assert.equal(result.kind, 'applied');
  assert.equal(result.library.notes.find((note: { id: string }) => note.id === 'note-1')?.markdown, '---\ntags: [work]\n---\nBody ');
  assert.equal(result.library.notes.find((note: { id: string }) => note.id === 'note-2')?.markdown, '---\ntags: [launch]\n---\nOther note');
  assert.equal(result.library.notes.find((note: { id: string }) => note.id === 'note-1')?.updatedAt, now);
});

test('note tag controls keep overview clicks separate from an accessible remove button', () => {
  const root = document.createElement('div'); document.body.append(root);
  let overviewClicks = 0;
  let removals = 0;
  renderNoteTagControls(root, ['launch'], {
    onOverview: () => { overviewClicks++; },
    onRemove: () => { removals++; },
  });
  const overview = root.querySelector<HTMLButtonElement>('[aria-label="Open #launch notebook overview"]');
  const remove = root.querySelector<HTMLButtonElement>('[aria-label="Remove tag launch"]');
  assert.ok(overview); assert.ok(remove);
  assert.equal(remove.type, 'button');
  assert.equal(remove.tabIndex, 0);
  overview.click();
  assert.equal(overviewClicks, 1); assert.equal(removals, 0);
  remove.focus(); assert.equal(document.activeElement, remove);
  remove.click();
  assert.equal(overviewClicks, 1); assert.equal(removals, 1, 'removal must not trigger the overview action');
});

test('library add-tag command is idempotent for an already present tag', () => {
  const library = makeLibrary('---\ntags: [launch]\n---\nUnchanged body.');
  const result = commands().addTag(library, 'note-1', '#launch');
  assert.equal(result.kind, 'applied');
  if (result.kind === 'applied') assert.equal(result.library, library);
});

test('the tag-removal command is a no-op for a tag absent from the note', () => {
  const useCases = commands();
  const library = makeLibrary('Keep this note.');
  const result = useCases.removeTag(library, 'note-1', 'missing');
  assert.equal(result.kind, 'applied');
  assert.equal(result.library.notes[0].markdown, 'Keep this note.');
  assert.equal(result.library.notes[0].updatedAt, now);
});

test('tag-editing DOM setup is restored after tests', () => {
  if (previous.window) Object.defineProperty(globalThis, 'window', previous.window); else delete (globalThis as any).window;
  if (previous.document) Object.defineProperty(globalThis, 'document', previous.document); else delete (globalThis as any).document;
  if (previous.requestAnimationFrame) Object.defineProperty(globalThis, 'requestAnimationFrame', previous.requestAnimationFrame); else delete (globalThis as any).requestAnimationFrame;
  if (previous.cancelAnimationFrame) Object.defineProperty(globalThis, 'cancelAnimationFrame', previous.cancelAnimationFrame); else delete (globalThis as any).cancelAnimationFrame;
  dom.window.close();
});
