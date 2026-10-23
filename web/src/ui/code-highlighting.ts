import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { createElement, Check, Search } from 'lucide';
import { common, createLowlight } from 'lowlight';
import { themes, themeByID } from '../domain/themes.js';
import { syntaxColorsForTheme } from '../domain/theme-accessibility.js';
import { plainInput } from './plain-input';

export const syntaxThemeIDs = ['app', ...themes.map(({ id }) => id)] as const;
export type SyntaxThemeID = typeof syntaxThemeIDs[number];
export const codeLanguages = ['Plain text', 'JavaScript', 'TypeScript', 'JSON', 'Python', 'HTML', 'CSS', 'Bash', 'Markdown', 'YAML', 'XML', 'SQL', 'Rust', 'Go', 'Java', 'C', 'C++', 'C#', 'Swift', 'Ruby', 'PHP'] as const;
const languageByLabel: Record<string, string | null> = {
  'Plain text': null, JavaScript: 'js', TypeScript: 'ts', JSON: 'json', Python: 'python', HTML: 'html', CSS: 'css', Bash: 'bash', Markdown: 'markdown', YAML: 'yaml', XML: 'xml', SQL: 'sql', Rust: 'rust', Go: 'go', Java: 'java', C: 'c', 'C++': 'cpp', 'C#': 'csharp', Swift: 'swift', Ruby: 'ruby', PHP: 'php',
};
const languageByID = Object.fromEntries(Object.entries(languageByLabel).map(([label, id]) => [id, label]));
const lowlight = createLowlight(common);
export function createHighlightedCodeBlock() {
  return CodeBlockLowlight.configure({ lowlight, defaultLanguage: null });
}

function colors(id: SyntaxThemeID, appID: string, systemDark = false) {
  const theme = id === 'app' ? themeByID(appID) : themeByID(id);
  return syntaxColorsForTheme(theme, systemDark);
}

export function applyCodeAppearance(root: HTMLElement, syntaxID: SyntaxThemeID | string, appThemeID: string, systemDark = false): void {
  const selected = syntaxThemeIDs.includes(syntaxID as SyntaxThemeID) ? syntaxID as SyntaxThemeID : 'app';
  const c = colors(selected, appThemeID, systemDark);
  for (const [name, value] of Object.entries({ bg: c.bg, fg: c.fg, ...c.tokens })) {
    root.style.setProperty(`--code-${name}`, value);
    root.style.setProperty(`--syntax-${name}`, value);
  }
  root.dataset.syntaxTheme = selected;
}

export function renderCodeLanguageSelector({ language, onSelect }: { language: string | null; onSelect: (language: string | null) => void }): HTMLElement {
  const wrapper = document.createElement('label'); wrapper.className = 'code-language-selector'; wrapper.title = 'Code language';
  const select = document.createElement('select'); select.setAttribute('aria-label', 'Code language');
  for (const label of codeLanguages) {
    const option = document.createElement('option'); option.value = languageByLabel[label] ?? ''; option.textContent = label; option.selected = option.value === (language ?? ''); select.append(option);
  }
  select.addEventListener('change', () => onSelect(select.value || null)); wrapper.append(select); return wrapper;
}

const previewSource = 'const note = "Hello";\n// Example\nsave(note, 42);';

function previewTokens(id: SyntaxThemeID, appThemeID: string): HTMLElement {
  const preview = document.createElement('pre'); preview.className = 'code-theme-preview';
  const code = document.createElement('code'); const c = colors(id, appThemeID, document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  preview.style.setProperty('--code-preview-bg', c.bg); preview.style.setProperty('--code-preview-fg', c.fg);
  const colorByClass: Record<string, string> = { 'hljs-keyword': c.tokens.keyword, 'hljs-literal': c.tokens.keyword, 'hljs-type': c.tokens.type, 'hljs-built_in': c.tokens.type, 'hljs-string': c.tokens.string, 'hljs-comment': c.tokens.comment, 'hljs-number': c.tokens.number, 'hljs-title': c.tokens.function, 'hljs-function': c.tokens.function };
  const append = (parent: HTMLElement, node: any) => {
    if (node.type === 'text') { parent.append(document.createTextNode(node.value ?? '')); return; }
    if (node.type !== 'element') { for (const child of node.children ?? []) append(parent, child); return; }
    const span = document.createElement(node.tagName); const classes = node.properties?.className;
    if (Array.isArray(classes)) { span.className = classes.join(' '); const color = classes.map((name: string) => colorByClass[name]).find(Boolean); if (color) span.style.color = color; }
    for (const child of node.children ?? []) append(span, child); parent.append(span);
  };
  for (const child of lowlight.highlight('ts', previewSource).children) append(code, child);
  preview.append(code); return preview;
}

export function renderCodeSettings({ selectedID, appThemeID, onSelect }: { selectedID: SyntaxThemeID; appThemeID: string; onSelect: (id: SyntaxThemeID) => void | Promise<void> }): HTMLElement {
  const root = document.createElement('section'); root.className = 'code-settings';
  const intro = document.createElement('p'); intro.className = 'code-settings-intro'; intro.textContent = 'Code colors are set separately from the app theme.';
  const searchField = document.createElement('label'); searchField.className = 'search-field code-theme-search'; searchField.append(createElement([Search[0], { ...Search[1], width: 17, height: 17, 'stroke-width': 1.7, 'aria-hidden': 'true' }, Search[2]]));
  const search = plainInput(document.createElement('input')); search.type = 'search'; search.placeholder = 'Search code themes…'; search.setAttribute('aria-label', 'Search code themes'); searchField.append(search);
  const filters = document.createElement('div'); filters.className = 'code-theme-filters'; filters.setAttribute('role', 'group'); filters.setAttribute('aria-label', 'Filter code themes');
  let filter = 'all', currentID = selectedID, saving = false;
  const buttons: HTMLButtonElement[] = [];
  const options = [{ id: 'app' as SyntaxThemeID, name: 'Match app', appearance: themeByID(appThemeID)?.appearance ?? (document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'), themeID: appThemeID }, ...themes.map(({ id, name, appearance }) => ({ id: id as SyntaxThemeID, name, appearance, themeID: id }))];
  const grid = document.createElement('div'); grid.className = 'code-theme-grid'; grid.setAttribute('role', 'radiogroup'); grid.setAttribute('aria-label', 'Code syntax theme');
  const refresh = () => {
    const query = search.value.trim().toLowerCase();
    buttons.forEach((button, index) => { const option = options[index]; const selected = option.id === currentID; button.hidden = !option.name.toLowerCase().includes(query) || (filter !== 'all' && option.appearance !== filter); button.classList.toggle('selected', selected); button.setAttribute('aria-checked', String(selected)); button.tabIndex = -1; button.disabled = saving; });
    const visible = buttons.filter(button => !button.hidden); const target = visible.find(button => button.getAttribute('aria-checked') === 'true') ?? visible[0]; if (target) target.tabIndex = 0;
    empty.hidden = visible.length > 0;
  };
  const empty = document.createElement('p'); empty.className = 'themes-empty'; empty.textContent = 'No matching themes. Try another name or choose All.';
  for (const label of ['All', 'Light', 'Dark']) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'code-theme-filter'; button.textContent = label; button.setAttribute('aria-pressed', String(label === 'All'));
    button.addEventListener('click', () => { filter = label.toLowerCase(); filters.querySelectorAll('button').forEach((item) => item.setAttribute('aria-pressed', String(item.textContent?.toLowerCase() === filter))); refresh(); }); filters.append(button);
  }
  options.forEach((option) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'code-theme-option'; button.setAttribute('role', 'radio'); button.dataset.themeId = option.id; button.dataset.themeName = option.name.toLowerCase(); button.dataset.appearance = option.appearance;
    button.append(previewTokens(option.id === 'app' && !themeByID(appThemeID) ? 'app' : option.themeID as SyntaxThemeID, appThemeID));
    const info = document.createElement('span'); info.className = 'code-theme-info'; const words = document.createElement('span'); words.className = 'code-theme-words';
    const name = document.createElement('span'); name.className = 'code-theme-name'; name.textContent = option.name;
    const kind = document.createElement('span'); kind.className = 'code-theme-kind'; kind.textContent = option.id === 'app' ? `Match app · ${option.appearance}` : option.appearance;
    words.append(name, kind); const check = document.createElement('span'); check.className = 'code-theme-check'; check.setAttribute('aria-hidden', 'true'); check.append(createElement([Check[0], { ...Check[1], width: 16, height: 16, 'stroke-width': 1.7 }, Check[2]])); info.append(words, check); button.append(info);
    button.addEventListener('click', async () => { if (saving || option.id === currentID) return; saving = true; refresh(); try { await onSelect(option.id); currentID = option.id; } catch { /* The persistence adapter reports the error; retain the last confirmed choice. */ } finally { saving = false; refresh(); if (grid.isConnected) button.focus(); } });
    button.addEventListener('keydown', (event) => { const visible = buttons.filter((item) => !item.hidden); const index = visible.indexOf(button); let next = -1; if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % visible.length; if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + visible.length) % visible.length; if (event.key === 'Home') next = 0; if (event.key === 'End') next = visible.length - 1; if (next >= 0) { event.preventDefault(); visible[next].focus(); visible[next].click(); } });
    buttons.push(button); grid.append(button);
  });
  grid.append(empty); search.addEventListener('input', refresh); refresh(); root.append(intro, searchField, filters, grid); return root;
}

export const codeExportCSS = `pre code.hljs{background:var(--code-bg);color:var(--code-fg)} .hljs-keyword,.hljs-selector-tag,.hljs-literal{color:var(--code-keyword)} .hljs-string,.hljs-attr{color:var(--code-string)} .hljs-comment{color:var(--code-comment);font-style:italic} .hljs-number,.hljs-boolean{color:var(--code-number)} .hljs-type,.hljs-built_in{color:var(--code-type)} .hljs-title,.hljs-title.function_,.hljs-function{color:var(--code-function)}`;

/** Highlight code HTML with locally bundled grammars. Unknown languages stay intact and unhighlighted. */
function hastNode(node: any): Node {
  if (node.type === 'text') return document.createTextNode(node.value ?? '');
  if (node.type === 'element') {
    const element = document.createElement(node.tagName);
    const classes = node.properties?.className;
    if (Array.isArray(classes)) element.className = classes.join(' ');
    element.append(...(node.children ?? []).map(hastNode));
    return element;
  }
  const fragment = document.createDocumentFragment();
  fragment.append(...(node.children ?? []).map(hastNode));
  return fragment;
}

export function highlightCodeHTML(html: string, syntaxID: SyntaxThemeID = 'app', appThemeID = 'system', systemDark = false): string {
  const template = document.createElement('template'); template.innerHTML = html;
  for (const code of template.content.querySelectorAll('pre code')) {
    const languageClass = [...code.classList].find((name) => name.startsWith('language-'));
    const language = languageClass?.slice(9);
    if (language && lowlight.registered(language)) {
      const result = lowlight.highlight(language, code.textContent ?? '');
      code.replaceChildren(...result.children.map((child: any) => hastNode(child)));
      code.classList.add('hljs');
    }
  }
  const c = colors(syntaxID, appThemeID, systemDark);
  for (const pre of template.content.querySelectorAll<HTMLElement>('pre')) { pre.style.backgroundColor = c.bg; pre.style.color = c.fg; }
  for (const [selector, color] of [
    ['.hljs-keyword,.hljs-selector-tag,.hljs-literal', c.tokens.keyword], ['.hljs-string,.hljs-attr', c.tokens.string],
    ['.hljs-comment', c.tokens.comment], ['.hljs-number,.hljs-boolean', c.tokens.number], ['.hljs-type,.hljs-built_in', c.tokens.type],
    ['.hljs-title,.hljs-function', c.tokens.function],
  ]) for (const token of template.content.querySelectorAll<HTMLElement>(selector)) token.style.color = color;
  const holder = document.createElement('div'); holder.append(template.content);
  return holder.innerHTML;
}
