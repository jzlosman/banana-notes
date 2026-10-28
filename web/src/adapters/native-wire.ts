import type { Library } from '../domain/library';
import type { WindowStyle } from '../domain/window-style';
import type { NoteFontState, NoteFontSelection } from '../domain/note-font';
import type { ScopePreferences } from '../domain/scope-preferences';

/** Wire-only actions; application and UI code must use capability interfaces instead. */
export type NativeAction =
  | 'load' | 'save' | 'scopePreferences' | 'ready' | 'pin' | 'dragRegion' | 'hide' | 'focus'
  | 'libraryRecovery' | 'restoreBackup' | 'hotkeyPreferences'
  | 'theme' | 'syntaxTheme' | 'windowStyle' | 'fontSize' | 'noteFonts' | 'noteFont' | 'downloadNoteFont' | 'cancelFontDownload'
  | 'clipboard' | 'importAttachment' | 'pickAttachments' | 'openAttachment' | 'ocrAttachment' | 'pickOCRImage'
  | 'export' | 'exportPNG' | 'imagePreferences' | 'openData' | 'openLoginSettings' | 'startupPreferences' | 'featurePreferences'
  | 'semanticStatus' | 'semanticIndex' | 'semanticSearch' | 'semanticEnable' | 'semanticClear' | 'semanticCancel' | 'semanticStartRuntime' | 'semanticDownload';

export interface NativeReply {
  library?: Library | null; scopePreferences?: unknown; error?: string | null; pinned?: boolean; hotkeyAvailable?: boolean; hotkey?: string;
  dataDirectory?: string; saved?: boolean; themeID?: string; themeWarning?: string | null; focused?: boolean;
  windowStyle?: WindowStyle; fontSize?: number; copied?: boolean; ocrEnabled?: boolean; syntaxThemeID?: string;
  launchAtLogin?: boolean; launchStatus?: string; launchError?: string | null; newNoteOnLaunch?: boolean;
  featureWarning?: string | null; imageOptions?: unknown; noteFonts?: NoteFontState; attachments?: unknown[];
  attachment?: unknown; cancelled?: boolean; text?: string; fontState?: unknown; downloadedFontID?: string;
  exported?: boolean; backupAvailable?: boolean; backupUpdatedAt?: string; backupNoteCount?: number;
  startupError?: string | null; restored?: true; keyCode?: number; modifiers?: number; display?: string; registered?: boolean;
  [key: string]: unknown;
}

export interface NativePayloadMap {
  load: undefined; save: { library: Library }; scopePreferences: { preferences?: ScopePreferences } | undefined; ready: undefined; pin: { pinned: boolean };
  dragRegion: { rect: { x: number; y: number; width: number; height: number } }; hide: undefined; focus: undefined;
  libraryRecovery: undefined; restoreBackup: undefined; hotkeyPreferences: { shortcut?: { keyCode: number; modifiers: number } } | undefined;
  theme: { themeID: string }; syntaxTheme: { syntaxThemeID: string }; windowStyle: { style: WindowStyle }; fontSize: { fontSize: number };
  noteFonts: undefined; noteFont: { selection: NoteFontSelection }; downloadNoteFont: { family: string }; cancelFontDownload: undefined;
  clipboard: { content: { text: string; html?: string } };
  importAttachment: { name: string; mimeType: string; dataBase64: string }; pickAttachments: undefined; openAttachment: { url: string };
  ocrAttachment: { url: string }; pickOCRImage: undefined;
  export: { notes: { id: string; title: string; markdown: string }[] }; exportPNG: { request: unknown }; imagePreferences: { imageOptions: unknown };
  openData: undefined; openLoginSettings: undefined; startupPreferences: Record<string, boolean>; featurePreferences: { ocrEnabled: boolean };
  semanticStatus: undefined; semanticIndex: { notes?: unknown[]; force?: boolean }; semanticSearch: { query: string; candidateIDs: string[] };
  semanticEnable: Record<string, unknown>; semanticClear: undefined; semanticCancel: undefined;
  semanticStartRuntime: undefined; semanticDownload: { model?: string };
}
