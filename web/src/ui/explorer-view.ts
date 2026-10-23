import { Search, ArrowLeft, Trash2, Ellipsis, SlidersHorizontal, CheckSquare, X, Archive, Hash, RotateCcw, ChevronDown, LayoutList, type IconNode } from 'lucide';
import { renderIcon } from './icon';
import { groupNotesByLocalDay, queryNotes, recentNotebookTags, selectedTags, titleOf, trashExpiresAt, type Library, type Note } from '../domain/library';
import { closePopover, openActionMenu, openPopover, type MenuItem } from './action-menu';
import { renderNoteSummary } from './note-summary';
import { handleNoteTrashShortcut } from './note-trash-shortcut';
import { mergeSearchMatches, type NoteSearchResult } from '../application/note-search';
import { plainInput } from './plain-input';

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
const icon = (node: IconNode, size = 15) => renderIcon(node, size);
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
const NOTE_ROW_HEIGHT = 61;
const DAY_HEADING_HEIGHT = 38;
const OVERSCAN = 6;
type VisibleItem = { kind: 'day'; label: string; key: string; top: number; height: number } | { kind: 'note'; note: Note; index: number; top: number; height: number };

export function renderExplorerView(options: ExplorerViewOptions): HTMLElement {
  const { library, state } = options;
  generations.set(state, generationOf(state) + 1);
  let searchBusy = false;
  let lastVisible: Note[] = [];
  let rowOffsets: number[] = [];
  const root = el('main', 'explorer-side library-explorer'); root.setAttribute('aria-label', state.mode === 'trash' ? 'Trash' : 'Notes explorer');
  const heading = el('div', 'explorer-heading library-heading');
  if (state.mode === 'trash') heading.append(button('Back to notes', () => changeMode('notes'), ArrowLeft));
  const headingTitle = el('h1', '', state.mode === 'trash' ? 'Trash' : 'Notes'); heading.append(headingTitle);
  const headingMeta = el('div', 'library-heading-meta');
  const count = el('span', 'note-total'); headingMeta.append(count);
  const overviewSeparator = el('span', 'overview-separator', '·'); overviewSeparator.setAttribute('aria-hidden', 'true'); overviewSeparator.hidden = true; headingMeta.append(overviewSeparator);
  const overview = button('Open tag overview', () => options.onOverview([...state.selectedTags]), undefined, 'text-button overview-link'); overview.textContent = 'Overview'; overview.hidden = true; headingMeta.append(overview);
  const more = button('Notes actions', () => openActionMenu(more, listActions(), { label: 'Notes actions', onError: report }), Ellipsis);
  more.setAttribute('aria-haspopup', 'menu'); headingMeta.append(more); heading.append(headingMeta); root.append(heading);

  const controls = el('div', 'library-controls');
  const recentTags = el('div', 'recent-tag-row'); recentTags.setAttribute('aria-label', 'Recent tags');
  const allTags = recentNotebookTags(library);
  const tagEntries = [...new Set([...state.selectedTags, ...allTags.map(item => item.tag)])].map(tag => ({
    tag, count: allTags.find(item => item.tag === tag)?.count ?? 0,
  }));
  const chips = new Map<string, HTMLButtonElement>();
  const allTagsButton = button(`All ${allTags.length} tags`, () => openAllTags(), undefined, 'recent-tags-all');
  allTagsButton.setAttribute('aria-haspopup', 'dialog'); allTagsButton.setAttribute('aria-expanded', 'false');
  allTagsButton.append(el('span', '', `All ${allTags.length}`), icon(ChevronDown, 13));
  for (const item of tagEntries) {
    const chip = el('button', 'recent-tag-chip'); chip.type = 'button';
    chip.onclick = () => selectTag(item.tag);
    chip.dataset.tag = item.tag;
    chips.set(item.tag, chip); recentTags.append(chip);
  }
  recentTags.append(allTagsButton);
  recentTags.hidden = state.mode === 'trash' || allTags.length === 0;
  if (tagEntries.length > 5) tagEntries.slice(5).forEach(item => chips.get(item.tag)?.classList.add('is-overflowed'));

  const searchRow = el('div', 'library-search-row');
  const searchLabel = el('label', 'search-field library-search'); searchLabel.append(icon(Search));
  const search = plainInput(el('input')); search.type = 'search'; search.placeholder = state.selectedTags.length === 1 ? `Search #${state.selectedTags[0]}` : 'Search notes'; search.setAttribute('aria-label', 'Search notes'); search.value = state.query;
  search.oninput = () => { state.query = search.value; invalidate(); redraw(); void runSearch(); };
  search.onkeydown = event => {
    if (event.key !== 'Tab') searchLabel.classList.add('user-focused');
    if (event.key === 'ArrowDown') { event.preventDefault(); focusRow(0); }
  };
  search.addEventListener('blur', () => searchLabel.classList.remove('user-focused'));
  searchLabel.addEventListener('pointerdown', () => searchLabel.classList.add('user-focused'));
  let tabNavigation = false;
  root.addEventListener('keydown', event => { if (event.key === 'Tab') tabNavigation = true; });
  root.addEventListener('focusin', event => {
    if (event.target === search && tabNavigation) searchLabel.classList.add('user-focused');
    tabNavigation = false;
  });
  searchLabel.append(search); searchRow.append(searchLabel);
  const filters = button('Filter and sort notes', () => openFilters(), SlidersHorizontal, 'icon-button library-filter-trigger'); filters.setAttribute('aria-haspopup', 'dialog');
  if (state.mode === 'notes') searchRow.append(filters);
  const scope = el('div', 'library-active-filters quiet-scroll side-scroll');
  if (state.mode === 'trash') controls.append(el('p', 'library-trash-note', 'Notes can be restored for 30 days.'));
  const bulk = el('div', 'library-bulk');
  const status = el('p', 'explorer-semantic-status'); status.setAttribute('role', 'status');
  const list = el('div', 'note-list library-note-list quiet-scroll'); list.setAttribute('role', 'list'); list.setAttribute('aria-label', state.mode === 'trash' ? 'Trashed notes' : 'Notes');
  controls.append(recentTags, searchRow, scope);
  root.append(controls, bulk, status, list);

  function report(error: unknown) { options.onError?.(error instanceof Error ? error : new Error(String(error))); }
  function selectedDate(note: Note): string {
    return state.mode === 'trash' ? note.trashedAt! : state.sort === 'created' ? note.createdAt : note.updatedAt;
  }
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
    const next = renderExplorerView(options); root.replaceWith(next);
    next.querySelector<HTMLInputElement>('.library-search input')?.focus(); options.onModeChange?.();
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
  function selectTag(tag: string) {
    state.selectedTags = state.selectedTags.length === 1 && state.selectedTags[0] === tag ? [] : [tag];
    options.onScopeChange([...state.selectedTags]); invalidate(); refreshTagChips(); redraw(); void runSearch();
  }
  function refreshTagChips() {
    for (const item of tagEntries) {
      const chip = chips.get(item.tag)!;
      const selected = state.selectedTags.includes(item.tag);
      chip.classList.toggle('selected', selected); chip.setAttribute('aria-pressed', String(selected));
      chip.setAttribute('aria-label', selected ? `Remove #${item.tag} filter` : `Filter by #${item.tag}`);
      chip.replaceChildren(el('span', '', `#${item.tag}`));
      if (selected) chip.append(el('span', 'recent-tag-remove', '×'));
    }
    recentTags.hidden = state.mode === 'trash' || allTags.length === 0;
    measureRecentTags();
  }
  function measureRecentTags() {
    if (recentTags.hidden || !recentTags.clientWidth) return;
    const styles = recentTags.ownerDocument.defaultView?.getComputedStyle(recentTags);
    const gap = Number.parseFloat(styles?.columnGap || styles?.gap || '6') || 6;
    const available = recentTags.clientWidth - allTagsButton.getBoundingClientRect().width - (tagEntries.length ? gap : 0);
    let used = 0, visibleCount = 0;
    for (const item of tagEntries) {
      const chip = chips.get(item.tag)!;
      chip.classList.remove('is-overflowed');
      const width = chip.getBoundingClientRect().width;
      const next = used + (visibleCount ? gap : 0) + width;
      if (visibleCount < 5 && next <= available + 0.5) { used = next; visibleCount++; }
      else break;
    }
    for (const [index, item] of tagEntries.entries()) {
      const chip = chips.get(item.tag)!;
      const hidden = index >= visibleCount;
      chip.setAttribute('aria-hidden', String(hidden)); chip.tabIndex = hidden ? -1 : 0;
      chip.classList.toggle('is-overflowed', hidden);
    }
  }
  function openAllTags() {
    const panel = el('div', 'all-tags-popover');
    const input = plainInput(el('input')); input.type = 'search'; input.placeholder = 'Find a tag'; input.setAttribute('aria-label', 'Find a tag'); input.autocomplete = 'off';
    const searchLabel = el('label', 'all-tags-search'); searchLabel.append(icon(Search, 14), input);
    const recently = el('div', 'all-tags-recent-label', 'Recently used');
    const results = el('div', 'all-tags-list quiet-scroll'); results.setAttribute('role', 'listbox'); results.setAttribute('aria-label', 'Recently used tags');
    panel.append(searchLabel, recently, results);
    let filtered = allTags;
    let activeIndex = 0;
    const renderOptions = () => {
      results.replaceChildren();
      if (!filtered.length) { results.append(el('p', 'all-tags-empty', 'No matching tags')); activeIndex = -1; return; }
      activeIndex = Math.max(0, Math.min(activeIndex, filtered.length - 1));
      filtered.forEach((item, index) => {
        const option = el('div', `all-tags-option${index === activeIndex ? ' highlighted' : ''}`);
        option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(index === activeIndex)); option.setAttribute('aria-label', `#${item.tag}, ${item.count} ${item.count === 1 ? 'note' : 'notes'}`); option.tabIndex = -1;
        option.append(el('span', '', `#${item.tag}`), el('span', 'all-tags-count', String(item.count)));
        option.onclick = () => { closePopover(true); selectTag(item.tag); };
        results.append(option);
      });
    };
    input.oninput = () => { filtered = allTags.filter(item => item.tag.toLocaleLowerCase().includes(input.value.trim().replace(/^#/, '').toLocaleLowerCase())); activeIndex = 0; renderOptions(); };
    input.onkeydown = event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (!filtered.length) return;
        event.preventDefault(); activeIndex = (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length; renderOptions();
        results.querySelector<HTMLElement>('.highlighted')?.scrollIntoView?.({ block: 'nearest' });
      } else if (event.key === 'Enter' && activeIndex >= 0) {
        event.preventDefault(); const selected = filtered[activeIndex]; closePopover(true); if (selected) selectTag(selected.tag);
      }
    };
    renderOptions(); openPopover(allTagsButton, panel, { label: 'All tags' });
  }
  function openFilters() {
    const panel = el('div', 'library-filter-panel');
    const top = el('div', 'filter-panel-heading'); top.append(el('h2', '', 'Filter & sort'));
    const reset = button('Reset note filters', () => { state.selectedTags = []; state.before = ''; state.sort = 'edited'; options.onScopeChange([]); invalidate(); refreshTagChips(); redraw(); void runSearch(); openFilters(); }, undefined, 'text-button'); reset.textContent = 'Reset'; top.append(reset); panel.append(top);
    const sortLabel = el('label', 'filter-setting', 'Sort by'); const sort = el('select'); sort.setAttribute('aria-label', 'Sort notes');
    for (const [value, text] of [['edited', 'Recently edited'], ['created', 'Recently created']]) { const option = el('option', '', text); option.value = value; sort.append(option); }
    sort.value = state.sort; sort.onchange = () => { state.sort = sort.value as ExplorerState['sort']; invalidate(); redraw(); void runSearch(); }; sortLabel.append(sort); panel.append(sortLabel);
    const dateLabel = el('label', 'filter-setting', 'Before date · UTC'); const date = el('input'); date.type = 'date'; date.value = state.before; date.setAttribute('aria-label', 'Before date (UTC)');
    date.onchange = () => { state.before = date.value; invalidate(); redraw(); void runSearch(); }; dateLabel.append(date); panel.append(dateLabel);
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
  function layoutItems(results: Note[]): VisibleItem[] {
    const locale = document.documentElement.lang || document.defaultView?.navigator.language || 'en-US';
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const groups = groupNotesByLocalDay(results, selectedDate, options.now, locale, zone);
    const items: VisibleItem[] = []; rowOffsets = []; let top = 0, index = 0;
    for (const group of groups) {
      items.push({ kind: 'day', label: group.label, key: group.key, top, height: DAY_HEADING_HEIGHT }); top += DAY_HEADING_HEIGHT;
      for (const note of group.notes) {
        rowOffsets[index] = top; items.push({ kind: 'note', note, index, top, height: NOTE_ROW_HEIGHT }); top += NOTE_ROW_HEIGHT; index++;
      }
    }
    return items;
  }
  function renderRows(results: Note[], focusIndex?: number) {
    list.replaceChildren();
    list.setAttribute('aria-setsize', String(results.length));
    if (!results.length) {
      const empty = el('div', 'empty-state library-empty'); empty.append(el('h2', '', state.mode === 'trash' ? 'Trash is empty' : searchBusy ? 'Searching…' : state.query ? 'No matching notes' : 'No notes'));
      const detail = state.mode === 'trash' ? '' : searchBusy ? 'Searching the local index.' : state.query || state.selectedTags.length || state.before ? 'Try another search or adjust your filters.' : 'Create a note with ⌘N.';
      if (detail) empty.append(el('p', '', detail));
      list.append(empty);
    } else {
      const items = layoutItems(results), totalHeight = items.length ? items[items.length - 1].top + items[items.length - 1].height : 0;
      const viewport = list.clientHeight || 720, scrollTop = list.scrollTop;
      let first = items.findIndex(item => item.top + item.height > scrollTop);
      if (first < 0) first = 0;
      let last = items.findIndex(item => item.top >= scrollTop + viewport);
      if (last < 0) last = items.length;
      first = Math.max(0, first - OVERSCAN); last = Math.min(items.length, last + OVERSCAN);
      const topSpacer = el('div', 'library-virtual-spacer'); topSpacer.setAttribute('aria-hidden', 'true'); topSpacer.style.height = `${items[first]?.top ?? 0}px`; list.append(topSpacer);
      for (const item of items.slice(first, last)) {
        if (item.kind === 'day') {
          const header = el('div', 'note-day-heading', item.label); header.setAttribute('role', 'heading'); header.setAttribute('aria-level', '2'); header.dataset.day = item.key; list.append(header); continue;
        }
        const note = item.note;
        const row = el('div', 'note-list-entry library-entry'); row.dataset.noteId = note.id; row.dataset.index = String(item.index); row.setAttribute('role', 'listitem');
        const isCurrent = library.selectedID === note.id;
        if (isCurrent) row.setAttribute('aria-current', 'true');
        row.setAttribute('aria-posinset', String(item.index + 1)); row.setAttribute('aria-setsize', String(results.length));
        if (state.selecting) {
          const check = el('input', 'library-select'); check.type = 'checkbox'; check.checked = state.selectedIDs.has(note.id); check.setAttribute('aria-label', `Select ${titleOf(note.markdown)}`);
          check.onchange = () => { check.checked ? state.selectedIDs.add(note.id) : state.selectedIDs.delete(note.id); redraw(); }; row.append(check);
        }
        row.append(renderNoteSummary(note, {
          onOpen: state.mode === 'trash' ? undefined : () => options.onOpenNote(note.id),
          current: isCurrent, date: selectedDate(note), showTags: state.mode !== 'trash' && state.selectedTags.length === 0, explorer: true,
        }));
        if (state.mode === 'trash') row.append(el('span', 'library-expiry', expiryText(note, options.now)));
        const action = button(`Actions for ${titleOf(note.markdown)}`, () => openActionMenu(action, rowActions(note, action), { label: 'Note actions', onError: report }), Ellipsis, 'icon-button row-more'); action.setAttribute('aria-haspopup', 'menu'); row.append(action);
        row.oncontextmenu = event => { event.preventDefault(); openActionMenu(action, rowActions(note, action), { label: 'Note actions', point: { x: event.clientX, y: event.clientY }, onError: report }); };
        list.append(row);
      }
      const bottomSpacer = el('div', 'library-virtual-spacer'); bottomSpacer.setAttribute('aria-hidden', 'true'); bottomSpacer.style.height = `${Math.max(0, totalHeight - (items[last - 1]?.top ?? 0) - (items[last - 1]?.height ?? 0))}px`; list.append(bottomSpacer);
      if (focusIndex !== undefined) list.querySelector<HTMLElement>(`.library-entry[data-index="${focusIndex}"] .library-row-title`)?.focus();
    }
    if (state.mode === 'notes' && state.query.trim() && state.searchResult?.kind === 'semantic' && !searchBusy && results.length) list.append(el('p', 'explorer-semantic-disclosure', 'Includes up to 50 semantic matches.'));
  }
  function focusRow(index: number) {
    if (index < 0 || index >= lastVisible.length) return;
    list.scrollTop = rowOffsets[index] ?? 0;
    renderRows(lastVisible, index);
  }
  function redraw() {
    const results = visible(), ids = new Set(results.map(note => note.id));
    lastVisible = results;
    state.selectedIDs = new Set([...state.selectedIDs].filter(id => ids.has(id)));
    const selectedTag = state.selectedTags.length === 1 ? state.selectedTags[0] : undefined;
    headingTitle.textContent = state.mode === 'trash' ? 'Trash' : selectedTag ? `#${selectedTag}` : state.selectedTags.length ? state.selectedTags.map(tag => `#${tag}`).join(' · ') : 'Notes';
    count.textContent = `${results.length} ${results.length === 1 ? 'note' : 'notes'}`;
    overview.hidden = state.mode !== 'notes' || !state.selectedTags.length;
    overviewSeparator.hidden = overview.hidden;
    overview.setAttribute('aria-label', state.selectedTags.length === 1 ? `Open #${state.selectedTags[0]} overview` : 'Open notebook overview');
    overview.onclick = () => options.onOverview([...state.selectedTags]);
    search.placeholder = selectedTag ? `Search #${selectedTag}` : 'Search notes';
    search.setAttribute('aria-label', selectedTag ? `Search #${selectedTag}` : 'Search notes');
    refreshTagChips();
    scope.replaceChildren();
    if (state.mode === 'notes' && state.before) {
      const before = state.before;
      const chip = button('Remove before-date filter', () => { state.before = ''; invalidate(); redraw(); void runSearch(); }, X, 'active-filter');
      chip.prepend(el('span', '', `Before ${before}`)); scope.append(chip);
    }
    scope.hidden = !scope.childElementCount; filters.classList.toggle('active', state.mode === 'notes' && (state.sort !== 'edited' || !!state.before));
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
    renderRows(results);
  }
  list.addEventListener('keydown', event => {
    const target = event.target as HTMLElement, row = target.closest<HTMLElement>('.library-entry'); if (!row) return;
    if (state.mode !== 'trash' && target.closest('.library-row-title')
      && handleNoteTrashShortcut(event, row.dataset.noteId ?? null, id => options.onTrash([id], options.now))) return;
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const index = Number(row.dataset.index) + (event.key === 'ArrowDown' ? 1 : -1);
    if (index >= 0 && index < lastVisible.length) { event.preventDefault(); focusRow(index); }
  });
  list.addEventListener('scroll', () => renderRows(lastVisible));
  refreshTagChips(); redraw(); if (state.query.trim()) void runSearch();
  const ResizeObserverConstructor = root.ownerDocument.defaultView?.ResizeObserver;
  if (ResizeObserverConstructor) new ResizeObserverConstructor(measureRecentTags).observe(recentTags);
  queueMicrotask(measureRecentTags);
  return root;
}
