/** Normalize input only at TipTap's Markdown parser boundary; callers retain the original source bytes. */
export function markdownParserInput(source: string): string {
  const normalized = source.replace(/\r\n?/g, '\n');
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`;
}
