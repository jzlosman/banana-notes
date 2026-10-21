import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
for (const key of ['window','document','navigator','Node','HTMLElement','Element','MutationObserver','DOMParser','getComputedStyle'] as const) {
  if (key in dom.window) Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true, writable: true });
}
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(0), 0) as any;
globalThis.cancelAnimationFrame = id => clearTimeout(id);
const { buildNoteImageRequest, renderNoteImageExportControls } = await import('../src/note-image');

test('image request serializes formatted markdown without changing source and validates style values', () => {
  const source = '---\ntitle: Hidden\n---\n\n# Hello\n\n```ts\nconst n = 42\n```';
  const request = buildNoteImageRequest(source, { gradient: 'ocean', paper: '#fefefe', width: 900 }, 'Card');
  assert.equal(request.title, 'Card'); assert.match(request.html, /<h1>Hello<\/h1>/); assert.match(request.html, /<pre/);
  assert.doesNotMatch(request.html, /title: Hidden/); assert.equal(request.width, 900); assert.equal(request.backgroundStart, '#c4e7ed');
  assert.equal(buildNoteImageRequest('# x', { paper: 'url(evil)' }).paper, '#ffffff');
});
test('export controls show a visual preview and return selected preset and width', () => {
  const request = buildNoteImageRequest('# Preview', {}, 'Preview note');
  let exported: any;
  const panel = renderNoteImageExportControls({ request, onExport: value => { exported = value; } });
  document.body.append(panel);
  assert.match(panel.querySelector('.note-image-preview')!.textContent!, /Preview note/);
  panel.querySelector<HTMLSelectElement>('[data-gradient]')!.value = 'dawn';
  panel.querySelector<HTMLSelectElement>('[data-gradient]')!.dispatchEvent(new dom.window.Event('change'));
  panel.querySelector<HTMLInputElement>('[data-width]')!.value = '920';
  panel.querySelector('[data-export]')!.dispatchEvent(new dom.window.MouseEvent('click'));
  assert.equal(exported.width, 920); assert.equal(exported.backgroundStart, '#f6d6b8');
});
