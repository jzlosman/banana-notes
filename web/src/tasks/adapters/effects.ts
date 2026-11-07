import type { Clock, IdentitySource } from '../application/ports';

/** System effects live at the composition boundary, not in domain decisions. */
export class SystemTasksClock implements Clock {
  now(): number { return Date.now(); }
}

export class RandomTaskIdentity implements IdentitySource {
  next(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    throw new Error('A secure identity source is unavailable.');
  }
}
