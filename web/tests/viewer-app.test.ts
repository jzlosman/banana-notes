import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { BrowserViewerAdapter } from '../src/viewer/adapters/browser-viewer';
import { DEFAULT_VIEWER_PREFERENCES, type ViewerDefaultAppOutcome, type ViewerDefaultAppStatus, type ViewerSnapshot } from '../src/viewer/domain/model';
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
  current: ViewerSnapshot = { document: { kind: 'loaded', documentID: 'document-1', name: 'Example.md', markdown: source, revision: 'r1', resourceBaseURL: 'banana-viewer-resource://document/' }, preferences: { ...DEFAULT_VIEWER_PREFERENCES } };
  listeners = new Set<(event: ViewerEvent) => void>();
  saved: ViewerSnapshot['preferences'][] = [];
  failNext: Error | undefined;
  defaultAppStatus: ViewerDefaultAppStatus = { kind: 'available', state: 'off', currentAppName: 'Preview', canToggle: true };
  defaultAppOutcome: ViewerDefaultAppOutcome = { kind: 'changed' };
  pendingDefaultAppChange: ReturnType<typeof deferred<ViewerDefaultAppOutcome>> | undefined;
  defaultAppRequests: boolean[] = [];
  defaultAppQueries = 0;
  defaultAppChanges = 0;
  failDefaultAppQuery = false;
  async bootstrap() { return this.current; }
  async open() { return null; }
  async reload() { return null; }
  async reveal() { return null; }
  async openLink(_href: string) { return null; }
  async queryDefaultAppStatus() {
    this.defaultAppQueries++;
    if (this.failDefaultAppQuery) throw new Error('Launch Services could not be queried.');
    return this.defaultAppStatus;
  }
  async setDefaultApp(enabled: boolean) {
    this.defaultAppChanges++; this.defaultAppRequests.push(enabled);
    const pending = this.pendingDefaultAppChange; this.pendingDefaultAppChange = undefined;
    const outcome = pending ? await pending.promise : this.defaultAppOutcome;
    if (outcome.kind === 'changed') this.defaultAppStatus = enabled
      ? { kind: 'available', state: 'on', canToggle: true, previousAppName: 'Preview' }
      : { kind: 'available', state: 'off', currentAppName: 'Preview', canToggle: true };
    return outcome;
  }
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
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
function app<T extends ViewerPort = MemoryPort>(port: T = new MemoryPort() as unknown as T) {
  const root = dom.window.document.createElement('div'); dom.window.document.body.append(root);
  const session = new ViewerSession(port); const mounted = mountViewerApp(root as unknown as HTMLElement, session);
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
  const selectedTab = root.querySelector<HTMLButtonElement>('#viewer-settings-tab-general')!;
  assert.equal(selectedTab.getAttribute('aria-selected'), 'true');
  assert.equal(selectedTab.tabIndex, 0, 'General is the initial settings tab and has the roving keyboard stop');
  assert.equal(root.querySelectorAll('[role="tab"][tabindex="0"]').length, 1);
  const firstTheme = root.querySelector<HTMLButtonElement>('.viewer-theme-option')!;
  assert.equal(firstTheme.getAttribute('aria-label'), 'Use Follow macOS theme');
  assert.ok(!firstTheme.textContent?.includes('Use Follow macOS theme'), 'accessible action label is not duplicated as visible card copy');
  root.querySelector<HTMLButtonElement>('.viewer-done-button')!.click();
  assert.equal(main.scrollTop, 38);
  assert.equal(dom.window.document.activeElement, settingsButton);
  mounted.dispose();
});

test('General settings renders an accessible default-app switch without offering impossible actions', async () => {
  const variants: [ViewerDefaultAppStatus, string, string, boolean][] = [
    [{ kind: 'available', state: 'off', currentAppName: 'Xcode', canToggle: true }, 'Markdown files open in Xcode.', 'false', false],
    [{ kind: 'available', state: 'off', currentAppName: null, canToggle: true }, 'Markdown files have no default app.', 'false', false],
    [{ kind: 'available', state: 'on', canToggle: true, previousAppName: 'Xcode' }, 'Turn off to go back to Xcode.', 'true', false],
    [{ kind: 'available', state: 'on', canToggle: false, previousAppName: null }, 'Change the default app in Finder’s Get Info.', 'true', true],
    [{ kind: 'unavailable' }, 'Available in the Mac app.', 'false', true],
  ];
  for (const [status, expectedText, checked, disabled] of variants) {
    const port = new MemoryPort(); port.defaultAppStatus = status;
    const { root, mounted } = app(port); await flush();
    root.querySelector<HTMLButtonElement>('[aria-label="Settings"]')!.click(); await flush();
    assert.equal(root.querySelector<HTMLButtonElement>('#viewer-settings-tab-general')?.getAttribute('aria-selected'), 'true');
    assert.equal(root.querySelector('#viewer-settings-tab-default-app'), null, 'the former Default app tab is removed');
    assert.equal(root.querySelector('.viewer-default-app-label')?.textContent, 'Open Markdown files with Banana Viewer');
    const toggle = root.querySelector<HTMLButtonElement>('.viewer-default-app-switch')!;
    assert.equal(toggle.tagName, 'BUTTON');
    assert.equal(toggle.getAttribute('role'), 'switch');
    assert.equal(toggle.getAttribute('aria-labelledby'), 'viewer-default-app-label');
    assert.equal(toggle.getAttribute('aria-describedby'), 'viewer-default-app-caption');
    assert.equal(toggle.getAttribute('aria-checked'), checked);
    assert.equal(toggle.disabled, disabled);
    assert.equal(root.querySelector('.viewer-default-app-caption')?.textContent, expectedText);
    mounted.dispose();
  }
});

test('default-app switch announces pending state, toggles both ways, and refreshes when Settings reopens', async () => {
  const port = new MemoryPort(); const pending = deferred<ViewerDefaultAppOutcome>(); port.pendingDefaultAppChange = pending;
  const { root, mounted } = app(port); await flush();
  const settingsButton = root.querySelector<HTMLButtonElement>('[aria-label="Settings"]')!;
  settingsButton.click(); await flush();
  assert.equal(port.defaultAppQueries, 1, 'opening Settings queries the current system default');
  const toggle = root.querySelector<HTMLButtonElement>('.viewer-default-app-switch')!;
  toggle.click(); await flush();
  assert.deepEqual(port.defaultAppRequests, [true], 'only the explicit switch click sends the enable command');
  assert.equal(toggle.getAttribute('aria-checked'), 'true', 'pending state reflects the requested value');
  assert.equal(toggle.disabled, true);
  assert.equal(root.querySelector('.viewer-default-app-row')?.getAttribute('aria-busy'), 'true');
  assert.equal(root.querySelector('.viewer-default-app-caption')?.textContent, 'Changing the default app…');
  pending.resolve({ kind: 'changed' }); await flush();
  assert.equal(port.defaultAppQueries, 2, 'status is queried again after the system request');
  assert.equal(toggle.getAttribute('aria-checked'), 'true');
  assert.equal(toggle.disabled, false);
  assert.equal(root.querySelector('.viewer-default-app-caption')?.textContent, 'Turn off to go back to Preview.');

  toggle.click(); await flush();
  assert.deepEqual(port.defaultAppRequests, [true, false], 'turning the switch off restores the remembered app');
  assert.equal(toggle.getAttribute('aria-checked'), 'false');
  assert.equal(root.querySelector('.viewer-default-app-caption')?.textContent, 'Markdown files open in Preview.');
  assert.equal(port.defaultAppQueries, 3);

  root.querySelector<HTMLButtonElement>('.viewer-done-button')!.click();
  port.defaultAppStatus = { kind: 'available', state: 'off', currentAppName: null, canToggle: true };
  settingsButton.click(); await flush();
  assert.equal(port.defaultAppQueries, 4, 'reopening Settings refreshes changes made outside the app');
  assert.equal(root.querySelector('.viewer-default-app-caption')?.textContent, 'Markdown files have no default app.');
  mounted.dispose();
});

test('failed default-app requests restore the confirmed switch value and use caption error styling', async () => {
  const port = new MemoryPort(); port.defaultAppOutcome = { kind: 'declinedOrFailed' };
  const { root, mounted } = app(port); await flush();
  root.querySelector<HTMLButtonElement>('[aria-label="Settings"]')!.click(); await flush();
  const toggle = root.querySelector<HTMLButtonElement>('.viewer-default-app-switch')!;
  toggle.click(); await flush();
  assert.equal(port.defaultAppChanges, 1);
  assert.equal(port.defaultAppQueries, 2);
  assert.equal(toggle.getAttribute('aria-checked'), 'false', 'a failure returns to the last confirmed value');
  assert.equal(root.querySelector('.viewer-default-app-caption')?.textContent, 'macOS didn’t change the default app.');
  assert.ok(root.querySelector('.viewer-default-app-caption')?.classList.contains('is-error'));
  assert.equal(root.querySelector<HTMLElement>('.viewer-settings-global-error')?.hidden, true, 'the inline caption owns the switch error');
  mounted.dispose();
});

test('default-app status query failure leaves the switch disabled and reports locally', async () => {
  const port = new MemoryPort(); port.failDefaultAppQuery = true;
  const { root, mounted } = app(port); await flush();
  root.querySelector<HTMLButtonElement>('[aria-label="Settings"]')!.click(); await flush();
  assert.equal(root.querySelector('.viewer-default-app-caption')?.textContent, 'macOS couldn’t check the default app.');
  assert.equal(root.querySelector<HTMLButtonElement>('.viewer-default-app-switch')?.disabled, true);
  mounted.dispose();
});

test('browser preview reports the default app as unavailable', async () => {
  const adapter = new BrowserViewerAdapter(dom.window as unknown as Window);
  const { root, mounted } = app(adapter); await flush();
  root.querySelector<HTMLButtonElement>('[aria-label="Settings"]')!.click(); await flush();
  assert.deepEqual(await adapter.queryDefaultAppStatus(), { kind: 'unavailable' });
  assert.equal(root.querySelector('.viewer-default-app-caption')?.textContent, 'Available in the Mac app.');
  assert.equal(root.querySelector<HTMLButtonElement>('.viewer-default-app-switch')?.disabled, true);
  mounted.dispose(); adapter.dispose();
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
