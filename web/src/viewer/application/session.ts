import { normalizeViewerPreferences, type ViewerCommand, type ViewerPreferences, type ViewerSnapshot } from '../domain/model';
import type { ViewerEvent, ViewerPort } from './ports';

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
  reload(): Promise<null> { return this.port.reload(); }
  reveal(): Promise<null> { return this.port.reveal(); }
  openLink(href: string): Promise<null> { return this.port.openLink(href); }

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

  private accept(snapshot: ViewerSnapshot): void {
    this.snapshotValue = snapshot;
    this.emit({ kind: 'snapshot', snapshot });
  }

  private emit(event: ViewerSessionEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
