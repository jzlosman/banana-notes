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

test('domain is deterministic and imports no outward application, adapter, UI, or browser APIs', () => {
  const failures: string[] = [];
  for (const file of sourceFiles(join(sourceRoot, 'domain'))) {
    const source = readFileSync(file, 'utf8');
    for (const specifier of importsOf(source)) {
      const target = resolvedImport(file, specifier);
      if (target && /\/(application|adapters|ui)\//.test(target)) failures.push(`${file}: imports ${specifier}`);
    }
    if (/\b(?:window|document|localStorage|navigator|HTMLElement|FileReader|crypto|performance)\b|Date\.now\s*\(|from\s+['"](?:lucide|@tiptap\/)/.test(source)) {
      failures.push(`${file}: references a browser/UI effect`);
    }
  }
  assert.deepEqual(failures, []);
});

test('application depends only on its own contracts and the domain', () => {
  const failures: string[] = [];
  for (const file of sourceFiles(join(sourceRoot, 'application'))) {
    for (const specifier of importsOf(readFileSync(file, 'utf8'))) {
      const target = resolvedImport(file, specifier);
      if (target && !target.includes('/application/') && !target.includes('/domain/')) failures.push(`${file}: imports ${specifier}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('UI never imports adapters; only the composition root wires adapter implementations', () => {
  const files = sourceFiles(sourceRoot);
  const failures: string[] = [];
  for (const file of files) {
    for (const specifier of importsOf(readFileSync(file, 'utf8'))) {
      const target = resolvedImport(file, specifier);
      if (!target?.includes('/adapters/')) continue;
      if (file !== join(sourceRoot, 'main.ts')) failures.push(`${file}: imports ${specifier}`);
    }
  }
  assert.deepEqual(failures, []);
});
