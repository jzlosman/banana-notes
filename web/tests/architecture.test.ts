import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : [];
  });
}
function styleFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? styleFiles(path) : entry.name.endsWith('.css') ? [path] : [];
  });
}
function importsOf(source: string): string[] {
  return [...source.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g)].map(match => match[1]);
}
function resolvedImport(sourceFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = resolve(dirname(sourceFile), specifier);
  return [base, `${base}.ts`, join(base, 'index.ts')].find(candidate => {
    try { return readFileSync(candidate, 'utf8') !== undefined; } catch { return false; }
  });
}

// Code only: comments and the contents of string/template literals are not effects.
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1')
    .replace(/`(?:\\[\s\S]|\$\{[^}]*\}|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, match => match[0] + match[0])
    // A document field in a domain read model is not the global DOM document.
    .replace(/\bdocument(?=\s*:)|(?<=\.)document\b/g, '');
}

test('purity scanning distinguishes document read-model fields and URL strings from DOM effects', () => {
  assert.doesNotMatch(codeOnly("type Snapshot = { document: string }; snapshot.document; const url = 'banana-viewer-resource://document/';"), /\bdocument\b/);
  assert.match(codeOnly("document.createElement('p');"), /\bdocument\b/);
  assert.match(codeOnly('window.localStorage.getItem(key);'), /\b(?:window|localStorage)\b/);
  assert.deepEqual(importsOf("import { Search } from 'lucide';"), ['lucide']);
});

test('domain is deterministic and imports no outward application, adapter, UI, or browser APIs', () => {
  const failures: string[] = [];
  for (const file of [...sourceFiles(join(sourceRoot, 'domain')), ...sourceFiles(join(sourceRoot, 'viewer/domain'))]) {
    const source = readFileSync(file, 'utf8');
    for (const specifier of importsOf(source)) {
      const target = resolvedImport(file, specifier);
      if (target && /\/(application|adapters|ui)\//.test(target)) failures.push(`${file}: imports ${specifier}`);
    }
    if (/\b(?:window|document|localStorage|navigator|HTMLElement|FileReader|crypto|performance)\b|Date\.now\s*\(/.test(codeOnly(source)) ||
        importsOf(source).some(specifier => /^(?:lucide(?:\/|$)|@tiptap\/)/.test(specifier))) {
      failures.push(`${file}: references a browser/UI effect`);
    }
  }
  assert.deepEqual(failures, []);
});

test('application depends only on its own contracts and the domain', () => {
  const failures: string[] = [];
  for (const file of [...sourceFiles(join(sourceRoot, 'application')), ...sourceFiles(join(sourceRoot, 'viewer/application'))]) {
    for (const specifier of importsOf(readFileSync(file, 'utf8'))) {
      const target = resolvedImport(file, specifier);
      if (target && !target.includes('/application/') && !target.includes('/domain/')) failures.push(`${file}: imports ${specifier}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('UI never imports adapters; adapter internals stay inward of the UI boundary', () => {
  const files = sourceFiles(sourceRoot);
  const failures: string[] = [];
  for (const file of files) {
    for (const specifier of importsOf(readFileSync(file, 'utf8'))) {
      const target = resolvedImport(file, specifier);
      if (!target?.includes('/adapters/')) continue;
      if (file !== join(sourceRoot, 'main.ts') && file !== join(sourceRoot, 'viewer/main.ts') && !file.includes('/adapters/')) failures.push(`${file}: imports ${specifier}`);
    }
    if (file.includes('/adapters/') && importsOf(readFileSync(file, 'utf8')).some(specifier => resolvedImport(file, specifier)?.includes('/ui/'))) {
      failures.push(`${file}: adapter imports UI`);
    }
  }
  assert.deepEqual(failures, []);
});

test('Banana Viewer stays independent of Notes library and preview adapters', () => {
  const failures: string[] = [];
  const viewerRoot = join(sourceRoot, 'viewer');
  const sharedRenderingModules = new Set(['appearance.ts', 'note-font.ts', 'code-highlighting.ts', 'icon.ts', 'theme-grid.ts', 'editor-schema.ts', 'markdown-source.ts']);
  for (const file of sourceFiles(viewerRoot)) {
    for (const specifier of importsOf(readFileSync(file, 'utf8'))) {
      const target = resolvedImport(file, specifier);
      if (target && !target.includes('/viewer/') && (target.endsWith('/domain/library.ts') || target.endsWith('/application/ports.ts') ||
        target.endsWith('/adapters/preview.ts') || target.endsWith('/adapters/native-bridge.ts'))) failures.push(`${file}: imports Notes capability ${specifier}`);
      if (target?.includes('/ui/') && !target.includes('/viewer/ui/') && !sharedRenderingModules.has(target.split('/').pop() ?? '')) failures.push(`${file}: imports Notes UI module ${specifier}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('every vertical auto-scroller opts into the shared quiet-scroll treatment', () => {
  // Layout selectors stay plain (so media-query overrides keep working); the element that receives a
  // scrolling class must also receive `quiet-scroll` where the UI creates it.
  const markup = [...sourceFiles(join(sourceRoot, 'ui')), ...sourceFiles(join(sourceRoot, 'viewer/ui'))].map(file => readFileSync(file, 'utf8')).join('\n');
  const classLiterals = [...markup.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)].map(match => (match[1] ?? match[2]).split(/\s+/));
  const failures: string[] = [];
  for (const file of styleFiles(sourceRoot)) {
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/(?:^|;)\s*overflow(?:-y)?\s*:\s*(?:auto|scroll)\b/i.test(match[2])) continue;
      for (const selector of match[1].split(',')) {
        const scroller = selector.trim().match(/\.([a-z][a-z0-9-]*)(?![\s\S]*\.)/)?.[1];
        if (!scroller) { failures.push(`${file}: ${selector.trim()}`); continue; }
        if (!classLiterals.some(classes => classes.includes(scroller) && classes.includes('quiet-scroll'))) failures.push(`${file}: .${scroller}`);
      }
    }
  }
  assert.deepEqual(failures, []);
  const sharedStyles = readFileSync(join(sourceRoot, 'style.css'), 'utf8');
  assert.match(sharedStyles, /html\[data-focused='false'\]\s+\.quiet-scroll\s*\{[^}]*--scrollbar-thumb:\s*transparent/);
  assert.match(sharedStyles, /@media\s*\(prefers-contrast:\s*more\)[\s\S]*?\.quiet-scroll[\s\S]*?50%/);
  assert.match(sharedStyles, /@media\s*\(forced-colors:\s*active\)[\s\S]*?\.quiet-scroll[\s\S]*?scrollbar-color:\s*auto[\s\S]*?CanvasText/);
});

test('main is the only TypeScript module at the source root and the platform action bus is removed', () => {
  const rootModules = readdirSync(sourceRoot, { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.endsWith('.ts')).map(entry => entry.name);
  assert.deepEqual(rootModules, ['main.ts']);
  const contracts = readFileSync(join(sourceRoot, 'application/ports.ts'), 'utf8');
  assert.doesNotMatch(contracts, /PlatformAction|PlatformPort|request\s*\(/);
  const ui = sourceFiles(join(sourceRoot, 'ui')).map(file => readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(ui, /\bisNative\b|foldnoteCommand/);
});
