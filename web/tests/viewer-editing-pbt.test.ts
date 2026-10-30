import * as fc from 'fast-check';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patchRichMarkdown } from '../src/viewer/domain/editing';

const RUNS = Number(process.env.MARKDOWN_PBT_RUNS ?? '300');
const line = fc.string({ minLength: 1, maxLength: 30 }).filter(value => !/[\r\n]/.test(value));
const sourceLineTokens = (text: string): string[] => text.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? [];

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

test('CRLF and missing final newline survive LF rich-editor output', () => {
  const original = '# Keep\r\n\r\nOriginal paragraph\r\n\r\nLast line';
  const baseline = '# Keep\n\nOriginal paragraph\n\nLast line\n';
  const edited = '# Keep\n\nChanged paragraph\n\nLast line\n';
  assert.equal(patchRichMarkdown(original, baseline, edited),
    '# Keep\r\n\r\nChanged paragraph\r\n\r\nLast line');
});

test('replacement lines use the dominant original terminator in a mixed-ending document', () => {
  const original = 'First\r\nSecond\nTarget\nTail\n';
  const baseline = 'First\nSecond\nTarget\nTail\n';
  const edited = 'First\nSecond\nChanged\nTail\n';
  assert.equal(patchRichMarkdown(original, baseline, edited), 'First\r\nSecond\nChanged\nTail\n');
});

test('editing and undoing returns original bytes when LF serialization differs from CRLF source', () => {
  fc.assert(fc.property(line, line, (heading, paragraph) => {
    const original = `#${heading}\r\n\r\n${paragraph}  `;
    const baseline = `# ${heading}\n\n${paragraph}\n`;
    const edited = `# ${heading}\n\nChanged ${paragraph}\n`;
    assert.equal(patchRichMarkdown(original, baseline, baseline), original);
    assert.equal(patchRichMarkdown(original, baseline, edited), `#${heading}\r\n\r\nChanged ${paragraph}`);
    assert.equal(patchRichMarkdown(original, baseline, baseline), original);
  }), { numRuns: RUNS });
});

type NewlineEditCase = {
  original: string;
  baseline: string;
  edited: string;
  expected: string;
  terminator: '\n' | '\r\n';
  finalNewline: boolean;
  changedStart: number;
  changedEnd: number;
};

const newlineEditCase: fc.Arbitrary<NewlineEditCase> = fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 2, maxLength: 4 })
  .chain(paragraphSizes => {
    const contentLineCount = paragraphSizes.reduce((total, size) => total + size, 0);
    return fc.uniqueArray(line, { minLength: contentLineCount, maxLength: contentLineCount }).chain(contentLines => {
      const paragraphs: string[][] = [];
      let contentIndex = 0;
      for (const size of paragraphSizes) {
        paragraphs.push(contentLines.slice(contentIndex, contentIndex + size));
        contentIndex += size;
      }
      const sourceBodies = paragraphs.flatMap((paragraph, index) => index === 0 ? paragraph : ['', ...paragraph]);
      const paragraphStarts: number[] = [];
      let bodyIndex = 0;
      for (const [index, size] of paragraphSizes.entries()) {
        if (index > 0) bodyIndex++;
        paragraphStarts.push(bodyIndex);
        bodyIndex += size;
      }
      return fc.record({
        terminator: fc.constantFrom('\n' as const, '\r\n' as const),
        finalNewline: fc.boolean(),
        kind: fc.constantFrom('single-line' as const, 'paragraph' as const),
        paragraphIndex: fc.integer({ min: 0, max: paragraphSizes.length - 1 }),
        lineIndex: fc.integer({ min: 0, max: Math.max(...paragraphSizes) - 1 }),
        replacementLines: fc.array(line, { minLength: 1, maxLength: 3 }),
      }).map(choice => {
        const paragraphIndex = choice.paragraphIndex;
        const paragraph = paragraphs[paragraphIndex]!;
        const paragraphStart = paragraphStarts[paragraphIndex]!;
        const changedStart = choice.kind === 'single-line'
          ? paragraphStart + Math.min(choice.lineIndex, paragraph.length - 1)
          : paragraphStart;
        const changedEnd = choice.kind === 'single-line' ? changedStart + 1 : paragraphStart + paragraph.length;
        const used = new Set(sourceBodies);
        const uniqueReplacement = (value: string, index: number): string => {
          let result = `Edited ${index}: ${value}`;
          while (used.has(result)) result = `_${result}`;
          used.add(result);
          return result;
        };
        const replacement = choice.kind === 'single-line'
          ? [uniqueReplacement(sourceBodies[changedStart]!, 0)]
          : choice.replacementLines.map((value, index) => uniqueReplacement(value, index));
        const editedBodies = [...sourceBodies.slice(0, changedStart), ...replacement, ...sourceBodies.slice(changedEnd)];
        const original = sourceBodies.join(choice.terminator) + (choice.finalNewline ? choice.terminator : '');
        const baseline = `${sourceBodies.join('\n')}\n`;
        const edited = `${editedBodies.join('\n')}\n`;
        const expected = editedBodies.map((body, index) =>
          `${body}${index < editedBodies.length - 1 || choice.finalNewline ? choice.terminator : ''}`).join('');
        return {
          original, baseline, edited, expected, terminator: choice.terminator,
          finalNewline: choice.finalNewline, changedStart, changedEnd,
        };
      });
    });
  });

test('LF editor output keeps the original terminator, final-newline state, and untouched line tokens', () => {
  fc.assert(fc.property(newlineEditCase, example => {
    const result = patchRichMarkdown(example.original, example.baseline, example.edited);
    const terminators = result.match(/\r\n|\r|\n/g) ?? [];
    assert.ok(terminators.every(terminator => terminator === example.terminator), 'output uses only the original line terminator');
    assert.equal(/(?:\r\n|\r|\n)$/.test(result), example.finalNewline, 'final-newline presence matches the original');
    assert.equal(result, example.expected, 'the edited source retains exactly the expected content');

    const originalTokens = sourceLineTokens(example.original);
    const resultTokens = sourceLineTokens(result);
    assert.deepEqual(resultTokens.slice(0, example.changedStart), originalTokens.slice(0, example.changedStart));
    const suffixLength = originalTokens.length - example.changedEnd;
    if (suffixLength > 0) assert.deepEqual(resultTokens.slice(-suffixLength), originalTokens.slice(example.changedEnd));
  }), { numRuns: RUNS });
});
