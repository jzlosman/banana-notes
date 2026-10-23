import type { Library, Note } from '../domain/library';
import type { WindowStyle } from '../domain/window-style';
import type { NoteFontSelection, NoteFontState } from '../domain/note-font';
import type { AttachmentRecord } from '../domain/managed-media';
import type { SemanticConfiguration, SemanticHit, SemanticNoteSnapshot, SemanticStatus } from './semantic-contract';

export interface LibraryRepository {
  load(): Promise<Library | null>;
  save(library: Library): Promise<void>;
}
export interface LibraryRecoveryState { startupError: string | null; backupAvailable: boolean; backupUpdatedAt?: string; backupNoteCount?: number }
export interface LibraryRecovery {
  state(): Promise<LibraryRecoveryState>;
  restoreLastBackup(): Promise<void>;
}
export interface Clock { now(): string }
export interface IdGenerator { next(): string }
export interface PreferencesRepository<T> { save(value: T): Promise<void> }

export type ClipboardFormat = 'markdown' | 'formatted' | 'html' | 'text';
export interface ClipboardContent { text: string; html?: string }
export interface ClipboardPort { write(content: ClipboardContent): Promise<void> }

export interface AppCommandHandler {
  (command: AppCommand): Promise<void>;
}
export type AppCommand =
  | { type: 'new-note' }
  | { type: 'show-explorer' }
  | { type: 'select-notebook'; tag: string | null }
  | { type: 'help' }
  | { type: 'settings' }
  | { type: 'focus-change'; focused: boolean }
  | { type: 'pin-change'; pinned: boolean }
  | { type: 'window-style'; style: WindowStyle }
  | { type: 'font-size'; adjustment: 'increase' | 'decrease' | 'reset' }
  | { type: 'copy'; format: ClipboardFormat; whole: boolean }
  | { type: 'flush' }
  | { type: 'focus-editor' }
  | { type: 'older-note' }
  | { type: 'newer-note' };
export interface WindowControl {
  ready(): Promise<void>;
  hide(): Promise<void>;
  pin: { load(): Promise<boolean>; set(pinned: boolean): Promise<boolean> } | null;
  dragRegion: { set(rect: { x: number; y: number; width: number; height: number }): Promise<void> } | null;
  focused(): Promise<boolean>;
  bindCommands(handler: AppCommandHandler): () => void;
}

export interface AppearanceState { themeID: string; syntaxThemeID: string; warning?: string }
export interface AppearancePreferences {
  load(): Promise<AppearanceState>;
  saveTheme(themeID: string): Promise<{ themeID: string; warning?: string }>;
  saveSyntaxTheme(themeID: string): Promise<void>;
}
export interface TypographyState { noteFonts: NoteFontState; fontSize: number }
export interface DownloadedFont { fontState: NoteFontState; downloadedFontID: string }
export interface TypographyPreferences {
  load(): Promise<TypographyState>;
  selectNoteFont(selection: NoteFontSelection): Promise<NoteFontState>;
  saveFontSize(size: number): Promise<void>;
  downloadFont: { download(family: string): Promise<DownloadedFont>; cancel(): Promise<void> } | null;
}
export interface WindowStylePreferences {
  load(): Promise<WindowStyle>;
  save(style: WindowStyle): Promise<void>;
  previewOpacity(focused: boolean, style: WindowStyle): number | null;
}
export interface StartupState { launchAtLogin: boolean; launchStatus: string; launchError: string | null; newNoteOnLaunch: boolean }
export interface StartupPreferencePatch { launchAtLogin?: boolean; newNoteOnLaunch?: boolean }
export interface StartupPreferences {
  load(): Promise<StartupState>;
  save(patch: StartupPreferencePatch): Promise<StartupState>;
  openLoginSettings(): Promise<void>;
}
export interface FeatureState { ocrEnabled: boolean; warning?: string }
export interface FeaturePreferences {
  load(): Promise<FeatureState>;
  setOCR(enabled: boolean): Promise<FeatureState>;
}
export interface HotkeyShortcut { keyCode: number; modifiers: number }
export interface HotkeyState extends HotkeyShortcut { display: string; registered: boolean; available: boolean; error?: string | null }
export interface HotkeyPreferences { load(): Promise<HotkeyState>; set(shortcut: HotkeyShortcut): Promise<HotkeyState> }

/** Structural input keeps DOM File types outside application contracts. */
export interface AttachmentFile {
  readonly name: string;
  readonly type: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface Attachments {
  pick(): Promise<readonly AttachmentRecord[] | null>;
  import(files: readonly AttachmentFile[]): Promise<readonly AttachmentRecord[]>;
  open(url: string): Promise<void>;
}
export interface OcrResult { text: string; cancelled: boolean }
export interface Ocr { recognize(url?: string): Promise<OcrResult> }
export interface PngRenderRequest {
  html: string; title: string; backgroundStart: string; backgroundEnd: string;
  paper: string; text: string; accent: string; width: number; padding: number;
}
export interface PngExport { export(request: PngRenderRequest): Promise<{ exported: boolean; cancelled: boolean }> }
export interface ImageExportPreferences { load(): Promise<Record<string, unknown>>; save(options: Record<string, unknown>): Promise<void> }
export interface MarkdownExport {
  export(notes: readonly Pick<Note, 'id' | 'markdown'>[]): Promise<void>;
}
export interface DataFolder { readonly description: string; open(): Promise<void> }
export interface SemanticConfigurationPort {
  set(configuration: SemanticConfiguration): Promise<SemanticStatus>;
  startRuntime(): Promise<void>;
  downloadModel(model: string): Promise<void>;
  clearIndex(): Promise<void>;
  cancel(): Promise<void>;
}
export interface SemanticSearchPort {
  status(): Promise<SemanticStatus>;
  index(notes: readonly SemanticNoteSnapshot[], force: boolean): Promise<Record<string, unknown>>;
  search(query: string, candidateIDs: readonly string[]): Promise<readonly SemanticHit[]>;
  configuration: SemanticConfigurationPort;
}

export interface AdapterPresentation { savedLabel: string }
export interface Capabilities {
  library: LibraryRepository;
  recovery: LibraryRecovery | null;
  window: WindowControl;
  appearance: AppearancePreferences;
  typography: TypographyPreferences;
  windowStyle: WindowStylePreferences;
  startup: StartupPreferences | null;
  features: FeaturePreferences;
  hotkey: HotkeyPreferences | null;
  clipboard: ClipboardPort;
  attachments: Attachments | null;
  ocr: Ocr | null;
  pngExport: PngExport | null;
  imagePreferences: ImageExportPreferences;
  markdownExport: MarkdownExport | null;
  dataFolder: DataFolder | null;
  semanticSearch: SemanticSearchPort;
  presentation: AdapterPresentation;
}
