import type { ViewerPort, ViewerEvent } from '../application/ports';
import { DEFAULT_VIEWER_PREFERENCES, isSafeViewerLink, normalizeViewerPreferences, type ViewerDefaultAppOutcome, type ViewerDefaultAppStatus, type ViewerPreferences, type ViewerSnapshot } from '../domain/model';

const PREFERENCES_KEY = 'banana-viewer-preferences-v1';
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkd']);

/** Isolated browser fallback: it reads one explicitly chosen file and stores only Viewer preferences. */
export class BrowserViewerAdapter implements ViewerPort {
  private snapshot: ViewerSnapshot = { document: { kind: 'empty' }, preferences: { ...DEFAULT_VIEWER_PREFERENCES }, editing: { kind: 'unavailable' }, externalChange: false };
  private readonly listeners = new Set<(event: ViewerEvent) => void>();
  private readonly input: HTMLInputElement;
  private currentFile: File | undefined;
  private revision = 0;
  private documentSequence = 0;
  private currentDocumentID = '';
  private readSequence = 0;

  constructor(private readonly targetWindow: Window = window) {
    this.input = targetWindow.document.createElement('input');
    this.input.type = 'file';
    this.input.accept = '.md,.markdown,.mdown,.mkd,text/markdown';
    this.input.hidden = true;
    this.input.setAttribute('aria-hidden', 'true');
    this.input.addEventListener('change', () => {
      const file = this.input.files?.[0];
      this.input.value = '';
      if (file) void this.readFile(file);
    });
    targetWindow.document.body.append(this.input);
    targetWindow.addEventListener('storage', this.onStorage);
  }

  async bootstrap(): Promise<ViewerSnapshot> {
    let preferences: ViewerPreferences = { ...DEFAULT_VIEWER_PREFERENCES };
    try {
      const raw = this.targetWindow.localStorage.getItem(PREFERENCES_KEY);
      if (raw !== null) preferences = normalizeViewerPreferences(JSON.parse(raw));
    } catch { /* An inaccessible or malformed browser preference store starts from isolated defaults. */ }
    this.snapshot = { ...this.snapshot, preferences };
    return this.snapshot;
  }

  async open(): Promise<null> {
    this.input.value = '';
    this.input.click();
    return null;
  }

  async reload(): Promise<null> {
    if (this.currentFile) await this.readFile(this.currentFile, false);
    return null;
  }
  async discardAndReload(): Promise<null> { return this.reload(); }

  async unlockDocument(): Promise<ViewerSnapshot> { throw this.editingUnavailable(); }
  async lockDocument(): Promise<ViewerSnapshot> { throw this.editingUnavailable(); }
  async setDocumentDirty(_dirty: boolean): Promise<ViewerSnapshot> { throw this.editingUnavailable(); }
  async keepDocumentEdits(): Promise<ViewerSnapshot> { throw this.editingUnavailable(); }
  async saveDocument(_expectedRevision: string, _markdown: string): Promise<never> { throw this.editingUnavailable(); }

  async savePreferences(preferences: ViewerPreferences): Promise<ViewerSnapshot> {
    const confirmed = normalizeViewerPreferences(preferences);
    this.targetWindow.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(confirmed));
    this.snapshot = { ...this.snapshot, preferences: confirmed };
    this.emit({ kind: 'snapshot', snapshot: this.snapshot });
    return this.snapshot;
  }

  async queryDefaultAppStatus(): Promise<ViewerDefaultAppStatus> { return { kind: 'unavailable' }; }

  async setDefaultApp(_enabled: boolean): Promise<ViewerDefaultAppOutcome> { return { kind: 'unavailable' }; }

  async openLink(href: string): Promise<null> {
    if (!isSafeViewerLink(href) || href.startsWith('#')) throw new Error('This link cannot be opened.');
    const parsed = new URL(href, this.targetWindow.location.href);
    this.targetWindow.open(parsed.href, '_blank', 'noopener,noreferrer');
    return null;
  }

  async reveal(): Promise<null> { return null; }

  subscribe(listener: (event: ViewerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.targetWindow.removeEventListener('storage', this.onStorage);
    this.input.remove();
    this.listeners.clear();
  }

  private readonly onStorage = (event: StorageEvent): void => {
    if (event.key !== PREFERENCES_KEY || event.newValue === null) return;
    try {
      const preferences = normalizeViewerPreferences(JSON.parse(event.newValue));
      this.snapshot = { ...this.snapshot, preferences };
      this.emit({ kind: 'snapshot', snapshot: this.snapshot });
    } catch {
      this.emit({ kind: 'fault', message: 'Viewer preferences changed in another window but could not be read.' });
    }
  };

  private readBytes(file: File): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const Reader = (this.targetWindow as Window & typeof globalThis).FileReader;
      const reader = new Reader();
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) resolve(reader.result);
        else reject(new Error('The selected Markdown file could not be read.'));
      };
      reader.onerror = () => reject(reader.error ?? new Error('The selected Markdown file could not be read.'));
      reader.onabort = () => reject(new Error('The selected Markdown file read was canceled.'));
      reader.readAsArrayBuffer(file);
    });
  }

  private async readFile(file: File, newDocument = true): Promise<void> {
    const sequence = ++this.readSequence;
    this.currentFile = file;
    if (newDocument) this.currentDocumentID = `browser-${++this.documentSequence}`;
    try {
      const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
      if (!SUPPORTED_EXTENSIONS.has(extension)) throw new Error('Choose a Markdown document (.md, .markdown, .mdown, or .mkd).');
      if (file.size > MAX_DOCUMENT_BYTES) throw new Error('This Markdown document is larger than the 8 MB viewer limit.');
      const bytes = await this.readBytes(file);
      if (sequence !== this.readSequence) return;
      if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error('This Markdown document is larger than the 8 MB viewer limit.');
      let markdown: string;
      try { markdown = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { throw new Error('This document is not valid UTF-8 text.'); }
      if (sequence !== this.readSequence) return;
      const base = new URL('.', this.targetWindow.location.href).href;
      this.snapshot = {
        ...this.snapshot,
        document: { kind: 'loaded', documentID: this.currentDocumentID, name: file.name, markdown, revision: `browser-${++this.revision}`, resourceBaseURL: base },
        editing: { kind: 'unavailable' }, externalChange: false,
      };
      this.emit({ kind: 'snapshot', snapshot: this.snapshot });
    } catch (error) {
      if (sequence !== this.readSequence) return;
      const message = error instanceof Error && error.message ? error.message : 'The selected Markdown file could not be read.';
      this.snapshot = { ...this.snapshot, document: { kind: 'error', name: file.name || 'Markdown file', message } };
      this.emit({ kind: 'snapshot', snapshot: this.snapshot });
    }
  }

  private editingUnavailable(): Error { return new Error('Editing is available in the Mac app.'); }

  private emit(event: ViewerEvent): void { for (const listener of this.listeners) listener(event); }
}
