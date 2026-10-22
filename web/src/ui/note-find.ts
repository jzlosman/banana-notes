import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export interface FindMatch { from: number; to: number }
interface FindState { query: string; activeIndex: number; matches: FindMatch[]; decorations: DecorationSet }
interface FindMeta { query: string; activeIndex: number }
const key = new PluginKey<FindState>('banana-note-find');

function normalize(text: string): { value: string; starts: number[]; ends: number[] } {
  let value = '';
  const starts: number[] = [], ends: number[] = [];
  for (let offset = 0; offset < text.length;) {
    const point = text.codePointAt(offset)!;
    const character = String.fromCodePoint(point);
    const normalized = character.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('en-US');
    for (let index = 0; index < normalized.length; index++) { value += normalized[index]; starts.push(offset); ends.push(offset + character.length); }
    if (!normalized.length && ends.length) ends[ends.length - 1] = offset + character.length;
    offset += character.length;
  }
  return { value, starts, ends };
}

export function findMatchesInText(text: string, query: string): Array<{ from: number; to: number }> {
  const needle = normalize(query).value;
  if (!needle) return [];
  const { value, starts, ends } = normalize(text);
  const matches: Array<{ from: number; to: number }> = [];
  for (let index = value.indexOf(needle); index >= 0; index = value.indexOf(needle, index + needle.length)) {
    matches.push({ from: starts[index], to: ends[index + needle.length - 1] });
  }
  return matches;
}

export function noteFindMatches(doc: ProseMirrorNode, query: string): FindMatch[] {
  const needle = normalize(query).value;
  if (!needle) return [];
  let value = '';
  const starts: number[] = [], ends: number[] = [];
  let lastParent: ProseMirrorNode | null = null;
  doc.descendants((node, position, parent) => {
    if (!node.isText || !node.text) return;
    if (lastParent && parent !== lastParent) { value += '\u0000'; starts.push(-1); ends.push(-1); }
    lastParent = parent;
    const source = node.text;
    const normalized = normalize(source);
    value += normalized.value;
    for (let index = 0; index < normalized.value.length; index++) {
      starts.push(position + normalized.starts[index]);
      ends.push(position + normalized.ends[index]);
    }
  });
  const matches: FindMatch[] = [];
  for (let index = value.indexOf(needle); index >= 0; index = value.indexOf(needle, index + needle.length)) {
    const from = starts[index], to = ends[index + needle.length - 1];
    if (from >= 0 && to > from && !starts.slice(index, index + needle.length).includes(-1)) matches.push({ from, to });
  }
  return matches;
}

function decorationSet(doc: ProseMirrorNode, query: string, activeIndex: number): { matches: FindMatch[]; decorations: DecorationSet } {
  const matches = noteFindMatches(doc, query);
  const active = matches.length ? ((activeIndex % matches.length) + matches.length) % matches.length : -1;
  const decorations = matches.map((match, index) => Decoration.inline(match.from, match.to, {
    class: index === active ? 'note-find-match note-find-current' : 'note-find-match',
    'data-find-index': String(index),
  }));
  return { matches, decorations: DecorationSet.create(doc, decorations) };
}

export const NoteFindExtension = Extension.create({
  name: 'noteFind',
  addProseMirrorPlugins() {
    return [new Plugin<FindState>({
      key,
      state: {
        init: (_, state) => ({ query: '', activeIndex: 0, ...decorationSet(state.doc, '', 0) }),
        apply: (transaction, previous) => {
          const update = transaction.getMeta(key) as FindMeta | undefined;
          if (!update && !transaction.docChanged) return previous;
          const query = update?.query ?? previous.query;
          const activeIndex = update?.activeIndex ?? previous.activeIndex;
          return { query, activeIndex, ...decorationSet(transaction.doc, query, activeIndex) };
        },
      },
      props: { decorations: state => key.getState(state)?.decorations ?? DecorationSet.empty },
    })];
  },
});

export function setNoteFind(editor: Editor, query: string, activeIndex = 0): FindMatch[] {
  editor.view.dispatch(editor.state.tr.setMeta(key, { query, activeIndex } satisfies FindMeta));
  return key.getState(editor.state)?.matches ?? [];
}

export function selectNoteFindMatch(editor: Editor, match: FindMatch): void {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, match.from, match.to)).scrollIntoView());
}

export function activeNoteFindMatch(editor: Editor): FindMatch | undefined {
  const state = key.getState(editor.state);
  if (!state?.matches.length) return undefined;
  return state.matches[((state.activeIndex % state.matches.length) + state.matches.length) % state.matches.length];
}
