import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createTextSearchIndex } from '../src/viewer/ui/find';

const dom = new JSDOM('<!doctype html><html><body></body></html>');

test('visible reader search ignores link destinations and matches across inline formatting nodes', () => {
  const root = dom.window.document.createElement('div');
  root.innerHTML = '<p>A <a href="https://example.test/needle"><strong>hel</strong><em>lo</em></a></p>';
  const index = createTextSearchIndex(root);
  assert.deepEqual(index.matches('needle'), []);
  assert.deepEqual(index.matches('hello'), [2]);
  const range = index.range(2, 5);
  assert.equal(range?.toString(), 'hello');
});

test('source search indexes original Markdown text, including link URLs and syntax', () => {
  const source = 'A [link](https://example.test/needle) and hel**lo**';
  const root = dom.window.document.createElement('pre'); root.textContent = source;
  const index = createTextSearchIndex(root);
  assert.equal(index.text, source);
  assert.deepEqual(index.matches('needle'), [source.indexOf('needle')]);
  assert.deepEqual(index.matches('hello'), []);
});
