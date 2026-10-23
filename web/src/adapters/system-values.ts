import type { Clock, IdGenerator } from '../application/ports';

export class SystemClock implements Clock {
  now(): string { return new Date().toISOString(); }
}
export class CryptoIdGenerator implements IdGenerator {
  next(): string { return crypto.randomUUID(); }
}
