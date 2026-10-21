import { PreferenceSaveQueue, type PreferenceRepository } from './preference-save';

export type WindowStyle = {
  focusedOpacity: number;
  unfocusedOpacity: number;
  glass: number;
};

export const DEFAULT_WINDOW_STYLE: WindowStyle = {
  focusedOpacity: 1,
  unfocusedOpacity: 1,
  glass: 0,
};

const bounded = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;

export function resolveWindowStyle(value: unknown): WindowStyle {
  const candidate = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    focusedOpacity: bounded(candidate.focusedOpacity, DEFAULT_WINDOW_STYLE.focusedOpacity, 0.05, 1),
    unfocusedOpacity: bounded(candidate.unfocusedOpacity, DEFAULT_WINDOW_STYLE.unfocusedOpacity, 0.05, 1),
    glass: bounded(candidate.glass, DEFAULT_WINDOW_STYLE.glass, 0, 1),
  };
}

export interface WindowStyleRepository extends PreferenceRepository<WindowStyle> {}
export class WindowStyleSaveQueue extends PreferenceSaveQueue<WindowStyle> {}
