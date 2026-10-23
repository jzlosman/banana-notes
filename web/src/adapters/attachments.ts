import { isManagedMediaURL, type AttachmentRecord } from '../domain/managed-media';
import type { AttachmentFile } from '../application/ports';
export { attachmentMarkdown, isManagedMediaURL } from '../domain/managed-media';
export type { AttachmentRecord } from '../domain/managed-media';

export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export type AttachmentImport = (data: { name: string; mimeType: string; dataBase64: string }) => Promise<unknown>;

const allowed = new Map<string, string>([
  ['image/png', 'image'], ['image/jpeg', 'image'], ['image/gif', 'image'], ['image/webp', 'image'], ['image/heic', 'image'],
  ['audio/mpeg', 'audio'], ['audio/mp4', 'audio'], ['audio/wav', 'audio'],
  ['video/mp4', 'video'], ['video/quicktime', 'video'], ['video/webm', 'video'],
]);

async function readBase64(file: AttachmentFile): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export function validateAttachmentRecord(value: unknown, expectedKind: string): AttachmentRecord {
  if (!value || typeof value !== 'object') throw new Error('Native attachment response is invalid.');
  const r = value as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string' || r.kind !== expectedKind || typeof r.url !== 'string' || !isManagedMediaURL(r.url) || typeof r.size !== 'number' || !Number.isInteger(r.size) || r.size < 1 || r.size > MAX_ATTACHMENT_BYTES || typeof r.mimeType !== 'string' || allowed.get(r.mimeType) !== expectedKind) throw new Error('Native attachment response is invalid.');
  return r as unknown as AttachmentRecord;
}

/** Validates and encodes local files before invoking the native persistence port. */
export async function importAttachments(files: Iterable<AttachmentFile>, invoke: AttachmentImport): Promise<AttachmentRecord[]> {
  const selected = Array.from(files);
  const mime = (file: AttachmentFile) => file.type.toLowerCase() || ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heic', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' } as Record<string, string>)[file.name.split('.').pop()?.toLowerCase() || ''] || '';
  for (const file of selected) {
    if (file.size < 1 || file.size > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name} must be between 1 byte and 50 MiB.`);
    if (!allowed.has(mime(file))) throw new Error(`${file.name} has an unsupported media type.`);
  }
  const records: AttachmentRecord[] = [];
  for (const file of selected) {
    const reply = await invoke({ name: file.name, mimeType: mime(file), dataBase64: await readBase64(file) });
    const object = reply as { attachment?: unknown } | null;
    records.push(validateAttachmentRecord(object?.attachment, allowed.get(mime(file))!));
  }
  return records;
}
