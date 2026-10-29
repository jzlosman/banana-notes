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
  current: ViewerSnapshot = { document: { kind: 'loaded', name: 'Example.md', markdown: source, revision: 'r1', resourceBaseURL: 'banana-viewer-resource://document/' }, preferences: { ...DEFAULT_VIEWER_PREFERENCES } };
  listeners = new Set<(event: ViewerEvent) => void>();
  saved: ViewerSnapshot['preferences'][] = [];
  failNext: Error | undefined;
  async bootstrap() { return this.current; }
  async open() { return null; }
  async reload() { return null; }
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
