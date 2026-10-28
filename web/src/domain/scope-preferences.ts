import { normalizeTag, validTag } from './tags';

export type ScopeBookmarks = Record<string, string>;
export interface ScopePreferences { pinnedTags: string[]; bookmarks: ScopeBookmarks }
export const EMPTY_SCOPE_PREFERENCES: ScopePreferences = { pinnedTags: [], bookmarks: {} };

function tagOrThrow(value: string): string {
  const tag = normalizeTag(value);
  if (!validTag(tag)) throw new Error('Use a letter first, then letters, numbers, dashes, underscores, or slashes.');
  return tag;
}

/** Normalizes an untrusted saved pin list without changing its stable order. */
export function normalizePinnedTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== 'string') continue;
    const tag = normalizeTag(candidate);
    if (!validTag(tag) || seen.has(tag)) continue;
    tags.push(tag); seen.add(tag);
  }
  return tags;
}

export function pinTag(pinnedTags: readonly string[], value: string): string[] {
  const tag = tagOrThrow(value);
  const current = normalizePinnedTags(pinnedTags);
  return current.includes(tag) ? current : [...current, tag];
}

export function unpinTag(pinnedTags: readonly string[], value: string): string[] {
  const tag = tagOrThrow(value);
  return normalizePinnedTags(pinnedTags).filter(candidate => candidate !== tag);
}

/** Moves a tag by the requested number of positions, clamped to the list edges. */
export function movePinnedTag(pinnedTags: readonly string[], value: string, delta: number): string[] {
  if (!Number.isInteger(delta)) throw new Error('Pin movement must use a whole number of positions.');
  const current = normalizePinnedTags(pinnedTags);
  const index = current.indexOf(tagOrThrow(value));
  if (index < 0 || delta === 0) return current;
  const target = Math.max(0, Math.min(current.length - 1, index + delta));
  if (target === index) return current;
  const [tag] = current.splice(index, 1);
  current.splice(target, 0, tag);
  return current;
}

/** Scope identity is independent of the order in which multiple filters were selected. */
export function scopeKey(values: readonly string[]): string {
  const tags = values.map(tagOrThrow);
  const unique = [...new Set(tags)].sort();
  return unique.length ? `tags:${JSON.stringify(unique)}` : 'all';
}

/** Decodes only canonical bookmark keys; malformed preference entries are ignored. */
export function scopeTagsFromKey(key: string): string[] | null {
  if (key === 'all') return [];
  if (!key.startsWith('tags:')) return null;
  try {
    const raw: unknown = JSON.parse(key.slice(5));
    if (!Array.isArray(raw) || raw.length === 0 || raw.some(tag => typeof tag !== 'string')) return null;
    const tags = [...new Set(raw.map(tagOrThrow))].sort();
    return `tags:${JSON.stringify(tags)}` === key ? tags : null;
  } catch { return null; }
}

/** Validates preference data at the adapter boundary, preserving only supported values. */
export function normalizeScopePreferences(value: unknown): ScopePreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { pinnedTags: [], bookmarks: {} };
  const source = value as { pinnedTags?: unknown; bookmarks?: unknown };
  const bookmarks: ScopeBookmarks = {};
  if (source.bookmarks && typeof source.bookmarks === 'object' && !Array.isArray(source.bookmarks)) {
    for (const [key, noteID] of Object.entries(source.bookmarks)) {
      if (scopeTagsFromKey(key) !== null && typeof noteID === 'string' && noteID.length > 0) bookmarks[key] = noteID;
    }
  }
  return { pinnedTags: normalizePinnedTags(source.pinnedTags), bookmarks };
}
