import { getMarkRange, type Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { isRawURLLabel, normalizeLinkDestination } from '../domain/links';

export interface LinkSelection {
  readonly document: ProseMirrorNode;
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly href: string;
  readonly editableText: boolean;
}
export type LinkEditResult = { ok: true } | { ok: false; error: string };

/** Query the current text/link without moving the selection or changing the note. */
export function queryLinkSelection(editor: Editor): LinkSelection | null {
  if (editor.isDestroyed || !editor.isEditable) return null;
  const { selection, doc, schema } = editor.state;
  if (!(selection instanceof TextSelection)) return null;
  let { from, to } = selection;
  const range = getMarkRange(selection.$from, schema.marks.link);
  let href = '';
  if (range && from >= range.from && to <= range.to) {
    from = range.from; to = range.to;
    href = String(doc.resolve(from).nodeAfter?.marks.find(mark => mark.type === schema.marks.link)?.attrs.href || '');
  }
  let unsupported = !!selection.$from.parent.type.spec.code;
  doc.nodesBetween(from, to, node => {
    if (node.type.spec.code || node.marks.some(mark => mark.type === schema.marks.code) || (node.isInline && !node.isText)) unsupported = true;
  });
  if (unsupported) return null;
  return { document: doc, from, to, href, text: doc.textBetween(from, to, '\n'), editableText: doc.resolve(from).sameParent(doc.resolve(to)) };
}

function current(editor: Editor, selection: LinkSelection): boolean {
  return !editor.isDestroyed && editor.isEditable && editor.state.doc === selection.document;
}

/** One editor transaction: preserve rich text unless its display label was explicitly changed. */
export function applyLinkEdit(editor: Editor, selection: LinkSelection, draft: { address: string; text: string }): LinkEditResult {
  if (!current(editor, selection)) return { ok: false, error: 'The note changed. Close this panel and try again.' };
  const destination = normalizeLinkDestination(draft.address);
  if (!destination.ok) return destination;
  let text = selection.editableText ? (draft.text.trim() ? draft.text : destination.href) : selection.text;
  if (selection.href && text === selection.text && isRawURLLabel(selection.text, selection.href) && destination.href !== selection.href) text = destination.href;
  const chain = editor.chain().focus().setTextSelection({ from: selection.from, to: selection.to });
  let end = selection.to;
  if (selection.editableText && (text !== selection.text || selection.from === selection.to)) {
    const marks = selection.document.resolve(selection.from).marks().filter(mark => mark.type.name !== 'link').map(mark => mark.toJSON());
    chain.insertContent({ type: 'text', text, marks });
    end = selection.from + text.length;
    chain.setTextSelection({ from: selection.from, to: end });
  }
  const applied = chain.setLink({ href: destination.href }).setTextSelection(end).unsetMark('link').run();
  return applied ? { ok: true } : { ok: false, error: 'This selection cannot be linked. Choose regular note text.' };
}

export function removeSelectedLink(editor: Editor, selection: LinkSelection): LinkEditResult {
  if (!current(editor, selection)) return { ok: false, error: 'The note changed. Close this panel and try again.' };
  if (!selection.href) return { ok: false, error: 'Place the cursor in a link to remove it.' };
  editor.chain().focus().setTextSelection({ from: selection.from, to: selection.to }).unsetLink().setTextSelection(selection.to).unsetMark('link').run();
  return { ok: true };
}
