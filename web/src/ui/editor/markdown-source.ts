import { Node, type Editor, type JSONContent } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Tokens } from 'marked';

/** A source-only block is intentionally atomic: editing it means switching to Markdown source mode. */
export const RawMarkdownBlock = Node.create({
  name: 'rawMarkdownBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() { return { source: { default: '' } }; },
  renderHTML({ node }) {
    return ['pre', { class: 'raw-markdown-block', role: 'group', 'aria-label': 'Markdown source block' }, ['code', {}, String(node.attrs.source ?? '')]];
  },
  markdownTokenName: 'html',
  parseMarkdown(token: any, helpers: any) {
    if (token.block === false) return null;
    return helpers.createNode(this.name, { source: String(token.raw ?? '') });
  },
  renderMarkdown(node: any) { return String(node.attrs?.source ?? ''); },
});

interface SourceBlock {
  readonly source: string;
  readonly signature: string;
  readonly node: ProseMirrorNode;
}
interface MarkdownSource {
  readonly prefix: string;
  readonly blocks: SourceBlock[];
  readonly lineEnding: '\n' | '\r\n' | '\r';
}

function normalizeLineEndings(source: string): { markdown: string; originalOffset: number[] } {
  let markdown = '';
  const originalOffset = [0];
  for (let index = 0; index < source.length;) {
    if (source[index] === '\r') {
      index += source[index + 1] === '\n' ? 2 : 1;
      markdown += '\n';
      originalOffset.push(index);
    } else {
      markdown += source[index++];
      originalOffset.push(index);
    }
  }
  return { markdown, originalOffset };
}

function nestedTokens(token: any): any[] {
  return [token, ...(Array.isArray(token.tokens) ? token.tokens.flatMap(nestedTokens) : [])];
}

function unsupported(token: any, source: string): boolean {
  if (token.type === 'def') return true;
  if (token.type === 'html') return true;
  const tokens = nestedTokens(token);
  if (tokens.some(part => part.type === 'html' || part.type === 'def')) return true;
  if (tokens.some(part => part.type === 'link' && /^!?\[[\s\S]*?\](?:\[[^\]]*\])?$/.test(part.raw ?? ''))) return true;
  if (/\[\^[^\]]+\]/.test(source)) return true;
  if (/\\#/.test(source)) return true;
  if (/(?:\$\$?[\s\S]+?\$\$?|\\\([\s\S]+?\\\)|\\\[(?=[^\]]*(?:\\[a-z]+|[=+^_*/]))[\s\S]+?\\\])/.test(source)) return true;
  return false;
}

function signature(node: JSONContent): string { return JSON.stringify(node); }

function sourceBlocks(editor: Editor, source: string): { prefix: string; blocks: { token: string; rawSource: string; source: string }[]; lineEnding: MarkdownSource['lineEnding'] } {
  const normalized = normalizeLineEndings(source);
  const tokens = editor.markdown!.instance.lexer(normalized.markdown);
  const starts: { token: Tokens.Generic; start: number; end: number }[] = [];
  let cursor = 0;
  for (const token of tokens) {
    const start = normalized.markdown.indexOf(token.raw, cursor);
    if (start < 0) continue;
    const end = start + token.raw.length;
    starts.push({ token: token as Tokens.Generic, start, end });
    cursor = end;
  }
  const meaningful = starts.filter(item => item.token.type !== 'space');
  const lineEnding: MarkdownSource['lineEnding'] = source.includes('\r\n') ? '\r\n' : source.includes('\r') ? '\r' : '\n';
  if (!meaningful.length) return { prefix: source, blocks: [], lineEnding };
  const blocks = meaningful.map((item, index) => {
    const nextStart = meaningful[index + 1]?.start ?? normalized.markdown.length;
    return {
      token: normalized.markdown.slice(item.start, item.end),
      rawSource: source.slice(normalized.originalOffset[item.start], normalized.originalOffset[item.end]),
      source: source.slice(normalized.originalOffset[item.start], normalized.originalOffset[nextStart]),
    };
  });
  return { prefix: source.slice(0, normalized.originalOffset[meaningful[0].start]), blocks, lineEnding };
}

function normalizedNode(editor: Editor, node: JSONContent): JSONContent[] {
  const type = editor.schema.nodes[node.type ?? ''];
  if (!type) return [];
  return type.isInline ? [{ type: 'paragraph', content: [node] }] : [node];
}

function rawNode(source: string): JSONContent { return { type: RawMarkdownBlock.name, attrs: { source } }; }

/** Parse once at the adapter boundary, replacing unsupported syntax with safe source atoms. */
export function installMarkdownSource(editor: Editor, source: string): void {
  const parsed = sourceBlocks(editor, source);
  const content: JSONContent[] = [];

  for (const block of parsed.blocks) {
    let nodes: JSONContent[] = [];
    const token = editor.markdown!.instance.lexer(block.token)[0];
    if (token && !unsupported(token, block.token)) {
      const parseInput = block.token.replace(/\n+$/, '');
      const result = editor.markdown!.parse(parseInput);
      nodes = (result.content ?? []).flatMap(node => normalizedNode(editor, node));
    }
    if (nodes.length !== 1) nodes = [rawNode(block.rawSource)];
    content.push(nodes[0]);
  }

  if (content.length) {
    const doc = editor.schema.nodeFromJSON({ type: 'doc', content });
    editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content)
      .setMeta('preventUpdate', true).setMeta('addToHistory', false));
  }
  const sourceState: MarkdownSource = {
    prefix: parsed.prefix,
    blocks: parsed.blocks.map((block, index) => {
      const node = editor.state.doc.child(index);
      return { source: block.source, signature: signature(node.toJSON()), node };
    }),
    lineEnding: parsed.lineEnding,
  };
  editor.getMarkdown = () => serializePreservingSource(editor, sourceState);
}

function serializedNode(editor: Editor, node: JSONContent, lineEnding: MarkdownSource['lineEnding']): string {
  const markdown = editor.markdown!.serialize(node).replace(/^(?:\r?\n)+|(?:\r?\n)+$/g, '');
  return lineEnding === '\n' ? markdown : markdown.replace(/\n/g, lineEnding);
}

function trailingLineEndings(source: string): string {
  return source.match(/(?:\r\n|\r|\n)+$/)?.[0] ?? '';
}

/** Reuse byte-identical source blocks; serialize only changed or newly inserted nodes. */
function serializePreservingSource(editor: Editor, source: MarkdownSource): string {
  const currentNodes = editor.state.doc.content.content;
  const current = currentNodes.map(node => node.toJSON() as JSONContent);
  const signatures = current.map(signature);
  const sourceAt = new Map<string, number[]>();
  const sourceNodeAt = new Map<ProseMirrorNode, number[]>();
  source.blocks.forEach((block, index) => {
    const occurrences = sourceAt.get(block.signature) ?? [];
    occurrences.push(index); sourceAt.set(block.signature, occurrences);
    const nodeOccurrences = sourceNodeAt.get(block.node) ?? [];
    nodeOccurrences.push(index); sourceNodeAt.set(block.node, nodeOccurrences);
  });
  const sourceForCurrent: (number | undefined)[] = Array(current.length).fill(undefined);
  const anchors: { current: number; source: number }[] = [];
  let previousSource = -1;
  for (let index = 0; index < signatures.length; index++) {
    const nextOccurrence = (occurrences: number[] | undefined): number | undefined => {
      if (!occurrences) return undefined;
      let low = 0, high = occurrences.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (occurrences[middle] <= previousSource) low = middle + 1; else high = middle;
      }
      return occurrences[low];
    };
    const candidate = nextOccurrence(sourceNodeAt.get(currentNodes[index])) ?? nextOccurrence(sourceAt.get(signatures[index]));
    if (candidate !== undefined) {
      sourceForCurrent[index] = candidate;
      anchors.push({ current: index, source: candidate });
      previousSource = candidate;
    }
  }

  let currentStart = 0, sourceStart = 0;
  for (const anchor of [...anchors, { current: current.length, source: source.blocks.length }]) {
    const currentCount = anchor.current - currentStart;
    const sourceCount = anchor.source - sourceStart;
    const pairedCount = Math.min(currentCount, sourceCount);
    for (let offset = 1; offset <= pairedCount; offset++) {
      sourceForCurrent[anchor.current - offset] = anchor.source - offset;
    }
    currentStart = anchor.current + 1; sourceStart = anchor.source + 1;
  }

  if (current.length === source.blocks.length && current.every((_, index) => sourceForCurrent[index] === index && signatures[index] === source.blocks[index].signature)) {
    return source.prefix + source.blocks.map(block => block.source).join('');
  }
  if (!current.length) return source.prefix + (source.blocks.length ? '' : '');

  const rendered = current.map((node, index) => {
    const sourceIndex = sourceForCurrent[index];
    const original = sourceIndex === undefined ? undefined : source.blocks[sourceIndex];
    if (original && signatures[index] === original.signature) return original.source;
    const markdown = serializedNode(editor, node, source.lineEnding);
    const ending = original ? trailingLineEndings(original.source) : index < current.length - 1 ? source.lineEnding + source.lineEnding : '';
    return markdown + ending;
  });
  return source.prefix + rendered.join('');
}
