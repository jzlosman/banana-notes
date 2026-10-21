import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
for (const key of ['window','document','navigator','Node','HTMLElement','Element','MutationObserver','DOMParser','getComputedStyle','KeyboardEvent','MouseEvent','ClipboardEvent'] as const) {
  if (key in dom.window) Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true, writable: true });
}
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(0), 0) as any;
globalThis.cancelAnimationFrame = id => clearTimeout(id);
const [{ createMarkdownEditor }, clipboard] = await Promise.all([import('../src/editor'), import('../src/clipboard')]);
function mount(markdown: string) { const host = document.createElement('div'); document.body.append(host); return createMarkdownEditor(host, markdown, () => {}); }
function eventWith(data: Record<string, string> = {}) {
  let prevented = false;
  const clipboardData = { clearData: () => { for (const key of Object.keys(data)) delete data[key]; }, setData: (type: string, value: string) => { data[type] = value; }, getData: (type: string) => data[type] || '' };
  return { event: { clipboardData, preventDefault: () => { prevented = true; } } as unknown as ClipboardEvent, data, wasPrevented: () => prevented };
}
test('whole-note markdown preserves exact source; rendered formats omit valid YAML frontmatter', () => {
  const raw = '---\r\ntitle: Demo\r\n---\r\n\r\n# Hello\r\n\r\n**bold**';
  assert.equal(clipboard.documentClipboardPayload(raw, 'markdown').text, raw);
  const formatted = clipboard.documentClipboardPayload(raw, 'formatted');
  assert.match(formatted.html!, /<h1>Hello<\/h1>/); assert.match(formatted.html!, /<strong>bold<\/strong>/);
  assert.doesNotMatch(formatted.html!, /title: Demo/); assert.match(formatted.text, /Hello/);
  assert.equal(clipboard.documentClipboardPayload(raw, 'html').html, undefined);
  assert.match(clipboard.documentClipboardPayload(raw, 'html').text, /<h1>/);
  assert.doesNotMatch(clipboard.documentClipboardPayload(raw, 'text').text, /<h1>|\*\*/);
});
test('selection payload preserves inline and block structure without mutating the editor', () => {
  const editor = mount('# Heading\n\nA **bold** [link](https://example.com).\n\n- item\n');
  editor.commands.selectAll();
  const before = JSON.stringify(editor.state.doc.toJSON());
  const payload = clipboard.selectionClipboardPayload(editor, 'markdown');
  assert.ok(payload); assert.match(payload!.text, /Heading/); assert.match(payload!.text, /\*\*bold\*\*/); assert.match(payload!.text, /\[link\]/);
  assert.equal(JSON.stringify(editor.state.doc.toJSON()), before);
  editor.commands.setTextSelection(2);
  assert.equal(clipboard.selectionClipboardPayload(editor, 'markdown'), null);
  editor.destroy();
});
test('copy writes Markdown-only flavors; cut waits for a successful write and remains undoable', () => {
  const editor = mount('First **bold**\n\nSecond');
  editor.commands.setTextSelection({ from: 1, to: 11 });
  const initial = editor.getMarkdown();
  const copy = eventWith();
  assert.equal(clipboard.handleEditorClipboardCopy(editor, copy.event), true);
  assert.equal(copy.data['text/plain'], copy.data['text/markdown']); assert.equal(copy.data['text/html'], undefined);
  const cut = eventWith();
  assert.equal(clipboard.handleEditorClipboardCut(editor, cut.event), true);
  assert.notEqual(editor.getMarkdown(), initial);
  editor.commands.undo(); assert.equal(editor.getMarkdown(), initial);
  const failed = { clipboardData: { setData: () => { throw new Error('denied'); } }, preventDefault() {} } as unknown as ClipboardEvent;
  editor.commands.setTextSelection({ from: 1, to: 3 }); const before = editor.getMarkdown();
  assert.equal(clipboard.handleEditorClipboardCut(editor, failed), true); assert.equal(editor.getMarkdown(), before);
  editor.destroy();
});
test('own Markdown paste parses structure while unrelated paste remains unhandled', () => {
  const editor = mount('');
  const ordinary = eventWith({ 'text/plain': '**literal**' });
  assert.equal(clipboard.handleEditorClipboardPaste(editor, ordinary.event), false);
  const own = eventWith({ 'text/markdown': '# Pasted\n\n**bold**' });
  assert.equal(clipboard.handleEditorClipboardPaste(editor, own.event), true);
  assert.ok(editor.view.dom.querySelector('h1')); assert.ok(editor.view.dom.querySelector('strong'));
  editor.destroy();
});
