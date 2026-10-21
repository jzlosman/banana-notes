import { resolveThemeID, themeByID, type ThemeDefinition } from './themes';

const variables: Record<keyof ThemeDefinition['colors'], string> = {
  paper: '--paper', chrome: '--chrome', ink: '--ink', muted: '--muted',
  line: '--line', hover: '--hover', accent: '--accent', accentSoft: '--accent-soft',
  onAccent: '--on-accent', ring: '--ring', danger: '--danger', dangerSoft: '--danger-soft',
  selection: '--selection', selectionText: '--selection-text',
};

/** DOM adapter only. Theme preference persistence never touches the note library. */
export function applyAppearance(root: HTMLElement, selection: unknown): string {
  const id = resolveThemeID(selection);
  const theme = themeByID(id);
  for (const [role, variable] of Object.entries(variables)) {
    if (theme) root.style.setProperty(variable, theme.colors[role as keyof ThemeDefinition['colors']]);
    else root.style.removeProperty(variable);
  }
  if (theme) root.style.colorScheme = theme.appearance;
  else root.style.removeProperty('color-scheme');
  root.dataset.theme = id;
  return id;
}
