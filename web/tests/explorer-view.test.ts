import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createExplorerState, renderExplorerView, type ExplorerViewOptions } from '../src/ui/explorer-view';
import { closePopover } from '../src/ui/action-menu';
import type { NoteSearchResult } from '../src/application/note-search';
import { createNote, updateNote, trashNote, type Library } from '../src/domain';

const at = (day: number) => `2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`;
function fixture(): Library {
  let library: Library = { version: 1, notes: [], selectedID: null, activeTag: null };
  for (const [id, body, day] of [['one', '# One\n#work #urgent', 1], ['two', '# Two\n#work #later', 2], ['three', '# Three\n#personal', 3], ['four', '# Four\n#personal', 4]] as const) library = updateNote(createNote(library, id, at(day)), id, body, at(day));
  return trashNote(library, 'three', at(1));
}
async function harness(run: (dom: JSDOM, root: HTMLElement, calls: Record<string, unknown[][]>, state: ReturnType<typeof createExplorerState>) => void | Promise<void>, extra: Partial<ExplorerViewOptions> = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const oldDocument = globalThis.document; Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  const library = fixture(), state = createExplorerState(library), calls: Record<string, unknown[][]> = {};
  const called = (key: string, ...args: unknown[]) => { (calls[key] ||= []).push(args); };
  const root = renderExplorerView({ library, state, now: at(15), onOpenNote: id => called('open', id), onScopeChange: tags => called('scope', tags), onTrash: (ids, now) => called('trash', ids, now), onRestore: (ids, now) => called('restore', ids, now), onArchive: (ids, now) => called('archive', ids, now), onTag: (ids, tag, now) => called('tag', ids, tag, now), onOverview: tags => called('overview', tags), ...extra });
  dom.window.document.body.append(root);
  try { await run(dom, root, calls, state); } finally { closePopover(); Object.defineProperty(globalThis, 'document', { configurable: true, value: oldDocument }); dom.window.close(); }
}
function click(root: ParentNode, label: string) { const node = root.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`); assert.ok(node, label); node.click(); }
function menu(root: HTMLElement, text: string) { const node = [...root.ownerDocument.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent?.trim() === text); assert.ok(node, text); node.click(); }
function selectMode(root: HTMLElement) { click(root, 'Notes actions'); menu(root, 'Select notes'); }
function filters(root: HTMLElement) { click(root, 'Filter and sort notes'); return root.ownerDocument.body; }
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('ordinary search puts notes first and keeps advanced filters and bulk operations out of view', () => harness((_dom, root) => {
  assert.equal(root.querySelectorAll('.library-entry').length, 3);
  assert.equal(root.querySelector('[type="date"]'), null);
  assert.equal(root.querySelector('.library-select'), null);
  assert.equal(root.querySelector('.library-bulk')?.hasAttribute('hidden'), true);
  assert.equal(root.querySelector('.library-tags'), null);
  assert.equal(root.querySelector('.library-filter-panel'), null);
  assert.equal(root.querySelector('.library-heading h1')?.textContent, 'Notes'); assert.equal(root.querySelector('.note-total')?.textContent, '3 notes');
  assert.equal(root.querySelector('.overview-separator')?.hasAttribute('hidden'), true);
}));
test('recent tag chips apply one tag, and the searchable All tags popover supports keyboard selection', () => harness((dom, root, calls, state) => {
  const chips = [...root.querySelectorAll<HTMLButtonElement>('.recent-tag-chip')];
  assert.ok(chips.length > 0 && chips.length <= 5);
  click(root, 'Filter by #work');
  assert.deepEqual(state.selectedTags, ['work']);
  assert.equal(root.querySelector('.library-heading h1')?.textContent, '#work');
  assert.equal(root.querySelector('.note-total')?.textContent, '2 notes');
  assert.equal(root.querySelector('.overview-separator')?.textContent, '·');
  assert.equal(root.querySelector('.overview-separator')?.hasAttribute('hidden'), false);
  assert.equal(root.querySelector('.library-filter-trigger')?.classList.contains('active'), false, 'tag scope does not activate sort/date filters');
  assert.equal((root.querySelector('[aria-label="Search #work"]') as HTMLInputElement).placeholder, 'Search #work');
  assert.equal(root.querySelector('.row-tags'), null, 'filtered rows hide their tag labels');
  const selected = root.querySelector<HTMLButtonElement>('[aria-label="Remove #work filter"]')!;
  assert.equal(selected.getAttribute('aria-pressed'), 'true');
  click(root, 'Remove #work filter'); assert.deepEqual(state.selectedTags, []);
  assert.equal(root.querySelector('.library-heading h1')?.textContent, 'Notes');
  assert.equal(root.querySelector('.active-filter'), null, 'the selected tag is not duplicated in an active-filter strip');
  click(root, 'All 4 tags');
  const input = dom.window.document.querySelector<HTMLInputElement>('[aria-label="Find a tag"]')!;
  assert.equal(dom.window.document.activeElement, input);
  input.value = 'work'; input.dispatchEvent(new dom.window.Event('input'));
  assert.deepEqual([...dom.window.document.querySelectorAll('[role="option"]')].map(option => option.textContent?.trim()), ['#work2']);
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.deepEqual(state.selectedTags, ['work']); assert.equal(dom.window.document.activeElement?.getAttribute('aria-label'), 'All 4 tags');
  click(root, 'Open #work overview'); assert.deepEqual(calls.overview?.at(-1), [['work']]);
}));
test('bulk tagging is requested only on demand, and actions receive the exact selection and supplied time', () => harness((_dom, root, calls) => {
  selectMode(root); click(root, 'Select all filtered notes'); click(root, 'Tag selected notes');
  const doc = root.ownerDocument; (doc.querySelector('[aria-label="Tag to add"]') as HTMLInputElement).value = 'project'; click(doc, 'Add tag to selected notes');
  assert.deepEqual(calls.tag?.[0], [['four', 'two', 'one'], 'project', at(15)]); closePopover();
  click(root, 'Move 3 selected notes to Trash'); assert.deepEqual(calls.trash?.[0], [['four', 'two', 'one'], at(15)]);
  click(root, 'Archive 3 selected notes'); assert.deepEqual(calls.archive?.[0]?.[0], ['four', 'two', 'one']);
  click(root, 'Done selecting'); assert.equal(root.querySelector('.library-bulk')?.hasAttribute('hidden'), true);
}));
test('Filter and sort keeps before-date and sort controls without a tag panel', () => harness((dom, root, _calls, state) => {
  const panel = filters(root);
  assert.equal(panel.querySelector('[aria-label="Sort notes"]') !== null, true);
  assert.equal(panel.querySelector('[type=date]') !== null, true);
  assert.equal(panel.querySelector('.filter-tag-list'), null);
  assert.doesNotMatch(panel.querySelector('.library-filter-panel')!.textContent!, /Tags|Match every selected tag/);
  const date = panel.querySelector('[type=date]') as HTMLInputElement; date.value = '2026-10-02'; date.dispatchEvent(new dom.window.Event('change')); assert.equal(state.before, '2026-10-02');
  assert.equal(root.querySelector('.library-filter-trigger')?.classList.contains('active'), true);
  const sort = panel.querySelector('[aria-label="Sort notes"]') as HTMLSelectElement; sort.value = 'created'; sort.dispatchEvent(new dom.window.Event('change')); assert.equal(state.sort, 'created');
  assert.equal(root.querySelector('.library-filter-trigger')?.classList.contains('active'), true);
  click(panel, 'Reset note filters');
  assert.equal(state.before, ''); assert.equal(state.sort, 'edited');
  assert.equal(root.querySelector('.library-filter-trigger')?.classList.contains('active'), false);
}));
test('Trash comes from the common menu, shows recovery time and offers restore via row actions', () => harness((dom, root, calls, state) => {
  click(root, 'Notes actions'); menu(root, 'Trash'); const trash = dom.window.document.querySelector('.library-explorer') as HTMLElement;
  assert.equal(state.mode, 'trash'); assert.equal(trash.querySelectorAll('.library-entry').length, 1); assert.match(trash.querySelector('.library-expiry')!.textContent!, /16 days left/);
  assert.equal(trash.querySelector('.recent-tag-row')?.hasAttribute('hidden'), true, 'tag filters are unavailable in Trash');
  assert.equal(trash.querySelector('.library-row-title')?.tagName, 'DIV'); click(trash, 'Actions for Three'); menu(trash, 'Restore note'); assert.deepEqual(calls.restore?.[0], [['three'], at(15)]);
  const title = trash.querySelector('.library-row-title') as HTMLElement; title.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Backspace', metaKey: true, bubbles: true })); assert.equal(calls.trash, undefined); assert.equal(calls.open, undefined);
  const expired = fixture(); expired.notes.find(note => note.id === 'three')!.trashedAt = '2026-09-01T12:00:00.000Z';
  const state2 = createExplorerState(expired); state2.mode = 'trash';
  const view = renderExplorerView({ library: expired, state: state2, now: at(15), onOpenNote() {}, onScopeChange() {}, onTrash() {}, onRestore() {}, onArchive() {}, onTag() {}, onOverview() {} }); assert.equal(view.querySelectorAll('.library-entry').length, 0);
}));
test('empty Trash states its 30-day retention only once', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>'); const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  try {
    const library: Library = { version: 1, notes: [], selectedID: null, activeTag: null };
    const state = createExplorerState(library); state.mode = 'trash';
    const root = renderExplorerView({ library, state, now: at(15), onOpenNote() {}, onScopeChange() {}, onTrash() {}, onRestore() {}, onArchive() {}, onTag() {}, onOverview() {} });
    assert.equal((root.textContent!.match(/30 days/g) ?? []).length, 1);
    assert.equal(root.querySelector('.library-empty p'), null);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous); else delete (globalThis as any).document;
    dom.window.close();
  }
});

test('right click and the overflow expose the same actions; Escape restores focus without hiding the app', () => harness((dom, root, calls) => {
  const row = root.querySelector('.library-entry') as HTMLElement; row.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }));
  assert.match(dom.window.document.querySelector('[role=menu]')!.textContent!, /Archive note.*Move to Trash/);
  const event = new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); dom.window.document.dispatchEvent(event); assert.equal(event.defaultPrevented, true); assert.equal(dom.window.document.querySelector('[role=menu]'), null);
  const title = row.querySelector('.library-row-title')!; title.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Backspace', metaKey: true, bubbles: true, cancelable: true })); assert.deepEqual(calls.trash?.[0]?.[0], ['four']);
  root.querySelector('[aria-label="Search notes"]')!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Backspace', metaKey: true, bubbles: true })); assert.equal(calls.trash?.length, 1);
}));
test('overview is available from the selected tag heading and the overflow menu', () => harness((_dom, root, calls) => {
  click(root, 'Filter by #work'); click(root, 'Open #work overview'); assert.deepEqual(calls.overview?.[0], [['work']]);
  click(root, 'Notes actions'); menu(root, 'Notebook overview'); assert.deepEqual(calls.overview?.at(-1), [['work']]);
}));
test('one search field automatically enriches results and rejects stale or out-of-scope replies', async () => {
  const pending: ((value: NoteSearchResult) => void)[] = [];
  await harness(async (dom, root, _calls, state) => {
    const search = root.querySelector('[aria-label="Search notes"]') as HTMLInputElement;
    search.value = 'first'; search.dispatchEvent(new dom.window.Event('input')); search.value = 'second'; search.dispatchEvent(new dom.window.Event('input'));
    pending[0]({ kind: 'semantic', ids: ['one'] }); pending[1]({ kind: 'semantic', ids: ['two', 'one', 'three', 'hidden'] }); await tick();
    assert.deepEqual(state.searchResult, { kind: 'semantic', ids: ['two', 'one'] });
    assert.deepEqual([...root.querySelectorAll<HTMLElement>('.library-entry')].map(row => row.dataset.noteId), ['two', 'one']);
    assert.equal(root.querySelector('.note-total')?.textContent, '2 notes');
    assert.match(root.querySelector('.explorer-semantic-disclosure')?.textContent ?? '', /up to 50 semantic matches/i);
    assert.equal(search.placeholder, 'Search notes');
    assert.equal(root.querySelector('.library-filter-trigger')?.classList.contains('active'), false, 'semantic capability is not a user-selected filter');
    const panel = filters(root); assert.equal(panel.querySelector('[aria-label="Search method"]'), null); assert.doesNotMatch(panel.querySelector('.library-filter-panel')!.textContent!, /Search using/);
  }, { onSearch: async () => new Promise<NoteSearchResult>(resolve => pending.push(resolve)) });
});
test('tag changes rerun search candidates and ignore an earlier async response', async () => {
  const pending: { candidates: string[]; resolve: (value: NoteSearchResult) => void }[] = [];
  await harness(async (dom, root, _calls, state) => {
    const search = root.querySelector('[aria-label="Search notes"]') as HTMLInputElement; search.value = 'meaning'; search.dispatchEvent(new dom.window.Event('input'));
    assert.deepEqual(pending[0].candidates, ['four', 'two', 'one']); click(root, 'Filter by #work'); assert.deepEqual(pending[1].candidates, ['two', 'one']);
    pending[0].resolve({ kind: 'semantic', ids: ['four'] }); pending[1].resolve({ kind: 'semantic', ids: ['one', 'two'] }); await tick(); assert.deepEqual(state.searchResult, { kind: 'semantic', ids: ['one', 'two'] });
  }, { onSearch: async (_query, candidates) => new Promise<NoteSearchResult>(resolve => pending.push({ candidates, resolve })) });
});

test('literal matches remain visible while pending and come before additional semantic matches', async () => {
  let complete!: (value: NoteSearchResult) => void;
  await harness(async (dom, root) => {
    const search = root.querySelector<HTMLInputElement>('[aria-label="Search notes"]')!;
    search.value = 'One'; search.dispatchEvent(new dom.window.Event('input'));
    const ids = () => [...root.querySelectorAll<HTMLElement>('.library-entry')].map(row => row.dataset.noteId);
    assert.deepEqual(ids(), ['one']);
    complete({ kind: 'semantic', ids: ['two', 'one', 'four'] }); await tick();
    assert.deepEqual(ids(), ['one', 'two', 'four']);
    selectMode(root); click(root, 'Select all filtered notes');
    assert.match(root.querySelector('.selection-count')!.textContent!, /3 selected/);
  }, { onSearch: async () => new Promise<NoteSearchResult>(resolve => { complete = resolve; }) });
});

test('unavailable enrichment keeps exact matches and offers Settings without a global error', async () => {
  let configured = 0;
  await harness(async (dom, root, calls) => {
    const search = root.querySelector<HTMLInputElement>('[aria-label="Search notes"]')!;
    search.value = 'One'; search.dispatchEvent(new dom.window.Event('input')); await tick();
    assert.deepEqual([...root.querySelectorAll<HTMLElement>('.library-entry')].map(row => row.dataset.noteId), ['one']);
    assert.match(root.querySelector('.explorer-semantic-status')!.textContent!, /Showing text matches/);
    assert.equal(root.querySelector('.explorer-semantic-status')!.getAttribute('role'), 'status');
    click(root, 'Search settings'); assert.equal(configured, 1); assert.equal(calls.error, undefined);
  }, { onSearch: async () => { throw new Error('engine unavailable'); }, onConfigureSearch: () => { configured++; } });
});

test('Disabled configuration yields silent text-only results, and Trash never invokes embeddings', async () => {
  let searches = 0;
  await harness(async (dom, root) => {
    const search = root.querySelector<HTMLInputElement>('[aria-label="Search notes"]')!;
    search.value = 'One'; search.dispatchEvent(new dom.window.Event('input')); await tick();
    assert.equal(root.querySelectorAll('.library-entry').length, 1);
    assert.equal(root.querySelector<HTMLElement>('.explorer-semantic-status')!.hidden, true);
    assert.equal(root.querySelector('.explorer-semantic-disclosure'), null);
    click(root, 'Notes actions'); menu(root, 'Trash');
    const trash = dom.window.document.querySelector<HTMLElement>('.library-explorer')!;
    const trashSearch = trash.querySelector<HTMLInputElement>('[aria-label="Search notes"]')!;
    trashSearch.value = 'Three'; trashSearch.dispatchEvent(new dom.window.Event('input')); await tick();
    assert.equal(trash.querySelectorAll('.library-entry').length, 1); assert.equal(searches, 1);
  }, { onSearch: async () => { searches++; return { kind: 'text' }; } });
});

test('resetting filters reruns enrichment against the restored scope', async () => {
  const scopes: string[][] = [];
  await harness(async (dom, root) => {
    const search = root.querySelector<HTMLInputElement>('[aria-label="Search notes"]')!;
    search.value = 'meaning'; search.dispatchEvent(new dom.window.Event('input')); await tick();
    click(root, 'Filter by #work'); await tick();
    click(filters(root), 'Reset note filters'); await tick();
    assert.deepEqual(scopes, [['four', 'two', 'one'], ['two', 'one'], ['four', 'two', 'one']]);
  }, { onSearch: async (_query, candidates) => { scopes.push(candidates); return { kind: 'semantic', ids: candidates }; } });
});
