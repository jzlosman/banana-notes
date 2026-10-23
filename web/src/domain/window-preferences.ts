export const DEFAULT_PINNED = true;

/** Resolves an untrusted saved pin preference; absent or invalid values use the product default. */
export function resolvePinnedPreference(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_PINNED;
}
