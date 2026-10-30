import type { ViewerCommand, ViewerPreferences, ViewerSnapshot, DocumentWriteResult } from '../domain/model';

export type ViewerEvent =
  | { kind: 'snapshot'; snapshot: ViewerSnapshot }
  | { kind: 'command'; command: ViewerCommand }
  | { kind: 'fault'; message: string };

/** Native shell or isolated browser fallback; neither adapter exposes a note-library capability. */
export interface ViewerPort {
  bootstrap(): Promise<ViewerSnapshot>;
  open(): Promise<null>;
  reload(): Promise<null>;
  discardAndReload(): Promise<null>;
  unlockDocument(): Promise<ViewerSnapshot>;
  lockDocument(): Promise<ViewerSnapshot>;
  setDocumentDirty(dirty: boolean): Promise<ViewerSnapshot>;
  keepDocumentEdits(): Promise<ViewerSnapshot>;
  saveDocument(expectedRevision: string, markdown: string): Promise<DocumentWriteResult>;
  savePreferences(preferences: ViewerPreferences): Promise<ViewerSnapshot>;
  openLink(href: string): Promise<null>;
  reveal(): Promise<null>;
  subscribe(listener: (event: ViewerEvent) => void): () => void;
}
