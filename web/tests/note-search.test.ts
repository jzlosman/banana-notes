import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeSearchMatches, searchNotes, type NoteSearchPort, type SearchReadiness } from '../src/note-search';

const ready: SearchReadiness = { enabled: true, runtimeAvailable: true, installed: true };
function harness(status: SearchReadiness = ready) {
  const calls: string[] = [];
  const port: NoteSearchPort = {
    status: async () => { calls.push('status'); return status; },
    prepareIndex: async () => { calls.push('index'); },
    semanticSearch: async () => { calls.push('query'); return ['two', 'one', 'two', 'outside-scope']; },
  };
  return { port, calls };
}

test('one-field search queries configured capability, reconciles index, and preserves scoped ranking', async () => {
  const { port, calls } = harness();
  assert.deepEqual(await searchNotes('an idea', ['one', 'two'], port), { kind: 'semantic', ids: ['two', 'one'] });
  assert.deepEqual(calls, ['status', 'index', 'query']);
});

test('Disabled is text-only; missing runtime/model keeps text search usable without any setup effect', async () => {
  const disabled = harness({ ...ready, enabled: false });
  assert.deepEqual(await searchNotes('idea', ['one'], disabled.port), { kind: 'text' });
  assert.deepEqual(disabled.calls, ['status']);
  for (const status of [{ ...ready, runtimeAvailable: false }, { ...ready, installed: false }]) {
    const { port, calls } = harness({ ...status, unavailableReason: 'Local embeddings are unavailable on this Mac. Text search is still available.' });
    const result = await searchNotes('idea', ['one'], port);
    assert.equal(result.kind, 'text');
    assert.match(result.kind === 'text' ? result.reason ?? '' : '', /Text search/);
    assert.deepEqual(calls, ['status']);
  }
});

test('operational status, indexing and embedding faults fall back to text rather than breaking search', async () => {
  for (const field of ['status', 'prepareIndex', 'semanticSearch'] as const) {
    const { port } = harness();
    port[field] = async () => { throw new Error('provider unavailable'); };
    const result = await searchNotes('idea', ['one'], port);
    assert.equal(result.kind, 'text');
    assert.match(result.kind === 'text' ? result.reason ?? '' : '', /Showing text matches/);
  }
});

test('empty query/scope does not invoke providers, and stale queries stop at every effect boundary', async () => {
  const { port, calls } = harness();
  assert.deepEqual(await searchNotes(' ', ['one'], port), { kind: 'text' });
  assert.deepEqual(await searchNotes('idea', [], port), { kind: 'text' });
  assert.deepEqual(calls, []);
  for (const boundary of ['status', 'prepareIndex', 'semanticSearch'] as const) {
    const run = harness();
    const stopAfter = ['status', 'prepareIndex', 'semanticSearch'].indexOf(boundary) + 1;
    assert.deepEqual(await searchNotes('idea', ['one'], run.port, () => run.calls.length < stopAfter), { kind: 'cancelled' });
    assert.equal(run.calls.length, stopAfter);
  }
});

test('literal matches are never dropped by semantic caps; merged results are unique with stable order', async () => {
  const text = Array.from({ length: 75 }, (_, i) => `literal-${i}`);
  assert.deepEqual(mergeSearchMatches(text, ['literal-2', 'semantic', 'semantic']), [...text, 'semantic']);
  const { port } = harness();
  const ids = Array.from({ length: 80 }, (_, i) => `id-${i}`);
  port.semanticSearch = async () => ids;
  const result = await searchNotes('idea', ids, port);
  assert.deepEqual(result, { kind: 'semantic', ids: ids.slice(0, 50) });
});
