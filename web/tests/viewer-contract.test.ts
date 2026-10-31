import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_VIEWER_PREFERENCES, decodeNativeDefaultAppOutcome, decodeNativeDefaultAppStatus, decodeNativeSnapshot, normalizeViewerPreferences,
} from '../src/viewer/domain/model';

const loaded = (preferences: unknown) => decodeNativeSnapshot({
  document: { kind: 'loaded', documentID: 'native-document-1', name: 'Readme.md', markdown: '# Read', revision: 'rev-1', resourceBaseURL: 'banana-viewer-resource://document/' },
  preferences,
  editing: { kind: 'locked' }, externalChange: false,
});

test('native viewer preferences stay fractional across decode, including defaults and stored window values', () => {
  assert.deepEqual(loaded({ ...DEFAULT_VIEWER_PREFERENCES }).preferences, {
    ...DEFAULT_VIEWER_PREFERENCES, focusedOpacity: 1, unfocusedOpacity: 1, glass: 0,
  });
  assert.deepEqual(loaded({ ...DEFAULT_VIEWER_PREFERENCES, focusedOpacity: 0.6, unfocusedOpacity: 0.35, glass: 0.5 }).preferences, {
    ...DEFAULT_VIEWER_PREFERENCES, focusedOpacity: 0.6, unfocusedOpacity: 0.35, glass: 0.5,
  });
});

test('malformed and out-of-range window preferences normalize safely in native units', () => {
  assert.deepEqual(normalizeViewerPreferences({ focusedOpacity: Number.NaN, unfocusedOpacity: Infinity, glass: -Infinity }), DEFAULT_VIEWER_PREFERENCES);
  assert.deepEqual(normalizeViewerPreferences({ focusedOpacity: 0, unfocusedOpacity: 3, glass: -1 }), {
    ...DEFAULT_VIEWER_PREFERENCES, focusedOpacity: 0.05, unfocusedOpacity: 1, glass: 0,
  });
  assert.deepEqual(normalizeViewerPreferences({ focusedOpacity: 0.6, unfocusedOpacity: 0.35, glass: 0.5 }), {
    ...DEFAULT_VIEWER_PREFERENCES, focusedOpacity: 0.6, unfocusedOpacity: 0.35, glass: 0.5,
  });
});

test('native default-app contracts decode switch states and reject impossible or path-bearing data', () => {
  assert.deepEqual(decodeNativeDefaultAppStatus({ isViewerDefault: true, currentAppName: null, canToggle: false, previousAppName: null }), {
    kind: 'available', state: 'on', canToggle: false, previousAppName: null,
  });
  assert.deepEqual(decodeNativeDefaultAppStatus({ isViewerDefault: true, currentAppName: null, canToggle: true, previousAppName: 'Preview' }), {
    kind: 'available', state: 'on', canToggle: true, previousAppName: 'Preview',
  });
  assert.deepEqual(decodeNativeDefaultAppStatus({ isViewerDefault: false, currentAppName: 'Preview', canToggle: true, previousAppName: null }), {
    kind: 'available', state: 'off', currentAppName: 'Preview', canToggle: true,
  });
  assert.deepEqual(decodeNativeDefaultAppOutcome('changed'), { kind: 'changed' });
  assert.deepEqual(decodeNativeDefaultAppOutcome('declinedOrFailed'), { kind: 'declinedOrFailed' });
  assert.throws(() => decodeNativeDefaultAppStatus({ isViewerDefault: false, currentAppName: null, canToggle: true, previousAppName: null, applicationURL: '/Applications/Preview.app' }), /default app response is invalid/);
  assert.throws(() => decodeNativeDefaultAppStatus({ isViewerDefault: false, currentAppName: '/Applications/Preview.app', canToggle: true, previousAppName: null }), /default app response is invalid/);
  assert.throws(() => decodeNativeDefaultAppStatus({ isViewerDefault: true, currentAppName: null, canToggle: false, previousAppName: 'Preview' }), /default app response is invalid/);
  assert.throws(() => decodeNativeDefaultAppStatus({ isViewerDefault: true, currentAppName: 'Preview', canToggle: true, previousAppName: 'Xcode' }), /default app response is invalid/);
  assert.throws(() => decodeNativeDefaultAppOutcome('failed: permission denied'), /default app result is invalid/);
});

test('native snapshots reject malformed document contracts instead of coercing them', () => {
  assert.throws(() => decodeNativeSnapshot({ document: { kind: 'loaded', name: 'x.md', markdown: '# Read', revision: 'rev-1', resourceBaseURL: 'banana-viewer-resource://document/' }, preferences: DEFAULT_VIEWER_PREFERENCES }), /document response is invalid/);
  assert.throws(() => decodeNativeSnapshot({ document: { kind: 'loaded', documentID: 'native-document-1', name: 'x.md', markdown: '', revision: '', resourceBaseURL: 'file:///tmp/' }, preferences: DEFAULT_VIEWER_PREFERENCES }), /document response is invalid/);
  assert.throws(() => decodeNativeSnapshot({ document: { kind: 'empty' }, preferences: null }), /preferences response is invalid/);
});
