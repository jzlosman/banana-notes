export type NoteFontSelection = { fontID: string; weight: number };
export type NoteFontDefinition = {
  id: string; name: string; kind: 'system' | 'google'; family: string; weights: number[];
  faces: { url: string; weight: string; unicodeRange?: string }[];
};
export type NoteFontState = { selection: NoteFontSelection; fonts: NoteFontDefinition[]; warning?: string };

const BODY_WEIGHTS = [400, 500, 600];
const BUILTINS: NoteFontDefinition[] = [
  { id: 'sf-mono', name: 'SF Mono', kind: 'system', family: 'ui-monospace, "SFMono-Regular", Menlo, monospace', weights: BODY_WEIGHTS, faces: [] },
  { id: 'system', name: 'System', kind: 'system', family: '-apple-system, BlinkMacSystemFont, sans-serif', weights: BODY_WEIGHTS, faces: [] },
  { id: 'avenir', name: 'Avenir Next', kind: 'system', family: '"Avenir Next", -apple-system, sans-serif', weights: BODY_WEIGHTS, faces: [] },
  { id: 'georgia', name: 'Georgia', kind: 'system', family: 'Georgia, serif', weights: [400], faces: [] },
];
export const DEFAULT_NOTE_FONT_STATE: NoteFontState = {
  selection: { fontID: 'sf-mono', weight: 500 },
  fonts: BUILTINS.map(font => ({ ...font, weights: [...font.weights], faces: [] })),
};
const cloneState = (state: NoteFontState): NoteFontState => ({
  selection: { ...state.selection },
  fonts: state.fonts.map(font => ({ ...font, weights: [...font.weights], faces: font.faces.map(face => ({ ...face })) })),
  ...(state.warning ? { warning: state.warning } : {}),
});
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const validName = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 80 && !/[<>\u0000-\u001f]/.test(value);
const validWeight = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 900;
const safeFamily = (value: unknown, kind: 'system' | 'google'): value is string => {
  if (typeof value !== 'string' || value.length > 240 || /[;{}\\\u0000-\u001f]|url\s*\(|var\s*\(|expression\s*\(/i.test(value)) return false;
  if (kind === 'google') return /^[\p{L}\p{N}][\p{L}\p{N} -]{0,79}$/u.test(value);
  return /^[\p{L}\p{N} _-]+(?:,\s*(?:"[\p{L}\p{N} _-]+"|'[\p{L}\p{N} _-]+'|[\p{L}\p{N} _-]+))*$/u.test(value);
};
const managedFontUrl = (value: unknown): value is string => typeof value === 'string' && /^foldnote-font:\/\/cache\/[a-f0-9]{64}\.woff2$/.test(value);
const safeUnicodeRange = (value: unknown): value is string => typeof value === 'string' && /^(?:U\+[0-9A-F?]{1,6}(?:-[0-9A-F]{1,6})?)(?:,\s*U\+[0-9A-F?]{1,6}(?:-[0-9A-F]{1,6})?)*$/i.test(value);
function normalizeFont(value: unknown): NoteFontDefinition | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(value.id) || !validName(value.name) ||
      (value.kind !== 'system' && value.kind !== 'google') || !safeFamily(value.family, value.kind) || !Array.isArray(value.weights) || !value.weights.length || !value.weights.every(validWeight) || !Array.isArray(value.faces)) return null;
  if (value.kind === 'system' && value.faces.length !== 0) return null;
  if (value.kind === 'google' && (!value.faces.length || value.faces.some(face => {
    if (!isRecord(face) || !managedFontUrl(face.url) || typeof face.weight !== 'string' || !/^([1-9]00)(\s+([1-9]00))?$/.test(face.weight)) return true;
    if (face.unicodeRange !== undefined && !safeUnicodeRange(face.unicodeRange)) return true;
    const descriptors = face.weight.split(/\s+/).map(Number);
    return descriptors.some(weight => !validWeight(weight)) || descriptors[0] > descriptors[descriptors.length - 1];
  }))) return null;
  const weights = [...new Set(value.weights as number[])].filter(weight => BODY_WEIGHTS.includes(weight)).sort((a, b) => a - b);
  if (!weights.length) return null;
  return { id: value.id, name: value.name.trim(), kind: value.kind, family: value.family, weights,
    faces: (value.faces as Record<string, unknown>[]).map(face => ({ url: face.url as string, weight: face.weight as string,
      ...(typeof face.unicodeRange === 'string' ? { unicodeRange: face.unicodeRange } : {}) })) };
}
export function resolveNoteFontState(value: unknown): NoteFontState {
  const state = cloneState(DEFAULT_NOTE_FONT_STATE);
  if (!isRecord(value)) return state;
  const ids = new Set(state.fonts.map(font => font.id));
  if (Array.isArray(value.fonts)) for (const candidate of value.fonts) {
    const font = normalizeFont(candidate);
    if (font && font.kind === 'google' && !ids.has(font.id)) { state.fonts.push(font); ids.add(font.id); }
  }
  if (isRecord(value.selection) && typeof value.selection.fontID === 'string' && validWeight(value.selection.weight)) {
    const fontID = value.selection.fontID, weight = value.selection.weight;
    const font = state.fonts.find(item => item.id === fontID);
    if (font && font.weights.includes(weight)) state.selection = { fontID: font.id, weight };
  }
  if (typeof value.warning === 'string' && validName(value.warning)) state.warning = value.warning;
  return state;
}
export function resolveNoteFontSelection(selection: unknown, fonts: NoteFontDefinition[] = DEFAULT_NOTE_FONT_STATE.fonts): NoteFontSelection {
  if (!isRecord(selection) || typeof selection.fontID !== 'string' || !validWeight(selection.weight)) return { ...DEFAULT_NOTE_FONT_STATE.selection };
  const font = fonts.find(candidate => candidate.id === selection.fontID);
  const requestedWeight = selection.weight;
  if (!font || !font.weights.length) return { ...DEFAULT_NOTE_FONT_STATE.selection };
  return { fontID: font.id, weight: font.weights.reduce((nearest, weight) => Math.abs(weight - requestedWeight) < Math.abs(nearest - requestedWeight) ? weight : nearest, font.weights[0]) };
}
