import type { Library } from '../domain/library';

/** Mutable application session boundary for the current library snapshot. */
export class LibrarySession {
  private revision = 0;
  constructor(private current: Library) {}
  get library(): Library { return this.current; }
  get version(): number { return this.revision; }
  replace(next: Library): Library {
    if (next !== this.current) { this.current = next; this.revision++; }
    return this.current;
  }
}
