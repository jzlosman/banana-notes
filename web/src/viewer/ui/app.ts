import { ArrowDown, ArrowUp, CodeXml, FileText, FolderOpen, Lock, LockOpen, Search, Settings, X } from 'lucide';
import { DEFAULT_NOTE_FONT_STATE, resolveNoteFontState } from '../../domain/note-font';
import { stepFontSize } from '../../domain/font-size';
import { applyAppearance } from '../../ui/appearance';
import { renderIcon } from '../../ui/icon';
import { applyCodeAppearance } from '../../ui/code-highlighting';
import { applyNoteFont } from '../../ui/note-font';
import type { NoteFontState } from '../../domain/note-font';
import { DEFAULT_VIEWER_PREFERENCES, type ViewerPreferences, type ViewerSnapshot } from '../domain/model';
import type { ViewerSession, ViewerSessionEvent } from '../application/session';
import { guardViewerMarkdownEditor, renderReadOnlyMarkdown, type ReadOnlyMarkdownRenderer } from './markdown-renderer';
import { renderViewerSettings, type ViewerSettingsView } from './settings-view';
import { createTextSearchIndex } from './find';
import { canSave, markdownForSave } from '../domain/editing';

export type ViewerApp = { dispose(): void; openSettings(): void; openFind(): void; toggleSource(): void };

type ViewMode = 'reader' | 'source' | 'settings';

function messageOf(error: unknown, fallback: string): string { return error instanceof Error && error.message ? error.message : fallback; }

export function mountViewerApp(appRoot: HTMLElement, session: ViewerSession, rawFonts: NoteFontState = DEFAULT_NOTE_FONT_STATE): ViewerApp {
  const document = appRoot.ownerDocument;
  const fonts = resolveNoteFontState(rawFonts);
  const shell = document.createElement('div'); shell.className = 'viewer-shell';
  const toolbar = document.createElement('header'); toolbar.className = 'viewer-toolbar'; toolbar.setAttribute('aria-label', 'Document controls');
  const openButton = document.createElement('button'); openButton.type = 'button'; openButton.className = 'viewer-open-button'; openButton.textContent = 'Open…'; openButton.title = 'Open a Markdown file (⌘O)'; openButton.setAttribute('aria-label', 'Open a Markdown file');
  const spacer = document.createElement('span'); spacer.className = 'viewer-toolbar-spacer';
  const editingLabel = document.createElement('span'); editingLabel.className = 'viewer-editing-label'; editingLabel.textContent = 'Editing'; editingLabel.hidden = true; editingLabel.setAttribute('aria-live', 'polite');
  const lockButton = iconButton(Lock, 'Unlock to Edit', 'Unlock to Edit (⌘E)');
  lockButton.setAttribute('aria-pressed', 'false');
  const findButton = iconButton(Search, 'Find', 'Find in document (⌘F)');
  const sourceButton = iconButton(CodeXml, 'Source', 'View Markdown source (⌘⇧M)');
  const settingsButton = iconButton(Settings, 'Settings', 'Viewer settings');
  toolbar.append(openButton, spacer, editingLabel, lockButton, findButton, sourceButton, settingsButton);

  const findBar = document.createElement('div'); findBar.className = 'viewer-find-bar search-field'; findBar.hidden = true;
  const findIcon = renderIcon(Search, 15); findBar.append(findIcon);
  const findInput = document.createElement('input'); findInput.type = 'search'; findInput.placeholder = 'Find in document'; findInput.setAttribute('aria-label', 'Find in document');
  const count = document.createElement('span'); count.className = 'viewer-find-count'; count.setAttribute('role', 'status'); count.setAttribute('aria-live', 'polite');
  const previous = iconButton(ArrowUp, 'Previous match', 'Previous match (⇧↵)'); previous.classList.add('viewer-find-step');
  const next = iconButton(ArrowDown, 'Next match', 'Next match (↵)'); next.classList.add('viewer-find-step');
  const closeFind = iconButton(X, 'Close Find', 'Close Find (Esc)'); closeFind.classList.add('viewer-find-close');
  findBar.append(findInput, count, previous, next, closeFind);
  const conflictBanner = document.createElement('div'); conflictBanner.className = 'viewer-conflict-banner'; conflictBanner.setAttribute('role', 'status'); conflictBanner.hidden = true;
  const conflictMessage = document.createElement('span'); conflictMessage.textContent = 'This file changed on disk.';
  const reloadChanges = document.createElement('button'); reloadChanges.type = 'button'; reloadChanges.className = 'text-button'; reloadChanges.textContent = 'Reload';
  const keepChanges = document.createElement('button'); keepChanges.type = 'button'; keepChanges.className = 'text-button'; keepChanges.textContent = 'Keep My Edits';
  conflictBanner.append(conflictMessage, reloadChanges, keepChanges);
  const main = document.createElement('main'); main.className = 'viewer-body'; main.setAttribute('aria-live', 'off');
  shell.append(toolbar, findBar, conflictBanner, main); appRoot.replaceChildren(shell); appRoot.removeAttribute('aria-busy');

  let snapshot: ViewerSnapshot | undefined;
  let mode: ViewMode = 'reader';
  let renderer: ReadOnlyMarkdownRenderer | undefined;
  let rendererHost: HTMLElement | undefined;
  let settings: ViewerSettingsView | undefined;
  let settingsReturnFocus: HTMLElement | null = null;
  let settingsReturnScroll = 0;
  let settingsReturnMode: Exclude<ViewMode, 'settings'> = 'reader';
  let findReturnFocus: HTMLElement | null = null;
  let findIndex = 0;
  let statusMessage = '';
  let disposed = false;
  let settingsSaving = 0;
  let fontApplicationRevision = 0;
  let renderedDocumentKey = '';
  let renderedDocumentID = '';
  let scrollRestoreCleanup: (() => void) | undefined;
  let renderedSourceKey = '';
  let sourceElement: HTMLElement | undefined;
  let originalMarkdown = '';
  let baselineMarkdown = '';
  let sourceDraft = '';
  let sourceMode = false;
  let replaceVersionPending = false;
  let replaceVersionConfirmed = false;
  let preserveEditSurface = false;

  const showStatus = (message: string) => {
    statusMessage = message;
    let status = shell.querySelector<HTMLElement>('.viewer-status');
    if (!status) { status = document.createElement('p'); status.className = 'viewer-status'; status.setAttribute('role', 'alert'); shell.append(status); }
    status.textContent = message; status.hidden = !message;
  };
  const clearStatus = () => { statusMessage = ''; const status = shell.querySelector<HTMLElement>('.viewer-status'); if (status) status.hidden = true; };
  const applyPreferences = (preferences: ViewerPreferences) => {
    applyAppearance(document.documentElement, preferences.themeID);
    applyCodeAppearance(document.documentElement, preferences.syntaxThemeID, preferences.themeID, document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
    document.documentElement.style.setProperty('--note-font-size', `${preferences.fontSize}px`);
    const fontState = { selection: { fontID: preferences.fontID, weight: preferences.fontWeight }, fonts: fonts.fonts };
    const fontRevision = ++fontApplicationRevision;
    void applyNoteFont(document.documentElement, fontState, () => fontRevision === fontApplicationRevision).catch(error => {
      if (fontRevision === fontApplicationRevision) showStatus(messageOf(error, 'The viewer font could not be loaded.'));
    });
    document.documentElement.style.setProperty('--viewer-focused-opacity', String(preferences.focusedOpacity));
    document.documentElement.style.setProperty('--viewer-unfocused-opacity', String(preferences.unfocusedOpacity));
    document.documentElement.style.setProperty('--viewer-glass', String(preferences.glass));
  };

  const loadedDocument = (): Extract<ViewerSnapshot['document'], { kind: 'loaded' }> | undefined => snapshot?.document.kind === 'loaded' ? snapshot.document : undefined;
  const disposeRenderer = () => { scrollRestoreCleanup?.(); scrollRestoreCleanup = undefined; renderer?.destroy(); renderer = undefined; rendererHost = undefined; renderedDocumentKey = ''; renderedDocumentID = ''; };
  const disposeSource = () => { sourceElement?.remove(); sourceElement = undefined; renderedSourceKey = ''; };
  const editState = () => snapshot?.editing.kind === 'unlocked' ? snapshot.editing : undefined;
  const currentEditedText = (): string => sourceMode
    ? sourceDraft
    : renderer?.editor.getMarkdown() ?? originalMarkdown;
  const updateDirtyFromText = (text: string) => {
    const state = editState();
    if (!state) return;
    const dirty = sourceMode ? text !== originalMarkdown : text !== baselineMarkdown;
    if (state.dirty !== dirty) void session.setDocumentDirty(dirty).catch(error => showStatus(messageOf(error, 'Editing state could not be updated.')));
  };
  const renderEmpty = () => {
    disposeRenderer(); disposeSource(); main.className = 'viewer-body viewer-empty-state quiet-scroll';
    const card = document.createElement('section'); card.className = 'viewer-empty';
    const icon = renderIcon(FileText, 27); icon.classList.add('viewer-empty-icon');
    const heading = document.createElement('h1'); heading.textContent = 'Open a Markdown file';
    const description = document.createElement('p'); description.textContent = 'Choose a file to read it here. Your files stay where they are.';
    const choose = document.createElement('button'); choose.type = 'button'; choose.className = 'primary-button viewer-empty-open'; choose.append(renderIcon(FolderOpen, 16), document.createTextNode('Open…'));
    const hint = document.createElement('span'); hint.className = 'viewer-shortcut-hint'; hint.textContent = '⌘O'; choose.append(hint);
    choose.addEventListener('click', () => void run(session.open(), 'The file picker could not be opened.'));
    card.append(icon, heading, description, choose); main.replaceChildren(card);
  };
  const renderError = (name: string, message: string) => {
    disposeRenderer(); disposeSource(); main.className = 'viewer-body viewer-document-error quiet-scroll';
    const card = document.createElement('section'); card.className = 'viewer-error-card';
    const heading = document.createElement('h1'); heading.textContent = name;
    const explanation = document.createElement('p'); explanation.textContent = message; explanation.setAttribute('role', 'alert');
    const actions = document.createElement('div'); actions.className = 'viewer-error-actions';
    const reload = document.createElement('button'); reload.type = 'button'; reload.className = 'text-button'; reload.textContent = 'Reload'; reload.addEventListener('click', () => void run(session.reload(), 'The document could not be reloaded.'));
    const choose = document.createElement('button'); choose.type = 'button'; choose.className = 'primary-button'; choose.textContent = 'Open…'; choose.addEventListener('click', () => void run(session.open(), 'The file picker could not be opened.'));
    actions.append(reload, choose); card.append(heading, explanation, actions); main.replaceChildren(card);
  };

  const activeSearchIndex = () => {
    const surface = main.querySelector<HTMLElement>('.viewer-source-text, .viewer-markdown');
    return surface ? createTextSearchIndex(surface) : undefined;
  };
  const findMatches = (): number[] => {
    if (mode === 'source' && sourceElement?.tagName === 'TEXTAREA') {
      const query = findInput.value.trim();
      return query ? [...(sourceElement as HTMLTextAreaElement).value.matchAll(new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'))]
        .map(match => match.index ?? 0) : [];
    }
    return activeSearchIndex()?.matches(findInput.value) ?? [];
  };
  const updateFindCount = (matches: number[]) => {
    count.textContent = matches.length ? `${Math.min(findIndex + 1, matches.length)} of ${matches.length}` : findInput.value.trim() ? 'No matches' : '';
  };
  const navigateMatch = (delta: number) => {
    const matches = findMatches();
    if (!matches.length) { findIndex = 0; updateFindCount(matches); return; }
    findIndex = (findIndex + delta + matches.length) % matches.length; updateFindCount(matches);
    const index = activeSearchIndex();
    const start = matches[findIndex];
    if (start === undefined) return;
    if (mode === 'source' && sourceElement?.tagName === 'TEXTAREA') {
      (sourceElement as HTMLTextAreaElement).setSelectionRange(start, start + findInput.value.trim().length);
      return;
    }
    const range = index?.range(start, findInput.value.trim().length);
    if (!range) return;
    const selection = document.defaultView?.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    (range.startContainer.parentElement as HTMLElement | null)?.scrollIntoView?.({
      block: 'center', behavior: document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  };
  const openFind = () => {
    if (!loadedDocument() || mode === 'settings') return;
    findReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : findButton;
    findBar.hidden = false; findInput.focus(); findInput.select();
    const matches = findMatches(); findIndex = 0; updateFindCount(matches); if (matches.length) navigateMatch(0);
  };
  const closeFindBar = (restore = true) => {
    if (findBar.hidden) return;
    findBar.hidden = true; findInput.value = ''; count.textContent = '';
    document.defaultView?.getSelection()?.removeAllRanges();
    if (restore && findReturnFocus?.isConnected) findReturnFocus.focus();
  };
  const renderSource = () => {
    disposeRenderer(); main.className = 'viewer-body viewer-source-view quiet-scroll';
    const current = loadedDocument();
    if (!current) return;
    const unlocked = snapshot?.editing.kind === 'unlocked';
    const key = `${current.revision}\u0000${current.markdown}\u0000${unlocked ? 'editing' : 'locked'}`;
    if (sourceElement && renderedSourceKey === key && main.contains(sourceElement)) return;
    disposeSource();
    const sourceNote = document.createElement('p'); sourceNote.className = 'viewer-source-note';
    sourceNote.textContent = 'Editing Markdown source to preserve this document.';
    sourceNote.hidden = !unlocked || !sourceMode;
    if (unlocked) {
      const sourceEditor = document.createElement('textarea'); sourceEditor.className = 'viewer-source-text viewer-source-editor quiet-scroll';
      sourceEditor.setAttribute('aria-label', `Editable Markdown source for ${current.name}`);
      sourceEditor.spellcheck = false;
      sourceEditor.value = sourceMode ? sourceDraft : current.markdown;
      sourceEditor.addEventListener('input', () => { sourceDraft = sourceEditor.value; updateDirtyFromText(sourceDraft); });
      sourceElement = sourceEditor;
    } else {
      const pre = document.createElement('pre'); pre.className = 'viewer-source-text quiet-scroll';
      pre.setAttribute('aria-label', `Markdown source for ${current.name}`); pre.setAttribute('role', 'document');
      pre.textContent = current.markdown; sourceElement = pre;
    }
    renderedSourceKey = key; main.replaceChildren(sourceNote, sourceElement);
  };
  const renderReader = () => {
    const current = loadedDocument();
    if (!current) return;
    const key = `${current.documentID}\u0000${current.revision}\u0000${current.resourceBaseURL}\u0000${current.markdown}`;
    main.className = 'viewer-body viewer-reader quiet-scroll';
    if (renderer && rendererHost && renderedDocumentKey === key) {
      if (!main.contains(renderer.root)) main.replaceChildren(rendererHost);
      renderer.setEditable(snapshot?.editing.kind === 'unlocked', text => updateDirtyFromText(text));
      return;
    }
    const scrollTop = renderer && renderedDocumentID === current.documentID ? main.scrollTop : 0;
    disposeRenderer(); disposeSource();
    const host = document.createElement('article'); host.className = 'viewer-reader-content'; rendererHost = host; main.replaceChildren(host);
    renderer = renderReadOnlyMarkdown(host, current.markdown, current.resourceBaseURL, href => {
      void run(session.openLink(href), 'This link could not be opened.');
    });
    if (snapshot?.editing.kind === 'unlocked') {
      if (!snapshot.editing.dirty) {
        originalMarkdown = current.markdown;
        baselineMarkdown = renderer.editor.getMarkdown();
      }
      renderer.setEditable(true, text => updateDirtyFromText(text));
    } else renderer.setEditable(false);
    renderedDocumentKey = key; renderedDocumentID = current.documentID;
    const pendingImages = new Set([...host.querySelectorAll('img')].filter(image => !image.complete));
    if (!pendingImages.size || scrollTop === 0) { main.scrollTop = scrollTop; return; }

    let userScrolled = false;
    let expectedScrollTop: number | undefined;
    const onScroll = () => { if (expectedScrollTop !== main.scrollTop) userScrolled = true; };
    const restoreScroll = () => {
      if (userScrolled) return;
      main.scrollTop = scrollTop; expectedScrollTop = main.scrollTop;
    };
    const onImageFinished = (event: Event) => {
      const image = event.currentTarget as HTMLImageElement;
      pendingImages.delete(image);
      image.removeEventListener('load', onImageFinished);
      image.removeEventListener('error', onImageFinished);
      if (!pendingImages.size) { restoreScroll(); cleanup(); }
    };
    const cleanup = () => {
      main.removeEventListener('scroll', onScroll);
      for (const image of pendingImages) {
        image.removeEventListener('load', onImageFinished);
        image.removeEventListener('error', onImageFinished);
      }
      if (scrollRestoreCleanup === cleanup) scrollRestoreCleanup = undefined;
    };
    scrollRestoreCleanup = cleanup;
    main.addEventListener('scroll', onScroll);
    for (const image of pendingImages) {
      image.addEventListener('load', onImageFinished);
      image.addEventListener('error', onImageFinished);
    }
    restoreScroll();
  };
  const makeSettings = () => {
    if (!snapshot) return;
    settings?.dispose();
    settings = renderViewerSettings({
      document, preferences: snapshot.preferences, fonts,
      onChange: async patch => {
        try {
          const confirmed = await session.updatePreferences(patch);
          settings?.update(confirmed.preferences); settings?.clearError(); clearStatus();
        } catch (error) {
          const message = messageOf(error, 'Viewer preferences could not be saved.');
          settings?.setError(message); showStatus(message); throw error;
        }
      },
      onQueryDefaultAppStatus: () => session.queryDefaultAppStatus(),
      onSetDefaultApp: enabled => session.setDefaultApp(enabled),
      onDone: closeSettings,
    });
  };
  const renderSettings = () => {
    disposeSource();
    if (!settings) makeSettings();
    if (settings) { main.className = 'viewer-body viewer-settings-body'; main.replaceChildren(settings.element); }
  };
  const render = () => {
    if (!snapshot || disposed) return;
    applyPreferences(snapshot.preferences);
    findButton.disabled = mode === 'settings' || snapshot.document.kind !== 'loaded';
    sourceButton.disabled = mode === 'settings' || snapshot.document.kind !== 'loaded';
    sourceButton.classList.toggle('active', mode === 'source');
    const editingAvailable = snapshot.editing.kind !== 'unavailable';
    const unlocked = snapshot.editing.kind === 'unlocked';
    lockButton.disabled = !editingAvailable || mode === 'settings' || snapshot.document.kind !== 'loaded';
    lockButton.replaceChildren(renderIcon(unlocked ? LockOpen : Lock, 18));
    lockButton.setAttribute('aria-label', unlocked ? 'Lock' : 'Unlock to Edit');
    lockButton.setAttribute('aria-pressed', String(unlocked));
    lockButton.title = editingAvailable ? (unlocked ? 'Lock (⌘E)' : 'Unlock to Edit (⌘E)') : 'Editing is available in the Mac app';
    editingLabel.hidden = !unlocked;
    editingLabel.replaceChildren();
    if (snapshot.editing.kind === 'unlocked' && snapshot.editing.dirty) {
      const dot = document.createElement('span'); dot.className = 'viewer-unsaved-dot'; dot.setAttribute('aria-hidden', 'true');
      editingLabel.append(dot, document.createTextNode('Unsaved'));
    } else editingLabel.textContent = 'Editing';
    conflictBanner.hidden = !snapshot.externalChange;
    if (!editingAvailable) lockButton.setAttribute('aria-description', 'Editing is available in the Mac app');
    else lockButton.removeAttribute('aria-description');
    settingsButton.disabled = mode === 'settings';
    settingsButton.setAttribute('aria-pressed', String(mode === 'settings'));
    openButton.disabled = settingsSaving > 0;
    if (mode === 'settings') renderSettings();
    else if (snapshot.document.kind === 'empty') { mode = 'reader'; renderEmpty(); }
    else if (snapshot.document.kind === 'error') { mode = 'reader'; renderError(snapshot.document.name, snapshot.document.message); }
    else if (mode === 'source') renderSource();
    else { mode = 'reader'; renderReader(); }
    if (statusMessage) showStatus(statusMessage);
  };
  function openSettings(): void {
    if (mode === 'settings') return;
    settingsReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : settingsButton;
    settingsReturnScroll = main.scrollTop; settingsReturnMode = mode;
    closeFindBar(false); mode = 'settings'; makeSettings(); render();
    settings?.focus();
  }
  function closeSettings(): void {
    if (mode !== 'settings') return;
    settings?.dispose(); settings = undefined; mode = settingsReturnMode; render(); main.scrollTop = settingsReturnScroll;
    if (settingsReturnFocus?.isConnected) settingsReturnFocus.focus(); else settingsButton.focus();
  }
  function toggleSource(): void {
    if (!loadedDocument() || mode === 'settings') return;
    if (snapshot?.editing.kind === 'unlocked') {
      if (sourceMode) return;
      sourceDraft = renderer ? markdownForSave(originalMarkdown, baselineMarkdown, renderer.editor.getMarkdown()) : originalMarkdown;
      sourceMode = true;
    }
    closeFindBar(false); disposeRenderer(); mode = mode === 'source' ? 'reader' : 'source'; render();
  }
  async function toggleEditing(): Promise<void> {
    if (!snapshot || snapshot.editing.kind === 'unavailable' || !loadedDocument()) return;
    if (snapshot.editing.kind === 'unlocked') {
      await run(session.lockDocument(), 'The document could not be locked.');
      return;
    }
    const current = loadedDocument()!;
    const scrollTop = main.scrollTop, scrollLeft = main.scrollLeft;
    originalMarkdown = current.markdown;
    sourceMode = mode === 'source';
    if (sourceMode) {
      baselineMarkdown = originalMarkdown;
      sourceDraft = originalMarkdown;
    } else {
      if (!renderer) renderReader();
      if (!renderer) return;
      const guard = guardViewerMarkdownEditor(current.markdown, renderer.editor);
      if (guard.kind === 'source') {
        disposeRenderer();
        mode = 'source';
        sourceMode = true;
        baselineMarkdown = originalMarkdown;
        sourceDraft = originalMarkdown;
      } else {
        baselineMarkdown = guard.editor.getMarkdown();
        sourceMode = false;
      }
    }
    const unlocked = await run(session.unlockDocument(), 'The document could not be unlocked.');
    if (unlocked) { main.scrollTop = scrollTop; main.scrollLeft = scrollLeft; }
  }
  async function saveCurrentDocument(): Promise<void> {
    const current = loadedDocument();
    if (!current || !snapshot || snapshot.editing.kind === 'unavailable' || !canSave(snapshot.editing)) return;
    if (replaceVersionPending && !replaceVersionConfirmed) {
      if (!document.defaultView?.confirm('Replace the version on disk?')) return;
      replaceVersionConfirmed = true;
    }
    const edited = currentEditedText();
    const markdown = markdownForSave(originalMarkdown, baselineMarkdown, edited, sourceMode);
    preserveEditSurface = true;
    const result = await run(session.saveDocument(current.revision, markdown), 'The document could not be saved.');
    if (!result) { preserveEditSurface = false; return; }
    if (result.kind === 'saved') {
      replaceVersionPending = false;
      replaceVersionConfirmed = false;
      clearStatus();
    } else if (result.kind === 'conflict') {
      preserveEditSurface = false;
      showStatus('This file changed on disk. Review the conflict banner before saving again.');
    } else {
      preserveEditSurface = false;
      const messages = {
        readOnlyFile: 'This file is read-only.',
        permissionDenied: 'Permission denied. The file was not saved.',
        tooLarge: 'This document exceeds the 8 MB limit.',
        unknown: 'The file could not be saved.',
      } as const;
      showStatus(messages[result.reason]);
    }
  }
  const run = async <T>(operation: Promise<T>, fallback: string): Promise<T | undefined> => {
    try { const result = await operation; clearStatus(); return result; }
    catch (error) { showStatus(messageOf(error, fallback)); return undefined; }
  };

  openButton.addEventListener('click', () => void run(session.open(), 'The file picker could not be opened.'));
  findButton.addEventListener('click', openFind);
  lockButton.addEventListener('click', () => void toggleEditing());
  sourceButton.addEventListener('click', toggleSource);
  reloadChanges.addEventListener('click', () => void run(session.discardAndReload(), 'The document could not be reloaded.'));
  keepChanges.addEventListener('click', () => {
    preserveEditSurface = true;
    void run(session.keepDocumentEdits(), 'Your edits could not be kept.').then(result => { if (result) replaceVersionPending = true; });
  });
  settingsButton.addEventListener('click', openSettings);
  previous.addEventListener('click', () => navigateMatch(-1));
  next.addEventListener('click', () => navigateMatch(1));
  closeFind.addEventListener('click', () => closeFindBar());
  findInput.addEventListener('input', () => { findIndex = 0; const matches = findMatches(); updateFindCount(matches); if (matches.length) navigateMatch(0); });
  findInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); navigateMatch(event.shiftKey ? -1 : 1); }
    else if (event.key === 'Escape') { event.preventDefault(); closeFindBar(); }
  });
  const onGlobalKeyDown = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) { if (event.key === 'Escape' && mode === 'settings') closeSettings(); return; }
    const key = event.key.toLowerCase();
    if (key === 'o' && !event.shiftKey) { event.preventDefault(); void run(session.open(), 'The file picker could not be opened.'); }
    else if (key === 'f' && !event.shiftKey) { event.preventDefault(); openFind(); }
    else if (key === 'm' && event.shiftKey) { event.preventDefault(); toggleSource(); }
    else if (key === '=' || key === '+') { event.preventDefault(); void changeFontSize(1); }
    else if (key === '-') { event.preventDefault(); void changeFontSize(-1); }
    else if (key === '0') { event.preventDefault(); void setFontSize(15); }
  };
  const changeFontSize = async (delta: -1 | 1) => {
    if (!snapshot || mode === 'settings') return;
    await run(session.updatePreferences({ fontSize: stepFontSize(snapshot.preferences.fontSize, delta) }), 'Text size could not be saved.');
  };
  const setFontSize = async (size: number) => {
    if (!snapshot || mode === 'settings') return;
    await run(session.updatePreferences({ fontSize: size }), 'Text size could not be saved.');
  };
  document.addEventListener('keydown', onGlobalKeyDown);
  const onSessionEvent = (event: ViewerSessionEvent) => {
    if (event.kind === 'snapshot') {
      const previousDocument = snapshot?.document;
      snapshot = event.snapshot;
      const documentChanged = previousDocument?.kind !== snapshot.document.kind ||
        previousDocument?.kind === 'loaded' && snapshot.document.kind === 'loaded' &&
          (previousDocument.documentID !== snapshot.document.documentID || previousDocument.revision !== snapshot.document.revision || previousDocument.markdown !== snapshot.document.markdown || previousDocument.resourceBaseURL !== snapshot.document.resourceBaseURL);
      if (documentChanged) {
        const sameFile = previousDocument?.kind === 'loaded' && snapshot.document.kind === 'loaded' && previousDocument.documentID === snapshot.document.documentID;
        const keepEditingSurface = preserveEditSurface && sameFile;
        closeFindBar(false);
        if (keepEditingSurface && snapshot.document.kind === 'loaded') {
          if (renderer && renderedDocumentID === snapshot.document.documentID) {
            renderedDocumentKey = `${snapshot.document.documentID}\u0000${snapshot.document.revision}\u0000${snapshot.document.resourceBaseURL}\u0000${snapshot.document.markdown}`;
          }
          if (sourceElement) renderedSourceKey = `${snapshot.document.revision}\u0000${snapshot.document.markdown}\u0000${snapshot.editing.kind === 'unlocked' ? 'editing' : 'locked'}`;
          if (snapshot.editing.kind === 'unlocked' && !snapshot.editing.dirty) {
            originalMarkdown = snapshot.document.markdown;
            baselineMarkdown = sourceMode ? originalMarkdown : renderer?.editor.getMarkdown() ?? originalMarkdown;
            if (sourceMode) sourceDraft = originalMarkdown;
          }
          preserveEditSurface = false;
        } else {
          originalMarkdown = snapshot.document.kind === 'loaded' ? snapshot.document.markdown : '';
          baselineMarkdown = '';
          sourceDraft = '';
          sourceMode = false;
          replaceVersionPending = false;
          if (mode !== 'settings') mode = 'reader';
          else settingsReturnMode = 'reader';
        }
      }
      if (settings) settings.update(snapshot.preferences);
      clearStatus(); render();
    } else if (event.kind === 'preferences-saving') {
      settingsSaving++; openButton.disabled = true;
    } else if (event.kind === 'preferences-saved') {
      settingsSaving = Math.max(0, settingsSaving - 1); openButton.disabled = settingsSaving > 0;
    } else if (event.kind === 'fault') showStatus(event.message);
    else if (event.kind === 'command') {
      switch (event.command) {
        case 'settings': mode === 'settings' ? closeSettings() : openSettings(); break;
        case 'find': openFind(); break;
        case 'source': toggleSource(); break;
        case 'zoomIn': void changeFontSize(1); break;
        case 'zoomOut': void changeFontSize(-1); break;
        case 'zoomReset': void setFontSize(15); break;
        case 'toggleEditing': void toggleEditing(); break;
        case 'save': case 'saveForClose': void saveCurrentDocument(); break;
      }
    }
  };
  const unsubscribe = session.subscribe(onSessionEvent);
  const handleBootstrapFailure = (error: unknown) => {
    const message = messageOf(error, 'Banana Viewer could not start.');
    snapshot = { document: { kind: 'error', name: 'Banana Viewer', message }, preferences: { ...DEFAULT_VIEWER_PREFERENCES }, editing: { kind: 'unavailable' }, externalChange: false };
    render();
  };
  void session.bootstrap().catch(handleBootstrapFailure);

  return {
    dispose() {
      disposed = true; unsubscribe(); session.dispose(); settings?.dispose(); disposeRenderer(); document.removeEventListener('keydown', onGlobalKeyDown); shell.remove();
    },
    openSettings,
    openFind,
    toggleSource,
  };

  function iconButton(icon: typeof Search, label: string, title: string): HTMLButtonElement {
    const result = document.createElement('button'); result.type = 'button'; result.className = 'icon-button viewer-icon-button';
    result.append(renderIcon(icon, 18)); result.title = title; result.setAttribute('aria-label', label); return result;
  }
}
