import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { DEFAULT_VIEWER_PREFERENCES, type ViewerSnapshot } from '../src/viewer/domain/model';
import { ViewerSession } from '../src/viewer/application/session';
import type { ViewerEvent, ViewerPort } from '../src/viewer/application/ports';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/viewer.html' });
for (const key of ['window', 'document', 'navigator', 'Node', 'HTMLElement', 'Element', 'MutationObserver', 'DOMParser', 'getComputedStyle', 'KeyboardEvent', 'MouseEvent'] as const) {
  if (key in dom.window) Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true, writable: true });
}
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(0), 0) as any;
globalThis.cancelAnimationFrame = id => clearTimeout(id);
const { mountViewerApp } = await import('../src/viewer/ui/app');
const source = 'A [link](https://example.test/needle) and hel**lo**\r\n';

class MemoryPort implements ViewerPort {
  current: ViewerSnapshot = { document: { kind: 'loaded', documentID: 'document-1', name: 'Example.md', markdown: source, revision: 'r1', resourceBaseURL: 'banana-viewer-resource://document/' }, preferences: { ...DEFAULT_VIEWER_PREFERENCES }, editing: { kind: 'locked' }, externalChange: false };
  listeners = new Set<(event: ViewerEvent) => void>();
  saved: ViewerSnapshot['preferences'][] = [];
  documentSaves: string[] = [];
  failNext: Error | undefined;
  async bootstrap() { return this.current; }
  async open() { return null; }
  async reload() { return null; }
  async discardAndReload() { return null; }
  async unlockDocument() { this.current = { ...this.current, editing: { kind: 'unlocked', dirty: false } }; this.publish({ kind: 'snapshot', snapshot: this.current }); return this.current; }
  async lockDocument() { this.current = { ...this.current, editing: { kind: 'locked' } }; this.publish({ kind: 'snapshot', snapshot: this.current }); return this.current; }
  async setDocumentDirty(dirty: boolean) { this.current = { ...this.current, editing: { kind: 'unlocked', dirty } }; this.publish({ kind: 'snapshot', snapshot: this.current }); return this.current; }
  async keepDocumentEdits() { this.current = { ...this.current, externalChange: false }; this.publish({ kind: 'snapshot', snapshot: this.current }); return this.current; }
  async saveDocument(_expectedRevision: string, markdown: string) { this.documentSaves.push(markdown); const current = this.current.document; if (current.kind === 'loaded') this.current = { ...this.current, document: { ...current, markdown, revision: `${current.revision}-saved` }, editing: { kind: 'unlocked', dirty: false } }; this.publish({ kind: 'snapshot', snapshot: this.current }); return { kind: 'saved' as const, revision: this.current.document.kind === 'loaded' ? this.current.document.revision : 'saved' }; }
  async reveal() { return null; }
  async openLink(_href: string) { return null; }
  async savePreferences(preferences: ViewerSnapshot['preferences']) {
    this.saved.push(preferences);
    if (this.failNext) { const error = this.failNext; this.failNext = undefined; throw error; }
    this.current = { ...this.current, preferences };
    this.publish({ kind: 'snapshot', snapshot: this.current });
    return this.current;
  }
  subscribe(listener: (event: ViewerEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  publish(event: ViewerEvent) { for (const listener of this.listeners) listener(event); }
}
const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
function app() {
  const root = dom.window.document.createElement('div'); dom.window.document.body.append(root);
  const port = new MemoryPort(); const session = new ViewerSession(port); const mounted = mountViewerApp(root as unknown as HTMLElement, session);
  return { root, port, session, mounted };
}
function clampScrollToContent(main: HTMLElement, maximumForContent?: (reader: HTMLElement | null) => number): void {
  let position = 0;
  const maximum = () => Math.max(0, maximumForContent?.(main.querySelector<HTMLElement>('.viewer-markdown') ?? null) ??
    (main.querySelector<HTMLElement>('.viewer-markdown')?.textContent?.length ?? 0) * 2 - 20);
  Object.defineProperty(main, 'scrollTop', {
    configurable: true,
    get: () => Math.min(position, maximum()),
    set: (value: number) => { position = Math.max(0, Math.min(value, maximum())); },
  });
}

test('locked documents expose no editable textbox; unlock and lock toggle rich editing without focusing it', async () => {
  const { root, port, mounted } = app(); await flush();
  const current = port.current.document;
  assert.equal(current.kind, 'loaded');
  if (current.kind !== 'loaded') throw new Error('Expected loaded fixture.');
  port.current = { ...port.current, document: { ...current, markdown: '- [ ] A task' } };
  port.publish({ kind: 'snapshot', snapshot: port.current }); await flush();
  const lock = root.querySelector<HTMLButtonElement>('[aria-label="Unlock to Edit"]')!;
  assert.equal(root.querySelector('[contenteditable="true"]'), null);
  const checkbox = Array.from(root.getElementsByTagName('input')).find(input => input.type === 'checkbox') as HTMLInputElement;
  assert.equal(checkbox?.disabled, true);
  lock.click(); await flush();
  assert.equal(root.querySelector<HTMLButtonElement>('[aria-label="Lock"]')?.getAttribute('aria-pressed'), 'true');
  assert.equal(root.querySelector('[contenteditable="true"]'), root.querySelector('.viewer-markdown'));
  assert.equal((Array.from(root.getElementsByTagName('input')).find(input => input.type === 'checkbox') as HTMLInputElement).disabled, false);
  assert.notEqual(dom.window.document.activeElement, root.querySelector('[contenteditable="true"]'));
  root.querySelector<HTMLButtonElement>('[aria-label="Lock"]')!.click(); await flush();
  assert.equal(root.querySelector('[contenteditable="true"]'), null);
  assert.equal((Array.from(root.getElementsByTagName('input')).find(input => input.type === 'checkbox') as HTMLInputElement).disabled, true);
  mounted.dispose();
});

test('document HTML stays inert and cannot invoke the native save bridge', async () => {
  const { root, port, mounted } = app(); await flush();
  const current = port.current.document;
  assert.equal(current.kind, 'loaded');
  if (current.kind !== 'loaded') throw new Error('Expected loaded fixture.');
  const payload = '<script>window.webkit.messageHandlers.viewer.postMessage({action:"saveDocument"})</script>\n\n<img src=x onerror="window.webkit.messageHandlers.viewer.postMessage({action:\'saveDocument\'})">';
  port.current = { ...port.current, document: { ...current, markdown: payload } };
  port.publish({ kind: 'snapshot', snapshot: port.current }); await flush();
  assert.equal(root.querySelector('script'), null);
  assert.equal(root.querySelector('img[onerror]'), null);
  assert.equal(root.querySelector('[contenteditable="true"]'), null);
  assert.match(root.querySelector('.viewer-markdown')?.textContent ?? '', /<script>/);
  assert.deepEqual(port.documentSaves, []);
  mounted.dispose();
});

test('source-view unlock exposes a plain editable Markdown textarea', async () => {
  const { root, port, mounted } = app(); await flush();
  root.querySelector<HTMLButtonElement>('[aria-label="Source"]')!.click();
  root.querySelector<HTMLButtonElement>('[aria-label="Unlock to Edit"]')!.click(); await flush();
  const textarea = root.querySelector<HTMLTextAreaElement>('.viewer-source-editor');
  assert.ok(textarea instanceof dom.window.HTMLTextAreaElement);
  assert.equal(textarea.value, source.replace(/\r\n/g, '\n'));
  assert.equal(textarea.getAttribute('contenteditable'), null);
  assert.match(root.querySelector<HTMLElement>('.viewer-source-note')?.textContent ?? '', /Editing Markdown source/);
  assert.deepEqual(port.current.editing, { kind: 'unlocked', dirty: false });
  mounted.dispose();
});

test('switching an unlocked rich reader to Source preserves its document as editable Markdown', async () => {
  const { root, port, mounted } = app(); await flush();
  root.querySelector<HTMLButtonElement>('[aria-label="Unlock to Edit"]')!.click(); await flush();
  assert.ok(root.querySelector('.viewer-markdown[contenteditable="true"]'));
  root.querySelector<HTMLButtonElement>('[aria-label="Source"]')!.click(); await flush();
  const editor = root.querySelector<HTMLTextAreaElement>('.viewer-source-editor')!;
  assert.equal(editor.value, source.replace(/\r\n/g, '\n'));
  assert.deepEqual(port.current.editing, { kind: 'unlocked', dirty: false });
  editor.value = editor.value.replace('A [link]', 'Changed [link]');
  editor.dispatchEvent(new dom.window.Event('input', { bubbles: true })); await flush();
  port.publish({ kind: 'command', command: 'save' }); await flush();
  assert.equal(port.documentSaves.at(-1), editor.value);
  mounted.dispose();
});

test('dirty source edits enable explicit Save and write the exact textarea text', async () => {
  const { root, port, mounted } = app(); await flush();
  root.querySelector<HTMLButtonElement>('[aria-label="Source"]')!.click();
  root.querySelector<HTMLButtonElement>('[aria-label="Unlock to Edit"]')!.click(); await flush();
  const editor = root.querySelector<HTMLTextAreaElement>('.viewer-source-editor')!;
  editor.value = source.replace('A [link]', 'Changed [link]');
  editor.dispatchEvent(new dom.window.Event('input', { bubbles: true })); await flush();
  assert.deepEqual(port.current.editing, { kind: 'unlocked', dirty: true });
  assert.equal(root.querySelector<HTMLElement>('.viewer-editing-label')?.hidden, false);
  port.publish({ kind: 'command', command: 'save' }); await flush();
  assert.equal(port.documentSaves.at(-1), editor.value, 'source mode saves the exact textarea value');
  assert.deepEqual(port.current.editing, { kind: 'unlocked', dirty: false });
  mounted.dispose();
});

test('dirty external revisions display the conflict banner without replacing the editing surface', async () => {
  const { root, port, mounted } = app(); await flush();
  root.querySelector<HTMLButtonElement>('[aria-label="Unlock to Edit"]')!.click(); await flush();
  const editor = root.querySelector('.viewer-markdown'); assert.ok(editor);
  port.current = { ...port.current, editing: { kind: 'unlocked', dirty: true }, externalChange: true };
  port.publish({ kind: 'snapshot', snapshot: port.current }); await flush();
  assert.equal(root.querySelector('.viewer-conflict-banner')?.textContent?.includes('This file changed on disk.'), true);
  assert.strictEqual(root.querySelector('.viewer-markdown'), editor);
  mounted.dispose();
});

test('reader find counts visible text, crosses formatting, and source search uses original Markdown', async () => {
  const { root, mounted } = app(); await flush();
  const reader = root.querySelector('.viewer-markdown'); assert.ok(reader);
  const findButton = root.querySelector<HTMLButtonElement>('[aria-label="Find"]')!; findButton.click();
  const input = root.querySelector<HTMLInputElement>('[aria-label="Find in document"]')!;
  input.value = 'needle'; input.dispatchEvent(new dom.window.Event('input'));
  assert.equal(root.querySelector('.viewer-find-count')?.textContent, 'No matches', 'link destinations are not visible text');
  input.value = 'hello'; input.dispatchEvent(new dom.window.Event('input'));
  assert.equal(root.querySelector('.viewer-find-count')?.textContent, '1 of 1');
  assert.equal(dom.window.getSelection()?.toString(), 'hello', 'match spans adjacent formatting nodes');

  const sourceButton = root.querySelector<HTMLButtonElement>('[aria-label="Source"]')!; sourceButton.click();
  const sourceView = root.querySelector<HTMLElement>('.viewer-source-text')!;
  assert.equal(sourceView.textContent, source, 'source mode shows original text and line endings without serialization');
  findButton.click();
  input.value = 'needle'; input.dispatchEvent(new dom.window.Event('input'));
  assert.equal(root.querySelector('.viewer-find-count')?.textContent, '1 of 1', 'source mode searches raw Markdown, including link destinations');
  mounted.dispose();
});

test('preference-only snapshots preserve the mounted renderer; settings Done restores reader scroll and focus', async () => {
  const { root, port, mounted } = app(); await flush();
  const reader = root.querySelector('.viewer-markdown');
  const main = root.querySelector('main')!; main.scrollTop = 38;
  port.current = { ...port.current, preferences: { ...DEFAULT_VIEWER_PREFERENCES, themeID: 'banana-light' } };
  port.publish({ kind: 'snapshot', snapshot: port.current }); await flush();
  assert.strictEqual(root.querySelector('.viewer-markdown'), reader, 'preference snapshots keep the existing editor and selection surface');

  const settingsButton = root.querySelector<HTMLButtonElement>('[aria-label="Settings"]')!; settingsButton.focus(); settingsButton.click();
  assert.equal(root.querySelector('.viewer-settings h1')?.textContent, 'Settings');
  const selectedTab = root.querySelector<HTMLButtonElement>('#viewer-settings-tab-appearance')!;
  assert.equal(selectedTab.getAttribute('aria-selected'), 'true');
  assert.equal(selectedTab.tabIndex, 0, 'initial settings tab has the roving keyboard stop');
  assert.equal(root.querySelectorAll('[role="tab"][tabindex="0"]').length, 1);
  const firstTheme = root.querySelector<HTMLButtonElement>('.viewer-theme-option')!;
  assert.equal(firstTheme.getAttribute('aria-label'), 'Use Follow macOS theme');
  assert.ok(!firstTheme.textContent?.includes('Use Follow macOS theme'), 'accessible action label is not duplicated as visible card copy');
  root.querySelector<HTMLButtonElement>('.viewer-done-button')!.click();
  assert.equal(main.scrollTop, 38);
  assert.equal(dom.window.document.activeElement, settingsButton);
  mounted.dispose();
});

test('settings restores the same unlocked editor surface', async () => {
  const { root, port, mounted } = app(); await flush();
  root.querySelector<HTMLButtonElement>('[aria-label="Unlock to Edit"]')!.click(); await flush();
  const editor = root.querySelector('.viewer-markdown[contenteditable="true"]'); assert.ok(editor);
  root.querySelector<HTMLButtonElement>('[aria-label="Settings"]')!.click();
  root.querySelector<HTMLButtonElement>('.viewer-done-button')!.click();
  assert.strictEqual(root.querySelector('.viewer-markdown'), editor);
  assert.deepEqual(port.current.editing, { kind: 'unlocked', dirty: false });
  mounted.dispose();
});

test('reader keeps scroll on a same-document revision and resets for a different document', async () => {
  const { root, port, mounted } = app(); await flush();
  const main = root.querySelector<HTMLElement>('main')!;
  clampScrollToContent(main);
  main.scrollTop = 8;
  assert.equal(main.scrollTop, 8, 'the fixture has enough content to scroll');

  port.current = {
    ...port.current,
    document: { ...port.current.document as Extract<ViewerSnapshot['document'], { kind: 'loaded' }>, markdown: `${source}Updated.`, revision: 'r2' },
  };
  port.publish({ kind: 'snapshot', snapshot: port.current }); await flush();
  assert.equal(main.scrollTop, 8, 'same-file revisions preserve the current reader position');

  port.current = {
    ...port.current,
    document: { ...port.current.document as Extract<ViewerSnapshot['document'], { kind: 'loaded' }>, documentID: 'document-2', name: 'Other.md', revision: 'r1' },
  };
  port.publish({ kind: 'snapshot', snapshot: port.current }); await flush();
  assert.equal(main.scrollTop, 0, 'opening another file starts at the top even when its content matches');
  mounted.dispose();
});

test('reader reapplies same-file scroll after images settle unless the user scrolls first', async () => {
  const { root, port, mounted } = app(); await flush();
  const main = root.querySelector<HTMLElement>('main')!;
  clampScrollToContent(main, reader => reader?.querySelector('img')?.dataset.ready === 'true' ? 100 : reader?.querySelector('img') ? 4 : 100);
  main.scrollTop = 8;
  assert.equal(main.scrollTop, 8);
  const current = port.current.document;
  assert.equal(current.kind, 'loaded');
  if (current.kind !== 'loaded') throw new Error('Expected loaded fixture document.');

  port.current = { ...port.current, document: { ...current, markdown: '![board](images/board.png)', revision: 'r2' } };
  port.publish({ kind: 'snapshot', snapshot: port.current }); await flush();
  const image = main.querySelector<HTMLImageElement>('img')!;
  Object.defineProperty(image, 'complete', { configurable: true, value: false });
  assert.equal(main.scrollTop, 4, 'the new image initially clamps the restored position');
  image.dataset.ready = 'true'; image.dispatchEvent(new dom.window.Event('load'));
  assert.equal(main.scrollTop, 8, 'settling the image restores the intended position');

  const updated = port.current.document;
  assert.equal(updated.kind, 'loaded');
  if (updated.kind !== 'loaded') throw new Error('Expected loaded fixture document.');
  port.current = { ...port.current, document: { ...updated, revision: 'r3' } };
  port.publish({ kind: 'snapshot', snapshot: port.current }); await flush();
  const secondImage = main.querySelector<HTMLImageElement>('img')!;
  Object.defineProperty(secondImage, 'complete', { configurable: true, value: false });
  main.scrollTop = 2; main.dispatchEvent(new dom.window.Event('scroll'));
  secondImage.dataset.ready = 'true'; secondImage.dispatchEvent(new dom.window.Event('error'));
  assert.equal(main.scrollTop, 2, 'an image error does not override a position the user changed');
  mounted.dispose();
});

test('window controls display percentages but persist native fractional opacity and glass', async () => {
  const { root, port, mounted } = app(); await flush();
  root.querySelector<HTMLButtonElement>('[aria-label="Settings"]')!.click();
  root.querySelector<HTMLButtonElement>('#viewer-settings-tab-window')!.click();
  const focused = root.querySelector<HTMLInputElement>('#viewer-focusedOpacity')!;
  const glass = root.querySelector<HTMLInputElement>('#viewer-glass')!;
  assert.equal(focused.value, '100'); assert.equal(glass.value, '0');
  focused.value = '60'; focused.dispatchEvent(new dom.window.Event('input')); focused.dispatchEvent(new dom.window.Event('change'));
  await flush();
  glass.value = '50'; glass.dispatchEvent(new dom.window.Event('input')); glass.dispatchEvent(new dom.window.Event('change'));
  await flush();
  assert.equal(port.saved.at(-2)?.focusedOpacity, 0.6);
  assert.equal(port.saved.at(-1)?.glass, 0.5);

  port.failNext = new Error('Settings disk is unavailable.');
  root.querySelector<HTMLButtonElement>('.viewer-reset-button')!.click(); await flush();
  assert.match(root.querySelector<HTMLElement>('.viewer-settings-global-error')?.textContent ?? '', /disk is unavailable/);
  assert.equal(root.querySelector<HTMLInputElement>('#viewer-focusedOpacity')?.value, '60', 'failed settings keep the last confirmed value');
  mounted.dispose();
});
