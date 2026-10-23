export const DEFAULT_FONT_SIZE = 15;
export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 32;
export function resolveFontSize(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, value))) : DEFAULT_FONT_SIZE;
}
export function stepFontSize(current: number, delta: -1 | 1): number { return resolveFontSize(resolveFontSize(current) + delta); }
