export interface SemanticNoteSnapshot { id: string; markdown: string; updatedAt: string; trashedAt?: string }
export interface SemanticHit { id: string; score: number; snippet: string }
export interface SemanticModel { name: string; disclosure: string }
export type SemanticProviderId = 'apple' | 'ollama';
export interface SemanticProvider { id: SemanticProviderId; name: string; disclosure: string; available: boolean }
export interface SemanticStatus {
  enabled: boolean; model: string; models: SemanticModel[]; installed: boolean; runtimeAvailable: boolean;
  indexedNotes: number; progress: string; indexError?: string | null; actionableState: 'disabled' | 'modelMissing' | 'ready' | 'indexMalformed' | string;
  provider: SemanticProviderId; providers: SemanticProvider[]; unavailableReason: string | null;
}
export type SemanticInvoke = (action: string, payload?: Record<string, unknown>) => Promise<Record<string, unknown>>;
export type SemanticSearchHit = SemanticHit;

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : 'Semantic search request failed.';
function isStatus(value: Record<string, unknown>): value is Record<string, unknown> & SemanticStatus {
  if (typeof value.enabled !== 'boolean' || typeof value.model !== 'string' || typeof value.installed !== 'boolean' || typeof value.runtimeAvailable !== 'boolean' || typeof value.indexedNotes !== 'number' || !Number.isFinite(value.indexedNotes) || typeof value.progress !== 'string' || typeof value.actionableState !== 'string') return false;
  if ((value.provider !== 'apple' && value.provider !== 'ollama') || !Array.isArray(value.providers) || !Array.isArray(value.models) || !(value.unavailableReason === null || typeof value.unavailableReason === 'string')) return false;
  if (value.indexError !== undefined && value.indexError !== null && typeof value.indexError !== 'string') return false;
  return value.providers.every((provider: unknown) => {
    if (!provider || typeof provider !== 'object') return false;
    const item = provider as Record<string, unknown>;
    return (item.id === 'apple' || item.id === 'ollama') && typeof item.name === 'string' && typeof item.disclosure === 'string' && typeof item.available === 'boolean';
  }) && value.models.every((model: unknown) => {
    if (!model || typeof model !== 'object') return false;
    const item = model as Record<string, unknown>;
    return typeof item.name === 'string' && typeof item.disclosure === 'string';
  }) && value.providers.some((provider: SemanticProvider) => provider.id === value.provider);
}

/** Semantic query adapter. The native process owns on-device embeddings and loopback-only Ollama I/O. */
export async function semanticSearch(invoke: SemanticInvoke, query: string, candidateIDs: readonly string[]): Promise<SemanticHit[]> {
  const result = await invoke('semanticSearch', { query, candidateIDs: [...candidateIDs] });
  if (!Array.isArray(result.hits)) throw new Error('Native semantic search returned an invalid result.');
  return result.hits.map((value): SemanticHit => {
    if (!value || typeof value !== 'object') throw new Error('Native semantic search returned an invalid hit.');
    const hit = value as Record<string, unknown>;
    if (typeof hit.id !== 'string' || typeof hit.score !== 'number' || !Number.isFinite(hit.score) || typeof hit.snippet !== 'string') throw new Error('Native semantic search returned an invalid hit.');
    return { id: hit.id, score: hit.score, snippet: hit.snippet };
  });
}

/** Creates a self-contained settings panel; native service owns all runtime, network, and disk effects. */
export function renderSemanticSettings(options: {
  invoke: SemanticInvoke;
  getNotes: () => readonly SemanticNoteSnapshot[];
  onChanged?: (status: SemanticStatus) => void;
  automaticIndex?: () => { running: boolean; error: string };
  registerRefresh?: (refresh: () => Promise<void>) => void;
}): HTMLElement {
  const root = document.createElement('section');
  root.className = 'semantic-settings';
  root.setAttribute('aria-label', 'Local semantic search settings');
  root.innerHTML = `<h2 class="semantic-heading">Semantic search</h2>
    <fieldset class="semantic-providers" data-role="providers"><legend>Search mode</legend>
      <label><input type="radio" name="semantic-provider" value="apple" data-role="apple"> On-device (macOS)</label>
      <label><input type="radio" name="semantic-provider" value="ollama" data-role="ollama"> Ollama</label>
      <label><input type="radio" name="semantic-provider" value="disabled" data-role="disabled"> Disabled</label>
    </fieldset>
    <p class="semantic-description" data-role="provider-description"></p>
    <p class="semantic-status" data-role="availability" role="status" aria-live="polite"></p>
    <div class="semantic-flow" data-role="flow" hidden>
      <p class="semantic-step" data-role="runtime-step"></p><div data-role="runtime-body" hidden>
        <p class="semantic-step-copy" data-role="runtime-copy"></p>
        <a class="semantic-get-ollama" href="https://ollama.com/download" target="_blank" rel="noopener noreferrer">Get Ollama</a>
        <button class="semantic-primary" type="button" data-action="start">Start Ollama</button>
        <button class="semantic-text-action" type="button" data-action="refresh">Check again</button>
      </div>
      <p class="semantic-step" data-role="model-step"></p><div data-role="model-body" hidden>
        <label class="semantic-model-label">Choose a model <select data-role="model"></select></label>
        <p class="semantic-disclosure" data-role="disclosure"></p>
        <button class="semantic-primary" type="button" data-action="download">Download model</button>
      </div>
      <p class="semantic-step" data-role="index-step"></p><div data-role="index-body" hidden>
        <p class="semantic-status" data-role="index-status" role="status" aria-live="polite"></p>
        <button class="semantic-primary" type="button" data-action="index">Retry indexing</button>
        <button class="semantic-primary" type="button" data-action="repair" hidden>Clear damaged index</button>
      </div>
      <div class="semantic-busy" data-role="busy" role="status" aria-live="polite" hidden></div>
      <details class="semantic-manage" data-role="manage" hidden>
        <summary>Manage index</summary>
        <label class="semantic-model-label">Embedding model <select data-role="ready-model"></select></label>
        <p class="semantic-disclosure" data-role="ready-disclosure"></p>
        <button type="button" data-action="rebuild">Rebuild index</button>
        <button class="semantic-text-action" type="button" data-action="clear">Clear index</button>
      </details>
      <button class="semantic-cancel" type="button" data-action="cancel" hidden>Cancel</button>
    </div>
    <p class="semantic-status" data-role="status" role="status" aria-live="polite">Checking local status…</p>
    <p class="semantic-error" data-role="error" role="alert" hidden></p>`;
  const radio = (provider: SemanticProviderId | 'disabled') => root.querySelector<HTMLInputElement>(`[data-role="${provider}"]`)!;
  const flow = root.querySelector<HTMLElement>('[data-role="flow"]')!;
  const modelSelect = root.querySelector<HTMLSelectElement>('[data-role="model"]')!;
  const readyModel = root.querySelector<HTMLSelectElement>('[data-role="ready-model"]')!;
  const statusText = root.querySelector<HTMLElement>('[data-role="status"]')!;
  const availability = root.querySelector<HTMLElement>('[data-role="availability"]')!;
  const errorText = root.querySelector<HTMLElement>('[data-role="error"]')!;
  const indexStatus = root.querySelector<HTMLElement>('[data-role="index-status"]')!;
  const button = (action: string) => root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
  let current: SemanticStatus | undefined;
  let busy = false;
  let requestSequence = 0;
  let refreshPending = false;
  const fillModels = (select: HTMLSelectElement, models: SemanticModel[], selected: string) => {
    const labels = models.map(model => model.name === 'all-minilm:22m' ? 'MiniLM · 46 MB' : model.name === 'embeddinggemma:latest' ? 'Gemma · 622 MB' : model.name);
    if (select.options.length !== models.length || models.some((model, i) => select.options[i].value !== model.name || select.options[i].textContent !== labels[i])) {
      select.replaceChildren(...models.map((model, i) => { const option = document.createElement('option'); option.value = model.name; option.textContent = labels[i]; return option; }));
    }
    select.value = selected;
  };
  const update = (status: SemanticStatus) => {
    current = status;
    statusText.hidden = true;
    radio(status.provider).checked = status.enabled;
    radio('disabled').checked = !status.enabled;
    fillModels(modelSelect, status.models, status.model);
    fillModels(readyModel, status.models, status.model);
    const appleProvider = status.providers.find(({ id }) => id === 'apple');
    const ollamaProvider = status.providers.find(({ id }) => id === 'ollama');
    radio('apple').disabled = !appleProvider?.available;
    radio('ollama').disabled = !ollamaProvider?.available;
    root.querySelector<HTMLElement>('[data-role="provider-description"]')!.textContent = !status.enabled ? 'Semantic search is off. Text search remains available.' : status.provider === 'apple' ? 'Local English sentence embeddings provided by macOS; no separate Ollama or runtime setup.' : 'Run embeddings locally with the separate Ollama app.';
    button('start').hidden = status.provider !== 'ollama';
    button('download').hidden = status.provider !== 'ollama';
    root.querySelector<HTMLAnchorElement>('.semantic-get-ollama')!.hidden = status.provider !== 'ollama';
    availability.textContent = status.provider === 'apple' && !appleProvider?.available ? (status.unavailableReason || appleProvider?.disclosure || 'On-device embeddings are unavailable.') : '';
    availability.hidden = !status.enabled || !availability.textContent;
    const selected = status.models.find(({ name }) => name === status.model);
    const disclosure = selected?.disclosure ?? 'Model size unavailable';
    root.querySelector('[data-role="disclosure"]')!.textContent = disclosure;
    root.querySelector('[data-role="ready-disclosure"]')!.textContent = disclosure;
    const ollama = status.provider === 'ollama';
    flow.dataset.provider = status.provider;
    readyModel.closest<HTMLElement>('label')!.hidden = !ollama;
    root.querySelector<HTMLElement>('[data-role="ready-disclosure"]')!.hidden = !ollama;
    flow.hidden = !status.enabled || (!ollama && !appleProvider?.available);
    const steps = ['runtime-step', 'model-step', 'index-step'].map(role => root.querySelector<HTMLElement>(`[data-role="${role}"]`)!);
    const bodies = ['runtime-body', 'model-body', 'index-body'].map(role => root.querySelector<HTMLElement>(`[data-role="${role}"]`)!);
    let active = 0;
    if (status.runtimeAvailable) active = 1;
    if (status.runtimeAvailable && status.installed) active = 2;
    const titles = ['1  Ollama', '2  Model', '3  Index'];
    steps.forEach((step, i) => { step.textContent = titles[i]; step.hidden = !ollama; step.classList.toggle('is-current', i === active); step.classList.toggle('is-future', i > active); bodies[i].hidden = !status.enabled || (ollama ? i !== active : i !== 2); });
    root.querySelector('[data-role="runtime-copy"]')!.textContent = status.runtimeAvailable ? 'Ollama is running. It must be started again after reboot, or enable Ollama’s own login setting.' : 'Install Ollama separately, then start it explicitly. It must be started again after reboot, or enable Ollama’s own login setting. Model downloads are approximately 46 MB or 622 MB.';
    const indexed = status.indexedNotes;
    const automatic = options.automaticIndex?.() ?? { running: false, error: '' };
    const malformed = status.actionableState === 'indexMalformed';
    if (active === 2) indexStatus.textContent = malformed ? 'Clear the damaged index, then rebuild it. Notes will not be deleted.' : automatic.running ? (status.progress || 'Updating index…') : `${indexed} ${indexed === 1 ? 'note' : 'notes'} indexed. Updates automatically.`;
    button('index').hidden = active !== 2 || !automatic.error || malformed;
    button('repair').hidden = active !== 2 || !malformed;
    button('rebuild').disabled = busy || automatic.running;
    button('cancel').hidden = !busy && !automatic.running;
    root.querySelector<HTMLElement>('[data-role="manage"]')!.hidden = active !== 2 || malformed;
    errorText.hidden = !(malformed && status.indexError) && !automatic.error;
    if (malformed && status.indexError) errorText.textContent = status.indexError;
    else if (automatic.error) errorText.textContent = automatic.error;
    options.onChanged?.(status);
  };
  const refresh = async () => {
    if (busy) { refreshPending = true; return; }
    const sequence = ++requestSequence;
    try { const result = await options.invoke('semanticStatus'); if (sequence !== requestSequence) return; if (!isStatus(result)) throw new Error('Native semantic status is malformed.'); update(result); }
    catch (error) { if (sequence === requestSequence) { statusText.hidden = false; statusText.textContent = `${errorMessage(error)} Try reopening Search settings.`; } }
  };
  const run = async (action: string, payload: Record<string, unknown> = {}, configChange = false) => {
    if (busy && !configChange && action !== 'semanticCancel') return;
    if (configChange) { requestSequence++; busy = false; }
    else busy = action !== 'semanticCancel';
    const sequence = ++requestSequence;
    const allButtons = [...root.querySelectorAll<HTMLButtonElement>('button')];
    allButtons.forEach(item => { item.disabled = busy && item.dataset.action !== 'cancel'; });
    modelSelect.disabled = busy; readyModel.disabled = busy;
    // Provider choices intentionally remain usable during long-running index operations.
    for (const id of ['apple', 'ollama', 'disabled'] as const) radio(id).disabled = !current?.providers.find(provider => provider.id === id)?.available && id !== 'disabled';
    const busyLabel = root.querySelector<HTMLElement>('[data-role="busy"]')!;
    busyLabel.hidden = !busy;
    busyLabel.textContent = action === 'semanticStartRuntime' ? 'Starting Ollama…' : action === 'semanticDownload' ? 'Downloading model…' : action === 'semanticIndex' ? 'Building local index…' : action === 'semanticClear' ? 'Clearing local index…' : '';
    button('cancel').hidden = !busy;
    errorText.hidden = true;
    try {
      const result = await options.invoke(action, payload);
      if (sequence !== requestSequence) return;
      if (isStatus(result)) update(result);
      else {
        const refreshed = await options.invoke('semanticStatus');
        if (sequence !== requestSequence) return;
        if (!isStatus(refreshed)) throw new Error('Native semantic status is malformed.');
        update(refreshed);
      }
    } catch (error) { if (sequence === requestSequence) { if (current) { radio(current.enabled ? current.provider : 'disabled').checked = true; modelSelect.value = current.model; readyModel.value = current.model; } errorText.textContent = errorMessage(error); errorText.hidden = false; } }
    finally { if (sequence === requestSequence) { busy = false; busyLabel.hidden = true; button('cancel').hidden = !options.automaticIndex?.().running; allButtons.forEach(item => { item.disabled = false; }); button('rebuild').disabled = options.automaticIndex?.().running ?? false; modelSelect.disabled = false; readyModel.disabled = false; if (refreshPending) { refreshPending = false; void refresh(); } } }
  };
  for (const id of ['apple', 'ollama', 'disabled'] as const) radio(id).addEventListener('change', () => {
    if (!radio(id).checked || !current) return;
    const provider: SemanticProviderId = id === 'disabled' ? current.provider : id;
    void run('semanticEnable', { enabled: id !== 'disabled', provider }, true);
  });
  modelSelect.addEventListener('change', () => { if (current) void run('semanticEnable', { enabled: true, provider: 'ollama', model: modelSelect.value }, true); });
  readyModel.addEventListener('change', () => { if (current) void run('semanticEnable', { enabled: true, provider: 'ollama', model: readyModel.value }, true); });
  button('start').addEventListener('click', () => { void run('semanticStartRuntime'); });
  button('refresh').addEventListener('click', () => { void refresh(); });
  button('download').addEventListener('click', () => { if (current) void run('semanticDownload', { model: modelSelect.value }); });
  const build = (force: boolean) => { const notes = options.getNotes().filter(note => !note.trashedAt).map(({ id, markdown, updatedAt }) => ({ id, markdown, updatedAt })); void run('semanticIndex', { notes, model: current?.model, force }); };
  button('index').addEventListener('click', () => build(false));
  button('rebuild').addEventListener('click', () => build(true));
  button('clear').addEventListener('click', () => { void run('semanticClear'); });
  button('repair').addEventListener('click', () => { void run('semanticClear'); });
  button('cancel').addEventListener('click', () => { void run('semanticCancel'); });
  options.registerRefresh?.(refresh); void refresh();
  return root;
}
