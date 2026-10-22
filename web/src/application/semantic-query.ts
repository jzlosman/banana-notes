import type { SemanticHit } from './semantic-contract';

export interface SemanticQueryPort { search(query: string, candidateIDs: readonly string[]): Promise<readonly SemanticHit[]> }

/** Semantic query use case; provider effects and wire parsing remain behind the capability. */
export async function semanticSearch(port: SemanticQueryPort, query: string, candidateIDs: readonly string[]): Promise<SemanticHit[]> {
  if (!query.trim() || !candidateIDs.length) return [];
  const allowed = new Set(candidateIDs);
  return [...await port.search(query, candidateIDs)].filter(hit => allowed.has(hit.id));
}
