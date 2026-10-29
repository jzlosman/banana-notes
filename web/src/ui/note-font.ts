import { ChevronDown } from 'lucide';
import { renderIcon } from './icon';
import { DEFAULT_NOTE_FONT_STATE, resolveNoteFontState, resolveNoteFontSelection, type NoteFontDefinition, type NoteFontSelection, type NoteFontState } from '../domain/note-font';
import { plainInput } from './plain-input';
export { DEFAULT_NOTE_FONT_STATE, resolveNoteFontState, resolveNoteFontSelection } from '../domain/note-font';
export type { NoteFontDefinition, NoteFontSelection, NoteFontState } from '../domain/note-font';

const registeredFonts = new WeakMap<Document, Map<string, { signature: string; faces: FontFace[] }>>();
const fontStack = (font: NoteFontDefinition) => font.kind !== 'system' ? `"${font.family}", ui-monospace, Menlo, monospace` : font.family;
export async function applyNoteFont(root: HTMLElement, rawState: NoteFontState, isCurrent: () => boolean = () => true): Promise<void> {
  const state = resolveNoteFontState(rawState);
  const font = state.fonts.find(item => item.id === state.selection.fontID) ?? state.fonts[0];
  if (font.kind !== 'system' && font.faces.length) {
    const doc = root.ownerDocument;
    const Face = doc.defaultView?.FontFace ?? globalThis.FontFace;
    if (!Face || !doc.fonts) throw new Error('Downloaded fonts are not supported in this environment.');
    let registry = registeredFonts.get(doc); if (!registry) { registry = new Map(); registeredFonts.set(doc, registry); }
    const signature = JSON.stringify([font.family, font.faces]);
    const previous = registry.get(font.id);
    if (previous && previous.signature !== signature) { previous.faces.forEach(face => doc.fonts.delete?.(face)); registry.delete(font.id); }
    let entry = registry.get(font.id);
    if (!entry) {
      const seen = new Set<string>(), faces: FontFace[] = [];
      for (const face of font.faces) {
        const key = `${face.url}|${face.weight}|${face.unicodeRange ?? ''}`;
        if (seen.has(key)) continue; seen.add(key);
        const descriptors: FontFaceDescriptors = { weight: face.weight, display: 'swap' };
        if (face.unicodeRange) descriptors.unicodeRange = face.unicodeRange;
        const asset = new Face(font.family, `url("${face.url}")`, descriptors); doc.fonts.add(asset); faces.push(asset);
      }
      entry = { signature, faces }; registry.set(font.id, entry);
    }
    try {
      const sample = 'Project notes Draft ready for review.';
      await doc.fonts.load(`${state.selection.weight} 14px "${font.family}"`, sample);
      if (font.faces.some(face => { const [low, high = low] = face.weight.split(/\s+/).map(Number); return low <= 700 && high >= 700; })) await doc.fonts.load(`700 14px "${font.family}"`, sample);
    } catch (error) { entry.faces.forEach(face => doc.fonts.delete?.(face)); registry.delete(font.id); throw error; }
  }
  if (!isCurrent()) return;
  root.style.setProperty('--note-font-family', fontStack(font));
  root.style.setProperty('--note-font-weight', String(state.selection.weight));
}

type SettingsOptions = {
  state: NoteFontState;
  onSelect: (selection: NoteFontSelection) => Promise<NoteFontState>;
  onDownload?: (family: string) => Promise<{ fontState: NoteFontState; downloadedFontID: string }>;
  onCancelDownload?: () => Promise<void>;
  textSizeControl?: { input: HTMLSelectElement; status: HTMLElement };
};

export function renderNoteFontSettings(options: SettingsOptions): HTMLElement {
  const section = document.createElement('section');
  section.className = 'settings-group note-font-settings';
  const heading = document.createElement('h2');
  heading.id = 'note-text-heading'; heading.textContent = 'Note text';
  section.setAttribute('aria-labelledby', heading.id);
  section.append(heading);
  const fields = document.createElement('div'); fields.className = 'note-font-fields';
  const selectControl = (control: HTMLSelectElement): HTMLElement => {
    const wrapper = document.createElement('span'); wrapper.className = 'note-font-select';
    const chevron = renderIcon(ChevronDown, 14);
    wrapper.append(control, chevron); return wrapper;
  };

  const fontLabel = document.createElement('label');
  fontLabel.className = 'note-font-label';
  fontLabel.textContent = 'Font';
  const fontSelect = document.createElement('select');
  fontSelect.className = 'note-font-control';
  fontSelect.setAttribute('aria-label', 'Note font');
  fontLabel.append(selectControl(fontSelect));
  fields.append(fontLabel);

  const weightLabel = document.createElement('label');
  weightLabel.className = 'note-font-label';
  weightLabel.textContent = 'Weight';
  const weightSelect = document.createElement('select');
  weightSelect.className = 'note-font-control';
  weightSelect.setAttribute('aria-label', 'Note font weight');
  weightLabel.append(selectControl(weightSelect));
  fields.append(weightLabel);
  if (options.textSizeControl) {
    const sizeLabel = document.createElement('label'); sizeLabel.className = 'note-font-label'; sizeLabel.textContent = 'Size';
    sizeLabel.append(selectControl(options.textSizeControl.input)); fields.append(sizeLabel);
  }
  section.append(fields);
  if (options.textSizeControl) section.append(options.textSizeControl.status);
  const selectionError = document.createElement('p'); selectionError.className = 'note-font-error'; selectionError.setAttribute('role', 'alert'); selectionError.hidden = true;
  section.append(selectionError);

  const preview = document.createElement('figure');
  preview.className = 'note-font-preview'; preview.setAttribute('aria-label', 'Font preview');
  const caption = document.createElement('figcaption'); caption.textContent = 'Preview';
  const sample = document.createElement('div'); sample.className = 'note-font-sample';
  const previewTitle = document.createElement('div'); previewTitle.textContent = 'Project notes';
  const previewLine = document.createElement('div'); previewLine.textContent = 'Draft ready for review.';
  sample.append(previewTitle, previewLine); preview.append(caption, sample);
  section.append(preview);

  const disclosure = document.createElement('details');
  disclosure.className = 'note-font-download';
  const summary = document.createElement('summary'); summary.textContent = 'Add a Google font';
  disclosure.append(summary);
  const downloadForm = document.createElement('form'); downloadForm.className = 'note-font-download-form';
  const familyLabel = document.createElement('label');
  familyLabel.className = 'note-font-label'; familyLabel.textContent = 'Family name';
  const familyInput = plainInput(document.createElement('input'));
  familyInput.type = 'text'; familyInput.className = 'note-font-control'; familyInput.placeholder = 'e.g. IBM Plex Mono';
  familyInput.setAttribute('aria-label', 'Google Fonts family name'); familyInput.autocomplete = 'off';
  const datalist = document.createElement('datalist'); datalist.id = `note-font-examples-${Math.random().toString(36).slice(2)}`;
  for (const name of ['IBM Plex Mono', 'DM Sans', 'Lora']) { const option = document.createElement('option'); option.value = name; datalist.append(option); }
  familyInput.setAttribute('list', datalist.id);
  familyLabel.append(familyInput, datalist);
  downloadForm.append(familyLabel);
  const downloadActions = document.createElement('div'); downloadActions.className = 'note-font-download-actions';
  const downloadButton = document.createElement('button'); downloadButton.type = 'submit'; downloadButton.className = 'note-font-download-button'; downloadButton.textContent = 'Download and use';
  downloadActions.append(downloadButton);
  const progress = document.createElement('p'); progress.className = 'note-font-status'; progress.setAttribute('role', 'status'); progress.setAttribute('aria-live', 'polite'); progress.hidden = true;
  const error = document.createElement('p'); error.className = 'note-font-error'; error.setAttribute('role', 'alert'); error.hidden = true;
  let cancelButton: HTMLButtonElement | undefined;
  if (options.onCancelDownload) { cancelButton = document.createElement('button'); cancelButton.type = 'button'; cancelButton.className = 'note-font-cancel'; cancelButton.textContent = 'Cancel'; cancelButton.hidden = true; downloadActions.append(cancelButton); }
  const privacy = document.createElement('p'); privacy.className = 'note-font-status'; privacy.textContent = options.onDownload ? 'Fonts are downloaded from Google and cached locally.' : 'Font downloads are available in the Mac app.';
  downloadForm.append(downloadActions, privacy, progress, error); disclosure.append(downloadForm);
  section.append(disclosure);

  let state = resolveNoteFontState(options.state);
  let choiceRevision = 0;
  let downloadRevision = 0;
  let downloading = false;
  let selecting = false;
  const supportedLabels = new Map([[400, 'Regular'], [500, 'Medium'], [600, 'Semibold']]);
  const render = () => {
    const selected = state.fonts.find(font => font.id === state.selection.fontID) ?? state.fonts[0];
    const selectedID = selected.id;
    fontSelect.replaceChildren();
    for (const font of state.fonts) { const option = document.createElement('option'); option.value = font.id; option.textContent = font.name; fontSelect.append(option); }
    fontSelect.value = selectedID; fontSelect.title = selected.name;
    weightSelect.replaceChildren();
    for (const weight of selected.weights.filter(value => supportedLabels.has(value))) {
      const option = document.createElement('option'); option.value = String(weight); option.textContent = supportedLabels.get(weight)!; weightSelect.append(option);
    }
    fontSelect.disabled = selecting;
    weightSelect.disabled = selecting || weightSelect.options.length < 2;
    downloadButton.disabled = !options.onDownload || selecting || downloading;
    weightSelect.value = String(state.selection.weight);
    sample.style.fontFamily = fontStack(selected);
    sample.style.fontWeight = String(state.selection.weight);
    previewTitle.style.fontWeight = String(Math.min(600, Math.max(400, state.selection.weight)));
  };
  const select = async (selection: NoteFontSelection) => {
    const revision = ++choiceRevision;
    selecting = true; render();
    try {
      const confirmed = resolveNoteFontState(await options.onSelect(selection));
      if (revision === choiceRevision && confirmed.selection.fontID === selection.fontID && confirmed.selection.weight === selection.weight) { state = confirmed; selectionError.hidden = true; }
    } catch (cause) {
      if (revision === choiceRevision) { selectionError.textContent = cause instanceof Error ? cause.message : 'The font could not be saved.'; selectionError.hidden = false; }
    } finally {
      if (revision === choiceRevision) { selecting = false; render(); }
    }
  };
  fontSelect.addEventListener('change', () => { const font = state.fonts.find(item => item.id === fontSelect.value); if (font) void select({ fontID: font.id, weight: resolveNoteFontSelection({ fontID: font.id, weight: state.selection.weight }, [font]).weight }); });
  weightSelect.addEventListener('change', () => { void select({ fontID: state.selection.fontID, weight: Number(weightSelect.value) }); });
  downloadForm.addEventListener('submit', async event => {
    event.preventDefault();
    const family = familyInput.value.trim();
    if (!family || !/^[A-Za-z0-9][A-Za-z0-9 '.-]{0,119}$/.test(family)) { error.textContent = 'Enter a valid Google Fonts family name.'; error.hidden = false; familyInput.focus(); return; }
    const request = ++downloadRevision;
    const revisionAtStart = choiceRevision;
    downloading = true; downloadButton.disabled = true; progress.textContent = `Downloading ${family}…`; progress.hidden = false; error.hidden = true;
    if (!options.onDownload) return;
    if (cancelButton) cancelButton.hidden = false;
    try {
      const result = await options.onDownload(family);
      if (request !== downloadRevision) return;
      const downloadedState = resolveNoteFontState(result.fontState);
      const font = downloadedState.fonts.find(item => item.id === result.downloadedFontID);
      if (!font) throw new Error('The downloaded font is unavailable.');
      state = { ...downloadedState, selection: { ...state.selection } };
      render();
      if (revisionAtStart === choiceRevision) await select({ fontID: font.id, weight: resolveNoteFontSelection({ fontID: font.id, weight: 500 }, [font]).weight });
    } catch (cause) {
      if (request === downloadRevision) { error.textContent = cause instanceof Error ? cause.message : 'The font could not be downloaded.'; error.hidden = false; }
    } finally {
      if (request === downloadRevision) { downloading = false; downloadButton.disabled = false; progress.hidden = true; if (cancelButton) cancelButton.hidden = true; render(); }
    }
  });
  cancelButton?.addEventListener('click', async () => {
    if (!downloading) return;
    ++downloadRevision; cancelButton.disabled = true; progress.textContent = 'Canceling download…';
    try { await options.onCancelDownload?.(); } catch (cause) { error.textContent = cause instanceof Error ? cause.message : 'The download could not be canceled.'; error.hidden = false; }
    finally { downloading = false; progress.hidden = true; cancelButton.hidden = true; cancelButton.disabled = false; render(); }
  });
  render();
  return section;
}
