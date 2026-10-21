import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticIndexCoordinator, type SemanticIndexPort, type SemanticIndexStatus, type SemanticIndexTimer } from '../src/semantic-indexing';
import type { SemanticNoteSnapshot } from '../src/semantic-search';

const ready: SemanticIndexStatus = { enabled: true, runtimeAvailable: true, installed: true, model: 'embed-v1' };
const note = (id: string, markdown = id): SemanticNoteSnapshot => ({ id, markdown, updatedAt: `${id}-time` });

class FakeTimer implements SemanticIndexTimer {
  private next = 0;
  private tasks = new Map<number, () => void>();
  setTimeout(callback: () => void): unknown { const id = ++this.next; this.tasks.set(id, callback); return id; }
  clearTimeout(handle: unknown): void { this.tasks.delete(handle as number); }
  fire(): void { const tasks = [...this.tasks.values()]; this.tasks.clear(); tasks.forEach(callback => callback()); }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function port(overrides: Partial<SemanticIndexPort> = {}) {
  const calls: { notes: readonly SemanticNoteSnapshot[]; force: boolean }[] = [];
  let status = { ...ready };
  const adapter: SemanticIndexPort = {
    status: async () => ({ ...status }),
    index: async (notes, force) => { calls.push({ notes, force }); return { indexed: calls.length }; },
    ...overrides,
  };
  return { adapter, calls, setStatus: (value: SemanticIndexStatus) => { status = value; } };
}
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

test('automatic reconciliation requires enabled, runtime, and installed; never makes setup changes', async () => {
  for (const status of [
    { ...ready, enabled: false }, { ...ready, runtimeAvailable: false }, { ...ready, installed: false },
  ]) {
    const fake = port({ status: async () => status });
    const timer = new FakeTimer();
    const coordinator = new SemanticIndexCoordinator(fake.adapter, { timer });
    coordinator.schedule([note('n')], true);
    await flush();
    assert.equal(fake.calls.length, 0);
  }
});

test('immediate launch and debounced edits use detached live-note snapshots only', async () => {
  const fake = port(); const timer = new FakeTimer();
  const coordinator = new SemanticIndexCoordinator(fake.adapter, { timer, delayMs: 12 });
  const live = note('a'); const trashed = { ...note('trash'), trashedAt: 'now' };
  const source = [live, trashed];
  coordinator.schedule(source, true);
  live.markdown = 'mutated'; source.push(note('later'));
  await flush();
  assert.deepEqual(fake.calls[0].notes, [note('a')]);
  coordinator.schedule([note('b')]);
  coordinator.schedule([note('c')]);
  assert.equal(timer['tasks'].size, 1);
  timer.fire(); await flush();
  assert.deepEqual(fake.calls[1].notes, [note('c')]);
});

test('successful model+snapshot cache skips unchanged work while force rebuilds', async () => {
  const fake = port(); const coordinator = new SemanticIndexCoordinator(fake.adapter);
  assert.deepEqual(await coordinator.refresh([note('a')]), { indexed: 1 });
  assert.deepEqual(await coordinator.refresh([note('a')]), { indexed: 1 });
  await coordinator.refresh([note('a')], true);
  assert.equal(fake.calls.length, 2);
  assert.equal(fake.calls[1].force, true);
  fake.setStatus({ ...ready, model: 'embed-v2' });
  await coordinator.refresh([note('a')]);
  assert.equal(fake.calls.length, 3);
});

test('edits arriving during an index build reconcile newest snapshot without overlap', async () => {
  const first = deferred<Record<string, unknown>>();
  let active = 0; let maxActive = 0;
  const calls: string[][] = [];
  const adapter: SemanticIndexPort = {
    status: async () => ready,
    index: async notes => {
      active++; maxActive = Math.max(maxActive, active); calls.push(notes.map(item => item.id));
      if (calls.length === 1) await first.promise;
      active--; return { ok: true };
    },
  };
  const timer = new FakeTimer(); const coordinator = new SemanticIndexCoordinator(adapter, { timer });
  coordinator.schedule([note('old')], true); await flush();
  coordinator.schedule([note('new')]); timer.fire(); await flush();
  first.resolve({ ok: true }); await flush(); await flush();
  assert.deepEqual(calls, [['old'], ['new']]);
  assert.equal(maxActive, 1);
});

test('failed background attempt is reported and retryable; explicit errors propagate', async () => {
  let fail = true; const errors: unknown[] = [];
  const fake = port({ index: async (notes, force) => {
    fake.calls.push({ notes, force });
    if (fail) throw new Error('index failed');
    return { ok: true };
  } });
  const timer = new FakeTimer(); const coordinator = new SemanticIndexCoordinator(fake.adapter, { timer, onError: error => errors.push(error) });
  coordinator.schedule([note('a')], true); await flush();
  assert.equal(errors.length, 1);
  fail = false; coordinator.schedule([note('a')], true); await flush();
  assert.equal(fake.calls.length, 2);
  fail = true; await assert.rejects(coordinator.refresh([note('b')]), /index failed/);
  const disabled = port({ status: async () => ({ ...ready, enabled: false }) });
  await assert.rejects(new SemanticIndexCoordinator(disabled.adapter).refresh([note('a')]), /Enable semantic search/);
});

test('selected-provider readiness errors retain native guidance without assuming Ollama', async () => {
  const unavailable = port({ status: async () => ({ ...ready, runtimeAvailable: false, unavailableReason: 'The native macOS embedding model is unavailable.' }) });
  await assert.rejects(new SemanticIndexCoordinator(unavailable.adapter).refresh([note('a')]), /native macOS embedding model/);
  assert.equal(unavailable.calls.length, 0);
});

test('invalidation suppresses obsolete background completion and callbacks', async () => {
  const build = deferred<Record<string, unknown>>(); const indexed: unknown[] = []; const errors: unknown[] = [];
  const adapter: SemanticIndexPort = { status: async () => ready, index: async () => build.promise };
  const coordinator = new SemanticIndexCoordinator(adapter, { onIndexed: value => indexed.push(value), onError: error => errors.push(error) });
  coordinator.schedule([note('old')], true); await flush();
  coordinator.invalidate(); build.resolve({ stale: true }); await flush();
  assert.deepEqual(indexed, []); assert.deepEqual(errors, []);
  await coordinator.refresh([note('old')]);
  assert.deepEqual(indexed, [{ stale: true }]);
});

test('canceling or disposing prevents a queued explicit build from starting', async () => {
  for (const dispose of [false, true]) {
    const first = deferred<Record<string, unknown>>(); let calls = 0;
    const coordinator = new SemanticIndexCoordinator({ status: async () => ready, index: async () => { calls++; return first.promise; } });
    const a = coordinator.refresh([note('a')]); await flush();
    const b = coordinator.refresh([note('b')]); const rejected = assert.rejects(b, /canceled/);
    if (dispose) coordinator.dispose(); else coordinator.invalidate();
    first.resolve({ ok: true }); await a; await rejected; assert.equal(calls, 1);
  }
});
