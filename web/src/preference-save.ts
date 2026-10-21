export interface PreferenceRepository<T> { save(value: T): Promise<void> }
export type PreferenceStatus = (state: 'saving' | 'saved' | 'error', error?: unknown) => void;

/** Serial effects with a detached, replaceable latest pending preference. */
export class PreferenceSaveQueue<T> {
  private pending: { value: T } | undefined;
  private running: Promise<void> | undefined;
  constructor(private repository: PreferenceRepository<T>, private status: PreferenceStatus) {}
  enqueue(value: T): void { this.pending = { value: structuredClone(value) }; this.start(); }
  private start(): void {
    if (this.running) return;
    const task = this.drain();
    const settled = task.then(succeeded => {
      if (this.running !== settled) return;
      this.running = undefined;
      if (succeeded && this.pending) this.start();
    });
    this.running = settled;
  }
  private async drain(): Promise<boolean> {
    while (this.pending) {
      const snapshot = this.pending; this.pending = undefined; this.status('saving');
      try { await this.repository.save(snapshot.value); this.status('saved'); }
      catch (error) { this.pending ??= snapshot; this.status('error', error); return false; }
    }
    return true;
  }
  async flush(): Promise<void> {
    if (!this.running && this.pending) this.start();
    while (this.running) await this.running;
    if (this.pending) throw new Error('Your latest preferences have not been saved. Retry before quitting.');
  }
}
