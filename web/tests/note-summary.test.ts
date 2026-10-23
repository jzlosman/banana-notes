import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderNoteSummary } from '../src/ui/note-summary';

test('blank notes have an empty domain title and a muted Empty note label without losing their date', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  try {
    const row = renderNoteSummary({ id: 'blank', markdown: '  \n\t', createdAt: '2026-10-04T12:00:00.000Z', updatedAt: '2026-10-05T12:00:00.000Z' }, { onOpen() {} });
    assert.equal(row.querySelector('h2')?.textContent, 'Empty note');
    assert.equal(row.querySelector('h2')?.classList.contains('empty-note-title'), true);
    assert.equal(row.getAttribute('aria-label'), 'Open Empty note');
    assert.equal(row.querySelector('time')?.dateTime, '2026-10-05T12:00:00.000Z');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous); else delete (globalThis as any).document;
    dom.window.close();
  }
});
