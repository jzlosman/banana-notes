import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderNoteSummary } from '../src/ui/note-summary';

test('explorer previews join list items with commas and retain task progress', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  try {
    const note = { id: 'tasks', markdown: '# Weekly plan\n\n- [x] Review the weekly plan\n- [ ] Fix the pricing typo\n- [ ] Confirm next steps', createdAt: '2026-10-04T12:00:00.000Z', updatedAt: '2026-10-05T15:06:00.000Z' };
    const explorer = renderNoteSummary(note, { onOpen() {}, explorer: true, date: note.updatedAt });
    assert.equal(explorer.querySelector('.note-excerpt')?.textContent, '1 of 3 done · Review the weekly plan, Fix the pricing typo, Confirm next steps');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous); else delete (globalThis as any).document;
    dom.window.close();
  }
});

test('explorer tag labels keep two complete tags and summarize the rest', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  try {
    const note = { id: 'tags', markdown: '# Tagged note\n\n#gamma #alpha #delta #beta', createdAt: '2026-10-04T12:00:00.000Z', updatedAt: '2026-10-05T15:06:00.000Z' };
    const explorer = renderNoteSummary(note, { onOpen() {}, explorer: true, date: note.updatedAt });
    assert.equal(explorer.querySelector('.row-tags')?.textContent, '#alpha  #beta  +2');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous); else delete (globalThis as any).document;
    dom.window.close();
  }
});

test('explorer and overview summaries share clean titles while explorer adds task progress and local time', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  try {
    const note = { id: 'release', markdown: '# **[Release plan](https://example.test)**\n\nRelease plan\n\n- [ ] Publish the announcement #launch', createdAt: '2026-10-04T12:00:00.000Z', updatedAt: '2026-10-05T15:06:00.000Z' };
    const explorer = renderNoteSummary(note, { onOpen() {}, explorer: true, date: note.updatedAt });
    const overview = renderNoteSummary(note, { onOpen() {} });
    assert.equal(explorer.querySelector('h2')?.textContent, 'Release plan');
    assert.equal(overview.querySelector('h2')?.textContent, 'Release plan');
    assert.match(explorer.querySelector('.note-excerpt')?.textContent ?? '', /^0 of 1 done · Publish the announcement$/);
    assert.equal(explorer.querySelector('.row-tags')?.textContent, '#launch');
    assert.equal(explorer.querySelector('time')?.dateTime, note.updatedAt);
    assert.equal(explorer.querySelector('time')?.textContent, new Date(note.updatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
    assert.equal(overview.querySelector('.note-task-ring'), null);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous); else delete (globalThis as any).document;
    dom.window.close();
  }
});
