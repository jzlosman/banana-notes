interface SourceTextareaState {
  source: string;
  view: string;
}

export interface MarkdownSourceTextarea {
  /** Rebase the textarea after an external source update, such as a tag operation. */
  sync(source: string): void;
}

function normalizeLineEndings(source: string): { view: string; sourceOffsetAtViewOffset: number[] } {
  let view = '';
  const sourceOffsetAtViewOffset = [0];
  for (let offset = 0; offset < source.length;) {
    if (source[offset] === '\r') {
      offset += source[offset + 1] === '\n' ? 2 : 1;
      view += '\n';
    } else {
      view += source[offset++];
    }
    sourceOffsetAtViewOffset.push(offset);
  }
  return { view, sourceOffsetAtViewOffset };
}

function sourceLineEnding(source: string): string {
  return source.match(/\r\n|\r|\n/)?.[0] ?? '\n';
}

/**
 * Apply a textarea's single localized change to the original Markdown bytes.
 * HTML textareas normalize CRLF to LF, so saving `textarea.value` directly
 * would rewrite every untouched line ending in a CRLF note.
 */
export function applyMarkdownTextareaChange(source: string, previousView: string, nextView: string): string {
  if (previousView === nextView) return source;
  const normalized = normalizeLineEndings(source);
  if (normalized.view !== previousView) throw new Error('Markdown source editor is out of sync with the note.');

  let prefix = 0;
  const sharedLength = Math.min(previousView.length, nextView.length);
  while (prefix < sharedLength && previousView[prefix] === nextView[prefix]) prefix++;

  let suffix = 0;
  while (suffix < previousView.length - prefix && suffix < nextView.length - prefix
    && previousView[previousView.length - 1 - suffix] === nextView[nextView.length - 1 - suffix]) suffix++;

  const sourceStart = normalized.sourceOffsetAtViewOffset[prefix];
  const sourceEnd = normalized.sourceOffsetAtViewOffset[previousView.length - suffix];
  const inserted = nextView.slice(prefix, nextView.length - suffix).replace(/\r\n|\r|\n/g, sourceLineEnding(source));
  return source.slice(0, sourceStart) + inserted + source.slice(sourceEnd);
}

/** Bind the application's raw-Markdown source editor to its byte-preserving edit boundary. */
export function bindMarkdownSourceTextarea(
  textarea: HTMLTextAreaElement,
  initialSource: string,
  onChange: (source: string) => void,
): MarkdownSourceTextarea {
  const state: SourceTextareaState = { source: initialSource, view: textarea.value };
  textarea.addEventListener('input', () => {
    const nextView = textarea.value;
    if (nextView === state.view) return;
    state.source = applyMarkdownTextareaChange(state.source, state.view, nextView);
    state.view = nextView;
    onChange(state.source);
  });
  return {
    sync(source: string) {
      state.source = source;
      state.view = textarea.value;
    },
  };
}
