const managedMediaURL = /^foldnote-asset:\/\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg|jpeg|gif|webp|heic|heif|mp3|m4a|wav|mp4|mov|webm)$/;
export interface AttachmentRecord {
  id: string; name: string; kind: 'image' | 'audio' | 'video'; url: string; size: number; mimeType: string;
}

export function isManagedMediaURL(value: string): boolean { return managedMediaURL.test(value); }

/** Produces Markdown only for a validated managed-media reference. */
export function attachmentMarkdown(record: AttachmentRecord): string {
  if (!isManagedMediaURL(record.url)) throw new Error('Attachment URL is not managed media.');
  const label = record.name.replace(/[\\[\\]]/g, '\\$&').replace(/\s+/g, ' ').trim() || 'attachment';
  if (record.kind === 'image') return `![${label}](${record.url})`;
  return `<${record.kind} controls src="${record.url}"></${record.kind}>`;
}
