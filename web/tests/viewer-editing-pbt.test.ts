import * as fc from 'fast-check';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patchRichMarkdown } from '../src/viewer/domain/editing';

const RUNS = Number(process.env.MARKDOWN_PBT_RUNS ?? '300');
const line = fc.string({ minLength: 1, maxLength: 30 }).filter(value => !/[\r\n]/.test(value));

test('no-op rich unlock/save never changes source bytes', () => {
  fc.assert(fc.property(fc.string(), fc.string(), (original, baseline) => {
    assert.equal(patchRichMarkdown(original, baseline, baseline), original);
  }), { numRuns: RUNS });
});

test('a paragraph edit preserves every surrounding line token', () => {
  fc.assert(fc.property(line, line, line, line, (before, paragraph, after, replacement) => {
    const original = `# ${before}\n\n${paragraph}\n\n${after}\n`;
    const edited = `# ${before}\n\n${replacement}\n\n${after}\n`;
    const result = patchRichMarkdown(original, original, edited);
    assert.equal(result, `# ${before}\n\n${replacement}\n\n${after}\n`);
  }), { numRuns: RUNS });
});

test('CRLF and missing final newline survive a rich edit', () => {
  const original = '# Keep\r\n\r\nOriginal paragraph\r\n\r\nLast line';
  assert.equal(patchRichMarkdown(original, original, '# Keep\r\n\r\nChanged paragraph\r\n\r\nLast line'),
    '# Keep\r\n\r\nChanged paragraph\r\n\r\nLast line');
});

test('editing and undoing returns the original bytes even when baseline serialization differs', () => {
  fc.assert(fc.property(line, line, (heading, paragraph) => {
    const original = `#${heading}\r\n\r\n${paragraph}  `;
    const baseline = `# ${heading}\n\n${paragraph}\n`;
    const edited = `# ${heading}\n\nChanged ${paragraph}\n`;
    assert.equal(patchRichMarkdown(original, baseline, baseline), original);
    assert.equal(patchRichMarkdown(original, baseline, edited), `#${heading}\r\n\r\nChanged ${paragraph}\n`);
    assert.equal(patchRichMarkdown(original, baseline, baseline), original);
  }), { numRuns: RUNS });
});
