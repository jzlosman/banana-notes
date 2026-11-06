import { DEFAULT_NOTE_FONT_STATE, resolveNoteFontState, type NoteFontState } from '../../domain/note-font';

declare global { var __BANANA_NOTE_FONT_MANIFEST__: unknown; }

/** Accept only bundled font faces through the shared typography validator. */
export function loadTasksFontState(manifest: unknown = globalThis.__BANANA_NOTE_FONT_MANIFEST__): NoteFontState {
  if (!manifest || typeof manifest !== 'object' || !Array.isArray((manifest as { fonts?: unknown }).fonts)) {
    return resolveNoteFontState(DEFAULT_NOTE_FONT_STATE);
  }
  const fonts = (manifest as { fonts: unknown[] }).fonts.map(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;
    const font = candidate as Record<string, unknown>;
    if (font.kind !== 'bundled' || !Array.isArray(font.faces)) return null;
    return {
      ...font,
      faces: font.faces.map(candidate => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;
        const face = candidate as Record<string, unknown>;
        return { ...face, url: typeof face.file === 'string' ? `fonts/${face.file}` : '' };
      }),
    };
  });
  return resolveNoteFontState({ selection: DEFAULT_NOTE_FONT_STATE.selection, fonts });
}
