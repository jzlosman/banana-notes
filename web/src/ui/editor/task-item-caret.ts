import { Extension } from '@tiptap/core';
import { Plugin, TextSelection, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

function inTaskItemParagraph(state: EditorState): TextSelection | null {
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;

  const { $from } = selection;
  if ($from.parent.type.name !== 'paragraph' || $from.depth < 1) return null;
  return $from.node(-1).type.name === 'taskItem' ? selection : null;
}

export function taskItemCaretStart(state: EditorState): TextSelection | null {
  const selection = inTaskItemParagraph(state);
  return selection?.$from.parentOffset === 0 ? selection : null;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function firstGraphemeLength(text: string): number {
  const first = graphemes.segment(text)[Symbol.iterator]().next();
  return first.done ? 0 : first.value.segment.length;
}

export function taskItemCaretRightTarget(state: EditorState): number | null {
  const selection = taskItemCaretStart(state);
  if (!selection) return null;

  const text = selection.$from.parent.textBetween(0, selection.$from.parent.content.size, '', '\uFFFC');
  const length = firstGraphemeLength(text);
  return length === 0 ? null : selection.from + length;
}

function visualAdjacentPosition(view: EditorView, selection: TextSelection, direction: 'up' | 'down'): number | null {
  const rect = view.coordsAtPos(selection.from);
  const lineHeight = rect.bottom - rect.top;
  if (lineHeight <= 0) return null;

  const top = direction === 'up' ? rect.top - lineHeight / 2 : rect.bottom + lineHeight / 2;
  const hit = view.posAtCoords({ left: rect.left, top });
  if (!hit) return null;

  const $target = view.state.doc.resolve(hit.pos);
  if (!$target.parent.isTextblock) return null;
  const target = TextSelection.create(view.state.doc, hit.pos);
  return target.$from.parent.isTextblock && target.from !== selection.from ? target.from : null;
}

export function handleTaskItemCaretKeyDown(view: EditorView, event: KeyboardEvent): boolean {
  const unmodified = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
  const commandLeft = event.key === 'ArrowLeft' && event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey;
  const home = event.key === 'Home' && unmodified;
  if (commandLeft || home) {
    const selection = inTaskItemParagraph(view.state);
    if (!selection || selection.$from.parentOffset === 0) return false;

    const start = selection.from - selection.$from.parentOffset;
    event.preventDefault();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start)));
    return true;
  }

  if (!unmodified) return false;
  if (event.key === 'ArrowRight') {
    const target = taskItemCaretRightTarget(view.state);
    if (target === null) return false;

    event.preventDefault();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, target)));
    return true;
  }

  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return false;
  const selection = taskItemCaretStart(view.state);
  if (!selection) return false;

  const target = visualAdjacentPosition(view, selection, event.key === 'ArrowUp' ? 'up' : 'down');
  if (target === null) return false;

  event.preventDefault();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, target)));
  return true;
}

/** Repairs WebKit's task-paragraph start caret without replacing native movement elsewhere. */
export const TaskItemCaret = Extension.create({
  name: 'taskItemCaret',
  addProseMirrorPlugins() {
    return [new Plugin({ props: { handleKeyDown: handleTaskItemCaretKeyDown } })];
  },
});
