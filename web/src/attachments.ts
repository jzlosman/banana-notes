import { isManagedMediaURL } from './domain/managed-media';
export { isManagedMediaURL } from './domain/managed-media';

export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

export interface AttachmentRecord {
  id: string; name: string; kind: 'image' | 'audio' | 'video'; url: string; size: number; mimeType: string;
}
export type NativeInvoke = (action: string, data: Record<string, unknown>) => Promise<unknown>;

const allowed = new Map<string, string>([
  ['image/png','image'],['image/jpeg','image'],['image/gif','image'],['image/webp','image'],['image/heic','image'],
  ['audio/mpeg','audio'],['audio/mp4','audio'],['audio/wav','audio'],
  ['video/mp4','video'],['video/quicktime','video'],['video/webm','video'],
]);

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') { reject(new Error(`Could not read ${file.name}.`)); return; }
      const comma = result.indexOf(',');
      if (comma < 0) { reject(new Error(`Could not encode ${file.name}.`)); return; }
      resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

function validateRecord(value: unknown, expectedKind: string): AttachmentRecord {
  if (!value || typeof value !== 'object') throw new Error('Native attachment response is invalid.');
  const r = value as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string' || r.kind !== expectedKind || typeof r.url !== 'string' || !isManagedMediaURL(r.url) || typeof r.size !== 'number' || !Number.isInteger(r.size) || r.size < 1 || r.size > MAX_ATTACHMENT_BYTES || typeof r.mimeType !== 'string' || allowed.get(r.mimeType) !== expectedKind) throw new Error('Native attachment response is invalid.');
  return r as unknown as AttachmentRecord;
}

/** Imports local picker/drop/paste files through the native persistence port. */
export async function importAttachments(files: Iterable<File>, invoke: NativeInvoke): Promise<AttachmentRecord[]> {
  const selected = Array.from(files);
  const mime = (file: File) => file.type.toLowerCase() || ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heic', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' } as Record<string, string>)[file.name.split('.').pop()?.toLowerCase() || ''] || '';
  for (const file of selected) {
    if (file.size < 1 || file.size > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name} must be between 1 byte and 50 MiB.`);
    if (!allowed.has(mime(file))) throw new Error(`${file.name} has an unsupported media type.`);
  }
  const records: AttachmentRecord[] = [];
  for (const file of selected) {
    const reply = await invoke('importAttachment', { name: file.name, mimeType: mime(file), dataBase64: await readBase64(file) });
    const object = reply as { attachment?: unknown } | null;
    records.push(validateRecord(object?.attachment, allowed.get(mime(file))!));
  }
  return records;
}

/** Produces the persisted Markdown representation; inserts only managed native URLs. */
export function attachmentMarkdown(record: AttachmentRecord): string {
  if (!isManagedMediaURL(record.url)) throw new Error('Attachment URL is not managed media.');
  const label = record.name.replace(/[\\[\]]/g, '\\$&').replace(/\s+/g, ' ').trim() || 'attachment';
  if (record.kind === 'image') return `![${label}](${record.url})`;
  return `<${record.kind} controls src="${record.url}"></${record.kind}>`;
}
