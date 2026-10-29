import { DEFAULT_NOTE_FONT_STATE, resolveNoteFontState, type NoteFontState } from '../../domain/note-font';

interface BundledFontManifest {
  fonts?: { id?: unknown; name?: unknown; kind?: unknown; family?: unknown; weights?: unknown; faces?: unknown }[];
}

declare global {
  var __BANANA_NOTE_FONT_MANIFEST__: unknown;
}

/** The manifest script is an adapter input; only the shared font-domain validator accepts its faces. */
export function loadViewerFontState(manifest: unknown = globalThis.__BANANA_NOTE_FONT_MANIFEST__): NoteFontState {
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest) || !Array.isArray((manifest as BundledFontManifest).fonts)) {
    return resolveNoteFontState(DEFAULT_NOTE_FONT_STATE);
  }
  const fonts = (manifest as BundledFontManifest).fonts!.map(candidate => {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return candidate;
    const font = candidate as Record<string, unknown>;
    if (!Array.isArray(font.faces)) return font;
    return {
      ...font,
      faces: font.faces.map(face => {
        if (typeof face !== 'object' || face === null || Array.isArray(face)) return face;
        const bundledFace = face as Record<string, unknown>;
        return { ...bundledFace, url: typeof bundledFace.file === 'string' ? `fonts/${bundledFace.file}` : '' };
      }),
    };
  });
  return resolveNoteFontState({ selection: DEFAULT_NOTE_FONT_STATE.selection, fonts });
}
