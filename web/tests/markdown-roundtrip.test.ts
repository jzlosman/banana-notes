import * as fc from 'fast-check';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost' });
for (const key of ['window', 'document', 'navigator', 'Node', 'HTMLElement', 'Element', 'MutationObserver', 'DOMParser', 'getComputedStyle', 'Event', 'KeyboardEvent', 'MouseEvent', 'ClipboardEvent'] as const) {
  if (key in dom.window) Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true, writable: true });
}
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(0), 0) as any;
globalThis.cancelAnimationFrame = id => clearTimeout(id);

import type { Editor } from '@tiptap/core';
import type { Library } from '../src/domain/library';

const [
  { attachmentMarkdown },
  { splitDocument },
  { LibraryCommands },
  { SaveQueue },
  { markdownVisibleText, richTextContainsMarkdownWords },
  { createMarkdownEditor, guardMarkdownEditor, visibleEditorText },
  { documentClipboardPayload },
  { bindMarkdownSourceTextarea },
] = await Promise.all([
  import('../src/domain/managed-media'),
  import('../src/domain/library'),
  import('../src/application/library-commands'),
  import('../src/application/persistence'),
  import('../src/domain/markdown-visibility'),
  import('../src/ui/editor'),
  import('../src/ui/clipboard'),
  import('../src/ui/editor/markdown-source-edit'),
]);

const RUNS = Number(process.env.MARKDOWN_PBT_RUNS ?? '300');
if (!Number.isSafeInteger(RUNS) || RUNS < 1) throw new Error('MARKDOWN_PBT_RUNS must be a positive integer');

const wordArb = fc.constantFrom(
  'banana', 'orchard', 'editor', 'preserve', 'markdown', 'visible', 'roundtrip',
  'Café', 'caféine', '漢字かな', '東京', 'emoji🍌', 'alpha_beta', 'quote', 'task',
);
const phraseArb = fc.array(wordArb, { minLength: 1, maxLength: 4 }).map(words => words.join(' '));
const inlineArb = fc.oneof(
  phraseArb,
  phraseArb.map(value => `**${value}**`),
  phraseArb.map(value => `_${value}_`),
  phraseArb.map(value => `\`${value}\``),
  phraseArb.map(value => `[${value}](https://example.test/guide)`),
  phraseArb.map(value => `*${value}*`),
  fc.constantFrom('https://example.test/path', '<https://example.test/auto>', '#work', '🍌 漢字', 'hard break  \nnext line', 'backslash break\\\ncontinued'),
);
const paragraphArb = fc.array(inlineArb, { minLength: 1, maxLength: 4 }).map(parts => parts.join(' '));
const headingArb = fc.tuple(fc.integer({ min: 1, max: 6 }), phraseArb, fc.boolean()).map(([level, text, trailing]) => `${'#'.repeat(level)} ${text}${trailing ? ` ${'#'.repeat(level)}` : ''}`);
const listArb = fc.tuple(
  fc.constantFrom('-', '*', '+', '1.', '2)'),
  fc.constantFrom('-', '*', '+'),
  fc.constantFrom('[ ]', '[x]', '[X]'),
  phraseArb,
  phraseArb,
  phraseArb,
  fc.boolean(),
).map(([outer, inner, checked, first, second, child, nestedTask]) => {
  const checkbox = outer === '-' || outer === '*' || outer === '+' ? `${checked} ` : '';
  const nested = nestedTask ? `[ ] ${child}` : child;
  return `${outer} ${checkbox}${first}\n${inner} ${second}\n  ${inner} ${nested}`;
});
const quoteArb = fc.tuple(phraseArb, phraseArb, fc.boolean()).map(([first, nested, includeNested]) => `> ${first}${includeNested ? `\n> > ${nested}` : ''}`);
const fenceArb = fc.tuple(fc.constantFrom('```', '~~~'), fc.constantFrom('', 'ts', 'text', 'json'), phraseArb, fc.boolean()).map(([fence, language, code, closed]) => `${fence}${language}\nconst note = ${JSON.stringify(code)};${closed ? `\n${fence}` : ''}`);
const indentedCodeArb = fc.tuple(phraseArb, phraseArb).map(([first, second]) => `\t${first}\n    ${second}`);
const tableArb = fc.tuple(phraseArb, phraseArb, phraseArb, phraseArb).map(([a, b, c, d]) => `| ${a} | ${b} |\n| :--- | ---: |\n| ${c} | ${d} |`);
const htmlArb = phraseArb.map(text => `<aside data-kind="note"><strong>${text}</strong></aside>`);
const referenceArb = fc.tuple(phraseArb, phraseArb).map(([label, detail]) => `[${label}][guide]\n\n[guide]: https://example.test/guide "${detail}"`);
const footnoteArb = fc.tuple(phraseArb, phraseArb).map(([text, detail]) => `${text} uses a footnote[^1].\n\n[^1]: ${detail}`);
const mathArb = phraseArb.map(text => `A formula $x_{${text}} + y^2$ and a display equation:\n\n$$\na^2 + b^2 = c^2\n$$`);
const managedAttachmentArb = fc.tuple(phraseArb, fc.constantFrom(
  { kind: 'image' as const, extension: 'png' },
  { kind: 'audio' as const, extension: 'm4a' },
  { kind: 'video' as const, extension: 'mp4' },
)).map(([name, media]) => attachmentMarkdown({
  id: '123e4567-e89b-12d3-a456-426614174000', name, kind: media.kind,
  url: `foldnote-asset://media/123e4567-e89b-12d3-a456-426614174000.${media.extension}`,
  size: 1, mimeType: 'application/octet-stream',
}));
const imageArb = phraseArb.map(alt => `![${alt}](https://example.test/image.png "attachment")`);
const longLineArb = fc.integer({ min: 256, max: 2048 }).map(length => `longline ${'preserve '.repeat(length)}`);
const blockArb = fc.oneof(
  headingArb, paragraphArb, listArb, quoteArb, fenceArb, indentedCodeArb,
  tableArb, htmlArb, referenceArb, footnoteArb, mathArb, managedAttachmentArb,
  imageArb, longLineArb, fc.constant('---'), fc.constant('***'),
);

const frontmatterArb = fc.constantFrom(
  '',
  '---\ntitle: Antinote export\ntags:\n  - inbox\n  - work\n---',
  '---\ntitle: Daily note\ntags: [personal, ideas]\n---',
  '---\ntags: []\ntitle: Empty metadata\n---',
  '---\n\n---',
  '---\ntags: [button]\n---',
);
const lineEndingArb = fc.constantFrom('\n', '\r\n');
const generatedNoteArb = fc.tuple(
  frontmatterArb,
  fc.array(blockArb, { minLength: 0, maxLength: 5 }),
  fc.constantFrom('\n\n', '\n\n\n', '\r\n\r\n'),
  fc.integer({ min: 0, max: 2 }),
  fc.integer({ min: 0, max: 2 }),
  fc.constantFrom('', ' ', '  ', '\t'),
  fc.boolean(),
  lineEndingArb,
).map(([frontmatter, blocks, separator, leading, trailing, lastLineSpace, finalNewline, ending]) => {
  let body = `${'\n'.repeat(leading)}${blocks.join(separator)}`;
  if (body && lastLineSpace) body += lastLineSpace;
  body += '\n'.repeat(trailing);
  if (finalNewline && body && !body.endsWith('\n')) body += '\n';
  const prefix = frontmatter ? `${frontmatter}${body ? '\n' : ''}` : '';
  return `${prefix}${body}`.replace(/\r\n|\r|\n/g, ending);
});

const PR37_REPRODUCTIONS = [
  '# T\n\n- [ ] a\n- [ ] b',
  '- [ ] a\n- [ ] b',
  '# T\n\n- [ ] a\n- [ ] b\n',
  '# T\r\n\r\n- [ ] a\r\n- [ ] b',
  '---\ntags:\n  - button\n---\n# T\n\n- [ ] a\n- [ ] b',
  '---\ntags: [button]\n---\n- [ ] a\n- [ ] b',
];
const FIXTURES = [
  ...PR37_REPRODUCTIONS.map((markdown, index) => ({ name: `PR #37 trailing task ${index + 1}`, markdown })),
  { name: 'Antinote-like export with block tags', markdown: '---\ntitle: Meeting notes\ntags:\n  - work\n  - follow-up\n---\n\n# Decisions\n\n- [ ] Send the summary\n- [x] Review the draft' },
  { name: 'Antinote-like export with flow tags and references', markdown: '---\ntitle: Reading list\ntags: [ideas, research]\n---\n\n[Guide][guide]\n\n[guide]: https://example.test "Keep this reference"' },
  { name: 'shrunk CRLF source-mode edit counterexample', markdown: '---\ntags: []\ntitle: Empty metadata\n---\r\npreserve emoji🍌 banana 東京 uses a footnote[^1].\r\n\r\n[^1]: task quote quote\r\n\r\n[emoji🍌 banana 東京 漢字かな](https://example.test/guide) _banana emoji🍌 markdown emoji🍌_ *emoji🍌* hard break  \r\nnext line\r\n\r\nPBT_EDIT_TARGET' },
  { name: 'frontmatter only with tags', markdown: '---\ntags: [button]\ntitle: Metadata only\n---' },
  { name: 'empty frontmatter only', markdown: '---\n\n---' },
  { name: 'unterminated fence before trailing task', markdown: '```text\nkeep this code\n- [ ] this is code, not a task' },
  { name: 'CRLF with tabs, hard break, and trailing spaces', markdown: 'First\r\n\r\n\tIndented\r\n\r\nTwo spaces  \r\nnext line  ' },
  { name: 'very long line', markdown: `${'longline preserve '.repeat(4096)}\n\nLast paragraph` },
  { name: 'managed media from the attachment adapter', markdown: `${attachmentMarkdown({ id: '123e4567-e89b-12d3-a456-426614174000', name: 'voice memo.m4a', kind: 'audio', url: 'foldnote-asset://media/123e4567-e89b-12d3-a456-426614174000.m4a', size: 1, mimeType: 'audio/mp4' })}\n\n![Image](foldnote-asset://media/123e4567-e89b-12d3-a456-426614174001.png)` },
];
const markdownArb = fc.oneof(
  { weight: 9, arbitrary: generatedNoteArb },
  { weight: 1, arbitrary: fc.constantFrom(...FIXTURES.map(fixture => fixture.markdown)) },
);

const mountedHosts: HTMLElement[] = [];
const mountedEditors: Editor[] = [];
const editorHosts = new WeakMap<Editor, HTMLElement>();
function destroyEditor(editor: Editor): void {
  if (!editor.isDestroyed) editor.destroy();
  const index = mountedEditors.indexOf(editor);
  if (index >= 0) mountedEditors.splice(index, 1);
  const host = editorHosts.get(editor);
  if (host) {
    host.remove();
    const hostIndex = mountedHosts.indexOf(host);
    if (hostIndex >= 0) mountedHosts.splice(hostIndex, 1);
  }
}
afterEach(() => {
  while (mountedEditors.length) destroyEditor(mountedEditors[0]);
  for (const host of mountedHosts.splice(0)) host.remove();
});
function mountEditor(markdown: string, onChange: (value: string) => void = () => {}) {
  const host = document.createElement('div');
  document.body.append(host); mountedHosts.push(host);
  const editor = createMarkdownEditor(host, markdown, onChange);
  editorHosts.set(editor, host);
  mountedEditors.push(editor);
  return editor;
}
function loadThroughEditor(markdown: string, onChange: (value: string) => void = () => {}) {
  const { frontmatter, body } = splitDocument(markdown);
  const candidate = mountEditor(body, bodyMarkdown => onChange(frontmatter + bodyMarkdown));
  const guard = guardMarkdownEditor(body, candidate);
  if (guard.kind === 'source') destroyEditor(candidate);
  return { frontmatter, body, guard };
}
function visibleWordCounts(value: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of value.normalize('NFKC').matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)) {
    const word = match[0].toLocaleLowerCase('en-US');
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return counts;
}
function withoutWord(counts: Map<string, number>, word: string): Map<string, number> {
  const next = new Map(counts); next.delete(word.toLocaleLowerCase('en-US')); return next;
}

const noOpProperty = fc.property(markdownArb, markdown => {
  const writes: string[] = [];
  const { frontmatter, body, guard } = loadThroughEditor(markdown, saved => writes.push(saved));
  if (guard.kind === 'rich') {
    assert.equal(guard.editor.getMarkdown(), body);
    destroyEditor(guard.editor);
  } else {
    assert.deepEqual(writes, []);
  }
  assert.deepEqual(writes, []);
  assert.equal(frontmatter + body, markdown);
});

test('open/close without edits is byte-identical or does not save', { timeout: 120_000 }, () => {
  fc.assert(noOpProperty, { numRuns: RUNS });
});

test('every generated note is visible in rich text or routed to Markdown source', { timeout: 120_000 }, () => {
  fc.assert(fc.property(markdownArb, markdown => {
    const { body, guard } = loadThroughEditor(markdown);
    if (guard.kind === 'rich') {
      assert.ok(richTextContainsMarkdownWords(body, visibleEditorText(guard.editor)));
      destroyEditor(guard.editor);
    } else {
      assert.deepEqual(guard, { kind: 'source' });
    }
  }), { numRuns: RUNS });
});

const localityBlockArb = fc.oneof(
  headingArb, paragraphArb, listArb, quoteArb, indentedCodeArb, tableArb,
  htmlArb, referenceArb, footnoteArb, mathArb, managedAttachmentArb, imageArb,
  fc.tuple(fc.constantFrom('```', '~~~'), fc.constantFrom('', 'ts', 'text'), phraseArb)
    .map(([fence, language, code]) => `${fence}${language}\nconst note = ${JSON.stringify(code)};\n${fence}`),
  fc.constantFrom('---', '***'),
);
const editableDocumentArb = fc.tuple(
  frontmatterArb,
  fc.array(localityBlockArb, { minLength: 1, maxLength: 4 }),
  fc.constantFrom('\n\n', '\r\n\r\n'),
  fc.constantFrom('\n', '\r\n'),
  fc.boolean(),
).map(([frontmatter, priorBlocks, separator, ending, finalNewline]) => {
  const body = `${priorBlocks.join(separator)}${separator}PBT_EDIT_TARGET${finalNewline ? ending : ''}`
    .replace(/\r\n|\r|\n/g, ending);
  return { note: `${frontmatter}${frontmatter ? ending : ''}${body}` };
});

test('editing the final paragraph changes only that source block and retains all original words', { timeout: 120_000 }, async () => {
  await fc.assert(fc.asyncProperty(editableDocumentArb, async ({ note }) => {
    const { body } = splitDocument(note);
    const targetOffset = body.lastIndexOf('PBT_EDIT_TARGET');
    assert.ok(targetOffset >= 0);
    const now = '2026-10-23T12:00:00.000Z';
    const commands = new LibraryCommands({ now: () => now }, { next: () => 'unused' });
    let library: Library = { version: 1, activeTag: null, selectedID: 'pbt-note', notes: [{ id: 'pbt-note', markdown: note, createdAt: now, updatedAt: now }] };
    const persisted: string[] = [];
    const queue = new SaveQueue({ save: async next => { persisted.push(next.notes[0].markdown); } }, () => {});
    const commit = (markdown: string) => {
      const result = commands.edit(library, 'pbt-note', markdown);
      if (result.kind !== 'applied') throw new Error(result.message);
      library = result.library;
      queue.enqueue(library);
    };
    const { guard } = loadThroughEditor(note, commit);
    if (guard.kind === 'rich') {
      guard.editor.commands.setTextSelection(guard.editor.state.doc.content.size - 1);
      guard.editor.commands.insertContent(' PBT_INSERTED');
    } else {
      const source = document.createElement('textarea'); source.value = note;
      bindMarkdownSourceTextarea(source, note, commit);
      source.setSelectionRange(source.value.length, source.value.length);
      source.setRangeText(' PBT_INSERTED', source.value.length, source.value.length, 'end');
      source.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await queue.flush();
    const saved = persisted.at(-1);
    assert.notEqual(saved, undefined);
    const savedBody = splitDocument(saved!).body;
    assert.equal(savedBody.slice(0, targetOffset), body.slice(0, targetOffset));
    assert.match(savedBody, /PBT\\?_INSERTED/);
    assert.ok(richTextContainsMarkdownWords(body, markdownVisibleText(savedBody)));
    assert.ok(richTextContainsMarkdownWords('PBT_INSERTED', markdownVisibleText(savedBody)));
    if (guard.kind === 'rich') destroyEditor(guard.editor);
  }), { numRuns: RUNS });
});

const tagOperationNoteArb = fc.tuple(
  frontmatterArb,
  paragraphArb,
  fc.array(blockArb, { minLength: 0, maxLength: 4 }),
  fc.constantFrom('\n', '\r\n'),
).map(([frontmatter, firstParagraph, rest, ending]) => {
  const body = [firstParagraph, ...rest].join(`${ending}${ending}`);
  return `${frontmatter}${frontmatter ? ending : ''}${body}`.replace(/\r\n|\r|\n/g, ending);
});
const TAG = 'pbtmarker';
test('adding and removing a tag is idempotent and preserves every other visible word', { timeout: 120_000 }, () => {
  fc.assert(fc.property(tagOperationNoteArb, fc.boolean(), (markdown, inline) => {
    const taggedInput = inline ? `${markdown}${markdown ? '\n\n' : ''}Tagged note #${TAG}` : markdown;
    const originalBody = splitDocument(taggedInput).body;
    const originalWords = withoutWord(visibleWordCounts(markdownVisibleText(originalBody)), TAG);
    const now = '2026-10-23T12:00:00.000Z';
    const commands = new LibraryCommands({ now: () => now }, { next: () => 'unused' });
    const initial: Library = { version: 1, activeTag: null, selectedID: 'pbt-note', notes: [{ id: 'pbt-note', markdown: taggedInput, createdAt: now, updatedAt: now }] };
    const addedResult = commands.addTag(initial, 'pbt-note', TAG);
    if (addedResult.kind !== 'applied') throw new Error(addedResult.message);
    const added = addedResult.library.notes[0].markdown;
    const repeatedAdd = commands.addTag(addedResult.library, 'pbt-note', TAG);
    assert.equal(repeatedAdd.kind, 'applied');
    const addedBody = splitDocument(added).body;
    assert.equal(repeatedAdd.library.notes[0].markdown, added);
    assert.equal(addedBody, originalBody);
    assert.deepEqual(withoutWord(visibleWordCounts(markdownVisibleText(addedBody)), TAG), originalWords);

    const removedResult = commands.removeTag(repeatedAdd.library, 'pbt-note', TAG);
    if (removedResult.kind !== 'applied') throw new Error(removedResult.message);
    const removed = removedResult.library.notes[0].markdown;
    const repeatedRemove = commands.removeTag(removedResult.library, 'pbt-note', TAG);
    assert.equal(repeatedRemove.kind, 'applied');
    assert.equal(repeatedRemove.library.notes[0].markdown, removed);
    assert.deepEqual(withoutWord(visibleWordCounts(markdownVisibleText(splitDocument(removed).body)), TAG), originalWords);
    if (!inline) assert.equal(splitDocument(removed).body, originalBody);
  }), { numRuns: RUNS });
});

test('copying a whole note as Markdown returns its exact original source', { timeout: 30_000 }, () => {
  fc.assert(fc.property(markdownArb, markdown => {
    assert.deepEqual(documentClipboardPayload(markdown, 'markdown'), { text: markdown, markdown });
  }), { numRuns: RUNS });
});

test('shrunk source-mode edit preserves every untouched CRLF source byte', () => {
  const source = FIXTURES.find(fixture => fixture.name === 'shrunk CRLF source-mode edit counterexample')!.markdown;
  const area = document.createElement('textarea'); area.value = source;
  let saved = '';
  bindMarkdownSourceTextarea(area, source, markdown => { saved = markdown; });
  area.setSelectionRange(area.value.length, area.value.length);
  area.setRangeText(' PBT_INSERTED', area.value.length, area.value.length, 'end');
  area.dispatchEvent(new Event('input', { bubbles: true }));
  assert.equal(saved, `${source} PBT_INSERTED`);
});

test('serializer-escaped underscores remain visible and editable after a round trip', () => {
  const writes: string[] = [];
  const first = mountEditor('PBT_EDIT_TARGET', markdown => writes.push(markdown));
  assert.equal(guardMarkdownEditor('PBT_EDIT_TARGET', first).kind, 'rich');
  first.commands.setTextSelection(first.state.doc.content.size - 1);
  first.commands.insertContent(' PBT_INSERTED');
  const saved = writes.at(-1)!;
  destroyEditor(first);
  assert.equal(saved, 'PBT\\_EDIT\\_TARGET PBT\\_INSERTED');

  const reloaded = mountEditor(saved);
  const guard = guardMarkdownEditor(saved, reloaded);
  assert.equal(markdownVisibleText(saved), 'PBT_EDIT_TARGET PBT_INSERTED');
  assert.ok(richTextContainsMarkdownWords('PBT_EDIT_TARGET', markdownVisibleText(saved)));
  assert.equal(guard.kind, 'rich');
  if (guard.kind === 'rich') {
    assert.equal(visibleEditorText(guard.editor), 'PBT_EDIT_TARGET PBT_INSERTED');
    destroyEditor(guard.editor);
  }
});

for (const fixture of FIXTURES) {
  test(`fixed Markdown fidelity fixture: ${fixture.name}`, () => {
    const writes: string[] = [];
    const { frontmatter, body, guard } = loadThroughEditor(fixture.markdown, saved => writes.push(saved));
    if (guard.kind === 'rich') {
      assert.equal(guard.editor.getMarkdown(), body);
      assert.ok(richTextContainsMarkdownWords(body, visibleEditorText(guard.editor)));
      destroyEditor(guard.editor);
    }
    assert.deepEqual(writes, []);
    assert.equal(frontmatter + body, fixture.markdown);
  });
}
