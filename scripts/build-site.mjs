import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appPackage = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8'));
const packageRoot = resolve(projectRoot, 'node_modules/gsap');
const gsapPackage = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
const siteDirectory = resolve(projectRoot, 'site');
const vendorDirectory = resolve(siteDirectory, 'vendor');
const licenseNotice = `/*! GSAP ${gsapPackage.version} — ${gsapPackage.license}; https://gsap.com/standard-license */\n`;

await mkdir(vendorDirectory, { recursive: true });
for (const filename of ['gsap.min.js', 'ScrollTrigger.min.js']) {
  const source = resolve(packageRoot, 'dist', filename);
  const destination = resolve(vendorDirectory, filename);
  const content = await readFile(source, 'utf8');
  await writeFile(destination, `${licenseNotice}${content}`);
}

const versionPlaceholder = '__BANANA_VERSION__';
const template = await readFile(resolve(siteDirectory, 'index.template.html'), 'utf8');
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(appPackage.version)
    || template.split(versionPlaceholder).length !== 2) {
  throw new Error('Expected a valid package.json version and one site version placeholder.');
}
await writeFile(resolve(siteDirectory, 'index.html'), template.replace(versionPlaceholder, appPackage.version));
console.log(`Copied GSAP ${gsapPackage.version} and generated the Banana Notes ${appPackage.version} site.`);
