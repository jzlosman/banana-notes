import { type Library } from '../domain/library';
import type { LibraryRepository } from './ports';
export type { LibraryRepository } from './ports';
/** One effect at a time; a newer snapshot supersedes only snapshots not yet written. */
export class SaveQueue {
  private pending: Library | undefined;
  private running: Promise<void> | undefined;
  constructor(private repository: LibraryRepository, private status: (state: 'saving' | 'saved' | 'error', error?: unknown) => void) {}
  enqueue(library: Library): void { this.pending = structuredClone(library); this.start(); }
  private start(): void {
    if (this.running) return;
    this.running = this.drain().finally(() => { this.running = undefined; });
  }
  private async drain(): Promise<void> {
    while (this.pending) {
      const value = this.pending;
      this.pending = undefined;
      this.status('saving');
      try { await this.repository.save(value); this.status('saved'); }
      catch (error) {
        // Keep the newest unsaved snapshot available for an explicit retry.
        this.pending ??= value;
        this.status('error', error);
        return;
      }
    }
  }
  async flush(): Promise<void> {
    if (this.running) await this.running;
    if (this.pending) { this.start(); await this.running; }
    if (this.pending) throw new Error('Your latest changes have not been saved. Retry before quitting.');
  }
}
