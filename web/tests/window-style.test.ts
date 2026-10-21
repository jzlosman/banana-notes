import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WINDOW_STYLE, resolveWindowStyle, WindowStyleSaveQueue, type WindowStyle } from '../src/window-style';

const style = (focusedOpacity: number): WindowStyle => ({ focusedOpacity, unfocusedOpacity: 0.7, glass: 0.3 });

test('resolves defaults per invalid field and clamps finite values', () => {
  assert.deepEqual(resolveWindowStyle(null), DEFAULT_WINDOW_STYLE);
  assert.deepEqual(resolveWindowStyle({ focusedOpacity: 0, unfocusedOpacity: '0.5', glass: NaN }), {
    focusedOpacity: 0.05, unfocusedOpacity: 1, glass: 0,
  });
  assert.deepEqual(resolveWindowStyle({ focusedOpacity: Infinity, unfocusedOpacity: -2, glass: 2 }), {
    focusedOpacity: 1, unfocusedOpacity: 0.05, glass: 1,
  });
});

test('serializes writes and coalesces to the latest pending state', async () => {
  let unblock!: () => void;
  const gate = new Promise<void>((resolve) => { unblock = resolve; });
  const writes: number[] = [];
  let active = 0;
  let maximum = 0;
  const queue = new WindowStyleSaveQueue({ save: async (value) => {
    active++; maximum = Math.max(maximum, active); writes.push(value.focusedOpacity);
    if (writes.length === 1) await gate;
    active--;
  } }, () => {});
  queue.enqueue(style(0.2)); queue.enqueue(style(0.4)); queue.enqueue(style(0.8));
  unblock(); await queue.flush();
  assert.deepEqual(writes, [0.2, 0.8]); assert.equal(maximum, 1);
});

test('queued snapshots are detached from caller mutation', async () => {
  const writes: WindowStyle[] = [];
  const queue = new WindowStyleSaveQueue({ save: async (value) => { writes.push(value); } }, () => {});
  const value = style(0.4);
  queue.enqueue(value); value.focusedOpacity = 0.9;
  await queue.flush();
  assert.equal(writes[0].focusedOpacity, 0.4);
});

test('failure retains the newest pending state for an explicit flush retry', async () => {
  let rejectFirst!: (error: Error) => void;
  const first = new Promise<void>((_, reject) => { rejectFirst = reject; });
  const writes: number[] = [];
  const statuses: string[] = [];
  let calls = 0;
  const queue = new WindowStyleSaveQueue({ save: async (value) => {
    writes.push(value.focusedOpacity);
    if (++calls === 1) await first;
  } }, (state) => statuses.push(state));
  queue.enqueue(style(0.2)); queue.enqueue(style(0.8));
  rejectFirst(new Error('disk')); await assert.rejects(queue.flush());
  assert.deepEqual(writes, [0.2]); assert.equal(statuses.at(-1), 'error');
  await queue.flush();
  assert.deepEqual(writes, [0.2, 0.8]); assert.equal(statuses.at(-1), 'saved');
});
