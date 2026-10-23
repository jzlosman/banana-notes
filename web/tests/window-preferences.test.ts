import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PINNED, resolvePinnedPreference } from '../src/domain/window-preferences';

test('pin preference defaults to pinned while preserving explicit saved booleans', () => {
  assert.equal(DEFAULT_PINNED, true);
  assert.equal(resolvePinnedPreference(undefined), true);
  assert.equal(resolvePinnedPreference(null), true);
  assert.equal(resolvePinnedPreference(true), true);
  assert.equal(resolvePinnedPreference(false), false);
});
