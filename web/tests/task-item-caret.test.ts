import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
for (const key of ['window', 'document', 'navigator', 'Node', 'HTMLElement', 'Element', 'MutationObserver', 'DOMParser', 'getComputedStyle', 'KeyboardEvent', 'MouseEvent', 'ClipboardEvent'] as const) {
  if (key in dom.window) Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true, writable: true });
}
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(0), 0) as any;
globalThis.cancelAnimationFrame = id => clearTimeout(id);

const [{ createMarkdownEditor }, { handleTaskItemCaretKeyDown, taskItemCaretRightTarget, taskItemCaretStart }] = await Promise.all([
  import('../src/ui/editor'), import('../src/ui/editor/task-item-caret'),
]);

function mount(markdown: string) {
  const host = document.createElement('div'); document.body.append(host);
  return createMarkdownEditor(host, markdown, () => {});
}
function taskStart(editor: ReturnType<typeof mount>, text: string): number {
  let position: number | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'taskItem' && node.firstChild?.type.name === 'paragraph' && node.firstChild.textContent === text) position = pos + 2;
  });
  assert.notEqual(position, undefined, `task paragraph not found: ${text}`);
  return position!;
}
function eventFor(editor: ReturnType<typeof mount>, key: string, modifiers: KeyboardEventInit = {}): KeyboardEvent {
  return new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
}
function dispatch(editor: ReturnType<typeof mount>, key: string, modifiers: KeyboardEventInit = {}): KeyboardEvent {
  const event = eventFor(editor, key, modifiers);
  editor.view.dom.dispatchEvent(event);
  return event;
}
function handle(editor: ReturnType<typeof mount>, key: string, modifiers: KeyboardEventInit = {}): { event: KeyboardEvent; handled: boolean } {
  const event = eventFor(editor, key, modifiers);
  return { event, handled: handleTaskItemCaretKeyDown(editor.view, event) };
}

test('ArrowRight advances from a task-item start by one complete grapheme', () => {
  const editor = mount('- [ ] 👩🏽‍💻 task\n- [x] Checked');
  try {
    const start = taskStart(editor, '👩🏽‍💻 task');
    editor.commands.setTextSelection(start);
    assert.equal(taskItemCaretRightTarget(editor.state), start + '👩🏽‍💻'.length);
    const { event, handled } = handle(editor, 'ArrowRight');
    assert.equal(handled, true);
    assert.equal(event.defaultPrevented, true);
    assert.equal(editor.state.selection.from, start + '👩🏽‍💻'.length);
    assert.equal(editor.state.selection.$from.parentOffset, '👩🏽‍💻'.length);
  } finally { editor.destroy(); }
});

test('only an empty task-paragraph selection at offset zero qualifies for arrow repair', () => {
  const editor = mount('Before\n\n- [ ] Task');
  try {
    const start = taskStart(editor, 'Task');
    editor.commands.setTextSelection(start);
    assert.equal(taskItemCaretStart(editor.state)?.from, start);
    assert.equal(handle(editor, 'ArrowLeft').handled, false);
    assert.equal(handle(editor, 'ArrowRight', { shiftKey: true }).handled, false);
    assert.equal(handle(editor, 'ArrowDown', { shiftKey: true }).handled, false);
    assert.equal(handle(editor, 'ArrowRight', { altKey: true }).handled, false);
    assert.equal(handle(editor, 'ArrowRight', { ctrlKey: true }).handled, false);
    assert.equal(handle(editor, 'ArrowRight', { metaKey: true }).handled, false);
    assert.equal(handle(editor, 'Home').handled, false, 'Home is native when already at the start');

    editor.commands.setTextSelection(start + 1);
    assert.equal(taskItemCaretStart(editor.state), null);
    assert.equal(taskItemCaretRightTarget(editor.state), null);
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      assert.equal(handle(editor, key).handled, false, `${key} stays native away from offset zero`);
    }

    editor.commands.setTextSelection({ from: start, to: start + 1 });
    assert.equal(taskItemCaretStart(editor.state), null, 'non-empty selections stay native');
    assert.equal(handle(editor, 'ArrowRight').handled, false);

    editor.commands.setTextSelection(1);
    assert.equal(taskItemCaretStart(editor.state), null, 'ordinary paragraphs stay native');
    assert.equal(handle(editor, 'ArrowRight').handled, false);
  } finally { editor.destroy(); }
});

test('Home and Command-Left reset a task caret only when it is not already at the start', () => {
  const editor = mount('- [ ] First task\n- [x] Checked task');
  try {
    const first = taskStart(editor, 'First task');
    editor.commands.setTextSelection(first + 'First task'.length);
    assert.equal(handle(editor, 'Home').handled, true);
    assert.equal(editor.state.selection.from, first);

    const checked = taskStart(editor, 'Checked task');
    editor.commands.setTextSelection(checked + 'Checked task'.length);
    assert.equal(handle(editor, 'ArrowLeft', { metaKey: true }).handled, true);
    assert.equal(editor.state.selection.from, checked);
    assert.equal(handle(editor, 'ArrowLeft', { metaKey: true }).handled, false, 'Command-Left stays native at offset zero');
  } finally { editor.destroy(); }
});

test('Backspace at a task-item start retains its existing lift/join behavior', () => {
  const editor = mount('Before\n\n- [ ] Task');
  try {
    const start = taskStart(editor, 'Task');
    editor.commands.setTextSelection(start);
    const markdownBeforeBackspace = editor.getMarkdown();
    dispatch(editor, 'Backspace');
    assert.notEqual(editor.getMarkdown(), markdownBeforeBackspace);
    assert.equal(editor.getMarkdown(), 'Before\n\nTask');
  } finally { editor.destroy(); }
});

test('clicking a task checkbox still toggles its checked state', () => {
  const editor = mount('- [ ] Toggle');
  try {
    const checkbox = editor.view.dom.querySelector<HTMLInputElement>('li[data-checked="false"] input[type="checkbox"]')!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.match(editor.getMarkdown(), /- \[x\] Toggle/);
  } finally { editor.destroy(); }
});
