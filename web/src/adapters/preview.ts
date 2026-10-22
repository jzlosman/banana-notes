import { validateLibrary, type Library } from '../domain/library';
import { resolveWindowStyle } from '../domain/window-style';
import { DEFAULT_FONT_SIZE, resolveFontSize } from '../domain/font-size';
import { DEFAULT_NOTE_FONT_STATE, resolveNoteFontState } from '../domain/note-font';
import { SYSTEM_THEME } from '../domain/themes';
import type { NativeReply, PlatformAction, PlatformPayloadMap, PlatformPort } from '../application/platform';

const keys = {
  library: 'foldnote-preview-v1', theme: 'foldnote-preview-theme-v1', windowStyle: 'foldnote-preview-window-style-v1',
  fontSize: 'foldnote-preview-font-size-v1', noteFont: 'foldnote-preview-note-font-v1', ocr: 'foldnote-preview-ocr-v1',
  syntax: 'foldnote-preview-syntax-v1', image: 'foldnote-preview-image-v1',
} as const;

function readJSON<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  return raw === null ? fallback : JSON.parse(raw) as T;
}

/** Browser-preview adapter; localStorage details stay behind this one boundary. */
export class PreviewAdapter implements PlatformPort {
  readonly isNative = false;
  async request<A extends PlatformAction>(action: A, payload?: PlatformPayloadMap[A]): Promise<NativeReply> {
    const data = (payload ?? {}) as Record<string, unknown>;
    switch (action) {
      case 'load': {
        const raw = readJSON<unknown>(keys.library, null);
        const library: Library | null = raw === null ? null : validateLibrary(raw);
        return {
          library, pinned: false, hotkeyAvailable: true, hotkeyDisplay: '⌃⇧Space',
          themeID: localStorage.getItem(keys.theme) || SYSTEM_THEME,
          windowStyle: resolveWindowStyle(readJSON(keys.windowStyle, null)), fontSize: resolveFontSize(Number(localStorage.getItem(keys.fontSize) || DEFAULT_FONT_SIZE)),
          noteFonts: resolveNoteFontState(readJSON(keys.noteFont, DEFAULT_NOTE_FONT_STATE)), ocrEnabled: localStorage.getItem(keys.ocr) === 'true',
          syntaxThemeID: localStorage.getItem(keys.syntax) || 'app', imageOptions: readJSON(keys.image, {}), focused: document.hasFocus(),
        };
      }
      case 'save':
        if (!data.library) throw new Error('The library save request is invalid.');
        localStorage.setItem(keys.library, JSON.stringify(validateLibrary(data.library)));
        return { saved: true };
      case 'theme':
        if (typeof data.themeID !== 'string') throw new Error('That theme is not available.');
        localStorage.setItem(keys.theme, data.themeID); return { themeID: data.themeID };
      case 'syntaxTheme':
        if (typeof data.syntaxThemeID !== 'string') throw new Error('That code theme is not available.');
        localStorage.setItem(keys.syntax, data.syntaxThemeID); return {};
      case 'windowStyle': localStorage.setItem(keys.windowStyle, JSON.stringify(data.style)); return {};
      case 'fontSize': localStorage.setItem(keys.fontSize, String(data.fontSize)); return {};
      case 'noteFonts': return { noteFonts: resolveNoteFontState(readJSON(keys.noteFont, DEFAULT_NOTE_FONT_STATE)) };
      case 'noteFont': {
        const current = resolveNoteFontState(readJSON(keys.noteFont, DEFAULT_NOTE_FONT_STATE));
        const next = resolveNoteFontState({ ...current, selection: data.selection });
        localStorage.setItem(keys.noteFont, JSON.stringify(next)); return { noteFonts: next };
      }
      case 'imagePreferences': localStorage.setItem(keys.image, JSON.stringify(data.imageOptions || {})); return {};
      case 'featurePreferences':
        if (typeof data.ocrEnabled === 'boolean') localStorage.setItem(keys.ocr, String(data.ocrEnabled));
        return { ocrEnabled: localStorage.getItem(keys.ocr) === 'true' };
      case 'clipboard': {
        const content = data.content as { text?: unknown; html?: unknown } | undefined;
        if (typeof content?.text !== 'string') throw new Error('Clipboard content is invalid.');
        if (content.html && typeof content.html === 'string' && typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
          await navigator.clipboard.write([new ClipboardItem({
            'text/plain': new Blob([content.text], { type: 'text/plain' }),
            'text/html': new Blob([content.html], { type: 'text/html' }),
          })]);
        } else await navigator.clipboard.writeText(content.text);
        return { copied: true };
      }
      case 'semanticStatus': return { enabled: false, runtimeAvailable: false, installed: false };
      case 'hotkeyPreferences': return { keyCode: 49, modifiers: 0, display: '⌃⇧Space', registered: true };
      case 'libraryRecovery': return { startupError: null, backupAvailable: false };
      case 'ready': case 'pin': case 'dragRegion': case 'hide': case 'focus': case 'openData': case 'openLoginSettings':
      case 'cancelFontDownload': case 'semanticIndex': case 'semanticSearch': case 'semanticEnable': case 'semanticClear': case 'semanticCancel':
      case 'semanticStartRuntime': case 'semanticDownload':
        return action === 'pin' ? { pinned: data.pinned === true } : {};
      case 'export': {
        const notes = Array.isArray(data.notes) ? data.notes : [];
        const note = notes.find((candidate): candidate is { id: string; title: string; markdown: string } => !!candidate && typeof candidate === 'object' && typeof (candidate as { markdown?: unknown }).markdown === 'string')
          || { title: 'Banana Notes', markdown: '' };
        const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(new Blob([note.markdown], { type: 'text/markdown' }));
        anchor.download = `${note.title || 'Banana Notes'}.md`; anchor.click(); URL.revokeObjectURL(anchor.href); return { exported: true };
      }
      case 'pickAttachments': case 'importAttachment': case 'openAttachment': case 'ocrAttachment': case 'pickOCRImage': case 'exportPNG': case 'downloadNoteFont': case 'startupPreferences': case 'restoreBackup':
        throw new Error('This action is available in the Mac app only.');
    }
  }
}
