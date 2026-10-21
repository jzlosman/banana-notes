import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachmentMarkdown, importAttachments, isManagedMediaURL, MAX_ATTACHMENT_BYTES } from '../src/attachments';

const record = { id:'12345678-1234-1234-1234-123456789abc', name:'photo.png', kind:'image' as const, url:'foldnote-asset://media/12345678-1234-1234-1234-123456789abc.png', size:4, mimeType:'image/png' };
test('attachment insertion emits Markdown only for validated managed URLs', () => {
  assert.equal(attachmentMarkdown(record), `![photo.png](${record.url})`);
  assert.equal(isManagedMediaURL(record.url), true);
  assert.equal(isManagedMediaURL('file:///etc/passwd'), false);
  assert.throws(() => attachmentMarkdown({ ...record, url:'javascript:alert(1)' }));
});
test('attachment file size and MIME are rejected before invoking FileReader/native bridge', async () => {
  let calls = 0;
  const invoke = async () => { calls++; return { attachment: record }; };
  const huge = { name:'huge.png', type:'image/png', size:MAX_ATTACHMENT_BYTES + 1 } as File;
  await assert.rejects(importAttachments([huge], invoke), /50 MiB/);
  const wrong = { name:'bad.exe', type:'application/octet-stream', size:1 } as File;
  await assert.rejects(importAttachments([wrong], invoke), /unsupported/);
  assert.equal(calls, 0);
});
test('audio and video Markdown helpers use controls without autoplay', () => {
  const base = { ...record, kind:'audio' as const, name:'voice.m4a', mimeType:'audio/mp4' };
  assert.equal(attachmentMarkdown(base), `<audio controls src="${base.url}"></audio>`);
  assert.equal(attachmentMarkdown({ ...base, kind:'video', name:'clip.mp4', mimeType:'video/mp4' }), `<video controls src="${base.url}"></video>`);
});
