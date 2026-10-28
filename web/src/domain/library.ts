import { isMap, isScalar, isSeq, parseDocument, stringify } from 'yaml';
import { Marked, type Token } from 'marked';
import { normalizeTag, validTag } from './tags';
import { normalizeScopePreferences, scopeKey, scopeTagsFromKey, type ScopeBookmarks } from './scope-preferences';
// Editor extensions install custom tokenizers; never let them mutate tag queries.
const proseMarkdown = new Marked({ gfm: true });
const MAX_READ_CACHE_CHARS = 8_000_000;
type MarkdownReadModel = { tags?: string[]; title?: string; excerpt?: string; searchText?: string };
const readModels = new Map<string, MarkdownReadModel>();
let readModelChars = 0;
function readModel(markdown: string): MarkdownReadModel {
  const cached = readModels.get(markdown);
  if (cached) { readModels.delete(markdown); readModels.set(markdown, cached); return cached; }
  if (markdown.length > MAX_READ_CACHE_CHARS) return {};
  const model: MarkdownReadModel = {};
  readModels.set(markdown, model); readModelChars += markdown.length;
  while (readModelChars > MAX_READ_CACHE_CHARS && readModels.size) {
    const [oldest] = readModels.keys();
    readModels.delete(oldest); readModelChars -= oldest.length;
  }
  return model;
}

export const MAX_LIBRARY_NOTES = 20_000;
export const MAX_NOTE_MARKDOWN_BYTES = 2_000_000;
export interface Note { id: string; markdown: string; createdAt: string; updatedAt: string; trashedAt?: string }
export interface Library { version: 1; notes: Note[]; selectedID: string | null; activeTag: string | null; activeTags?: string[] }

/** UTF-8 length without depending on browser or Node APIs. */
export function markdownByteLength(markdown: string): number {
  let bytes = 0;
  for (const character of markdown) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}
export interface DocumentParts { frontmatter: string; body: string; metadata: Record<string, unknown>; error?: string }

export function splitDocument(markdown: string): DocumentParts {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { frontmatter: '', body: markdown, metadata: {} };
  try {
    const doc = parseDocument(match[1], { uniqueKeys: true });
    if (doc.errors.length) throw new Error(doc.errors[0].message);
    const metadata = doc.toJS({ maxAliasCount: 10 });
    if (metadata !== null && (typeof metadata !== 'object' || Array.isArray(metadata))) throw new Error('Frontmatter must be a mapping');
    return { frontmatter: match[0], body: markdown.slice(match[0].length), metadata: metadata || {} };
  } catch { return { frontmatter: '', body: markdown, metadata: {}, error: 'Invalid frontmatter. Edit Markdown source to fix it; your text is preserved.' }; }
}
function frontmatterTags(metadata: Record<string, unknown>): string[] {
  const value = metadata.tags ?? metadata.tag;
  return (Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\s]+/) : [])
    .filter((v): v is string => typeof v === 'string').map(normalizeTag).filter(validTag);
}
function parseTags(markdown: string): string[] {
  const { metadata, body } = splitDocument(markdown);
  // Use the editor's Markdown grammar, not a second custom dialect. Only prose
  // leaf tokens can form tags: code, escapes, HTML, and link destinations cannot.
  const inline: string[] = [];
  const literalTokens = new Set<Token>();
  proseMarkdown.walkTokens(proseMarkdown.lexer(body), token => {
    if (token.type === 'image' && 'tokens' in token && Array.isArray(token.tokens)) proseMarkdown.walkTokens(token.tokens, child => { literalTokens.add(child); });
    if (literalTokens.has(token) || token.type !== 'text' || ('tokens' in token && token.tokens)) return;
    for (const match of token.text.matchAll(/(?:^|[\s(\[{])#([\p{L}][\p{L}\p{N}_/-]*)/gu)) inline.push(normalizeTag(match[1]));
  });
  return [...new Set([...frontmatterTags(metadata), ...inline].filter(validTag))].sort();
}
export function tagsOf(markdown: string): string[] {
  const model = readModel(markdown);
  return [...(model.tags ??= parseTags(markdown))];
}
export function withTag(markdown: string, tag: string): string {
  const normalized = normalizeTag(tag);
  if (!validTag(normalized)) throw new Error('Use a letter first, then letters, numbers, dashes, underscores, or slashes.');
  const parts = splitDocument(markdown);
  if (parts.error) throw new Error(parts.error);
  if (tagsOf(markdown).includes(normalized)) return markdown;
  const metadata = { ...parts.metadata, tags: [...new Set([...frontmatterTags(parts.metadata), normalized])] };
  return `---\n${stringify(metadata).trimEnd()}\n---\n${parts.body}`;
}
interface MarkdownRange { start: number; end: number; replacement?: string }
function lineStart(source: string, offset: number): number { return source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1; }
function lineEnd(source: string, offset: number): number {
  if (source[offset - 1] === '\n') return offset;
  const newline = source.indexOf('\n', offset);
  return newline < 0 ? source.length : newline + 1;
}
function removeFrontmatterTag(source: string, tag: string): { source: string; changed: boolean } {
  const delimiters = source.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)(\r?\n)?$/);
  if (!delimiters) return { source, changed: false };
  const yaml = delimiters[2];
  const yamlDocument = parseDocument(yaml, { uniqueKeys: true });
  if (yamlDocument.errors.length || !isMap(yamlDocument.contents)) return { source, changed: false };
  const edits: MarkdownRange[] = [];
  for (const pair of yamlDocument.contents.items) {
    if (!isScalar(pair.key) || (pair.key.value !== 'tags' && pair.key.value !== 'tag') || !pair.value) continue;
    const fieldRange = pair.value.range;
    if (isSeq(pair.value)) {
      const values = pair.value.items;
      const matches = values.map((value, index) => isScalar(value) && typeof value.value === 'string' && normalizeTag(value.value) === tag ? index : -1).filter(index => index >= 0);
      const matchingIndices = new Set(matches);
      if (!matches.length) continue;
      const keyRange = pair.key.range;
      if (!keyRange || !fieldRange) continue;
      if (matches.length === values.length) {
        edits.push({ start: lineStart(yaml, keyRange[0]), end: fieldRange[2] });
      } else if (pair.value.flow) {
        let cursor = 0;
        while (cursor < values.length) {
          if (!matchingIndices.has(cursor)) { cursor++; continue; }
          const first = cursor;
          while (cursor + 1 < values.length && matchingIndices.has(cursor + 1)) cursor++;
          const last = cursor;
          const firstRange = (values[first] as { range?: [number, number, number] }).range;
          const lastRange = (values[last] as { range?: [number, number, number] }).range;
          if (!firstRange || !lastRange) { cursor++; continue; }
          if (last < values.length - 1) {
            const nextRange = (values[last + 1] as { range?: [number, number, number] }).range;
            if (nextRange) edits.push({ start: firstRange[0], end: nextRange[0] });
          } else {
            const previousRange = (values[first - 1] as { range?: [number, number, number] }).range;
            if (previousRange) edits.push({ start: previousRange[1], end: lastRange[1] });
          }
          cursor++;
        }
      } else {
        for (const index of matches) {
          const range = (values[index] as { range?: [number, number, number] }).range;
          if (range) edits.push({ start: lineStart(yaml, range[0]), end: lineEnd(yaml, range[2]) });
        }
      }
    } else if (isScalar(pair.value) && typeof pair.value.value === 'string') {
      const values = pair.value.value.split(/[\s,]+/).filter(value => value && normalizeTag(value) !== tag);
      const allValues = pair.value.value.split(/[\s,]+/).filter(Boolean);
      if (values.length === allValues.length) continue;
      const keyRange = pair.key.range;
      if (!keyRange || !fieldRange) continue;
      if (!values.length) edits.push({ start: lineStart(yaml, keyRange[0]), end: fieldRange[2] });
      else edits.push({ start: fieldRange[0], end: fieldRange[1], replacement: stringify(values.join(', ')).trimEnd() });
    }
  }
  if (!edits.length) return { source, changed: false };
  let updatedYAML = yaml;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    updatedYAML = updatedYAML.slice(0, edit.start) + ('replacement' in edit ? edit.replacement : '') + updatedYAML.slice(edit.end);
  }
  if (!updatedYAML.trim()) return { source: '', changed: true };
  return { source: `${delimiters[1]}${updatedYAML}${delimiters[3]}${delimiters[4] ?? ''}`, changed: true };
}
interface InlineTagRange extends MarkdownRange { tag: string }
type SourceToken = Token & { text?: string; tokens?: Token[] };
function inlineTagRanges(body: string): InlineTagRange[] {
  const ranges: InlineTagRange[] = [];
  const pattern = /(?:^|[\s(\[{])#([\p{L}][\p{L}\p{N}_/-]*)/gu;
  const visit = (token: SourceToken, start: number, raw: string): void => {
    if (token.type === 'image') return;
    const children = Array.isArray(token.tokens) ? token.tokens : [];
    if (token.type === 'text' && !children.length && typeof token.text === 'string' && raw === token.text) {
      for (const match of token.text.matchAll(pattern)) {
        const normalized = normalizeTag(match[1]);
        if (!validTag(normalized)) continue;
        const hash = match[0].lastIndexOf('#');
        const tokenStart = start + match.index + hash;
        ranges.push({ tag: normalized, start: tokenStart, end: tokenStart + match[1].length + 1 });
      }
    }
    let childCursor = 0;
    for (const child of children) {
      const childRaw = String(child.raw ?? '');
      if (!childRaw) continue;
      const index = raw.indexOf(childRaw, childCursor);
      if (index < 0) continue;
      visit(child as SourceToken, start + index, childRaw);
      childCursor = index + childRaw.length;
    }
  };
  let cursor = 0;
  for (const token of proseMarkdown.lexer(body)) {
    const raw = String(token.raw ?? '');
    if (!raw) continue;
    const start = body.indexOf(raw, cursor);
    if (start < 0) continue;
    visit(token as SourceToken, start, raw);
    cursor = start + raw.length;
  }
  return ranges;
}
/** Removes a tag everywhere it is stored; inline removal deletes only the #tag token. */
export function removeTag(markdown: string, tag: string): string {
  const normalized = normalizeTag(tag);
  if (!validTag(normalized)) throw new Error('Use a letter first, then letters, numbers, dashes, underscores, or slashes.');
  const parts = splitDocument(markdown);
  if (parts.error) throw new Error(parts.error);
  const frontmatter = removeFrontmatterTag(parts.frontmatter, normalized);
  const inlineRanges = inlineTagRanges(parts.body).filter(range => range.tag === normalized);
  if (!frontmatter.changed && !inlineRanges.length) return markdown;
  let body = parts.body;
  for (const range of inlineRanges.sort((left, right) => right.start - left.start)) body = body.slice(0, range.start) + body.slice(range.end);
  return frontmatter.source + body;
}
function plainMarkdownLine(line: string): string {
  return line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/gi, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s{0,3}>\s?/, '')
    .replace(/^\s*(?:(?:[-+*]|\d+[.)])\s+)?(?:\[[ xX]\]\s+)?/, '')
    .replace(/\\([\\`*_{}\[\]()#+.!<>|-])/g, '$1')
    .replace(/<\/?[\w-]+(?:\s+[^<>]*?)?>/g, '')
    .replace(/[*_~`]/g, '')
    .replace(/(^|[\s([{])#[\p{L}][\p{L}\p{N}_/-]*/gu, '$1')
    .replace(/\s+/g, ' ').trim();
}
function titleParts(markdown: string): { title: string; lineIndex: number } {
  const lines = splitDocument(markdown).body.split(/\r?\n/);
  const lineIndex = lines.findIndex(line => line.trim()
    && !/^\s*#[\p{L}][\p{L}\p{N}_/-]*\s*$/u.test(line)
    && !/^\s*!\[.*\]\(.*\)\s*$/.test(line)
    && !/^\s*<(audio|video)\b.*<\/\1>\s*$/i.test(line)
    && plainMarkdownLine(line));
  return { title: lineIndex < 0 ? '' : plainMarkdownLine(lines[lineIndex]).slice(0, 120), lineIndex };
}
function parseTitle(markdown: string): string { return titleParts(markdown).title; }
export function titleOf(markdown: string): string {
  const model = readModel(markdown);
  return model.title ??= parseTitle(markdown);
}
export function excerptOf(markdown: string): string {
  const model = readModel(markdown);
  if (model.excerpt !== undefined) return model.excerpt;
  const body = splitDocument(markdown).body;
  const { title, lineIndex } = titleParts(markdown);
  model.excerpt = body.split(/\r?\n/).flatMap((line, index) => {
    if (index === lineIndex) return [];
    const plain = plainMarkdownLine(line);
    return plain && plain !== title ? [plain] : [];
  }).join(', ').replace(/\s+/g, ' ').trim().slice(0, 160);
  return model.excerpt;
}
export function isBlankMarkdown(markdown: string): boolean { return !splitDocument(markdown).body.trim(); }

export function noteTaskProgress(markdown: string): { done: number; total: number } | null {
  const { body } = splitDocument(markdown);
  const tokens = proseMarkdown.lexer(body);
  let total = 0, done = 0;
  const visit = (items: Token[]): void => {
    for (const token of items) {
      const list = token as Token & { type: string; items?: { task?: boolean; checked?: boolean; tokens?: Token[] }[] };
      if (list.type === 'list' && list.items) {
        for (const item of list.items) {
          if (item.task) { total++; if (item.checked) done++; }
          if (item.tokens) visit(item.tokens);
        }
      } else if ('tokens' in token && Array.isArray(token.tokens)) visit(token.tokens);
    }
  };
  visit(tokens);
  return total ? { done, total } : null;
}

export interface NoteDayGroup { key: string; label: string; notes: Note[] }
function localDayParts(value: string, locale: string, timeZone: string): { key: string; year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat(locale, { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const year = Number(values.year), month = Number(values.month), day = Number(values.day);
  return { key: `${values.year}-${values.month}-${values.day}`, year, month, day };
}
export function groupNotesByLocalDay(notes: readonly Note[], dateOf: (note: Note) => string, now: string, locale = 'en-US', timeZone = 'UTC'): NoteDayGroup[] {
  const today = localDayParts(now, locale, timeZone);
  const groups = new Map<string, NoteDayGroup>();
  for (const note of notes) {
    const date = dateOf(note), parts = localDayParts(date, locale, timeZone);
    let group = groups.get(parts.key);
    if (!group) {
      const day = Math.round((Date.UTC(today.year, today.month - 1, today.day) - Date.UTC(parts.year, parts.month - 1, parts.day)) / 86_400_000);
      const label = day === 0 ? 'Today' : day === 1 ? 'Yesterday' : new Intl.DateTimeFormat(locale, {
        timeZone, weekday: 'long', month: 'short', day: 'numeric', ...(parts.year === today.year ? {} : { year: 'numeric' }),
      }).format(new Date(date));
      group = { key: parts.key, label, notes: [] }; groups.set(parts.key, group);
    }
    group.notes.push(note);
  }
  return [...groups.values()];
}
function searchTextOf(note: Note): string {
  const model = readModel(note.markdown);
  return model.searchText ??= `${titleOf(note.markdown)}\\n${note.markdown}`.toLocaleLowerCase('en-US');
}
export function selectedTags(library: Library): string[] {
  return library.activeTags !== undefined ? [...library.activeTags] : library.activeTag ? [library.activeTag] : [];
}
function inTagScope(note: Note, tags: string[]): boolean {
  const noteTags = tagsOf(note.markdown);
  return tags.every(tag => noteTags.includes(tag)) && (tags.includes('archive') || !noteTags.includes('archive'));
}
function scopedNotes(library: Library, tags = selectedTags(library)): Note[] {
  return library.notes.filter(note => !note.trashedAt && inTagScope(note, tags));
}
export function orderedNotes(library: Library): Note[] {
  // Stable sorting preserves insertion order for simultaneous notes; a new UUID
  // must not reshuffle existing pages when creation timestamps tie.
  return [...scopedNotes(library)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function noteNavigation(library: Library): { position: number | null; total: number; canMoveOlder: boolean; canMoveNewer: boolean } {
  const notes = orderedNotes(library);
  const index = notes.findIndex(note => note.id === library.selectedID);
  return {
    position: index < 0 ? null : notes.length - index,
    total: notes.length,
    canMoveOlder: notes.length > 0 && index < notes.length - 1,
    canMoveNewer: index > 0,
  };
}
export interface NoteQuery { query?: string; before?: string; sort?: 'edited' | 'created'; includeTrash?: boolean; tags?: string[] }
export function queryNotes(library: Library, options: NoteQuery = {}): Note[] {
  const tags = options.tags === undefined ? selectedTags(library) : normalizeTagList(options.tags);
  const needle = options.query?.trim().toLocaleLowerCase('en-US');
  const boundary = options.before === undefined ? undefined : utcDateBoundary(options.before);
  return library.notes.filter(note => {
    if (isBlankMarkdown(note.markdown)) return false;
    if (note.trashedAt ? !options.includeTrash : !inTagScope(note, tags)) return false;
    if (boundary && Date.parse(options.sort === 'created' ? note.createdAt : note.updatedAt) >= boundary) return false;
    return !needle || searchTextOf(note).includes(needle);
  }).sort((a, b) => {
    const field = options.sort === 'created' ? 'createdAt' : 'updatedAt';
    return b[field].localeCompare(a[field]) || b.id.localeCompare(a.id);
  });
}
/** A YYYY-MM-DD `before` value means the exclusive start-of-day boundary in UTC. */
function utcDateBoundary(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Before must be a valid YYYY-MM-DD UTC date');
  const boundary = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(boundary) || new Date(boundary).toISOString().slice(0, 10) !== date) throw new Error('Before must be a valid YYYY-MM-DD UTC date');
  return boundary;
}
function normalizeTagList(tags: string[]): string[] {
  if (!Array.isArray(tags)) throw new Error('Notebook tags must be a list');
  const normalized = tags.map(normalizeTag);
  if (normalized.some(tag => !validTag(tag))) throw new Error('That notebook tag is not valid. Use letters, numbers, dashes, underscores, or slashes.');
  return [...new Set(normalized)];
}
function notebookTagUsage(library: Library): { tag: string; count: number; lastUsed: string }[] {
  const usage = new Map<string, { count: number; lastUsed: string }>();
  for (const note of library.notes) {
    if (note.trashedAt || isBlankMarkdown(note.markdown)) continue;
    for (const tag of tagsOf(note.markdown)) {
      const current = usage.get(tag) ?? { count: 0, lastUsed: note.updatedAt };
      current.count++;
      if (note.updatedAt > current.lastUsed) current.lastUsed = note.updatedAt;
      usage.set(tag, current);
    }
  }
  return [...usage].map(([tag, value]) => ({ tag, ...value }));
}
export function notebookTags(library: Library): { tag: string; count: number }[] {
  return notebookTagUsage(library).sort((a, b) => a.tag.localeCompare(b.tag)).map(({ tag, count }) => ({ tag, count }));
}
export function recentNotebookTags(library: Library): { tag: string; count: number }[] {
  return notebookTagUsage(library).sort((a, b) => b.lastUsed.localeCompare(a.lastUsed) || a.tag.localeCompare(b.tag))
    .map(({ tag, count }) => ({ tag, count }));
}
function inScope(note: Note, tags: string[]): boolean {
  return !note.trashedAt && inTagScope(note, tags);
}
export function resolveScopeBookmark(library: Library, tags: string[], bookmarks: ScopeBookmarks): string | null {
  const activeTags = normalizeTagList(tags);
  const bookmarkedID = bookmarks[scopeKey(activeTags)];
  const bookmarked = bookmarkedID && library.notes.find(note => note.id === bookmarkedID);
  if (bookmarked && inScope(bookmarked, activeTags) && !isBlankMarkdown(bookmarked.markdown)) return bookmarked.id;
  return library.notes.filter(note => inScope(note, activeTags) && !isBlankMarkdown(note.markdown))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.id ?? null;
}
export function updateScopeBookmark(bookmarks: ScopeBookmarks, tags: string[], selectedID: string | null): ScopeBookmarks {
  const next = normalizeScopePreferences({ bookmarks }).bookmarks;
  const key = scopeKey(tags);
  if (selectedID) next[key] = selectedID;
  else delete next[key];
  return next;
}
export function pruneScopeBookmarks(bookmarks: ScopeBookmarks, library: Library): ScopeBookmarks {
  const notesByID = new Map(library.notes.map(note => [note.id, note]));
  return Object.fromEntries(Object.entries(bookmarks).filter(([key, id]) => {
    const tags = scopeTagsFromKey(key);
    const note = notesByID.get(id);
    return tags !== null && !!note && inScope(note, tags);
  }));
}
export function selectNotebooks(library: Library, tags: string[], bookmarks: ScopeBookmarks = {}): Library {
  const activeTags = normalizeTagList(tags);
  const next: Library = { ...library, activeTags, activeTag: activeTags[0] || null };
  const sameScope = scopeKey(selectedTags(library)) === scopeKey(activeTags);
  const current = next.selectedID && next.notes.find(note => note.id === next.selectedID);
  const selectedID = sameScope && current && inScope(current, activeTags)
    ? current.id : resolveScopeBookmark(next, activeTags, bookmarks);
  return { ...next, selectedID };
}
export function selectNotebook(library: Library, tag: string | null, bookmarks: ScopeBookmarks = {}): Library {
  return selectNotebooks(library, tag ? [tag] : [], bookmarks);
}
export function navigate(library: Library, delta: number): Library {
  const notes = orderedNotes(library);
  if (!notes.length) return { ...library, selectedID: null };
  const index = notes.findIndex(n => n.id === library.selectedID);
  const next = Math.min(notes.length - 1, Math.max(0, index + delta));
  return { ...library, selectedID: notes[next].id };
}
function isBlankNote(note: Note, inheritedTags: string[]): boolean {
  const parts = splitDocument(note.markdown);
  if (parts.error || parts.body.trim()) return false;
  const keys = Object.keys(parts.metadata);
  // Only the current notebook's generated tag scaffold is clean metadata.
  if (!inheritedTags.length) return !keys.length;
  const tags = parts.metadata.tags;
  return keys.length === 1 && keys[0] === 'tags' && Array.isArray(tags)
    && tags.length === inheritedTags.length && inheritedTags.every(tag => tags.includes(tag));
}
export function createNote(library: Library, id: string, now: string): Library {
  if (library.notes.some(note => note.id === id)) throw new Error('Duplicate note identity');
  const newest = orderedNotes(library)[0];
  if (newest && isBlankNote(newest, selectedTags(library))) return { ...library, selectedID: newest.id };
  if (library.notes.length >= MAX_LIBRARY_NOTES) throw new Error(`Banana Notes can store up to ${MAX_LIBRARY_NOTES.toLocaleString()} notes.`);
  const note: Note = { id, markdown: selectedTags(library).reduce((markdown, tag) => withTag(markdown, tag), ''), createdAt: now, updatedAt: now };
  return { ...library, notes: [note, ...library.notes], selectedID: id };
}
export function updateNote(library: Library, id: string, markdown: string, now: string): Library {
  if (library.notes.some(note => note.id === id && note.trashedAt)) throw new Error('A trashed note cannot be edited');
  if (markdownByteLength(markdown) > MAX_NOTE_MARKDOWN_BYTES) throw new Error('This note is larger than 2 MB and can\'t be saved. Move some content into another note.');
  return selectNotebooks({ ...library, notes: library.notes.map(note => note.id === id ? { ...note, markdown, updatedAt: now } : note) }, selectedTags(library));
}
function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && Number(hourText) <= 23 && Number(minuteText) <= 59 && Number(secondText) <= 59
    && (!offsetHourText || (Number(offsetHourText) <= 23 && Number(offsetMinuteText) <= 59));
}
export function trashNote(library: Library, id: string, now: string): Library {
  const note = library.notes.find(candidate => candidate.id === id);
  if (!note || note.trashedAt) return library;
  if (!isIsoDate(now)) throw new Error('Trash time must be a valid ISO date');
  const scoped = orderedNotes(library);
  const selectedIndex = scoped.findIndex(candidate => candidate.id === id);
  const notes = library.notes.map(candidate => candidate.id === id ? { ...candidate, trashedAt: now } : candidate);
  let selectedID = library.selectedID;
  if (selectedID === id) {
    const survivors = scoped.filter(candidate => candidate.id !== id);
    selectedID = survivors[Math.min(selectedIndex, survivors.length - 1)]?.id || null;
  }
  return { ...library, notes, selectedID };
}
export const TRASH_RETENTION_DAYS = 30;
export function trashExpiresAt(note: Note): string | null {
  if (!note.trashedAt) return null;
  const expiry = new Date(Date.parse(note.trashedAt));
  expiry.setUTCDate(expiry.getUTCDate() + TRASH_RETENTION_DAYS);
  return expiry.toISOString();
}
function expired(note: Note, now: string): boolean {
  if (!isIsoDate(now)) throw new Error('Time must be a valid ISO date');
  return !!note.trashedAt && Date.parse(now) - Date.parse(note.trashedAt) > TRASH_RETENTION_DAYS * 86_400_000;
}
export function restoreNote(library: Library, id: string, now?: string): Library {
  const target = library.notes.find(note => note.id === id && note.trashedAt);
  if (!target || (now !== undefined && expired(target, effectiveTrashPurgeTime(library, now)))) return library;
  const notes = library.notes.map(note => {
    if (note.id !== id) return note;
    const { trashedAt: _trashedAt, ...restored } = note;
    return restored;
  });
  return selectNotebooks({ ...library, notes }, selectedTags(library));
}
export function bulkTrashNotes(library: Library, ids: string[], now: string): Library {
  if (!isIsoDate(now)) throw new Error('Trash time must be a valid ISO date');
  const targets = new Set(ids);
  let next = library;
  for (const id of targets) next = trashNote(next, id, now);
  return next;
}
export function bulkTagNotes(library: Library, ids: string[], tag: string, now: string): Library {
  if (!isIsoDate(now)) throw new Error('Edit time must be a valid ISO date');
  const targets = new Set(ids);
  const normalized = normalizeTag(tag);
  if (!validTag(normalized)) throw new Error('Use a letter first, then letters, numbers, dashes, underscores, or slashes.');
  // Build every replacement first so malformed frontmatter cannot partially apply a bulk operation.
  const replacements = new Map<string, string>();
  for (const note of library.notes) if (targets.has(note.id) && !note.trashedAt) {
    const markdown = withTag(note.markdown, normalized);
    if (markdownByteLength(markdown) > MAX_NOTE_MARKDOWN_BYTES) throw new Error("This note is larger than 2 MB and can't be saved. Move some content into another note.");
    replacements.set(note.id, markdown);
  }
  return selectNotebooks({ ...library, notes: library.notes.map(note => replacements.has(note.id)
    ? { ...note, markdown: replacements.get(note.id)!, updatedAt: now } : note) }, selectedTags(library));
}
export function bulkArchiveNotes(library: Library, ids: string[], now: string): Library {
  return bulkTagNotes(library, ids, 'archive', now);
}
export function bulkRestoreNotes(library: Library, ids: string[], now: string): Library {
  if (!isIsoDate(now)) throw new Error('Restore time must be a valid ISO date');
  const targets = new Set(ids);
  let next = library;
  for (const note of library.notes) if (targets.has(note.id)) next = restoreNote(next, note.id, now);
  return next;
}
export function effectiveTrashPurgeTime(library: Library, wallClockNow: string): string {
  if (!isIsoDate(wallClockNow)) throw new Error('Purge time must be a valid ISO date');
  if (!library.notes.length) return wallClockNow;
  const latestActivity = library.notes.reduce((latest, note) => Math.max(latest,
    Date.parse(note.createdAt), Date.parse(note.updatedAt), note.trashedAt ? Date.parse(note.trashedAt) : Number.NEGATIVE_INFINITY), Number.NEGATIVE_INFINITY);
  return new Date(Math.min(Date.parse(wallClockNow), latestActivity + 86_400_000)).toISOString();
}
export function purgeExpiredTrash(library: Library, now: string): Library {
  const effectiveNow = effectiveTrashPurgeTime(library, now);
  const notes = library.notes.filter(note => !note.trashedAt || !expired(note, effectiveNow));
  return notes.length === library.notes.length ? library : selectNotebooks({ ...library, notes }, selectedTags(library));
}
export function trashedNotes(library: Library): Note[] {
  return library.notes.filter(note => !!note.trashedAt)
    .sort((a, b) => b.trashedAt!.localeCompare(a.trashedAt!) || b.id.localeCompare(a.id));
}
export function validateLibrary(value: unknown): Library {
  if (!value || typeof value !== 'object') throw new Error('Notebook data is not an object');
  const v = value as Partial<Library>;
  if (v.version !== 1 || !Array.isArray(v.notes) || v.notes.length > MAX_LIBRARY_NOTES) throw new Error('Unsupported notebook data');
  const ids = new Set<string>();
  for (const note of v.notes) {
    if (!note || typeof note.id !== 'string' || !note.id || ids.has(note.id) || typeof note.markdown !== 'string'
      || markdownByteLength(note.markdown) > MAX_NOTE_MARKDOWN_BYTES
      || typeof note.createdAt !== 'string' || !Number.isFinite(Date.parse(note.createdAt))
      || typeof note.updatedAt !== 'string' || !Number.isFinite(Date.parse(note.updatedAt))
      || ('trashedAt' in note && !isIsoDate(note.trashedAt))) throw new Error('A note is invalid; the original data was not replaced');
    ids.add(note.id);
  }
  if (v.selectedID !== null && typeof v.selectedID !== 'string') throw new Error('Invalid selected note');
  if (v.activeTag !== null && (typeof v.activeTag !== 'string' || !validTag(v.activeTag))) throw new Error('Invalid notebook tag');
  if ('activeTags' in v && (!Array.isArray(v.activeTags) || v.activeTags.some(tag => typeof tag !== 'string' || !validTag(tag)))) throw new Error('Invalid notebook tags');
  const repaired = selectNotebooks(v as Library, selectedTags(v as Library));
  if (!('activeTags' in v)) delete repaired.activeTags;
  return repaired;
}
export function welcomeLibrary(id: string, now: string, hotkeyDisplay = '⌃⇧Space'): Library {
  return { version: 1, activeTag: null, selectedID: id, notes: [{ id, createdAt: now, updatedAt: now,
    markdown: `# Welcome to Banana Notes\n\nPress **${hotkeyDisplay}** in any app to show or hide this window.\n\n1. Type a thought. It saves automatically.\n2. Press **Esc** to tuck the window away.\n3. Press **${hotkeyDisplay}** to bring it back, and **⌘P** to find any note.\n\nAdd a \`#tag\` to group related notes. Press **⌘N** for a new note.\n\nOpen **?** at the bottom right for all shortcuts.` }] };
}
