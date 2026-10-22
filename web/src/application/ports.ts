import type { Library } from '../domain/library';
export type { NativeReply, PlatformAction, PlatformPort } from './platform';

export interface LibraryRepository {
  save(library: Library): Promise<void>;
}
export interface Clock { now(): string }
export interface IdGenerator { next(): string }
export interface PreferencesRepository<T> { save(value: T): Promise<void> }
export interface ClipboardPort { write(content: { text: string; html?: string }): Promise<void> }
export interface AttachmentPort { import(files: File[]): Promise<unknown[]> }
export interface ExportPort { exportMarkdown(notes: readonly { id: string; title: string; markdown: string }[]): Promise<void> }
export interface SemanticSearchPort {
  status(): Promise<unknown>;
  prepareIndex(): Promise<unknown>;
  semanticSearch(query: string, candidateIDs: readonly string[]): Promise<readonly string[]>;
}
export interface WindowPort {
  hide(): Promise<void>;
  pin(pinned: boolean): Promise<boolean>;
  setDragRegion(rect: { x: number; y: number; width: number; height: number }): Promise<void>;
  focus(): Promise<void>;
}
export interface StartupPort {
  ready(): Promise<void>;
  preferences(): Promise<unknown>;
}
