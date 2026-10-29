import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { TableKit } from '@tiptap/extension-table';
import { Marked, type marked } from 'marked';
import { mediaExtensions, type MarkdownImageResolver } from './media-extension';
import { createHighlightedCodeBlock } from './code-highlighting';
import { RawMarkdownBlock } from './editor/markdown-source';

/** The live editor and clipboard renderer must use the same safe Markdown grammar. */
export function markdownExtensions(options: { imageResolver?: MarkdownImageResolver } = {}) {
  return [
    StarterKit.configure({ codeBlock: false, link: { openOnClick: false, autolink: true, defaultProtocol: 'https', protocols: ['http', 'https', 'mailto', 'banananotes', 'foldnote'] } }),
    // Never share Marked's mutable tokenizer registry across editor instances.
    Markdown.configure({ marked: new Marked() as unknown as typeof marked }),
    TaskList, TaskItem.configure({ nested: true }), TableKit.configure({ table: { resizable: false } }),
    createHighlightedCodeBlock(), ...mediaExtensions(options), RawMarkdownBlock,
  ];
}
