import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE, resolveFontSize, stepFontSize } from '../src/font-size';
import { PreferenceSaveQueue } from '../src/preference-save';

test('font sizes are whole bounded values with solid defaults for invalid preferences', () => {
  for (const value of [undefined, null, '19', true, NaN, Infinity]) assert.equal(resolveFontSize(value), DEFAULT_FONT_SIZE);
  assert.equal(resolveFontSize(1000), MAX_FONT_SIZE); assert.equal(resolveFontSize(-50), MIN_FONT_SIZE);
  assert.equal(resolveFontSize(17.6), 18);
  assert.equal(stepFontSize(MAX_FONT_SIZE, 1), MAX_FONT_SIZE); assert.equal(stepFontSize(MIN_FONT_SIZE, -1), MIN_FONT_SIZE);
  assert.equal(stepFontSize(stepFontSize(15, 1), -1), 15);
});
test('key-repeat font preferences serialize and retain only the latest pending size', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const sizes: number[] = []; const queue = new PreferenceSaveQueue<number>({ save: async size => { sizes.push(size); if (sizes.length === 1) await gate; } }, () => {});
  queue.enqueue(16); queue.enqueue(17); queue.enqueue(18); queue.enqueue(15); release(); await queue.flush();
  assert.deepEqual(sizes, [16, 15]);
});
