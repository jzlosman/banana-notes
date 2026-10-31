import { normalizeViewerPreferences, type ViewerCommand, type ViewerDefaultAppOutcome, type ViewerDefaultAppStatus, type ViewerPreferences, type ViewerSnapshot, type DocumentWriteResult } from '../domain/model';
import { canSave, lock, markDirty, unlock } from '../domain/editing';
import type { ViewerEvent, ViewerOpenMenuAnchor, ViewerPort } from './ports';

export type ViewerSessionEvent = ViewerEvent | { kind: 'preferences-saving' } | { kind: 'preferences-saved' };

/** Application orchestration serializes preference commands and always merges against confirmed state. */
export class ViewerSession {
  private snapshotValue: ViewerSnapshot | undefined;
  private preferenceTail: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(event: ViewerSessionEvent) => void>();
  private readonly unsubscribePort: () => void;

  constructor(private readonly port: ViewerPort) {
    this.unsubscribePort = port.subscribe(event => {
      if (event.kind === 'snapshot') { this.accept(event.snapshot); return; }
      this.emit(event);
    });
  }

  get snapshot(): ViewerSnapshot | undefined { return this.snapshotValue; }
  get supportsNativeOpenMenu(): boolean { return this.port.supportsNativeOpenMenu; }

  subscribe(listener: (event: ViewerSessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async bootstrap(): Promise<ViewerSnapshot> {
    const snapshot = await this.port.bootstrap();
    this.accept(snapshot);
    return snapshot;
  }

  open(): Promise<null> { return this.port.open(); }
  openMenu(anchor: ViewerOpenMenuAnchor): Promise<null> { return this.port.openMenu(anchor); }
  reload(): Promise<null> { return this.port.reload(); }
  discardAndReload(): Promise<null> { return this.port.discardAndReload(); }
  reveal(): Promise<null> { return this.port.reveal(); }
  openLink(href: string): Promise<null> { return this.port.openLink(href); }
  queryDefaultAppStatus(): Promise<ViewerDefaultAppStatus> { return this.port.queryDefaultAppStatus(); }
  setDefaultApp(enabled: boolean): Promise<ViewerDefaultAppOutcome> { return this.port.setDefaultApp(enabled); }

  async unlockDocument(): Promise<ViewerSnapshot> {
    const snapshot = this.requireSnapshot();
    if (snapshot.document.kind !== 'loaded' || snapshot.editing.kind === 'unavailable') throw new Error('Editing is unavailable for this document.');
    unlock(snapshot.editing);
    return this.accept(await this.port.unlockDocument());
  }

  async lockDocument(): Promise<ViewerSnapshot> {
    const snapshot = this.requireSnapshot();
    if (snapshot.editing.kind === 'unavailable') throw new Error('Editing is unavailable in this viewer.');
    if (!(snapshot.editing.kind === 'unlocked' && snapshot.editing.dirty)) lock(snapshot.editing);
    return this.accept(await this.port.lockDocument());
  }

  async setDocumentDirty(dirty: boolean): Promise<ViewerSnapshot> {
    const snapshot = this.requireSnapshot();
    if (snapshot.editing.kind === 'unavailable') throw new Error('Editing is unavailable in this viewer.');
    markDirty(snapshot.editing, dirty);
    if (snapshot.editing.kind === 'unlocked' && snapshot.editing.dirty === dirty) return snapshot;
    return this.accept(await this.port.setDocumentDirty(dirty));
  }

  async keepDocumentEdits(): Promise<ViewerSnapshot> {
    return this.accept(await this.port.keepDocumentEdits());
  }

  async saveDocument(expectedRevision: string, markdown: string): Promise<DocumentWriteResult> {
    const snapshot = this.requireSnapshot();
    if (snapshot.editing.kind === 'unavailable' || !canSave(snapshot.editing)) throw new Error('Only an unlocked, edited document can be saved.');
    return this.port.saveDocument(expectedRevision, markdown);
  }

  updatePreferences(patch: Partial<ViewerPreferences>): Promise<ViewerSnapshot> {
    const operation = this.preferenceTail.then(async () => {
      if (!this.snapshotValue) throw new Error('Banana Viewer is still starting.');
      const next = normalizeViewerPreferences({ ...this.snapshotValue.preferences, ...patch });
      this.emit({ kind: 'preferences-saving' });
      try {
        const confirmed = await this.port.savePreferences(next);
        this.accept(confirmed);
        return confirmed;
      } finally {
        this.emit({ kind: 'preferences-saved' });
      }
    });
    this.preferenceTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  dispose(): void {
    this.unsubscribePort();
    this.listeners.clear();
  }

  private requireSnapshot(): ViewerSnapshot {
    if (!this.snapshotValue) throw new Error('Banana Viewer is still starting.');
    return this.snapshotValue;
  }

  private accept(snapshot: ViewerSnapshot): ViewerSnapshot {
    this.snapshotValue = snapshot;
    this.emit({ kind: 'snapshot', snapshot });
    return snapshot;
  }

  private emit(event: ViewerSessionEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
