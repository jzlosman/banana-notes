import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createExplorerState, renderExplorerView, type ExplorerViewOptions } from '../src/explorer-view';
import { closePopover } from '../src/action-menu';
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
  assert.equal(root.querySelector('.library-heading')?.textContent, 'Notes3 notes');
}));
test('revealed AND tag filters prune stale selections and select all spans every filtered result', () => harness((_dom, root, _calls, state) => {
  const panel = filters(root); click(panel, 'Toggle work tag filter'); click(panel, 'Toggle urgent tag filter');
  assert.deepEqual([...root.querySelectorAll<HTMLElement>('.library-entry')].map(row => row.dataset.noteId), ['one']);
  assert.deepEqual(state.selectedTags, ['work', 'urgent']); closePopover(); selectMode(root); click(root, 'Select all filtered notes'); assert.deepEqual([...state.selectedIDs], ['one']);
  click(filters(root), 'Toggle personal tag filter'); assert.deepEqual([...state.selectedIDs], []);
}));
test('bulk tagging is requested only on demand, and actions receive the exact selection and supplied time', () => harness((_dom, root, calls) => {
  selectMode(root); click(root, 'Select all filtered notes'); click(root, 'Tag selected notes');
  const doc = root.ownerDocument; (doc.querySelector('[aria-label="Tag to add"]') as HTMLInputElement).value = 'project'; click(doc, 'Add tag to selected notes');
  assert.deepEqual(calls.tag?.[0], [['four', 'two', 'one'], 'project', at(15)]); closePopover();
  click(root, 'Move 3 selected notes to Trash'); assert.deepEqual(calls.trash?.[0], [['four', 'two', 'one'], at(15)]);
  click(root, 'Archive 3 selected notes'); assert.deepEqual(calls.archive?.[0]?.[0], ['four', 'two', 'one']);
  click(root, 'Done selecting'); assert.equal(root.querySelector('.library-bulk')?.hasAttribute('hidden'), true);
}));
test('archive filter exists at zero count; tag intersection and explicit date/sort inputs stay available', () => harness((dom, root, _calls, state) => {
  const panel = filters(root); assert.match(panel.querySelector('[aria-label="Toggle archive tag filter"]')!.textContent!, /archive.*0/);
  click(panel, 'Toggle work tag filter'); click(panel, 'Toggle personal tag filter'); assert.equal(root.querySelectorAll('.library-entry').length, 0);
  const date = panel.querySelector('[type=date]') as HTMLInputElement; date.value = '2026-10-02'; date.dispatchEvent(new dom.window.Event('change')); assert.equal(state.before, '2026-10-02');
  const sort = panel.querySelector('[aria-label="Sort notes"]') as HTMLSelectElement; sort.value = 'created'; sort.dispatchEvent(new dom.window.Event('change')); assert.equal(state.sort, 'created');
}));
test('Trash comes from the common menu, shows recovery time and offers restore via row actions', () => harness((dom, root, calls, state) => {
  click(root, 'Notes actions'); menu(root, 'Trash'); const trash = dom.window.document.querySelector('.library-explorer') as HTMLElement;
  assert.equal(state.mode, 'trash'); assert.equal(trash.querySelectorAll('.library-entry').length, 1); assert.match(trash.querySelector('.library-expiry')!.textContent!, /16 days left/);
  assert.equal(trash.querySelector('.library-row-title')?.tagName, 'DIV'); click(trash, 'Actions for Three'); menu(trash, 'Restore note'); assert.deepEqual(calls.restore?.[0], [['three'], at(15)]);
  const title = trash.querySelector('.library-row-title') as HTMLElement; title.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Backspace', metaKey: true, bubbles: true })); assert.equal(calls.trash, undefined); assert.equal(calls.open, undefined);
  const expired = fixture(); expired.notes.find(note => note.id === 'three')!.trashedAt = '2026-09-01T12:00:00.000Z';
  const state2 = createExplorerState(expired); state2.mode = 'trash';
  const view = renderExplorerView({ library: expired, state: state2, now: at(15), onOpenNote() {}, onScopeChange() {}, onTrash() {}, onRestore() {}, onArchive() {}, onTag() {}, onOverview() {} }); assert.equal(view.querySelectorAll('.library-entry').length, 0);
}));
test('right click and the overflow expose the same actions; Escape restores focus without hiding the app', () => harness((dom, root, calls) => {
  const row = root.querySelector('.library-entry') as HTMLElement; row.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }));
  assert.match(dom.window.document.querySelector('[role=menu]')!.textContent!, /Archive note.*Move to Trash/);
  const event = new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); dom.window.document.dispatchEvent(event); assert.equal(event.defaultPrevented, true); assert.equal(dom.window.document.querySelector('[role=menu]'), null);
  const title = row.querySelector('.library-row-title')!; title.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Backspace', metaKey: true, bubbles: true, cancelable: true })); assert.deepEqual(calls.trash?.[0]?.[0], ['four']);
  root.querySelector('[aria-label="Search notes"]')!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Backspace', metaKey: true, bubbles: true })); assert.equal(calls.trash?.length, 1);
}));
test('overview is available from overflow and carries the selected notebook scope', () => harness((_dom, root, calls) => {
  click(filters(root), 'Toggle work tag filter'); closePopover(); click(root, 'Notes actions'); menu(root, 'Notebook overview'); assert.deepEqual(calls.overview?.[0], [['work']]);
}));
test('semantic search rejects stale replies and preserves scoped ranking rather than substring results', async () => {
  const pending: ((ids: string[]) => void)[] = [];
  await harness(async (dom, root, _calls, state) => {
    state.semantic = true; const search = root.querySelector('[aria-label="Search notes"]') as HTMLInputElement;
    search.value = 'first'; search.dispatchEvent(new dom.window.Event('input')); search.value = 'second'; search.dispatchEvent(new dom.window.Event('input'));
    pending[0](['one']); pending[1](['two', 'one', 'hidden']); await tick(); assert.deepEqual(state.semanticIDs, ['two', 'one']);
    assert.deepEqual([...root.querySelectorAll<HTMLElement>('.library-entry')].map(row => row.dataset.noteId), ['two', 'one']); assert.equal(root.querySelector('.note-total')?.textContent, '2 notes'); assert.match(root.querySelector('.explorer-semantic-disclosure')?.textContent ?? '', /up to 50 semantic results/i);
  }, { onSemanticSearch: async () => new Promise(resolve => pending.push(resolve)) });
});
test('tag changes rerun semantic candidates and ignore an earlier async response', async () => {
  const pending: { candidates: string[]; resolve: (ids: string[]) => void }[] = [];
  await harness(async (dom, root, _calls, state) => {
    state.semantic = true; const search = root.querySelector('[aria-label="Search notes"]') as HTMLInputElement; search.value = 'meaning'; search.dispatchEvent(new dom.window.Event('input'));
    assert.deepEqual(pending[0].candidates, ['four', 'two', 'one']); click(filters(root), 'Toggle work tag filter'); assert.deepEqual(pending[1].candidates, ['two', 'one']);
    pending[0].resolve(['four']); pending[1].resolve(['one', 'two']); await tick(); assert.deepEqual(state.semanticIDs, ['one', 'two']);
  }, { onSemanticSearch: async (_query, candidates) => new Promise(resolve => pending.push({ candidates, resolve })) });
});
