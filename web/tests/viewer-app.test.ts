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
  current: ViewerSnapshot = { document: { kind: 'loaded', documentID: 'document-1', name: 'Example.md', markdown: source, revision: 'r1', resourceBaseURL: 'banana-viewer-resource://document/' }, preferences: { ...DEFAULT_VIEWER_PREFERENCES }, editing: { kind: 'locked' }, externalChange: false };
  listeners = new Set<(event: ViewerEvent) => void>();
  saved: ViewerSnapshot['preferences'][] = [];
  documentSaves: string[] = [];
  failNext: Error | undefined;
  defaultAppStatus: ViewerDefaultAppStatus = { kind: 'available', state: 'off', currentAppName: 'Preview', canToggle: true };
  defaultAppOutcome: ViewerDefaultAppOutcome = { kind: 'changed' };
  pendingDefaultAppChange: ReturnType<typeof deferred<ViewerDefaultAppOutcome>> | undefined;
  defaultAppRequests: boolean[] = [];
  defaultAppQueries = 0;
  defaultAppChanges = 0;
  failDefaultAppQuery = false;
  supportsNativeOpenMenu = false;
  openMenuRequests: Array<{ x: number; y: number; width: number; height: number }> = [];
  pendingOpenMenu: ReturnType<typeof deferred<null>> | undefined;
  async bootstrap() { return this.current; }
  async open() { return null; }
  async openMenu(anchor: { x: number; y: number; width: number; height: number }) {
    this.openMenuRequests.push({ ...anchor });
    return this.pendingOpenMenu ? this.pendingOpenMenu.promise : null;
  }
  async reload() { return null; }
  async discardAndReload() { return null; }
  async unlockDocument() { this.current = { ...this.current, editing: { kind: 'unlocked', dirty: false } }; this.publish({ kind: 'snapshot', snapshot: this.current }); return this.current; }
  async lockDocument() { this.current = { ...this.current, editing: { kind: 'locked' } }; this.publish({ kind: 'snapshot', snapshot: this.current }); return this.current; }
  async setDocumentDirty(dirty: boolean) { this.current = { ...this.current, editing: { kind: 'unlocked', dirty } }; this.publish({ kind: 'snapshot', snapshot: this.current }); return this.current; }
  async keepDocumentEdits() { this.current = { ...this.current, externalChange: false }; this.publish({ kind: 'snapshot', snapshot: this.current }); return this.current; }
  async saveDocument(_expectedRevision: string, markdown: string) { this.documentSaves.push(markdown); const current = this.current.document; if (current.kind === 'loaded') this.current = { ...this.current, document: { ...current, markdown, revision: `${current.revision}-saved` }, editing: { kind: 'unlocked', dirty: false } }; this.publish({ kind: 'snapshot', snapshot: this.current }); return { kind: 'saved' as const, revision: this.current.document.kind === 'loaded' ? this.current.document.revision : 'saved' }; }
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

test('toolbar Open is an accessible folder icon that sends only its geometry to the native menu', async () => {
  const port = new MemoryPort(); port.supportsNativeOpenMenu = true;
  const { root, mounted } = app(port); await flush();
  const toolbar = root.querySelector<HTMLElement>('.viewer-toolbar')!;
  const button = toolbar.querySelector<HTMLButtonElement>('[aria-label="Open"]')!;
  assert.ok(button.classList.contains('viewer-icon-button'));
  assert.equal(button.textContent, '');
  assert.equal(button.querySelector('svg')?.getAttribute('aria-hidden'), 'true');
  assert.equal(button.title, 'Open (⌘O)');
  assert.equal(button.getAttribute('aria-haspopup'), 'menu');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(toolbar.textContent?.includes('Open…'), false, 'the old text label is gone from the toolbar');

  const anchor = { x: 18.5, y: 4, width: 30, height: 30 };
  Object.defineProperty(button, 'getBoundingClientRect', { value: () => anchor, configurable: true });
  const pending = deferred<null>(); port.pendingOpenMenu = pending;
  button.click();
  assert.deepEqual(port.openMenuRequests, [anchor]);
  assert.equal(button.getAttribute('aria-expanded'), 'true', 'the native menu is expanded while its request is active');
  pending.resolve(null); await flush();
  assert.equal(button.getAttribute('aria-expanded'), 'false', 'the expanded state clears after the menu closes');
  mounted.dispose();

  const emptyPort = new MemoryPort(); emptyPort.current = { ...emptyPort.current, document: { kind: 'empty' } };
  const { root: emptyRoot, mounted: emptyMounted } = app(emptyPort); await flush();
  assert.equal(emptyRoot.querySelector('.viewer-empty-open')?.textContent, 'Open…⌘O', 'the empty-state button remains unchanged');
  emptyMounted.dispose();
});

test('browser toolbar Open opens the file picker instead of a native menu', async () => {
  const adapter = new BrowserViewerAdapter(dom.window as unknown as Window);
  let pickerRequests = 0;
  const input = dom.window.document.querySelector<HTMLInputElement>('input[type="file"]')!;
  input.click = () => { pickerRequests++; };
  const { root, mounted } = app(adapter); await flush();
  const button = root.querySelector<HTMLButtonElement>('.viewer-toolbar [aria-label="Open"]')!;
  assert.equal(button.title, 'Open (⌘O)');
  assert.equal(button.getAttribute('aria-haspopup'), null, 'the browser fallback does not advertise a native menu');
  assert.equal(button.getAttribute('aria-expanded'), null);
  button.click(); await flush();
  assert.equal(pickerRequests, 1);
  assert.equal(button.getAttribute('aria-expanded'), null, 'the browser fallback has no native menu state');
  mounted.dispose(); adapter.dispose();
});

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
  const payload = '<script>window.webkit.messageHandlers.viewer.postMessage({action:"openMenu",rect:{x:0,y:0,width:30,height:30}})</script>\n\n<img src=x onerror="window.webkit.messageHandlers.viewer.postMessage({action:\'openMenu\',rect:{x:0,y:0,width:30,height:30}})">';
  port.current = { ...port.current, document: { ...current, markdown: payload } };
  port.publish({ kind: 'snapshot', snapshot: port.current }); await flush();
  assert.equal(root.querySelector('script'), null);
  assert.equal(root.querySelector('img[onerror]'), null);
  assert.equal(root.querySelector('[contenteditable="true"]'), null);
  assert.match(root.querySelector('.viewer-markdown')?.textContent ?? '', /<script>/);
  assert.deepEqual(port.documentSaves, []);
  assert.deepEqual(port.openMenuRequests, [], 'document content cannot trigger the privileged native menu command');
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
  const editingLabel = root.querySelector<HTMLElement>('.viewer-editing-label')!;
  assert.equal(editingLabel.textContent, 'Editing');
  assert.equal(editingLabel.getAttribute('aria-live'), 'polite');
  editor.value = source.replace('A [link]', 'Changed [link]');
  editor.dispatchEvent(new dom.window.Event('input', { bubbles: true })); await flush();
  assert.deepEqual(port.current.editing, { kind: 'unlocked', dirty: true });
  assert.equal(editingLabel.hidden, false);
  assert.equal(editingLabel.textContent, 'Unsaved');
  assert.ok(editingLabel.querySelector('.viewer-unsaved-dot'), 'dirty label includes its status dot');
  port.publish({ kind: 'command', command: 'save' }); await flush();
  assert.equal(port.documentSaves.at(-1), editor.value, 'source mode saves the exact textarea value');
  assert.deepEqual(port.current.editing, { kind: 'unlocked', dirty: false });
  assert.equal(editingLabel.textContent, 'Editing');
  assert.equal(editingLabel.querySelector('.viewer-unsaved-dot'), null);
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
    const generalPanel = root.querySelector<HTMLElement>('#viewer-settings-panel-general')!;
    assert.equal(generalPanel.getAttribute('aria-labelledby'), 'viewer-settings-tab-general');
    assert.equal(generalPanel.querySelector('h2'), null, 'the tab name is not repeated as a section heading');
    assert.ok(generalPanel.querySelector(':scope > .viewer-default-app-row'), 'the switch row is the first panel content');
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

test('toolbar controls coexist and General Settings preserves unlocked dirty source edits', async () => {
  const { root, port, mounted } = app(); await flush();
  root.querySelector<HTMLButtonElement>('[aria-label="Source"]')!.click();
  root.querySelector<HTMLButtonElement>('[aria-label="Unlock to Edit"]')!.click(); await flush();
  const editor = root.querySelector<HTMLTextAreaElement>('.viewer-source-editor')!;
  editor.value = source.replace('A [link]', 'Changed [link]');
  editor.dispatchEvent(new dom.window.Event('input', { bubbles: true })); await flush();
  assert.deepEqual(port.current.editing, { kind: 'unlocked', dirty: true });

  const toolbar = root.querySelector<HTMLElement>('.viewer-toolbar')!;
  assert.equal(toolbar.querySelector('.viewer-editing-label')?.textContent, 'Unsaved');
  assert.ok(toolbar.querySelector('.viewer-unsaved-dot'));
  assert.equal(toolbar.querySelector<HTMLButtonElement>('[aria-label="Lock"]')?.nextElementSibling?.getAttribute('aria-label'), 'Find');
  assert.ok(toolbar.querySelector('[aria-label="Settings"]'));

  toolbar.querySelector<HTMLButtonElement>('[aria-label="Settings"]')!.click();
  assert.ok(root.querySelector('.viewer-settings'));
  assert.equal(port.current.editing.kind, 'unlocked', 'opening Settings does not lock a dirty document');
  root.querySelector<HTMLButtonElement>('.viewer-done-button')!.click();
  assert.equal(root.querySelector<HTMLTextAreaElement>('.viewer-source-editor')?.value, editor.value);
  assert.deepEqual(port.current.editing, { kind: 'unlocked', dirty: true });
  assert.equal(root.querySelector<HTMLElement>('.viewer-editing-label')?.hidden, false);
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
