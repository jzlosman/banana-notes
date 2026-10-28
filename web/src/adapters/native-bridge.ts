import { validateLibrary, titleOf } from '../domain/library';
import { resolveWindowStyle, DEFAULT_WINDOW_STYLE } from '../domain/window-style';
import { resolvePinnedPreference } from '../domain/window-preferences';
import { resolveFontSize, DEFAULT_FONT_SIZE } from '../domain/font-size';
import { resolveNoteFontState, DEFAULT_NOTE_FONT_STATE } from '../domain/note-font';
import { normalizeScopePreferences } from '../domain/scope-preferences';
import { importAttachments, validateAttachmentRecord } from './attachments';
import type { AttachmentRecord } from '../domain/managed-media';
import { parseSemanticHits, parseSemanticStatus } from '../application/semantic-contract';
import type { AppCommand, AppCommandHandler, Capabilities, ClipboardFormat } from '../application/ports';
import type { SemanticConfiguration } from '../application/semantic-contract';
import type { NativeAction, NativePayloadMap, NativeReply } from './native-wire';

interface NativeHandler { postMessage(message: unknown): Promise<unknown> }
type NativeWindow = Window & { foldnoteCommand?: (command: unknown) => Promise<void> };

const object = (value: unknown, action: NativeAction): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`The ${action} response is invalid.`);
  return value as Record<string, unknown>;
};
// Native encodes absent optional values as JSON null (NSNull); treat it as absent.
const optionalString = (value: unknown, action: NativeAction, key: string): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  throw new Error(`The ${action} response is invalid (${key}).`);
};
const optionalBoolean = (value: unknown, action: NativeAction, key: string): boolean | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  throw new Error(`The ${action} response is invalid (${key}).`);
};

function validateReply(action: NativeAction, raw: unknown): NativeReply {
  const reply = object(raw ?? {}, action);
  if (action !== 'hotkeyPreferences' && typeof reply.error === 'string' && reply.error) throw new Error(reply.error);
  const result: NativeReply = {};
  switch (action) {
    case 'load':
      result.library = reply.library == null ? null : validateLibrary(reply.library);
      result.pinned = optionalBoolean(reply.pinned, action, 'pinned');
      result.hotkeyAvailable = optionalBoolean(reply.hotkeyAvailable, action, 'hotkeyAvailable');
      result.hotkey = optionalString(reply.hotkey, action, 'hotkey');
      result.themeID = optionalString(reply.themeID, action, 'themeID');
      result.themeWarning = reply.themeWarning === null || typeof reply.themeWarning === 'string' ? reply.themeWarning : undefined;
      result.syntaxThemeID = optionalString(reply.syntaxThemeID, action, 'syntaxThemeID');
      result.ocrEnabled = optionalBoolean(reply.ocrEnabled, action, 'ocrEnabled');
      result.launchAtLogin = optionalBoolean(reply.launchAtLogin, action, 'launchAtLogin');
      result.launchStatus = optionalString(reply.launchStatus, action, 'launchStatus');
      result.launchError = reply.launchError === null || typeof reply.launchError === 'string' ? reply.launchError : undefined;
      result.newNoteOnLaunch = optionalBoolean(reply.newNoteOnLaunch, action, 'newNoteOnLaunch');
      result.imageOptions = reply.imageOptions;
      result.noteFonts = reply.noteFonts === undefined ? undefined : resolveNoteFontState(reply.noteFonts);
      result.windowStyle = reply.windowStyle === undefined ? undefined : resolveWindowStyle(reply.windowStyle);
      result.fontSize = reply.fontSize === undefined ? undefined : resolveFontSize(reply.fontSize);
      result.focused = optionalBoolean(reply.focused, action, 'focused');
      result.featureWarning = optionalString(reply.featureWarning, action, 'featureWarning');
      return result;
    case 'save':
      if (reply.saved !== true) throw new Error('The library save could not be confirmed.');
      return { saved: true };
    case 'scopePreferences':
      return { scopePreferences: normalizeScopePreferences(reply.scopePreferences) };
    case 'libraryRecovery':
      if (!(reply.startupError === null || typeof reply.startupError === 'string') || typeof reply.backupAvailable !== 'boolean'
        || (reply.backupUpdatedAt !== undefined && typeof reply.backupUpdatedAt !== 'string')
        || (reply.backupNoteCount !== undefined && (!Number.isInteger(reply.backupNoteCount) || (reply.backupNoteCount as number) < 0))) {
        throw new Error('The library recovery response is invalid.');
      }
      return { startupError: reply.startupError, backupAvailable: reply.backupAvailable,
        backupUpdatedAt: reply.backupUpdatedAt as string | undefined, backupNoteCount: reply.backupNoteCount as number | undefined };
    case 'restoreBackup':
      if (reply.restored !== true) throw new Error('The backup could not be restored.');
      return { restored: true };
    case 'hotkeyPreferences':
      if (!Number.isInteger(reply.keyCode) || !Number.isInteger(reply.modifiers) || typeof reply.display !== 'string' || typeof reply.registered !== 'boolean'
        || (reply.error !== undefined && reply.error !== null && typeof reply.error !== 'string')) throw new Error('The hotkey preferences response is invalid.');
      return { keyCode: reply.keyCode as number, modifiers: reply.modifiers as number, display: reply.display,
        registered: reply.registered, error: reply.error as string | null | undefined };
    case 'theme':
      return { themeID: optionalString(reply.themeID, action, 'themeID'),
        themeWarning: reply.themeWarning === null || typeof reply.themeWarning === 'string' ? reply.themeWarning : undefined };
    case 'pin': return { pinned: optionalBoolean(reply.pinned, action, 'pinned') };
    case 'clipboard':
      if (reply.copied !== true) throw new Error('The clipboard write could not be confirmed.');
      return { copied: true };
    case 'pickAttachments':
      if (reply.attachments !== undefined && (!Array.isArray(reply.attachments) || reply.attachments.some(item => !item || typeof item !== 'object' || Array.isArray(item)))) throw new Error('The attachment response is invalid.');
      return { attachments: reply.attachments as unknown[] | undefined, cancelled: optionalBoolean(reply.cancelled, action, 'cancelled') };
    case 'importAttachment':
      if (!reply.attachment || typeof reply.attachment !== 'object' || Array.isArray(reply.attachment)) throw new Error('The attachment response is invalid.');
      return { attachment: reply.attachment };
    case 'pickOCRImage': case 'ocrAttachment':
      return { text: optionalString(reply.text, action, 'text'), cancelled: optionalBoolean(reply.cancelled, action, 'cancelled') };
    case 'downloadNoteFont':
      if (typeof reply.downloadedFontID !== 'string') throw new Error('The font response is invalid.');
      return { fontState: reply.fontState === undefined ? undefined : resolveNoteFontState(reply.fontState), downloadedFontID: reply.downloadedFontID };
    case 'noteFont': case 'noteFonts': return { noteFonts: resolveNoteFontState(reply.noteFonts ?? reply) };
    case 'startupPreferences':
      return { launchAtLogin: optionalBoolean(reply.launchAtLogin, action, 'launchAtLogin'),
        launchStatus: optionalString(reply.launchStatus, action, 'launchStatus'),
        launchError: reply.launchError === null || typeof reply.launchError === 'string' ? reply.launchError : undefined,
        newNoteOnLaunch: optionalBoolean(reply.newNoteOnLaunch, action, 'newNoteOnLaunch') };
    case 'featurePreferences': return { ocrEnabled: optionalBoolean(reply.ocrEnabled, action, 'ocrEnabled'), featureWarning: optionalString(reply.featureWarning, action, 'featureWarning') };
    case 'semanticStatus': case 'semanticEnable': return { semanticStatus: parseSemanticStatus(reply) };
    case 'semanticSearch': return { hits: parseSemanticHits(reply.hits) };
    default: return reply as NativeReply;
  }
}

function decodeCommand(raw: unknown): AppCommand {
  const command = object(raw, 'load');
  if (typeof command.action !== 'string') throw new Error('The application command is invalid.');
  switch (command.action) {
    case 'new': return { type: 'new-note' };
    case 'explorer': return { type: 'show-explorer' };
    case 'tag': return { type: 'select-notebook', tag: typeof command.tag === 'string' ? command.tag : null };
    case 'help': return { type: 'help' };
    case 'themes': return { type: 'settings' };
    case 'focus': return { type: 'focus-change', focused: command.focused === true };
    case 'pin': return { type: 'pin-change', pinned: resolvePinnedPreference(command.pinned) };
    case 'windowStyle': return { type: 'window-style', style: resolveWindowStyle(command.style) };
    case 'fontIncrease': return { type: 'font-size', adjustment: 'increase' };
    case 'fontDecrease': return { type: 'font-size', adjustment: 'decrease' };
    case 'fontReset': return { type: 'font-size', adjustment: 'reset' };
    case 'copy': {
      const formats: ClipboardFormat[] = ['markdown', 'formatted', 'html', 'text'];
      return { type: 'copy', format: formats.includes(command.format as ClipboardFormat) ? command.format as ClipboardFormat : 'markdown', whole: command.whole === true };
    }
    case 'flush': return { type: 'flush' };
    case 'show': return { type: 'focus-editor' };
    case 'older': return { type: 'older-note' };
    case 'newer': return { type: 'newer-note' };
    default: throw new Error(`Unknown application command: ${command.action}`);
  }
}

/** Implements typed capabilities while keeping WKWebView's wire protocol private to this adapter. */
export class NativeBridge implements Capabilities {
  readonly presentation = { savedLabel: 'Saved on this Mac' };
  readonly library: Capabilities['library'];
  readonly scopePreferences: Capabilities['scopePreferences'];
  readonly recovery: Capabilities['recovery'];
  readonly window: Capabilities['window'];
  readonly appearance: Capabilities['appearance'];
  readonly typography: Capabilities['typography'];
  readonly windowStyle: Capabilities['windowStyle'];
  readonly startup: Capabilities['startup'];
  readonly features: Capabilities['features'];
  readonly hotkey: Capabilities['hotkey'];
  readonly clipboard: Capabilities['clipboard'];
  readonly attachments: Capabilities['attachments'];
  readonly ocr: Capabilities['ocr'];
  readonly pngExport: Capabilities['pngExport'];
  readonly imagePreferences: Capabilities['imagePreferences'];
  readonly markdownExport: Capabilities['markdownExport'];
  readonly dataFolder: Capabilities['dataFolder'];
  readonly semanticSearch: Capabilities['semanticSearch'];
  private readonly handler: NativeHandler;
  private readonly target: NativeWindow;
  private loadSnapshot?: Promise<NativeReply>;

  constructor(target: NativeWindow = window as NativeWindow) {
    const handler = (target as unknown as { webkit?: { messageHandlers: { native?: NativeHandler } } }).webkit?.messageHandlers.native;
    if (!handler) throw new Error('The native message bridge is unavailable.');
    this.handler = handler; this.target = target;
    this.library = { load: async () => (await this.loaded()).library ?? null, save: async library => { await this.call('save', { library }); } };
    this.scopePreferences = {
      load: async () => normalizeScopePreferences((await this.call('scopePreferences')).scopePreferences),
      save: async preferences => { await this.call('scopePreferences', { preferences: normalizeScopePreferences(preferences) }); },
    };
    this.recovery = { state: async () => {
      const value = await this.call('libraryRecovery');
      return { startupError: value.startupError ?? null, backupAvailable: value.backupAvailable === true,
        backupUpdatedAt: value.backupUpdatedAt, backupNoteCount: value.backupNoteCount };
    }, restoreLastBackup: async () => { await this.call('restoreBackup'); } };
    this.window = {
      ready: async () => { await this.call('ready'); },
      hide: async () => { await this.call('hide'); },
      pin: {
        load: async () => resolvePinnedPreference((await this.loaded()).pinned),
        set: async pinned => (await this.call('pin', { pinned })).pinned ?? pinned,
      },
      dragRegion: { set: async rect => { await this.call('dragRegion', { rect }); } },
      focused: async () => (await this.loaded()).focused ?? true,
      bindCommands: handler => this.bindCommands(handler),
    };
    this.appearance = {
      load: async () => { const value = await this.loaded(); return { themeID: value.themeID || 'system', syntaxThemeID: value.syntaxThemeID || 'app', warning: value.themeWarning || undefined }; },
      saveTheme: async themeID => { const value = await this.call('theme', { themeID }); return { themeID: value.themeID || themeID, warning: value.themeWarning || undefined }; },
      saveSyntaxTheme: async syntaxThemeID => { await this.call('syntaxTheme', { syntaxThemeID }); },
    };
    this.typography = {
      load: async () => { const value = await this.loaded(); return { noteFonts: resolveNoteFontState(value.noteFonts ?? DEFAULT_NOTE_FONT_STATE), fontSize: resolveFontSize(value.fontSize ?? DEFAULT_FONT_SIZE) }; },
      selectNoteFont: async selection => (await this.call('noteFont', { selection })).noteFonts ?? resolveNoteFontState(DEFAULT_NOTE_FONT_STATE),
      saveFontSize: async fontSize => { await this.call('fontSize', { fontSize }); },
      downloadFont: { download: async family => {
        const value = await this.call('downloadNoteFont', { family });
        return { fontState: resolveNoteFontState(value.fontState ?? DEFAULT_NOTE_FONT_STATE), downloadedFontID: value.downloadedFontID! };
      }, cancel: async () => { await this.call('cancelFontDownload'); } },
    };
    this.windowStyle = {
      load: async () => resolveWindowStyle((await this.loaded()).windowStyle ?? DEFAULT_WINDOW_STYLE),
      save: async style => { await this.call('windowStyle', { style }); },
      previewOpacity: () => null,
    };
    this.startup = {
      load: async () => startupState(await this.loaded()),
      save: async patch => startupState(await this.call('startupPreferences', patch as Record<string, boolean>)),
      openLoginSettings: async () => { await this.call('openLoginSettings'); },
    };
    this.features = {
      load: async () => { const value = await this.loaded(); return { ocrEnabled: value.ocrEnabled ?? false, warning: value.featureWarning || undefined }; },
      setOCR: async ocrEnabled => { const value = await this.call('featurePreferences', { ocrEnabled }); return { ocrEnabled: value.ocrEnabled ?? ocrEnabled, warning: value.featureWarning || undefined }; },
    };
    this.hotkey = {
      load: async () => {
        const [value, preferences] = await Promise.all([this.loaded(), this.call('hotkeyPreferences')]);
        return { keyCode: preferences.keyCode as number, modifiers: preferences.modifiers as number,
          display: preferences.display || value.hotkey || '⌃⇧Space', registered: preferences.registered === true,
          available: value.hotkeyAvailable !== false, error: preferences.error as string | null | undefined };
      },
      set: async shortcut => {
        const [value, preferences] = await Promise.all([this.loaded(), this.call('hotkeyPreferences', { shortcut })]);
        return { keyCode: preferences.keyCode as number, modifiers: preferences.modifiers as number,
          display: preferences.display || value.hotkey || '⌃⇧Space', registered: preferences.registered === true,
          available: value.hotkeyAvailable !== false, error: preferences.error as string | null | undefined };
      },
    };
    this.clipboard = { write: async content => { await this.call('clipboard', { content }); } };
    this.attachments = {
      pick: async () => {
        const value = await this.call('pickAttachments');
        if (value.cancelled || !value.attachments?.length) return null;
        return value.attachments.map(item => validateAttachmentRecord(item, attachmentKind(item)));
      },
      import: async files => importAttachments(files, data => this.call('importAttachment', data)),
      open: async url => { await this.call('openAttachment', { url }); },
    };
    this.ocr = { recognize: async url => {
      const value = url ? await this.call('ocrAttachment', { url }) : await this.call('pickOCRImage');
      return { text: value.text || '', cancelled: value.cancelled === true };
    } };
    this.pngExport = { export: async request => {
      const value = await this.call('exportPNG', { request }); return { exported: value.exported === true, cancelled: value.cancelled === true };
    } };
    this.imagePreferences = {
      load: async () => record((await this.loaded()).imageOptions),
      save: async imageOptions => { await this.call('imagePreferences', { imageOptions }); },
    };
    this.markdownExport = { export: async notes => {
      await this.call('export', { notes: notes.map(note => ({ ...note, title: titleOf(note.markdown) })) });
    } };
    this.dataFolder = { description: 'Notes and attachments are stored on this Mac.', open: async () => { await this.call('openData'); } };
    this.semanticSearch = {
      status: async () => (await this.call('semanticStatus')).semanticStatus as ReturnType<typeof parseSemanticStatus>,
      index: async (notes, force) => this.call('semanticIndex', { notes: notes as unknown[], force }),
      search: async (query, candidateIDs) => (await this.call('semanticSearch', { query, candidateIDs: [...candidateIDs] })).hits as ReturnType<typeof parseSemanticHits>,
      configuration: {
        set: async (configuration: SemanticConfiguration) => (await this.call('semanticEnable', configuration as unknown as Record<string, unknown>)).semanticStatus as ReturnType<typeof parseSemanticStatus>,
        startRuntime: async () => { await this.call('semanticStartRuntime'); },
        downloadModel: async model => { await this.call('semanticDownload', { model }); },
        clearIndex: async () => { await this.call('semanticClear'); },
        cancel: async () => { await this.call('semanticCancel'); },
      },
    };
  }

  private async loaded(): Promise<NativeReply> {
    this.loadSnapshot ??= this.call('load').catch(error => { this.loadSnapshot = undefined; throw error; });
    return this.loadSnapshot;
  }
  private async call<A extends NativeAction>(action: A, data?: NativePayloadMap[A]): Promise<NativeReply> {
    const payload = (data ?? {}) as Record<string, unknown>;
    return validateReply(action, await this.handler.postMessage({ action, ...payload }));
  }
  private bindCommands(handler: AppCommandHandler): () => void {
    const receiver = async (command: unknown) => handler(decodeCommand(command));
    this.target.foldnoteCommand = receiver;
    return () => { if (this.target.foldnoteCommand === receiver) delete this.target.foldnoteCommand; };
  }
}

function startupState(value: NativeReply) {
  return { launchAtLogin: value.launchAtLogin ?? false, launchStatus: value.launchStatus || 'notRegistered',
    launchError: value.launchError ?? null, newNoteOnLaunch: value.newNoteOnLaunch ?? false };
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function attachmentKind(value: unknown): string {
  return value && typeof value === 'object' && 'kind' in value && typeof value.kind === 'string' ? value.kind : '';
}
