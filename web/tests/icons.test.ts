import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Check } from 'lucide';
import { renderIcon } from '../src/ui/icon';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });

test('Lucide icons retain the app sizing, stroke, and accessibility defaults', () => {
  const icon = renderIcon(Check, 16);
  assert.equal(icon.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(icon.getAttribute('width'), '16');
  assert.equal(icon.getAttribute('height'), '16');
  assert.equal(icon.getAttribute('stroke-width'), '1.7');
  assert.equal(icon.getAttribute('aria-hidden'), 'true');
  assert.ok(icon.querySelector('path'));
});

test.after(() => {
  if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
  else delete (globalThis as { document?: Document }).document;
  dom.window.close();
});
