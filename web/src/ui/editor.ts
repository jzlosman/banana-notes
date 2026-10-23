import { Editor } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';
import { markdownExtensions } from './editor-schema';
import { CompactLinkView } from './compact-link-view';
import { NoteFindExtension } from './note-find';
import { handleEditorClipboardCopy, handleEditorClipboardCut, handleEditorClipboardPaste } from './clipboard';
import { installMarkdownSource } from './editor/markdown-source';

export function createMarkdownEditor(element: HTMLElement, markdown: string, onChange: (markdown: string) => void, onEditLink?: (editor: Editor, anchor: HTMLElement) => void): Editor {
  let editor!: Editor;
  editor = new Editor({
    element,
    extensions: [
      ...markdownExtensions(), CompactLinkView, NoteFindExtension,
      Placeholder.configure({ placeholder: 'Start typing…' }),
    ],
    content: '',
    contentType: 'markdown',
    editorProps: {
      attributes: { class: 'markdown-editor', 'aria-label': 'Note editor', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'true', 'data-gramm': 'false', 'data-gramm_editor': 'false', 'data-enable-grammarly': 'false' },
      handleClick: (_view, position, event) => {
        const link = (event.target as HTMLElement).closest('a');
        if (link && (event.metaKey || event.ctrlKey)) { window.open(link.href, '_blank', 'noopener'); return true; }
        if (link && onEditLink) { editor.commands.setTextSelection(position); onEditLink(editor, link); return true; }
        return false;
      },
      handleDOMEvents: {
        copy: (_view, event) => handleEditorClipboardCopy(editor, event as ClipboardEvent),
        cut: (_view, event) => handleEditorClipboardCut(editor, event as ClipboardEvent),
        paste: (_view, event) => handleEditorClipboardPaste(editor, event as ClipboardEvent),
      },
    },
    // Focus can append a trailing paragraph after tables. It is editor geometry,
    // not a note edit; only a content-changing command should rewrite Markdown.
    onUpdate: ({ editor, transaction }) => { if (transaction.docChanged) onChange(editor.getMarkdown()); },
  });
  installMarkdownSource(editor, markdown);
  return editor;
}
