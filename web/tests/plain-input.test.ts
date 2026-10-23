import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { plainInput } from '../src/ui/plain-input';

test('query and name inputs opt out of macOS autocorrect, completion and capitalization', () => {
  const { window } = new JSDOM('<!doctype html><input>');
  const input = plainInput(window.document.querySelector('input')!);
  assert.equal(input.getAttribute('autocomplete'), 'off');
  assert.equal(input.getAttribute('autocorrect'), 'off');
  assert.equal(input.getAttribute('autocapitalize'), 'off');
  assert.equal(input.spellcheck, false);
  window.close();
});
