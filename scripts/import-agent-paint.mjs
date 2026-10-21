#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const sourceRoot = process.argv[2];
const sourcePath = sourceRoot ? resolve(sourceRoot, 'site/themes.json') : resolve('vendor/agent-paint/themes.json');
const outputPath = resolve('web/src/theme-catalog.json');
const hex = (value) => /^#[\da-f]{6}$/i.test(value);
const rgb = (value) => value.match(/[\da-f]{2}/gi).map((channel) => parseInt(channel, 16) / 255);
const linear = (value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const luminance = (value) => rgb(value).map(linear).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
const contrast = (a, b) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};
const mix = (a, b, amount) => `#${rgb(a).map((channel, i) => Math.round((channel * (1 - amount) + rgb(b)[i] * amount) * 255).toString(16).padStart(2, '0')).join('')}`;

// Preserve palette identity while making the smallest RGB mix toward black or white
// that meets the required contrast against every listed surface.
function ensureContrast(color, surfaces, minimum) {
  if (surfaces.every((surface) => contrast(color, surface) >= minimum)) return color.toLowerCase();
  const candidates = ['#000000', '#ffffff'].filter((end) => surfaces.every((surface) => contrast(end, surface) >= minimum));
  if (!candidates.length) throw new Error(`No color can meet ${minimum}:1 against ${surfaces.join(', ')}`);
  const options = candidates.map((end) => {
    let low = 0; let high = 1;
    for (let i = 0; i < 28; i++) {
      const mid = (low + high) / 2;
      if (surfaces.every((surface) => contrast(mix(color, end, mid), surface) >= minimum)) high = mid;
      else low = mid;
    }
    return { value: mix(color, end, high), distance: high };
  });
  return options.sort((a, b) => a.distance - b.distance)[0].value;
}

const upstream = JSON.parse(await readFile(sourcePath, 'utf8'));
if (!Array.isArray(upstream) || upstream.length !== 30) throw new Error(`Expected exactly 30 upstream themes, got ${upstream?.length}`);
const catalog = upstream.map((theme) => {
  const p = theme.paseo;
  const paper = p.background.toLowerCase();
  const chrome = p.raised.toLowerCase();
  const hover = p.control.toLowerCase();
  const ink = ensureContrast(p.foreground, [paper, chrome, hover], 4.5);
  function readableTintedForeground(source) {
    let foreground = ensureContrast(source, [paper, chrome], 4.5);
    let soft = mix(paper, foreground, 0.10);
    for (let i = 0; i < 12 && contrast(foreground, soft) < 4.5; i++) {
      foreground = ensureContrast(foreground, [paper, chrome, soft], 4.5);
      soft = mix(paper, foreground, 0.10);
    }
    if (contrast(foreground, soft) < 4.5) throw new Error(`${theme.id}: tinted foreground cannot meet 4.5:1`);
    return { foreground, soft };
  }
  const { foreground: accent, soft: accentSoft } = readableTintedForeground(p.accent);
  const muted = ensureContrast(p.mutedForeground, [paper, chrome, hover, accentSoft], 4.5);
  const dangerSource = theme.superset?.destructive;
  if (!hex(dangerSource)) throw new Error(`${theme.id}: missing superset.destructive`);
  const { foreground: danger, soft: dangerSoft } = readableTintedForeground(dangerSource);
  // Invert the readable ink/paper pair: selection must stand out from the page, too.
  const selection = ink;
  const selectionText = paper;
  const ring = ensureContrast(p.ring, [paper, chrome], 3);
  const onAccent = contrast('#000000', accent) >= contrast('#ffffff', accent) ? '#000000' : '#ffffff';
  const colors = { paper, chrome, ink, muted, line: p.border.toLowerCase(), hover, accent, accentSoft, onAccent, ring, danger, dangerSoft, selection, selectionText };
  for (const [key, value] of Object.entries(colors)) if (!hex(value)) throw new Error(`${theme.id}.${key} is not a six-digit hex color: ${value}`);
  return { id: theme.id, name: theme.name, appearance: theme.appearance, colors };
});
await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Wrote ${catalog.length} themes to ${outputPath} from ${sourcePath}`);
