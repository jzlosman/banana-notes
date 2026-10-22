import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost' });
for (const key of ['window', 'document', 'navigator', 'Node', 'HTMLElement', 'Element', 'MutationObserver', 'DOMParser', 'getComputedStyle', 'KeyboardEvent', 'MouseEvent', 'ClipboardEvent'] as const) {
  if (key in dom.window) Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true, writable: true });
}
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(0), 0) as any;
globalThis.cancelAnimationFrame = id => clearTimeout(id);
const { createMarkdownEditor } = await import('../src/ui/editor');
const { splitDocument, tagsOf } = await import('../src/domain');

const media = 'foldnote-asset://media/123e4567-e89b-12d3-a456-426614174000.m4a';
const documents: [string, string][] = [
  ['raw HTML callout', '<div class="callout">Important <strong>source</strong></div>\n\nEditable target'],
  ['footnotes', 'A footnote reference[^1].\n\n[^1]: Keep this definition.\n\nEditable target'],
  ['reference links', '[Guide][guide]\n\n[guide]: https://example.test/ "Guide"\n\nEditable target'],
  ['table', '| A | B |\n| --- | --- |\n| one | two |\n\nEditable target'],
  ['task and nested lists', '- [x] Parent\n  - child\n  - [ ] Nested task\n\nEditable target'],
  ['fenced code with backticks and tildes', '```ts\nconst tick = `value`;\n```\n\n~~~text\n~~~inside\n~~~\n\nEditable target'],
  ['blockquote with lists', '> Notes\n>\n> - one\n> - two\n\nEditable target'],
  ['heading trailing hashes and setext heading', '## Heading ##\n\nSetext heading\n---\n\nEditable target'],
  ['hard breaks', 'Two spaces  \nbreak and\\\nbackslash break\n\nEditable target'],
  ['escapes', '\\#hash \\*literal\\* \\_under\\_ \\[brackets\\]\n\nEditable target'],
  ['inline math', 'Euler writes $e^{i\\pi} + 1 = 0$.\n\nEditable target'],
  ['emoji and RTL', 'Emoji 🍌 and العربية שלום\n\nEditable target'],
  ['CRLF', 'First paragraph\r\n\r\n## Heading\r\n\r\nEditable target'],
  ['without trailing newline', 'First paragraph\n\nEditable target'],
  ['frontmatter', '---\ntitle: A note\ntags: [topic]\n---\n\n# Body\n\nEditable target'],
  ['very long line', `${'x'.repeat(100_000)}\n\nEditable target`],
  ['managed media and attachment syntax', `![Attachment](foldnote-asset://media/123e4567-e89b-12d3-a456-426614174000.png)\n\n<audio controls src="${media}"></audio>\n\n<video controls src="foldnote-asset://media/123e4567-e89b-12d3-a456-426614174001.mp4"></video>\n\nEditable target`],
];

function mount(markdown: string, onChange: (markdown: string) => void = () => {}) {
  const element = document.createElement('div'); document.body.append(element);
  return createMarkdownEditor(element, markdown, onChange);
}
function editTarget(editor: ReturnType<typeof mount>, inserted = '!'): void {
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  editor.commands.insertContent(inserted);
}

for (const [name, source] of documents) {
  test(`Markdown fidelity: ${name} survives load and untouched blocks`, () => {
    const { frontmatter, body } = splitDocument(source);
    const editor = mount(body);
    try {
      assert.equal(editor.getMarkdown(), body, 'loading and serializing without edits must be byte-identical');
      assert.equal(frontmatter + editor.getMarkdown(), source, 'frontmatter plus the body round-trips unchanged');
      if (name === 'raw HTML callout' || name === 'footnotes' || name === 'reference links') {
        assert.ok(editor.view.dom.querySelector('pre[aria-label="Markdown source block"]'), 'unsupported Markdown is shown as a labelled raw source block');
      }
    } finally { editor.destroy(); }
  });

  test(`Markdown fidelity: editing one block and undoing ${name}`, () => {
    const { frontmatter, body } = splitDocument(source);
    const writes: string[] = [];
    const editor = mount(body, markdown => writes.push(markdown));
    try {
      assert.equal(editor.getMarkdown(), body);
      editTarget(editor);
      assert.equal(writes.at(-1), body.replace('Editable target', 'Editable target!'), 'only the edited block changes');
      assert.equal(frontmatter + writes.at(-1), frontmatter + body.replace('Editable target', 'Editable target!'));
      assert.deepEqual(tagsOf(frontmatter + body), tagsOf(frontmatter + writes.at(-1)!), 'editing another block cannot change tags');
      assert.equal(editor.commands.undo(), true);
      assert.equal(writes.at(-1), body, 'undo restores the exact source bytes');
      assert.equal(frontmatter + writes.at(-1)!, source, 'undo restores frontmatter and body exactly');
    } finally { editor.destroy(); }
  });
}

test('identical rich-text blocks retain their own original source spelling after deletion', () => {
  const source = '**Same**\n\n__Same__\n\nEditable target';
  const writes: string[] = [];
  const editor = mount(source, markdown => writes.push(markdown));
  try {
    editor.commands.deleteRange({ from: 0, to: editor.state.doc.child(0).nodeSize });
    assert.equal(writes.at(-1), '__Same__\n\nEditable target');
  } finally { editor.destroy(); }
});

test('editing a middle block preserves source bytes on both sides', () => {
  const source = 'Untouched first.\n\nEditable target\n\nUntouched final.';
  const writes: string[] = [];
  const editor = mount(source, markdown => writes.push(markdown));
  try {
    const position = editor.state.doc.child(0).nodeSize + 1 + editor.state.doc.child(1).textContent.length;
    editor.commands.setTextSelection(position);
    editor.commands.insertContent('!');
    assert.equal(writes.at(-1), source.replace('Editable target', 'Editable target!'));
  } finally { editor.destroy(); }
});

test('editing an escaped-text paragraph retains its original Markdown escapes', () => {
  const source = String.raw`build\_id = file\_name; C:\\work\\my\_file \[literal\] \*asterisk\*`;
  const writes: string[] = [];
  const editor = mount(source, markdown => writes.push(markdown));
  try {
    assert.equal(editor.state.doc.textContent, 'build_id = file_name; C:\\work\\my_file [literal] *asterisk*');
    editTarget(editor);
    assert.equal(writes.at(-1), `${source}!`);
  } finally { editor.destroy(); }
});

test('raw media source blocks remain safe, visible and byte-identical around edits', () => {
  const source = `<div class="callout">HTML stays text</div>\n\n[^1]: Footnote stays text\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nEditable target`;
  const writes: string[] = [];
  const editor = mount(source, markdown => writes.push(markdown));
  try {
    const rawBlocks = editor.view.dom.querySelectorAll('pre[aria-label="Markdown source block"]');
    assert.ok(rawBlocks.length >= 2);
    assert.equal(editor.view.dom.querySelector('div.callout'), null, 'raw HTML is not mounted as active HTML');
    editTarget(editor);
    assert.equal(writes.at(-1), source.replace('Editable target', 'Editable target!'));
  } finally { editor.destroy(); }
});
