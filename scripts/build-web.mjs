import { build } from 'esbuild';
import { cp, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

await mkdir('web/dist', { recursive: true });
const result = await build({
  entryPoints: ['web/src/main.ts'], bundle: true, format: 'iife', target: ['safari17'],
  outfile: 'web/dist/app.js', sourcemap: true, minify: !process.env.FOLDNOTE_DEBUG,
  legalComments: 'none', metafile: true,
});
await copyFile('web/index.html', 'web/dist/index.html');
await copyFile('web/src/theme-catalog.json', 'web/dist/theme-catalog.json');

// Generate notices from the actual dependency graph, not a hand-maintained subset.
const notices = 'web/dist/third-party';
await rm(notices, { recursive: true, force: true });
await mkdir(notices, { recursive: true });
for (const [source, name] of [
  ['LICENSE', 'Foldnote-LICENSE.txt'],
  ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'],
  ['vendor/agent-paint/LICENSE', 'agent-paint-LICENSE.txt'],
  ['vendor/agent-paint/THIRD_PARTY_NOTICES.md', 'agent-paint-NOTICES.md'],
]) await copyFile(source, path.join(notices, name));
await cp('vendor/agent-paint/licenses', path.join(notices, 'palette-licenses'), { recursive: true });

const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
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
await writeFile(path.join(notices, 'dependencies.json'), JSON.stringify(inventory, null, 2) + '\n');
console.log(`Bundled notices for ${inventory.length} dependencies.`);
