import catalog from './note-font-catalog.json' with { type: 'json' };

export type NoteFontSelection = { fontID: string; weight: number };
export type NoteFontDefinition = {
  id: string; name: string; kind: 'system' | 'bundled' | 'google'; family: string; weights: number[];
  faces: { url: string; weight: string; unicodeRange?: string }[];
};
export type NoteFontState = { selection: NoteFontSelection; fonts: NoteFontDefinition[]; warning?: string };

type CatalogFont = { id: string; name: string; kind: 'system' | 'bundled'; family: string; weights: number[] };
const BUILTINS: NoteFontDefinition[] = (catalog as CatalogFont[]).map(({ id, name, kind, family, weights }) => ({ id, name, kind, family, weights: [...weights], faces: [] }));
const BUILTINS_BY_ID = new Map(BUILTINS.map(font => [font.id, font]));
const BODY_WEIGHTS = [400, 500, 600];
export const DEFAULT_NOTE_FONT_STATE: NoteFontState = {
  selection: { fontID: 'space-mono', weight: 400 },
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
const safeFamily = (value: unknown, kind: NoteFontDefinition['kind']): value is string => {
  if (typeof value !== 'string' || value.length > 240 || /[;{}\\\u0000-\u001f]|url\s*\(|var\s*\(|expression\s*\(/i.test(value)) return false;
  if (kind === 'google') return /^[\p{L}\p{N}][\p{L}\p{N} -]{0,79}$/u.test(value);
  if (kind === 'bundled') return /^[A-Za-z0-9][A-Za-z0-9 .-]{0,79}$/.test(value);
  return /^[\p{L}\p{N} _-]+(?:,\s*(?:"[\p{L}\p{N} _-]+"|'[\p{L}\p{N} _-]+'|[\p{L}\p{N} _-]+))*$/u.test(value);
};
const managedFontUrl = (value: unknown): value is string => typeof value === 'string' && /^foldnote-font:\/\/cache\/[a-f0-9]{64}\.woff2$/.test(value);
const bundledFilePatterns: Record<string, RegExp> = {
  'space-mono': /^space-mono-latin(?:-ext)?-(?:400|700)-normal\.woff2$/,
  'jetbrains-mono': /^jetbrains-mono-latin(?:-ext)?-wght-normal\.woff2$/,
  'overpass-mono': /^overpass-mono-latin(?:-ext)?-wght-normal\.woff2$/,
  'fira-code': /^fira-code-latin(?:-ext)?-wght-normal\.woff2$/,
};
const bundledFontUrl = (value: unknown, fontID: string): value is string => {
  if (typeof value !== 'string') return false;
  const match = value.match(/^(?:fonts\/|foldnote-font:\/\/bundled\/)([^/]+)$/);
  return Boolean(match && bundledFilePatterns[fontID]?.test(match[1]));
};
const safeUnicodeRange = (value: unknown): value is string => typeof value === 'string' && /^(?:U\+[0-9A-F?]{1,6}(?:-[0-9A-F]{1,6})?)(?:,\s*U\+[0-9A-F?]{1,6}(?:-[0-9A-F]{1,6})?)*$/i.test(value);
const safeWeightDescriptor = (value: unknown): value is string => typeof value === 'string' && /^(?:[1-9]00)(?:\s+[1-9]00)?$/.test(value) && value.split(/\s+/).map(Number).every(validWeight);
function normalizeFont(value: unknown): NoteFontDefinition | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(value.id) || !validName(value.name) ||
      (value.kind !== 'system' && value.kind !== 'bundled' && value.kind !== 'google') || !safeFamily(value.family, value.kind) ||
      !Array.isArray(value.weights) || !value.weights.length || !value.weights.every(validWeight) || !Array.isArray(value.faces)) return null;
  if (value.kind === 'system') return null;
  if (value.kind === 'bundled') {
    const fontID = value.id as string;
    const builtin = BUILTINS_BY_ID.get(fontID);
    if (!builtin || builtin.kind !== 'bundled' || value.name !== builtin.name || value.family !== builtin.family ||
        value.faces.some(face => !isRecord(face) || !bundledFontUrl(face.url, fontID) || !safeWeightDescriptor(face.weight) ||
          (face.unicodeRange !== undefined && !safeUnicodeRange(face.unicodeRange)))) return null;
    return { ...builtin, weights: [...builtin.weights], faces: (value.faces as Record<string, unknown>[]).map(face => ({
      url: face.url as string, weight: face.weight as string,
      ...(typeof face.unicodeRange === 'string' ? { unicodeRange: face.unicodeRange } : {}),
    })) };
  }
  if (!value.faces.length || value.faces.some(face => {
    if (!isRecord(face) || !managedFontUrl(face.url) || !safeWeightDescriptor(face.weight)) return true;
    if (face.unicodeRange !== undefined && !safeUnicodeRange(face.unicodeRange)) return true;
    const descriptors = face.weight.split(/\s+/).map(Number);
    return descriptors[0] > descriptors[descriptors.length - 1];
  })) return null;
  const weights = [...new Set(value.weights as number[])].filter(weight => BODY_WEIGHTS.includes(weight)).sort((a, b) => a - b);
  if (!weights.length) return null;
  return { id: value.id, name: value.name.trim(), kind: 'google', family: value.family, weights,
    faces: (value.faces as Record<string, unknown>[]).map(face => ({ url: face.url as string, weight: face.weight as string,
      ...(typeof face.unicodeRange === 'string' ? { unicodeRange: face.unicodeRange } : {}) })) };
}
function nearestWeight(font: NoteFontDefinition, requested: number): number {
  return font.weights.reduce((nearest, weight) => Math.abs(weight - requested) < Math.abs(nearest - requested) ? weight : nearest, font.weights[0]);
}
function sameFamily(left: string, right: string): boolean { return left.trim().toLowerCase() === right.trim().toLowerCase(); }

export function resolveNoteFontState(value: unknown): NoteFontState {
  const state = cloneState(DEFAULT_NOTE_FONT_STATE);
  if (!isRecord(value)) return state;
  const downloads: NoteFontDefinition[] = [];
  const duplicateIDs = new Map<string, string>();
  if (Array.isArray(value.fonts)) for (const candidate of value.fonts) {
    const font = normalizeFont(candidate);
    if (!font) continue;
    if (font.kind === 'bundled') {
      const index = state.fonts.findIndex(item => item.id === font.id);
      if (index >= 0) state.fonts[index] = font;
      continue;
    }
    if (font.kind !== 'google' || downloads.some(item => item.id === font.id)) continue;
    downloads.push(font);
    const duplicate = state.fonts.find(item => sameFamily(item.name, font.name));
    if (duplicate) duplicateIDs.set(font.id, duplicate.id);
    else state.fonts.push(font);
  }
  if (isRecord(value.selection) && typeof value.selection.fontID === 'string' && validWeight(value.selection.weight)) {
    const requestedID = value.selection.fontID;
    if (requestedID !== 'sf-mono' && requestedID !== 'system') {
      const fontID = duplicateIDs.get(requestedID) ?? requestedID;
      const font = state.fonts.find(item => item.id === fontID);
      if (font) state.selection = { fontID, weight: nearestWeight(font, value.selection.weight) };
    }
  }
  if (typeof value.warning === 'string' && validName(value.warning)) state.warning = value.warning;
  return state;
}
export function resolveNoteFontSelection(selection: unknown, fonts: NoteFontDefinition[] = DEFAULT_NOTE_FONT_STATE.fonts): NoteFontSelection {
  if (!isRecord(selection) || typeof selection.fontID !== 'string' || !validWeight(selection.weight)) return { ...DEFAULT_NOTE_FONT_STATE.selection };
  const font = fonts.find(candidate => candidate.id === selection.fontID);
  if (!font || !font.weights.length) return { ...DEFAULT_NOTE_FONT_STATE.selection };
  return { fontID: font.id, weight: nearestWeight(font, selection.weight) };
}
