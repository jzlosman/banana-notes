import { createElement, Search, ArrowLeft, Trash2, Ellipsis, SlidersHorizontal, CheckSquare, X, Archive, Hash, RotateCcw, LayoutList, type IconNode } from 'lucide';
import { notebookTags, queryNotes, selectedTags, titleOf, trashExpiresAt, type Library, type Note } from './domain';
import { openActionMenu, openPopover, type MenuItem } from './action-menu';
import { renderNoteSummary } from './note-summary';
import { mergeSearchMatches, type NoteSearchResult } from './note-search';

export type ExplorerMode = 'notes' | 'trash';
export interface ExplorerState {
  query: string;
  before: string;
  selectedIDs: Set<string>;
  selecting: boolean;
  mode: ExplorerMode;
  sort: 'edited' | 'created';
  selectedTags: string[];
  searchResult: NoteSearchResult | null;
}
export function createExplorerState(library?: Library): ExplorerState {
  return { query: '', before: '', selectedIDs: new Set(), selecting: false, mode: 'notes', sort: 'edited', selectedTags: library ? selectedTags(library) : [], searchResult: null };
}

/** Read view; all business state changes and external queries belong to its host. */
export interface ExplorerViewOptions {
  library: Library;
  state: ExplorerState;
  now: string;
  onOpenNote(id: string): void;
  onScopeChange(tags: string[]): void;
  onModeChange?(): void;
  onTrash(ids: string[], now: string): void;
  onRestore(ids: string[], now: string): void;
  onArchive(ids: string[], now: string): void;
  onTag(ids: string[], tag: string, now: string): void;
  onOverview(tags: string[]): void;
  onSearch?(query: string, candidateIDs: string[]): Promise<NoteSearchResult>;
  onConfigureSearch?(): void;
  onError?(error: Error): void;
}
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node;
};
const icon = (node: IconNode, size = 15) => createElement([node[0], { ...node[1], width: size, height: size, 'stroke-width': 1.7, 'aria-hidden': 'true' }, node[2]]);
const button = (label: string, run: () => void, glyph?: IconNode, className = 'icon-button'): HTMLButtonElement => {
  const node = el('button', className); node.type = 'button'; node.title = label; node.setAttribute('aria-label', label); node.onclick = run;
  if (glyph) node.append(icon(glyph)); return node;
};
const expired = (note: Note, now: string) => !!note.trashedAt && Date.parse(now) >= Date.parse(trashExpiresAt(note)!);
const expiryText = (note: Note, now: string) => {
  const days = Math.max(0, Math.ceil((Date.parse(trashExpiresAt(note)!) - Date.parse(now)) / 86400000));
  return `${days} ${days === 1 ? 'day' : 'days'} left`;
};
const generations = new WeakMap<ExplorerState, number>();
const generationOf = (state: ExplorerState) => generations.get(state) ?? 0;

export function renderExplorerView(options: ExplorerViewOptions): HTMLElement {
  const { library, state } = options;
  generations.set(state, generationOf(state) + 1);
  let searchBusy = false;
  const root = el('main', 'explorer-side library-explorer'); root.setAttribute('aria-label', state.mode === 'trash' ? 'Trash' : 'Notes explorer');
  const heading = el('div', 'explorer-heading library-heading');
  if (state.mode === 'trash') heading.append(button('Back to notes', () => changeMode('notes'), ArrowLeft));
  heading.append(el('h1', '', state.mode === 'trash' ? 'Trash' : 'Notes'));
  const count = el('span', 'note-total'); heading.append(count);
  const more = button('Notes actions', () => openActionMenu(more, listActions(), { label: 'Notes actions', onError: report }), Ellipsis);
  more.setAttribute('aria-haspopup', 'menu'); heading.append(more); root.append(heading);

  const controls = el('div', 'library-controls');
  const searchRow = el('div', 'library-search-row');
  const searchLabel = el('label', 'search-field library-search'); searchLabel.append(icon(Search));
  const search = el('input'); search.type = 'search'; search.placeholder = 'Search notes…'; search.setAttribute('aria-label', 'Search notes'); search.value = state.query;
  search.oninput = () => { state.query = search.value; invalidate(); redraw(); void runSearch(); };
  search.onkeydown = event => { if (event.key === 'ArrowDown') { event.preventDefault(); root.querySelector<HTMLElement>('.library-row-title')?.focus(); } };
  searchLabel.append(search); searchRow.append(searchLabel);
  const filters = button('Filter and sort notes', () => openFilters(), SlidersHorizontal, 'icon-button library-filter-trigger'); filters.setAttribute('aria-haspopup', 'dialog');
  if (state.mode === 'notes') searchRow.append(filters);
  controls.append(searchRow);
  const scope = el('div', 'library-active-filters'); controls.append(scope);
  if (state.mode === 'trash') controls.append(el('p', 'library-trash-note', 'Notes can be restored for 30 days.'));
  const bulk = el('div', 'library-bulk');
  const status = el('p', 'explorer-semantic-status'); status.setAttribute('role', 'status');
  const list = el('div', 'note-list library-note-list'); list.setAttribute('role', 'list'); list.setAttribute('aria-label', state.mode === 'trash' ? 'Trashed notes' : 'Notes');
  root.append(controls, bulk, status, list);

  function report(error: unknown) { options.onError?.(error instanceof Error ? error : new Error(String(error))); }
  function scopedNotes(query?: string): Note[] {
    return queryNotes(library, { query, before: state.before || undefined, sort: state.sort, tags: state.selectedTags, includeTrash: state.mode === 'trash' })
      .filter(note => state.mode === 'trash' ? !!note.trashedAt && !expired(note, options.now) : !note.trashedAt);
  }
  function visible(): Note[] {
    const textMatches = scopedNotes(state.query);
    if (state.mode !== 'notes' || !state.query.trim() || state.searchResult?.kind !== 'semantic') return textMatches;
    const ids = mergeSearchMatches(textMatches.map(note => note.id), state.searchResult.ids);
    const rank = new Map(ids.map((id, index) => [id, index]));
    return scopedNotes().filter(note => rank.has(note.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  }
  function invalidate() { generations.set(state, generationOf(state) + 1); state.searchResult = null; searchBusy = false; }
  function changeMode(mode: ExplorerMode) {
    state.mode = mode; state.query = ''; state.before = ''; state.selectedIDs.clear(); state.selecting = false; invalidate();
    root.replaceWith(renderExplorerView(options)); options.onModeChange?.();
  }
  function listActions(): MenuItem[] {
    return [
      { label: state.selecting ? 'Done selecting' : 'Select notes', icon: CheckSquare, run: () => { state.selecting = !state.selecting; state.selectedIDs.clear(); redraw(); } },
      ...(state.mode === 'notes' ? [
        { label: 'Notebook overview', icon: LayoutList, run: () => options.onOverview([...state.selectedTags]) },
        { separator: true } as const,
        { label: 'Trash', icon: Trash2, run: () => changeMode('trash') },
      ] : [{ label: 'Back to notes', icon: ArrowLeft, run: () => changeMode('notes') }]),
    ];
  }
  function tagSelected(trigger: HTMLElement, ids: string[]) {
    const form = el('form', 'tag-popover');
    const label = el('label', '', `Add a tag to ${ids.length === 1 ? 'this note' : `${ids.length} notes`}`);
    const input = el('input'); input.placeholder = 'project-name'; input.setAttribute('aria-label', 'Tag to add'); input.required = true; input.maxLength = 80;
    const submit = el('button', 'primary-button', 'Add tag'); submit.type = 'submit'; submit.setAttribute('aria-label', 'Add tag to selected notes');
    label.append(input); form.append(label, submit);
    form.onsubmit = event => { event.preventDefault(); if (input.value.trim()) options.onTag(ids, input.value, options.now); };
    openPopover(trigger, form, { label: 'Add tag' });
  }
  function rowActions(note: Note, trigger: HTMLElement): MenuItem[] {
    if (state.mode === 'trash') return [{ label: 'Restore note', icon: RotateCcw, run: () => options.onRestore([note.id], options.now) }];
    return [
      { label: 'Open note', run: () => options.onOpenNote(note.id) },
      { label: 'Select note', icon: CheckSquare, run: () => { state.selecting = true; state.selectedIDs.add(note.id); redraw(); } },
      { label: 'Add tag…', icon: Hash, run: () => tagSelected(trigger, [note.id]) },
      { label: 'Archive note', icon: Archive, run: () => options.onArchive([note.id], options.now) },
      { separator: true },
      { label: 'Move to Trash', icon: Trash2, danger: true, shortcut: '⌘⌫', run: () => options.onTrash([note.id], options.now) },
    ];
  }
  function openFilters() {
    const panel = el('div', 'library-filter-panel');
    const top = el('div', 'filter-panel-heading'); top.append(el('h2', '', 'Filter & sort'));
    const reset = button('Reset note filters', () => { state.selectedTags = []; state.before = ''; options.onScopeChange([]); invalidate(); redraw(); void runSearch(); openFilters(); }, undefined, 'text-button'); reset.textContent = 'Reset'; top.append(reset); panel.append(top);
    const sortLabel = el('label', 'filter-setting', 'Sort by'); const sort = el('select'); sort.setAttribute('aria-label', 'Sort notes');
    for (const [value, text] of [['edited', 'Recently edited'], ['created', 'Recently created']]) { const option = el('option', '', text); option.value = value; sort.append(option); }
    sort.value = state.sort; sort.onchange = () => { state.sort = sort.value as ExplorerState['sort']; invalidate(); redraw(); void runSearch(); }; sortLabel.append(sort); panel.append(sortLabel);
    const dateLabel = el('label', 'filter-setting', 'Before date · UTC'); const date = el('input'); date.type = 'date'; date.value = state.before; date.setAttribute('aria-label', 'Before date (UTC)');
    date.onchange = () => { state.before = date.value; invalidate(); redraw(); void runSearch(); }; dateLabel.append(date); panel.append(dateLabel);
    const tagHeading = el('h3', '', 'Tags'); panel.append(tagHeading, el('p', 'filter-hint', 'Match every selected tag.'));
    const tags = notebookTags(library); if (!tags.some(item => item.tag === 'archive')) tags.push({ tag: 'archive', count: 0 });
    const tagList = el('div', 'filter-tag-list'); tagList.setAttribute('aria-label', 'Filter by tags');
    for (const { tag, count: total } of tags) {
      const chip = button(`Toggle ${tag} tag filter`, () => {
        state.selectedTags = state.selectedTags.includes(tag) ? state.selectedTags.filter(item => item !== tag) : [...state.selectedTags, tag];
        chip.setAttribute('aria-pressed', String(state.selectedTags.includes(tag))); chip.classList.toggle('selected', state.selectedTags.includes(tag));
        options.onScopeChange([...state.selectedTags]); invalidate(); redraw(); void runSearch();
      }, undefined, `filter-chip${state.selectedTags.includes(tag) ? ' selected' : ''}`);
      chip.append(el('span', '', `#${tag}`), el('span', 'chip-count', String(total))); chip.setAttribute('aria-pressed', String(state.selectedTags.includes(tag))); tagList.append(chip);
    }
    panel.append(tagList);
    openPopover(filters, panel, { label: 'Filter and sort notes' });
  }
  async function runSearch() {
    if (!options.onSearch || state.mode !== 'notes' || !state.query.trim()) return;
    const generation = generationOf(state) + 1; generations.set(state, generation); searchBusy = true; redraw();
    const candidates = scopedNotes().map(note => note.id);
    try {
      const result = await options.onSearch(state.query, candidates);
      if (generation !== generationOf(state)) return;
      if (result.kind === 'cancelled') { searchBusy = false; redraw(); return; }
      if (result.kind === 'semantic') {
        const allowed = new Set(candidates);
        state.searchResult = { kind: 'semantic', ids: [...new Set(result.ids)].filter(id => allowed.has(id)).slice(0, 50) };
      } else state.searchResult = result;
      searchBusy = false; redraw();
    } catch {
      if (generation !== generationOf(state)) return;
      state.searchResult = { kind: 'text', reason: 'Semantic search is unavailable. Showing text matches; check Settings → Search.' };
      searchBusy = false; redraw();
    }
  }
  function redraw() {
    const results = visible(), ids = new Set(results.map(note => note.id));
    state.selectedIDs = new Set([...state.selectedIDs].filter(id => ids.has(id)));
    count.textContent = `${results.length} ${results.length === 1 ? 'note' : 'notes'}`;
    scope.replaceChildren();
    if (state.mode === 'notes') {
      for (const tag of state.selectedTags) {
        const chip = button(`Remove ${tag} filter`, () => { state.selectedTags = state.selectedTags.filter(value => value !== tag); options.onScopeChange([...state.selectedTags]); invalidate(); redraw(); void runSearch(); }, X, 'active-filter');
        chip.prepend(el('span', '', `#${tag}`)); scope.append(chip);
      }
      if (state.before) { const chip = button('Remove before-date filter', () => { state.before = ''; invalidate(); redraw(); void runSearch(); }, X, 'active-filter'); chip.prepend(el('span', '', `Before ${state.before}`)); scope.append(chip); }
    }
    scope.hidden = !scope.childElementCount; filters.classList.toggle('active', !!state.before || !!state.selectedTags.length);
    bulk.replaceChildren(); bulk.hidden = !state.selecting;
    if (state.selecting) {
      const all = el('input'); all.type = 'checkbox'; all.setAttribute('aria-label', 'Select all filtered notes'); all.checked = results.length > 0 && results.every(note => state.selectedIDs.has(note.id)); all.indeterminate = state.selectedIDs.size > 0 && !all.checked;
      all.onchange = () => { state.selectedIDs = all.checked ? new Set(results.map(note => note.id)) : new Set(); redraw(); };
      bulk.append(all, el('span', 'selection-count', `${state.selectedIDs.size} selected`));
      if (state.selectedIDs.size) {
        const selected = [...state.selectedIDs];
        if (state.mode === 'trash') bulk.append(button(`Restore ${selected.length} selected notes`, () => options.onRestore(selected, options.now), RotateCcw));
        else {
          const tag = button('Tag selected notes', () => tagSelected(tag, selected), Hash); bulk.append(tag, button(`Archive ${selected.length} selected notes`, () => options.onArchive(selected, options.now), Archive), button(`Move ${selected.length} selected notes to Trash`, () => options.onTrash(selected, options.now), Trash2, 'icon-button danger-action'));
        }
      }
      bulk.append(button('Done selecting', () => { state.selecting = false; state.selectedIDs.clear(); redraw(); }, X));
    }
    const reason = state.searchResult?.kind === 'text' ? state.searchResult.reason : undefined;
    status.replaceChildren();
    if (searchBusy) status.append(el('span', '', 'Searching…'));
    else if (reason) {
      status.append(el('span', '', reason));
      if (options.onConfigureSearch) {
        const setup = button('Search settings', options.onConfigureSearch, undefined, 'text-button'); setup.textContent = 'Search settings'; status.append(setup);
      }
    }
    status.hidden = !status.childElementCount;
    list.replaceChildren();
    if (!results.length) {
      const empty = el('div', 'empty-state library-empty'); empty.append(el('h2', '', state.mode === 'trash' ? 'Trash is empty' : searchBusy ? 'Searching…' : state.query ? 'No matching notes' : 'No notes'));
      empty.append(el('p', '', state.mode === 'trash' ? 'Deleted notes are kept for 30 days.' : searchBusy ? 'Searching the local index.' : state.query || state.selectedTags.length || state.before ? 'Try another search or adjust your filters.' : 'Create a note with ⌘N.'));
      list.append(empty);
    }
    for (const note of results) {
      const row = el('div', 'note-list-entry library-entry'); row.dataset.noteId = note.id; row.setAttribute('role', 'listitem');
      if (state.selecting) {
        const check = el('input', 'library-select'); check.type = 'checkbox'; check.checked = state.selectedIDs.has(note.id); check.setAttribute('aria-label', `Select ${titleOf(note.markdown)}`);
        check.onchange = () => { check.checked ? state.selectedIDs.add(note.id) : state.selectedIDs.delete(note.id); redraw(); }; row.append(check);
      }
      row.append(renderNoteSummary(note, { onOpen: state.mode === 'trash' ? undefined : () => options.onOpenNote(note.id), current: library.selectedID === note.id, date: state.mode === 'trash' ? note.trashedAt : state.sort === 'created' ? note.createdAt : note.updatedAt }));
      if (state.mode === 'trash') row.append(el('span', 'library-expiry', expiryText(note, options.now)));
      const action = button(`Actions for ${titleOf(note.markdown)}`, () => openActionMenu(action, rowActions(note, action), { label: 'Note actions', onError: report }), Ellipsis, 'icon-button row-more'); action.setAttribute('aria-haspopup', 'menu'); row.append(action);
      row.oncontextmenu = event => { event.preventDefault(); openActionMenu(action, rowActions(note, action), { label: 'Note actions', point: { x: event.clientX, y: event.clientY }, onError: report }); };
      list.append(row);
    }
    if (state.mode === 'notes' && state.query.trim() && state.searchResult?.kind === 'semantic' && !searchBusy && results.length) list.append(el('p', 'explorer-semantic-disclosure', 'Includes up to 50 semantic matches.'));
  }
  list.addEventListener('keydown', event => {
    const target = event.target as HTMLElement, row = target.closest<HTMLElement>('.library-entry'); if (!row) return;
    if (event.metaKey && event.key === 'Backspace' && state.mode !== 'trash' && target.closest('.library-row-title')) { event.preventDefault(); options.onTrash([row.dataset.noteId!], options.now); return; }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = [...list.querySelectorAll<HTMLElement>('.library-row-title')], next = rows[rows.indexOf(target.closest('.library-row-title') as HTMLElement) + (event.key === 'ArrowDown' ? 1 : -1)];
    if (next) { event.preventDefault(); next.focus(); }
  });
  redraw(); if (state.query.trim()) void runSearch(); return root;
}
