import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
for (const key of ['window','document','navigator','Node','HTMLElement','Element','MutationObserver','DOMParser','getComputedStyle','KeyboardEvent','MouseEvent'] as const) {
  if (key in dom.window) Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true, writable: true });
}
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(0), 0) as any;
globalThis.cancelAnimationFrame = id => clearTimeout(id);
const [{ Editor }, { markdownExtensions }, { CompactLinkView }] = await Promise.all([
  import('@tiptap/core'), import('../src/ui/editor-schema'), import('../src/ui/compact-link-view'),
]);
function mount() {
  const host = document.createElement('div'); document.body.append(host);
  return new Editor({ element: host, extensions: [...markdownExtensions(), CompactLinkView], content: '[https://example.com/a/very/long/path/that/continues/with/more/segments](https://example.com/a/very/long/path/that/continues/with/more/segments)', contentType: 'markdown' });
}
test('visual compaction is a decoration only and preserves document, serialization and editable selection', () => {
  const editor = mount();
  const link = editor.view.dom.querySelector('a');
  assert.ok(link);
  const beforeDoc = JSON.stringify(editor.state.doc.toJSON());
  const beforeMarkdown = editor.getMarkdown();
  const beforeHTML = editor.getHTML();
  assert.equal(beforeMarkdown.includes('…'), false);
  assert.equal(beforeHTML.includes('compact-link-'), false);
  assert.equal(editor.state.doc.textContent, 'https://example.com/a/very/long/path/that/continues/with/more/segments');
  assert.ok(editor.view.dom.querySelector('.compact-link-label'));
  assert.equal(editor.view.dom.querySelector('.compact-link-label')?.getAttribute('aria-hidden'), 'true');
  assert.equal(editor.view.dom.querySelector('.compact-link-label')?.getAttribute('title'), 'https://example.com/a/very/long/path/that/continues/with/more/segments');
  assert.equal(JSON.stringify(editor.state.doc.toJSON()), beforeDoc);
  assert.equal(editor.getMarkdown(), beforeMarkdown);
  assert.equal(editor.getHTML(), beforeHTML);
  editor.view.dom.focus();
  editor.commands.setTextSelection(4);
  assert.equal(!!editor.view.dom.querySelector('.compact-link-label'), false, 'focused selection inside URL exposes original text');
  assert.equal(editor.getMarkdown(), beforeMarkdown);
  editor.commands.insertContent('x');
  assert.match(editor.getMarkdown(), /x/);
  editor.destroy();
});

test('blur restores compact label and descriptive labels are not compacted', () => {
  const editor = mount();
  editor.view.dom.focus();
  editor.commands.setTextSelection(4);
  assert.equal(!!editor.view.dom.querySelector('.compact-link-label'), false);
  editor.view.dom.blur();
  assert.ok(editor.view.dom.querySelector('.compact-link-label'));
  editor.commands.setContent('[Read this article](https://example.com/a/very/long/path/that/continues/with/more/segments)', { contentType: 'markdown' });
  assert.equal(!!editor.view.dom.querySelector('.compact-link-label'), false);
  editor.destroy();
});

test('clipboard reads the complete model while a compact label is visible; focus/blur never saves', async () => {
  const { selectionClipboardPayload } = await import('../src/ui/clipboard');
  const editor = mount(), full = editor.state.doc.textContent;
  let changes = 0; editor.on('update', ({ transaction }) => { if (transaction.docChanged) changes++; });
  editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
  assert.ok(editor.view.dom.querySelector('.compact-link-label'));
  assert.equal(selectionClipboardPayload(editor, 'text')?.text, full);
  assert.equal(selectionClipboardPayload(editor, 'markdown')?.text, `[${full}](${full})`);
  assert.equal(selectionClipboardPayload(editor, 'html')?.text.includes('compact-link-'), false);
  editor.view.dom.focus(); editor.view.dom.blur();
  assert.equal(changes, 0);
  editor.destroy();
});

test('mixed-mark URL labels safely remain fully visible without changing their formatting', () => {
  const editor = mount(), full = editor.state.doc.textContent;
  editor.commands.setTextSelection({ from: 10, to: 16 }); editor.commands.toggleBold();
  assert.equal(!!editor.view.dom.querySelector('.compact-link-label'), false);
  assert.equal(editor.state.doc.textContent, full); assert.ok(editor.view.dom.querySelector('strong'));
  editor.destroy();
});
