import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observeWindowDragRegion, type WindowDragRegion } from '../src/ui/window-drag';

test('drag geometry follows the actual empty toolbar gap and stops after disposal', () => {
  const original = { ResizeObserver: globalThis.ResizeObserver, requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame };
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  let resize = () => {};
  let disconnected = false;
  const messages: WindowDragRegion[] = [];
  let rect = { x: 150, y: 0, width: 220, height: 36 };
  const spacer = { getBoundingClientRect: () => rect } as unknown as HTMLElement;
  const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)); };
  try {
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) { resize = () => callback([], this as unknown as ResizeObserver); }
      observe() {} unobserve() {} disconnect() { disconnected = true; }
    } as unknown as typeof ResizeObserver;
    globalThis.requestAnimationFrame = callback => { frames.set(++next, callback); return next; };
    globalThis.cancelAnimationFrame = id => { frames.delete(id); };
    const dispose = observeWindowDragRegion(spacer, value => messages.push(value));
    flush(); assert.deepEqual(messages, [{ x: 150, y: 0, width: 220, height: 36 }]);
    rect = { x: 250, y: 0, width: 120, height: 36 };
    resize(); resize(); flush();
    assert.equal(messages.length, 2);
    assert.deepEqual(messages[1], rect, 'longer notebook labels must shrink and move the native overlay');
    resize(); dispose(); flush();
    resize(); flush();
    assert.equal(messages.length, 3, 'old views must not publish stale rectangles over new controls');
    assert.deepEqual(messages[2], { x: 0, y: 0, width: 0, height: 0 }, 'disposal must disable the old native overlay immediately');
    dispose(); assert.equal(messages.length, 3, 'cleanup is idempotent');
    assert.ok(disconnected);
  } finally { Object.assign(globalThis, original); }
});
