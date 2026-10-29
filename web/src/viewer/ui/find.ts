export type TextSearchIndex = {
  text: string;
  matches(query: string): number[];
  range(start: number, length: number): Range | null;
};

const blockTags = new Set(['ADDRESS', 'BLOCKQUOTE', 'BR', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'LI', 'MAIN', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL']);
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Index visible text nodes as rendered, retaining DOM offsets across inline formatting boundaries. */
export function createTextSearchIndex(root: HTMLElement): TextSearchIndex {
  const chunks: { node: Text; start: number; end: number }[] = [];
  let text = '';
  const separator = () => { if (text && !text.endsWith('\n')) text += '\n'; };
  const visit = (node: Node, isRoot = false): void => {
    if (node.nodeType === node.TEXT_NODE) {
      const value = node.nodeValue ?? '';
      if (value) { const start = text.length; text += value; chunks.push({ node: node as Text, start, end: text.length }); }
      return;
    }
    if (node.nodeType !== node.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    if (!isRoot && (element.hidden || element.getAttribute('aria-hidden') === 'true' || ['SCRIPT', 'STYLE', 'TEMPLATE'].includes(element.tagName))) return;
    const block = !isRoot && blockTags.has(element.tagName);
    if (block) separator();
    for (const child of element.childNodes) visit(child);
    if (block) separator();
  };
  visit(root, true);

  return {
    text,
    matches(query) {
      const value = query.trim();
      if (!value) return [];
      return [...text.matchAll(new RegExp(escapeRegExp(value), 'giu'))].map(match => match.index ?? 0);
    },
    range(start, length) {
      const end = start + length;
      const first = chunks.find(chunk => start >= chunk.start && start < chunk.end);
      const last = [...chunks].reverse().find(chunk => end > chunk.start && end <= chunk.end);
      if (!first || !last) return null;
      const range = root.ownerDocument.createRange();
      range.setStart(first.node, start - first.start);
      range.setEnd(last.node, end - last.start);
      return range;
    },
  };
}
