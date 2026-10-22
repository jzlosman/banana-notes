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

function visibleText(doc: ProseMirrorNode): string {
  return doc.textBetween(0, doc.content.size, '\n\n', (node: ProseMirrorNode) => node.type.name === 'hardBreak' ? '\n' : '');
}

function renderedPayload(editor: Editor, doc: ProseMirrorNode, markdown: string, format: ClipboardFormat): ClipboardPayload {
  if (format === 'markdown') return { text: markdown, markdown };
  const html = safeHTML(editor, doc);
  const text = visibleText(doc);
  if (format === 'formatted') return { text, html };
  if (format === 'html') return { text: html };
  return { text };
}

function selectedDocument(editor: Editor): ProseMirrorNode | null {
  if (editor.state.selection.empty) return null;
  return editor.state.schema.topNodeType.create(null, editor.state.selection.content().content);
}

export function selectionClipboardPayload(editor: Editor, format: ClipboardFormat): ClipboardPayload | null {
  const doc = selectedDocument(editor);
  if (!doc) return null;
  return renderedPayload(editor, doc, markdownFor(editor, doc.content.toJSON()), format);
}

function editorClipboardPayload(editor: Editor): ClipboardPayload | null {
  const doc = selectedDocument(editor);
  if (!doc) return null;
  // Plain-text destinations receive what was selected, not Markdown syntax.
  // Keep Markdown in its own flavor for lossless in-app paste.
  return { text: visibleText(doc), markdown: markdownFor(editor, doc.content.toJSON()) };
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
  const payload = editorClipboardPayload(editor);
  if (!payload) return false;
  event.preventDefault(); writePayload(event, payload); return true;
}

export function handleEditorClipboardCut(editor: Editor, event: ClipboardEvent): boolean {
  const payload = editorClipboardPayload(editor);
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
