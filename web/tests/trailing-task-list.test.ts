import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { Library } from '../src/domain/library';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
for (const key of ['window','document','navigator','Node','HTMLElement','Element','MutationObserver','DOMParser','getComputedStyle','KeyboardEvent','MouseEvent','ClipboardEvent'] as const) {
  if (key in dom.window) Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true, writable: true });
}
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(0), 0) as any;
globalThis.cancelAnimationFrame = id => clearTimeout(id);
const [{ createMarkdownEditor, guardMarkdownEditor, visibleEditorText }, { Editor }, { markdownExtensions }, { markdownParserInput }, { splitDocument }, { markdownVisibleText, richTextContainsMarkdownWords }, clipboard, { LibraryCommands }, { addTagToOpenNote, removeTagFromOpenNote }] = await Promise.all([
  import('../src/ui/editor'), import('@tiptap/core'), import('../src/ui/editor-schema'), import('../src/ui/editor/markdown-parse'), import('../src/domain/library'), import('../src/domain/markdown-visibility'), import('../src/ui/clipboard'), import('../src/application/library-commands'), import('../src/ui/note-tag-actions'),
]);

function mount(markdown: string, onChange: (value: string) => void = () => {}) {
  const host = document.createElement('div'); document.body.append(host);
  return createMarkdownEditor(host, markdown, onChange);
}

const reproductions: [string, string, number][] = [
  ['heading and trailing tasks without newline', '# T\n\n- [ ] a\n- [ ] b', 2],
  ['task-only note without newline', '- [ ] a\n- [ ] b', 2],
  ['heading and trailing tasks with newline', '# T\n\n- [ ] a\n- [ ] b\n', 2],
  ['ordinary bullets without newline', '# T\n\n- a\n- b', 0],
  ['block tags frontmatter without newline', '---\ntags:\n  - button\n---\n# T\n\n- [ ] a\n- [ ] b', 2],
  ['flow tags frontmatter without newline', '---\ntags: [button]\n---\n# T\n\n- [ ] a\n- [ ] b', 2],
  ['task-only flow tags frontmatter without newline', '---\ntags: [button]\n---\n- [ ] a\n- [ ] b', 2],
  ['CRLF task list without final newline', '# T\r\n\r\n- [ ] a\r\n- [ ] b', 2],
];
for (const [name, source, taskCount] of reproductions) {
  test(`trailing-list regression: ${name}`, () => {
    const { frontmatter, body } = splitDocument(source);
    const writes: string[] = [];
    const editor = mount(body, markdown => writes.push(markdown));
    try {
      assert.equal(editor.view.dom.querySelectorAll('input[type="checkbox"]').length, taskCount);
      if (taskCount) assert.match(editor.view.dom.textContent ?? '', /a[\s\S]*b/);
      else assert.equal(editor.view.dom.querySelectorAll('ul li').length, 2);
      assert.equal(editor.getMarkdown(), body, 'opening and closing without edits retains exact source bytes');
      assert.equal(frontmatter + editor.getMarkdown(), source);
      assert.deepEqual(writes, [], 'rehydration alone does not save');
    } finally { editor.destroy(); }
  });
}

test('editing another block keeps a no-newline trailing task list and its exact ending', () => {
  const source = '# T\n\nFirst block\n\n- [ ] a\n- [ ] b';
  const writes: string[] = [];
  const editor = mount(source, markdown => writes.push(markdown));
  try {
    assert.equal(editor.getMarkdown(), source);
    const first = editor.state.doc.child(1);
    editor.view.dispatch(editor.state.tr.insertText('!', editor.state.doc.child(0).nodeSize + 1 + first.nodeSize - 2));
    assert.match(writes.at(-1) ?? '', /- \[ \] a\n- \[ \] b$/);
    assert.equal(writes.at(-1), source.replace('First block', 'First block!'));
    assert.equal(writes.at(-1)?.endsWith('\n'), false, 'the missing final newline stays missing after an unrelated edit');
  } finally { editor.destroy(); }
});

test('typing into a previously lossy trailing-task note preserves tasks in the save', () => {
  const source = '# T\n\n- [ ] a\n- [ ] b';
  const writes: string[] = [];
  const editor = mount(source, markdown => writes.push(markdown));
  try {
    // Before the fix this produced "# TEdited" and permanently discarded both tasks.
    editor.commands.insertContent('Edited');
    assert.equal(editor.view.dom.querySelectorAll('input[type="checkbox"]').length, 2);
    assert.match(writes.at(-1) ?? '', /- \[ \] a[\s\S]*- \[ \] b/);
    assert.match(writes.at(-1) ?? '', /Edited/);
  } finally { editor.destroy(); }
});

test('new-note task entry survives adding and removing a tag without rehydrating or rewriting the body', () => {
  const now = '2026-10-23T12:00:00.000Z';
  const taskBytes = '- [ ] a\n- [ ] b';
  const commands = new LibraryCommands({ now: () => now }, { next: () => 'unused' });
  let library: Library = { version: 1, activeTag: null, selectedID: 'note-1', notes: [{ id: 'note-1', markdown: '', createdAt: now, updatedAt: now }] };
  let prefix = '';
  let persisted = '';
  const host = document.createElement('div'); document.body.append(host);
  const editor = createMarkdownEditor(host, '', markdown => {
    const result = commands.edit(library, 'note-1', prefix + markdown);
    assert.equal(result.kind, 'applied');
    if (result.kind === 'applied') { library = result.library; persisted = library.notes[0].markdown; }
  });
  const originalDOM = editor.view.dom;
  const effects = {
    replaceLibrary: (next: typeof library) => { library = next; },
    setMarkdownPrefix: (next: string, markdown: string) => { prefix = next; assert.equal(markdown, library.notes[0].markdown); },
    persist: () => { persisted = library.notes[0].markdown; },
    refreshBadges: () => {}, focusEditor: () => {},
    renderNote: () => { assert.fail('metadata-only tag edits must not rehydrate the task list'); },
  };
  try {
    editor.commands.insertContent(markdownParserInput(taskBytes), { contentType: 'markdown' });
    assert.equal(editor.view.dom.querySelectorAll('input[type="checkbox"]').length, 2);
    assert.equal(editor.getMarkdown(), taskBytes);
    assert.equal(persisted, taskBytes);

    const added = addTagToOpenNote(commands, library, 'note-1', 'button', effects);
    assert.equal(added.kind, 'applied');
    assert.equal(editor.view.dom, originalDOM);
    assert.equal(editor.view.dom.querySelectorAll('input[type="checkbox"]').length, 2);
    assert.equal(library.notes[0].markdown, `---\ntags:\n  - button\n---\n${taskBytes}`);
    assert.equal(persisted, library.notes[0].markdown);
    assert.equal(library.notes[0].markdown.slice(library.notes[0].markdown.indexOf('---\n', 4) + 4), taskBytes, 'tagging leaves the exact task bytes untouched');

    const removed = removeTagFromOpenNote(commands, library, 'note-1', 'button', effects);
    assert.equal(removed.kind, 'applied');
    assert.equal(editor.view.dom, originalDOM);
    assert.equal(editor.view.dom.querySelectorAll('input[type="checkbox"]').length, 2);
    assert.equal(library.notes[0].markdown, taskBytes);
    assert.equal(persisted, taskBytes);
  } finally { editor.destroy(); host.remove(); }
});

test('clipboard Markdown parsing uses the same final-newline boundary', () => {
  const source = '- [ ] a\n- [ ] b';
  const rendered = clipboard.documentClipboardPayload(source, 'formatted');
  assert.equal((rendered.html?.match(/type="checkbox"/g) ?? []).length, 2);
  const host = document.createElement('div'); document.body.append(host);
  const editor = createMarkdownEditor(host, '', () => {});
  try {
    let prevented = false;
    const event = { clipboardData: { getData: (type: string) => type === 'text/markdown' ? source : '' }, preventDefault: () => { prevented = true; } } as unknown as ClipboardEvent;
    assert.equal(clipboard.handleEditorClipboardPaste(editor, event), true);
    assert.equal(prevented, true);
    assert.equal(editor.view.dom.querySelectorAll('input[type="checkbox"]').length, 2);
  } finally { editor.destroy(); }
});

test('the parser-boundary helper normalizes CRLF and adds a newline without changing the input', () => {
  const source = '# T\r\n\r\n- [ ] a\r\n- [ ] b';
  assert.equal(markdownParserInput(source), '# T\n\n- [ ] a\n- [ ] b\n');
  assert.equal(source.endsWith('\n'), false);
  assert.equal(markdownParserInput('Already ends\r\n'), 'Already ends\n');
});

const endingBlocks: [string, string, string][] = [
  ['ordered list', '1. First\n2. Second', 'Second'],
  ['nested task list', '- [ ] Parent\n  - [ ] Child', 'Child'],
  ['blockquote', '> Keep this quote', 'quote'],
  ['terminated fenced code', '```ts\nconst retained = true;\n```', 'retained'],
  ['unterminated fenced code', '```ts\nconst retained = true;', 'retained'],
  ['table', '| A | B |\n| - | - |\n| one | two |', 'two'],
  ['image attachment', '![Attachment label](https://example.test/image.png)', 'Attachment'],
  ['managed media attachment', '<audio controls src="foldnote-asset://media/123e4567-e89b-12d3-a456-426614174000.m4a"></audio>', ''],
  ['raw HTML', '<div class="callout">Raw HTML source</div>', 'Raw HTML source'],
  ['footnote source block', '[^1]: Keep this footnote definition', 'footnote'],
  ['heading', '## Final heading', 'heading'],
  ['horizontal rule', '---', ''],
];
for (const [name, source, visible] of endingBlocks) {
  test(`no-final-newline block sweep: ${name}`, () => {
    const editor = mount(source);
    try {
      assert.equal(editor.getMarkdown(), source, 'untouched source bytes survive parser-boundary normalization');
      if (name === 'ordered list') assert.equal(editor.view.dom.querySelectorAll('ol li').length, 2);
      if (name === 'nested task list') assert.equal(editor.view.dom.querySelectorAll('input[type="checkbox"]').length, 2);
      if (name === 'blockquote') assert.ok(editor.view.dom.querySelector('blockquote'));
      if (name.includes('fenced code')) assert.ok(editor.view.dom.querySelector('pre code'));
      if (name === 'table') assert.equal(editor.view.dom.querySelectorAll('table td').length, 2);
      if (name === 'image attachment') assert.equal(editor.view.dom.querySelector('img')?.getAttribute('alt'), 'Attachment label');
      if (name === 'managed media attachment') assert.match(editor.view.dom.querySelector('audio')?.getAttribute('src') ?? '', /123e4567/);
      if (name === 'horizontal rule') assert.ok(editor.view.dom.querySelector('hr'));
      if (visible) assert.ok(visibleEditorText(editor).includes(visible), `visible text should contain ${visible}`);
      assert.equal(richTextContainsMarkdownWords(source, visibleEditorText(editor)), true, 'visible source words are represented in the rich document');
    } finally { editor.destroy(); }
  });
}

test('frontmatter-only notes keep their metadata bytes when the rich body is empty', () => {
  const source = '---\ntags: [button]\ntitle: Metadata only\n---';
  const { frontmatter, body } = splitDocument(source);
  const editor = mount(body);
  try {
    assert.equal(body, '');
    assert.equal(frontmatter + editor.getMarkdown(), source);
  } finally { editor.destroy(); }
});

test('content-loss policy detects omitted and duplicate missing visible words', () => {
  const source = '# T\n\n- [ ] a\n- [ ] b';
  assert.equal(markdownVisibleText(source), 'T a b');
  assert.equal(richTextContainsMarkdownWords(source, 'T'), false);
  assert.equal(richTextContainsMarkdownWords('repeat repeat', 'repeat'), false);
  assert.equal(richTextContainsMarkdownWords(source, 'T a b'), true);
});

test('lossy editor guard chooses source mode, destroys the rich editor and cannot save from it', () => {
  const source = '# T\n\n- [ ] a\n- [ ] b';
  const host = document.createElement('div'); document.body.append(host);
  let saves = 0;
  const lossyEditor = new Editor({ element: host, extensions: markdownExtensions(), content: '', contentType: 'markdown', onUpdate: () => { saves++; } });
  const result = guardMarkdownEditor(source, lossyEditor);
  assert.deepEqual(result, { kind: 'source' });
  assert.equal(lossyEditor.isDestroyed, true, 'the lossy rich document is discarded before it can be edited');
  assert.equal(saves, 0, 'discarding the lossy document does not invoke the save callback');
});
