import { splitDocument, tagsOf, titleOf, updateNote, type Library, type Note } from './domain';
import { isManagedMediaURL } from './attachments';
import { Marked } from 'marked';

export interface ProjectTaskRef { noteID: string; markerOffset: number; sourceGuard: string }
export interface ProjectTask extends ProjectTaskRef { label: string; checked: boolean; noteTitle: string; tags: string[] }
export interface ProjectMedia { noteID: string; noteTitle: string; tags: string[]; url: string; kind: 'image' | 'audio' | 'video'; label: string }
export interface ProjectLink { noteID: string; noteTitle: string; tags: string[]; url: string; label: string; safe: boolean }
export interface ProjectContent { tasks: ProjectTask[]; media: ProjectMedia[]; links: ProjectLink[]; counts: { notes: number; tasks: number; openTasks: number; completedTasks: number; media: number; links: number } }

const guard = (source: string): string => `${source.length}:${hash(source)}`;
function hash(value: string): string { let h = 2166136261; for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619); return (h >>> 0).toString(16); }
function bodyStart(note: Note): number { const parts = splitDocument(note.markdown); return parts.frontmatter ? parts.frontmatter.length : 0; }
function visibleMarkdown(note: Note): { text: string; offset: number } {
  const start = bodyStart(note), source = note.markdown.slice(start), chars = source.split('');
  let fence: { char: string; length: number } | undefined, offset = 0;
  for (const line of source.split(/(?<=\n)/)) {
    const bare = line.replace(/\r?\n$/, ''), fm = bare.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fm && (!fence || (fm[1][0] === fence.char && fm[1].length >= fence.length))) {
      if (fence) fence = undefined; else fence = { char: fm[1][0], length: fm[1].length };
      for (let i = 0; i < line.length; i++) chars[offset + i] = '\n';
    } else if (fence || (/^ {4,}(?:\S|$)/.test(bare) && !/^ {4,}(?:[-+*]|\d+[.)])\s+\[[ xX]\]/.test(bare))) {
      for (let i = 0; i < line.length; i++) chars[offset + i] = '\n';
    }
    offset += line.length;
  }
  let masked = chars.join('');
  // Mask inline code spans so example Markdown and URLs are not projected.
  masked = masked.replace(/(`+)([\s\S]*?)\1/g, match => match.replace(/[^\r\n]/g, ' '));
  return { text: masked, offset: start };
}
function noteBits(note: Note) { return { noteID: note.id, noteTitle: titleOf(note.markdown), tags: tagsOf(note.markdown) }; }
function safeURL(raw: string): boolean { try { const u = new URL(raw); return ['http:', 'https:', 'mailto:'].includes(u.protocol); } catch { return false; } }
function mediaKind(url: string): ProjectMedia['kind'] | undefined {
  if (!isManagedMediaURL(url)) return undefined;
  const ext = url.split('.').pop()!.toLowerCase();
  if (/^(png|jpe?g|gif|webp|avif|heic)$/.test(ext)) return 'image';
  if (/^(mp3|m4a|wav|aac|ogg|flac|opus)$/.test(ext)) return 'audio';
  if (/^(mp4|mov|m4v|webm|ogv)$/.test(ext)) return 'video';
  return undefined;
}
function cleanLabel(value: string): string { return value.replace(/\\([\\`*_{}\[\]()#+.!<>|-])/g, '$1').replace(/[*_~`]/g, '').trim() || 'Untitled'; }

const markdown = new Marked({ gfm: true });

export function projectContent(notes: Note[]): ProjectContent {
  const tasks: ProjectTask[] = [], media: ProjectMedia[] = [], links: ProjectLink[] = [];
  for (const note of notes) {
    const { text, offset } = visibleMarkdown(note), bits = noteBits(note), sourceGuard = guard(note.markdown);
    // Marked's block grammar identifies real task list items, excluding escaped
    // examples, HTML blocks and code. Preserve offsets by locating each raw item.
    const normalized = text.replace(/\r\n?/g, '\n');
    const sourceOffset = (index: number) => index + (text.slice(0, index).match(/\r\n?/g)?.length ?? 0);
    const collectLists = (tokens: ReturnType<typeof markdown.lexer>): void => {
      for (const token of tokens) {
        if (token.type !== 'list') continue;
        const list = token as typeof token & { raw: string; items: { raw: string; task?: boolean; text: string; tokens: ReturnType<typeof markdown.lexer> }[] };
        let itemFrom = normalized.indexOf(list.raw);
        if (itemFrom < 0) continue;
        for (const item of list.items) {
          const itemOffset = normalized.indexOf(item.raw, itemFrom);
          if (item.task && itemOffset >= 0) {
            const marker = item.raw.match(/^ {0,7}(?:[-+*]|\d+[.)])\s+\[([ xX])\]/m);
            if (marker) {
              const localOffset = item.raw.indexOf(marker[0]) + marker[0].lastIndexOf('[') + 1;
              const markerOffset = offset + sourceOffset(itemOffset + localOffset);
              const label = item.text.replace(/^\[[ xX]\]\s*/, '').replace(/\s+$/, '');
              tasks.push({ ...bits, markerOffset, sourceGuard, checked: marker[1].toLowerCase() === 'x', label: cleanLabel(label) });
            }
          }
          if (itemOffset >= 0) itemFrom = itemOffset + item.raw.length;
          collectLists(item.tokens);
        }
      }
    };
    collectLists(markdown.lexer(normalized));
    // Marked nests continuation lists inside parent items; preserve their original
    // source spans even when the parent-item token does not expose nested tokens.
    for (const match of normalized.matchAll(/^ {4,7}(?:[-+*]|\d+[.)])\s+\[([ xX])\]\s+(.+?)\s*$/gm)) {
      const start = match.index!, previous = normalized.slice(0, start).trimEnd().split('\n').pop() ?? '';
      if (!/^(?:[-+*]|\d+[.)])\s+\S/.test(previous)) continue;
      const markerOffset = offset + sourceOffset(start + match[0].indexOf('[') + 1);
      if (tasks.some(task => task.markerOffset === markerOffset)) continue;
      tasks.push({ ...bits, markerOffset, sourceGuard, checked: match[1].toLowerCase() === 'x', label: cleanLabel(match[2]) });
    }
    const uniqueLinks = new Set<string>(), uniqueMedia = new Set<string>();
    const addURL = (url: string, label: string) => {
      const kind = mediaKind(url);
      if (kind) {
        if (!uniqueMedia.has(url)) { uniqueMedia.add(url); media.push({ ...bits, url, kind, label: cleanLabel(label || url) }); }
        return;
      }
      if (url.startsWith('foldnote-asset:')) return;
      if (uniqueLinks.has(url)) return;
      uniqueLinks.add(url); links.push({ ...bits, url, label: cleanLabel(label || url), safe: safeURL(url) });
    };
    // Resolve common Markdown reference definitions before scanning visible links.
    const references = new Map<string, string>();
    for (const definition of text.matchAll(/^ {0,3}\[([^\]]+)\]:\s*<?([^\s>]+)>?/gm)) references.set(definition[1].trim().toLowerCase(), definition[2]);
    for (const m of text.matchAll(/(!?)\[([^\]\n]+)\](?:\[([^\]]*)\])?(?!\()/g)) {
      const lineStart = text.lastIndexOf('\n', m.index!) + 1;
      if (/^ {0,3}\[[^\]]+\]:/.test(text.slice(lineStart))) continue;
      const key = (m[3] || m[2]).trim().toLowerCase(), url = references.get(key);
      if (url && !m[1]) addURL(url, m[2]);
    }
    for (const m of text.matchAll(/(!?)\[([^\]\n]*)\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+[^)]*)?\s*\)/g)) {
      const url = m[3].replace(/^<|>$/g, '');
      if (!m[1] || mediaKind(url)) addURL(url, m[2]);
    }
    for (const m of text.matchAll(/<((?:https?:\/\/|mailto:)[^\s<>]+)>/gi)) addURL(m[1], m[1]);
    for (const m of text.matchAll(/(?<![\\w"'=>(])((?:https?:\/\/|mailto:)[^\s<>`]+)/gi)) {
      const url = m[1].replace(/[.,!?;:]+$/, '');
      if (!text.slice(Math.max(0, m.index! - 2), m.index).endsWith('<')) addURL(url, url);
    }
    // Safe, explicit media elements; never execute arbitrary HTML or load arbitrary external sources.
    for (const m of text.matchAll(/<(audio|video)\b([^>]*)>([\s\S]*?)<\/\1\s*>|<(audio|video)\b([^>]*)\/?>/gi)) {
      const kindName = (m[1] || m[4]).toLowerCase(), markup = `${m[2] || m[5]} ${m[3] || ''}`;
      const urls = [...markup.matchAll(/\bsrc\s*=\s*(["'])(foldnote-asset:\/\/media\/[0-9a-f-]+\.[a-z0-9]+)\1/gi)].map(source => source[2]);
      for (const url of new Set(urls)) { const kind = mediaKind(url); if (kind && kind === kindName) if (!uniqueMedia.has(url)) { uniqueMedia.add(url); media.push({ ...bits, url, kind, label: bits.noteTitle }); } }
    }
    for (const m of text.matchAll(/\[(.*?)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/gi)) if (!m[0].startsWith('!')) addURL(m[2], m[1]);
  }
  return { tasks, media, links, counts: { notes: notes.length, tasks: tasks.length, openTasks: tasks.filter(t => !t.checked).length, completedTasks: tasks.filter(t => t.checked).length, media: media.length, links: links.length } };
}

export type ToggleTaskResult = { ok: true; library: Library } | { ok: false; error: 'missing-note' | 'trashed-note' | 'stale-source' | 'stale-marker' };
export function toggleProjectedTask(library: Library, ref: ProjectTaskRef, checked: boolean, now: string): ToggleTaskResult {
  const note = library.notes.find(candidate => candidate.id === ref.noteID);
  if (!note) return { ok: false, error: 'missing-note' };
  if (note.trashedAt) return { ok: false, error: 'trashed-note' };
  if (guard(note.markdown) !== ref.sourceGuard) return { ok: false, error: 'stale-source' };
  const marker = note.markdown[ref.markerOffset];
  if (marker !== ' ' && marker !== 'x' && marker !== 'X') return { ok: false, error: 'stale-marker' };
  const markdown = note.markdown.slice(0, ref.markerOffset) + (checked ? 'x' : ' ') + note.markdown.slice(ref.markerOffset + 1);
  return { ok: true, library: updateNote(library, note.id, markdown, now) };
}
