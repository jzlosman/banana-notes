import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { Capabilities, HotkeyState } from '../src/application/ports';

function installDOM() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ['document', 'window', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement', 'Element', 'Node', 'navigator'] as const) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: (dom.window as any)[key] });
  }
  return { dom, restore: () => {
    for (const [key, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key];
    dom.window.close();
  } };
}

const initial: HotkeyState = { keyCode: 49, modifiers: (1 << 12) | (1 << 9), display: '⌃⇧Space', registered: true, available: true };
function capabilities(hotkey: Capabilities['hotkey']): Capabilities {
  return { hotkey, startup: null, dataFolder: null, ocr: null, features: { setOCR: async (ocrEnabled: boolean) => ({ ocrEnabled }) } } as unknown as Capabilities;
}

async function settings(hotkey: Capabilities['hotkey'], state = initial) {
  const { renderGeneralSettings } = await import('../src/ui/settings-view');
  return renderGeneralSettings({ capabilities: capabilities(hotkey), startup: { launchAtLogin: false, launchStatus: 'notRegistered', launchError: null, newNoteOnLaunch: false }, onStartupChanged() {},
    hotkey: state, onHotkeyChanged() {}, ocrEnabled: false, onOCREnabled() {}, onError(error) { throw error; } });
}

test('global shortcut recorder captures a supported chord and commits the native-confirmed display', async () => {
  const env = installDOM();
  try {
    const writes: Array<{ keyCode: number; modifiers: number }> = [];
    let state = initial;
    const port = { load: async () => state, set: async (value: { keyCode: number; modifiers: number }) => {
      writes.push(value); state = { ...value, display: '⌘K', registered: true, available: true }; return state;
    } };
    const view = await settings(port);
    document.body.append(view);
    const record = view.querySelector<HTMLButtonElement>('.hotkey-chord')!;
    record.click();
    record.dispatchEvent(new env.dom.window.KeyboardEvent('keydown', { key: 'k', code: 'KeyK', metaKey: true, bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(writes, [{ keyCode: 40, modifiers: 1 << 8 }]);
    assert.equal(record.textContent, '⌘K');
    assert.equal(view.querySelector('.hotkey-error')?.hasAttribute('hidden'), true);
  } finally { env.restore(); }
});

test('shortcut recording rejects modifierless keys, cancels with Escape, and leaves the prior chord on registration failure', async () => {
  const env = installDOM();
  try {
    let calls = 0;
    const port = { load: async () => initial, set: async () => { calls++; return { ...initial, display: '⌘X', registered: false, error: 'Shortcut is already in use.' }; } };
    const view = await settings(port); document.body.append(view);
    const record = view.querySelector<HTMLButtonElement>('.hotkey-chord')!;
    record.click();
    record.dispatchEvent(new env.dom.window.KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true, cancelable: true }));
    assert.match(view.querySelector('.hotkey-error')!.textContent!, /Include at least one/);
    assert.equal(calls, 0);
    record.dispatchEvent(new env.dom.window.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(record.textContent, initial.display);
    record.click();
    record.dispatchEvent(new env.dom.window.KeyboardEvent('keydown', { key: 'x', code: 'KeyX', ctrlKey: true, bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(calls, 1); assert.equal(record.textContent, initial.display);
    assert.match(view.querySelector('.hotkey-error')!.textContent!, /already in use/);
  } finally { env.restore(); }
});

test('preview with no shortcut capability omits the global shortcut row', async () => {
  const env = installDOM();
  try {
    const view = await settings(null);
    assert.equal(view.querySelector('.hotkey-settings'), null);
  } finally { env.restore(); }
});
