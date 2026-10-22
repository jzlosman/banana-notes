import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
for (const key of ['window', 'document', 'navigator', 'Node', 'HTMLElement', 'Element', 'MutationObserver', 'DOMParser', 'getComputedStyle', 'KeyboardEvent', 'MouseEvent'] as const) {
  Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true, writable: true });
}
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(0), 0) as any;
globalThis.cancelAnimationFrame = id => clearTimeout(id);
const { createMarkdownEditor } = await import('../src/editor');
const { selectionClipboardPayload, documentClipboardPayload } = await import('../src/clipboard');
function mount(markdown: string) { const el = document.createElement('div'); document.body.append(el); return createMarkdownEditor(el, markdown, () => {}); }

test('partial marked selections and full structured documents retain Markdown semantics', () => {
  const editor = mount('A **bold** [link](https://example.com).');
  editor.commands.setTextSelection({ from: 4, to: 6 });
  assert.equal(selectionClipboardPayload(editor, 'markdown')?.text, '**ol**');
  editor.destroy();
  const structured = mount('# Heading\n\n- [x] Done\n- [ ] Later\n\n1. First\n2. Second\n\n| A | B |\n|---|---|\n| One | Two |\n\n```ts\nconst n = 1;\n```');
  structured.commands.selectAll();
  const markdown = selectionClipboardPayload(structured, 'markdown')!.text;
  for (const pattern of [/# Heading/, /- \[x\] Done/, /- \[ \] Later/, /1\. First/, /\| A\s*\| B/, /```ts\nconst n = 1;/]) assert.match(markdown, pattern);
  const rich = selectionClipboardPayload(structured, 'formatted')!;
  for (const tag of ['<h1>', '<ul', '<ol>', '<table', '<pre>']) assert.ok(rich.html?.includes(tag), tag);
  structured.destroy();
});
test('a failed real DOM cut is handled without ProseMirror fallback deleting text', () => {
  const editor = mount('Do not lose **this**'); editor.commands.selectAll();
  const before = editor.getMarkdown();
  const event = new dom.window.Event('cut', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { clearData() {}, setData() { throw new Error('clipboard unavailable'); } } });
  editor.view.dom.dispatchEvent(event);
  assert.ok(event.defaultPrevented); assert.equal(editor.getMarkdown(), before);
  editor.destroy();
});
test('copy clears stale rich flavors and rendering cannot create executable HTML', () => {
  const editor = mount('**Only Markdown**'); editor.commands.selectAll();
  const data: Record<string, string> = { 'text/html': '<p>stale</p>' };
  const event = new dom.window.Event('copy', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { clearData() { for (const key of Object.keys(data)) delete data[key]; }, setData(type: string, value: string) { data[type] = value; } } });
  editor.view.dom.dispatchEvent(event);
  assert.ok(event.defaultPrevented); assert.equal(data['text/html'], undefined);
  assert.equal(data['text/plain'], 'Only Markdown'); assert.equal(data['text/markdown'], '**Only Markdown**');
  editor.destroy();
  const rendered = documentClipboardPayload('<script>window.bad=true</script>\n\n[bad](javascript:alert(1))\n\n**Safe**', 'formatted');
  assert.doesNotMatch(rendered.html!, /<script|href="javascript:/i); assert.match(rendered.html!, /<strong>Safe<\/strong>/);
});
