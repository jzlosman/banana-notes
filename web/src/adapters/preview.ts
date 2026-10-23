import { validateLibrary, type Library, titleOf } from '../domain/library';
import { resolveWindowStyle, DEFAULT_WINDOW_STYLE, type WindowStyle } from '../domain/window-style';
import { DEFAULT_FONT_SIZE, resolveFontSize } from '../domain/font-size';
import { DEFAULT_NOTE_FONT_STATE, resolveNoteFontState } from '../domain/note-font';
import { SYSTEM_THEME } from '../domain/themes';
import type { NoteFontSelection } from '../domain/note-font';
import type { Capabilities, ClipboardContent, PngRenderRequest, StartupPreferencePatch } from '../application/ports';
import type { SemanticConfiguration, SemanticStatus } from '../application/semantic-contract';

const keys = {
  library: 'foldnote-preview-v1', theme: 'foldnote-preview-theme-v1', windowStyle: 'foldnote-preview-window-style-v1',
  fontSize: 'foldnote-preview-font-size-v1', noteFont: 'foldnote-preview-note-font-v1', ocr: 'foldnote-preview-ocr-v1',
  syntax: 'foldnote-preview-syntax-v1', image: 'foldnote-preview-image-v1',
} as const;

function readJSON<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  return raw === null ? fallback : JSON.parse(raw) as T;
}
function disabledSemanticStatus(): SemanticStatus {
  return { enabled: false, model: '', models: [], installed: false, runtimeAvailable: false, indexedNotes: 0,
    progress: '', actionableState: 'disabled', provider: 'apple' as const, providers: [
      { id: 'apple' as const, name: 'On-device', disclosure: 'Available in the Mac app.', available: false },
      { id: 'ollama' as const, name: 'Ollama', disclosure: 'Available in the Mac app.', available: false },
    ], unavailableReason: 'Semantic search is available in the Mac app.' };
}

/** Browser-preview capabilities. Native-only operations are represented as absent. */
export class PreviewAdapter implements Capabilities {
  readonly presentation = { savedLabel: 'Saved in preview' };
  readonly recovery = null;
  readonly startup = null;
  readonly attachments = null;
  readonly ocr = null;
  readonly pngExport = null;
  readonly dataFolder = null;
  readonly markdownExport = {
    export: async (notes: readonly { id: string; markdown: string }[]) => {
      const content = notes.map(note => `# ${titleOf(note.markdown)}\n\n${note.markdown}`).join('\n\n---\n\n');
      const anchor = document.createElement('a');
      anchor.href = URL.createObjectURL(new Blob([content], { type: 'text/markdown' }));
      anchor.download = 'banana-notes-export.md'; anchor.click(); URL.revokeObjectURL(anchor.href);
    },
  };
  readonly library = {
    load: async (): Promise<Library | null> => {
      const raw = readJSON<unknown>(keys.library, null);
      return raw === null ? null : validateLibrary(raw);
    },
    save: async (library: Library) => { localStorage.setItem(keys.library, JSON.stringify(validateLibrary(library))); },
  };
  readonly window = {
    ready: async () => {},
    hide: async () => {},
    pin: null,
    dragRegion: null,
    focused: async () => document.hasFocus(),
    bindCommands: (handler: Parameters<Capabilities['window']['bindCommands']>[0]) => {
      const focus = () => { void handler({ type: 'focus-change', focused: document.hasFocus() }); };
      window.addEventListener('focus', focus); window.addEventListener('blur', focus);
      return () => { window.removeEventListener('focus', focus); window.removeEventListener('blur', focus); };
    },
  };
  readonly appearance = {
    load: async () => ({ themeID: localStorage.getItem(keys.theme) || SYSTEM_THEME, syntaxThemeID: localStorage.getItem(keys.syntax) || 'app' }),
    saveTheme: async (themeID: string) => { localStorage.setItem(keys.theme, themeID); return { themeID }; },
    saveSyntaxTheme: async (syntaxThemeID: string) => { localStorage.setItem(keys.syntax, syntaxThemeID); },
  };
  readonly typography = {
    load: async () => {
      const saved = resolveNoteFontState(readJSON(keys.noteFont, DEFAULT_NOTE_FONT_STATE));
      const manifest = (globalThis as typeof globalThis & { __BANANA_NOTE_FONT_MANIFEST__?: unknown }).__BANANA_NOTE_FONT_MANIFEST__;
      let noteFonts = saved;
      if (typeof manifest === 'object' && manifest !== null && !Array.isArray(manifest) && Array.isArray((manifest as { fonts?: unknown }).fonts)) {
        const bundled = ((manifest as { fonts: unknown[] }).fonts).map(candidate => {
          if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return candidate;
          const font = candidate as Record<string, unknown>;
          if (!Array.isArray(font.faces)) return font;
          return { ...font, faces: font.faces.map(face => {
            if (typeof face !== 'object' || face === null || Array.isArray(face)) return face;
            const bundledFace = face as Record<string, unknown>;
            return { ...bundledFace, url: typeof bundledFace.file === 'string' ? `fonts/${bundledFace.file}` : '' };
          }) };
        });
        noteFonts = resolveNoteFontState({ selection: saved.selection, fonts: [...bundled, ...saved.fonts.filter(font => font.kind === 'google')] });
      }
      return { noteFonts, fontSize: resolveFontSize(Number(localStorage.getItem(keys.fontSize) || DEFAULT_FONT_SIZE)) };
    },
    selectNoteFont: async (selection: NoteFontSelection) => {
      const current = resolveNoteFontState(readJSON(keys.noteFont, DEFAULT_NOTE_FONT_STATE));
      const next = resolveNoteFontState({ ...current, selection }); localStorage.setItem(keys.noteFont, JSON.stringify(next)); return next;
    },
    saveFontSize: async (fontSize: number) => { localStorage.setItem(keys.fontSize, String(fontSize)); },
    downloadFont: null,
  };
  readonly windowStyle = {
    load: async () => resolveWindowStyle(readJSON<unknown>(keys.windowStyle, null)),
    save: async (style: WindowStyle) => { localStorage.setItem(keys.windowStyle, JSON.stringify(style)); },
    previewOpacity: (focused: boolean, style: WindowStyle) => focused ? style.focusedOpacity : style.unfocusedOpacity,
  };
  readonly features = {
    load: async () => ({ ocrEnabled: localStorage.getItem(keys.ocr) === 'true' }),
    setOCR: async (ocrEnabled: boolean) => { localStorage.setItem(keys.ocr, String(ocrEnabled)); return { ocrEnabled }; },
  };
  readonly hotkey = null;
  readonly clipboard = { write: async ({ text, html }: ClipboardContent) => {
    if (html && typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]);
    } else await navigator.clipboard.writeText(text);
  } };
  readonly imagePreferences = {
    load: async () => readJSON<Record<string, unknown>>(keys.image, {}),
    save: async (options: Record<string, unknown>) => { localStorage.setItem(keys.image, JSON.stringify(options)); },
  };
  readonly semanticSearch = {
    status: async () => disabledSemanticStatus(),
    index: async () => { throw new Error('Semantic indexing is available in the Mac app.'); },
    search: async () => [],
    configuration: {
      set: async (_configuration: SemanticConfiguration) => { throw new Error('Semantic search is available in the Mac app.'); },
      startRuntime: async () => { throw new Error('Semantic search is available in the Mac app.'); },
      downloadModel: async () => { throw new Error('Semantic search is available in the Mac app.'); },
      clearIndex: async () => {}, cancel: async () => {},
    },
  };
}
