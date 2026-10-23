import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
for (const key of ['window','document','navigator','Node','HTMLElement','Element','MutationObserver','DOMParser','getComputedStyle'] as const) {
  if (key in dom.window) Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true, writable: true });
}
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(0), 0) as any;
globalThis.cancelAnimationFrame = id => clearTimeout(id);
const { buildNoteImageRequest, renderNoteImageExportControls } = await import('../src/ui/note-image');

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
  const previewOnly = renderNoteImageExportControls({ request, canExport: false, onExport: () => assert.fail('preview cannot export PNG') });
  assert.equal((previewOnly.querySelector('[data-export]') as HTMLButtonElement).disabled, true);
  assert.match(previewOnly.textContent!, /available in the Mac app/);
});

test('successful PNG export announces Saved before restoring the save action', async () => {
  let expireFeedback: (() => void) | undefined;
  const originalSetTimeout = window.setTimeout, originalClearTimeout = window.clearTimeout;
  window.setTimeout = ((callback: TimerHandler) => { if (typeof callback === 'function') expireFeedback = () => { callback(); }; return 1; }) as typeof window.setTimeout;
  window.clearTimeout = (() => {}) as typeof window.clearTimeout;
  const panel = renderNoteImageExportControls({ request: buildNoteImageRequest('# Preview', {}, 'Preview note'), onExport: async () => true });
  document.body.append(panel);
  try {
    const button = panel.querySelector<HTMLButtonElement>('[data-export]')!;
    button.click(); await Promise.resolve();
    assert.equal(panel.querySelector('[role="status"]')?.textContent, 'Saved');
    assert.equal(button.textContent, 'Saved'); assert.equal(button.disabled, false);
    expireFeedback?.();
    assert.equal(panel.querySelector('[role="status"]')?.textContent, ''); assert.equal(button.textContent, 'Save PNG…');
  } finally {
    panel.remove(); window.setTimeout = originalSetTimeout; window.clearTimeout = originalClearTimeout;
  }
});
