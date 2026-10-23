import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = resolve(projectRoot, 'node_modules/gsap');
const packageInfo = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
const vendorDirectory = resolve(projectRoot, 'site/vendor');
const licenseNotice = `/*! GSAP ${packageInfo.version} — ${packageInfo.license}; https://gsap.com/standard-license */\n`;

await mkdir(vendorDirectory, { recursive: true });
for (const filename of ['gsap.min.js', 'ScrollTrigger.min.js']) {
  const source = resolve(packageRoot, 'dist', filename);
  const destination = resolve(vendorDirectory, filename);
  const content = await readFile(source, 'utf8');
  await writeFile(destination, `${licenseNotice}${content}`);
}

console.log(`Copied GSAP ${packageInfo.version} and ScrollTrigger into site/vendor/.`);
