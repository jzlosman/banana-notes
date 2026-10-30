import type { ViewerCommand, ViewerDefaultAppOutcome, ViewerDefaultAppStatus, ViewerPreferences, ViewerSnapshot } from '../domain/model';

export type ViewerEvent =
  | { kind: 'snapshot'; snapshot: ViewerSnapshot }
  | { kind: 'command'; command: ViewerCommand }
  | { kind: 'fault'; message: string };

/** Native shell or isolated browser fallback; neither adapter exposes a note-library capability. */
export interface ViewerPort {
  bootstrap(): Promise<ViewerSnapshot>;
  open(): Promise<null>;
  reload(): Promise<null>;
  savePreferences(preferences: ViewerPreferences): Promise<ViewerSnapshot>;
  queryDefaultAppStatus(): Promise<ViewerDefaultAppStatus>;
  setDefaultApp(enabled: boolean): Promise<ViewerDefaultAppOutcome>;
  openLink(href: string): Promise<null>;
  reveal(): Promise<null>;
  subscribe(listener: (event: ViewerEvent) => void): () => void;
}
