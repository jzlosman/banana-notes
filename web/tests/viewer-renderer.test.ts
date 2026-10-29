import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/viewer.html' });
for (const key of ['window', 'document', 'navigator', 'Node', 'HTMLElement', 'Element', 'MutationObserver', 'DOMParser', 'getComputedStyle', 'KeyboardEvent', 'MouseEvent'] as const) {
  if (key in dom.window) Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true, writable: true });
}
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(0), 0) as any;
globalThis.cancelAnimationFrame = id => clearTimeout(id);
const { renderReadOnlyMarkdown } = await import('../src/viewer/ui/markdown-renderer');
const nativeBase = 'banana-viewer-resource://document/';
function mount(markdown: string, base = nativeBase) {
  const host = document.createElement('article'); document.body.append(host);
  const opened: string[] = [];
  const renderer = renderReadOnlyMarkdown(host, markdown, base, href => opened.push(href));
  return { host, root: renderer.root, renderer, opened };
}

test('reader renders a read-only Markdown document with code, tables and disabled task checks', () => {
  const { root, renderer } = mount('# Reading\n\n```ts\nconst answer: number = 42;\n```\n\n| Name | Value |\n|---|---|\n| One | Two |\n\n- [x] Already done\n- [ ] Still open\n\n<script>unsafe()</script>');
  assert.equal(root.getAttribute('contenteditable'), 'false');
  assert.equal(root.querySelector('[contenteditable="true"]'), null);
  assert.ok(root.querySelector('pre code .hljs-keyword'));
  assert.ok(root.querySelector('table th'));
  const checks = [...root.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
  assert.equal(checks.length, 2); assert.equal(checks[0].checked, true); assert.equal(checks[1].checked, false);
  assert.ok(checks.every(input => input.disabled));
  assert.equal(root.querySelector('script'), null);
  assert.match(root.textContent ?? '', /<script>unsafe\(\)<\/script>/);
  for (const type of ['beforeinput', 'paste', 'cut', 'drop']) {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    root.dispatchEvent(event); assert.equal(event.defaultPrevented, true, `${type} cannot mutate the renderer`);
  }
  renderer.destroy();
});

test('duplicate-safe heading slugs and encoded fragments scroll in-document without bridge navigation', () => {
  const { root, opened, renderer } = mount('# A small place to begin\n\n[Back](#a-small-place-to-begin)\n\n## Repeated title\n\n## Repeated title\n\n[Second](#repeated-title-2)\n\n## Café & tea\n\n[Encoded](#caf%C3%A9-tea)\n\n[External](https://example.test/readme)\n\n[Relative](../guide.md)');
  const headings = [...root.querySelectorAll<HTMLHeadingElement>('h1, h2')];
  assert.deepEqual(headings.map(heading => heading.id), ['a-small-place-to-begin', 'repeated-title', 'repeated-title-2', 'café-tea']);
  const target = headings[0]; let scrolls = 0;
  target.scrollIntoView = () => { scrolls++; };
  root.querySelector<HTMLAnchorElement>('a[href="#a-small-place-to-begin"]')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(scrolls, 1); assert.equal(document.activeElement, target); assert.deepEqual(opened, []);
  const second = headings[2]; let secondScrolls = 0; second.scrollIntoView = () => { secondScrolls++; };
  root.querySelector<HTMLAnchorElement>('a[href="#repeated-title-2"]')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(secondScrolls, 1); assert.equal(document.activeElement, second);
  root.querySelector<HTMLAnchorElement>('a[href="#caf%C3%A9-tea"]')!.click();
  assert.equal(document.activeElement, headings[3]);
  root.querySelector<HTMLAnchorElement>('a[href="https://example.test/readme"]')!.click();
  root.querySelector<HTMLAnchorElement>('a[href="../guide.md"]')!.click();
  assert.deepEqual(opened, ['https://example.test/readme', '../guide.md']);
  renderer.destroy();
});

test('safe relative images resolve for native and browser bases while unsupported sources remain visible', () => {
  const markdown = [
    '![Nested](./images/charts/monthly.png)',
    '![Spaced](images/my%20notes/example%20image.png)',
    '![Literal spaces](<images/a folder/photo.png>)',
    '![Network](https://example.test/private.png)',
    '![Empty]()',
    '![Escape](../../outside.png)',
    '![Active](javascript:alert(1))',
    '![Data](data:image/png;base64,AAAA)',
    '![Vector](images/chart.svg)',
  ].join('\n\n');
  const native = mount(markdown);
  const nativeImages = [...native.root.querySelectorAll<HTMLImageElement>('img')];
  assert.deepEqual(nativeImages.map(image => image.getAttribute('src')), [
    'banana-viewer-resource://document/images/charts/monthly.png',
    'banana-viewer-resource://document/images/my%20notes/example%20image.png',
    'banana-viewer-resource://document/images/a%20folder/photo.png',
  ]);
  const raw = [...native.root.querySelectorAll('.raw-markdown-block')].map(block => block.textContent ?? '');
  assert.equal(raw.length, 6);
  assert.ok(raw.some(source => source.includes('![Empty]()')));
  assert.ok(raw.some(source => source.includes('![Network](https://example.test/private.png)')));
  assert.ok(raw.some(source => source.includes('![Vector](images/chart.svg)')));
  assert.equal(native.root.querySelector('img[src^="https:"]'), null);
  native.renderer.destroy();

  const browser = mount('![Browser](./images/example.png)', 'https://local.test/app/');
  assert.equal(browser.root.querySelector('img')?.getAttribute('src'), 'https://local.test/app/images/example.png');
  browser.renderer.destroy();
});
