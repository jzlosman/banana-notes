import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorkspace } from '../src/application/workspace-query';
import { DEFAULT_NOTE_FONT_STATE } from '../src/domain/note-font';
import { DEFAULT_WINDOW_STYLE } from '../src/domain/window-style';
import type { Capabilities } from '../src/application/ports';

test('workspace query reads explicit capabilities and applies absence defaults without probing a platform flag', async () => {
  const calls: string[] = [];
  const load = <T>(name: string, value: T) => async () => { calls.push(name); return value; };
  const capabilities = {
    library: { load: load('library', null), save: async () => {} },
    scopePreferences: { load: load('scopePreferences', { pinnedTags: [], bookmarks: {} }), save: async () => {} },
    appearance: { load: load('appearance', { themeID: 'system', syntaxThemeID: 'app' }), saveTheme: async (themeID: string) => ({ themeID }), saveSyntaxTheme: async () => {} },
    typography: { load: load('typography', { noteFonts: DEFAULT_NOTE_FONT_STATE, fontSize: 16 }), selectNoteFont: async () => DEFAULT_NOTE_FONT_STATE, saveFontSize: async () => {}, downloadFont: null },
    windowStyle: { load: load('windowStyle', DEFAULT_WINDOW_STYLE), save: async () => {}, previewOpacity: () => null },
    window: { ready: async () => {}, hide: async () => {}, pin: null, dragRegion: null, focused: load('focused', true), bindCommands: () => () => {} },
    features: { load: load('features', { ocrEnabled: false }), setOCR: async (ocrEnabled: boolean) => ({ ocrEnabled }) },
    startup: null,
    hotkey: { load: load('hotkey', { display: '⌃⇧Space', registered: false, available: false }) },
    imagePreferences: { load: load('image', {}), save: async () => {} },
  } as unknown as Capabilities;
  const snapshot = await loadWorkspace(capabilities);
  assert.deepEqual(calls.sort(), ['appearance', 'features', 'focused', 'hotkey', 'image', 'library', 'scopePreferences', 'typography', 'windowStyle'].sort());
  assert.deepEqual(snapshot.startup, { launchAtLogin: false, launchStatus: 'notRegistered', launchError: null, newNoteOnLaunch: false });
  assert.equal(snapshot.pinned, true); assert.equal(snapshot.focused, true); assert.equal(snapshot.library, null);
  assert.deepEqual(snapshot.scopePreferences, { pinnedTags: [], bookmarks: {} });
});
