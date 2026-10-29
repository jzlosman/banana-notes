import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_VIEWER_PREFERENCES, decodeNativeSnapshot, normalizeViewerPreferences,
} from '../src/viewer/domain/model';

const loaded = (preferences: unknown) => decodeNativeSnapshot({
  document: { kind: 'loaded', name: 'Readme.md', markdown: '# Read', revision: 'rev-1', resourceBaseURL: 'banana-viewer-resource://document/' },
  preferences,
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

test('native snapshots reject malformed document contracts instead of coercing them', () => {
  assert.throws(() => decodeNativeSnapshot({ document: { kind: 'loaded', name: 'x.md', markdown: '', revision: '', resourceBaseURL: 'file:///tmp/' }, preferences: DEFAULT_VIEWER_PREFERENCES }), /document response is invalid/);
  assert.throws(() => decodeNativeSnapshot({ document: { kind: 'empty' }, preferences: null }), /preferences response is invalid/);
});
