import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  DEFAULT_NOTE_FONT_STATE, applyNoteFont, renderNoteFontSettings, resolveNoteFontSelection, resolveNoteFontState,
  type NoteFontDefinition, type NoteFontState,
} from '../src/ui/note-font';

const hash = 'a'.repeat(64);
const googleFont: NoteFontDefinition = {
  id: 'ibm-plex-mono', name: 'IBM Plex Mono', kind: 'google', family: 'IBM Plex Mono', weights: [400, 500, 600, 700],
  faces: [
    { url: `foldnote-font://cache/${hash}.woff2`, weight: '400 700', unicodeRange: 'U+0000-00FF' },
    { url: `foldnote-font://cache/${'b'.repeat(64)}.woff2`, weight: '400 700', unicodeRange: 'U+4E00-9FFF' },
    { url: `foldnote-font://cache/${hash}.woff2`, weight: '400 700', unicodeRange: 'U+0000-00FF' },
  ],
};
const withGoogle = (): NoteFontState => ({
  selection: { fontID: 'space-mono', weight: 400 },
  fonts: [...DEFAULT_NOTE_FONT_STATE.fonts, googleFont],
});
function dom() {
  const instance = new JSDOM('<!doctype html><html><body></body></html>');
  Object.defineProperty(globalThis, 'document', { value: instance.window.document, configurable: true });
  return instance;
}
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function change(window: any, element: HTMLSelectElement, value: string) {
  element.value = value;
  element.dispatchEvent(new window.Event('change', { bubbles: true }));
}

test('default and malformed preference values resolve to safe defaults', () => {
  assert.deepEqual(resolveNoteFontState(undefined), DEFAULT_NOTE_FONT_STATE);
  assert.deepEqual(DEFAULT_NOTE_FONT_STATE.selection, { fontID: 'space-mono', weight: 400 });
  assert.deepEqual(DEFAULT_NOTE_FONT_STATE.fonts.map(font => font.id), ['space-mono', 'jetbrains-mono', 'overpass-mono', 'fira-code', 'avenir', 'georgia']);
  assert.deepEqual(DEFAULT_NOTE_FONT_STATE.fonts.map(font => font.weights), [[400], [400, 500, 600], [400, 500, 600], [400, 500, 600], [400, 500, 600], [400]]);
  for (const value of [null, [], 'system', { selection: { fontID: 'unknown', weight: 500 }, fonts: [] },
    { selection: { fontID: 'sf-mono', weight: 500 }, fonts: [] }, { selection: { fontID: 'system', weight: 500 }, fonts: [] }]) {
    assert.deepEqual(resolveNoteFontState(value).selection, DEFAULT_NOTE_FONT_STATE.selection);
  }
  const malformed = { ...googleFont, family: 'Arial; background:url(https://bad)' };
  const state = resolveNoteFontState({ selection: { fontID: malformed.id, weight: 500 }, fonts: [malformed] });
  assert.deepEqual(state.selection, DEFAULT_NOTE_FONT_STATE.selection);
  assert.deepEqual(state.fonts.map(font => font.id), DEFAULT_NOTE_FONT_STATE.fonts.map(font => font.id));
  assert.deepEqual(resolveNoteFontSelection({ fontID: 'ibm-plex-mono', weight: 550 }, [googleFont]), { fontID: 'ibm-plex-mono', weight: 500 });
  assert.deepEqual(resolveNoteFontSelection({ fontID: 'ibm-plex-mono', weight: 599 }, [googleFont]), { fontID: 'ibm-plex-mono', weight: 600 });
  assert.deepEqual(resolveNoteFontSelection({ fontID: 'space-mono', weight: 550 }), { fontID: 'space-mono', weight: 400 });
});

test('downloaded Google fonts matching built-ins are hidden and selected weights migrate to the nearest bundled role', () => {
  const duplicate: NoteFontDefinition = { ...googleFont, id: `google-${hash}`, name: 'jEtBrAiNs mOnO', family: `foldnote-font-${hash}`, weights: [400, 600] };
  const ordinary: NoteFontDefinition = { ...googleFont, id: 'ibm-plex-mono', name: 'IBM Plex Mono' };
  const resolved = resolveNoteFontState({
    selection: { fontID: duplicate.id, weight: 550 },
    fonts: [...DEFAULT_NOTE_FONT_STATE.fonts, duplicate, ordinary],
  });
  assert.deepEqual(resolved.selection, { fontID: 'jetbrains-mono', weight: 500 });
  assert.deepEqual(resolved.fonts.map(font => font.id), [...DEFAULT_NOTE_FONT_STATE.fonts.map(font => font.id), ordinary.id]);
  const spaceDuplicate = resolveNoteFontState({ selection: { fontID: duplicate.id, weight: 600 }, fonts: [...DEFAULT_NOTE_FONT_STATE.fonts, { ...duplicate, name: 'SPACE MONO' }] });
  assert.deepEqual(spaceDuplicate.selection, { fontID: 'space-mono', weight: 400 });
});

test('apply registers bundled faces with unicode ranges and loads bold where the bundle provides it', async () => {
  const { window } = dom();
  const root = window.document.createElement('div');
  const bundle = {
    ...DEFAULT_NOTE_FONT_STATE.fonts[0],
    faces: [
      { url: 'foldnote-font://bundled/space-mono-latin-400-normal.woff2', weight: '400', unicodeRange: 'U+0000-00FF' },
      { url: 'foldnote-font://bundled/space-mono-latin-ext-400-normal.woff2', weight: '400', unicodeRange: 'U+0100-02BA' },
      { url: 'foldnote-font://bundled/space-mono-latin-700-normal.woff2', weight: '700', unicodeRange: 'U+0000-00FF' },
      { url: 'foldnote-font://bundled/space-mono-latin-ext-700-normal.woff2', weight: '700', unicodeRange: 'U+0100-02BA' },
    ],
  };
  const constructed: Array<{ family: string; source: string; descriptors?: FontFaceDescriptors }> = [];
  const loaded: string[] = [];
  class FakeFontFace {
    constructor(readonly family: string, readonly source: string, readonly descriptors?: FontFaceDescriptors) { constructed.push(this); }
  }
  Object.defineProperty(window.document, 'fonts', { value: {
    add: () => {}, load: async (font: string) => { loaded.push(font); return []; },
  }, configurable: true });
  const oldFontFace = globalThis.FontFace;
  Object.defineProperty(globalThis, 'FontFace', { value: FakeFontFace, configurable: true });
  try {
    await applyNoteFont(root as unknown as HTMLElement, { selection: { fontID: 'space-mono', weight: 400 }, fonts: [...DEFAULT_NOTE_FONT_STATE.fonts, bundle] });
    assert.equal(constructed.length, 4);
    assert.ok(constructed.every(face => face.family === 'Space Mono'));
    assert.ok(constructed.every(face => face.source.startsWith('url("foldnote-font://bundled/')));
    assert.ok(constructed.every(face => face.descriptors?.unicodeRange));
    assert.deepEqual(loaded, ['400 14px "Space Mono"', '700 14px "Space Mono"']);
    assert.equal(root.style.getPropertyValue('--note-font-family'), '"Space Mono", ui-monospace, Menlo, monospace');
  } finally {
    Object.defineProperty(globalThis, 'FontFace', { value: oldFontFace, configurable: true });
    window.close();
  }
});

test('apply loads managed cached faces only and changes CSS variables, not note content or DOM', async () => {
  const { window } = dom();
  const root = window.document.createElement('div');
  root.innerHTML = '<article contenteditable="true"><p>Keep this note intact</p></article>';
  const before = root.innerHTML;
  const constructed: Array<{ family: string; source: string; descriptors?: FontFaceDescriptors }> = [];
  const registered: Array<{ family: string; source: string; descriptors?: FontFaceDescriptors }> = [];
  const requests: string[] = [];
  class FakeFontFace {
    family: string; source: string; descriptors?: FontFaceDescriptors;
    constructor(family: string, source: string, descriptors?: FontFaceDescriptors) { this.family = family; this.source = source; this.descriptors = descriptors; constructed.push(this); }
  }
  Object.defineProperty(window.document, 'fonts', { value: {
    add: (face: FontFace) => registered.push(face as unknown as typeof registered[number]),
    load: async (font: string, text: string) => { requests.push(`${font}|${text}`); return []; },
  }, configurable: true });
  const globalDocument = globalThis.document;
  const globalFontFace = globalThis.FontFace;
  Object.defineProperty(globalThis, 'document', { value: window.document, configurable: true });
  Object.defineProperty(globalThis, 'FontFace', { value: FakeFontFace, configurable: true });
  try {
    await applyNoteFont(root as unknown as HTMLElement, { ...withGoogle(), selection: { fontID: googleFont.id, weight: 500 } });
    assert.equal(constructed.length, 2);
    assert.equal(registered.length, 2);
    assert.match(constructed[0].source, /^url\("foldnote-font:\/\/cache\/[a-f0-9]{64}\.woff2"\)$/);
    assert.match(constructed[1].descriptors?.unicodeRange ?? '', /U\+4E00-9FFF/);
    assert.equal(requests.length, 2);
    assert.match(requests[0], /^500 14px "IBM Plex Mono"\|Project notes Draft ready for review\.$/);
    assert.match(requests[1], /^700 14px "IBM Plex Mono"\|Project notes Draft ready for review\.$/);
    assert.equal(root.style.getPropertyValue('--note-font-family'), '"IBM Plex Mono", ui-monospace, Menlo, monospace');
    assert.equal(root.style.getPropertyValue('--note-font-weight'), '500');
    assert.equal(root.innerHTML, before);
    assert.equal(root.querySelector('p')?.textContent, 'Keep this note intact');
    await applyNoteFont(root as unknown as HTMLElement, { ...withGoogle(), selection: { fontID: googleFont.id, weight: 500 } });
    assert.equal(constructed.length, 2, 'switching back to a cached font does not leak duplicate FontFace objects');
  } finally {
    Object.defineProperty(globalThis, 'document', { value: globalDocument, configurable: true });
    Object.defineProperty(globalThis, 'FontFace', { value: globalFontFace, configurable: true });
    window.close();
  }
});

test('font picker confirms selection only after persistence and offers supported weights', async () => {
  const { window } = dom();
  const gate = deferred<NoteFontState>();
  let requested: unknown;
  const component = renderNoteFontSettings({ state: withGoogle(), onSelect: selection => { requested = selection; return gate.promise; }, onDownload: async () => { throw new Error('unexpected'); } });
  window.document.body.append(component);
  const fontSelect = component.querySelector<HTMLSelectElement>('select[aria-label="Note font"]')!;
  const weightSelect = component.querySelector<HTMLSelectElement>('select[aria-label="Note font weight"]')!;
  assert.deepEqual(Array.from(fontSelect.options, option => option.textContent), ['Space Mono', 'JetBrains Mono', 'Overpass Mono', 'Fira Code', 'Avenir Next', 'Georgia', 'IBM Plex Mono']);
  assert.deepEqual(Array.from(weightSelect.options, option => option.value), ['400']);
  change(window, fontSelect, googleFont.id);
  assert.deepEqual(requested, { fontID: googleFont.id, weight: 400 });
  assert.equal(fontSelect.value, 'space-mono');
  gate.resolve({ ...withGoogle(), selection: { fontID: googleFont.id, weight: 400 } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(fontSelect.value, googleFont.id);
  assert.equal(component.querySelector('.note-font-preview figcaption')?.textContent, 'Preview');
  assert.equal(component.querySelector('.note-font-sample')?.textContent, 'Project notesDraft ready for review.');
  window.close();
});

test('selection persistence failure keeps prior value and exposes an accessible error', async () => {
  const { window } = dom();
  const component = renderNoteFontSettings({ state: withGoogle(), onSelect: async () => { throw new Error('Save failed'); }, onDownload: async () => { throw new Error('unexpected'); } });
  const select = component.querySelector<HTMLSelectElement>('select[aria-label="Note font"]')!;
  change(window, select, 'avenir');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(select.value, 'space-mono');
  assert.equal(component.querySelector('[role="alert"]')?.textContent, 'Save failed');
  assert.equal(component.querySelector('[role="alert"]')?.closest('details'), null, 'font selection errors remain visible when Google Fonts is collapsed');
  window.close();
});

test('Google Fonts download is explicit and selects only after cache result is persisted', async () => {
  const { window } = dom();
  let downloads = 0; let selectionCall = '';
  const next: NoteFontDefinition = { ...googleFont, id: 'dm-sans', name: 'DM Sans', family: 'DM Sans', weights: [400, 600], faces: [{ ...googleFont.faces[0], weight: '400 600' }] };
  const component = renderNoteFontSettings({ state: DEFAULT_NOTE_FONT_STATE, onSelect: async selection => { selectionCall = `${selection.fontID}:${selection.weight}`; return { selection, fonts: [...DEFAULT_NOTE_FONT_STATE.fonts, next] }; }, onDownload: async family => { downloads++; assert.equal(family, 'DM Sans'); return { fontState: { ...DEFAULT_NOTE_FONT_STATE, fonts: [...DEFAULT_NOTE_FONT_STATE.fonts, next] }, downloadedFontID: next.id }; } });
  const input = component.querySelector('input[aria-label="Google Fonts family name"]') as HTMLInputElement;
  window.document.body.append(component);
  input.value = 'DM Sans';
  assert.equal(downloads, 0);
  component.querySelector<HTMLButtonElement>('button.note-font-download-button')!.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(downloads, 1);
  assert.equal(selectionCall, 'dm-sans:400');
  assert.equal(component.querySelector<HTMLSelectElement>('select[aria-label="Note font"]')?.value, 'dm-sans');
  window.close();
});

test('invalid family input is rejected and stale download completion cannot overwrite a newer selection', async () => {
  const { window } = dom();
  const gate = deferred<{ fontState: NoteFontState; downloadedFontID: string }>();
  const component = renderNoteFontSettings({ state: withGoogle(), onSelect: async selection => ({ ...withGoogle(), selection }), onDownload: () => gate.promise });
  const input = component.querySelector('input[aria-label="Google Fonts family name"]') as HTMLInputElement;
  const button = component.querySelector<HTMLButtonElement>('button.note-font-download-button')!;
  window.document.body.append(component);
  input.value = 'Bad; url(https://example.com)'; button.click();
  assert.equal(component.querySelector('.note-font-download [role="alert"]')?.textContent, 'Enter a valid Google Fonts family name.');
  input.value = 'IBM Plex Mono'; button.click();
  change(window, component.querySelector<HTMLSelectElement>('select[aria-label="Note font"]')!, 'avenir');
  await new Promise(resolve => setTimeout(resolve, 0));
  gate.resolve({ fontState: withGoogle(), downloadedFontID: googleFont.id });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(component.querySelector<HTMLSelectElement>('select[aria-label="Note font"]')?.value, 'avenir');
  window.close();
});

test('cancel calls the optional native cancellation port and ignores late results', async () => {
  const { window } = dom();
  const gate = deferred<{ fontState: NoteFontState; downloadedFontID: string }>();
  let canceled = 0;
  const component = renderNoteFontSettings({ state: DEFAULT_NOTE_FONT_STATE, onSelect: async selection => ({ ...DEFAULT_NOTE_FONT_STATE, selection }), onDownload: () => gate.promise, onCancelDownload: async () => { canceled++; } });
  window.document.body.append(component);
  (component.querySelector('input[aria-label="Google Fonts family name"]') as HTMLInputElement).value = 'IBM Plex Mono';
  component.querySelector<HTMLButtonElement>('button.note-font-download-button')!.click();
  component.querySelector<HTMLButtonElement>('button.note-font-cancel')!.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(canceled, 1);
  gate.resolve({ fontState: withGoogle(), downloadedFontID: googleFont.id });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(component.querySelector<HTMLSelectElement>('select[aria-label="Note font"]')?.value, 'space-mono');
  window.close();
});

test('typography groups controls, text size and a labelled preview before the optional download form', () => {
  const { window } = dom();
  let downloads = 0;
  const size = window.document.createElement('select'); size.setAttribute('aria-label', 'Note text size');
  const status = window.document.createElement('button'); status.hidden = true;
  const component = renderNoteFontSettings({ state: DEFAULT_NOTE_FONT_STATE, textSizeControl: { input: size, status }, onSelect: async selection => ({ ...DEFAULT_NOTE_FONT_STATE, selection }), onDownload: async () => { downloads++; throw new Error('Unexpected download'); } });
  assert.equal(component.querySelector('h2')?.textContent, 'Note text');
  assert.equal(component.getAttribute('aria-labelledby'), component.querySelector('h2')?.id);
  const fields = component.querySelector('.note-font-fields')!;
  assert.deepEqual(Array.from(fields.querySelectorAll('label'), field => field.firstChild?.textContent), ['Font', 'Weight', 'Size']);
  assert.equal(fields.querySelectorAll('select').length, 3);
  assert.ok(fields.contains(size));
  assert.equal(status.parentElement, component, 'save failures stay visible outside the narrow size field');
  const details = component.querySelector('details')!;
  assert.equal(details.open, false);
  assert.equal(details.querySelector('summary')?.textContent, 'Add a Google font');
  const form = details.querySelector('form')!;
  assert.ok(form.querySelector('label input[aria-label="Google Fonts family name"]'));
  assert.equal(form.querySelector('button[type="submit"]')?.textContent, 'Download and use');
  details.open = true;
  assert.equal(downloads, 0, 'opening font setup never downloads anything');
  window.close();
});

test('download form handles submit and keeps failures next to its controls', async () => {
  const { window } = dom();
  let requested = '';
  const component = renderNoteFontSettings({ state: DEFAULT_NOTE_FONT_STATE, onSelect: async selection => ({ ...DEFAULT_NOTE_FONT_STATE, selection }), onDownload: async family => { requested = family; throw new Error('Download failed. Try again.'); } });
  const form = component.querySelector('form')!;
  component.querySelector<HTMLInputElement>('input')!.value = 'Lora';
  const submit = new window.Event('submit', { bubbles: true, cancelable: true });
  form.dispatchEvent(submit);
  assert.equal(submit.defaultPrevented, true, 'Enter submits without navigating away from Settings');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(requested, 'Lora');
  assert.equal(form.querySelector('[role="alert"]')?.textContent, 'Download failed. Try again.');
  assert.equal(component.querySelector(':scope > [role="alert"]')?.textContent, '', 'download failures do not appear as selection failures');
  window.close();
});

test('native Google font records retain bold faces even when only body weights are selectable', () => {
  const native = { ...googleFont, id: `google-${hash}`, family: `foldnote-font-${hash}`, weights: [400, 500, 600], faces: [400, 500, 600, 700].map(weight => ({ url: `foldnote-font://cache/${hash}.woff2`, weight: String(weight), unicodeRange: 'U+0000-00FF' })) };
  const resolved = resolveNoteFontState({ selection: { fontID: native.id, weight: 500 }, fonts: [native] });
  assert.equal(resolved.selection.fontID, native.id); assert.equal(resolved.fonts.at(-1)?.faces.length, 4);
});

test('unsafe face descriptors and remote font URLs are rejected', () => {
  for (const face of [
    { url: 'https://fonts.googleapis.com/font.woff2', weight: '400' },
    { url: `foldnote-font://cache/${hash}.woff2`, weight: '400; background:url(x)' },
    { url: `foldnote-font://cache/${hash}.woff2`, weight: '400', unicodeRange: 'U+0000; color:red' },
  ]) {
    const resolved = resolveNoteFontState({ selection: { fontID: googleFont.id, weight: 400 }, fonts: [{ ...googleFont, faces: [face] }] });
    assert.equal(resolved.fonts.some(font => font.id === googleFont.id), false);
  }
});
