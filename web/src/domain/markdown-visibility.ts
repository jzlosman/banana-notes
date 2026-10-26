import { Marked } from 'marked';
import { isManagedMediaURL } from './managed-media';

// Keep this read-only lexer separate from the mutable editor tokenizer registry.
const visibleMarkdown = new Marked({ gfm: true });
type RichTextToken = {
  type: string;
  text?: string;
  raw?: string;
  tokens?: RichTextToken[];
  items?: RichTextToken[];
  header?: RichTextToken[];
  rows?: RichTextToken[][];
};

const inlineContainers = new Set(['paragraph', 'heading', 'text', 'strong', 'em', 'del', 'link']);
function tokenText(tokens: RichTextToken[]): string[] {
  const text: string[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type === 'html') {
      const media = token.raw?.match(/^<(audio|video) controls src="([^"]+)">$/i);
      const closing = tokens[index + 1];
      if (media && isManagedMediaURL(media[2]) && closing?.raw?.toLowerCase() === `</${media[1].toLowerCase()}>`) {
        index++;
        continue;
      }
    }
    switch (token.type) {
      case 'space':
      case 'checkbox':
      case 'hr':
        break;
      case 'br':
        text.push('\n');
        break;
      case 'code':
      case 'codespan':
      case 'image':
        text.push(token.text ?? '');
        break;
      case 'html':
      case 'def':
        // Unsupported blocks are shown as escaped Markdown source in the editor.
        text.push(token.raw ?? token.text ?? '');
        break;
      case 'list':
        text.push(...(token.items ?? []).map(item => tokenText([item]).join(' ')));
        break;
      case 'table':
        text.push(...[...(token.header ?? []), ...(token.rows ?? []).flat()].map(cell =>
          cell.tokens?.length ? tokenText(cell.tokens).join('') : cell.text ?? ''));
        break;
      default:
        if (token.tokens?.length) {
          const children = tokenText(token.tokens);
          text.push(inlineContainers.has(token.type) ? children.join('') : children.join(' '));
        } else if (typeof token.text === 'string') text.push(token.text);
        break;
    }
  }
  return text;
}

/** Plain visible Markdown text, excluding syntax such as task checkboxes and list markers. */
export function markdownVisibleText(markdown: string): string {
  return tokenText(visibleMarkdown.lexer(markdown) as unknown as RichTextToken[]).join(' ');
}

function words(text: string): Map<string, number> {
  // Character references render as symbols, not as words such as "amp" or "nbsp".
  const visible = text.replace(/&(?:#[\da-f]+|#x[\da-f]+|[a-z][a-z\d]+);/giu, ' ').normalize('NFKC');
  const counts = new Map<string, number>();
  for (const match of visible.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)) {
    const word = match[0].toLocaleLowerCase('en-US');
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return counts;
}

/** True only when every visible source word, including repeated words, survives parsing. */
export function richTextContainsMarkdownWords(sourceMarkdown: string, renderedText: string): boolean {
  const available = words(renderedText);
  for (const [word, count] of words(markdownVisibleText(sourceMarkdown))) {
    if ((available.get(word) ?? 0) < count) return false;
  }
  return true;
}
