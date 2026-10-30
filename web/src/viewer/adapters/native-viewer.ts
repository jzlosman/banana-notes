import type { ViewerPort, ViewerEvent } from '../application/ports';
import { decodeNativeDefaultAppOutcome, decodeNativeDefaultAppStatus, decodeNativeSnapshot, isSafeViewerLink, isViewerCommand, type DocumentWriteResult, type ViewerDefaultAppOutcome, type ViewerDefaultAppStatus, type ViewerPreferences, type ViewerSnapshot } from '../domain/model';

type ViewerMessage =
  | { action: 'bootstrap' }
  | { action: 'open' }
  | { action: 'reload' }
  | { action: 'reloadDiscardingEdits' }
  | { action: 'unlockDocument' }
  | { action: 'lockDocument' }
  | { action: 'documentDirty'; dirty: boolean }
  | { action: 'keepDocumentEdits' }
  | { action: 'saveDocument'; expectedRevision: string; markdown: string }
  | { action: 'preferences'; preferences: ViewerPreferences }
  | { action: 'openLink'; href: string }
  | { action: 'reveal' }
  | { action: 'defaultAppStatus' }
  | { action: 'setDefaultApp'; enabled: boolean };

type ViewerHandler = { postMessage(message: ViewerMessage): Promise<unknown> };

function handlerFrom(target: Window): ViewerHandler {
  const handler = (target as Window & { webkit?: { messageHandlers?: { viewer?: ViewerHandler } } }).webkit?.messageHandlers?.viewer;
  if (!handler || typeof handler.postMessage !== 'function') throw new Error('The Banana Viewer native bridge is unavailable.');
  return handler;
}

/** Native message/event adapter. All wire data is validated here before application use. */
export class NativeViewerAdapter implements ViewerPort {
  private readonly handler: ViewerHandler;
  constructor(private readonly target: Window = window) { this.handler = handlerFrom(target); }

  async bootstrap(): Promise<ViewerSnapshot> {
    return decodeNativeSnapshot(await this.handler.postMessage({ action: 'bootstrap' }));
  }

  async open(): Promise<null> { return this.expectNull({ action: 'open' }); }
  async reload(): Promise<null> { return this.expectNull({ action: 'reload' }); }
  async discardAndReload(): Promise<null> { return this.expectNull({ action: 'reloadDiscardingEdits' }); }
  async reveal(): Promise<null> { return this.expectNull({ action: 'reveal' }); }
  async unlockDocument(): Promise<ViewerSnapshot> { return this.expectSnapshot({ action: 'unlockDocument' }); }
  async lockDocument(): Promise<ViewerSnapshot> { return this.expectSnapshot({ action: 'lockDocument' }); }
  async setDocumentDirty(dirty: boolean): Promise<ViewerSnapshot> { return this.expectSnapshot({ action: 'documentDirty', dirty }); }
  async keepDocumentEdits(): Promise<ViewerSnapshot> { return this.expectSnapshot({ action: 'keepDocumentEdits' }); }

  async saveDocument(expectedRevision: string, markdown: string): Promise<DocumentWriteResult> {
    if (typeof expectedRevision !== 'string' || !/^[0-9a-f]{64}$/.test(expectedRevision) ||
        typeof markdown !== 'string' || new TextEncoder().encode(markdown).byteLength > 8 * 1024 * 1024) {
      throw new Error('The document save request is invalid.');
    }
    const value = await this.handler.postMessage({ action: 'saveDocument', expectedRevision, markdown });
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('The native save response was invalid.');
    const result = value as Record<string, unknown>;
    if (result.kind === 'saved' && typeof result.revision === 'string' && result.revision.length > 0 && result.revision.length <= 512) {
      return { kind: 'saved', revision: result.revision };
    }
    if (result.kind === 'conflict') return { kind: 'conflict' };
    const reasons = ['readOnlyFile', 'permissionDenied', 'tooLarge', 'unknown'];
    if (result.kind === 'failed' && reasons.includes(String(result.reason))) return { kind: 'failed', reason: result.reason as Extract<DocumentWriteResult, { kind: 'failed' }>['reason'] };
    throw new Error('The native save response was invalid.');
  }

  async savePreferences(preferences: ViewerPreferences): Promise<ViewerSnapshot> {
    return decodeNativeSnapshot(await this.handler.postMessage({ action: 'preferences', preferences }));
  }

  async queryDefaultAppStatus(): Promise<ViewerDefaultAppStatus> {
    return decodeNativeDefaultAppStatus(await this.handler.postMessage({ action: 'defaultAppStatus' }));
  }

  async setDefaultApp(enabled: boolean): Promise<ViewerDefaultAppOutcome> {
    return decodeNativeDefaultAppOutcome(await this.handler.postMessage({ action: 'setDefaultApp', enabled }));
  }

  async openLink(href: string): Promise<null> {
    if (!isSafeViewerLink(href) || href.startsWith('#')) throw new Error('This link cannot be opened.');
    return this.expectNull({ action: 'openLink', href });
  }

  subscribe(listener: (event: ViewerEvent) => void): () => void {
    const onState = (event: Event) => {
      try { listener({ kind: 'snapshot', snapshot: decodeNativeSnapshot((event as CustomEvent<unknown>).detail) }); }
      catch (error) { listener({ kind: 'fault', message: messageOf(error, 'The native document update was invalid.') }); }
    };
    const onCommand = (event: Event) => {
      const command = (event as CustomEvent<unknown>).detail;
      if (isViewerCommand(command)) listener({ kind: 'command', command });
      else listener({ kind: 'fault', message: 'The native viewer command was invalid.' });
    };
    this.target.addEventListener('banana-viewer-state', onState);
    this.target.addEventListener('banana-viewer-command', onCommand);
    return () => {
      this.target.removeEventListener('banana-viewer-state', onState);
      this.target.removeEventListener('banana-viewer-command', onCommand);
    };
  }

  private async expectSnapshot(message: Extract<ViewerMessage, { action: 'unlockDocument' | 'lockDocument' | 'documentDirty' | 'keepDocumentEdits' }>): Promise<ViewerSnapshot> {
    return decodeNativeSnapshot(await this.handler.postMessage(message));
  }

  private async expectNull(message: Extract<ViewerMessage, { action: 'open' | 'reload' | 'reloadDiscardingEdits' | 'openLink' | 'reveal' }>): Promise<null> {
    const result = await this.handler.postMessage(message);
    if (result !== null) throw new Error(`The native ${message.action} response was invalid.`);
    return null;
  }
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
