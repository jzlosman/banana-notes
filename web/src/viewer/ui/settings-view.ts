import { Check, Search } from 'lucide';
import { themes } from '../../domain/themes';
import type { NoteFontState } from '../../domain/note-font';
import type { ViewerDefaultAppOutcome, ViewerDefaultAppStatus, ViewerPreferences } from '../domain/model';
import { renderIcon } from '../../ui/icon';
import { installThemeGridKeyboard, updateThemeGridTabStop } from '../../ui/theme-grid';

type DefaultAppViewState = ViewerDefaultAppStatus | { kind: 'loading' } | { kind: 'error'; message: string };

export type ViewerSettingsView = {
  element: HTMLElement;
  update(preferences: ViewerPreferences): void;
  updateDefaultAppStatus(status: DefaultAppViewState): void;
  setError(message: string): void;
  clearError(): void;
  focus(): void;
  dispose(): void;
};

type SettingsOptions = {
  document: Document;
  preferences: ViewerPreferences;
  fonts: NoteFontState;
  onChange(patch: Partial<ViewerPreferences>): Promise<void>;
  onQueryDefaultAppStatus(): Promise<ViewerDefaultAppStatus>;
  onSetDefaultApp(enabled: boolean): Promise<ViewerDefaultAppOutcome>;
  onDone(): void;
};

const button = (doc: Document, label: string, className = ''): HTMLButtonElement => {
  const result = doc.createElement('button'); result.type = 'button'; result.textContent = label; if (className) result.className = className; return result;
};
const section = (doc: Document, title: string): HTMLElement => {
  const result = doc.createElement('section'); result.className = 'viewer-setting-section';
  const heading = doc.createElement('h2'); heading.textContent = title; result.append(heading); return result;
};
const labeled = (doc: Document, title: string, control: HTMLElement): HTMLLabelElement => {
  const label = doc.createElement('label'); label.className = 'viewer-setting-field';
  const name = doc.createElement('span'); name.className = 'viewer-setting-label'; name.textContent = title;
  label.append(name, control); return label;
};

export function renderViewerSettings(options: SettingsOptions): ViewerSettingsView {
  const { document: doc } = options;
  const root = doc.createElement('section'); root.className = 'viewer-settings';
  const header = doc.createElement('div'); header.className = 'viewer-settings-header';
  const heading = doc.createElement('h1'); heading.textContent = 'Settings';
  const done = button(doc, 'Done', 'viewer-done-button'); done.setAttribute('aria-label', 'Done with settings'); done.addEventListener('click', options.onDone);
  header.append(heading, done);

  const tabs = doc.createElement('div'); tabs.className = 'viewer-settings-tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Viewer settings');
  const panels = doc.createElement('div'); panels.className = 'viewer-settings-panels quiet-scroll';
  const names = ['General', 'Appearance', 'Text', 'Window'] as const;
  const tabButtons = new Map<string, HTMLButtonElement>();
  const tabPanels = new Map<string, HTMLElement>();
  let activeTab = 'General';
  const selectTab = (name: string, focus = false) => {
    activeTab = name;
    for (const [key, tab] of tabButtons) {
      const active = key === name; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      const panel = tabPanels.get(key)!; panel.hidden = !active;
    }
    if (focus) tabButtons.get(name)?.focus();
  };
  for (const name of names) {
    const tabID = name.toLowerCase().replaceAll(' ', '-');
    const tab = button(doc, name, 'viewer-settings-tab'); tab.id = `viewer-settings-tab-${tabID}`;
    tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', `viewer-settings-panel-${tabID}`);
    tab.addEventListener('click', () => selectTab(name));
    tab.addEventListener('keydown', event => {
      const index = names.indexOf(name);
      const next = event.key === 'ArrowRight' ? (index + 1) % names.length : event.key === 'ArrowLeft' ? (index + names.length - 1) % names.length : -1;
      if (next >= 0) { event.preventDefault(); selectTab(names[next], true); }
    });
    const panel = doc.createElement('div'); panel.id = `viewer-settings-panel-${tabID}`; panel.className = 'viewer-settings-panel';
    panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tab.id); panel.hidden = name !== activeTab;
    tabButtons.set(name, tab); tabPanels.set(name, panel); tabs.append(tab); panels.append(panel);
  }

  const appearancePanel = tabPanels.get('Appearance')!;
  const themeSection = section(doc, 'Theme');
  const themeSearchLabel = doc.createElement('label'); themeSearchLabel.className = 'search-field viewer-theme-search';
  themeSearchLabel.append(renderIcon(Search, 16));
  const themeSearch = doc.createElement('input'); themeSearch.type = 'search'; themeSearch.placeholder = 'Search themes…'; themeSearch.setAttribute('aria-label', 'Search themes');
  themeSearchLabel.append(themeSearch);
  const filters = doc.createElement('div'); filters.className = 'viewer-theme-filters'; filters.setAttribute('role', 'group'); filters.setAttribute('aria-label', 'Filter themes');
  let filter = 'all';
  for (const label of ['All', 'Light', 'Dark']) {
    const filterButton = button(doc, label, 'viewer-theme-filter'); filterButton.setAttribute('aria-pressed', String(label.toLowerCase() === filter));
    filterButton.addEventListener('click', () => {
      filter = label.toLowerCase();
      filters.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item.textContent?.toLowerCase() === filter)));
      refreshThemes();
    });
    filters.append(filterButton);
  }
  const themeGrid = doc.createElement('div'); themeGrid.className = 'viewer-theme-grid quiet-scroll side-scroll'; themeGrid.setAttribute('role', 'radiogroup'); themeGrid.setAttribute('aria-label', 'Available themes');
  const themeOptions: { id: string; name: string; appearance: 'light' | 'dark'; colors?: typeof themes[number]['colors'] }[] = [
    { id: 'system', name: 'Follow macOS', appearance: doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' },
    ...themes.map(theme => ({ id: theme.id, name: theme.name, appearance: theme.appearance, colors: theme.colors })),
  ];
  const themeButtons: HTMLButtonElement[] = [];
  const themeEmpty = doc.createElement('p'); themeEmpty.className = 'themes-empty'; themeEmpty.textContent = 'No matching themes. Try another name or choose All.';
  const refreshThemes = () => {
    const query = themeSearch.value.trim().normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
    themeButtons.forEach((option, index) => {
      const data = themeOptions[index];
      const visible = (!query || data.name.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().includes(query)) && (filter === 'all' || data.appearance === filter);
      option.hidden = !visible;
      const selected = data.id === currentPreferences.themeID;
      option.classList.toggle('selected', selected); option.setAttribute('aria-checked', String(selected));
    });
    const visible = themeButtons.filter(option => !option.hidden);
    themeEmpty.hidden = visible.length > 0;
    updateThemeGridTabStop(themeGrid, currentPreferences.themeID);
  };
  for (const theme of themeOptions) {
    const option = button(doc, '', 'viewer-theme-option');
    option.setAttribute('aria-label', `Use ${theme.name} theme`);
    option.setAttribute('role', 'radio'); option.dataset.themeId = theme.id; option.dataset.themeName = theme.name.toLowerCase(); option.dataset.appearance = theme.appearance;
    const preview = doc.createElement('span'); preview.className = `viewer-theme-preview${theme.colors ? '' : ' system-preview'}`;
    const title = doc.createElement('span'); title.className = 'viewer-theme-preview-title'; title.textContent = 'Heading';
    const line = doc.createElement('span'); line.className = 'viewer-theme-preview-line';
    const accent = doc.createElement('span'); accent.className = 'viewer-theme-preview-accent';
    preview.append(title, line, accent);
    if (theme.colors) {
      preview.style.setProperty('--preview-paper', theme.colors.paper);
      preview.style.setProperty('--preview-ink', theme.colors.ink);
      preview.style.setProperty('--preview-muted', theme.colors.muted);
      preview.style.setProperty('--preview-accent', theme.colors.accent);
      preview.style.setProperty('--preview-line', theme.colors.line);
    }
    const details = doc.createElement('span'); details.className = 'viewer-theme-details';
    const name = doc.createElement('span'); name.className = 'viewer-theme-name'; name.textContent = theme.name;
    const appearance = doc.createElement('span'); appearance.className = 'viewer-theme-appearance'; appearance.textContent = theme.id === 'system' ? 'Follows macOS' : theme.appearance;
    const chosen = doc.createElement('span'); chosen.className = 'viewer-theme-check'; chosen.setAttribute('aria-hidden', 'true'); chosen.append(renderIcon(Check, 14));
    const words = doc.createElement('span'); words.className = 'viewer-theme-words';
    words.append(name, appearance); details.append(words, chosen); option.append(preview, details);
    option.addEventListener('click', () => void options.onChange({ themeID: theme.id }).catch(error => view.setError(errorText(error))));
    themeButtons.push(option); themeGrid.append(option);
  }
  themeGrid.append(themeEmpty);
  themeSearch.addEventListener('input', refreshThemes);
  const themeCleanup = installThemeGridKeyboard(themeGrid);
  themeSection.append(themeSearchLabel, filters, themeGrid);

  const codeSection = section(doc, 'Code colors');
  const codeSelect = doc.createElement('select'); codeSelect.setAttribute('aria-label', 'Code colors'); codeSelect.className = 'viewer-select';
  const appOption = doc.createElement('option'); appOption.value = 'app'; appOption.textContent = 'Match app'; codeSelect.append(appOption);
  for (const theme of themes) { const option = doc.createElement('option'); option.value = theme.id; option.textContent = theme.name; codeSelect.append(option); }
  codeSelect.addEventListener('change', () => void options.onChange({ syntaxThemeID: codeSelect.value }).catch(error => view.setError(errorText(error))));
  codeSection.append(labeled(doc, 'Code colors', codeSelect));
  appearancePanel.append(themeSection, codeSection);

  const textPanel = tabPanels.get('Text')!;
  const textSection = section(doc, 'Text');
  const fontSelect = doc.createElement('select'); fontSelect.className = 'viewer-select'; fontSelect.setAttribute('aria-label', 'Font');
  const fontWeightSelect = doc.createElement('select'); fontWeightSelect.className = 'viewer-select'; fontWeightSelect.setAttribute('aria-label', 'Font weight');
  const fontSizeSelect = doc.createElement('select'); fontSizeSelect.className = 'viewer-select'; fontSizeSelect.setAttribute('aria-label', 'Font size');
  for (const font of options.fonts.fonts) { const item = doc.createElement('option'); item.value = font.id; item.textContent = font.name; fontSelect.append(item); }
  for (const size of Array.from({ length: 23 }, (_, index) => index + 10)) { const item = doc.createElement('option'); item.value = String(size); item.textContent = `${size}px`; fontSizeSelect.append(item); }
  const preview = doc.createElement('div'); preview.className = 'viewer-font-preview';
  const previewTitle = doc.createElement('strong'); previewTitle.textContent = 'A clear, comfortable page';
  const previewText = doc.createElement('p'); previewText.textContent = 'The same typeface carries through every Markdown document.';
  preview.append(previewTitle, previewText);
  const refreshFontWeights = () => {
    const font = options.fonts.fonts.find(item => item.id === fontSelect.value) ?? options.fonts.fonts[0];
    fontWeightSelect.replaceChildren();
    for (const weight of font.weights.filter(value => [400, 500, 600, 700].includes(value))) {
      const item = doc.createElement('option'); item.value = String(weight); item.textContent = ({ 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold' } as Record<number, string>)[weight] ?? String(weight); fontWeightSelect.append(item);
    }
    fontWeightSelect.disabled = fontWeightSelect.options.length < 2;
  };
  fontSelect.addEventListener('change', () => {
    const font = options.fonts.fonts.find(item => item.id === fontSelect.value) ?? options.fonts.fonts[0];
    const weight = font.weights.includes(currentPreferences.fontWeight) ? currentPreferences.fontWeight : font.weights[0];
    void options.onChange({ fontID: font.id, fontWeight: weight }).catch(error => view.setError(errorText(error)));
  });
  fontWeightSelect.addEventListener('change', () => void options.onChange({ fontWeight: Number(fontWeightSelect.value) }).catch(error => view.setError(errorText(error))));
  fontSizeSelect.addEventListener('change', () => void options.onChange({ fontSize: Number(fontSizeSelect.value) }).catch(error => view.setError(errorText(error))));
  textSection.append(labeled(doc, 'Font', fontSelect), labeled(doc, 'Weight', fontWeightSelect), labeled(doc, 'Size', fontSizeSelect), preview);
  textPanel.append(textSection);

  const windowPanel = tabPanels.get('Window')!;
  const windowSection = section(doc, 'Window appearance');
  const sliders = new Map<'focusedOpacity' | 'unfocusedOpacity' | 'glass', { input: HTMLInputElement; output: HTMLOutputElement }>();
  const addSlider = (key: 'focusedOpacity' | 'unfocusedOpacity' | 'glass', title: string) => {
    const row = doc.createElement('div'); row.className = 'viewer-range-setting';
    const labels = doc.createElement('div'); labels.className = 'viewer-range-labels';
    const name = doc.createElement('label'); name.textContent = title;
    const input = doc.createElement('input'); input.type = 'range'; input.min = key === 'glass' ? '0' : '5'; input.max = '100'; input.step = '1'; input.className = 'viewer-range';
    name.htmlFor = `viewer-${key}`; input.id = name.htmlFor;
    const output = doc.createElement('output'); output.htmlFor = input.id;
    labels.append(name, output); row.append(labels, input); windowSection.append(row); sliders.set(key, { input, output });
    input.addEventListener('input', () => { output.value = `${input.value}%`; });
    input.addEventListener('change', () => {
      const amount = Number(input.value) / 100; void options.onChange({ [key]: amount }).catch(error => view.setError(errorText(error)));
    });
  };
  addSlider('focusedOpacity', 'Focused opacity'); addSlider('unfocusedOpacity', 'Unfocused opacity'); addSlider('glass', 'Glass');
  const legibility = doc.createElement('p'); legibility.className = 'viewer-legibility-note'; legibility.textContent = 'Lower opacity and glass can reduce text legibility against changing backgrounds.';
  const reset = button(doc, 'Reset window appearance', 'viewer-reset-button');
  reset.addEventListener('click', () => void options.onChange({ focusedOpacity: 1, unfocusedOpacity: 1, glass: 0 }).catch(error => view.setError(errorText(error))));
  windowSection.append(legibility, reset); windowPanel.append(windowSection);

  const generalPanel = tabPanels.get('General')!;
  const defaultAppRow = doc.createElement('div'); defaultAppRow.className = 'viewer-default-app-row';
  const defaultAppCopy = doc.createElement('div'); defaultAppCopy.className = 'viewer-default-app-copy';
  const defaultAppLabel = doc.createElement('span'); defaultAppLabel.className = 'viewer-default-app-label';
  defaultAppLabel.id = 'viewer-default-app-label'; defaultAppLabel.textContent = 'Open Markdown files with Banana Viewer';
  const defaultAppCaption = doc.createElement('p'); defaultAppCaption.className = 'viewer-default-app-caption';
  defaultAppCaption.id = 'viewer-default-app-caption'; defaultAppCaption.setAttribute('role', 'status'); defaultAppCaption.setAttribute('aria-live', 'polite');
  defaultAppCopy.append(defaultAppLabel, defaultAppCaption);
  const defaultAppSwitch = button(doc, '', 'viewer-default-app-switch');
  defaultAppSwitch.setAttribute('role', 'switch'); defaultAppSwitch.setAttribute('aria-labelledby', defaultAppLabel.id);
  defaultAppSwitch.setAttribute('aria-describedby', defaultAppCaption.id);
  const defaultAppThumb = doc.createElement('span'); defaultAppThumb.className = 'viewer-default-app-switch-thumb'; defaultAppThumb.setAttribute('aria-hidden', 'true');
  defaultAppSwitch.append(defaultAppThumb);
  defaultAppRow.append(defaultAppCopy, defaultAppSwitch); generalPanel.append(defaultAppRow);

  const error = doc.createElement('p'); error.className = 'viewer-settings-error viewer-settings-global-error'; error.setAttribute('role', 'alert'); error.hidden = true;
  const footer = doc.createElement('p'); footer.className = 'viewer-settings-footer'; footer.textContent = 'These settings apply only to Banana Viewer. Banana Notes keeps its own preferences.';
  root.append(header, tabs, panels, error, footer);

  let currentPreferences = options.preferences;
  let currentDefaultAppStatus: DefaultAppViewState = { kind: 'loading' };
  let pendingDefaultAppValue: boolean | undefined;
  let defaultAppError: string | undefined;
  function setFontPreview(): void {
    const font = options.fonts.fonts.find(item => item.id === currentPreferences.fontID) ?? options.fonts.fonts[0];
    preview.style.fontFamily = font.kind === 'system' ? font.family : `"${font.family}", ui-monospace, Menlo, monospace`;
    preview.style.fontWeight = String(currentPreferences.fontWeight);
    preview.style.fontSize = `${currentPreferences.fontSize}px`;
  }
  function update(preferences: ViewerPreferences): void {
    currentPreferences = preferences;
    refreshThemes();
    codeSelect.value = preferences.syntaxThemeID;
    fontSelect.value = preferences.fontID; refreshFontWeights(); fontWeightSelect.value = String(preferences.fontWeight);
    fontSizeSelect.value = String(preferences.fontSize); setFontPreview();
    for (const [key, controls] of sliders) {
      const value = preferences[key] * 100;
      controls.input.value = String(Math.round(value)); controls.output.value = `${Math.round(value)}%`;
    }
    error.hidden = true;
    renderDefaultAppState();
  }
  function updateDefaultAppStatus(status: DefaultAppViewState): void {
    currentDefaultAppStatus = status;
    defaultAppError = undefined;
    renderDefaultAppState();
  }
  function renderDefaultAppState(): void {
    const status = currentDefaultAppStatus;
    const canToggle = status.kind === 'available' && status.canToggle;
    const checked = pendingDefaultAppValue ?? (status.kind === 'available' && status.state === 'on');
    defaultAppSwitch.setAttribute('aria-checked', String(checked));
    const accentColor = doc.defaultView?.getComputedStyle(tabButtons.get('General')!).color;
    defaultAppSwitch.style.backgroundColor = checked && accentColor ? accentColor : '';
    defaultAppThumb.style.transform = checked ? 'translateX(18px)' : 'translateX(0)';
    defaultAppSwitch.disabled = pendingDefaultAppValue !== undefined || !canToggle;
    defaultAppSwitch.style.opacity = defaultAppSwitch.disabled ? '0.55' : '1';
    defaultAppSwitch.classList.toggle('is-on', checked);
    defaultAppSwitch.classList.toggle('is-pending', pendingDefaultAppValue !== undefined);
    defaultAppRow.setAttribute('aria-busy', String(pendingDefaultAppValue !== undefined));
    defaultAppCaption.classList.toggle('is-error', defaultAppError !== undefined || status.kind === 'error');

    if (pendingDefaultAppValue !== undefined) defaultAppCaption.textContent = 'Changing the default app…';
    else if (defaultAppError) defaultAppCaption.textContent = defaultAppError;
    else if (status.kind === 'loading') defaultAppCaption.textContent = 'Checking…';
    else if (status.kind === 'error') defaultAppCaption.textContent = status.message;
    else if (status.kind === 'unavailable') defaultAppCaption.textContent = 'Available in the Mac app.';
    else if (status.state === 'on') {
      defaultAppCaption.textContent = status.canToggle
        ? status.previousAppName ? `Turn off to go back to ${status.previousAppName}.` : 'Turn off to restore the previous app.'
        : 'Change the default app in Finder’s Get Info.';
    } else if (!status.canToggle) defaultAppCaption.textContent = 'Markdown file types aren’t available on this Mac.';
    else defaultAppCaption.textContent = status.currentAppName
      ? `Markdown files open in ${status.currentAppName}.` : 'Markdown files have no default app.';
  }
  const view: ViewerSettingsView = {
    element: root,
    update,
    updateDefaultAppStatus,
    setError(message) { error.textContent = message; error.hidden = false; },
    clearError() { error.hidden = true; },
    focus() { tabButtons.get(activeTab)?.focus(); },
    dispose() { themeCleanup(); },
  };
  selectTab(activeTab);
  update(currentPreferences);
  updateDefaultAppStatus({ kind: 'loading' });
  void options.onQueryDefaultAppStatus().then(updateDefaultAppStatus, () => {
    updateDefaultAppStatus({ kind: 'error', message: 'macOS couldn’t check the default app.' });
  });
  defaultAppSwitch.addEventListener('click', () => {
    const confirmed = currentDefaultAppStatus;
    if (confirmed.kind !== 'available' || !confirmed.canToggle || pendingDefaultAppValue !== undefined) return;
    const enabled = confirmed.state === 'off';
    pendingDefaultAppValue = enabled; defaultAppError = undefined; renderDefaultAppState();
    void (async () => {
      let outcome: ViewerDefaultAppOutcome;
      try { outcome = await options.onSetDefaultApp(enabled); }
      catch { outcome = { kind: 'declinedOrFailed' }; }
      let refreshed: ViewerDefaultAppStatus | undefined;
      try { refreshed = await options.onQueryDefaultAppStatus(); } catch { /* Keep the last confirmed state. */ }
      pendingDefaultAppValue = undefined;
      if (refreshed) currentDefaultAppStatus = refreshed;
      const changed = outcome.kind === 'changed' && refreshed?.kind === 'available' &&
        (enabled ? refreshed.state === 'on' : refreshed.state === 'off');
      defaultAppError = changed ? undefined : refreshed ? 'macOS didn’t change the default app.' : 'macOS couldn’t check the default app.';
      renderDefaultAppState();
    })();
  });
  return view;
}

function errorText(error: unknown): string { return error instanceof Error && error.message ? error.message : 'The viewer preference could not be saved.'; }
