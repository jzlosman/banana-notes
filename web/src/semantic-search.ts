export interface SemanticNoteSnapshot { id: string; markdown: string; updatedAt: string; trashedAt?: string }
export interface SemanticHit { id: string; score: number; snippet: string }
export interface SemanticModel { name: string; disclosure: string }
export interface SemanticStatus {
  enabled: boolean; model: string; models: SemanticModel[]; installed: boolean; runtimeAvailable: boolean;
  indexedNotes: number; progress: string; indexError?: string | null; actionableState: 'disabled' | 'modelMissing' | 'ready' | 'indexMalformed' | string;
}
export type SemanticInvoke = (action: string, payload?: Record<string, unknown>) => Promise<Record<string, unknown>>;
export type SemanticSearchHit = SemanticHit;

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : 'Semantic search request failed.';
function isStatus(value: Record<string, unknown>): boolean {
  return typeof value.enabled === 'boolean' && typeof value.model === 'string';
}

/** Semantic query adapter. Note contents stay in the native process, which owns loopback Ollama I/O. */
export async function semanticSearch(invoke: SemanticInvoke, query: string, candidateIDs: readonly string[]): Promise<SemanticHit[]> {
  const result = await invoke('semanticSearch', { query, candidateIDs: [...candidateIDs] });
  if (!Array.isArray(result.hits)) throw new Error('Native semantic search returned an invalid result.');
  return result.hits.map((value): SemanticHit => {
    if (!value || typeof value !== 'object') throw new Error('Native semantic search returned an invalid hit.');
    const hit = value as Record<string, unknown>;
    if (typeof hit.id !== 'string' || typeof hit.score !== 'number' || typeof hit.snippet !== 'string') throw new Error('Native semantic search returned an invalid hit.');
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
  root.innerHTML = `<label class="semantic-heading"><span role="heading" aria-level="2">Semantic search</span><input type="checkbox" data-role="enabled" aria-label="Enable semantic search"></label>
    <p class="semantic-description">Search runs locally using Ollama.</p>
    <div class="semantic-flow" data-role="flow" hidden>
      <p class="semantic-step" data-role="runtime-step"></p><div data-role="runtime-body" hidden>
        <p class="semantic-step-copy" data-role="runtime-copy"></p>
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
    <div class="semantic-off-model" data-role="off-model">
      <details><summary>Models and download sizes</summary><p class="semantic-disclosure" data-role="off-disclosure"></p></details>
    </div>
    <p class="semantic-status" data-role="status" role="status" aria-live="polite">Checking local status…</p>
    <p class="semantic-error" data-role="error" role="alert" hidden></p>`;
  const enabled = root.querySelector<HTMLInputElement>('[data-role="enabled"]')!;
  const flow = root.querySelector<HTMLElement>('[data-role="flow"]')!;
  const modelSelect = root.querySelector<HTMLSelectElement>('[data-role="model"]')!;
  const readyModel = root.querySelector<HTMLSelectElement>('[data-role="ready-model"]')!;
  const statusText = root.querySelector<HTMLElement>('[data-role="status"]')!;
  const errorText = root.querySelector<HTMLElement>('[data-role="error"]')!;
  const indexStatus = root.querySelector<HTMLElement>('[data-role="index-status"]')!;
  const button = (action: string) => root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
  let current: SemanticStatus | undefined;
  let busy = false;
  let requestSequence = 0;
  let refreshPending = false;
  const fillModels = (select: HTMLSelectElement, models: SemanticModel[], selected: string) => {
    select.replaceChildren(...models.map(model => { const option = document.createElement('option'); option.value = model.name; option.textContent = model.name === 'all-minilm:22m' ? 'MiniLM · 46 MB' : model.name === 'embeddinggemma:latest' ? 'Gemma · 622 MB' : model.name; return option; }));
    select.value = selected;
  };
  const update = (status: SemanticStatus) => {
    current = status;
    enabled.checked = status.enabled;
    fillModels(modelSelect, status.models, status.model);
    fillModels(readyModel, status.models, status.model);
    const selected = status.models.find(({ name }) => name === status.model);
    const disclosure = selected?.disclosure ?? 'Model size unavailable';
    root.querySelector('[data-role="disclosure"]')!.textContent = disclosure;
    root.querySelector('[data-role="ready-disclosure"]')!.textContent = disclosure;
    root.querySelector('[data-role="off-disclosure"]')!.textContent = status.models.map(model => `${model.name}: ${model.disclosure}`).join('\n');
    root.querySelector<HTMLElement>('[data-role="off-model"]')!.hidden = status.enabled;
    flow.hidden = !status.enabled;
    statusText.hidden = true;
    const steps = ['runtime-step', 'model-step', 'index-step'].map(role => root.querySelector<HTMLElement>(`[data-role="${role}"]`)!);
    const bodies = ['runtime-body', 'model-body', 'index-body'].map(role => root.querySelector<HTMLElement>(`[data-role="${role}"]`)!);
    let active = 0;
    if (status.runtimeAvailable) active = 1;
    if (status.runtimeAvailable && status.installed) active = 2;
    const titles = ['1  Ollama', '2  Model', '3  Index'];
    steps.forEach((step, i) => { step.textContent = titles[i]; step.classList.toggle('is-current', i === active); step.classList.toggle('is-future', i > active); bodies[i].hidden = i !== active; });
    root.querySelector('[data-role="runtime-copy"]')!.textContent = status.runtimeAvailable ? 'Ollama is available.' : 'Ollama must be installed separately before local search can run.';
    const indexed = status.indexedNotes;
    const automatic = options.automaticIndex?.() ?? { running: false, error: '' };
    const malformed = status.actionableState === 'indexMalformed';
    if (active === 2) indexStatus.textContent = malformed ? 'Clear the damaged index, then rebuild it. Notes will not be deleted.' : automatic.running ? 'Updating index…' : `${indexed} ${indexed === 1 ? 'note' : 'notes'} indexed. Updates automatically.`;
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
    try { const result = await options.invoke('semanticStatus'); if (sequence !== requestSequence) return; if (!isStatus(result)) throw new Error('Native semantic status is malformed.'); update(result as unknown as SemanticStatus); }
    catch (error) { if (sequence === requestSequence) { statusText.hidden = false; statusText.textContent = `${errorMessage(error)} Try reopening Search settings.`; } }
  };
  const run = async (action: string, payload: Record<string, unknown> = {}) => {
    if (busy && action !== 'semanticCancel') return;
    busy = action !== 'semanticCancel';
    const sequence = ++requestSequence;
    const allButtons = [...root.querySelectorAll<HTMLButtonElement>('button')];
    allButtons.forEach(item => { item.disabled = busy && item.dataset.action !== 'cancel'; });
    enabled.disabled = busy; modelSelect.disabled = busy; readyModel.disabled = busy;
    const busyLabel = root.querySelector<HTMLElement>('[data-role="busy"]')!;
    busyLabel.hidden = !busy;
    busyLabel.textContent = action === 'semanticStartRuntime' ? 'Starting Ollama…' : action === 'semanticDownload' ? 'Downloading model…' : action === 'semanticIndex' ? 'Building local index…' : action === 'semanticClear' ? 'Clearing local index…' : '';
    button('cancel').hidden = !busy;
    errorText.hidden = true;
    try {
      const result = await options.invoke(action, payload);
      if (sequence !== requestSequence) return;
      if (isStatus(result)) update(result as unknown as SemanticStatus);
      else {
        const refreshed = await options.invoke('semanticStatus');
        if (sequence === requestSequence && isStatus(refreshed)) update(refreshed as unknown as SemanticStatus);
      }
    } catch (error) { if (sequence === requestSequence) { if (current) { enabled.checked = current.enabled; modelSelect.value = current.model; readyModel.value = current.model; } errorText.textContent = errorMessage(error); errorText.hidden = false; } }
    finally { if (sequence === requestSequence) { busy = false; busyLabel.hidden = true; button('cancel').hidden = !options.automaticIndex?.().running; allButtons.forEach(item => { item.disabled = false; }); button('rebuild').disabled = options.automaticIndex?.().running ?? false; enabled.disabled = false; modelSelect.disabled = false; readyModel.disabled = false; if (refreshPending) { refreshPending = false; void refresh(); } } }
  };
  enabled.addEventListener('change', () => { void run('semanticEnable', { enabled: enabled.checked }); });
  modelSelect.addEventListener('change', () => { if (current) void run('semanticEnable', { enabled: true, model: modelSelect.value }); });
  readyModel.addEventListener('change', () => { if (current) void run('semanticEnable', { enabled: true, model: readyModel.value }); });
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
