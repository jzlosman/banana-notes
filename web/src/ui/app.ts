import '../style.css';
import '../explorer-view.css';
import '../project-view.css';
import '../media.css';
import '../code-highlighting.css';
import '../semantic-search.css';
import '../note-image.css';
import '../note-font.css';
import '../action-menu.css';
import '../link-editor.css';
import '../compact-link-view.css';
import { openLinkEditor } from './link-editor';
import { closePopover, openActionMenu } from './action-menu';
import { handleNoteTrashShortcut } from './note-trash-shortcut';
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Plus, Pin, Search, ArrowLeft, BookOpen, Code, CircleHelp, X, Hash, Download, Bold, Italic, Heading2, List, Link, ListTodo, Quote, Braces, Check, FolderOpen, Settings, Trash2, RotateCcw, Clipboard, Paperclip, Camera, ScanText, Ellipsis, Archive, type IconNode } from 'lucide';
import { renderIcon } from './icon';
import type { Editor } from '@tiptap/core';
import { createMarkdownEditor, guardMarkdownEditor } from './editor';
import { markdownParserInput } from './editor/markdown-parse';
import { bindMarkdownSourceTextarea, type MarkdownSourceTextarea } from './editor/markdown-source-edit';
import { type Library, type Note, noteNavigation, splitDocument, tagsOf, titleOf, welcomeLibrary, trashedNotes, selectedTags, queryNotes, effectiveTrashPurgeTime, pruneScopeBookmarks } from '../domain/library';
import { SaveQueue } from '../application/persistence';
import { themes, themeByID, resolveThemeID, SYSTEM_THEME, type ThemeDefinition } from '../domain/themes';
import { applyAppearance } from './appearance';
import { observeWindowDragRegion } from './window-drag';
import { DEFAULT_WINDOW_STYLE, resolveWindowStyle, type WindowStyle } from '../domain/window-style';
import { DEFAULT_PINNED } from '../domain/window-preferences';
import { EMPTY_SCOPE_PREFERENCES, normalizeScopePreferences, type ScopePreferences } from '../domain/scope-preferences';
import { normalizeTag } from '../domain/tags';
import { WindowStyleSaveQueue } from '../application/window-style-save';
import { DEFAULT_FONT_SIZE, resolveFontSize, stepFontSize } from '../domain/font-size';
import { DEFAULT_NOTE_FONT_STATE, resolveNoteFontState, type NoteFontState, type NoteFontSelection } from '../domain/note-font';
import { applyNoteFont } from './note-font';
import { PreferenceSaveQueue } from '../application/preference-save';
import { documentClipboardPayload, selectionClipboardPayload, type ClipboardPayload } from './clipboard';
import { createExplorerState, renderExplorerView, type ExplorerState } from './explorer-view';
import { renderProjectView, createProjectViewState } from './project-view';
import { createAppCommandHandler } from './app-commands';
import { installKeyboardShortcuts } from './app-events';
import { renderAppearanceTabs, renderGeneralSettings, renderWindowStyleSettings, type SettingsTab } from './settings-view';

import { attachmentMarkdown } from '../domain/managed-media';
import { applyCodeAppearance, renderCodeSettings, renderCodeLanguageSelector, highlightCodeHTML, syntaxThemeIDs, type SyntaxThemeID } from './code-highlighting';
import { renderSemanticSettings } from './semantic-search';
import type { SemanticStatus, SemanticNoteSnapshot } from '../application/semantic-contract';
import type { SemanticSearchPort } from '../application/ports';
import { SemanticIndexCoordinator } from '../application/semantic-indexing';
import { searchNotes } from '../application/note-search';
import { semanticSearch } from '../application/semantic-query';
import { buildNoteImageRequest, renderNoteImageExportControls, type NoteImageOptions, type NoteImageRequest } from './note-image';
import { LibraryCommands } from '../application/library-commands';
import { ScopeCommands } from '../application/scope-commands';
import { ProjectCommands } from '../application/project-commands';
import { LibrarySession } from '../application/session';
import { loadWorkspace } from '../application/workspace-query';
import type { AppCommand, Capabilities, ClipboardFormat, ClipboardContent, Clock, IdGenerator, LibraryRecoveryState, StartupState, HotkeyState } from '../application/ports';
import { findMatchesInText, noteFindMatches, selectNoteFindMatch, setNoteFind } from './note-find';
import { focusPrimaryView, trapFocusWithin } from './focus-management';
import { installThemeGridKeyboard, updateThemeGridTabStop } from './theme-grid';
import { plainInput } from './plain-input';
import { addTagToOpenNote, removeTagFromOpenNote } from './note-tag-actions';
import { renderNoteTagControls } from './note-tag-controls';
import { createScopeBar, type ScopeBarController, type ScopeBarOptions } from './scope-bar';
const app = document.querySelector<HTMLDivElement>('#app')!;
let capabilities: Capabilities;
let clock: Clock;
let ids: IdGenerator;
let libraryCommands: LibraryCommands;
let scopeCommands: ScopeCommands;
let projectCommands: ProjectCommands;
let scopePreferences: ScopePreferences = EMPTY_SCOPE_PREFERENCES;
let scopePreferenceQueue: PreferenceSaveQueue<ScopePreferences>;
let scopeBar: ScopeBarController | undefined;
let library: Library;
let librarySession: LibrarySession;
let editor: Editor | undefined;
type AppView = 'note' | 'explorer' | 'project' | 'help' | 'themes';
let view: AppView = 'note';
let themeID = SYSTEM_THEME;
let themeSaving = false;
let themeQuery = '';
let themeFilter: 'all' | 'light' | 'dark' = 'all';
let appearanceTab: SettingsTab = 'themes';
let ocrEnabled = false;
let syntaxThemeID: SyntaxThemeID = 'app';
let explorerState: ExplorerState;
const projectState = createProjectViewState();
let startupState: StartupState = { launchAtLogin: false, launchStatus: 'notRegistered', launchError: null, newNoteOnLaunch: false };
let hotkeyDisplay = '⌃⇧Space';
let hotkeyState: HotkeyState = { keyCode: 49, modifiers: (1 << 12) | (1 << 9), display: '⌃⇧Space', registered: false, available: false };
let findOpen = false;
let findQuery = '';
let findIndex = 0;
let findBar: HTMLElement | undefined;
let ocrReturnFocus: HTMLElement | null = null;
let renderedView: AppView | undefined;
let renderedAppearanceTab: SettingsTab | undefined;
const editorSelections = new Map<string, { anchor: number; head: number }>();
const sourceSelections = new Map<string, { start: number; end: number }>();
let imageOptions: NoteImageOptions = {};
let semanticSequence = 0;
let indexCoordinator: SemanticIndexCoordinator;
let explicitIndexRequests = 0;
let automaticIndexRunning = false;
let automaticIndexError = '';
let refreshSemanticSettings: (() => Promise<void>) | undefined;

let windowStyle: WindowStyle = { ...DEFAULT_WINDOW_STYLE };
let windowFocused = true;
let windowStyleQueue: WindowStyleSaveQueue;
let windowStyleStatus = '';
let windowStyleError = false;
let noteFonts = resolveNoteFontState(DEFAULT_NOTE_FONT_STATE);
let noteFontSelectionTask: Promise<NoteFontState> | undefined;
let noteFontWarning = '';
let fontSize = DEFAULT_FONT_SIZE;
let fontSizeQueue: PreferenceSaveQueue<number>;
let fontStatus = '';
let fontError = false;
let explorerMode: 'notes' | 'trash' = 'notes';
let sourceMode = false;
let markdownSourceTextarea: MarkdownSourceTextarea | undefined;
let contentLossNoteID: string | undefined;
let pinned = DEFAULT_PINNED;
let query = '';
let saveError = '';
let saveFailureNotice: HTMLElement | undefined;
let oversizedDraft: { noteID: string; markdown: string } | undefined;
let prefix = '';
let queue: SaveQueue;
let sessionLoaded = false;
let badgeElement: HTMLElement | undefined;
let contentElement: HTMLElement | undefined;
let counterElement: HTMLElement | undefined;
let activeEditorID: string | null = null;
let disposeDragRegion: (() => void) | undefined;
const commandsWaiting: AppCommand[] = [];
let disposeCommands: (() => void) | undefined;

function pinButtonLabel(isPinned: boolean, available: boolean): string {
  const state = !available ? 'Pin · available in the Mac app'
    : isPinned ? 'Unpin · hide when switching apps' : 'Pin · stay visible when switching apps';
  return `${state} · ⌘⇧P`;
}
function updatePinButton(pin: HTMLButtonElement, isPinned: boolean, available: boolean): void {
  pin.classList.toggle('active', isPinned);
  pin.setAttribute('aria-pressed', String(isPinned));
  pin.title = pinButtonLabel(isPinned, available);
  pin.setAttribute('aria-label', pin.title);
}
function updatePinnedState(isPinned: boolean): void {
  pinned = isPinned;
  const pin = app.querySelector<HTMLButtonElement>('[data-pin-toggle]');
  if (pin) updatePinButton(pin, isPinned, !!capabilities.window.pin);
}
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag); el.className = className; if (text !== undefined) el.textContent = text; return el;
}
function icon(node: IconNode, size = 17): SVGElement { return renderIcon(node, size); }
function button(label: string, node: IconNode | null, run: () => void | Promise<unknown>, className = 'icon-button', text?: string): HTMLButtonElement {
  const el = element('button', className); el.type = 'button'; el.title = label; el.setAttribute('aria-label', label);
  if (node) el.append(icon(node)); if (text) el.append(document.createTextNode(text));
  el.onclick = () => { try { Promise.resolve(run()).catch(showError); } catch (error) { showError(error); } }; return el;
}
function selected(): Note | undefined { return library.notes.find(note => note.id === library.selectedID && !note.trashedAt); }
function isTagPinned(tag: string): boolean { return scopePreferences.pinnedTags.includes(normalizeTag(tag)); }
function replaceLibrary(next: Library): void {
  if (librarySession) {
    const updatedPreferences = scopeCommands.rememberSelection(librarySession.library, next, scopePreferences);
    if (JSON.stringify(updatedPreferences.bookmarks) !== JSON.stringify(scopePreferences.bookmarks)) {
      scopePreferences = updatedPreferences; scopePreferenceQueue?.enqueue(scopePreferences);
    } else scopePreferences = updatedPreferences;
  }
  library = librarySession.replace(next);
}
function scopeBarOptions(): ScopeBarOptions {
  return {
    pinnedTags: scopePreferences.pinnedTags, activeTags: selectedTags(library), inTrash: view === 'explorer' && explorerState?.mode === 'trash',
    onAll: activateAllScope, onTag: activateTagScope, onClear: () => notebook(null),
    onTogglePin: togglePinnedTag, onMovePin: movePinnedTagBy,
    isPinned: tag => scopePreferences.pinnedTags.includes(normalizeTag(tag)), onError: showError,
  };
}
function updateScopePreferences(next: ScopePreferences): void {
  const normalized = normalizeScopePreferences(next);
  if (JSON.stringify(normalized) === JSON.stringify(scopePreferences)) return;
  scopePreferences = normalized; scopePreferenceQueue?.enqueue(scopePreferences); scopeBar?.update(scopeBarOptions());
}
function selectScope(tags: string[]): void {
  const result = scopeCommands.select(librarySession.library, tags, scopePreferences);
  updateScopePreferences(result.preferences);
  replaceLibrary(result.library); persist(); scopeBar?.update(scopeBarOptions());
}
function showExplorerForScope(): void {
  explorerMode = 'notes'; explorerState.mode = 'notes'; explorerState.selectedTags = selectedTags(library); explorerState.query = '';
  view = 'explorer'; render();
}
function activateAllScope(active: boolean): void {
  if (view === 'explorer' && explorerState.mode === 'trash') { showExplorerForScope(); return; }
  if (active) { showExplorerForScope(); return; }
  selectScope([]); query = ''; view = 'note'; render();
}
function activateTagScope(tag: string, active: boolean): void {
  if (active) { showExplorerForScope(); return; }
  selectScope([tag]); query = ''; view = 'note'; render();
}
function togglePinnedTag(tag: string): void {
  const pinnedTag = normalizeTag(tag);
  updateScopePreferences(scopePreferences.pinnedTags.includes(pinnedTag)
    ? scopeCommands.unpin(scopePreferences, pinnedTag) : scopeCommands.pin(scopePreferences, pinnedTag));
}
function movePinnedTagBy(tag: string, delta: number): void {
  updateScopePreferences(scopeCommands.move(scopePreferences, normalizeTag(tag), delta));
}
function goToScopeShortcut(position: number): void {
  if (position === 1) {
    if (selectedTags(library).length) selectScope([]);
  } else {
    const tag = scopePreferences.pinnedTags[position - 2];
    if (!tag) return;
    if (selectedTags(library).length !== 1 || selectedTags(library)[0] !== tag) selectScope([tag]);
  }
  query = ''; explorerMode = 'notes'; explorerState.mode = 'notes'; view = 'note'; render();
}
function persist(): void { queue.enqueue(librarySession.library); }
function showSaveFailure(): void {
  if (!saveError) return;
  saveFailureNotice = notify(saveError, true, { label: 'Retry', run: () => {
    // The queue reports retry failures through the same persistent notice.
    void queue.flush().catch(() => {});
  } });
}
function showError(error: unknown): void { notify(error instanceof Error ? error.message : String(error), true); }
function notify(message: string, error = false, action?: { label: string; run: () => void }): HTMLElement {
  document.querySelector('.transient-notice')?.remove();
  const notice = element('div', `notice transient-notice${error ? ' error' : ''}`);
  notice.setAttribute('role', error ? 'alert' : 'status');
  notice.append(element('span', '', message));
  if (action) notice.append(button(action.label, null, () => { notice.remove(); action.run(); }, 'text-button', action.label));
  notice.append(button('Dismiss message', X, () => notice.remove()));
  app.append(notice);
  if (!error) window.setTimeout(() => notice.remove(), 5000);
  return notice;
}
function showNoteSizeLimit(): void {
  if (app.querySelector('.note-limit-notice')) return;
  const notice = element('div', 'notice error note-limit-notice'); notice.setAttribute('role', 'alert');
  notice.append(element('span', '', "This note is larger than 2 MB and can't be saved. Move some content into another note."));
  app.append(notice);
}
function commitMarkdown(markdown: string): void {
  const id = activeEditorID;
  if (!id) return;
  const result = libraryCommands.edit(librarySession.library, id, markdown);
  if (result.kind === 'rejected') { oversizedDraft = { noteID: id, markdown }; showNoteSizeLimit(); return; }
  if (oversizedDraft?.noteID === id) oversizedDraft = undefined;
  app.querySelector('.note-limit-notice')?.remove();
  // Keep the working editor attached to its note even when an edit removes a scope tag.
  replaceLibrary({ ...result.library, selectedID: id });
  persist(); renderBadges(); renderCounter();
}
function disposeEditor(): void {
  if (editor && activeEditorID) editorSelections.set(activeEditorID, { anchor: editor.state.selection.anchor, head: editor.state.selection.head });
  editor?.destroy(); editor = undefined; activeEditorID = null;
}
function goNote(id?: string): void {
  if (id) { if (!library.notes.some(note => note.id === id && !note.trashedAt)) return; replaceLibrary({ ...library, selectedID: id }); persist(); }
  view = 'note'; render();
}
function newNote(): void {
  const result = libraryCommands.create(librarySession.library);
  if (result.kind === 'rejected') { notify(result.message, true); return; }
  replaceLibrary(result.library); persist(); sourceMode = false; goNote();
}
function move(delta: number): void {
  const next = libraryCommands.navigate(librarySession.library, delta);
  if (next.selectedID === library.selectedID) return;
  replaceLibrary(next); persist(); view = 'note'; render();
}
function notebook(tag: string | null, stayExplorer = false): void {
  selectScope(tag ? [tag] : []); query = '';
  explorerMode = 'notes'; if (explorerState) { explorerState.mode = 'notes'; explorerState.selectedTags = selectedTags(library); explorerState.query = ''; }
  view = stayExplorer ? 'explorer' : 'note'; render();
}
function flip(): void { explorerState.mode = 'notes'; view = view === 'explorer' || view === 'project' || view === 'themes' ? 'note' : 'explorer'; render(); }
function openThemes(tab?: SettingsTab): void { if (tab) appearanceTab = tab; else if (appearanceTab === 'export') appearanceTab = 'themes'; view = 'themes'; render(); }
function renderHeader(): void {
  const header = element('header', 'titlebar');
  header.setAttribute('aria-label', 'Note controls');
  const context = element('div', 'toolbar-context');
  if (view === 'themes' || view === 'help') {
    context.append(button('Back to note', ArrowLeft, () => goNote(), 'text-button', 'Back to note'));
  } else {
    scopeBar = createScopeBar(context, header, scopeBarOptions());
  }
  const spacer = element('div', 'toolbar-drag'); spacer.setAttribute('aria-hidden', 'true');
  const actions = element('div', 'header-actions');
  const pinCapability = capabilities.window.pin;
  const pin = button(pinButtonLabel(pinned, !!pinCapability), Pin, async () => {
    if (!pinCapability) return;
    updatePinnedState(await pinCapability.set(!pinned));
  });
  pin.dataset.pinToggle = '';
  updatePinButton(pin, pinned, !!pinCapability);
  pin.disabled = !pinCapability;
  actions.append(pin, button('Show notes · ⌘⇧E', BookOpen, flip), button('New note · ⌘N', Plus, newNote));
  if (view === 'note' && selected()) {
    const source = button(sourceMode ? 'Show formatted note · ⌘⇧M' : 'Edit Markdown source · ⌘⇧M', Code, () => { sourceMode = !sourceMode; render(); });
    source.classList.toggle('active', sourceMode); source.setAttribute('aria-pressed', String(sourceMode)); actions.append(source);
  }
  const settings = button('Settings · ⌘,', Settings, () => { if (view === 'themes' && appearanceTab !== 'export') goNote(); else openThemes(); });
  settings.classList.toggle('active', view === 'themes' && appearanceTab !== 'export'); settings.setAttribute('aria-pressed', String(view === 'themes' && appearanceTab !== 'export')); actions.append(settings);
  header.append(context, spacer, actions); app.append(header);
  if (capabilities.window.dragRegion) disposeDragRegion = observeWindowDragRegion(spacer, rect => { void capabilities.window.dragRegion!.set(rect).catch(showError); });
}
function noteTagEffects() {
  return {
    replaceLibrary,
    setMarkdownPrefix: (next: string, markdown: string) => {
      prefix = next;
      const area = sourceMode ? app.querySelector<HTMLTextAreaElement>('.source-editor') : null;
      if (!area) return;
      const current = splitDocument(area.value);
      const oldPrefix = current.frontmatter && !current.frontmatter.endsWith('\n') ? `${current.frontmatter}\n` : current.frontmatter;
      const start = area.selectionStart, end = area.selectionEnd;
      const mapOffset = (offset: number) => offset >= oldPrefix.length ? next.length + offset - oldPrefix.length : Math.min(offset, next.length);
      area.value = markdown;
      markdownSourceTextarea?.sync(markdown);
      area.setSelectionRange(mapOffset(start), mapOffset(end));
      if (activeEditorID) sourceSelections.set(activeEditorID, { start: area.selectionStart, end: area.selectionEnd });
    },
    persist,
    refreshBadges: renderBadges,
    focusEditor: () => editor ? editor.commands.focus() : app.querySelector<HTMLTextAreaElement>('.source-editor')?.focus(),
    renderNote: render,
  };
}
function removeNoteTag(noteID: string, tag: string): void {
  try {
    const result = removeTagFromOpenNote(libraryCommands, librarySession.library, noteID, tag, noteTagEffects());
    if (result.kind === 'rejected') throw new Error(result.message);
  } catch (error) { showError(error); }
}
function renderBadges(): void {
  if (!badgeElement) return;
  const note = selected(); if (!note) { badgeElement.replaceChildren(); return; }
  renderNoteTagControls(badgeElement, tagsOf(note.markdown), {
    onOverview: tag => openProject([tag]),
    onRemove: tag => removeNoteTag(note.id, tag),
    isPinned: isTagPinned, onPinToggle: togglePinnedTag, onError: showError,
  });
  badgeElement.append(button('Add a tag to this note', Plus, tagInput, 'add-tag', 'Tag'));
}
function tagInput(): void {
  const targetID = selected()?.id; if (!targetID || !badgeElement || badgeElement.querySelector('form')) return;
  const form = element('form', 'tag-form');
  const input = plainInput(element('input', 'tag-input')); input.placeholder = 'Tag name'; input.setAttribute('aria-label', 'New tag'); input.autocomplete = 'off';
  form.append(icon(Hash, 13), input, button('Cancel tag', X, () => { form.remove(); editor?.commands.focus(); }, 'tiny-button'));
  form.onsubmit = event => {
    event.preventDefault();
    if (library.selectedID !== targetID) return;
    try {
      const result = addTagToOpenNote(libraryCommands, librarySession.library, targetID, input.value, noteTagEffects());
      if (result.kind === 'rejected') throw new Error(result.message);
    } catch (error) { input.setCustomValidity((error as Error).message); input.reportValidity(); }
  };
  input.oninput = () => input.setCustomValidity('');
  input.onkeydown = event => { if (event.key === 'Escape') { event.stopPropagation(); form.remove(); editor?.commands.focus(); } };
  badgeElement.append(form); input.focus();
}
function editNoteLink(trigger?: HTMLElement): void {
  if (!editor || view !== 'note' || sourceMode) return;
  const existing = document.querySelector<HTMLInputElement>('.link-editor input[name="address"]');
  if (existing) { existing.focus(); existing.select(); return; }
  const anchor = trigger || app.querySelector<HTMLElement>('[aria-label="Link · ⌘K"]') || editor.view.dom;
  if (!openLinkEditor(editor, anchor)) notify('Select regular note text to make a link.');
}
function formattingActions(): { label: string; icon: IconNode; run: () => void; secondary?: boolean }[] {
  return [
    { label: 'Bold · ⌘B', icon: Bold, run: () => { editor?.chain().focus().toggleBold().run(); } },
    { label: 'Italic · ⌘I', icon: Italic, run: () => { editor?.chain().focus().toggleItalic().run(); } },
    { label: 'Link · ⌘K', icon: Link, run: () => editNoteLink() },
    { label: 'Heading', icon: Heading2, secondary: true, run: () => { editor?.chain().focus().toggleHeading({ level: 2 }).run(); } },
    { label: 'Bullet list', icon: List, run: () => { editor?.chain().focus().toggleBulletList().run(); } },
    { label: 'Task list', icon: ListTodo, run: () => { editor?.chain().focus().toggleTaskList().run(); } },
    { label: 'Quote', icon: Quote, secondary: true, run: () => { editor?.chain().focus().toggleBlockquote().run(); } },
    { label: 'Code block', icon: Braces, secondary: true, run: () => { editor?.chain().focus().toggleCodeBlock().run(); } },
  ];
}
function formatBar(): HTMLElement {
  const bar = element('div', 'format-bar'); bar.setAttribute('aria-label', 'Formatting'); bar.setAttribute('role', 'toolbar');
  for (const action of formattingActions()) {
    const control = button(action.label, action.icon, action.run, `format-button${action.secondary ? ' format-secondary' : ''}`);
    control.onmousedown = event => event.preventDefault(); bar.append(control);
  }
  return bar;
}
function renderNoteFindBar(): HTMLElement {
  const bar = element('div', 'note-find search-field');
  bar.append(icon(Search));
  const input = plainInput(element('input', 'note-find-input')); input.type = 'search'; input.placeholder = 'Find in note…'; input.setAttribute('aria-label', 'Find in note'); input.value = findQuery;
  const count = element('span', 'note-find-count'); count.setAttribute('role', 'status'); count.setAttribute('aria-live', 'polite'); count.setAttribute('aria-atomic', 'true');
  const previous = button('Previous match · ⇧↵', ChevronUp, () => navigateNoteFind(-1), 'icon-button note-find-step');
  const next = button('Next match · ↵', ChevronDown, () => navigateNoteFind(1), 'icon-button note-find-step');
  const close = button('Close find · Esc', X, closeNoteFind, 'icon-button note-find-close');
  input.oninput = () => { findQuery = input.value; findIndex = 0; updateNoteFind(); };
  input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); navigateNoteFind(event.shiftKey ? -1 : 1); } };
  bar.append(input, count, previous, next, close); return bar;
}
function updateNoteFind(selectMatch = true): void {
  const count = findBar?.querySelector<HTMLElement>('.note-find-count');
  let matches = [] as ReturnType<typeof findMatchesInText>;
  if (sourceMode) {
    const source = app.querySelector<HTMLTextAreaElement>('.source-editor');
    matches = source ? findMatchesInText(source.value, findQuery) : [];
    if (matches.length) {
      findIndex = ((findIndex % matches.length) + matches.length) % matches.length;
      const match = matches[findIndex]; if (selectMatch) source?.setSelectionRange(match.from, match.to);
    } else findIndex = 0;
  } else if (editor) {
    matches = setNoteFind(editor, findQuery, findIndex);
    findIndex = matches.length ? ((findIndex % matches.length) + matches.length) % matches.length : 0;
    if (selectMatch && matches[findIndex]) selectNoteFindMatch(editor, matches[findIndex]);
  }
  if (count) count.textContent = matches.length ? `${findIndex + 1} of ${matches.length}` : findQuery ? 'No matches' : '';
}
function navigateNoteFind(direction: -1 | 1): void {
  const source = sourceMode ? app.querySelector<HTMLTextAreaElement>('.source-editor') : null;
  const matches = source ? findMatchesInText(source.value, findQuery) : editor ? noteFindMatches(editor.state.doc, findQuery) : [];
  if (!matches.length) return;
  findIndex = (findIndex + direction + matches.length) % matches.length;
  if (editor && !sourceMode) { setNoteFind(editor, findQuery, findIndex); selectNoteFindMatch(editor, matches[findIndex]); }
  if (source) source.setSelectionRange(matches[findIndex].from, matches[findIndex].to);
  updateNoteFind();
  findBar?.querySelector<HTMLInputElement>('.note-find-input')?.focus();
}
function openNoteFind(): void {
  if (view !== 'note' || !selected()) return;
  if (findOpen) { findBar?.querySelector<HTMLInputElement>('.note-find-input')?.focus(); return; }
  findOpen = true; findIndex = 0;
  findQuery = sourceMode ? (() => { const source = app.querySelector<HTMLTextAreaElement>('.source-editor'); return source?.value.slice(source.selectionStart, source.selectionEnd) ?? ''; })()
    : editor && !editor.state.selection.empty ? editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, ' ') : '';
  findBar = renderNoteFindBar();
  const tags = app.querySelector('.note-tags');
  if (tags) tags.after(findBar);
  else contentElement?.prepend(findBar);
  updateNoteFind();
  findBar.querySelector<HTMLInputElement>('.note-find-input')?.focus();
  findBar.querySelector<HTMLInputElement>('.note-find-input')?.select();
}
function closeNoteFind(): void {
  if (!findOpen) return;
  findOpen = false; findQuery = ''; findIndex = 0; findBar?.remove(); findBar = undefined;
  if (editor) { setNoteFind(editor, ''); editor.commands.focus(); }
  else if (sourceMode) app.querySelector<HTMLTextAreaElement>('.source-editor')?.focus();
}
function reflectSourceModeButton(): void {
  const source = app.querySelector<HTMLButtonElement>('[aria-label="Edit Markdown source · ⌘⇧M"], [aria-label="Show formatted note · ⌘⇧M"]');
  if (!source) return;
  const label = sourceMode ? 'Show formatted note · ⌘⇧M' : 'Edit Markdown source · ⌘⇧M';
  source.title = label; source.setAttribute('aria-label', label); source.setAttribute('aria-pressed', String(sourceMode));
  source.classList.toggle('active', sourceMode);
}
function renderNote(): void {
  const note = selected();
  contentElement = element('main', 'note-side');
  if (!note) {
    const empty = element('div', 'empty-state'); empty.append(icon(BookOpen, 30), element('h1', '', library.activeTag ? `#${library.activeTag}` : 'No notes'), element('p', '', 'Create a note to get started.'), button('Create a note', Plus, newNote, 'primary-button', 'New note'));
    contentElement.append(empty); app.append(contentElement); return;
  }
  badgeElement = element('div', 'note-tags quiet-scroll'); renderBadges(); contentElement.append(badgeElement);
  findBar = undefined;
  if (findOpen) { findBar = renderNoteFindBar(); contentElement.append(findBar); }
  const markdown = oversizedDraft?.noteID === note.id ? oversizedDraft.markdown : note.markdown;
  const parts = splitDocument(markdown); prefix = parts.frontmatter; activeEditorID = note.id;
  if (prefix && !prefix.endsWith('\n')) prefix += '\n';
  if (parts.error) { sourceMode = true; reflectSourceModeButton(); }
  let editorMount: HTMLElement | undefined;
  if (!sourceMode) {
    editorMount = element('div', 'editor-mount');
    const candidate = createMarkdownEditor(editorMount, parts.body, markdown => commitMarkdown(prefix + markdown), (_editor, anchor) => editNoteLink(anchor));
    const guarded = guardMarkdownEditor(parts.body, candidate);
    if (guarded.kind === 'source') {
      editorMount = undefined;
      sourceMode = true; contentLossNoteID = note.id;
      reflectSourceModeButton();
    } else {
      editor = guarded.editor;
      if (contentLossNoteID === note.id) contentLossNoteID = undefined;
    }
  }
  if (parts.error) contentElement.append(element('div', 'inline-warning', parts.error));
  if (sourceMode && contentLossNoteID === note.id) contentElement.append(element('div', 'inline-warning', "Some of this note couldn't be shown in the editor. Showing Markdown."));
  if (sourceMode) {
    const label = element('div', 'source-label', 'Markdown source' );
    const area = element('textarea', 'source-editor quiet-scroll'); area.setAttribute('aria-label', 'Markdown source'); area.value = markdown; area.spellcheck = false;
    const savedSourceSelection = sourceSelections.get(note.id); if (savedSourceSelection) area.setSelectionRange(Math.min(savedSourceSelection.start, area.value.length), Math.min(savedSourceSelection.end, area.value.length));
    const rememberSourceSelection = () => sourceSelections.set(note.id, { start: area.selectionStart, end: area.selectionEnd });
    area.addEventListener('select', rememberSourceSelection); area.addEventListener('keyup', rememberSourceSelection); area.addEventListener('click', rememberSourceSelection);
    markdownSourceTextarea = bindMarkdownSourceTextarea(area, markdown, source => {
      rememberSourceSelection(); commitMarkdown(source); if (findOpen) updateNoteFind(false);
    });
    contentElement.append(label, area);
    app.append(contentElement); requestAnimationFrame(() => findOpen ? findBar?.querySelector<HTMLInputElement>('.note-find-input')?.focus() : area.focus());
    if (findOpen) updateNoteFind();
  } else {
    const noteEditor = editor!;
    const scroll = element('div', 'editor-scroll quiet-scroll'); scroll.append(editorMount!); contentElement.append(scroll); app.append(contentElement);
    const saved = editorSelections.get(note.id);
    if (saved) {
      const end = noteEditor.state.doc.content.size;
      const from = Math.min(end, Math.min(saved.anchor, saved.head)), to = Math.min(end, Math.max(saved.anchor, saved.head));
      try { noteEditor.commands.setTextSelection({ from, to }); } catch { noteEditor.commands.setTextSelection(0); }
    }
    noteEditor.on('selectionUpdate', () => {
      if (editor && activeEditorID) editorSelections.set(activeEditorID, { anchor: editor.state.selection.anchor, head: editor.state.selection.head });
      refreshCodeTools();
    });
    noteEditor.on('update', () => { refreshCodeTools(); if (findOpen) updateNoteFind(false); }); refreshCodeTools();
    if (findOpen) updateNoteFind();
    requestAnimationFrame(() => findOpen ? findBar?.querySelector<HTMLInputElement>('.note-find-input')?.focus() : editor?.commands.focus());
  }
}
function discardNote(id: string): void {
  if (!library.notes.some(note => note.id === id && !note.trashedAt)) return;
  const scroll = app.querySelector('.note-list')?.scrollTop || 0;
  replaceLibrary(libraryCommands.trash(librarySession.library, id)); persist(); render();
  const list = app.querySelector('.note-list'); if (list) list.scrollTop = scroll;
  notify('Note moved to Trash', false, { label: 'Undo', run: () => recoverNote(id) });
}
function recoverNote(id: string): void {
  replaceLibrary(libraryCommands.restore(librarySession.library, id)); persist(); render(); notify('Note restored');
}
function renderExplorer(): void {
  explorerState.selectedTags = selectedTags(library);
  const changed = (next: Library, message: string) => { replaceLibrary(next); explorerState.selectedIDs.clear(); persist(); render(); notify(message); };
  app.append(renderExplorerView({ library, state: explorerState, now: effectiveTrashPurgeTime(library, clock.now()),
    onOpenNote: id => goNote(id), onModeChange: () => { renderHeaderScope(); announceView(); },
    onScopeChange: tags => { selectScope(tags); renderHeaderScope(); },
    onTrash: ids => { changed(libraryCommands.trashMany(librarySession.library, ids), `${ids.length} ${ids.length === 1 ? 'note' : 'notes'} moved to Trash · recoverable for 30 days`); notify('Moved to Trash · recoverable for 30 days', false, { label: 'Undo', run: () => changed(libraryCommands.restoreMany(librarySession.library, ids), 'Notes restored') }); },
    onRestore: ids => changed(libraryCommands.restoreMany(librarySession.library, ids), 'Notes restored'),
    onArchive: ids => { try { changed(libraryCommands.archiveMany(librarySession.library, ids), 'Notes archived' ); } catch (error) { showError(error); } },
    onTag: (ids, tag) => { try { changed(libraryCommands.tagMany(librarySession.library, ids, tag), `Added #${tag.replace(/^#/, '')}`); } catch (error) { showError(error); } },
    onOverview: tags => openProject(tags), isPinned: isTagPinned, onPinToggle: togglePinnedTag,
    onSearch: async (text, candidates) => {
      const sequence = ++semanticSequence; await new Promise(resolve => setTimeout(resolve, 250));
      return searchNotes(text, candidates, {
        status: () => capabilities.semanticSearch.status(),
        prepareIndex: () => indexCoordinator.refresh(librarySession.library.notes),
        semanticSearch: async (query, ids) => (await semanticSearch(capabilities.semanticSearch, query, ids)).map(hit => hit.id),
      }, () => sequence === semanticSequence);
    }, onConfigureSearch: () => openThemes('search'), onError: showError,
  }));
}
function renderHeaderScope(): void {
  scopeBar?.update(scopeBarOptions()); renderCounter();
}
function openProject(tags = selectedTags(library)): void {
  selectScope(tags); explorerState.selectedTags = selectedTags(library); view = 'project'; render();
}
function renderProject(): void {
  const main = element('main', 'project-side'); main.append(element('h1', 'project-title', selectedTags(library).length ? selectedTags(library).map(tag => `#${tag}`).join(' · ') : 'All notes'));
  main.append(renderProjectView({ notes: queryNotes(library, { sort: 'edited' }), state: projectState, onError: showError, onOpenNote: goNote,
    onToggleTask: (task, checked) => {
      const result = projectCommands.toggleTask(librarySession.library, task, checked);
      if (!result.ok) { render(); throw new Error('That task changed. The overview has been refreshed; try again.'); }
      replaceLibrary(result.library); persist(); render();
    }, onOCR: ocrEnabled ? async media => { try { await recognizeImage(media.url, media.noteID); } catch (error) { showError(error); } } : undefined,
    onOpenMedia: async media => { try { await capabilities.attachments?.open(media.url); } catch (error) { showError(error); } },
  })); app.append(main);
}
function dateLabel(value: string): string {
  const date = new Date(value); const today = new Date();
  return date.toDateString() === today.toDateString() ? 'Today' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function refreshThemeSelection(): void {
  app.querySelectorAll<HTMLButtonElement>('.theme-option').forEach(option => {
    const selected = option.dataset.themeId === themeID;
    option.classList.toggle('selected', selected);
    option.setAttribute('aria-checked', String(selected));
    option.setAttribute('aria-disabled', String(themeSaving));
    option.tabIndex = -1;
  });
  const grid = app.querySelector<HTMLElement>('.theme-grid'); if (grid) updateThemeGridTabStop(grid, themeID);
  const status = app.querySelector<HTMLElement>('.theme-status');
  if (status) status.textContent = themeSaving ? 'Saving appearance…' : `${themeByID(themeID)?.name || 'Follow macOS'} · ${capabilities.presentation.savedLabel}`;
  app.querySelector('.themes-side')?.setAttribute('aria-busy', String(themeSaving));
}
async function chooseTheme(id: string): Promise<void> {
  if (themeSaving || id === themeID) return;
  if (resolveThemeID(id) !== id) throw new Error('That theme is not available.');
  themeSaving = true; refreshThemeSelection();
  try {
    const saved = await capabilities.appearance.saveTheme(id);
    if (saved.themeID !== id) throw new Error('The theme could not be confirmed. Try again.');
    themeID = applyAppearance(document.documentElement, id); applySyntaxAppearance();
  } finally { themeSaving = false; refreshThemeSelection(); }
}
function semanticSettingsPort(): SemanticSearchPort {
  const backend = capabilities.semanticSearch;
  const invalidate = () => { semanticSequence++; indexCoordinator.invalidate(); automaticIndexError = ''; if (explorerState) explorerState.searchResult = null; };
  return {
    status: () => backend.status(), search: (query, ids) => backend.search(query, ids),
    index: async (notes, force) => {
      explicitIndexRequests++;
      try { return await indexCoordinator.refresh(notes, force); }
      finally { explicitIndexRequests--; }
    },
    configuration: {
      set: async configuration => { invalidate(); const status = await backend.configuration.set(configuration); if (configuration.enabled) indexCoordinator.schedule(librarySession.library.notes, true); return status; },
      startRuntime: async () => { await backend.configuration.startRuntime(); indexCoordinator.schedule(librarySession.library.notes, true); },
      downloadModel: async model => { await backend.configuration.downloadModel(model); indexCoordinator.schedule(librarySession.library.notes, true); },
      clearIndex: async () => { invalidate(); await backend.configuration.clearIndex(); },
      cancel: async () => { invalidate(); await backend.configuration.cancel(); },
    },
  };
}
function applySyntaxAppearance(): void { applyCodeAppearance(document.documentElement, syntaxThemeID, themeID, matchMedia('(prefers-color-scheme: dark)').matches); }
function refreshCodeTools(): void {
  const tools = app.querySelector<HTMLElement>('.code-tools'); if (!tools || !editor) return;
  tools.hidden = !editor.isActive('codeBlock');
  const formatting = app.querySelector<HTMLElement>('.format-bar'); if (formatting) formatting.hidden = !tools.hidden;
  if (tools.hidden) return;
  const language = editor.getAttributes('codeBlock').language || null;
  if (tools.dataset.language === String(language) && tools.childElementCount) return;
  tools.dataset.language = String(language); tools.replaceChildren(renderCodeLanguageSelector({ language, onSelect: value => { editor?.chain().focus().updateAttributes('codeBlock', { language: value }).run(); } }));
}
async function chooseSyntaxTheme(id: SyntaxThemeID): Promise<void> {
  try {
    await capabilities.appearance.saveSyntaxTheme(id);
    syntaxThemeID = id; applySyntaxAppearance();
  } catch (error) { showError(error); throw error; }
}
function insertIntoNote(id: string, markdown: string): void {
  const note = library.notes.find(note => note.id === id && !note.trashedAt);
  if (!note) throw new Error('The target note is no longer active. Restore it before inserting content.');
  if (view === 'note' && activeEditorID === id && editor) editor.chain().focus().insertContent(markdownParserInput(markdown), { contentType: 'markdown' }).run();
  else if (view === 'note' && activeEditorID === id && sourceMode) {
    const area = app.querySelector<HTMLTextAreaElement>('.source-editor')!; area.setRangeText(markdown, area.selectionStart, area.selectionEnd, 'end'); commitMarkdown(area.value); area.focus();
  } else {
    const result = libraryCommands.edit(librarySession.library, id, `${note.markdown}${note.markdown.endsWith('\n') ? '\n' : '\n\n'}${markdown}\n`);
    if (result.kind === 'rejected') throw new Error(result.message);
    replaceLibrary(result.library); persist();
  }
}
async function pickAttachments(): Promise<void> {
  const id = selected()?.id; if (!id) return;
  if (!capabilities.attachments) throw new Error('Managed local attachments are unavailable in this preview.');
  const records = await capabilities.attachments.pick();
  if (!records?.length) return;
  insertIntoNote(id, records.map(attachmentMarkdown).join('\n\n')); notify('Attachments saved locally');
}
async function importDroppedFiles(files: File[], id: string): Promise<void> {
  if (!capabilities.attachments) throw new Error('Managed local attachments are unavailable in this preview.');
  notify(`Importing ${files.length} ${files.length === 1 ? 'attachment' : 'attachments'}…`);
  const records = await capabilities.attachments.import(files);
  insertIntoNote(id, records.map(attachmentMarkdown).join('\n\n')); notify('Attachments saved locally');
}
async function recognizeImage(url?: string, targetID = selected()?.id): Promise<void> {
  if (!ocrEnabled) throw new Error('Enable local image text recognition in General settings first.');
  if (!capabilities.ocr) throw new Error('Image text recognition is unavailable in this preview.');
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const result = await capabilities.ocr.recognize(url);
  if (result.cancelled) { if (returnFocus?.isConnected) returnFocus.focus(); return; }
  const text = result.text; ocrReturnFocus = returnFocus; const dialog = element('section', 'ocr-result'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', 'Recognized image text');
  dialog.append(element('h2', '', 'Recognized text'));
  const area = element('textarea'); area.value = text; area.setAttribute('aria-label', 'Recognized text to copy or insert'); dialog.append(area);
  const actions = element('div', 'ocr-result-actions');
  actions.append(button('Close recognized text', null, closeOCRDialog, 'text-button', 'Close'), button('Copy recognized text', Clipboard, () => writeClipboard({ text: area.value }), 'text-button', 'Copy'));
  if (targetID) actions.append(button('Insert recognized text into source note', Plus, () => {
    const target = library.notes.find(note => note.id === targetID && !note.trashedAt); if (!target) throw new Error('The source note is no longer active.');
    if (editor && activeEditorID === targetID) {
      editor.chain().focus().insertContent(area.value.split(/\r?\n/).map(line => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] }))).run();
    } else insertIntoNote(targetID, area.value);
    closeOCRDialog();
  }, 'text-button', 'Insert into note'));
  dialog.append(actions); app.append(dialog); area.focus();
  dialog.onkeydown = event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeOCRDialog(); }
    if (event.key === 'Tab') trapFocusWithin(event, dialog);
  };
}
function closeOCRDialog(): void {
  app.querySelector('.ocr-result')?.remove();
  const target = ocrReturnFocus; ocrReturnFocus = null;
  if (target?.isConnected) target.focus(); else if (editor && view === 'note') editor.commands.focus();
}
function currentImageRequest(): NoteImageRequest {
  const note = selected(); if (!note) throw new Error('Open a note to export it.');
  const colors = themeByID(themeID)?.colors;
  const html = highlightCodeHTML(documentClipboardPayload(note.markdown, 'formatted').html || '<p></p>', syntaxThemeID, themeID, matchMedia('(prefers-color-scheme: dark)').matches);
  return buildNoteImageRequest(note.markdown, { ...imageOptions, paper: colors?.paper, text: colors?.ink, accent: colors?.accent, html }, titleOf(note.markdown));
}
async function exportImageRequest(request: NoteImageRequest): Promise<boolean> {
  if (!capabilities.pngExport) throw new Error('PNG export is unavailable in this preview.');
  await Promise.all([queue.flush(), fontSizeQueue.flush(), noteFontSelectionTask]);
  const result = await capabilities.pngExport.export(request);
  return result.exported;
}
async function exportCurrentPNG(): Promise<void> { await exportImageRequest(currentImageRequest()); }
function chooseNoteFont(selection: NoteFontSelection): Promise<NoteFontState> {
  const pending = noteFontSelectionTask;
  const task = (async () => {
    if (pending) await pending.catch(() => {});
    const previous = noteFonts;
    const desired = resolveNoteFontState({ ...noteFonts, selection });
    const saved = await capabilities.typography.selectNoteFont(desired.selection);
    try { await applyNoteFont(document.documentElement, saved); }
    catch (error) {
      await capabilities.typography.selectNoteFont(previous.selection);
      await applyNoteFont(document.documentElement, previous);
      if (view !== 'themes' || appearanceTab !== 'window') showError(error);
      throw error;
    }
    noteFonts = saved;
    return noteFonts;
  })();
  noteFontSelectionTask = task;
  const settled = () => { if (noteFontSelectionTask === task) noteFontSelectionTask = undefined; };
  void task.then(settled, settled); return task;
}
async function downloadNoteFont(family: string): Promise<{ fontState: NoteFontState; downloadedFontID: string }> {
  if (!capabilities.typography.downloadFont) throw new Error('Font downloads are unavailable in this preview.');
  const result = await capabilities.typography.downloadFont.download(family);
  noteFonts = resolveNoteFontState(result.fontState);
  return result;
}
function applyFontSize(): void {
  document.documentElement.style.setProperty('--note-font-size', `${fontSize}px`);
  const sizeControl = app.querySelector<HTMLSelectElement>('[data-font-size]'); if (sizeControl) sizeControl.value = String(fontSize);
  const status = app.querySelector<HTMLElement>('.font-save-status'); if (status) { status.textContent = fontStatus; status.hidden = !fontError; status.classList.toggle('save-error', fontError); }
}
function changeFontSize(value: number): void {
  const next = resolveFontSize(value); if (next === fontSize) return;
  fontSize = next; applyFontSize(); fontSizeQueue.enqueue(fontSize);
}
function hasCopySelection(): boolean {
  if (editor && !editor.state.selection.empty) return true;
  const source = app.querySelector<HTMLTextAreaElement>('.source-editor'); return !!source && source.selectionStart !== source.selectionEnd;
}
async function writeClipboard(content: ClipboardPayload): Promise<void> { await capabilities.clipboard.write(content); }
async function copyNote(format: ClipboardFormat, whole = false): Promise<void> {
  const note = selected(); if (view !== 'note' || !note) { notify('Open a note to copy it.'); return; }
  let content: ClipboardPayload | null = !whole && editor ? selectionClipboardPayload(editor, format) : null;
  const source = app.querySelector<HTMLTextAreaElement>('.source-editor');
  if (!content && !whole && source && source.selectionStart !== source.selectionEnd) content = documentClipboardPayload(source.value.slice(source.selectionStart, source.selectionEnd), format);
  content ??= documentClipboardPayload(note.markdown, format);
  if (content.html) content.html = highlightCodeHTML(content.html, syntaxThemeID, themeID, matchMedia('(prefers-color-scheme: dark)').matches);
  if (format === 'html') content.text = highlightCodeHTML(content.text, syntaxThemeID, themeID, matchMedia('(prefers-color-scheme: dark)').matches);
  if (!content.text && !content.html) { notify('This note is empty.'); return; }
  await writeClipboard(content);
  notify(`Copied ${format === 'formatted' ? 'formatted text' : format === 'html' ? 'HTML source' : format === 'text' ? 'plain text' : 'Markdown'}`);
}
function openCopyMenu(trigger: HTMLButtonElement): void {
  const selection = hasCopySelection();
  openActionMenu(trigger, [
    ...([['markdown', 'Markdown'], ['formatted', 'Formatted text'], ['html', 'HTML source'], ['text', 'Plain text']] as const).map(([format, label]) => ({ label, run: () => copyNote(format) })),
    ...(selection ? [{ separator: true } as const, { label: 'Entire note as Markdown', run: () => copyNote('markdown', true) }] : []),
  ], { label: selection ? 'Copy selection as' : 'Copy note as', onError: showError });
}
function noteActionsButton(className: string): HTMLButtonElement {
  const more = button('Note actions', Ellipsis, () => {
    const id = selected()?.id; if (!id) return;
    openActionMenu(more, [
      ...(!sourceMode ? [{ label: 'Formatting…', icon: Bold, run: () => openActionMenu(more, formattingActions(), { label: 'Formatting', onError: showError }) }] : []),
      { label: hasCopySelection() ? 'Copy selection as…' : 'Copy note as…', icon: Clipboard, run: () => openCopyMenu(more) },
      { label: 'Add tag…', icon: Hash, run: tagInput },
      ...(capabilities.attachments ? [{ label: 'Attach file…', icon: Paperclip, run: pickAttachments }] : []),
      ...(ocrEnabled ? [{ label: 'Recognize image text…', icon: ScanText, run: () => recognizeImage() }] : []),
      { separator: true },
      { label: 'Export PNG…', icon: Camera, run: () => openThemes('export') },
      { label: 'Archive note', icon: Archive, run: () => { replaceLibrary(libraryCommands.archiveMany(librarySession.library, [id])); persist(); render(); notify('Note archived'); } },
      { label: 'Move to Trash', icon: Trash2, danger: true, shortcut: '⌘⌫', run: () => discardNote(id) },
    ], { label: 'Note actions', onError: showError });
  }, className);
  more.setAttribute('aria-haspopup', 'menu'); return more;
}
function applyWindowState(): void {
  document.documentElement.dataset.focused = String(windowFocused); if (!windowFocused) closePopover();
  // The real app uses NSPanel compositing; preview opacity is only an approximation.
  const previewOpacity = capabilities.windowStyle.previewOpacity(windowFocused, windowStyle);
  if (previewOpacity === null) document.documentElement.style.removeProperty('opacity');
  else document.documentElement.style.opacity = String(previewOpacity);
}
function refreshWindowStyleControls(): void {
  for (const field of ['focusedOpacity', 'unfocusedOpacity', 'glass'] as const) {
    const input = app.querySelector<HTMLInputElement>(`input[data-window-style='${field}']`);
    const value = Math.round(windowStyle[field] * 100);
    if (input) { input.value = String(value); input.setAttribute('aria-valuetext', `${value} percent`); }
    const output = app.querySelector<HTMLOutputElement>(`output[data-window-style='${field}']`);
    if (output) output.value = `${value}%`;
  }
  const status = app.querySelector<HTMLElement>('.effects-save-status');
  if (status) { status.textContent = windowStyleStatus; status.hidden = !windowStyleError; status.classList.toggle('save-error', windowStyleError); }
}
function changeWindowStyle(style: WindowStyle): void {
  windowStyle = resolveWindowStyle(style);
  applyWindowState(); refreshWindowStyleControls(); windowStyleQueue.enqueue(windowStyle);
}
function renderThemes(): void {
  const main = element('main', 'themes-side');
  const heading = element('div', 'themes-heading'); const title = element('h1', '', appearanceTab === 'export' ? 'Export PNG' : 'Settings'); title.id = 'settings-title'; heading.append(title);
  if (appearanceTab === 'themes') heading.append(element('span', 'theme-total', `${themes.length} themes`));
  main.append(heading); if (appearanceTab !== 'export') main.append(renderAppearanceTabs(appearanceTab, tab => { appearanceTab = tab; }, render, app));
  if (appearanceTab === 'window') {
    main.append(renderWindowStyleSettings({ noteFonts, fontSize, windowStyle, windowFocused, windowStyleStatus, windowStyleError, capabilities, fontSizeQueue, windowStyleQueue, onSelectNoteFont: chooseNoteFont, onDownloadFont: capabilities.typography.downloadFont ? downloadNoteFont : undefined, onCancelDownload: capabilities.typography.downloadFont ? async () => { await capabilities.typography.downloadFont!.cancel(); } : undefined, onChangeFontSize: changeFontSize, onChangeWindowStyle: changeWindowStyle, onError: showError })); app.append(main); refreshWindowStyleControls(); applyFontSize(); return;
  }
  if (appearanceTab !== 'themes') {
    let panel: HTMLElement;
    if (appearanceTab === 'general') panel = renderGeneralSettings({ capabilities, startup: startupState, onStartupChanged: next => { startupState = next; }, hotkey: hotkeyState, onHotkeyChanged: next => { hotkeyState = next; hotkeyDisplay = next.display; }, ocrEnabled, onOCREnabled: enabled => { ocrEnabled = enabled; }, onError: showError });
    else if (appearanceTab === 'code') {
      panel = element('section', 'settings-panel code-settings-panel quiet-scroll side-scroll'); panel.append(renderCodeSettings({ selectedID: syntaxThemeID, appThemeID: themeID, onSelect: chooseSyntaxTheme }));
    } else if (appearanceTab === 'search') {
      panel = element('section', 'settings-panel quiet-scroll side-scroll'); panel.append(renderSemanticSettings({ search: semanticSettingsPort(), getNotes: () => librarySession.library.notes, automaticIndex: () => ({ running: automaticIndexRunning, error: automaticIndexError }), registerRefresh: refresh => { refreshSemanticSettings = refresh; } }));
    } else {
      panel = element('section', 'settings-panel image-settings-panel quiet-scroll side-scroll');
      if (selected()) panel.append(renderNoteImageExportControls({ request: currentImageRequest(), canExport: !!capabilities.pngExport, onExport: async request => {
        imageOptions = { ...imageOptions, width: request.width, padding: request.padding, gradient: request.backgroundStart === '#f6d6b8' ? 'dawn' : request.backgroundStart === '#c4e7ed' ? 'ocean' : 'lavender' };
        try { await capabilities.imagePreferences.save({ ...imageOptions }); return await exportImageRequest(request); }
        catch (error) { showError(error); return false; }
      } }));
      else panel.append(element('p', 'settings-description', 'Open or create a note first to preview its image.'));
    }
    panel.id = 'appearance-content'; panel.setAttribute('role', appearanceTab === 'export' ? 'group' : 'tabpanel'); panel.setAttribute('aria-labelledby', appearanceTab === 'export' ? 'settings-title' : `appearance-tab-${appearanceTab}`); main.append(panel); app.append(main); return;
  }
  const search = element('div', 'search-field'); const input = plainInput(element('input')); input.type = 'search'; input.placeholder = 'Search themes…'; input.setAttribute('aria-label', 'Search themes'); input.value = themeQuery;
  search.append(icon(Search), input); main.append(search);
  const filters = element('div', 'theme-filters'); filters.setAttribute('aria-label', 'Theme appearance');
  const gridPanel = element('div', 'theme-grid-panel'); gridPanel.id = 'appearance-content'; gridPanel.setAttribute('role', 'tabpanel'); gridPanel.setAttribute('aria-labelledby', 'appearance-tab-themes');
  const grid = element('div', 'theme-grid quiet-scroll side-scroll'); grid.setAttribute('aria-label', 'Available themes'); grid.setAttribute('role', 'radiogroup'); gridPanel.append(grid);
  const matches = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
  const themeOption = (theme?: ThemeDefinition): HTMLButtonElement => {
    const id = theme?.id || SYSTEM_THEME;
    const option = button(`Use ${theme?.name || 'Follow macOS'} theme`, null, () => chooseTheme(id), 'theme-option');
    option.dataset.themeId = id; option.setAttribute('role', 'radio');
    const preview = element('div', `theme-preview${theme ? '' : ' system-preview'}`); preview.setAttribute('aria-hidden', 'true');
    if (theme) {
      preview.style.setProperty('--preview-paper', theme.colors.paper); preview.style.setProperty('--preview-ink', theme.colors.ink);
      preview.style.setProperty('--preview-muted', theme.colors.muted); preview.style.setProperty('--preview-accent', theme.colors.accent);
    }
    preview.append(element('span', 'preview-title', 'Project notes'), element('span', 'preview-line'), element('span', 'preview-line short'));
    const info = element('div', 'theme-info'); const words = element('div', 'theme-words');
    words.append(element('span', 'theme-name', theme?.name || 'Follow macOS'), element('span', 'theme-kind', theme ? (theme.appearance === 'dark' ? 'Dark' : 'Light') : 'System appearance'));
    const chosen = element('span', 'theme-chosen'); chosen.append(icon(Check, 16)); chosen.setAttribute('aria-hidden', 'true');
    info.append(words, chosen); option.append(preview, info); return option;
  };
  const draw = () => {
    grid.replaceChildren();
    if (themeFilter === 'all' && (!themeQuery || matches('Follow macOS system automatic').includes(matches(themeQuery.trim())))) grid.append(themeOption());
    for (const theme of themes) {
      if ((themeFilter === 'all' || theme.appearance === themeFilter) && matches(theme.name).includes(matches(themeQuery.trim()))) grid.append(themeOption(theme));
    }
    if (!grid.children.length) grid.append(element('p', 'themes-empty', 'No matching themes. Try another name or choose All.'));
    refreshThemeSelection();
  };
  for (const [id, label] of [['all', 'All'], ['light', 'Light'], ['dark', 'Dark']] as const) {
    const filter = button(`Show ${label.toLowerCase()} themes`, null, () => {
      themeFilter = id;
      filters.querySelectorAll('button').forEach(el => { const active = el === filter; el.classList.toggle('selected', active); el.setAttribute('aria-pressed', String(active)); });
      draw();
    }, `filter-chip${themeFilter === id ? ' selected' : ''}`, label);
    filter.setAttribute('aria-pressed', String(themeFilter === id)); filters.append(filter);
  }
  installThemeGridKeyboard(grid);
  main.append(filters, gridPanel);
  const status = element('p', 'theme-status'); status.setAttribute('role', 'status'); main.append(status);
  const credit = element('p', 'theme-credit'); credit.append(document.createTextNode('Additional palettes from '));
  const link = element('a', '', 'Agent Paint'); link.href = 'https://github.com/jzlosman/agent-paint'; link.target = '_blank'; link.rel = 'noopener noreferrer'; credit.append(link);
  main.append(credit); app.append(main); draw();
  input.oninput = () => { themeQuery = input.value; draw(); };
}
function renderHelp(): void {
  const main = element('main', 'help-side quiet-scroll');
  main.append(element('h1', '', 'Keyboard shortcuts'));
  const shortcuts = element('dl', 'shortcuts');
  for (const [label, key] of [['Show / hide Banana Notes', hotkeyDisplay], ['New note', '⌘N'], ['Pin / unpin window', '⌘⇧P'], ['All / pinned tag scopes', '⌘1–⌘9'], ['Older / newer note', '⌘[  /  ⌘]'], ['Alternate navigation', '⌘⇧←  /  ⌘⇧→'], ['Show notes', '⌘⇧E'], ['Find in note', '⌘F'], ['Next / previous match', '↵ / ⇧↵ · ⌘G / ⇧⌘G'], ['Find notes', '⌘P'], ['Markdown source / frontmatter', '⌘⇧M'], ['Settings', '⌘,'], ['Hide window', 'Esc'], ['Bold / italic', '⌘B  /  ⌘I'], ['Add / edit link', '⌘K'], ['Bigger / smaller note text', '⌘+  /  ⌘−'], ['Reset note text size', '⌘0'], ['Copy selected text', '⌘C'], ['Copy formatted text', '⌘⌥C'], ['Move open note / focused list note to Trash', '⌘Backspace (⌘⌫)']]) {
    shortcuts.append(element('dt', '', label), element('dd', '', key));
  }
  main.append(shortcuts);
  main.append(element('h2', '', 'Markdown'), element('p', '', 'Supports headings, bold, italic, links, block quotes, code, tables, lists, and checkboxes. Press Return twice to end a list. Select text and press ⌘K to make a link. Click a link or press ⌘K inside it to edit its text or address. ⌘-click opens the destination. Long raw URLs display with a middle ellipsis; their full address remains in Markdown.'));
  main.append(element('h2', '', 'Notebooks and tags'), element('p', '', 'Add a #project tag in the note, use Add tag, or set tags: [project] in YAML frontmatter. Pin a tag from its context menu; ⌘1 selects All and ⌘2–⌘9 switch to pinned tags. Select All to clear the notebook scope.'));
  main.append(element('h2', '', 'Copy formats'), element('p', '', '⌘C copies the selected text without Markdown escapes. Pasting within Banana Notes preserves its formatting. Note actions → Copy as offers Markdown, formatted text, HTML source, and plain text. With no selection, it copies the entire note. Markdown copy includes frontmatter. Search fields and the source editor use standard text copying.'));
  const actions = element('div', 'help-actions');
  const markdownExport = button('Export all notes as Markdown files', Download, exportNotes, 'text-button', 'Export Markdown'); markdownExport.disabled = !capabilities.markdownExport;
  const openData = button('Open local data folder', FolderOpen, () => capabilities.dataFolder?.open(), 'text-button', 'Data folder'); openData.disabled = !capabilities.dataFolder;
  actions.append(markdownExport, openData);
  main.append(actions, element('p', 'local-disclaimer', capabilities.dataFolder ? `${capabilities.presentation.savedLabel}. Pin the window to keep it visible when switching apps.` : 'Browser preview only. Its notes are separate from the Mac app.'));
  app.append(main);
}
async function exportNotes(): Promise<void> {
  await queue.flush();
  const notes = library.notes.filter(note => !note.trashedAt).map(note => ({ id: note.id, markdown: note.markdown }));
  if (!capabilities.markdownExport) throw new Error('Markdown export is unavailable in this preview.');
  await capabilities.markdownExport.export(notes);
}
function renderCounter(): void {
  if (!counterElement) return;
  const { position, total, canMoveOlder, canMoveNewer } = noteNavigation(library);
  counterElement.textContent = total ? `${position ?? '—'} / ${total}` : '0 notes';
  counterElement.title = position === null && total ? 'This note is outside the current notebook' : 'Note position in this notebook · oldest first';
  const older = app.querySelector<HTMLButtonElement>('[data-navigation="older"]'); const newer = app.querySelector<HTMLButtonElement>('[data-navigation="newer"]');
  if (older) older.disabled = !canMoveOlder;
  if (newer) newer.disabled = !canMoveNewer;
}
function renderFooter(): void {
  const footer = element('footer'); footer.setAttribute('aria-label', 'Note tools');
  if (view === 'note') {
    if (selected()) {
      const tools = element('div', 'footer-note-tools');
      if (!sourceMode) { const code = element('div', 'code-tools'); code.hidden = true; tools.append(formatBar(), code); }
      const more = noteActionsButton('format-button'); more.onmousedown = event => event.preventDefault(); tools.append(more); footer.append(tools);
    }
    const nav = element('nav', 'note-navigation'); nav.setAttribute('aria-label', 'Note navigation');
    const older = button('Older note · ⌘[', ChevronLeft, () => move(1)); older.dataset.navigation = 'older';
    const newer = button('Newer note · ⌘]', ChevronRight, () => move(-1)); newer.dataset.navigation = 'newer';
    counterElement = element('span', 'note-counter'); nav.append(older, counterElement, newer); footer.append(nav);
  }
  footer.append(button('Shortcuts & Markdown help', CircleHelp, () => { view = view === 'help' ? 'note' : 'help'; render(); })); app.append(footer); renderCounter(); refreshCodeTools();
}
const viewAnnouncer = document.createElement('div');
viewAnnouncer.className = 'visually-hidden'; viewAnnouncer.setAttribute('role', 'status'); viewAnnouncer.setAttribute('aria-live', 'polite'); viewAnnouncer.setAttribute('aria-atomic', 'true');
function viewLabel(): string {
  if (view === 'note') return 'Note';
  if (view === 'explorer') return explorerState?.mode === 'trash' ? 'Trash' : 'Notes';
  if (view === 'project') return 'Notebook overview';
  if (view === 'help') return 'Help';
  const tab = appearanceTab === 'window' ? 'Window' : appearanceTab === 'code' ? 'Code' : appearanceTab === 'general' ? 'General' : appearanceTab === 'search' ? 'Search' : appearanceTab === 'export' ? 'Export PNG' : 'Themes';
  return `Settings · ${tab}`;
}
function announceView(): void {
  if (!viewAnnouncer.isConnected) document.body.append(viewAnnouncer);
  viewAnnouncer.textContent = '';
  const announcement = viewLabel(); window.setTimeout(() => { viewAnnouncer.textContent = announcement; }, 0);
}
function focusCurrentView(settingsTabChanged = false): void {
  if (settingsTabChanged) {
    const target = appearanceTab === 'export' ? app.querySelector<HTMLElement>('#settings-title') : app.querySelector<HTMLButtonElement>('.appearance-tab[aria-selected="true"]');
    if (target) { if (target.tagName === 'H1') target.tabIndex = -1; target.focus(); }
    return;
  }
  focusPrimaryView(app, view === 'themes' ? 'settings' : view, {
    sourceMode, findOpen,
    ...(editor ? { focusEditor: () => editor?.commands.focus() } : {}),
  });
}
function render(): void {
  const previousView = renderedView;
  const settingsTabChanged = view === 'themes' && renderedAppearanceTab !== appearanceTab;
  const viewChanged = previousView !== view || settingsTabChanged;
  semanticSequence++;
  refreshSemanticSettings = undefined;
  closePopover(); scopeBar?.dispose(); scopeBar = undefined;
  disposeDragRegion?.(); disposeDragRegion = undefined;
  const source = app.querySelector<HTMLTextAreaElement>('.source-editor');
  if (source && selected()) sourceSelections.set(selected()!.id, { start: source.selectionStart, end: source.selectionEnd });
  disposeEditor(); markdownSourceTextarea = undefined; badgeElement = undefined; counterElement = undefined;
  app.replaceChildren(); app.className = `app-shell view-${view}`; app.setAttribute('aria-busy', 'false');
  if (viewChanged && previousView) {
    app.dataset.transition = previousView === 'note' && view === 'explorer' ? 'to-notes'
      : previousView === 'explorer' && view === 'note' ? 'to-note' : 'other';
  } else delete app.dataset.transition;
  renderHeader();
  if (view === 'note') renderNote(); else if (view === 'explorer') renderExplorer(); else if (view === 'project') renderProject(); else if (view === 'themes') renderThemes(); else renderHelp();
  renderFooter(); showSaveFailure();
  if (view === 'note' && oversizedDraft?.noteID === selected()?.id) showNoteSizeLimit();
  if (viewChanged) {
    announceView();
    requestAnimationFrame(() => focusCurrentView(settingsTabChanged));
  }
  renderedView = view; renderedAppearanceTab = appearanceTab;
}
const handleAppCommand = createAppCommandHandler({
  isReady: () => sessionLoaded,
  defer: command => commandsWaiting.push(command),
  newNote,
  showExplorer: () => { explorerState.mode = 'notes'; view = 'explorer'; render(); },
  selectNotebook: tag => { try { notebook(tag); } catch (error) { showError(error); } },
  showHelp: () => { view = 'help'; render(); },
  showSettings: openThemes,
  focusChanged: focused => { const becameFocused = !windowFocused && focused; windowFocused = focused; applyWindowState(); if (becameFocused) indexCoordinator.schedule(library.notes, true); },
  pinChanged: updatePinnedState,
  changeWindowStyle,
  changeFontSize: adjustment => changeFontSize(adjustment === 'reset' ? DEFAULT_FONT_SIZE : stepFontSize(fontSize, adjustment === 'increase' ? 1 : -1)),
  copy: (format, whole) => copyNote(format, whole),
  flush: async () => {
    if (oversizedDraft) throw new Error('This note has unsaved content over 2 MB. Reduce its size before closing Banana Notes.');
    await Promise.all([queue.flush(), scopePreferenceQueue.flush(), windowStyleQueue.flush(), fontSizeQueue.flush(), noteFontSelectionTask]);
  },
  focusEditor: () => { if (view === 'note') editor?.commands.focus(); },
  move,
});
function bindAppKeyboardShortcuts(): () => void {
  return installKeyboardShortcuts({
  isReady: () => sessionLoaded,
  view: () => view,
  handleTrash: event => handleNoteTrashShortcut(event, selected()?.id ?? null, discardNote),
  closePopover,
  hasOCRDialog: () => !!app.querySelector('.ocr-result'),
  closeOCRDialog,
  hasFind: () => findOpen,
  closeFind: closeNoteFind,
  openFind: openNoteFind,
  findNext: navigateNoteFind,
  sourceMode: () => sourceMode,
  editorAvailable: () => !!editor,
  increaseFont: () => changeFontSize(stepFontSize(fontSize, 1)),
  decreaseFont: () => changeFontSize(stepFontSize(fontSize, -1)),
  resetFont: () => changeFontSize(DEFAULT_FONT_SIZE),
  copyFormatted: () => copyNote('formatted'),
  editLink: () => editNoteLink(),
  newNote,
  moveOlder: () => move(1),
  moveNewer: () => move(-1),
  showExplorer: () => { explorerState.mode = 'notes'; view = 'explorer'; render(); },
  goToScopeShortcut,
  flipView: flip,
  toggleSource: () => { sourceMode = !sourceMode; view = 'note'; render(); },
  openSettings: openThemes,
  save: async () => { await Promise.all([queue.flush(), scopePreferenceQueue.flush()]); },
  goToNote: () => goNote(),
  hideWindow: () => capabilities.window.hide(),
  error: showError,
  });
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySyntaxAppearance);
for (const type of ['drop', 'paste'] as const) document.addEventListener(type, event => {
  if (!sessionLoaded || !capabilities.attachments || view !== 'note' || !selected()) return;
  const target = event.target as HTMLElement;
  if (!target.closest('.note-side')) return;
  const data = type === 'drop' ? (event as DragEvent).dataTransfer : (event as ClipboardEvent).clipboardData;
  const files = [...(data?.files || [])]; if (!files.length) return;
  event.preventDefault(); event.stopPropagation(); void importDroppedFiles(files, selected()!.id).catch(showError);
}, true);
document.addEventListener('dragover', event => { if (capabilities.attachments && view === 'note' && event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
window.addEventListener('pagehide', () => { if (sessionLoaded) void Promise.all([queue.flush(), scopePreferenceQueue.flush(), windowStyleQueue.flush(), fontSizeQueue.flush(), noteFontSelectionTask]).catch(() => {}); });
async function start(): Promise<void> {
  try {
    const { library: loaded, scopePreferences: loadedScopePreferences, appearance, typography, windowStyle: style, focused, features: featureState, startup, hotkey, imageOptions: imagePreferences, pinned: pinState } = await loadWorkspace(capabilities);
    hotkeyDisplay = hotkey.display || '⌃⇧Space'; hotkeyState = hotkey; startupState = startup; ocrEnabled = featureState.ocrEnabled;
    themeID = applyAppearance(document.documentElement, appearance.themeID);
    syntaxThemeID = syntaxThemeIDs.includes(appearance.syntaxThemeID) ? appearance.syntaxThemeID as SyntaxThemeID : 'app'; applySyntaxAppearance();
    imageOptions = imagePreferences as NoteImageOptions;
    noteFonts = typography.noteFonts;
    try { await applyNoteFont(document.documentElement, noteFonts); noteFontWarning = noteFonts.warning || ''; }
    catch {
      noteFonts = resolveNoteFontState({ ...noteFonts, selection: DEFAULT_NOTE_FONT_STATE.selection });
      await applyNoteFont(document.documentElement, noteFonts);
      noteFontWarning = 'The saved font could not be loaded. Select a font in Settings → Window.';
    }
    fontSize = typography.fontSize; applyFontSize();
    fontSizeQueue = new PreferenceSaveQueue({ save: value => capabilities.typography.saveFontSize(value) }, (state, error) => {
      fontError = state === 'error'; fontStatus = state === 'saving' ? 'Saving…' : state === 'error' ? 'Not saved · Retry' : capabilities.presentation.savedLabel; applyFontSize(); if (error) showError(error);
    });
    windowStyle = style; windowFocused = focused; applyWindowState();
    windowStyleQueue = new WindowStyleSaveQueue({ save: value => capabilities.windowStyle.save(value) }, (status, error) => {
      windowStyleError = status === 'error';
      windowStyleStatus = status === 'saving' ? 'Saving…' : status === 'error' ? 'Not saved · Retry' : capabilities.presentation.savedLabel;
      refreshWindowStyleControls(); if (error) showError(error);
    });
    scopePreferences = normalizeScopePreferences(loadedScopePreferences);
    const loadedScopePreferenceJSON = JSON.stringify(scopePreferences);
    library = loaded || welcomeLibrary(ids.next(), clock.now(), hotkeyDisplay);
    const unpurgedLibrary = library; library = libraryCommands.purgeExpiredTrash(library);
    scopePreferences = { ...scopePreferences, bookmarks: pruneScopeBookmarks(scopePreferences.bookmarks, library) };
    librarySession = new LibrarySession(library); explorerState = createExplorerState(library); updatePinnedState(pinState);
    scopePreferences = scopeCommands.rememberSelection(library, library, scopePreferences);
    scopePreferenceQueue = new PreferenceSaveQueue(capabilities.scopePreferences, (_status, error) => { if (error) showError(error); });
    if (JSON.stringify(scopePreferences) !== loadedScopePreferenceJSON) scopePreferenceQueue.enqueue(scopePreferences);
    queue = new SaveQueue(capabilities.library, (status, error) => {
      if (status === 'error') { saveError = error instanceof Error ? error.message : 'Could not save changes'; showSaveFailure(); }
      else if (status === 'saved') { saveError = ''; saveFailureNotice?.remove(); saveFailureNotice = undefined; indexCoordinator?.schedule(librarySession.library.notes); }
    });
    indexCoordinator = new SemanticIndexCoordinator({
      status: () => capabilities.semanticSearch.status(),
      index: async (notes, force) => {
        automaticIndexRunning = true;
        if (!explicitIndexRequests) void refreshSemanticSettings?.();
        try { return await capabilities.semanticSearch.index(notes, force); }
        finally { automaticIndexRunning = false; if (!explicitIndexRequests) void refreshSemanticSettings?.(); }
      },
    }, {
      onIndexed: () => { automaticIndexError = ''; if (!explicitIndexRequests) void refreshSemanticSettings?.(); },
      onError: error => { automaticIndexError = error instanceof Error ? error.message : 'Unable to update the search index.'; if (!explicitIndexRequests) void refreshSemanticSettings?.(); },
    });
    sessionLoaded = true; render(); indexCoordinator.schedule(librarySession.library.notes, true);
    if (!loaded || unpurgedLibrary !== library) persist();
    window.setInterval(() => { const next = libraryCommands.purgeExpiredTrash(librarySession.library); if (next !== librarySession.library) { replaceLibrary(next); persist(); if (view !== 'note') render(); else renderCounter(); } }, 3_600_000);
    await capabilities.window.ready();
    for (const command of commandsWaiting.splice(0)) await handleAppCommand(command);
    if (noteFontWarning) notify(noteFontWarning, true);
    if (appearance.warning) notify(appearance.warning, true);
    if (featureState.warning) notify(featureState.warning, true);
    if (hotkey.available && !hotkey.registered) notify(`The shortcut ${hotkeyDisplay} is unavailable. Open Banana Notes from the menu bar.`, true);
  } catch (error) {
    let recoveryState: LibraryRecoveryState | undefined;
    try { recoveryState = await capabilities.recovery?.state(); } catch { /* Recovery is optional for this adapter. */ }
    app.replaceChildren(); const recovery = element('main', 'recovery');
    recovery.append(element('h1', '', 'Unable to open notes'), element('p', '', recoveryState?.startupError || (error instanceof Error ? error.message : String(error))),
      element('p', '', 'The original files have not been changed. You can retry or open the data folder.'),
      button('Retry opening notes', RotateCcw, () => window.location.reload(), 'primary-button', 'Retry'));
    if (recoveryState?.backupAvailable) {
      const count = recoveryState.backupNoteCount ?? 0;
      const date = recoveryState.backupUpdatedAt && Number.isFinite(Date.parse(recoveryState.backupUpdatedAt))
        ? new Date(recoveryState.backupUpdatedAt).toLocaleString() : 'date unavailable';
      recovery.append(element('p', '', `Last backup · ${count.toLocaleString()} ${count === 1 ? 'note' : 'notes'} · ${date}`),
        button('Restore last backup', RotateCcw, async () => {
          await capabilities.recovery!.restoreLastBackup();
          app.replaceChildren(); await start();
        }, 'primary-button', 'Restore last backup'));
    }
    if (capabilities.dataFolder) recovery.append(button('Open local data folder', FolderOpen, () => capabilities.dataFolder!.open(), recoveryState?.backupAvailable ? 'text-button' : 'primary-button', 'Open data folder'));
    app.append(recovery);
  }
}
export function mountApp(selectedCapabilities: Capabilities, selectedClock: Clock, selectedIDs: IdGenerator): () => void {
  capabilities = selectedCapabilities; clock = selectedClock; ids = selectedIDs;
  libraryCommands = new LibraryCommands(clock, ids); scopeCommands = new ScopeCommands(); projectCommands = new ProjectCommands(clock);
  windowStyleStatus = capabilities.presentation.savedLabel; fontStatus = capabilities.presentation.savedLabel;
  disposeCommands?.();
  const unbind = capabilities.window.bindCommands(handleAppCommand); disposeCommands = unbind;
  const disposeKeyboard = bindAppKeyboardShortcuts();
  void start();
  return () => { unbind(); disposeKeyboard(); if (disposeCommands === unbind) disposeCommands = undefined; };
}
