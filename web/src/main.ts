import './style.css';
import './explorer-view.css';
import './project-view.css';
import './media.css';
import './code-highlighting.css';
import './semantic-search.css';
import './note-image.css';
import './note-font.css';
import './action-menu.css';
import { closePopover, openActionMenu } from './action-menu';
import { createElement, ChevronLeft, ChevronRight, Plus, Pin, Search, ArrowLeft, BookOpen, PanelTop, Code, CircleHelp, X, Hash, Download, Bold, Italic, Heading2, List, ListTodo, Quote, Braces, Check, FolderOpen, Settings, Trash2, RotateCcw, Clipboard, Paperclip, Camera, ScanText, Ellipsis, Archive, type IconNode } from 'lucide';
import type { Editor } from '@tiptap/core';
import { createMarkdownEditor } from './editor';
import { type Library, type Note, createNote, updateNote, navigate, orderedNotes, notebookTags, selectNotebook, splitDocument, withTag, tagsOf, titleOf, excerptOf, validateLibrary, welcomeLibrary, trashNote, restoreNote, trashedNotes, selectedTags, selectNotebooks, queryNotes, bulkTrashNotes, bulkRestoreNotes, bulkArchiveNotes, bulkTagNotes, purgeExpiredTrash } from './domain';
import { SaveQueue } from './persistence';
import { themes, themeByID, resolveThemeID, SYSTEM_THEME, type ThemeDefinition } from './themes';
import { applyAppearance } from './appearance';
import { observeWindowDragRegion } from './window-drag';
import { DEFAULT_WINDOW_STYLE, resolveWindowStyle, WindowStyleSaveQueue, type WindowStyle } from './window-style';
import { DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE, resolveFontSize, stepFontSize } from './font-size';
import { DEFAULT_NOTE_FONT_STATE, resolveNoteFontState, applyNoteFont, renderNoteFontSettings, type NoteFontState, type NoteFontSelection } from './note-font';
import { PreferenceSaveQueue } from './preference-save';
import { documentClipboardPayload, selectionClipboardPayload, type ClipboardFormat, type ClipboardPayload } from './clipboard';
import { createExplorerState, renderExplorerView, type ExplorerState } from './explorer-view';
import { renderProjectView, createProjectViewState } from './project-view';
import { toggleProjectedTask } from './project-content';
import { importAttachments, attachmentMarkdown, type AttachmentRecord } from './attachments';
import { applyCodeAppearance, renderCodeSettings, renderCodeLanguageSelector, highlightCodeHTML, syntaxThemeIDs, type SyntaxThemeID } from './code-highlighting';
import { renderSemanticSettings, semanticSearch, type SemanticInvoke, type SemanticStatus, type SemanticNoteSnapshot } from './semantic-search';
import { SemanticIndexCoordinator } from './semantic-indexing';
import { searchNotes } from './note-search';
import { buildNoteImageRequest, renderNoteImageExportControls, type NoteImageOptions, type NoteImageRequest } from './note-image';

type NativeReply = { library?: unknown; error?: string; pinned?: boolean; hotkeyAvailable?: boolean; dataDirectory?: string; saved?: boolean; themeID?: string; themeWarning?: string | null; focused?: boolean; windowStyle?: unknown; fontSize?: unknown; copied?: boolean; ocrEnabled?: boolean; syntaxThemeID?: string; launchAtLogin?: boolean; launchStatus?: string; launchError?: string | null; newNoteOnLaunch?: boolean; featureWarning?: string | null; imageOptions?: NoteImageOptions; noteFonts?: NoteFontState };
type NativeCommand = { action: string; tag?: string; focused?: boolean; style?: unknown; format?: ClipboardFormat; whole?: boolean };
declare global { interface Window {
  webkit?: { messageHandlers: { native: { postMessage(message: unknown): Promise<NativeReply> } } };
  foldnoteCommand: (command: NativeCommand) => Promise<void>;
} }
const app = document.querySelector<HTMLDivElement>('#app')!;
const isNative = !!window.webkit?.messageHandlers.native;
document.documentElement.dataset.native = String(isNative);
const previewKey = 'foldnote-preview-v1';
const previewThemeKey = 'foldnote-preview-theme-v1';
const previewWindowStyleKey = 'foldnote-preview-window-style-v1';
const previewFontSizeKey = 'foldnote-preview-font-size-v1';
const previewNoteFontKey = 'foldnote-preview-note-font-v1';
const previewOCRKey = 'foldnote-preview-ocr-v1';
let library: Library;
let editor: Editor | undefined;
let view: 'note' | 'explorer' | 'project' | 'help' | 'themes' = 'note';
let themeID = SYSTEM_THEME;
let themeSaving = false;
let themeQuery = '';
let themeFilter: 'all' | 'light' | 'dark' = 'all';
type SettingsTab = 'themes' | 'window' | 'code' | 'general' | 'search' | 'export';
const settingsTabs = [['themes', 'Themes'], ['code', 'Code'], ['window', 'Window'], ['general', 'General'], ['search', 'Search']] as const;
let appearanceTab: SettingsTab = 'themes';
let ocrEnabled = false;
let syntaxThemeID: SyntaxThemeID = 'app';
let explorerState: ExplorerState;
const projectState = createProjectViewState();
let startupState = { launchAtLogin: false, launchStatus: 'notRegistered', launchError: null as string | null, newNoteOnLaunch: false };
let imageOptions: NoteImageOptions = {};
let semanticSequence = 0;
let indexCoordinator: SemanticIndexCoordinator;
let explicitIndexRequests = 0;
let automaticIndexRunning = false;
let automaticIndexError = '';
let refreshSemanticSettings: (() => Promise<void>) | undefined;
const featureInvoke: SemanticInvoke = async (action, data = {}) => {
  if (action === 'semanticIndex') {
    explicitIndexRequests++;
    try { return await indexCoordinator.refresh((data.notes as SemanticNoteSnapshot[]) ?? library.notes, data.force === true); }
    finally { explicitIndexRequests--; }
  }
  if (['semanticEnable', 'semanticClear', 'semanticCancel'].includes(action)) { semanticSequence++; indexCoordinator.invalidate(); automaticIndexError = ''; if (explorerState) explorerState.searchResult = null; }
  const result = await native<Record<string, unknown>>(action, data);
  if (['semanticEnable', 'semanticStartRuntime', 'semanticDownload'].includes(action)) indexCoordinator.schedule(library.notes, true);
  return result;
};
let windowStyle: WindowStyle = { ...DEFAULT_WINDOW_STYLE };
let windowFocused = true;
let windowStyleQueue: WindowStyleSaveQueue;
let windowStyleStatus = isNative ? 'Saved on this Mac' : 'Saved in preview';
let windowStyleError = false;
let noteFonts = resolveNoteFontState(DEFAULT_NOTE_FONT_STATE);
let noteFontSelectionTask: Promise<NoteFontState> | undefined;
let noteFontWarning = '';
let fontSize = DEFAULT_FONT_SIZE;
let fontSizeQueue: PreferenceSaveQueue<number>;
let fontStatus = isNative ? 'Saved on this Mac' : 'Saved in preview';
let fontError = false;
let explorerMode: 'notes' | 'trash' = 'notes';
let sourceMode = false;
let pinned = false;
let query = '';
let saveError = '';
let saveFailureNotice: HTMLElement | undefined;
let prefix = '';
let queue: SaveQueue;
let sessionLoaded = false;
let badgeElement: HTMLElement | undefined;
let contentElement: HTMLElement | undefined;
let counterElement: HTMLElement | undefined;
let activeEditorID: string | null = null;
let disposeDragRegion: (() => void) | undefined;
const commandsWaiting: NativeCommand[] = [];

async function native<T = NativeReply>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  if (!isNative) return {} as T;
  const result = await window.webkit!.messageHandlers.native.postMessage({ action, ...data });
  if (result?.error) throw new Error(result.error);
  return (result || {}) as T;
}
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag); el.className = className; if (text !== undefined) el.textContent = text; return el;
}
function icon(node: IconNode, size = 17): SVGElement { return createElement([node[0], { ...node[1], width: size, height: size, 'stroke-width': 1.7, 'aria-hidden': 'true' }, node[2]]); }
function button(label: string, node: IconNode | null, run: () => void | Promise<unknown>, className = 'icon-button', text?: string): HTMLButtonElement {
  const el = element('button', className); el.type = 'button'; el.title = label; el.setAttribute('aria-label', label);
  if (node) el.append(icon(node)); if (text) el.append(document.createTextNode(text));
  el.onclick = () => { try { Promise.resolve(run()).catch(showError); } catch (error) { showError(error); } }; return el;
}
function selected(): Note | undefined { return library.notes.find(note => note.id === library.selectedID && !note.trashedAt); }
function persist(): void { queue.enqueue(library); }
function showSaveFailure(): void {
  if (!saveError) return;
  saveFailureNotice = notify(saveError, true, { label: 'Retry', run: () => {
    // The queue reports retry failures through the same persistent notice.
    void queue.flush().catch(() => {});
  } });
}
function showError(error: unknown): void { notify(error instanceof Error ? error.message : String(error), true); }
function notify(message: string, error = false, action?: { label: string; run: () => void }): HTMLElement {
  document.querySelector('.notice')?.remove();
  const notice = element('div', `notice${error ? ' error' : ''}`);
  notice.setAttribute('role', error ? 'alert' : 'status');
  notice.append(element('span', '', message));
  if (action) notice.append(button(action.label, null, () => { notice.remove(); action.run(); }, 'text-button', action.label));
  notice.append(button('Dismiss message', X, () => notice.remove()));
  app.append(notice);
  if (!error) window.setTimeout(() => notice.remove(), 5000);
  return notice;
}
function commitMarkdown(markdown: string): void {
  const id = activeEditorID;
  if (!id) return;
  // Keep the working editor attached to its note even when an edit removes a scope tag.
  library = { ...updateNote(library, id, markdown, new Date().toISOString()), selectedID: id };
  persist(); renderBadges(); renderCounter();
}
function disposeEditor(): void { editor?.destroy(); editor = undefined; activeEditorID = null; }
function goNote(id?: string): void {
  if (id) { if (!library.notes.some(note => note.id === id && !note.trashedAt)) return; library = { ...library, selectedID: id }; persist(); }
  view = 'note'; render();
}
function newNote(): void {
  library = createNote(library, crypto.randomUUID(), new Date().toISOString()); persist(); sourceMode = false; goNote();
}
function move(delta: number): void {
  const next = navigate(library, delta);
  if (next.selectedID === library.selectedID) return;
  library = next; persist(); view = 'note'; render();
}
function notebook(tag: string | null, stayExplorer = false): void {
  library = selectNotebook(library, tag); persist(); query = '';
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
    const scope = button('Choose notebook', BookOpen, () => { explorerState.mode = 'notes'; view = 'explorer'; render(); }, 'scope-button');
    scope.append(element('span', 'scope-label', view === 'explorer' && explorerState.mode === 'trash' ? 'Trash' : selectedTags(library).length ? selectedTags(library).map(tag => `#${tag}`).join(' · ') : 'All notes'));
    context.append(scope);
    if (selectedTags(library).length) context.append(button('Leave notebook · show all notes', X, () => notebook(null), 'clear-scope'));
  }
  const spacer = element('div', 'toolbar-drag'); spacer.setAttribute('aria-hidden', 'true');
  const actions = element('div', 'header-actions');
  const pin = button(pinned ? 'Unpin · hide when switching apps' : 'Pin · stay visible when switching apps', Pin, async () => {
    const result = await native('pin', { pinned: !pinned }); pinned = result.pinned ?? !pinned;
    pin.classList.toggle('active', pinned); pin.setAttribute('aria-pressed', String(pinned));
    pin.title = pinned ? 'Unpin · hide when switching apps' : 'Pin · stay visible when switching apps'; pin.setAttribute('aria-label', pin.title);
  });
  pin.classList.toggle('active', pinned); pin.setAttribute('aria-pressed', String(pinned));
  const reverseSide = view === 'explorer' || view === 'project' || view === 'themes';
  actions.append(pin, button(reverseSide ? 'Back to note · ⌘⇧E' : 'Show notes · ⌘⇧E', reverseSide ? PanelTop : BookOpen, flip), button('New note · ⌘N', Plus, newNote));
  if (view === 'note' && selected()) {
    const source = button(sourceMode ? 'Show formatted note · ⌘⇧M' : 'Edit Markdown source · ⌘⇧M', Code, () => { sourceMode = !sourceMode; render(); });
    source.classList.toggle('active', sourceMode); source.setAttribute('aria-pressed', String(sourceMode)); actions.append(source);
  }
  const settings = button('Settings · ⌘,', Settings, () => { if (view === 'themes' && appearanceTab !== 'export') goNote(); else openThemes(); });
  settings.classList.toggle('active', view === 'themes' && appearanceTab !== 'export'); settings.setAttribute('aria-pressed', String(view === 'themes' && appearanceTab !== 'export')); actions.append(settings);
  header.append(context, spacer, actions); app.append(header);
  if (isNative) disposeDragRegion = observeWindowDragRegion(spacer, rect => { void native('dragRegion', { rect }).catch(showError); });
}
function renderBadges(): void {
  if (!badgeElement) return;
  badgeElement.replaceChildren();
  const note = selected(); if (!note) return;
  tagsOf(note.markdown).forEach(tag => badgeElement!.append(button(`Open #${tag} notebook overview`, null, () => openProject([tag]), 'tag-badge', `#${tag}`)));
  badgeElement.append(button('Add a tag to this note', Plus, tagInput, 'add-tag', 'Tag'));
}
function tagInput(): void {
  const targetID = selected()?.id; if (!targetID || !badgeElement || badgeElement.querySelector('form')) return;
  const form = element('form', 'tag-form');
  const input = element('input', 'tag-input'); input.placeholder = 'Tag name'; input.setAttribute('aria-label', 'New tag'); input.autocomplete = 'off';
  form.append(icon(Hash, 13), input, button('Cancel tag', X, () => { form.remove(); editor?.commands.focus(); }, 'tiny-button'));
  form.onsubmit = event => {
    event.preventDefault();
    if (library.selectedID !== targetID) return;
    try {
      const note = selected()!;
      library = updateNote(library, note.id, withTag(note.markdown, input.value), new Date().toISOString());
      persist(); render();
    } catch (error) { input.setCustomValidity((error as Error).message); input.reportValidity(); }
  };
  input.oninput = () => input.setCustomValidity('');
  input.onkeydown = event => { if (event.key === 'Escape') { event.stopPropagation(); form.remove(); editor?.commands.focus(); } };
  badgeElement.append(form); input.focus();
}
function formattingActions(): { label: string; icon: IconNode; run: () => void; secondary?: boolean }[] {
  return [
    { label: 'Bold · ⌘B', icon: Bold, run: () => { editor?.chain().focus().toggleBold().run(); } },
    { label: 'Italic · ⌘I', icon: Italic, run: () => { editor?.chain().focus().toggleItalic().run(); } },
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
function renderNote(): void {
  const note = selected();
  contentElement = element('main', 'note-side');
  if (!note) {
    const empty = element('div', 'empty-state'); empty.append(icon(BookOpen, 30), element('h1', '', library.activeTag ? `#${library.activeTag}` : 'No notes'), element('p', '', 'Create a note to get started.'), button('Create a note', Plus, newNote, 'primary-button', 'New note'));
    contentElement.append(empty); app.append(contentElement); return;
  }
  badgeElement = element('div', 'note-tags'); renderBadges(); contentElement.append(badgeElement);
  const parts = splitDocument(note.markdown); prefix = parts.frontmatter; activeEditorID = note.id;
  if (prefix && !prefix.endsWith('\n')) prefix += '\n';
  if (parts.error) { sourceMode = true; contentElement.append(element('div', 'inline-warning', parts.error)); }
  if (sourceMode) {
    const label = element('div', 'source-label', 'Markdown source' );
    const area = element('textarea', 'source-editor'); area.setAttribute('aria-label', 'Markdown source'); area.value = note.markdown; area.spellcheck = false;
    area.oninput = () => commitMarkdown(area.value);
    contentElement.append(label, area);
    app.append(contentElement); requestAnimationFrame(() => area.focus());
  } else {
    const scroll = element('div', 'editor-scroll'); const mount = element('div', 'editor-mount'); scroll.append(mount); contentElement.append(scroll); app.append(contentElement);
    editor = createMarkdownEditor(mount, parts.body, markdown => commitMarkdown(prefix + markdown));
    editor.on('selectionUpdate', refreshCodeTools); editor.on('update', refreshCodeTools); refreshCodeTools();
    requestAnimationFrame(() => editor?.commands.focus('start'));
  }
}
function discardNote(id: string): void {
  if (!library.notes.some(note => note.id === id && !note.trashedAt)) return;
  const scroll = app.querySelector('.note-list')?.scrollTop || 0;
  library = trashNote(library, id, new Date().toISOString()); persist(); render();
  const list = app.querySelector('.note-list'); if (list) list.scrollTop = scroll;
  notify('Note moved to Trash', false, { label: 'Undo', run: () => recoverNote(id) });
}
function recoverNote(id: string): void {
  library = restoreNote(library, id, new Date().toISOString()); persist(); render(); notify('Note restored');
}
function renderExplorer(): void {
  explorerState.selectedTags = selectedTags(library);
  const changed = (next: Library, message: string) => { library = next; explorerState.selectedIDs.clear(); persist(); render(); notify(message); };
  app.append(renderExplorerView({ library, state: explorerState, now: new Date().toISOString(),
    onOpenNote: id => goNote(id), onModeChange: renderHeaderScope,
    onScopeChange: tags => { library = selectNotebooks(library, tags); persist(); renderHeaderScope(); },
    onTrash: ids => { changed(bulkTrashNotes(library, ids, new Date().toISOString()), `${ids.length} ${ids.length === 1 ? 'note' : 'notes'} moved to Trash · recoverable for 30 days`); notify('Moved to Trash · recoverable for 30 days', false, { label: 'Undo', run: () => changed(bulkRestoreNotes(library, ids, new Date().toISOString()), 'Notes restored') }); },
    onRestore: ids => changed(bulkRestoreNotes(library, ids, new Date().toISOString()), 'Notes restored'),
    onArchive: ids => { try { changed(bulkArchiveNotes(library, ids, new Date().toISOString()), 'Notes archived' ); } catch (error) { showError(error); } },
    onTag: (ids, tag) => { try { changed(bulkTagNotes(library, ids, tag, new Date().toISOString()), `Added #${tag.replace(/^#/, '')}`); } catch (error) { showError(error); } },
    onOverview: tags => openProject(tags),
    onSearch: isNative ? async (text, candidates) => {
      const sequence = ++semanticSequence; await new Promise(resolve => setTimeout(resolve, 250));
      return searchNotes(text, candidates, {
        status: () => native<SemanticStatus>('semanticStatus'),
        prepareIndex: () => indexCoordinator.refresh(library.notes),
        semanticSearch: async (query, ids) => (await semanticSearch(featureInvoke, query, ids)).map(hit => hit.id),
      }, () => sequence === semanticSequence);
    } : undefined, onConfigureSearch: () => openThemes('search'), onError: showError,
  }));
}
function renderHeaderScope(): void {
  const label = app.querySelector('.scope-label'); if (label) label.textContent = explorerState.mode === 'trash' ? 'Trash' : selectedTags(library).length ? selectedTags(library).map(tag => `#${tag}`).join(' · ') : 'All notes';
  const context = app.querySelector('.toolbar-context'); context?.querySelector('.clear-scope')?.remove();
  if (explorerState.mode !== 'trash' && selectedTags(library).length) context?.append(button('Leave notebook · show all notes', X, () => notebook(null), 'clear-scope'));
  renderCounter();
}
function openProject(tags = selectedTags(library)): void {
  library = selectNotebooks(library, tags); explorerState.selectedTags = selectedTags(library); persist(); view = 'project'; render();
}
function renderProject(): void {
  const main = element('main', 'project-side'); main.append(element('h1', 'project-title', selectedTags(library).length ? selectedTags(library).map(tag => `#${tag}`).join(' · ') : 'All notes'));
  main.append(renderProjectView({ notes: queryNotes(library, { sort: 'edited' }), state: projectState, onError: showError, onOpenNote: goNote,
    onToggleTask: (task, checked) => {
      const result = toggleProjectedTask(library, task, checked, new Date().toISOString());
      if (!result.ok) { render(); throw new Error('That task changed. The overview has been refreshed; try again.'); }
      library = result.library; persist(); render();
    }, onOCR: ocrEnabled ? async media => { try { await recognizeImage(media.url, media.noteID); } catch (error) { showError(error); } } : undefined,
    onOpenMedia: async media => { try { await native('openAttachment', { url: media.url }); } catch (error) { showError(error); } },
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
    option.setAttribute('aria-pressed', String(selected));
    option.setAttribute('aria-disabled', String(themeSaving));
  });
  const status = app.querySelector<HTMLElement>('.theme-status');
  if (status) status.textContent = themeSaving ? 'Saving appearance…' : `${themeByID(themeID)?.name || 'Follow macOS'} · ${isNative ? 'Saved on this Mac' : 'Saved in preview'}`;
  app.querySelector('.themes-side')?.setAttribute('aria-busy', String(themeSaving));
}
async function chooseTheme(id: string): Promise<void> {
  if (themeSaving || id === themeID) return;
  if (resolveThemeID(id) !== id) throw new Error('That theme is not available.');
  themeSaving = true; refreshThemeSelection();
  try {
    if (isNative) {
      const saved = await native('theme', { themeID: id });
      if (saved.themeID !== id) throw new Error('The theme could not be confirmed. Try again.');
    } else localStorage.setItem(previewThemeKey, id);
    themeID = applyAppearance(document.documentElement, id); applySyntaxAppearance();
  } finally { themeSaving = false; refreshThemeSelection(); }
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
    if (isNative) await native('syntaxTheme', { syntaxThemeID: id }); else localStorage.setItem('foldnote-preview-syntax-v1', id);
    syntaxThemeID = id; applySyntaxAppearance();
  } catch (error) { showError(error); throw error; }
}
function insertIntoNote(id: string, markdown: string): void {
  const note = library.notes.find(note => note.id === id && !note.trashedAt);
  if (!note) throw new Error('The target note is no longer active. Restore it before inserting content.');
  if (view === 'note' && activeEditorID === id && editor) editor.chain().focus().insertContent(markdown, { contentType: 'markdown' }).run();
  else if (view === 'note' && activeEditorID === id && sourceMode) {
    const area = app.querySelector<HTMLTextAreaElement>('.source-editor')!; area.setRangeText(markdown, area.selectionStart, area.selectionEnd, 'end'); commitMarkdown(area.value); area.focus();
  } else { library = updateNote(library, id, `${note.markdown}${note.markdown.endsWith('\n') ? '\n' : '\n\n'}${markdown}\n`, new Date().toISOString()); persist(); }
}
async function pickAttachments(): Promise<void> {
  const id = selected()?.id; if (!id) return;
  if (!isNative) throw new Error('Managed local attachments are available in the Mac app.');
  const result = await native<{ attachments?: AttachmentRecord[]; cancelled?: boolean }>('pickAttachments');
  if (result.cancelled || !result.attachments?.length) return;
  insertIntoNote(id, result.attachments.map(attachmentMarkdown).join('\n\n')); notify('Attachments saved locally');
}
async function importDroppedFiles(files: File[], id: string): Promise<void> {
  if (!isNative) throw new Error('Managed local attachments are available in the Mac app.');
  notify(`Importing ${files.length} ${files.length === 1 ? 'attachment' : 'attachments'}…`);
  const records = await importAttachments(files, (action, data) => native(action, data));
  insertIntoNote(id, records.map(attachmentMarkdown).join('\n\n')); notify('Attachments saved locally');
}
async function recognizeImage(url?: string, targetID = selected()?.id): Promise<void> {
  if (!ocrEnabled) throw new Error('Enable local image text recognition in General settings first.');
  const result = await native<{ text?: string; cancelled?: boolean }>(url ? 'ocrAttachment' : 'pickOCRImage', url ? { url } : {});
  if (result.cancelled) return;
  const text = result.text || ''; const dialog = element('section', 'ocr-result'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', 'Recognized image text');
  dialog.append(element('h2', '', 'Recognized text'));
  const area = element('textarea'); area.value = text; area.setAttribute('aria-label', 'Recognized text to copy or insert'); dialog.append(area);
  const actions = element('div', 'ocr-result-actions');
  actions.append(button('Close recognized text', null, () => dialog.remove(), 'text-button', 'Close'), button('Copy recognized text', Clipboard, () => writeClipboard({ text: area.value }), 'text-button', 'Copy'));
  if (targetID) actions.append(button('Insert recognized text into source note', Plus, () => {
    const target = library.notes.find(note => note.id === targetID && !note.trashedAt); if (!target) throw new Error('The source note is no longer active.');
    if (editor && activeEditorID === targetID) {
      editor.chain().focus().insertContent(area.value.split(/\r?\n/).map(line => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] }))).run();
    } else insertIntoNote(targetID, area.value);
    dialog.remove();
  }, 'text-button', 'Insert into note'));
  dialog.append(actions); app.append(dialog); area.focus();
  dialog.onkeydown = event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dialog.remove(); }
    if (event.key === 'Tab') { const targets = [...dialog.querySelectorAll<HTMLElement>('textarea,button')]; const index = targets.indexOf(document.activeElement as HTMLElement); event.preventDefault(); targets[(index + (event.shiftKey ? -1 : 1) + targets.length) % targets.length]?.focus(); }
  };
}
function currentImageRequest(): NoteImageRequest {
  const note = selected(); if (!note) throw new Error('Open a note to export it.');
  const colors = themeByID(themeID)?.colors;
  const html = highlightCodeHTML(documentClipboardPayload(note.markdown, 'formatted').html || '<p></p>', syntaxThemeID, themeID, matchMedia('(prefers-color-scheme: dark)').matches);
  return buildNoteImageRequest(note.markdown, { ...imageOptions, paper: colors?.paper, text: colors?.ink, accent: colors?.accent, html }, titleOf(note.markdown));
}
async function exportImageRequest(request: NoteImageRequest): Promise<void> {
  if (!isNative) throw new Error('PNG export is rendered by the Mac app.');
  await Promise.all([queue.flush(), fontSizeQueue.flush(), noteFontSelectionTask]); const result = await native<{ exported?: boolean; cancelled?: boolean }>('exportPNG', { request });
  if (result.exported) notify('PNG saved');
}
async function exportCurrentPNG(): Promise<void> { await exportImageRequest(currentImageRequest()); }
function chooseNoteFont(selection: NoteFontSelection): Promise<NoteFontState> {
  const pending = noteFontSelectionTask;
  const task = (async () => {
    if (pending) await pending.catch(() => {});
    const previous = noteFonts;
    const desired = resolveNoteFontState({ ...noteFonts, selection });
    const saved = isNative ? resolveNoteFontState(await native<NoteFontState>('noteFont', { selection: desired.selection })) : desired;
    try { await applyNoteFont(document.documentElement, saved); }
    catch (error) {
      if (isNative) await native('noteFont', { selection: previous.selection });
      await applyNoteFont(document.documentElement, previous);
      if (view !== 'themes' || appearanceTab !== 'window') showError(error);
      throw error;
    }
    noteFonts = isNative ? resolveNoteFontState(await native<NoteFontState>('noteFonts')) : saved;
    if (!isNative) localStorage.setItem(previewNoteFontKey, JSON.stringify(noteFonts));
    return noteFonts;
  })();
  noteFontSelectionTask = task;
  const settled = () => { if (noteFontSelectionTask === task) noteFontSelectionTask = undefined; };
  void task.then(settled, settled); return task;
}
async function downloadNoteFont(family: string): Promise<{ fontState: NoteFontState; downloadedFontID: string }> {
  if (!isNative) throw new Error('Google Fonts downloads are available in the Mac app.');
  const result = await native<{ fontState: NoteFontState; downloadedFontID: string }>('downloadNoteFont', { family });
  noteFonts = resolveNoteFontState(result.fontState);
  return { fontState: noteFonts, downloadedFontID: result.downloadedFontID };
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
async function writeClipboard(content: ClipboardPayload): Promise<void> {
  if (isNative) {
    const reply = await native('clipboard', { content }); if (!reply.copied) throw new Error('The clipboard write could not be confirmed.');
  } else if (content.html) {
    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([content.text], { type: 'text/plain' }), 'text/html': new Blob([content.html], { type: 'text/html' }) })]);
  } else await navigator.clipboard.writeText(content.text);
}
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
      { label: 'Attach file…', icon: Paperclip, run: pickAttachments },
      ...(ocrEnabled ? [{ label: 'Recognize image text…', icon: ScanText, run: () => recognizeImage() }] : []),
      { separator: true },
      { label: 'Export PNG…', icon: Camera, run: () => openThemes('export') },
      { label: 'Archive note', icon: Archive, run: () => { library = bulkArchiveNotes(library, [id], new Date().toISOString()); persist(); render(); notify('Note archived'); } },
      { label: 'Move to Trash', icon: Trash2, danger: true, run: () => discardNote(id) },
    ], { label: 'Note actions', onError: showError });
  }, className);
  more.setAttribute('aria-haspopup', 'menu'); return more;
}
function applyWindowState(): void {
  document.documentElement.dataset.focused = String(windowFocused); if (!windowFocused) closePopover();
  // The real app uses NSPanel compositing; preview opacity is only an approximation.
  if (!isNative) document.documentElement.style.opacity = String(windowFocused ? windowStyle.focusedOpacity : windowStyle.unfocusedOpacity);
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
function renderAppearanceTabs(): HTMLElement {
  const tabs = element('div', 'appearance-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Settings sections');
  for (const [id, label] of settingsTabs) {
    const tab = button(`${label} settings`, null, () => { appearanceTab = id; render(); }, 'appearance-tab', label);
    tab.id = `appearance-tab-${id}`; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(appearanceTab === id));
    tab.setAttribute('aria-controls', 'appearance-content'); tab.tabIndex = appearanceTab === id ? 0 : -1;
    tab.onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const index = settingsTabs.findIndex(tab => tab[0] === id);
      appearanceTab = settingsTabs[event.key === 'Home' ? 0 : event.key === 'End' ? settingsTabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + settingsTabs.length) % settingsTabs.length][0]; render();
      app.querySelector<HTMLButtonElement>('.appearance-tab[aria-selected="true"]')?.focus();
    };
    tabs.append(tab);
  }
  return tabs;
}
function renderOCRPreferences(): HTMLElement {
  const section = element('section', 'settings-group'); section.append(element('h2', '', 'Images'));
  const label = element('label', 'setting-row'); const copy = element('span', 'setting-copy'); copy.append(element('span', 'setting-title', 'Recognize image text'), element('span', 'setting-hint', 'Runs locally. Review text before inserting.'));
  const input = element('input'); input.type = 'checkbox'; input.checked = ocrEnabled; input.setAttribute('aria-label', 'Enable local image text recognition');
  input.onchange = async () => {
    const desired = input.checked; input.disabled = true;
    try {
      if (isNative) { const result = await native('featurePreferences', { ocrEnabled: desired }); if (result.ocrEnabled !== desired) throw new Error('OCR preference could not be confirmed.'); }
      else localStorage.setItem(previewOCRKey, String(desired));
      ocrEnabled = desired;
    } catch (error) { input.checked = ocrEnabled; showError(error); }
    finally { input.disabled = false; }
  };
  label.append(copy, input); section.append(label);
  return section;
}
function renderGeneralSettings(): HTMLElement {
  const panel = element('section', 'settings-panel'); const startup = element('section', 'settings-group'); startup.append(element('h2', '', 'Startup'));
  const status = element('p', 'tool-status'); status.setAttribute('role', 'status');
  const approval = button('Open macOS Login Items settings', null, () => native('openLoginSettings'), 'text-button', 'Open Login Items…');
  const updateStatus = () => { status.textContent = startupState.launchError || (startupState.launchStatus === 'requiresApproval' ? 'Enable Banana Notes in macOS Login Items.' : ''); status.hidden = !status.textContent; approval.hidden = !status.textContent; }; updateStatus();
  for (const [key, label, hint] of [['launchAtLogin', 'Open at login', 'Managed by macOS Login Items.'], ['newNoteOnLaunch', 'New note on launch', 'Create a note each time the app starts.']] as const) {
    const row = element('label', 'setting-row'); const copy = element('span', 'setting-copy'); copy.append(element('span', 'setting-title', label), element('span', 'setting-hint', hint));
    const input = element('input'); input.type = 'checkbox'; input.checked = startupState[key]; input.setAttribute('aria-label', label);
    input.onchange = async () => {
      input.disabled = true;
      try {
        if (!isNative) throw new Error('Startup preferences apply to the Mac app.');
        const result = await native<Partial<typeof startupState>>('startupPreferences', { [key]: input.checked }); startupState = { ...startupState, ...result }; input.checked = startupState[key]; updateStatus();
      } catch (error) { input.checked = startupState[key]; showError(error); }
      finally { input.disabled = false; }
    }; row.append(copy, input); startup.append(row);
  }
  startup.append(status, approval); panel.append(startup, renderOCRPreferences());
  const data = element('section', 'settings-group'); data.append(element('h2', '', 'Storage'), element('p', 'settings-description', 'Notes and attachments are stored on this Mac.'), button('Open local data folder', FolderOpen, () => native('openData'), 'text-button', 'Open data folder')); panel.append(data); return panel;
}
function renderWindowStyleSettings(): HTMLElement {
  const settings = element('section', 'window-settings'); settings.id = 'appearance-content'; settings.setAttribute('role', 'tabpanel'); settings.setAttribute('aria-labelledby', 'appearance-tab-window');
  const sizeControl = element('select', 'note-font-control'); sizeControl.dataset.fontSize = ''; sizeControl.setAttribute('aria-label', 'Note text size');
  sizeControl.title = 'Note text size · ⌘+/⌘− · Reset with ⌘0';
  for (let size = MIN_FONT_SIZE; size <= MAX_FONT_SIZE; size++) {
    const option = element('option', '', `${size} px`); option.value = String(size); sizeControl.append(option);
  }
  sizeControl.value = String(fontSize); sizeControl.onchange = () => changeFontSize(Number(sizeControl.value));
  const fontSaveStatus = button('Retry saving note text size', null, () => fontSizeQueue.flush(), 'save-status font-save-status'); fontSaveStatus.setAttribute('aria-live', 'polite');
  settings.append(renderNoteFontSettings({ state: noteFonts, textSizeControl: { input: sizeControl, status: fontSaveStatus }, onSelect: chooseNoteFont, onDownload: downloadNoteFont, onCancelDownload: async () => { await native('cancelFontDownload'); } }));
  const effects = element('section', 'settings-group window-effects');
  const effectsHeading = element('h2', '', 'Window effects'); effectsHeading.id = 'window-effects-heading'; effects.setAttribute('aria-labelledby', effectsHeading.id);
  effects.append(effectsHeading); settings.append(effects);
  for (const [field, label, hint] of [
    ['focusedOpacity', 'Active window opacity', 'Applies to the entire window, including text.'],
    ['unfocusedOpacity', 'Inactive window opacity', 'Applies when the pinned window is inactive.'],
    ['glass', 'Background translucency', 'Blends the desktop behind the window.'],
  ] as const) {
    const row = element('div', 'effect-setting');
    const labels = element('div', 'effect-labels'); const text = element('label', '', label); text.htmlFor = `effect-${field}`;
    const output = element('output'); output.dataset.windowStyle = field; output.setAttribute('for', `effect-${field}`);
    labels.append(text, output);
    const input = element('input', 'effect-range'); input.type = 'range'; input.id = `effect-${field}`; input.dataset.windowStyle = field;
    input.min = field === 'glass' ? '0' : '5'; input.max = '100'; input.step = '1';
    input.oninput = () => changeWindowStyle({ ...windowStyle, [field]: Number(input.value) / 100 });
    row.append(labels, input, element('p', 'effect-hint', hint)); effects.append(row);
  }
  const actions = element('div', 'effects-actions');
  actions.append(button('Reset window effects', null, () => changeWindowStyle({ ...DEFAULT_WINDOW_STYLE }), 'text-button', 'Reset window effects'));
  const status = button('Retry saving window effects', null, () => windowStyleQueue.flush(), 'save-status effects-save-status'); status.setAttribute('aria-live', 'polite'); actions.append(status);
  effects.append(actions, element('p', 'effects-recovery', 'Use the menu bar → Reset Window Effects to restore visibility.'));
  if (!isNative) effects.append(element('p', 'effects-recovery', 'Background translucency is available in the Mac app only.'));
  return settings;
}
function renderThemes(): void {
  const main = element('main', 'themes-side');
  const heading = element('div', 'themes-heading'); const title = element('h1', '', appearanceTab === 'export' ? 'Export PNG' : 'Settings'); title.id = 'settings-title'; heading.append(title);
  if (appearanceTab === 'themes') heading.append(element('span', 'theme-total', `${themes.length} themes`));
  main.append(heading); if (appearanceTab !== 'export') main.append(renderAppearanceTabs());
  if (appearanceTab === 'window') {
    main.append(renderWindowStyleSettings()); app.append(main); refreshWindowStyleControls(); applyFontSize(); return;
  }
  if (appearanceTab !== 'themes') {
    let panel: HTMLElement;
    if (appearanceTab === 'general') panel = renderGeneralSettings();
    else if (appearanceTab === 'code') {
      panel = element('section', 'settings-panel code-settings-panel'); panel.append(renderCodeSettings({ selectedID: syntaxThemeID, appThemeID: themeID, onSelect: chooseSyntaxTheme }));
    } else if (appearanceTab === 'search') {
      panel = element('section', 'settings-panel'); panel.append(renderSemanticSettings({ invoke: featureInvoke, getNotes: () => library.notes, automaticIndex: () => ({ running: automaticIndexRunning, error: automaticIndexError }), registerRefresh: refresh => { refreshSemanticSettings = refresh; } }));
    } else {
      panel = element('section', 'settings-panel image-settings-panel');
      if (selected()) panel.append(renderNoteImageExportControls({ request: currentImageRequest(), onExport: request => {
        imageOptions = { ...imageOptions, width: request.width, padding: request.padding, gradient: request.backgroundStart === '#f6d6b8' ? 'dawn' : request.backgroundStart === '#c4e7ed' ? 'ocean' : 'lavender' };
        void (async () => { if (isNative) await native('imagePreferences', { imageOptions }); else localStorage.setItem('foldnote-preview-image-v1', JSON.stringify(imageOptions)); await exportImageRequest(request); })().catch(showError);
      } }));
      else panel.append(element('p', 'settings-description', 'Open or create a note first to preview its image.'));
    }
    panel.id = 'appearance-content'; panel.setAttribute('role', appearanceTab === 'export' ? 'group' : 'tabpanel'); panel.setAttribute('aria-labelledby', appearanceTab === 'export' ? 'settings-title' : `appearance-tab-${appearanceTab}`); main.append(panel); app.append(main); return;
  }
  const search = element('div', 'search-field'); const input = element('input'); input.type = 'search'; input.placeholder = 'Search themes…'; input.setAttribute('aria-label', 'Search themes'); input.value = themeQuery;
  search.append(icon(Search), input); main.append(search);
  const filters = element('div', 'theme-filters'); filters.setAttribute('aria-label', 'Theme appearance');
  const grid = element('div', 'theme-grid'); grid.setAttribute('aria-label', 'Available themes'); grid.id = 'appearance-content'; grid.setAttribute('role', 'tabpanel'); grid.setAttribute('aria-labelledby', 'appearance-tab-themes');
  const matches = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
  const themeOption = (theme?: ThemeDefinition): HTMLButtonElement => {
    const id = theme?.id || SYSTEM_THEME;
    const option = button(`Use ${theme?.name || 'Follow macOS'} theme`, null, () => chooseTheme(id), 'theme-option');
    option.dataset.themeId = id;
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
  main.append(filters, grid);
  const status = element('p', 'theme-status'); status.setAttribute('role', 'status'); main.append(status);
  const credit = element('p', 'theme-credit'); credit.append(document.createTextNode('Palettes from '));
  const link = element('a', '', 'Agent Paint'); link.href = 'https://github.com/jzlosman/agent-paint'; link.target = '_blank'; link.rel = 'noopener noreferrer'; credit.append(link);
  main.append(credit); app.append(main); draw(); requestAnimationFrame(() => input.focus());
  input.oninput = () => { themeQuery = input.value; draw(); };
}
function renderHelp(): void {
  const main = element('main', 'help-side');
  main.append(element('h1', '', 'Keyboard shortcuts'));
  const shortcuts = element('dl', 'shortcuts');
  for (const [label, key] of [['Show / hide Banana Notes', '⌃⌥Space'], ['New note', '⌘N'], ['Older / newer note', '⌘[  /  ⌘]'], ['Alternate navigation', '⌘⇧←  /  ⌘⇧→'], ['Show notes', '⌘⇧E'], ['Find notes', '⌘P'], ['Markdown source / frontmatter', '⌘⇧M'], ['Settings', '⌘,'], ['Hide window', 'Esc'], ['Bold / italic', '⌘B  /  ⌘I'], ['Bigger / smaller note text', '⌘+  /  ⌘−'], ['Reset note text size', '⌘0'], ['Copy Markdown selection', '⌘C'], ['Copy formatted text', '⌘⌥C'], ['Trash focused note in list', '⌘⌫']]) {
    shortcuts.append(element('dt', '', label), element('dd', '', key));
  }
  main.append(shortcuts);
  main.append(element('h2', '', 'Markdown'), element('p', '', 'Supports headings, bold, italic, links, block quotes, code, tables, lists, and checkboxes. Press Return twice to end a list. ⌘-click a link to open it.'));
  main.append(element('h2', '', 'Notebooks and tags'), element('p', '', 'Add a #project tag in the note, use Add tag, or set tags: [project] in YAML frontmatter. Click a tag to open its notebook. Select All notes to clear the notebook scope.'));
  main.append(element('h2', '', 'Copy formats'), element('p', '', '⌘C copies selected editor content as Markdown. Note actions → Copy as offers Markdown, formatted text, HTML source, and plain text. With no selection, it copies the entire note. Markdown copy includes frontmatter. Search fields and the source editor use standard text copying.'));
  const actions = element('div', 'help-actions');
  actions.append(button('Export all notes as Markdown files', Download, exportNotes, 'text-button', 'Export Markdown'), button('Open local data folder', FolderOpen, () => native('openData'), 'text-button', 'Data folder'));
  main.append(actions, element('p', 'local-disclaimer', isNative ? 'Notes save automatically on this Mac. Pin the window to keep it visible when switching apps.' : 'Browser preview only. Its notes are separate from the Mac app.'));
  app.append(main);
}
async function exportNotes(): Promise<void> {
  await queue.flush();
  const notes = library.notes.filter(note => !note.trashedAt).map(note => ({ id: note.id, title: titleOf(note.markdown), markdown: note.markdown }));
  if (isNative) await native('export', { notes });
  else {
    const a = element('a'); a.href = URL.createObjectURL(new Blob([selected()?.markdown || ''], { type: 'text/markdown' })); a.download = `${titleOf(selected()?.markdown || '')}.md`; a.click(); URL.revokeObjectURL(a.href);
  }
}
function renderCounter(): void {
  if (!counterElement) return;
  const notes = orderedNotes(library); const index = notes.findIndex(note => note.id === library.selectedID);
  counterElement.textContent = notes.length ? (index < 0 ? `— / ${notes.length}` : `${index + 1} / ${notes.length}`) : '0 notes';
  counterElement.title = index < 0 && notes.length ? 'This note is outside the current notebook' : 'Note position in this notebook';
  const older = app.querySelector<HTMLButtonElement>('[data-navigation="older"]'); const newer = app.querySelector<HTMLButtonElement>('[data-navigation="newer"]');
  if (older) older.disabled = !notes.length || index >= notes.length - 1;
  if (newer) newer.disabled = index <= 0;
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
function render(): void {
  semanticSequence++;
  refreshSemanticSettings = undefined;
  closePopover();
  disposeDragRegion?.(); disposeDragRegion = undefined;
  disposeEditor(); badgeElement = undefined; counterElement = undefined;
  app.replaceChildren(); app.className = `app-shell view-${view}`; app.setAttribute('aria-busy', 'false');
  renderHeader();
  if (view === 'note') renderNote(); else if (view === 'explorer') renderExplorer(); else if (view === 'project') renderProject(); else if (view === 'themes') renderThemes(); else renderHelp();
  renderFooter(); showSaveFailure();
}
window.foldnoteCommand = async command => {
  if (!sessionLoaded) { commandsWaiting.push(command); return; }
  switch (command.action) {
    case 'new': newNote(); break;
    case 'explorer': explorerState.mode = 'notes'; view = 'explorer'; render(); break;
    case 'tag': try { notebook(command.tag || null); } catch (error) { showError(error); } break;
    case 'help': view = 'help'; render(); break;
    case 'themes': openThemes(); break;
    case 'focus': { const becameFocused = !windowFocused && command.focused === true; windowFocused = command.focused === true; applyWindowState(); if (becameFocused) indexCoordinator.schedule(library.notes, true); break; }
    case 'windowStyle': changeWindowStyle(resolveWindowStyle(command.style)); break;
    case 'fontIncrease': changeFontSize(stepFontSize(fontSize, 1)); break;
    case 'fontDecrease': changeFontSize(stepFontSize(fontSize, -1)); break;
    case 'fontReset': changeFontSize(DEFAULT_FONT_SIZE); break;
    case 'copy': await copyNote(command.format || 'markdown', command.whole); break;
    case 'flush': await Promise.all([queue.flush(), windowStyleQueue.flush(), fontSizeQueue.flush(), noteFontSelectionTask]); break;
    case 'show': if (view === 'note') editor?.commands.focus(); break;
    case 'older': move(1); break;
    case 'newer': move(-1); break;
  }
};
document.addEventListener('keydown', event => {
  if (!sessionLoaded || event.isComposing) return;
  const mod = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();
  let run: (() => void | Promise<unknown>) | undefined;
  if (event.key === 'Escape' && closePopover(true)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
  if (event.key === 'Escape' && app.querySelector('.ocr-result')) { event.preventDefault(); event.stopPropagation(); app.querySelector('.ocr-result')?.remove(); return; }
  if (mod && !event.altKey && (key === '+' || key === '=')) run = () => changeFontSize(stepFontSize(fontSize, 1));
  else if (mod && !event.altKey && key === '-') run = () => changeFontSize(stepFontSize(fontSize, -1));
  else if (mod && !event.altKey && key === '0') run = () => changeFontSize(DEFAULT_FONT_SIZE);
  else if (mod && event.altKey && key === 'c') run = () => copyNote('formatted');
  else if (mod && key === 'n' && !event.shiftKey) run = newNote;
  else if (mod && ((key === '[' && !event.shiftKey) || (event.shiftKey && key === 'arrowleft'))) run = () => move(1);
  else if (mod && ((key === ']' && !event.shiftKey) || (event.shiftKey && key === 'arrowright'))) run = () => move(-1);
  else if (mod && ((key === 'e' && event.shiftKey) || key === 'p')) run = () => { if (key === 'p') { explorerState.mode = 'notes'; view = 'explorer'; render(); } else flip(); };
  else if (mod && key === 'm' && event.shiftKey) run = () => { sourceMode = !sourceMode; view = 'note'; render(); };
  else if (mod && key === ',') run = openThemes;
  else if (mod && key === 's') run = () => queue.flush();
  else if (event.key === 'Escape') run = () => { if (view !== 'note') goNote(); else return native('hide'); };
  if (run) { event.preventDefault(); event.stopPropagation(); try { Promise.resolve(run()).catch(showError); } catch (error) { showError(error); } }
}, true);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySyntaxAppearance);
for (const type of ['drop', 'paste'] as const) document.addEventListener(type, event => {
  if (!sessionLoaded || view !== 'note' || !selected()) return;
  const target = event.target as HTMLElement;
  if (!target.closest('.note-side')) return;
  const data = type === 'drop' ? (event as DragEvent).dataTransfer : (event as ClipboardEvent).clipboardData;
  const files = [...(data?.files || [])]; if (!files.length) return;
  event.preventDefault(); event.stopPropagation(); void importDroppedFiles(files, selected()!.id).catch(showError);
}, true);
document.addEventListener('dragover', event => { if (view === 'note' && event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
window.addEventListener('pagehide', () => { if (sessionLoaded) void Promise.all([queue.flush(), windowStyleQueue.flush(), fontSizeQueue.flush(), noteFontSelectionTask]).catch(() => {}); });
if (!isNative) {
  window.addEventListener('focus', () => { windowFocused = true; applyWindowState(); });
  window.addEventListener('blur', () => { windowFocused = false; applyWindowState(); });
}

async function start(): Promise<void> {
  try {
    const loaded: NativeReply = isNative ? await native('load') : { library: JSON.parse(localStorage.getItem(previewKey) || 'null'), pinned: false, hotkeyAvailable: true, themeID: localStorage.getItem(previewThemeKey) || SYSTEM_THEME, windowStyle: JSON.parse(localStorage.getItem(previewWindowStyleKey) || 'null'), fontSize: Number(localStorage.getItem(previewFontSizeKey) || DEFAULT_FONT_SIZE), noteFonts: JSON.parse(localStorage.getItem(previewNoteFontKey) || 'null'), ocrEnabled: localStorage.getItem(previewOCRKey) === 'true', syntaxThemeID: localStorage.getItem('foldnote-preview-syntax-v1') || 'app', focused: document.hasFocus() };
    themeID = applyAppearance(document.documentElement, loaded.themeID);
    ocrEnabled = loaded.ocrEnabled === true;
    syntaxThemeID = syntaxThemeIDs.includes(loaded.syntaxThemeID || '') ? loaded.syntaxThemeID! : 'app'; applySyntaxAppearance();
    startupState = { launchAtLogin: loaded.launchAtLogin === true, launchStatus: loaded.launchStatus || 'notRegistered', launchError: loaded.launchError || null, newNoteOnLaunch: loaded.newNoteOnLaunch === true };
    imageOptions = loaded.imageOptions || (!isNative ? JSON.parse(localStorage.getItem('foldnote-preview-image-v1') || '{}') : {});
    noteFonts = resolveNoteFontState(loaded.noteFonts ?? DEFAULT_NOTE_FONT_STATE);
    try { await applyNoteFont(document.documentElement, noteFonts); noteFontWarning = noteFonts.warning || ''; }
    catch {
      noteFonts = resolveNoteFontState({ ...noteFonts, selection: DEFAULT_NOTE_FONT_STATE.selection });
      await applyNoteFont(document.documentElement, noteFonts);
      noteFontWarning = 'The saved font could not be loaded. Select a font in Settings → Window.';
    }
    fontSize = resolveFontSize(loaded.fontSize); applyFontSize();
    fontSizeQueue = new PreferenceSaveQueue<number>({ save: async value => { if (isNative) await native('fontSize', { fontSize: value }); else localStorage.setItem(previewFontSizeKey, String(value)); } }, (state, error) => {
      fontError = state === 'error'; fontStatus = state === 'saving' ? 'Saving…' : state === 'error' ? 'Not saved · Retry' : isNative ? 'Saved on this Mac' : 'Saved in preview'; applyFontSize(); if (error) showError(error);
    });
    windowStyle = resolveWindowStyle(loaded.windowStyle); windowFocused = loaded.focused !== false; applyWindowState();
    windowStyleQueue = new WindowStyleSaveQueue({ save: async style => {
      if (isNative) await native('windowStyle', { style });
      else localStorage.setItem(previewWindowStyleKey, JSON.stringify(style));
    } }, (status, error) => {
      windowStyleError = status === 'error';
      windowStyleStatus = status === 'saving' ? 'Saving…' : status === 'error' ? 'Not saved · Retry' : isNative ? 'Saved on this Mac' : 'Saved in preview';
      refreshWindowStyleControls();
      if (error) showError(error);
    });
    library = loaded.library ? validateLibrary(loaded.library) : welcomeLibrary(crypto.randomUUID(), new Date().toISOString());
    const unpurged = library; library = purgeExpiredTrash(library, new Date().toISOString());
    explorerState = createExplorerState(library);
    pinned = loaded.pinned || false;
    queue = new SaveQueue({ save: async value => { if (isNative) await native('save', { library: value }); else localStorage.setItem(previewKey, JSON.stringify(value)); } }, (status, error) => {
      if (status === 'error') { saveError = error instanceof Error ? error.message : 'Could not save changes'; showSaveFailure(); }
      else if (status === 'saved') { saveError = ''; saveFailureNotice?.remove(); saveFailureNotice = undefined; indexCoordinator?.schedule(library.notes); }
    });
    indexCoordinator = new SemanticIndexCoordinator({
      status: () => native<SemanticStatus>('semanticStatus'),
      index: async (notes, force) => {
        automaticIndexRunning = true;
        if (!explicitIndexRequests) void refreshSemanticSettings?.();
        try { return await native<Record<string, unknown>>('semanticIndex', { notes, force }); }
        finally { automaticIndexRunning = false; if (!explicitIndexRequests) void refreshSemanticSettings?.(); }
      },
    }, {
      onIndexed: () => { automaticIndexError = ''; if (!explicitIndexRequests) void refreshSemanticSettings?.(); },
      onError: error => { automaticIndexError = error instanceof Error ? error.message : 'Unable to update the search index.'; if (!explicitIndexRequests) void refreshSemanticSettings?.(); },
    });
    sessionLoaded = true; render(); indexCoordinator.schedule(library.notes, true);
    if (!loaded.library || unpurged !== library) persist();
    window.setInterval(() => { const next = purgeExpiredTrash(library, new Date().toISOString()); if (next !== library) { library = next; persist(); if (view !== 'note') render(); else renderCounter(); } }, 3_600_000);
    await native('ready');
    for (const command of commandsWaiting.splice(0)) await window.foldnoteCommand(command);
    if (noteFontWarning) notify(noteFontWarning, true);
    if (loaded.themeWarning) notify(loaded.themeWarning, true);
    if (loaded.featureWarning) notify(loaded.featureWarning, true);
    if (loaded.hotkeyAvailable === false) notify('The shortcut ⌃⌥Space is unavailable. Open Banana Notes from the menu bar.', true);
  } catch (error) {
    app.replaceChildren(); const recovery = element('main', 'recovery');
    recovery.append(element('h1', '', 'Unable to open notes'), element('p', '', (error as Error).message), element('p', '', 'Reopen Banana Notes to retry, or open the data folder. The original files have not been changed.'), button('Open local data folder', FolderOpen, () => native('openData'), 'primary-button', 'Open data folder'));
    app.append(recovery);
  }
}
void start();
