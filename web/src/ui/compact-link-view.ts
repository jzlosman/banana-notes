import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { compactRawLinkLabel } from '../domain/links';

const key = new PluginKey('compactRawLinkView');
const LINK_MARK = 'link';

function hrefOf(marks: readonly { type: { name: string }; attrs: Record<string, unknown> }[]): string | null {
  const mark = marks.find(candidate => candidate.type.name === LINK_MARK);
  return typeof mark?.attrs.href === 'string' ? mark.attrs.href : null;
}

function buildDecorations(state: EditorState, focused: boolean): DecorationSet {
  const decorations: Decoration[] = [];
  state.doc.descendants((node, pos, parent, index) => {
    if (!node.isText || !node.text || !parent) return;
    const href = hrefOf(node.marks);
    if (!href) return;
    const from = pos, to = pos + node.nodeSize;
    if (focused && state.selection.from < to && state.selection.to > from) return;
    const previous = index > 0 ? parent.child(index - 1) : null;
    const next = index + 1 < parent.childCount ? parent.child(index + 1) : null;
    if ((previous?.isText && hrefOf(previous.marks) === href) || (next?.isText && hrefOf(next.marks) === href)) return;
    const compact = compactRawLinkLabel(node.text, href);
    if (!compact) return;
    decorations.push(Decoration.inline(from, to, { class: 'compact-link-source-range' }));
    decorations.push(Decoration.widget(from, view => {
      const widget = view.dom.ownerDocument.createElement('span');
      widget.className = 'compact-link-label'; widget.textContent = compact; widget.title = href;
      widget.setAttribute('aria-hidden', 'true'); widget.setAttribute('contenteditable', 'false');
      return widget;
    }, { key: `compact:${from}:${href}:${compact}`, side: -1, marks: node.marks }));
  });
  return DecorationSet.create(state.doc, decorations);
}

export const CompactLinkView = Extension.create({
  name: 'compactLinkView',
  addProseMirrorPlugins() {
    let view: EditorView | null = null;
    return [new Plugin({
      key,
      props: { decorations: state => buildDecorations(state, view?.hasFocus() ?? false) },
      view: editorView => {
        view = editorView;
        return { update: updated => { view = updated; }, destroy: () => { view = null; } };
      },
    })];
  },
});
