import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { renderSemanticSettings, semanticSearch, type SemanticInvoke, type SemanticStatus } from '../src/semantic-search';

const models = [
  { name: 'all-minilm:22m', disclosure: '22M parameters · approximately 46 MB' },
  { name: 'embeddinggemma:latest', disclosure: '300M parameters · approximately 622 MB' },
];
const base: SemanticStatus = {
  enabled: false, model: 'all-minilm:22m', models, installed: false, runtimeAvailable: false,
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

test('semantic query adapter passes candidate scope and validates native hit shape', async () => {
  let received: { action: string; payload?: Record<string, unknown> } | undefined;
  const invoke: SemanticInvoke = async (action, payload) => { received = { action, payload }; return { hits: [{ id: 'n1', score: 0.9, snippet: 'A useful note' }] }; };
  assert.deepEqual(await semanticSearch(invoke, 'something useful', ['n1']), [{ id: 'n1', score: 0.9, snippet: 'A useful note' }]);
  assert.equal(received?.action, 'semanticSearch');
  assert.deepEqual(received?.payload, { query: 'something useful', candidateIDs: ['n1'] });
  await assert.rejects(semanticSearch(async () => ({ hits: [{ id: 'bad' }] }), 'x', []), /invalid hit/);
});

test('settings reveal only the current setup step and require explicit actions', withDocument(async dom => {
  let state: SemanticStatus = { ...base };
  const calls: { action: string; payload?: Record<string, unknown> }[] = [];
  const invoke: SemanticInvoke = async (action, payload) => {
    calls.push({ action, payload });
    if (action === 'semanticStatus') return state as unknown as Record<string, unknown>;
    if (action === 'semanticEnable') state = { ...state, enabled: payload?.enabled as boolean, model: payload?.model as string ?? state.model };
    if (action === 'semanticStartRuntime') state = { ...state, runtimeAvailable: true };
    if (action === 'semanticDownload') state = { ...state, installed: true };
    if (action === 'semanticIndex') state = { ...state, indexedNotes: (payload?.notes as unknown[]).length };
    return state as unknown as Record<string, unknown>;
  };
  const notes = [
    { id: 'live', markdown: 'preserved **markdown**', updatedAt: '2026-01-01T00:00:00Z' },
    { id: 'trash', markdown: 'excluded', updatedAt: '2026-01-01T00:00:00Z', trashedAt: '2026-02-01T00:00:00Z' },
  ];
  let refresh!: () => Promise<void>;
  const root = renderSemanticSettings({ invoke, getNotes: () => notes, registerRefresh: value => { refresh = value; } }); dom.window.document.body.append(root); await tick();
  assert.match(root.textContent!, /Semantic search/);
  assert.equal(root.querySelector('[data-role="flow"]')!.hasAttribute('hidden'), true);
  assert.equal(root.querySelector('[data-role="off-model"] details')!.hasAttribute('open'), false);
  assert.equal(calls.filter(({ action }) => action !== 'semanticStatus').length, 0, 'opening never enables, starts, downloads, or indexes');
  (root.querySelector('[data-role="enabled"]') as HTMLInputElement).checked = true;
  root.querySelector('[data-role="enabled"]')!.dispatchEvent(new dom.window.Event('change')); await tick();
  assert.equal(root.querySelector('[data-role="runtime-body"]')!.hasAttribute('hidden'), false);
  assert.equal(root.querySelector('[data-role="model-body"]')!.hasAttribute('hidden'), true);
  assert.match(root.textContent!, /Ollama must be installed separately/);
  assert.equal(root.querySelectorAll('[data-action="start"]').length, 1);
  (root.querySelector('[data-action="start"]') as HTMLButtonElement).click(); await tick();
  assert.equal(root.querySelector('[data-role="model-body"]')!.hasAttribute('hidden'), false);
  assert.equal(root.querySelector('[data-role="index-body"]')!.hasAttribute('hidden'), true);
  assert.match(root.querySelector('[data-role="disclosure"]')!.textContent!, /46 MB/);
  (root.querySelector('[data-action="download"]') as HTMLButtonElement).click(); await tick();
  assert.equal(root.querySelector('[data-role="index-body"]')!.hasAttribute('hidden'), false);
  assert.equal(root.querySelector('[data-action="index"]')!.hasAttribute('hidden'), true, 'normal setup does not require a manual build');
  state = { ...state, indexedNotes: 1 }; await refresh();
  (root.querySelector('[data-role="manage"]') as HTMLDetailsElement).open = true;
  (root.querySelector('[data-action="rebuild"]') as HTMLButtonElement).click(); await tick();
  const snapshot = calls.find(({ action }) => action === 'semanticIndex')?.payload?.notes as { id: string; markdown: string }[];
  assert.deepEqual(snapshot.map(note => note.id), ['live']);
  assert.equal(snapshot[0].markdown, 'preserved **markdown**');
  assert.match(root.querySelector('[data-role="index-status"]')!.textContent!, /1 note indexed/);
  assert.equal(root.querySelector('[data-action="index"]')!.hasAttribute('hidden'), true, 'ready state has no prominent rebuild action');
  assert.equal(root.querySelector('[data-role="manage"]')!.hasAttribute('hidden'), false);
  assert.equal(root.querySelector('[data-role="manage"] summary')!.textContent, 'Manage index');
}));

test('late status responses cannot overwrite a newer settings action', withDocument(async dom => {
  let release!: (value: Record<string, unknown>) => void;
  const delayed = new Promise<Record<string, unknown>>(resolve => { release = resolve; });
  let first = true;
  const invoke: SemanticInvoke = async action => {
    if (action === 'semanticStatus' && first) { first = false; return delayed; }
    return { ...base, enabled: action === 'semanticEnable' };
  };
  const root = renderSemanticSettings({ invoke, getNotes: () => [] });
  (root.querySelector('[data-role="enabled"]') as HTMLInputElement).checked = true;
  root.querySelector('[data-role="enabled"]')!.dispatchEvent(new dom.window.Event('change')); await tick();
  release({ ...base, enabled: false }); await tick();
  assert.equal((root.querySelector('[data-role="enabled"]') as HTMLInputElement).checked, true);
}));

test('busy actions lock setup controls, expose only cancellation, and report failures', withDocument(async dom => {
  let rejectAction!: (error: Error) => void;
  let state = { ...base, enabled: true, runtimeAvailable: true, installed: true };
  const invoke: SemanticInvoke = async action => {
    if (action === 'semanticStatus') return state as unknown as Record<string, unknown>;
    if (action === 'semanticIndex') return await new Promise<Record<string, unknown>>((_resolve, reject) => { rejectAction = reject; });
    return { ok: true };
  };
  const root = renderSemanticSettings({ invoke, getNotes: () => [] }); await tick();
  (root.querySelector('[data-role="manage"]') as HTMLDetailsElement).open = true;
  (root.querySelector('[data-action="rebuild"]') as HTMLButtonElement).click();
  assert.match(root.querySelector('[data-role="busy"]')!.textContent!, /Building local index/);
  assert.equal((root.querySelector('[data-role="enabled"]') as HTMLInputElement).disabled, true);
  assert.equal(root.querySelector('[data-action="cancel"]')!.hasAttribute('hidden'), false);
  rejectAction(new Error('index failed')); await tick();
  assert.match(root.querySelector('[data-role="error"]')!.textContent!, /index failed/);
  assert.equal(root.querySelector('[data-action="cancel"]')!.hasAttribute('hidden'), true);
}));

test('failed status and failed opt-in remain visible without claiming the feature is enabled', withDocument(async dom => {
  const unavailable = renderSemanticSettings({ invoke: async () => { throw new Error('local status unavailable'); }, getNotes: () => [] });
  await tick(); assert.match(unavailable.querySelector('[data-role="status"]')!.textContent!, /local status unavailable/);
  assert.equal((unavailable.querySelector('[data-role="status"]') as HTMLElement).hidden, false);
  const root = renderSemanticSettings({ invoke: async action => { if (action === 'semanticStatus') return { ...base }; throw new Error('could not save preference'); }, getNotes: () => [] });
  await tick(); const enabled = root.querySelector<HTMLInputElement>('[data-role="enabled"]')!; enabled.checked = true; enabled.dispatchEvent(new dom.window.Event('change')); await tick();
  assert.equal(enabled.checked, false); assert.equal(root.querySelector('[data-role="flow"]')!.hasAttribute('hidden'), true);
  assert.equal((root.querySelector('[data-role="error"]') as HTMLElement).hidden, false);
}));

test('automatic indexing shows progress and completion; failed automatic updates offer an incremental retry', withDocument(async dom => {
  let automatic = { running: true, error: '' }; let indexedNotes = 0; let refresh!: () => Promise<void>;
  let lastForce: unknown;
  const root = renderSemanticSettings({ getNotes: () => [{ id: 'one', markdown: 'Note', updatedAt: '2026-01-01T00:00:00Z' }], automaticIndex: () => automatic, registerRefresh: value => { refresh = value; }, invoke: async (action, payload) => {
    if (action === 'semanticIndex') { lastForce = payload?.force; indexedNotes = 1; automatic = { running: false, error: '' }; }
    return { ...base, enabled: true, runtimeAvailable: true, installed: true, indexedNotes };
  } });
  dom.window.document.body.append(root); await tick();
  assert.match(root.querySelector('[data-role="index-status"]')!.textContent!, /Updating index/);
  assert.equal(root.querySelector('[data-action="cancel"]')!.hasAttribute('hidden'), false);
  assert.equal((root.querySelector('[data-action="rebuild"]') as HTMLButtonElement).disabled, true);
  automatic = { running: false, error: 'Connection interrupted' }; await refresh();
  assert.equal(root.querySelector('[data-action="index"]')!.hasAttribute('hidden'), false);
  (root.querySelector('[data-action="index"]') as HTMLButtonElement).click(); await tick();
  assert.equal(lastForce, false, 'Retry preserves unchanged embeddings rather than forcing a full rebuild');
  assert.match(root.querySelector('[data-role="index-status"]')!.textContent!, /1 note indexed/);
  assert.equal(root.querySelector('[data-action="index"]')!.hasAttribute('hidden'), true);
}));
