import { Editor, type JSONContent } from '@tiptap/core';
import { DOMSerializer, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { splitDocument } from './domain';
import { markdownExtensions } from './editor-schema';

export type ClipboardFormat = 'markdown' | 'formatted' | 'html' | 'text';
export interface ClipboardPayload { text: string; html?: string; markdown?: string }

function markdownFor(editor: Editor, content: JSONContent[]): string {
  return editor.markdown!.serialize({ type: 'doc', content });
}

function safeHTML(editor: Editor, doc: ProseMirrorNode): string {
  const fragment = DOMSerializer.fromSchema(editor.schema).serializeFragment(doc.content, { document });
  const container = document.createElement('div');
  container.append(fragment);
  return container.innerHTML;
}

function renderedPayload(editor: Editor, doc: ProseMirrorNode, markdown: string, format: ClipboardFormat): ClipboardPayload {
  if (format === 'markdown') return { text: markdown, markdown };
  const html = safeHTML(editor, doc);
  const text = doc.textBetween(0, doc.content.size, '\n\n', (node: ProseMirrorNode) => node.type.name === 'hardBreak' ? '\n' : '');
  if (format === 'formatted') return { text, html };
  if (format === 'html') return { text: html };
  return { text };
}

export function selectionClipboardPayload(editor: Editor, format: ClipboardFormat): ClipboardPayload | null {
  const { from, to } = editor.state.selection;
  if (from === to) return null;
  const slice = editor.state.selection.content();
  const markdown = markdownFor(editor, slice.content.toJSON());
  const doc = editor.state.schema.topNodeType.create(null, slice.content);
  return renderedPayload(editor, doc, markdown, format);
}

export function documentClipboardPayload(markdown: string, format: ClipboardFormat): ClipboardPayload {
  if (format === 'markdown') return { text: markdown, markdown };
  const body = splitDocument(markdown).body;
  const host = document.createElement('div');
  const editor = new Editor({ element: host, extensions: markdownExtensions(), content: body, contentType: 'markdown' });
  try {
    const doc = editor.state.doc;
    const renderedMarkdown = editor.getMarkdown();
    return renderedPayload(editor, doc, renderedMarkdown, format);
  } finally {
    editor.destroy();
  }
}

function writePayload(event: ClipboardEvent, payload: ClipboardPayload): boolean {
  const data = event.clipboardData;
  if (!data) return false;
  try {
    data.clearData();
    data.setData('text/plain', payload.text);
    if (payload.markdown !== undefined) data.setData('text/markdown', payload.markdown);
    event.preventDefault();
    return true;
  } catch {
    return false;
  }
}

export function handleEditorClipboardCopy(editor: Editor, event: ClipboardEvent): boolean {
  const payload = selectionClipboardPayload(editor, 'markdown');
  if (!payload) return false;
  event.preventDefault(); writePayload(event, payload); return true;
}

export function handleEditorClipboardCut(editor: Editor, event: ClipboardEvent): boolean {
  const payload = selectionClipboardPayload(editor, 'markdown');
  if (!payload) return false;
  event.preventDefault();
  if (writePayload(event, payload)) editor.commands.deleteSelection();
  return true;
}

export function handleEditorClipboardPaste(editor: Editor, event: ClipboardEvent): boolean {
  const markdown = event.clipboardData?.getData('text/markdown');
  if (!markdown) return false;
  event.preventDefault();
  editor.commands.insertContent(markdown, { contentType: 'markdown' });
  return true;
}
