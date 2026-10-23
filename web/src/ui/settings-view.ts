import { createElement, FolderOpen, type IconNode } from 'lucide';
import type { Capabilities, StartupState, HotkeyState } from '../application/ports';
import { DEFAULT_HOTKEY, shortcutFromKeyEvent } from '../domain/hotkey';
import type { NoteFontSelection, NoteFontState } from '../domain/note-font';
import { DEFAULT_WINDOW_STYLE, type WindowStyle } from '../domain/window-style';
import { MIN_FONT_SIZE, MAX_FONT_SIZE } from '../domain/font-size';
import { renderNoteFontSettings } from './note-font';
import { PreferenceSaveQueue } from '../application/preference-save';
import { WindowStyleSaveQueue } from '../application/window-style-save';

export type SettingsTab = 'themes' | 'window' | 'code' | 'general' | 'search' | 'export';
const tabs = [['themes', 'Themes'], ['code', 'Code'], ['window', 'Window'], ['general', 'General'], ['search', 'Search']] as const;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node;
}
function icon(node: IconNode, size = 17): SVGElement {
  return createElement([node[0], { ...node[1], width: size, height: size, 'stroke-width': 1.7, 'aria-hidden': 'true' }, node[2]]);
}
function button(label: string, glyph: IconNode | null, run: () => void | Promise<unknown>, className = 'icon-button', text?: string, onError: (error: unknown) => void = () => {}): HTMLButtonElement {
  const node = element('button', className); node.type = 'button'; node.title = label; node.setAttribute('aria-label', label);
  if (glyph) node.append(icon(glyph)); if (text) node.append(document.createTextNode(text));
  node.onclick = () => { try { Promise.resolve(run()).catch(onError); } catch (error) { onError(error); } };
  return node;
}

export function renderAppearanceTabs(tab: SettingsTab, setTab: (tab: SettingsTab) => void, render: () => void, app: HTMLElement): HTMLElement {
  const tabsElement = element('div', 'appearance-tabs'); tabsElement.setAttribute('role', 'tablist'); tabsElement.setAttribute('aria-label', 'Settings sections');
  for (const [id, label] of tabs) {
    const item = button(`${label} settings`, null, () => { setTab(id); render(); app.querySelector<HTMLButtonElement>('.appearance-tab[aria-selected="true"]')?.focus(); }, 'appearance-tab', label);
    item.id = `appearance-tab-${id}`; item.setAttribute('role', 'tab'); item.setAttribute('aria-selected', String(tab === id));
    item.setAttribute('aria-controls', 'appearance-content'); item.tabIndex = tab === id ? 0 : -1;
    item.onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const index = tabs.findIndex(([key]) => key === id);
      const next = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length][0];
      setTab(next); render(); app.querySelector<HTMLButtonElement>('.appearance-tab[aria-selected="true"]')?.focus();
    };
    tabsElement.append(item);
  }
  return tabsElement;
}

export function renderGeneralSettings(options: {
  capabilities: Capabilities;
  startup: StartupState;
  onStartupChanged(state: StartupState): void;
  ocrEnabled: boolean;
  onOCREnabled(enabled: boolean): void;
  hotkey: HotkeyState;
  onHotkeyChanged(state: HotkeyState): void;
  onError(error: unknown): void;
}): HTMLElement {
  const panel = element('section', 'settings-panel');
  if (options.capabilities.hotkey) panel.append(renderHotkeySettings(options));
  const startup = element('section', 'settings-group'); startup.append(element('h2', '', 'Startup'));
  const status = element('p', 'tool-status'); status.setAttribute('role', 'status');
  let startupState = options.startup;
  const approval = button('Open macOS Login Items settings', null, () => options.capabilities.startup?.openLoginSettings(), 'text-button', 'Open Login Items…', options.onError);
  const updateStatus = () => { status.textContent = startupState.launchError || (startupState.launchStatus === 'requiresApproval' ? 'Enable Banana Notes in macOS Login Items.' : ''); status.hidden = !status.textContent; approval.hidden = !status.textContent; }; updateStatus();
  for (const [key, label, hint] of [['launchAtLogin', 'Open at login', 'Managed by macOS Login Items.'], ['newNoteOnLaunch', 'New note on launch', 'Start with a new note, or reuse the newest blank note.']] as const) {
    const row = element('label', 'setting-row'); const copy = element('span', 'setting-copy'); copy.append(element('span', 'setting-title', label), element('span', 'setting-hint', hint));
    const input = element('input'); input.type = 'checkbox'; input.checked = startupState[key]; input.setAttribute('aria-label', label); input.disabled = !options.capabilities.startup;
    input.onchange = async () => {
      input.disabled = true;
      try {
        if (!options.capabilities.startup) throw new Error('Startup preferences are unavailable in this preview.');
        const next = await options.capabilities.startup.save({ [key]: input.checked }); startupState = next; options.onStartupChanged(next); input.checked = next[key]; updateStatus();
      } catch (error) { input.checked = startupState[key]; options.onError(error); }
      finally { input.disabled = !options.capabilities.startup; }
    };
    row.append(copy, input); startup.append(row);
  }
  if (!options.capabilities.startup) status.textContent = 'Startup preferences are available in the Mac app.';
  approval.hidden = !options.capabilities.startup || !startupState.launchError && startupState.launchStatus !== 'requiresApproval';
  startup.append(status, approval); panel.append(startup, renderOCRPreferences(options));
  const data = element('section', 'settings-group');
  data.append(element('h2', '', 'Storage'), element('p', 'settings-description', options.capabilities.dataFolder?.description ?? 'Browser preview only. Notes are stored separately from the Mac app.'));
  const openData = button('Open local data folder', FolderOpen, () => options.capabilities.dataFolder?.open(), 'text-button', 'Open data folder', options.onError);
  openData.disabled = !options.capabilities.dataFolder; data.append(openData); panel.append(data); return panel;
}

function renderHotkeySettings(options: {
  capabilities: Capabilities;
  hotkey: HotkeyState;
  onHotkeyChanged(state: HotkeyState): void;
  onError(error: unknown): void;
}): HTMLElement {
  const section = element('section', 'settings-group hotkey-settings'); section.append(element('h2', '', 'Keyboard'));
  const row = element('div', 'setting-row hotkey-row'); const copy = element('span', 'setting-copy');
  copy.append(element('span', 'setting-title', 'Global shortcut'), element('span', 'setting-hint', 'Show or hide Banana Notes from any app.'));
  const controls = element('div', 'hotkey-controls');
  const chord = element('button', 'hotkey-chord'); chord.type = 'button'; chord.textContent = options.hotkey.display;
  chord.setAttribute('aria-label', `Record global shortcut. Current shortcut: ${options.hotkey.display}`);
  const reset = element('button', 'text-button hotkey-reset', 'Reset'); reset.type = 'button'; reset.setAttribute('aria-label', 'Reset global shortcut to Control Shift Space');
  controls.append(chord, reset); row.append(copy, controls); section.append(row);
  const error = element('p', 'hotkey-error'); error.setAttribute('role', 'alert'); error.hidden = !options.hotkey.error; error.textContent = options.hotkey.error || '';
  section.append(error);
  let recording = false, saving = false;
  const refresh = () => {
    chord.textContent = recording ? 'Press a shortcut…' : saving ? 'Saving…' : options.hotkey.display;
    chord.dataset.recording = String(recording);
    chord.setAttribute('aria-label', recording ? 'Press a shortcut, or Escape to cancel' : `Record global shortcut. Current shortcut: ${options.hotkey.display}`);
    chord.disabled = saving; reset.disabled = saving;
  };
  const save = async (shortcut: { keyCode: number; modifiers: number }) => {
    recording = false; saving = true; error.hidden = true; error.textContent = ''; refresh();
    try {
      const next = await options.capabilities.hotkey!.set(shortcut);
      if (!next.registered) {
        error.textContent = next.error || 'The shortcut could not be registered. Your previous shortcut remains active.';
        error.hidden = false;
        return;
      }
      options.hotkey = next; options.onHotkeyChanged(next); error.hidden = true;
    } catch (reason) {
      error.textContent = reason instanceof Error ? reason.message : String(reason); error.hidden = false;
    } finally { saving = false; refresh(); }
  };
  chord.onclick = () => { if (saving) return; recording = true; error.hidden = true; error.textContent = ''; refresh(); chord.focus(); };
  chord.onkeydown = event => {
    if (!recording) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); recording = false; refresh(); return; }
    if (['Meta', 'Control', 'Alt', 'Shift'].includes(event.key) || event.repeat) { event.preventDefault(); return; }
    event.preventDefault(); event.stopPropagation();
    const result = shortcutFromKeyEvent(event);
    if (!result.ok) {
      error.textContent = result.reason === 'modifier-required' ? 'Include at least one of Command, Control, or Option.' : 'That key is not supported. Try a letter, number, Space, Return, Tab, arrow, function, or punctuation key.';
      error.hidden = false; return;
    }
    void save(result.shortcut);
  };
  reset.onclick = () => { if (!saving) void save(DEFAULT_HOTKEY); };
  refresh(); return section;
}

function renderOCRPreferences(options: {
  capabilities: Capabilities;
  ocrEnabled: boolean;
  onOCREnabled(enabled: boolean): void;
  onError(error: unknown): void;
}): HTMLElement {
  const section = element('section', 'settings-group'); section.append(element('h2', '', 'Images'));
  const row = element('label', 'setting-row'); const copy = element('span', 'setting-copy');
  copy.append(element('span', 'setting-title', 'Recognize image text'), element('span', 'setting-hint', 'Runs locally. Review text before inserting.'));
  const input = element('input'); input.type = 'checkbox'; input.checked = options.ocrEnabled; input.setAttribute('aria-label', 'Enable local image text recognition');
  input.onchange = async () => {
    const desired = input.checked; input.disabled = true;
    try {
      const result = await options.capabilities.features.setOCR(desired);
      if (result.ocrEnabled !== desired) throw new Error('OCR preference could not be confirmed.');
      options.onOCREnabled(desired);
    } catch (error) { input.checked = options.ocrEnabled; options.onError(error); }
    finally { input.disabled = false; }
  };
  input.disabled = !options.capabilities.ocr;
  if (!options.capabilities.ocr) copy.append(element('span', 'setting-hint', 'Available in the Mac app.'));
  row.append(copy, input); section.append(row); return section;
}

export function renderWindowStyleSettings(options: {
  noteFonts: NoteFontState;
  fontSize: number;
  windowStyle: WindowStyle;
  windowFocused: boolean;
  windowStyleStatus: string;
  windowStyleError: boolean;
  capabilities: Capabilities;
  fontSizeQueue: PreferenceSaveQueue<number>;
  windowStyleQueue: WindowStyleSaveQueue;
  onSelectNoteFont(selection: NoteFontSelection): Promise<NoteFontState>;
  onDownloadFont?: (family: string) => Promise<{ fontState: NoteFontState; downloadedFontID: string }>;
  onCancelDownload?: () => Promise<void>;
  onChangeFontSize(size: number): void;
  onChangeWindowStyle(style: WindowStyle): void;
  onError(error: unknown): void;
}): HTMLElement {
  const settings = element('section', 'window-settings quiet-scroll side-scroll'); settings.id = 'appearance-content'; settings.setAttribute('role', 'tabpanel'); settings.setAttribute('aria-labelledby', 'appearance-tab-window');
  const sizeControl = element('select', 'note-font-control'); sizeControl.dataset.fontSize = ''; sizeControl.setAttribute('aria-label', 'Note text size'); sizeControl.title = 'Note text size · ⌘+/⌘− · Reset with ⌘0';
  for (let size = MIN_FONT_SIZE; size <= MAX_FONT_SIZE; size++) { const option = element('option', '', `${size} px`); option.value = String(size); sizeControl.append(option); }
  sizeControl.value = String(options.fontSize); sizeControl.onchange = () => options.onChangeFontSize(Number(sizeControl.value));
  const fontSaveStatus = button('Retry saving note text size', null, () => options.fontSizeQueue.flush(), 'save-status font-save-status', undefined, options.onError); fontSaveStatus.setAttribute('aria-live', 'polite');
  settings.append(renderNoteFontSettings({ state: options.noteFonts, textSizeControl: { input: sizeControl, status: fontSaveStatus }, onSelect: options.onSelectNoteFont, onDownload: options.onDownloadFont, onCancelDownload: options.onCancelDownload }));
  const effects = element('section', 'settings-group window-effects'); const heading = element('h2', '', 'Window effects'); heading.id = 'window-effects-heading'; effects.setAttribute('aria-labelledby', heading.id); effects.append(heading); settings.append(effects);
  for (const [field, label, hint] of [
    ['focusedOpacity', 'Active window opacity', 'Applies to the entire window, including text.'],
    ['unfocusedOpacity', 'Inactive window opacity', 'Applies when the pinned window is inactive. Default: 60%.'],
    ['glass', 'Background translucency', 'Blends the desktop behind the window.'],
  ] as const) {
    const row = element('div', 'effect-setting'); const labels = element('div', 'effect-labels'); const text = element('label', '', label); text.htmlFor = `effect-${field}`;
    const output = element('output'); output.dataset.windowStyle = field; output.setAttribute('for', `effect-${field}`); labels.append(text, output);
    const input = element('input', 'effect-range'); input.type = 'range'; input.id = `effect-${field}`; input.dataset.windowStyle = field;
    input.min = field === 'glass' ? '0' : '5'; input.max = '100'; input.step = '1'; input.value = String(Math.round(options.windowStyle[field] * 100));
    input.oninput = () => options.onChangeWindowStyle({ ...options.windowStyle, [field]: Number(input.value) / 100 });
    row.append(labels, input, element('p', 'effect-hint', hint)); effects.append(row);
  }
  const actions = element('div', 'effects-actions');
  actions.append(button('Reset window effects', null, () => options.onChangeWindowStyle({ ...DEFAULT_WINDOW_STYLE }), 'text-button', 'Reset window effects'));
  const saveStatus = button('Retry saving window effects', null, () => options.windowStyleQueue.flush(), 'save-status effects-save-status', undefined, options.onError); saveStatus.setAttribute('aria-live', 'polite');
  saveStatus.textContent = options.windowStyleStatus; saveStatus.hidden = !options.windowStyleError; saveStatus.classList.toggle('save-error', options.windowStyleError);
  actions.append(saveStatus); effects.append(actions, element('p', 'effects-recovery', 'Use the menu bar → Reset Window Effects to restore the default opacity and translucency.'));
  if (options.capabilities.windowStyle.previewOpacity(!!options.windowFocused, options.windowStyle) !== null) effects.append(element('p', 'effects-recovery', 'Background translucency is approximated in browser preview.'));
  return settings;
}
