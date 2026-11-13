import { test } from 'node:test';
import { registerHooks } from 'node:module';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { TagCatalogEntry } from '../src/tasks/domain/queries';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('/tasks/ui/tag-picker.css')) return { format: 'module', source: 'export {};', shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { mountTaskTagPicker } = await import('../src/tasks/ui/tag-picker');

function entry(label: string, taskCount: number, lastTaskActivityAt: number): TagCatalogEntry {
  return { key: label.toLowerCase(), label, taskCount, lastTaskActivityAt };
}

function fixture(catalog: TagCatalogEntry[] = []) {
  const dom = new JSDOM('<!doctype html><html><body><main id="host"></main></body></html>', { pretendToBeVisual: true });
  const previousDocument = globalThis.document;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  const messages: string[] = [];
  const changes: string[] = [];
  const picker = mountTaskTagPicker(dom.window.document, {
    catalog,
    onChange: () => changes.push('change'),
    onDuplicate: message => messages.push(message),
    onInvalid: message => messages.push(message),
    onLeave: () => undefined,
  });
  dom.window.document.querySelector('#host')!.append(picker.element);
  return { dom, picker, messages, changes, close: () => {
    picker.dispose(); dom.window.close();
    Object.defineProperty(globalThis, 'document', { configurable: true, value: previousDocument });
  } };
}

function inputText(dom: JSDOM, input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}
function key(dom: JSDOM, input: HTMLInputElement, value: string): KeyboardEvent {
  const event = new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true });
  input.dispatchEvent(event);
  return event;
}
function options(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[role="option"]')];
}

test('empty query separates popularity from recent activity and keeps task counts', () => {
  const catalog = [
    entry('A', 10, 10), entry('B', 9, 20), entry('C', 8, 30), entry('D', 7, 40), entry('E', 6, 50),
    entry('F', 5, 60), entry('G', 4, 100), entry('H', 3, 90), entry('I', 2, 80),
  ];
  const { dom, picker, close } = fixture(catalog);
  try {
    picker.setTags(['A']);
    picker.input.click();
    const listbox = dom.window.document.getElementById(picker.input.getAttribute('aria-controls')!)!;
    const groups = [...listbox.querySelectorAll<HTMLElement>('[role="group"]')];
    assert.deepEqual(groups.map(group => group.querySelector('h3')?.textContent), ['Most used', 'From recent tasks']);
    assert.deepEqual(options(groups[0]).map(option => option.querySelector('.tasks-tag-picker-option-label')?.textContent), ['B', 'C', 'D', 'E', 'F']);
    assert.deepEqual(options(groups[1]).map(option => option.querySelector('.tasks-tag-picker-option-label')?.textContent), ['G', 'H', 'I']);
    assert.equal(options(groups[0])[0].textContent, 'B9 tasks');
    assert.equal(picker.input.getAttribute('aria-expanded'), 'true');
    assert.equal(picker.input.hasAttribute('aria-activedescendant'), false, 'empty recommendations begin without an active option');
  } finally { close(); }
});

test('typed matching ranks exact, prefix, word-prefix, substring and caps suggestions before Create', () => {
  const catalog = [
    entry('Debugging', 1, 1), entry('Platform Bug', 2, 2), entry('Bug fixes', 3, 3), entry('Bug', 4, 4),
    entry('Bug bounty', 5, 5), entry('Bug report', 6, 6), entry('Bug triage', 7, 7), entry('Bug backlog', 8, 8),
  ];
  const { dom, picker, close } = fixture(catalog);
  try {
    inputText(dom, picker.input, 'bug');
    const suggestions = options(dom.window.document.body);
    assert.deepEqual(suggestions.map(option => option.querySelector('.tasks-tag-picker-option-label')?.textContent), [
      'Bug', 'Bug fixes', 'Bug bounty', 'Bug report', 'Bug triage', 'Bug backlog',
    ]);
    assert.equal(suggestions.filter(option => option.textContent?.startsWith('Create')).length, 0, 'exact match suppresses creation');
    assert.equal(picker.input.getAttribute('aria-activedescendant'), suggestions[0].id);
  } finally { close(); }
});

test('typed search shows six matches followed by Create when there is no exact catalog hit', () => {
  const catalog = [
    entry('Bug fixes', 1, 1), entry('Bug', 2, 2), entry('Bug bounty', 3, 3), entry('Bug report', 4, 4),
    entry('Bug triage', 5, 5), entry('Bug backlog', 6, 6), entry('Platform Bug', 7, 7), entry('Debugging', 8, 8),
  ];
  const { dom, picker, close } = fixture(catalog);
  try {
    inputText(dom, picker.input, 'b');
    const rows = options(dom.window.document.body);
    assert.deepEqual(rows.map(option => option.querySelector('.tasks-tag-picker-option-label')?.textContent), [
      'Bug fixes', 'Bug', 'Bug bounty', 'Bug report', 'Bug triage', 'Bug backlog', 'Create “b”',
    ]);
    assert.equal(rows.length, 7, 'the six-result cap does not hide the separate Create action');
  } finally { close(); }
});

test('a catalog label named Create does not collide with the Create action identity', () => {
  const { dom, picker, close } = fixture([entry('Create', 2, 2)]);
  try {
    inputText(dom, picker.input, 'cr');
    const rows = options(dom.window.document.body);
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0].id, rows[1].id);
    assert.equal(rows[0].getAttribute('aria-selected'), 'true');
    assert.equal(rows[1].getAttribute('aria-selected'), 'false');
    key(dom, picker.input, 'Enter');
    assert.deepEqual(picker.selectedTags(), ['Create']);
  } finally { close(); }
});

test('selection uses canonical labels, literal typed tags, and text-only DOM rendering', () => {
  const { dom, picker, close } = fixture([entry('<img src=x onerror=run()>', 3, 1)]);
  try {
    picker.input.click();
    const suggestion = options(dom.window.document.body)[0];
    suggestion.click();
    assert.deepEqual(picker.selectedTags(), ['<img src=x onerror=run()>']);
    assert.equal(dom.window.document.querySelector('.tasks-tag-chip img'), null, 'catalog labels are never interpreted as markup');
    assert.equal(picker.input.value, '');

    inputText(dom, picker.input, '  Ship, then review  ');
    key(dom, picker.input, ',');
    assert.deepEqual(picker.selectedTags(), ['<img src=x onerror=run()>', 'Ship, then review']);
    assert.equal(picker.input.value, '');
  } finally { close(); }
});

test('case-insensitive typed selection reuses the catalog canonical label', () => {
  const { dom, picker, close } = fixture([entry('Canonical Label', 1, 1)]);
  try {
    inputText(dom, picker.input, 'cANONICAL lABEL');
    key(dom, picker.input, 'Enter');
    assert.deepEqual(picker.selectedTags(), ['Canonical Label']);
    assert.equal(picker.input.value, '');
  } finally { close(); }
});

test('case-insensitive duplicate creation keeps the canonical selected label and announces it', () => {
  const { dom, picker, messages, close } = fixture([entry('Canonical label', 2, 2)]);
  try {
    picker.setTags(['Canonical label']);
    inputText(dom, picker.input, 'cANONICAL LABEL');
    assert.equal(dom.window.document.getElementById(picker.input.getAttribute('aria-controls')!)?.hidden, true,
      'an exact selected catalog label does not offer a duplicate Create action');
    key(dom, picker.input, 'Enter');
    assert.deepEqual(picker.selectedTags(), ['Canonical label']);
    assert.match(messages.at(-1) ?? '', /^Canonical label is already added\.$/);
    assert.equal(picker.input.value, '');
  } finally { close(); }
});

test('composition keys do not select suggestions or remove chips, and empty comma is a separator only', () => {
  const { dom, picker, close } = fixture([entry('Writing', 1, 1)]);
  try {
    inputText(dom, picker.input, 'wri');
    const composingEnter = new dom.window.KeyboardEvent('keydown', {
      key: 'Enter', isComposing: true, bubbles: true, cancelable: true,
    });
    picker.input.dispatchEvent(composingEnter);
    assert.equal(composingEnter.defaultPrevented, false);
    assert.deepEqual(picker.selectedTags(), []);
    assert.equal(picker.input.value, 'wri');
    key(dom, picker.input, 'Enter');
    assert.deepEqual(picker.selectedTags(), ['Writing']);
    const composingBackspace = new dom.window.KeyboardEvent('keydown', {
      key: 'Backspace', isComposing: true, bubbles: true, cancelable: true,
    });
    picker.input.dispatchEvent(composingBackspace);
    assert.equal(composingBackspace.defaultPrevented, false);
    assert.deepEqual(picker.selectedTags(), ['Writing']);
    assert.equal(key(dom, picker.input, ',').defaultPrevented, true);
    assert.equal(picker.input.value, '');
  } finally { close(); }
});

test('keyboard navigation does not wrap; Escape closes, clears, then bubbles', () => {
  const { dom, picker, close } = fixture([entry('Alpha', 2, 2), entry('Beta', 1, 1)]);
  let bubbled = 0;
  dom.window.document.addEventListener('keydown', () => bubbled++);
  try {
    picker.input.click();
    const rows = options(dom.window.document.body);
    assert.equal(picker.input.hasAttribute('aria-activedescendant'), false);
    key(dom, picker.input, 'ArrowDown');
    assert.equal(picker.input.getAttribute('aria-activedescendant'), rows[0].id);
    key(dom, picker.input, 'ArrowDown');
    assert.equal(picker.input.getAttribute('aria-activedescendant'), rows[1].id);
    key(dom, picker.input, 'ArrowDown');
    assert.equal(picker.input.getAttribute('aria-activedescendant'), rows[1].id, 'last option does not wrap');
    const beforeClose = bubbled;
    const closeEvent = key(dom, picker.input, 'Escape');
    assert.equal(closeEvent.defaultPrevented, true);
    assert.equal(bubbled, beforeClose, 'first Escape is contained while the listbox is open');
    assert.equal(picker.input.getAttribute('aria-expanded'), 'false');

    inputText(dom, picker.input, 'new label');
    const closeQueryPopupEvent = key(dom, picker.input, 'Escape');
    assert.equal(closeQueryPopupEvent.defaultPrevented, true);
    assert.equal(picker.input.value, 'new label', 'closing the popup leaves the typed query intact');
    const clearQueryEvent = key(dom, picker.input, 'Escape');
    assert.equal(clearQueryEvent.defaultPrevented, true);
    assert.equal(picker.input.value, '');
    const beforeBubble = bubbled;
    key(dom, picker.input, 'Escape');
    assert.equal(bubbled, beforeBubble + 1, 'Escape bubbles only after the popup and query are cleared');
  } finally { close(); }
});

test('Backspace removes the final chip and ArrowLeft at the input start reaches its remove button', () => {
  const { dom, picker, close } = fixture();
  try {
    picker.setTags(['first', 'last']);
    picker.input.focus();
    picker.input.setSelectionRange(0, 0);
    key(dom, picker.input, 'ArrowLeft');
    const removeButtons = dom.window.document.querySelectorAll<HTMLButtonElement>('.tasks-tag-remove');
    assert.equal(dom.window.document.activeElement, removeButtons.item(1));
    picker.input.focus();
    key(dom, picker.input, 'Backspace');
    assert.deepEqual(picker.selectedTags(), ['first']);
    assert.equal(dom.window.document.activeElement, picker.input);
  } finally { close(); }
});

test('creation validates the 48-character boundary and the 32-tag limit', () => {
  const { dom, picker, messages, close } = fixture();
  try {
    inputText(dom, picker.input, 'x'.repeat(49));
    let create = options(dom.window.document.body).find(option => option.textContent?.startsWith('Create'))!;
    assert.equal(create.getAttribute('aria-disabled'), 'true');
    assert.match(create.textContent ?? '', /Tags can be up to 48 characters\./);
    key(dom, picker.input, 'Enter');
    assert.deepEqual(picker.selectedTags(), []);
    assert.equal(picker.input.value.length, 49);

    inputText(dom, picker.input, 'x'.repeat(48));
    create = options(dom.window.document.body).find(option => option.textContent?.startsWith('Create'))!;
    assert.equal(create.getAttribute('aria-disabled'), null);
    create.click();
    assert.equal(picker.selectedTags()[0].length, 48);

    picker.setTags(Array.from({ length: 32 }, (_, index) => `tag-${index}`));
    assert.equal(picker.input.disabled, false, 'the full editor stays keyboard reachable');
    assert.equal(picker.input.readOnly, true);
    assert.equal(picker.input.placeholder, '32 tag limit reached');
    picker.input.focus();
    key(dom, picker.input, 'Backspace');
    assert.equal(picker.selectedTags().length, 31);
    assert.equal(picker.input.readOnly, false);
    assert.equal(dom.window.document.activeElement, picker.input);
    assert.equal(messages.length, 1, 'the overlong query is announced without losing its text');
    assert.match(messages[0], /48 characters/);
  } finally { close(); }
});

test('invalid controls are rejected without clearing the pending query', () => {
  const { dom, picker, messages, close } = fixture();
  try {
    inputText(dom, picker.input, 'not\u0001valid');
    const create = options(dom.window.document.body).find(option => option.textContent?.startsWith('Create'))!;
    assert.equal(create.getAttribute('aria-disabled'), 'true');
    assert.match(create.textContent ?? '', /control characters/);
    key(dom, picker.input, 'Enter');
    assert.equal(picker.input.value, 'not\u0001valid');
    assert.match(messages.at(-1) ?? '', /control characters/);
  } finally { close(); }
});

test('keyboard navigation keeps the active option inside the scrolling popup', () => {
  const { dom, picker, close } = fixture(Array.from({ length: 9 }, (_, index) => entry(`Tag ${index}`, 9 - index, index)));
  try {
    picker.input.click();
    const popup = dom.window.document.getElementById(picker.input.getAttribute('aria-controls')!)!;
    Object.defineProperty(popup, 'clientHeight', { configurable: true, value: 100 });
    popup.getBoundingClientRect = () => ({ top: 100, bottom: 200 } as DOMRect);
    const original = dom.window.HTMLElement.prototype.getBoundingClientRect;
    dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
      if (!this.classList.contains('tasks-tag-picker-option')) return original.call(this);
      const index = Number(this.id.split('-').at(-1));
      const top = 100 + index * 30 - popup.scrollTop;
      return { top, bottom: top + 30 } as DOMRect;
    };
    for (let index = 0; index < 8; index++) key(dom, picker.input, 'ArrowDown');
    const active = dom.window.document.getElementById(picker.input.getAttribute('aria-activedescendant')!)!;
    assert.ok(popup.scrollTop > 0);
    assert.ok(active.getBoundingClientRect().top >= 100);
    assert.ok(active.getBoundingClientRect().bottom <= 200);
    for (let index = 0; index < 7; index++) key(dom, picker.input, 'ArrowUp');
    assert.equal(popup.scrollTop, 0);
  } finally { close(); }
});

test('portal positioning flips above and clamps to the narrow viewport', () => {
  const { dom, picker, close } = fixture([entry('Alpha', 1, 1)]);
  try {
    Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 320 });
    Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: 240 });
    const field = picker.element.querySelector<HTMLElement>('.tasks-detail-tags')!;
    field.getBoundingClientRect = () => ({
      x: 270, y: 110, left: 270, top: 110, right: 450, bottom: 140, width: 180, height: 30,
      toJSON: () => ({}),
    });
    picker.input.click();
    const listbox = dom.window.document.getElementById(picker.input.getAttribute('aria-controls')!)!;
    assert.equal(listbox.parentElement, dom.window.document.body, 'portal escapes the detail scroll container');
    assert.equal(listbox.dataset.placement, 'above');
    assert.equal(listbox.style.width, '180px');
    assert.equal(listbox.style.left, '132px');
    assert.equal(listbox.style.bottom, '134px');
    assert.equal(listbox.style.maxHeight, '98px', 'the popup height is constrained to the actual space above the field');
    assert.equal(Number.parseFloat(listbox.style.left) + Number.parseFloat(listbox.style.width), 312, 'popup stays inside the 8px viewport inset');
  } finally { close(); }
});

test('empty catalog stays closed until typing makes creation available', () => {
  const { dom, picker, close } = fixture();
  try {
    picker.input.click();
    const listbox = dom.window.document.getElementById(picker.input.getAttribute('aria-controls')!)!;
    assert.equal(listbox.hidden, true);
    inputText(dom, picker.input, 'first tag');
    assert.equal(listbox.hidden, false);
    assert.equal(options(listbox)[0].textContent, 'Create “first tag”');
  } finally { close(); }
});
