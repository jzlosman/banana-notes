import type { ThemeDefinition } from './themes';

export type RGB = readonly [number, number, number];

export function parseHexColor(color: string): RGB {
  const match = /^#([\da-f]{6})$/i.exec(color);
  if (!match) throw new Error(`Invalid theme color: ${color}`);
  const value = match[1];
  return [0, 2, 4].map(index => Number.parseInt(value.slice(index, index + 2), 16)) as unknown as RGB;
}

export function relativeLuminance(color: string): number {
  const linear = parseHexColor(color).map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function contrastRatio(first: string, second: string): number {
  const a = relativeLuminance(first), b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function mixHex(color: string, target: string, amount: number): string {
  const first = parseHexColor(color), second = parseHexColor(target);
  return `#${first.map((channel, index) => Math.round(channel + (second[index] - channel) * amount).toString(16).padStart(2, '0')).join('')}`;
}

/** Keep the source hue where possible; change only the minimum lightness needed for legibility. */
export function ensureContrast(color: string, backgrounds: readonly string[], minimum: number): string {
  if (backgrounds.every(background => contrastRatio(color, background) >= minimum)) return color;
  const candidates = ['#000000', '#ffffff'].flatMap(endpoint => {
    if (!backgrounds.every(background => contrastRatio(endpoint, background) >= minimum)) return [];
    let low = 0, high = 1;
    for (let step = 0; step < 24; step++) {
      const middle = (low + high) / 2;
      if (backgrounds.every(background => contrastRatio(mixHex(color, endpoint, middle), background) >= minimum)) high = middle;
      else low = middle;
    }
    return [{ color: mixHex(color, endpoint, high), amount: high }];
  });
  if (!candidates.length) throw new Error('No focus or syntax color can meet the requested contrast against this palette.');
  return candidates.sort((a, b) => a.amount - b.amount)[0].color;
}

function rgbToHsl([red, green, blue]: RGB): [number, number, number] {
  const r = red / 255, g = green / 255, b = blue / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const lightness = (max + min) / 2;
  if (!delta) return [0, 0, lightness];
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue = ((hue * 60) % 360 + 360) % 360;
  return [hue, saturation, lightness];
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = hue / 60;
  const x = chroma * (1 - Math.abs(sector % 2 - 1));
  const [r, g, b] = sector < 1 ? [chroma, x, 0] : sector < 2 ? [x, chroma, 0] : sector < 3 ? [0, chroma, x]
    : sector < 4 ? [0, x, chroma] : sector < 5 ? [x, 0, chroma] : [chroma, 0, x];
  const match = lightness - chroma / 2;
  return `#${[r, g, b].map(channel => Math.round((channel + match) * 255).toString(16).padStart(2, '0')).join('')}`;
}

const tokenHueOffsets = { keyword: 0, string: 58, comment: 138, number: 194, type: 246, function: 306 } as const;
export type SyntaxTokenColors = Record<keyof typeof tokenHueOffsets, string>;

/** Palette-derived and contrast-corrected syntax colors for one explicit or app-matched theme. */
export function syntaxColorsForTheme(theme: ThemeDefinition | undefined, systemDark = false): { bg: string; fg: string; tokens: SyntaxTokenColors } {
  const dark = theme ? theme.appearance === 'dark' : systemDark;
  const bg = theme?.colors.paper ?? (dark ? '#252a34' : '#f4f5f7');
  const fg = theme?.colors.ink ?? (dark ? '#e7eaf0' : '#202633');
  const accent = theme?.colors.accent ?? (dark ? '#9bbcff' : '#315fbd');
  const [baseHue, sourceSaturation] = rgbToHsl(parseHexColor(accent));
  const saturation = Math.min(0.86, Math.max(0.54, sourceSaturation));
  const initialLightness = dark ? 0.69 : 0.43;
  const backgrounds = [bg];
  const tokens = Object.fromEntries(Object.entries(tokenHueOffsets).map(([name, offset]) => {
    const candidate = hslToHex((baseHue + offset) % 360, saturation, initialLightness);
    return [name, ensureContrast(candidate, backgrounds, 4.5)];
  })) as SyntaxTokenColors;
  return { bg, fg, tokens };
}

export function accessibleFocusRing(theme: ThemeDefinition): string {
  return ensureContrast(theme.colors.ring, [theme.colors.paper, theme.colors.chrome, theme.colors.hover, theme.colors.accentSoft], 3);
}
