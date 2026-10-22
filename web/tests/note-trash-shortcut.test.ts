import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { handleNoteTrashShortcut } from '../src/ui/note-trash-shortcut';

function harness(run: (dom: JSDOM, calls: string[], press: (selector: string, options?: KeyboardEventInit) => KeyboardEvent) => void) {
  const dom = new JSDOM(`<!doctype html><body>
    <main class="note-side">
      <div class="markdown-editor" contenteditable="true"><p>Keep these bytes</p></div>
      <textarea class="source-editor"># Keep these bytes</textarea>
      <input aria-label="Tag"><button class="note-action">Note action</button>
    </main>
    <input aria-label="Search"><select><option>Setting</option></select>
    <div role="dialog"><input aria-label="Link"><button>Save</button></div>
    <div role="menu"><button>Move to Trash</button></div>
  </body>`);
  const calls: string[] = [];
  dom.window.document.addEventListener('keydown', event => {
    handleNoteTrashShortcut(event, 'open-note', id => calls.push(id));
  }, true);
  const press = (selector: string, options: KeyboardEventInit = {}) => {
    const event = new dom.window.KeyboardEvent('keydown', { key: 'Backspace', metaKey: true, bubbles: true, cancelable: true, ...options });
    dom.window.document.querySelector(selector)!.dispatchEvent(event);
    return event;
  };
  try { run(dom, calls, press); } finally { dom.window.close(); }
}

test('Cmd+Backspace trashes the open note from rich text, raw source, or note controls without editing content', () => harness((dom, calls, press) => {
  const before = dom.window.document.body.innerHTML;
  for (const selector of ['.markdown-editor p', '.source-editor', '.note-action']) {
    const event = press(selector);
    assert.equal(event.defaultPrevented, true);
    assert.equal(calls.at(-1), 'open-note');
  }
  assert.equal(calls.length, 3);
  assert.equal(dom.window.document.body.innerHTML, before);
}));

test('plain Backspace, other modifiers, composition, and forward Delete retain normal editing', () => harness((_dom, calls, press) => {
  for (const options of [
    { metaKey: false }, { ctrlKey: true }, { altKey: true }, { shiftKey: true },
    { isComposing: true }, { key: 'Delete' },
  ]) assert.equal(press('.markdown-editor p', options).defaultPrevented, false);
  assert.deepEqual(calls, []);
}));

test('search, tag, link fields, settings, and popovers never trash the open note', () => harness((_dom, calls, press) => {
  for (const selector of ['input[aria-label="Search"]', 'input[aria-label="Tag"]', 'select', '[role="dialog"] input', '[role="dialog"] button', '[role="menu"] button']) {
    assert.equal(press(selector).defaultPrevented, false, selector);
  }
  assert.deepEqual(calls, []);
}));

test('key repeat is consumed without trashing neighbors or reaching editor deletion handlers', () => harness((dom, calls, press) => {
  let editorEvents = 0;
  dom.window.document.querySelector('.markdown-editor')!.addEventListener('keydown', () => editorEvents++);
  press('.markdown-editor p');
  assert.equal(press('.markdown-editor p', { repeat: true }).defaultPrevented, true);
  assert.deepEqual(calls, ['open-note']);
  assert.equal(editorEvents, 0);
}));

test('no selected note or an already-handled event cannot invoke Trash', () => {
  const dom = new JSDOM();
  const calls: string[] = [];
  const event = new dom.window.KeyboardEvent('keydown', { key: 'Backspace', metaKey: true, cancelable: true });
  assert.equal(handleNoteTrashShortcut(event, null, id => calls.push(id)), false);
  event.preventDefault();
  assert.equal(handleNoteTrashShortcut(event, 'open-note', id => calls.push(id)), false);
  assert.deepEqual(calls, []);
  dom.window.close();
});
