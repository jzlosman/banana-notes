import { validateLibrary } from '../domain/library';
import { resolveWindowStyle } from '../domain/window-style';
import { resolveFontSize } from '../domain/font-size';
import { resolveNoteFontState } from '../domain/note-font';
import type { NativeReply, PlatformAction, PlatformPayloadMap, PlatformPort } from '../application/platform';

interface NativeHandler { postMessage(message: unknown): Promise<unknown> }
declare global { interface Window { webkit?: { messageHandlers: { native: NativeHandler } } } }
interface NativeWindow extends Window {}

const object = (value: unknown, action: PlatformAction): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`The ${action} response is invalid.`);
  return value as Record<string, unknown>;
};
const optionalString = (value: unknown, action: PlatformAction, key: string): string | undefined => {
  if (value === undefined || typeof value === 'string') return value;
  throw new Error(`The ${action} response is invalid (${key}).`);
};
const optionalBoolean = (value: unknown, action: PlatformAction, key: string): boolean | undefined => {
  if (value === undefined || typeof value === 'boolean') return value;
  throw new Error(`The ${action} response is invalid (${key}).`);
};

function validateReply(action: PlatformAction, raw: unknown): NativeReply {
  const reply = object(raw ?? {}, action);
  if (action !== 'hotkeyPreferences' && typeof reply.error === 'string' && reply.error) throw new Error(reply.error);
  const result: NativeReply = {};
  switch (action) {
    case 'load': {
      result.library = reply.library == null ? null : validateLibrary(reply.library);
      result.pinned = optionalBoolean(reply.pinned, action, 'pinned');
      result.hotkeyAvailable = optionalBoolean(reply.hotkeyAvailable, action, 'hotkeyAvailable');
      result.hotkeyDisplay = optionalString(reply.hotkeyDisplay, action, 'hotkeyDisplay');
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
    }
    case 'save':
      if (reply.saved !== true) throw new Error('The library save could not be confirmed.');
      result.saved = true; return result;
    case 'libraryRecovery':
      if (!(reply.startupError === null || typeof reply.startupError === 'string') || typeof reply.backupAvailable !== 'boolean'
        || (reply.backupUpdatedAt !== undefined && typeof reply.backupUpdatedAt !== 'string')
        || (reply.backupNoteCount !== undefined && (!Number.isInteger(reply.backupNoteCount) || (reply.backupNoteCount as number) < 0))) {
        throw new Error('The library recovery response is invalid.');
      }
      result.startupError = reply.startupError; result.backupAvailable = reply.backupAvailable;
      result.backupUpdatedAt = reply.backupUpdatedAt as string | undefined; result.backupNoteCount = reply.backupNoteCount as number | undefined;
      return result;
    case 'restoreBackup':
      if (reply.restored !== true) throw new Error('The backup could not be restored.');
      result.restored = true; return result;
    case 'hotkeyPreferences':
      if (!Number.isInteger(reply.keyCode) || !Number.isInteger(reply.modifiers) || typeof reply.display !== 'string' || typeof reply.registered !== 'boolean'
        || (reply.error !== undefined && reply.error !== null && typeof reply.error !== 'string')) throw new Error('The hotkey preferences response is invalid.');
      result.keyCode = reply.keyCode as number; result.modifiers = reply.modifiers as number; result.display = reply.display;
      result.registered = reply.registered; result.error = reply.error as string | null | undefined; return result;
    case 'theme':
      result.themeID = optionalString(reply.themeID, action, 'themeID');
      result.themeWarning = reply.themeWarning === null || typeof reply.themeWarning === 'string' ? reply.themeWarning : undefined; return result;
    case 'pin': result.pinned = optionalBoolean(reply.pinned, action, 'pinned'); return result;
    case 'clipboard': result.copied = optionalBoolean(reply.copied, action, 'copied'); return result;
    case 'pickAttachments':
      if (reply.attachments !== undefined && (!Array.isArray(reply.attachments) || reply.attachments.some(item => !item || typeof item !== 'object' || Array.isArray(item)))) throw new Error('The attachment response is invalid.');
      result.attachments = reply.attachments as unknown[] | undefined; result.cancelled = optionalBoolean(reply.cancelled, action, 'cancelled'); return result;
    case 'importAttachment':
      if (!reply.attachment || typeof reply.attachment !== 'object' || Array.isArray(reply.attachment)) throw new Error('The attachment response is invalid.');
      result.attachment = reply.attachment; return result;
    case 'pickOCRImage': case 'ocrAttachment':
      result.text = optionalString(reply.text, action, 'text'); result.cancelled = optionalBoolean(reply.cancelled, action, 'cancelled'); return result;
    case 'downloadNoteFont':
      if (typeof reply.downloadedFontID !== 'string') throw new Error('The font response is invalid.');
      result.fontState = reply.fontState === undefined ? undefined : resolveNoteFontState(reply.fontState);
      result.downloadedFontID = reply.downloadedFontID; return result;
    case 'noteFont': case 'noteFonts':
      result.noteFonts = resolveNoteFontState(reply); return result;
    case 'semanticStatus': case 'semanticIndex': case 'semanticSearch': case 'semanticEnable': case 'semanticClear': case 'semanticCancel': case 'semanticStartRuntime': case 'semanticDownload':
      return reply as NativeReply;
    default:
      return reply as NativeReply;
  }
}

/** The only web-side owner of WKWebView message transport and wire validation. */
export class NativeBridge implements PlatformPort {
  readonly isNative = true;
  private readonly handler: NativeHandler;
  constructor(target: NativeWindow = window as NativeWindow) {
    const handler = target.webkit?.messageHandlers.native;
    if (!handler) throw new Error('The native message bridge is unavailable.');
    this.handler = handler;
  }
  async request<A extends PlatformAction>(action: A, data?: PlatformPayloadMap[A]): Promise<NativeReply> {
    const payload = (data ?? {}) as Record<string, unknown>;
    return validateReply(action, await this.handler.postMessage({ action, ...payload }));
  }
}
