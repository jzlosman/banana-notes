export type NoteSearchResult =
  | { kind: 'text'; reason?: string }
  | { kind: 'semantic'; ids: string[] }
  | { kind: 'cancelled' };

export interface SearchReadiness {
  enabled: boolean;
  runtimeAvailable: boolean;
  installed: boolean;
  unavailableReason?: string | null;
}

/** Application query port: platform adapters own settings, indexing and embedding effects. */
export interface NoteSearchPort {
  status(): Promise<SearchReadiness>;
  prepareIndex(): Promise<unknown>;
  semanticSearch(query: string, candidateIDs: readonly string[]): Promise<readonly string[]>;
}

/** One search policy: exact matches always work; semantic enrichment never performs setup. */
export async function searchNotes(query: string, candidateIDs: readonly string[], port: NoteSearchPort,
  isCurrent: () => boolean = () => true): Promise<NoteSearchResult> {
  if (!isCurrent()) return { kind: 'cancelled' };
  if (!query.trim() || !candidateIDs.length) return { kind: 'text' };
  try {
    const status = await port.status();
    if (!isCurrent()) return { kind: 'cancelled' };
    if (!status.enabled) return { kind: 'text' };
    if (!status.runtimeAvailable || !status.installed) {
      return { kind: 'text', reason: status.unavailableReason ? `Showing text matches. ${status.unavailableReason}` : 'Semantic search is not ready. Showing text matches; check Settings → Search.' };
    }
    await port.prepareIndex();
    if (!isCurrent()) return { kind: 'cancelled' };
    const ids = await port.semanticSearch(query, candidateIDs);
    if (!isCurrent()) return { kind: 'cancelled' };
    const allowed = new Set(candidateIDs);
    return { kind: 'semantic', ids: [...new Set(ids)].filter(id => allowed.has(id)).slice(0, 50) };
  } catch {
    if (!isCurrent()) return { kind: 'cancelled' };
    return { kind: 'text', reason: 'Semantic search is unavailable. Showing text matches; check Settings → Search.' };
  }
}

/** Exact matches retain their requested sort; meaning-based matches follow in ranked order. */
export function mergeSearchMatches(textIDs: readonly string[], semanticIDs: readonly string[]): string[] {
  return [...new Set([...textIDs, ...semanticIDs])];
}
