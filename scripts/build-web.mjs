import { build } from 'esbuild';
import { cp, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const catalog = JSON.parse(await readFile('web/src/domain/note-font-catalog.json', 'utf8'));

async function buildBundledFonts() {
  const output = 'web/dist/fonts';
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const fonts = [];
  for (const definition of catalog) {
    const { id, name, kind, family, weights } = definition;
    const faces = [];
    if (kind === 'bundled') {
      const packageDirectory = path.resolve('node_modules', ...definition.packageName.split('/'));
      const unicode = JSON.parse(await readFile(path.join(packageDirectory, 'unicode.json'), 'utf8'));
      for (const cssFile of definition.cssFiles) {
        const css = await readFile(path.join(packageDirectory, cssFile), 'utf8');
        const blocks = [...css.matchAll(/@font-face\s*\{([^{}]*)\}/gi)];
        if (!blocks.length) throw new Error(`No @font-face declarations in ${definition.packageName}/${cssFile}`);
        for (const match of blocks) {
          const block = match[1];
          const descriptor = name => {
            const found = block.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'i'));
            return found?.[1]?.trim();
          };
          const style = descriptor('font-style') ?? 'normal';
          const weight = descriptor('font-weight');
          const source = block.match(/url\(\s*["']?([^)'"\s]+\.woff2)["']?\s*\)/i)?.[1];
          const filename = source && path.basename(source);
          const subset = filename?.match(/-(latin-ext|latin)-/)?.[1];
          if (style.toLowerCase() !== 'normal' || !weight || !/^(?:[1-9]00|[1-9]00\s+[1-9]00)$/.test(weight) || !source || !subset || !['latin', 'latin-ext'].includes(subset)) continue;
          const sourcePath = path.resolve(path.dirname(path.join(packageDirectory, cssFile)), source);
          if (!sourcePath.startsWith(`${packageDirectory}${path.sep}`)) throw new Error(`Font source escapes ${definition.packageName}`);
          const unicodeRange = descriptor('unicode-range') ?? unicode[subset];
          if (typeof unicodeRange !== 'string' || !/^(?:U\+[0-9A-F?]{1,6}(?:-[0-9A-F]{1,6})?)(?:,\s*U\+[0-9A-F?]{1,6}(?:-[0-9A-F]{1,6})?)*$/i.test(unicodeRange)) {
            throw new Error(`Invalid unicode range for ${definition.packageName}/${filename}`);
          }
          await copyFile(sourcePath, path.join(output, filename));
          faces.push({ file: filename, weight, unicodeRange });
        }
      }
      const subsets = new Set(faces.map(face => face.file.match(/-(latin-ext|latin)-/)?.[1]));
      if (!subsets.has('latin') || !subsets.has('latin-ext')) throw new Error(`Missing latin subsets for ${definition.packageName}`);
      if (faces.some(face => !/-(?:latin|latin-ext)-/.test(face.file))) throw new Error(`Unexpected subset in ${definition.packageName}`);
    }
    fonts.push({ id, name, kind, family, weights, faces });
  }
  const manifest = { fonts };
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(path.join(output, 'manifest.js'), `globalThis.__BANANA_NOTE_FONT_MANIFEST__ = ${JSON.stringify(manifest)};\n`);
  return fonts;
}

await mkdir('web/dist', { recursive: true });
const minify = (process.env.BANANA_NOTES_DEBUG ?? process.env.FOLDNOTE_DEBUG) !== '1';
const notesBuild = await build({
  entryPoints: ['web/src/main.ts'], bundle: true, format: 'iife', target: ['safari17'],
  outfile: 'web/dist/app.js', sourcemap: true, minify, legalComments: 'none', metafile: true,
});
const viewerBuild = await build({
  entryPoints: ['web/src/viewer/main.ts'], bundle: true, format: 'iife', target: ['safari17'],
  outfile: 'web/dist/viewer.js', sourcemap: true, minify, legalComments: 'none', metafile: true,
});
await copyFile('web/index.html', 'web/dist/index.html');
await copyFile('web/viewer.html', 'web/dist/viewer.html');
await copyFile('web/src/theme-catalog.json', 'web/dist/theme-catalog.json');
await buildBundledFonts();

// Generate notices from the actual dependency graph, not a hand-maintained subset.
const notices = 'web/dist/third-party';
await rm(notices, { recursive: true, force: true });
await mkdir(notices, { recursive: true });
for (const [source, name] of [
  ['LICENSE', 'Banana-Notes-LICENSE.txt'],
  ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'],
  ['vendor/agent-paint/LICENSE', 'agent-paint-LICENSE.txt'],
  ['vendor/agent-paint/THIRD_PARTY_NOTICES.md', 'agent-paint-NOTICES.md'],
]) await copyFile(source, path.join(notices, name));
await cp('vendor/agent-paint/licenses', path.join(notices, 'palette-licenses'), { recursive: true });

const packages = new Map();
for (const input of [...Object.keys(notesBuild.metafile.inputs), ...Object.keys(viewerBuild.metafile.inputs)]) {
  if (!input.startsWith('node_modules/')) continue;
  let directory = path.dirname(path.resolve(input));
  while (directory !== path.dirname(directory)) {
    let pkg;
    try { pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (pkg?.name && pkg.version) { packages.set(directory, pkg); break; }
    directory = path.dirname(directory);
  }
}
const inventory = [];
for (const [directory, pkg] of [...packages].sort((a, b) => a[1].name.localeCompare(b[1].name, 'en'))) {
  const files = (await readdir(directory)).filter(name => /^(?:licen[cs]e|copying|notice|third[_-]party[_-](?:licen[cs]es|notices))(?:[._-].*)?$/i.test(name)).sort();
  if (!files.length) throw new Error(`Missing license notice for bundled dependency ${pkg.name}`);
  const destination = path.join('dependencies', `${pkg.name}@${pkg.version}`);
  await mkdir(path.join(notices, destination), { recursive: true });
  for (const file of files) await copyFile(path.join(directory, file), path.join(notices, destination, file));
  inventory.push({ name: pkg.name, version: pkg.version, license: pkg.license, files: files.map(file => path.posix.join(destination, file)) });
}
for (const definition of catalog.filter(font => font.kind === 'bundled')) {
  const directory = path.resolve('node_modules', ...definition.packageName.split('/'));
  const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  if (pkg.name !== definition.packageName || !pkg.version || pkg.license !== 'OFL-1.1') {
    throw new Error(`Pinned font package metadata is invalid for ${definition.packageName}`);
  }
  const licenseName = `font-licenses/${pkg.name.replace('/', '-')}-${pkg.version}-OFL-1.1.txt`;
  await mkdir(path.dirname(path.join(notices, licenseName)), { recursive: true });
  await copyFile(path.join(directory, 'LICENSE'), path.join(notices, licenseName));
  inventory.push({ name: pkg.name, version: pkg.version, license: pkg.license, files: [licenseName] });
}
inventory.sort((a, b) => a.name.localeCompare(b.name, 'en'));
await writeFile(path.join(notices, 'dependencies.json'), JSON.stringify(inventory, null, 2) + '\n');
console.log(`Bundled fonts and notices for ${inventory.length} dependencies.`);
