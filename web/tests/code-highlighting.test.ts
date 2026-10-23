import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
for (const key of ['window', 'document', 'navigator', 'Node', 'HTMLElement', 'Element', 'MutationObserver', 'DOMParser', 'getComputedStyle', 'KeyboardEvent', 'MouseEvent'] as const) if (key in dom.window) Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true, writable: true });
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(0), 0) as any;
globalThis.cancelAnimationFrame = id => clearTimeout(id);
const { createHighlightedCodeBlock, applyCodeAppearance, highlightCodeHTML, renderCodeLanguageSelector, syntaxThemeIDs, renderCodeSettings } = await import('../src/ui/code-highlighting');
const { Editor } = await import('@tiptap/core');
const StarterKit = (await import('@tiptap/starter-kit')).default;
const { Markdown } = await import('@tiptap/markdown');
function editorFor(md: string) { const el = document.createElement('div'); document.body.append(el); return new Editor({ element: el, extensions: [StarterKit.configure({ codeBlock: false }), createHighlightedCodeBlock(), Markdown], content: md, contentType: 'markdown' }); }
test('bundled highlighter produces real token spans for TypeScript, JSON and Python', () => {
  for (const [lang, code] of [['ts', 'const answer: number = 42;'], ['json', '{"ok": true}'], ['python', 'def answer():\n  return 42']] as const) {
    const html = highlightCodeHTML(`<pre><code class="language-${lang}">${code.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</code></pre>`);
    assert.match(html, /<span class="hljs-/); assert.match(html, /style="[^\"]*color:/); assert.doesNotMatch(html, /var\(--code-/);
  }
});
test('theme changes affect only appearance; all bundled palettes are independent of app selection', () => {
  assert.equal(syntaxThemeIDs.length, 33);
  const editor = editorFor('```ts\nconst x = 1\n```'); const before = editor.getMarkdown();
  const root = document.createElement('div'); applyCodeAppearance(root, 'one-dark', 'github-light');
  assert.equal(root.dataset.syntaxTheme, 'one-dark'); assert.notEqual(root.style.getPropertyValue('--code-bg'), '');
  const picker = renderCodeSettings({ selectedID: 'one-dark', appThemeID: 'one-dark', onSelect: () => {} });
  assert.equal(picker.querySelectorAll('[role=radio]').length, 33);
  assert.equal(picker.querySelector('[role=radio][aria-checked=true]')?.getAttribute('aria-checked'), 'true');
  assert.equal(editor.getMarkdown(), before); editor.destroy();
});
test('code theme picker previews real colored syntax, filters themes and supports radio keyboard selection', () => {
  let selected = '';
  const picker = renderCodeSettings({ selectedID: 'app', appThemeID: 'one-dark', onSelect: id => { selected = id; } });
  const match = picker.querySelector<HTMLButtonElement>('[role=radio]')!;
  assert.match(match.textContent ?? '', /const note/);
  assert.match(match.textContent ?? '', /Example/);
  assert.ok([...match.querySelectorAll<HTMLElement>('span[style*="color"]')].some(token => token.style.color));
  assert.ok(match.querySelector('.code-theme-preview')?.getAttribute('style')?.includes('#'));
  const search = picker.querySelector<HTMLInputElement>('[type=search]')!;
  search.value = 'one dark'; search.dispatchEvent(new dom.window.Event('input'));
  assert.equal(picker.querySelectorAll('[role=radio]:not([hidden])').length, 1);
  assert.equal(picker.querySelector('[role=radio]:not([hidden])')?.getAttribute('tabindex'), '0', 'filtered grid remains keyboard reachable');
  search.value = ''; search.dispatchEvent(new dom.window.Event('input'));
  const radios = [...picker.querySelectorAll<HTMLButtonElement>('[role=radio]')];
  radios[0].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  assert.equal(selected, radios[1].dataset.themeId);
  const dark = picker.querySelector<HTMLButtonElement>('.code-theme-filter:nth-child(3)')!;
  dark.click();
  assert.ok([...picker.querySelectorAll<HTMLButtonElement>('[role=radio]:not([hidden])')].every(option => option.dataset.appearance === 'dark'));
});
test('unknown languages remain safe and language selector supplies a serialization hook', () => {
  const html = highlightCodeHTML('<pre><code class="language-not-real">&lt;unsafe&gt;</code></pre>');
  assert.ok(html.includes('&lt;unsafe&gt;')); assert.doesNotMatch(html, /<span class="hljs-/);
  let selected: string | null | undefined;
  const selector = renderCodeLanguageSelector({ language: 'ts', onSelect: value => selected = value });
  const select = selector.querySelector('select')!; assert.equal(select.value, 'ts'); select.value = 'python'; select.dispatchEvent(new dom.window.Event('change'));
  assert.equal(selected, 'python');
});


test('code choice keeps its search context and commits only a confirmed preference', async () => {
  let resolve!: () => void;
  const pending = new Promise<void>(done => { resolve = done; });
  const picker = renderCodeSettings({ selectedID: 'app', appThemeID: 'system', onSelect: () => pending });
  document.body.append(picker);
  const search = picker.querySelector<HTMLInputElement>('[type=search]')!; search.value = 'nord'; search.dispatchEvent(new dom.window.Event('input'));
  const target = picker.querySelector<HTMLButtonElement>('[data-theme-id="nord"]')!;
  target.click(); assert.equal(target.disabled, true); assert.equal(target.getAttribute('aria-checked'), 'false');
  resolve(); await new Promise(done => setTimeout(done, 0));
  assert.equal(target.getAttribute('aria-checked'), 'true'); assert.equal(search.value, 'nord'); assert.equal(document.activeElement, target);
  search.value = 'no such palette'; search.dispatchEvent(new dom.window.Event('input'));
  assert.equal(picker.querySelector<HTMLElement>('.themes-empty')!.hidden, false); picker.remove();
  const rejected = renderCodeSettings({ selectedID: 'app', appThemeID: 'system', onSelect: async () => { throw new Error('not saved'); } });
  rejected.querySelector<HTMLButtonElement>('[data-theme-id="nord"]')!.click(); await new Promise(done => setTimeout(done, 0));
  assert.equal(rejected.querySelector('[aria-checked=true]')?.getAttribute('data-theme-id'), 'app');
});
