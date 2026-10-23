export interface SemanticNoteSnapshot { id: string; markdown: string; updatedAt: string; trashedAt?: string }
export interface SemanticHit { id: string; score: number; snippet: string }
export interface SemanticModel { name: string; disclosure: string }
export type SemanticProviderId = 'apple' | 'ollama';
export type SemanticActionableState = 'disabled' | 'modelMissing' | 'ready' | 'indexMalformed' | 'indexNotReady';
export interface SemanticProvider { id: SemanticProviderId; name: string; disclosure: string; available: boolean }
export interface SemanticStatus {
  enabled: boolean; model: string; models: SemanticModel[]; installed: boolean; runtimeAvailable: boolean;
  indexedNotes: number; progress: string; indexError?: string | null; actionableState: SemanticActionableState;
  provider: SemanticProviderId; providers: SemanticProvider[]; unavailableReason: string | null;
}
export interface SemanticConfiguration { enabled: boolean; provider: SemanticProviderId; model?: string }
export interface SemanticIndexResult { indexedNotes?: number; [key: string]: unknown }

export function parseSemanticStatus(value: unknown): SemanticStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Native semantic status is malformed.');
  const status = value as Record<string, unknown>;
  const providers = status.providers;
  const models = status.models;
  if (typeof status.enabled !== 'boolean' || typeof status.model !== 'string' || typeof status.installed !== 'boolean'
    || typeof status.runtimeAvailable !== 'boolean' || typeof status.indexedNotes !== 'number' || !Number.isFinite(status.indexedNotes)
    || status.indexedNotes < 0 || typeof status.progress !== 'string'
    || !(['disabled', 'modelMissing', 'ready', 'indexMalformed', 'indexNotReady'] as const).includes(status.actionableState as SemanticActionableState)
    || (status.provider !== 'apple' && status.provider !== 'ollama') || !Array.isArray(providers) || !Array.isArray(models)
    || !(status.unavailableReason === null || typeof status.unavailableReason === 'string')
    || (status.indexError !== undefined && status.indexError !== null && typeof status.indexError !== 'string')) {
    throw new Error('Native semantic status is malformed.');
  }
  const validProviders = providers.every((provider: unknown) => {
    if (!provider || typeof provider !== 'object' || Array.isArray(provider)) return false;
    const item = provider as Record<string, unknown>;
    return (item.id === 'apple' || item.id === 'ollama') && typeof item.name === 'string'
      && typeof item.disclosure === 'string' && typeof item.available === 'boolean';
  });
  const validModels = models.every((model: unknown) => !!model && typeof model === 'object' && !Array.isArray(model)
    && typeof (model as Record<string, unknown>).name === 'string' && typeof (model as Record<string, unknown>).disclosure === 'string');
  if (!validProviders || !validModels || !providers.some((provider: SemanticProvider) => provider.id === status.provider)) {
    throw new Error('Native semantic status is malformed.');
  }
  return status as unknown as SemanticStatus;
}

export function parseSemanticHits(value: unknown): SemanticHit[] {
  if (!Array.isArray(value)) throw new Error('Native semantic search returned an invalid result.');
  return value.map((candidate): SemanticHit => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('Native semantic search returned an invalid hit.');
    const hit = candidate as Record<string, unknown>;
    if (typeof hit.id !== 'string' || typeof hit.score !== 'number' || !Number.isFinite(hit.score) || typeof hit.snippet !== 'string') {
      throw new Error('Native semantic search returned an invalid hit.');
    }
    return { id: hit.id, score: hit.score, snippet: hit.snippet };
  });
}
