import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { renderSemanticSettings as renderSettingsPanel } from '../src/ui/semantic-search';
import { semanticSearch } from '../src/application/semantic-query';
import type { SemanticSearchPort } from '../src/application/ports';
import { parseSemanticHits, parseSemanticStatus, type SemanticStatus } from '../src/application/semantic-contract';

type SemanticInvoke = (action: string, payload?: Record<string, unknown>) => Promise<Record<string, unknown>>;
type LegacySettingsInput = { invoke: SemanticInvoke; getNotes: Parameters<typeof renderSettingsPanel>[0]['getNotes']; onChanged?: Parameters<typeof renderSettingsPanel>[0]['onChanged']; automaticIndex?: Parameters<typeof renderSettingsPanel>[0]['automaticIndex']; registerRefresh?: Parameters<typeof renderSettingsPanel>[0]['registerRefresh'] };
function semanticPort(invoke: SemanticInvoke): SemanticSearchPort {
  return {
    status: async () => await invoke('semanticStatus') as unknown as SemanticStatus,
    index: (notes, force) => invoke('semanticIndex', { notes, force }),
    search: async (query, candidateIDs) => {
      const result = await invoke('semanticSearch', { query, candidateIDs });
      return parseSemanticHits(result.hits);
    },
    configuration: {
      set: async configuration => parseSemanticStatus(await invoke('semanticEnable', configuration as unknown as Record<string, unknown>)),
      startRuntime: async () => { await invoke('semanticStartRuntime'); },
      downloadModel: async model => { await invoke('semanticDownload', { model }); },
      clearIndex: async () => { await invoke('semanticClearIndex'); },
      cancel: async () => { await invoke('semanticCancel'); },
    },
  };
}
function renderSemanticSettings(input: LegacySettingsInput): HTMLElement {
  const { invoke, ...options } = input;
  return renderSettingsPanel({ ...options, search: semanticPort(invoke) });
}

const models = [
  { name: 'all-minilm:22m', disclosure: '22M parameters · approximately 46 MB' },
  { name: 'embeddinggemma:latest', disclosure: '300M parameters · approximately 622 MB' },
];
const providers = [
  { id: 'apple' as const, name: 'On-device (macOS)', disclosure: 'Local English sentence embeddings provided by macOS.', available: true },
  { id: 'ollama' as const, name: 'Ollama', disclosure: 'Requires the separate Ollama app.', available: true },
];
const base: SemanticStatus = {
  enabled: false, provider: 'apple', providers, unavailableReason: null, model: 'all-minilm:22m', models, installed: true, runtimeAvailable: true,
  indexedNotes: 0, progress: '', actionableState: 'disabled',
};

function withDocument(run: (dom: JSDOM) => Promise<void>) {
  return async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const oldDocument = globalThis.document;
    Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
    try { await run(dom); }
    finally { Object.defineProperty(globalThis, 'document', { configurable: true, value: oldDocument }); dom.window.close(); }
  };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const choose = (root: HTMLElement, role: string, dom: JSDOM) => { const input = root.querySelector<HTMLInputElement>(`[data-role="${role}"]`)!; input.checked = true; input.dispatchEvent(new dom.window.Event('change')); return input; };

test('semantic query adapter scopes candidates and rejects malformed/non-finite hit scores', async () => {
  let received: { action: string; payload?: Record<string, unknown> } | undefined;
  const invoke: SemanticInvoke = async (action, payload) => { received = { action, payload }; return { hits: [{ id: 'n1', score: 0.9, snippet: 'A useful note' }] }; };
  assert.deepEqual(await semanticSearch(semanticPort(invoke), 'something useful', ['n1']), [{ id: 'n1', score: 0.9, snippet: 'A useful note' }]);
  assert.equal(received?.action, 'semanticSearch');
  assert.deepEqual(received?.payload, { query: 'something useful', candidateIDs: ['n1'] });
  assert.deepEqual(await semanticSearch(semanticPort(async () => ({ hits: [{ id: 'other', score: 0.8, snippet: 'outside scope' }] })), 'useful', ['n1']), []);
  assert.throws(() => parseSemanticHits([{ id: 'bad', score: Infinity, snippet: 'x' }]), /invalid hit/);
});

test('native radio selection persists Apple, Ollama, and Disabled without opening-time effects', withDocument(async dom => {
  let state: SemanticStatus = { ...base };
  const calls: { action: string; payload?: Record<string, unknown> }[] = [];
  const invoke: SemanticInvoke = async (action, payload) => {
    calls.push({ action, payload });
    if (action === 'semanticStatus') return state as unknown as Record<string, unknown>;
    if (action === 'semanticEnable') { state = { ...state, enabled: payload?.enabled as boolean, provider: payload?.provider as 'apple' | 'ollama' }; return state as unknown as Record<string, unknown>; }
    return state as unknown as Record<string, unknown>;
  };
  const root = renderSemanticSettings({ invoke, getNotes: () => [] }); dom.window.document.body.append(root); await tick();
  assert.equal(root.querySelector<HTMLInputElement>('[data-role="disabled"]')!.checked, true);
  assert.equal(root.querySelector('[data-role="providers"]')!.tagName, 'FIELDSET');
  assert.equal(root.querySelectorAll('input[type=radio]').length, 3);
  assert.equal(root.querySelector('[data-role="flow"]')!.hasAttribute('hidden'), true);
  assert.equal(calls.filter(({ action }) => action !== 'semanticStatus').length, 0);
  assert.equal(root.querySelector<HTMLElement>('[data-role="status"]')!.hidden, true, 'successful status clears the loading message');
  assert.equal(root.querySelector('[data-role="off-model"]'), null, 'Disabled does not expose unused model setup');
  choose(root, 'apple', dom); await tick();
  assert.deepEqual([...calls].reverse().find(({ action }) => action === 'semanticEnable')?.payload, { enabled: true, provider: 'apple' });
  assert.equal(root.querySelector('[data-role="flow"]')!.hasAttribute('hidden'), false);
  assert.equal(root.querySelector('[data-role="runtime-body"]')!.hasAttribute('hidden'), true);
  assert.equal(root.querySelector('[data-role="index-body"]')!.hasAttribute('hidden'), false);
  choose(root, 'disabled', dom); await tick();
  assert.equal(root.querySelector<HTMLInputElement>('[data-role="disabled"]')!.checked, true);
  assert.deepEqual([...calls].reverse().find(({ action }) => action === 'semanticEnable')?.payload, { enabled: false, provider: 'apple' });
  choose(root, 'ollama', dom); await tick();
  assert.deepEqual([...calls].reverse().find(({ action }) => action === 'semanticEnable')?.payload, { enabled: true, provider: 'ollama' });
  assert.equal(root.querySelector('[data-role="flow"]')!.hasAttribute('hidden'), false);
}));

test('unavailable native provider is disclosed; malformed provider contract is not rendered as ready', withDocument(async () => {
  const unavailable = { ...base, enabled: true, provider: 'apple' as const, providers: providers.map(p => p.id === 'apple' ? { ...p, available: false } : p), unavailableReason: 'macOS embedding asset is unavailable.' };
  const root = renderSemanticSettings({ invoke: async () => unavailable as unknown as Record<string, unknown>, getNotes: () => [] }); await tick();
  assert.match(root.querySelector('[data-role="availability"]')!.textContent!, /asset is unavailable/);
  assert.equal(root.querySelector<HTMLInputElement>('[data-role="apple"]')!.disabled, true);
  const malformed = renderSemanticSettings({ invoke: async () => ({ ...base, providers: undefined }), getNotes: () => [] }); await tick();
  assert.match(malformed.querySelector('[data-role="status"]')!.textContent!, /malformed/);
  assert.equal(malformed.querySelector('[data-role="flow"]')!.hasAttribute('hidden'), true);
}));

test('Ollama onboarding presents explicit runtime, download, and index steps with real download link', withDocument(async dom => {
  let state: SemanticStatus = { ...base, enabled: true, provider: 'ollama', runtimeAvailable: false, installed: false };
  const calls: { action: string; payload?: Record<string, unknown> }[] = [];
  const invoke: SemanticInvoke = async (action, payload) => {
    calls.push({ action, payload });
    if (action === 'semanticStatus') return state as unknown as Record<string, unknown>;
    if (action === 'semanticStartRuntime') state = { ...state, runtimeAvailable: true };
    if (action === 'semanticDownload') state = { ...state, installed: true };
    return state as unknown as Record<string, unknown>;
  };
  const notes = [
    { id: 'live', markdown: 'preserved **markdown**', updatedAt: '2026-01-01T00:00:00Z' },
    { id: 'trash', markdown: 'excluded', updatedAt: '2026-01-01T00:00:00Z', trashedAt: '2026-02-01T00:00:00Z' },
  ];
  const root = renderSemanticSettings({ invoke, getNotes: () => notes }); dom.window.document.body.append(root); await tick();
  assert.equal(root.querySelector('[data-role="runtime-body"]')!.hasAttribute('hidden'), false);
  const link = root.querySelector<HTMLAnchorElement>('.semantic-get-ollama')!;
  assert.equal(link.href, 'https://ollama.com/download'); assert.equal(link.target, '_blank'); assert.equal(link.rel, 'noopener noreferrer');
  assert.match(root.textContent!, /started again after reboot/); assert.match(root.textContent!, /46 MB or 622 MB/);
  assert.equal(calls.filter(({ action }) => !['semanticStatus'].includes(action)).length, 0, 'no start or download until explicit button activation');
  (root.querySelector('[data-action="start"]') as HTMLButtonElement).click(); await tick();
  assert.equal(root.querySelector('[data-role="model-body"]')!.hasAttribute('hidden'), false);
  assert.match(root.querySelector('[data-role="disclosure"]')!.textContent!, /46 MB/);
  (root.querySelector('[data-action="download"]') as HTMLButtonElement).click(); await tick();
  assert.equal(root.querySelector('[data-role="index-body"]')!.hasAttribute('hidden'), false);
  assert.equal(root.querySelector('[data-action="index"]')!.hasAttribute('hidden'), true, 'normal automatic indexing has no redundant manual build');
  state = { ...state, indexedNotes: 1 };
  (root.querySelector('[data-role="manage"]') as HTMLDetailsElement).open = true;
  (root.querySelector('[data-action="rebuild"]') as HTMLButtonElement).click(); await tick();
  const snapshot = calls.find(({ action }) => action === 'semanticIndex')?.payload?.notes as { id: string; markdown: string }[];
  assert.deepEqual(snapshot.map(note => note.id), ['live']); assert.equal(snapshot[0].markdown, 'preserved **markdown**');
  assert.match(root.querySelector('[data-role="index-status"]')!.textContent!, /1 note indexed/);
  assert.equal(root.querySelector('[data-role="manage"] summary')!.textContent, 'Manage index');
}));

test('native Apple hides Ollama controls while retaining index management', withDocument(async () => {
  const state: SemanticStatus = { ...base, enabled: true, provider: 'apple', model: 'apple:nl-english:revision-1', indexedNotes: 3, actionableState: 'ready' };
  const root = renderSemanticSettings({ invoke: async () => state as unknown as Record<string, unknown>, getNotes: () => [] }); await tick();
  assert.equal(root.querySelector('[data-action="start"]')!.hasAttribute('hidden'), true);
  assert.equal(root.querySelector('.semantic-get-ollama')!.parentElement!.hasAttribute('hidden'), true);
  assert.equal(root.querySelector('[data-role="runtime-step"]')!.hasAttribute('hidden'), true);
  assert.equal(root.querySelector('[data-role="manage"]')!.hasAttribute('hidden'), false);
  assert.equal(root.querySelector('[data-role="ready-model"]')!.closest('label')!.hasAttribute('hidden'), true, 'Apple index management cannot silently select an Ollama model');
  assert.equal(root.querySelector('[data-role="ready-disclosure"]')!.hasAttribute('hidden'), true);
  assert.match(root.querySelector('[data-role="index-status"]')!.textContent!, /3 notes indexed/);
}));

test('switching from the actual Apple embedding space to Ollama preserves its remembered model', withDocument(async dom => {
  const payloads: Record<string, unknown>[] = [];
  let state: SemanticStatus = { ...base, enabled: true, model: 'apple:nl-english:revision-1' };
  const root = renderSemanticSettings({ getNotes: () => [], invoke: async (action, payload) => {
    if (action === 'semanticEnable') {
      payloads.push(payload!);
      assert.equal(payload?.model, undefined, 'Apple revision identifiers are not valid Ollama models');
      state = { ...state, provider: 'ollama', model: 'embeddinggemma:latest' };
    }
    return state as unknown as Record<string, unknown>;
  } });
  await tick(); choose(root, 'ollama', dom); await tick();
  assert.deepEqual(payloads, [{ enabled: true, provider: 'ollama' }]);
  assert.equal(root.querySelector<HTMLSelectElement>('[data-role="ready-model"]')!.value, 'embeddinggemma:latest');
}));

test('long-running indexing does not block config changes or let stale action/status overwrite them', withDocument(async dom => {
  let releaseStatus!: (value: Record<string, unknown>) => void;
  let state: SemanticStatus = { ...base, enabled: true, provider: 'ollama', runtimeAvailable: true, installed: true };
  let holdRefresh = false;
  const delayedStatus = new Promise<Record<string, unknown>>(resolve => { releaseStatus = resolve; });
  const invoke: SemanticInvoke = async (action, payload) => {
    if (action === 'semanticStatus' && holdRefresh) return delayedStatus;
    if (action === 'semanticIndex') { holdRefresh = true; return { ok: true }; }
    if (action === 'semanticEnable') { state = { ...state, enabled: payload?.enabled as boolean, provider: payload?.provider as 'apple' | 'ollama' }; return state as unknown as Record<string, unknown>; }
    return state as unknown as Record<string, unknown>;
  };
  const root = renderSemanticSettings({ invoke, getNotes: () => [] }); await tick();
  (root.querySelector('[data-role="manage"]') as HTMLDetailsElement).open = true;
  (root.querySelector('[data-action="rebuild"]') as HTMLButtonElement).click(); await tick();
  choose(root, 'disabled', dom); await tick();
  assert.equal(root.querySelector<HTMLInputElement>('[data-role="disabled"]')!.checked, true);
  releaseStatus({ ...state, enabled: true, provider: 'ollama' }); await tick();
  assert.equal(root.querySelector<HTMLInputElement>('[data-role="disabled"]')!.checked, true);
  assert.equal(root.querySelector('[data-role="flow"]')!.hasAttribute('hidden'), true);
}));

test('configuration failures roll the radio choice back and remain visible', withDocument(async dom => {
  const root = renderSemanticSettings({ invoke: async action => { if (action === 'semanticStatus') return base as unknown as Record<string, unknown>; throw new Error('could not save preference'); }, getNotes: () => [] });
  await tick(); choose(root, 'apple', dom); await tick();
  assert.equal(root.querySelector<HTMLInputElement>('[data-role="disabled"]')!.checked, true);
  assert.equal((root.querySelector('[data-role="error"]') as HTMLElement).hidden, false);
  assert.match(root.querySelector('[data-role="error"]')!.textContent!, /could not save preference/);
}));

test('automatic indexing exposes progress, retry, damaged-index repair, and cancellation', withDocument(async dom => {
  let automatic = { running: true, error: '' }; let indexedNotes = 0; let refresh!: () => Promise<void>; let lastForce: unknown;
  let state: SemanticStatus = { ...base, enabled: true, provider: 'apple', indexedNotes };
  const root = renderSemanticSettings({ getNotes: () => [{ id: 'one', markdown: 'Note', updatedAt: '2026-01-01T00:00:00Z' }], automaticIndex: () => automatic, registerRefresh: value => { refresh = value; }, invoke: async (action, payload) => {
    if (action === 'semanticIndex') { lastForce = payload?.force; indexedNotes = 1; state = { ...state, indexedNotes }; automatic = { running: false, error: '' }; }
    if (action === 'semanticStatus') state = { ...state, indexedNotes };
    return state as unknown as Record<string, unknown>;
  } });
  dom.window.document.body.append(root); await tick();
  assert.match(root.querySelector('[data-role="index-status"]')!.textContent!, /Updating index/);
  assert.equal(root.querySelector('[data-action="cancel"]')!.hasAttribute('hidden'), false);
  assert.equal((root.querySelector('[data-action="rebuild"]') as HTMLButtonElement).disabled, true);
  automatic = { running: false, error: 'Connection interrupted' }; await refresh();
  assert.equal(root.querySelector('[data-action="index"]')!.hasAttribute('hidden'), false);
  (root.querySelector('[data-action="index"]') as HTMLButtonElement).click(); await tick();
  assert.equal(lastForce, false); assert.match(root.querySelector('[data-role="index-status"]')!.textContent!, /1 note indexed/);
  state = { ...state, actionableState: 'indexMalformed', indexError: 'Corrupt index' }; await refresh();
  assert.equal(root.querySelector('[data-action="repair"]')!.hasAttribute('hidden'), false);
  assert.match(root.querySelector('[data-role="error"]')!.textContent!, /Corrupt index/);
}));
