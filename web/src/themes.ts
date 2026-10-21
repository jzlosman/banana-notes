import catalog from './theme-catalog.json' with { type: 'json' };

export type ThemeDefinition = {
  id: string;
  name: string;
  appearance: 'light' | 'dark';
  colors: {
    paper: string;
    chrome: string;
    ink: string;
    muted: string;
    line: string;
    hover: string;
    accent: string;
    accentSoft: string;
    onAccent: string;
    ring: string;
    danger: string;
    dangerSoft: string;
    selection: string;
    selectionText: string;
  };
};

export const themes: readonly ThemeDefinition[] = catalog as ThemeDefinition[];
export const SYSTEM_THEME = 'system';
const knownThemeIDs = new Set(themes.map(({ id }) => id));

export function resolveThemeID(value: unknown): string {
  return typeof value === 'string' && knownThemeIDs.has(value) ? value : SYSTEM_THEME;
}

export function themeByID(id: string): ThemeDefinition | undefined {
  return id === SYSTEM_THEME ? undefined : themes.find((theme) => theme.id === id);
}
