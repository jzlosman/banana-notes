import { resolveFontSize, DEFAULT_FONT_SIZE } from '../../domain/font-size';
import type { ViewerEditState, DocumentWriteResult } from './editing';
import { themes, resolveThemeID, SYSTEM_THEME } from '../../domain/themes';
import fontCatalog from '../../domain/note-font-catalog.json' with { type: 'json' };

export type ViewerDocument =
  | { kind: 'empty' }
  | { kind: 'loaded'; documentID: string; name: string; markdown: string; revision: string; resourceBaseURL: string }
  | { kind: 'error'; name: string; message: string };

export type ViewerPreferences = {
  themeID: string;
  syntaxThemeID: string;
  fontID: string;
  fontWeight: number;
  fontSize: number;
  focusedOpacity: number;
  unfocusedOpacity: number;
  glass: number;
};

export type ViewerSnapshot = {
  document: ViewerDocument;
  preferences: ViewerPreferences;
  editing: ViewerEditState | { kind: 'unavailable' };
  externalChange: boolean;
};
export type ViewerCommand = 'settings' | 'find' | 'source' | 'zoomIn' | 'zoomOut' | 'zoomReset' | 'toggleEditing' | 'save' | 'saveForClose';
export type { DocumentWriteResult };

export const DEFAULT_VIEWER_PREFERENCES: ViewerPreferences = {
  themeID: SYSTEM_THEME,
  syntaxThemeID: 'app',
  fontID: 'space-mono',
  fontWeight: 400,
  fontSize: DEFAULT_FONT_SIZE,
  focusedOpacity: 1,
  unfocusedOpacity: 1,
  glass: 0,
};

const knownThemes = new Set(themes.map(theme => theme.id));
const knownSyntaxThemes = new Set(['app', ...knownThemes]);
const fonts = fontCatalog as { id: string; weights: number[] }[];
const fontByID = new Map(fonts.map(font => [font.id, font]));

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function boundedFraction(value: unknown, fallback: number, minimum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(minimum, value)) : fallback;
}

function supportedFontWeight(fontID: string, value: unknown): number {
  const weights = fontByID.get(fontID)?.weights ?? [];
  const requested = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : DEFAULT_VIEWER_PREFERENCES.fontWeight;
  return weights.reduce((nearest, weight) => Math.abs(weight - requested) < Math.abs(nearest - requested) ? weight : nearest, weights[0] ?? 400);
}

/** Convert preference input into the closed, renderer-supported value set. */
export function normalizeViewerPreferences(value: unknown): ViewerPreferences {
  const candidate = record(value);
  const themeID = resolveThemeID(candidate.themeID);
  const syntaxThemeID = typeof candidate.syntaxThemeID === 'string' && knownSyntaxThemes.has(candidate.syntaxThemeID)
    ? candidate.syntaxThemeID : 'app';
  const fontID = typeof candidate.fontID === 'string' && fontByID.has(candidate.fontID)
    ? candidate.fontID : DEFAULT_VIEWER_PREFERENCES.fontID;
  return {
    themeID,
    syntaxThemeID,
    fontID,
    fontWeight: supportedFontWeight(fontID, candidate.fontWeight),
    fontSize: resolveFontSize(candidate.fontSize),
    focusedOpacity: boundedFraction(candidate.focusedOpacity, DEFAULT_VIEWER_PREFERENCES.focusedOpacity, 0.05),
    unfocusedOpacity: boundedFraction(candidate.unfocusedOpacity, DEFAULT_VIEWER_PREFERENCES.unfocusedOpacity, 0.05),
    glass: boundedFraction(candidate.glass, DEFAULT_VIEWER_PREFERENCES.glass, 0),
  };
}

const safeName = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 1024 && !/[\u0000-\u001f]/.test(value);
const safeMessage = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 4000;

/** Native replies/events are decoded once by their adapter before entering the application. */
export function decodeNativeSnapshot(value: unknown): ViewerSnapshot {
  const snapshot = record(value);
  const rawDocument = record(snapshot.document);
  let decodedDocument: ViewerDocument;
  if (rawDocument.kind === 'empty') decodedDocument = { kind: 'empty' };
  else if (rawDocument.kind === 'error' && safeName(rawDocument.name) && safeMessage(rawDocument.message)) {
    decodedDocument = { kind: 'error', name: rawDocument.name, message: rawDocument.message };
  } else if (rawDocument.kind === 'loaded' && typeof rawDocument.documentID === 'string' && /^[a-z0-9_-]{1,128}$/.test(rawDocument.documentID) &&
    safeName(rawDocument.name) && typeof rawDocument.markdown === 'string' &&
    typeof rawDocument.revision === 'string' && rawDocument.revision.length > 0 && rawDocument.revision.length <= 512 &&
    rawDocument.resourceBaseURL === 'banana-viewer-resource://document/') {
    decodedDocument = {
      kind: 'loaded', documentID: rawDocument.documentID, name: rawDocument.name, markdown: rawDocument.markdown,
      revision: rawDocument.revision, resourceBaseURL: rawDocument.resourceBaseURL,
    };
  } else throw new Error('The Banana Viewer document response is invalid.');

  if (!snapshot.preferences || typeof snapshot.preferences !== 'object' || Array.isArray(snapshot.preferences)) {
    throw new Error('The Banana Viewer preferences response is invalid.');
  }
  const rawEditing = record(snapshot.editing);
  const editing: ViewerEditState = rawEditing.kind === 'locked'
    ? { kind: 'locked' }
    : rawEditing.kind === 'unlocked' && typeof rawEditing.dirty === 'boolean'
      ? { kind: 'unlocked', dirty: rawEditing.dirty }
      : (() => { throw new Error('The Banana Viewer editing response is invalid.'); })();
  if (typeof snapshot.externalChange !== 'boolean') throw new Error('The Banana Viewer external-change response is invalid.');
  return { document: decodedDocument, preferences: normalizeViewerPreferences(snapshot.preferences), editing, externalChange: snapshot.externalChange };
}

export function isViewerCommand(value: unknown): value is ViewerCommand {
  return value === 'settings' || value === 'find' || value === 'source' || value === 'zoomIn' || value === 'zoomOut' || value === 'zoomReset' || value === 'toggleEditing' || value === 'save' || value === 'saveForClose';
}

export function isSafeViewerLink(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || /[\u0000-\u0020\u007f]/.test(value)) return false;
  if (value.startsWith('#')) return true;
  if (value.startsWith('//') || value.startsWith('\\\\')) return false;
  const scheme = value.match(/^([A-Za-z][A-Za-z0-9+.-]*):/);
  if (!scheme) return true;
  if (!['http', 'https', 'mailto'].includes(scheme[1].toLowerCase())) return false;
  if (scheme[1].toLowerCase() === 'mailto') return /^mailto:[^\s@]+@[^\s@]+$/i.test(value);
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

export function isSafeRelativeImageSource(source: string): boolean {
  if (!source || source.length > 4096 || /[\\\u0000-\u001f\u007f?#]/.test(source) || source.startsWith('/') || source.startsWith('//')) return false;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(source)) return false;
  source = source.replace(/^(?:\.\/)+/, '');
  if (!source) return false;
  const segments = source.split('/');
  if (segments.some(segment => segment.length === 0)) return false;
  try {
    return segments.every(segment => {
      const decoded = decodeURIComponent(segment);
      return decoded !== '.' && decoded !== '..' && !/[\\/\u0000-\u001f\u007f]/.test(decoded);
    });
  } catch { return false; }
}

const rasterExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);
function supportedRasterURL(url: URL): boolean {
  try {
    const filename = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    return rasterExtensions.has(filename.split('.').pop()?.toLowerCase() ?? '');
  } catch { return false; }
}

export function resolveViewerImageSource(source: string, resourceBaseURL: string): string | null {
  if (!isSafeRelativeImageSource(source)) return null;
  try {
    const base = new URL(resourceBaseURL);
    const resolved = new URL(source, base);
    if (!supportedRasterURL(resolved)) return null;
    if (base.protocol === 'banana-viewer-resource:') {
      return base.href === 'banana-viewer-resource://document/' && resolved.protocol === base.protocol && resolved.host === 'document'
        ? resolved.href : null;
    }
    if (['http:', 'https:'].includes(base.protocol) && resolved.origin === base.origin && !resolved.username && !resolved.password) return resolved.href;
    return null;
  } catch { return null; }
}

export function isResolvedViewerImageSource(source: string, resourceBaseURL: string): boolean {
  try {
    const base = new URL(resourceBaseURL), resolved = new URL(source);
    if (resolved.search || resolved.hash || resolved.username || resolved.password) return false;
    if (!supportedRasterURL(resolved)) return false;
    if (base.protocol === 'banana-viewer-resource:') {
      return base.href === 'banana-viewer-resource://document/' && resolved.protocol === base.protocol && resolved.host === 'document' &&
        isSafeRelativeImageSource(resolved.pathname.slice(1));
    }
    if (!['http:', 'https:'].includes(base.protocol) || resolved.origin !== base.origin || !base.pathname.endsWith('/') || !resolved.pathname.startsWith(base.pathname)) return false;
    return isSafeRelativeImageSource(resolved.pathname.slice(base.pathname.length));
  } catch { return false; }
}
