import type { SemanticNoteSnapshot } from './semantic-search';

export interface SemanticIndexStatus {
  enabled: boolean;
  runtimeAvailable: boolean;
  installed: boolean;
  model: string;
  unavailableReason?: string | null;
}

export interface SemanticIndexPort {
  status(): Promise<SemanticIndexStatus>;
  index(notes: readonly SemanticNoteSnapshot[], force: boolean): Promise<Record<string, unknown>>;
}

export interface SemanticIndexTimer {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SemanticIndexOptions {
  delayMs?: number;
  onIndexed?: (result: Record<string, unknown>) => void;
  onError?: (error: unknown) => void;
  timer?: SemanticIndexTimer;
}

type SnapshotNote = Pick<SemanticNoteSnapshot, 'id' | 'markdown' | 'updatedAt'>;
type CacheKey = { model: string; snapshot: string; result: Record<string, unknown> };
const defaultTimer: SemanticIndexTimer = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function detach(notes: readonly SemanticNoteSnapshot[]): SnapshotNote[] {
  return notes.filter(note => !note.trashedAt).map(({ id, markdown, updatedAt }) => ({ id, markdown, updatedAt }));
}

function snapshotKey(notes: readonly SnapshotNote[]): string {
  return JSON.stringify(notes);
}

/** Coordinates semantic-index reconciliation; all native index effects pass through one serial queue. */
export class SemanticIndexCoordinator {
  private readonly delayMs: number;
  private readonly timer: SemanticIndexTimer;
  private readonly onIndexed?: (result: Record<string, unknown>) => void;
  private readonly onError?: (error: unknown) => void;
  private pendingTimer: unknown;
  private hasPendingTimer = false;
  private generation = 0;
  private invalidationEpoch = 0;
  private disposed = false;
  private successfulKey: CacheKey | undefined;
  private indexTail: Promise<void> = Promise.resolve();

  constructor(private readonly port: SemanticIndexPort, options: SemanticIndexOptions = {}) {
    this.delayMs = options.delayMs ?? 1200;
    this.timer = options.timer ?? defaultTimer;
    this.onIndexed = options.onIndexed;
    this.onError = options.onError;
  }

  /** Debounced automatic reconciliation. Snapshots are detached at call time. */
  schedule(notes: readonly SemanticNoteSnapshot[], immediate = false): void {
    if (this.disposed) return;
    const snapshot = detach(notes);
    const generation = ++this.generation;
    this.clearTimer();
    const run = () => { void this.runScheduled(snapshot, generation); };
    if (immediate) run();
    else {
      this.hasPendingTimer = true;
      this.pendingTimer = this.timer.setTimeout(() => {
        this.hasPendingTimer = false;
        this.pendingTimer = undefined;
        run();
      }, this.delayMs);
    }
  }

  /** Explicit indexing used by queries and manual rebuild; failures are returned to the caller. */
  async refresh(notes: readonly SemanticNoteSnapshot[], force = false): Promise<Record<string, unknown>> {
    if (this.disposed) throw new Error('Semantic index coordinator is disposed.');
    const snapshot = detach(notes);
    const epoch = this.invalidationEpoch, generation = this.generation;
    return this.serialize(async () => {
      const assertActive = () => { if (this.disposed || epoch !== this.invalidationEpoch) throw new Error('Index update canceled.'); };
      assertActive();
      const status = await this.port.status(); assertActive();
      if (!status.enabled) throw new Error('Enable semantic search in Settings → Search.');
      if (!status.runtimeAvailable || !status.installed) throw new Error(status.unavailableReason || 'The selected search engine is not ready. Check Settings → Search.');
      return this.indexIfNeeded(snapshot, status.model, force, generation);
    });
  }

  /** Cancels automatic work and prevents old background completions from updating state or callbacks. */
  invalidate(): void {
    this.generation++; this.invalidationEpoch++;
    this.clearTimer();
    this.successfulKey = undefined;
  }

  dispose(): void {
    if (this.disposed) return;
    this.invalidate();
    this.disposed = true;
  }

  private async runScheduled(snapshot: SnapshotNote[], generation: number): Promise<void> {
    try {
      await this.serialize(async () => {
        if (!this.isCurrent(generation)) return;
        const status = await this.port.status();
        if (!this.isCurrent(generation) || !eligible(status)) return;
        await this.indexIfNeeded(snapshot, status.model, false, generation);
      });
    } catch (error) {
      if (this.isCurrent(generation)) this.onError?.(error);
    }
  }

  private async indexIfNeeded(notes: SnapshotNote[], model: string, force: boolean, generation: number): Promise<Record<string, unknown>> {
    const key: Omit<CacheKey, 'result'> = { model, snapshot: snapshotKey(notes) };
    if (!force && sameKey(this.successfulKey, key)) return this.successfulKey!.result;
    const result = await this.port.index(notes, force);
    if (generation === this.generation && !this.disposed) {
      this.successfulKey = { ...key, result };
      this.onIndexed?.(result);
    }
    return result;
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.indexTail.then(operation, operation);
    this.indexTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private clearTimer(): void {
    if (this.hasPendingTimer) this.timer.clearTimeout(this.pendingTimer);
    this.hasPendingTimer = false;
    this.pendingTimer = undefined;
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }
}

function eligible(status: SemanticIndexStatus): boolean {
  return status.enabled && status.runtimeAvailable && status.installed;
}

function sameKey(left: CacheKey | undefined, right: Omit<CacheKey, 'result'>): boolean {
  return left?.model === right.model && left.snapshot === right.snapshot;
}
