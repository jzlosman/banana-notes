import type { Editor } from '@tiptap/core';
import { closePopover, openPopover } from './action-menu';
import { applyLinkEdit, queryLinkSelection, removeSelectedLink, type LinkEditResult } from './editor-links';

/** An ephemeral view; all note changes go through the editor command adapter. */
export function openLinkEditor(editor: Editor, trigger: HTMLElement): boolean {
  const selection = queryLinkSelection(editor);
  if (!selection) return false;
  const doc = trigger.ownerDocument;
  const restoreFocus = () => { if (!editor.isDestroyed) editor.commands.focus(); };
  const form = doc.createElement('form'); form.className = 'link-editor'; form.noValidate = true;
  const title = doc.createElement('h2'); title.textContent = selection.href ? 'Edit link' : 'Add link';
  const address = doc.createElement('input'); address.name = 'address'; address.type = 'text'; address.inputMode = 'url'; address.autocomplete = 'off'; address.spellcheck = false; address.setAttribute('autocapitalize', 'off'); address.placeholder = 'https://example.com'; address.value = selection.href;
  const text = doc.createElement('input'); text.name = 'text'; text.type = 'text'; text.value = selection.editableText ? selection.text : selection.text.replace(/\n+/g, ' '); text.placeholder = 'Use the address'; text.readOnly = !selection.editableText;
  const label = (name: string, input: HTMLInputElement) => { const item = doc.createElement('label'); item.append(doc.createTextNode(name), input); return item; };
  const hint = doc.createElement('p'); hint.className = 'link-editor-hint'; hint.textContent = selection.editableText ? 'Long URLs look shorter. The destination stays intact.' : 'The selected paragraphs keep their text and formatting.';
  const error = doc.createElement('p'); error.className = 'link-editor-error'; error.id = 'link-editor-error'; error.setAttribute('role', 'alert'); error.hidden = true;
  const actions = doc.createElement('div'); actions.className = 'link-editor-actions';
  const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
  cancel.onclick = () => { closePopover(); if (!editor.isDestroyed) editor.commands.focus(); };
  const save = doc.createElement('button'); save.type = 'submit'; save.className = 'primary-button'; save.textContent = selection.href ? 'Save link' : 'Add link';
  const finish = (result: LinkEditResult) => {
    if (result.ok) { closePopover(); return; }
    error.textContent = result.error; error.hidden = false; address.setAttribute('aria-invalid', 'true'); address.setAttribute('aria-describedby', error.id);
    openPopover(trigger, form, { label: title.textContent!, restoreFocus });
  };
  if (selection.href) {
    const remove = doc.createElement('button'); remove.type = 'button'; remove.className = 'link-editor-remove'; remove.textContent = 'Remove link'; remove.onclick = () => finish(removeSelectedLink(editor, selection)); actions.append(remove);
  }
  actions.append(cancel, save);
  form.append(title, label('Link address', address), label('Text', text), hint, error, actions);
  address.oninput = () => { error.hidden = true; address.removeAttribute('aria-invalid'); address.removeAttribute('aria-describedby'); };
  form.onsubmit = event => { event.preventDefault(); finish(applyLinkEdit(editor, selection, { address: address.value, text: text.value })); };
  openPopover(trigger, form, { label: title.textContent, restoreFocus }); address.select();
  return true;
}
