import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
for (const key of ['window', 'document', 'navigator', 'Node', 'HTMLElement', 'Element', 'MutationObserver', 'DOMParser', 'getComputedStyle', 'KeyboardEvent', 'MouseEvent'] as const) Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true, writable: true });
dom.window.Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect();
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(0), 0) as any;
globalThis.cancelAnimationFrame = id => clearTimeout(id);
const { createMarkdownEditor } = await import('../src/ui/editor');
const { queryLinkSelection, applyLinkEdit, removeSelectedLink } = await import('../src/ui/editor-links');
const { openLinkEditor } = await import('../src/ui/link-editor');
const { closePopover } = await import('../src/ui/action-menu');
function mount(markdown: string, writes: string[] = []) { const host = document.createElement('div'); document.body.append(host); return createMarkdownEditor(host, markdown, text => writes.push(text)); }

test('link query is read-only; adding a link preserves selected rich text and is one undo step', () => {
  const writes: string[] = [], editor = mount('**Bold** and *italic*', writes);
  editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
  const selection = queryLinkSelection(editor)!;
  assert.equal(selection.text, 'Bold and italic'); assert.deepEqual(writes, []);
  assert.deepEqual(applyLinkEdit(editor, selection, { address: 'example.com/guide', text: selection.text }), { ok: true });
  assert.match(editor.getHTML(), /<strong>Bold<\/strong>/); assert.match(editor.getHTML(), /<em>italic<\/em>/);
  assert.ok([...editor.view.dom.querySelectorAll('a')].every(a => a.getAttribute('href') === 'https://example.com/guide'));
  assert.equal(writes.length, 1);
  editor.commands.undo(); assert.equal(editor.getMarkdown(), '**Bold** and *italic*');
  editor.destroy();
});

test('caret insertion uses a full URL label and subsequent typing is outside the link', () => {
  const editor = mount('Before '); editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  assert.deepEqual(applyLinkEdit(editor, queryLinkSelection(editor)!, { address: 'example.com', text: '' }), { ok: true });
  editor.commands.insertContent(' after');
  assert.match(editor.getMarkdown(), /\[https:\/\/example\.com\]\(https:\/\/example\.com\) after/);
  assert.equal(editor.view.dom.querySelector('a')?.textContent, 'https://example.com');
  editor.destroy();
});

test('editing part of a link edits its entire range without changing neighboring links', () => {
  const editor = mount('[First link](https://first.example) and [Second](https://second.example)'); editor.commands.setTextSelection({ from: 3, to: 6 });
  const selection = queryLinkSelection(editor)!;
  assert.equal(selection.text, 'First link'); assert.equal(selection.href, 'https://first.example');
  assert.deepEqual(applyLinkEdit(editor, selection, { address: 'https://updated.example/path', text: 'A better name' }), { ok: true });
  assert.match(editor.getMarkdown(), /\[A better name\]\(https:\/\/updated.example\/path\) and \[Second\]\(https:\/\/second.example\)/);
  editor.commands.undo(); assert.match(editor.getMarkdown(), /\[First link\]\(https:\/\/first.example\)/); editor.destroy();
});

test('changing a raw URL destination updates its unchanged raw label, not a custom label', () => {
  for (const [label, expected] of [['https://old.example/path', 'https://new.example/path'], ['Read the guide', 'Read the guide']]) {
    const editor = mount(`[${label}](https://old.example/path)`); editor.commands.setTextSelection(3);
    const selection = queryLinkSelection(editor)!;
    assert.deepEqual(applyLinkEdit(editor, selection, { address: 'https://new.example/path', text: selection.text }), { ok: true });
    assert.equal(editor.state.doc.textContent, expected); assert.equal(editor.view.dom.querySelector('a')?.getAttribute('href'), 'https://new.example/path'); editor.destroy();
  }
});

test('unlink retains text/formatting and does not immediately autolink a raw URL again', () => {
  for (const source of ['[**Important**](https://example.com)', '[https://example.com/path](https://example.com/path)']) {
    const editor = mount(source); editor.commands.setTextSelection(3); const before = editor.state.doc.textContent;
    assert.deepEqual(removeSelectedLink(editor, queryLinkSelection(editor)!), { ok: true });
    assert.equal(editor.state.doc.textContent, before); assert.equal(editor.view.dom.querySelector('a'), null);
    if (source.includes('**')) assert.equal(editor.view.dom.querySelector('strong')?.textContent, 'Important');
    editor.destroy();
  }
});

test('unsafe destinations and stale form selections cannot modify the note', () => {
  const writes: string[] = [], editor = mount('Keep this', writes); editor.commands.setTextSelection({ from: 1, to: 5 });
  const selection = queryLinkSelection(editor)!;
  assert.equal(applyLinkEdit(editor, selection, { address: 'javascript:alert(1)', text: 'New text' }).ok, false); assert.deepEqual(writes, []);
  editor.commands.insertContent('Changed'); const changed = editor.getMarkdown();
  assert.equal(applyLinkEdit(editor, selection, { address: 'https://example.com', text: 'Stale' }).ok, false); assert.equal(editor.getMarkdown(), changed); editor.destroy();
});

test('multi-paragraph link selections retain structure and formatting; code is not linked', () => {
  const editor = mount('**First**\n\nSecond'); editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
  const selection = queryLinkSelection(editor)!; assert.equal(selection.editableText, false);
  assert.deepEqual(applyLinkEdit(editor, selection, { address: 'https://example.com', text: 'Do not collapse paragraphs' }), { ok: true });
  assert.equal(editor.view.dom.querySelectorAll('p').length, 2); assert.equal(editor.view.dom.querySelector('strong')?.textContent, 'First'); assert.equal(editor.state.doc.textContent, 'FirstSecond'); editor.destroy();
  const code = mount('`code`'); code.commands.setTextSelection(2); assert.equal(queryLinkSelection(code), null); code.destroy();
});

test('display text is inserted as literal text, never interpreted as HTML or Markdown', () => {
  const editor = mount('');
  assert.deepEqual(applyLinkEdit(editor, queryLinkSelection(editor)!, { address: 'https://example.com', text: '<script>bad()</script> **literal**' }), { ok: true });
  assert.equal(editor.view.dom.querySelector('script'), null); assert.equal(editor.view.dom.querySelector('strong'), null); assert.equal(editor.state.doc.textContent, '<script>bad()</script> **literal**'); editor.destroy();
});

test('link form pre-fills selected text, validates inline and saves with Enter/submit', () => {
  const writes: string[] = [], editor = mount('Selected text', writes); editor.commands.setTextSelection({ from: 1, to: 14 });
  assert.equal(openLinkEditor(editor, editor.view.dom), true);
  const form = document.querySelector<HTMLFormElement>('.link-editor')!, address = form.querySelector<HTMLInputElement>('[name="address"]')!, text = form.querySelector<HTMLInputElement>('[name="text"]')!;
  assert.equal(form.getAttribute('aria-label'), 'Add link'); assert.equal(text.value, 'Selected text'); assert.equal(document.activeElement, address);
  address.value = 'javascript:alert(1)'; form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  assert.equal(address.getAttribute('aria-invalid'), 'true'); assert.equal(form.querySelector<HTMLElement>('[role="alert"]')?.hidden, false); assert.deepEqual(writes, []);
  address.value = 'example.com'; form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  assert.equal(document.querySelector('.link-editor'), null); assert.match(editor.getMarkdown(), /\[Selected text\]\(https:\/\/example.com\)/); assert.equal(writes.length, 1); editor.destroy();
});

test('cancel, Escape and closing the popover never save a draft', () => {
  for (const action of ['cancel', 'escape', 'close']) {
    const writes: string[] = [], editor = mount('[Existing](https://example.com)', writes); editor.commands.setTextSelection(3);
    openLinkEditor(editor, editor.view.dom);
    const form = document.querySelector('.link-editor')!; (form.querySelector('[name="text"]') as HTMLInputElement).value = 'Unsaved';
    if (action === 'cancel') [...form.querySelectorAll('button')].find(b => b.textContent === 'Cancel')!.click();
    else if (action === 'escape') document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else closePopover();
    assert.equal(document.querySelector('.link-editor'), null); assert.deepEqual(writes, []); assert.equal(editor.state.doc.textContent, 'Existing'); editor.destroy();
  }
});

test('Escape restores the writing caret rather than leaving keyboard focus on a link', async () => {
  const writes: string[] = [], editor = mount('[Existing](https://example.com)', writes); editor.commands.setTextSelection(3);
  openLinkEditor(editor, editor.view.dom.querySelector('a')!);
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(document.activeElement === editor.view.dom, true); assert.equal(editor.state.selection.from, 3); assert.deepEqual(writes, []);
  editor.destroy();
});

test('plain link clicks request editing while command/control clicks open the complete destination', () => {
  const host = document.createElement('div'); document.body.append(host); const edits: string[] = [], opened: string[] = [];
  const original = window.open; window.open = ((href: string) => { opened.push(href); return null; }) as typeof window.open;
  const editor = createMarkdownEditor(host, '[Guide](https://example.com/full/path)', () => {}, (_editor, anchor) => { edits.push(anchor.getAttribute('href')!); });
  const anchor = editor.view.dom.querySelector('a')!;
  for (const modifiers of [{}, { metaKey: true }, { ctrlKey: true }]) {
    const event = new dom.window.MouseEvent('click', modifiers); Object.defineProperty(event, 'target', { value: anchor });
    editor.view.someProp('handleClick', handler => handler(editor.view, 3, event));
  }
  assert.deepEqual(edits, ['https://example.com/full/path']); assert.deepEqual(opened, ['https://example.com/full/path', 'https://example.com/full/path']);
  editor.destroy(); window.open = original;
});
