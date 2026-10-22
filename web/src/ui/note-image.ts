import { documentClipboardPayload } from './clipboard';

export type NoteImageGradient = 'dawn' | 'lavender' | 'ocean';
export interface NoteImageOptions { gradient?: NoteImageGradient; width?: number; padding?: number; paper?: string; text?: string; accent?: string; html?: string; codeCSS?: string }
export interface NoteImageRequest { html: string; title: string; backgroundStart: string; backgroundEnd: string; paper: string; text: string; accent: string; width: number; padding: number }
export interface NoteImageControlsOptions { onExport: (request: NoteImageRequest) => void; request: NoteImageRequest; canExport?: boolean }

const gradients: Record<NoteImageGradient, readonly [string, string]> = {
  dawn: ['#f6d6b8', '#f3c6d8'], lavender: ['#dce2ff', '#f2d9f2'], ocean: ['#c4e7ed', '#d6ddfa'],
};
const validColor = (value: string | undefined, fallback: string) => value && /^#[\da-f]{6}$/i.test(value) ? value : fallback;

/** Uses TipTap's schema serializer for formatted note output; markdown/source is untouched. */
export function buildNoteImageRequest(markdown: string, options: NoteImageOptions = {}, title = 'Untitled'): NoteImageRequest {
  const [backgroundStart, backgroundEnd] = gradients[options.gradient ?? 'lavender'];
  const payload = documentClipboardPayload(markdown, 'formatted');
  const html = options.html ?? payload.html ?? escapeHTML(payload.text);
  return {
    html: options.codeCSS ? `<style>${options.codeCSS.replace(/<\/style/gi, '<\\/style')}</style>${html}` : html,
    title,
    backgroundStart, backgroundEnd,
    paper: validColor(options.paper, '#ffffff'), text: validColor(options.text, '#242735'), accent: validColor(options.accent, '#526de5'),
    width: Number.isInteger(options.width) && options.width! >= 480 && options.width! <= 1200 ? options.width! : 760,
    padding: Number.isInteger(options.padding) && options.padding! >= 24 && options.padding! <= 120 ? options.padding! : 48,
  };
}

function escapeHTML(value: string): string { return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!); }

/** Button/preview panel; caller forwards the returned request to the native PNG bridge. */
export function renderNoteImageExportControls({ onExport, request, canExport = true }: NoteImageControlsOptions): HTMLElement {
  const root = document.createElement('section');
  root.className = 'note-image-export';
  root.innerHTML = `<label>Background <select data-gradient><option value="lavender">Lavender</option><option value="dawn">Dawn</option><option value="ocean">Ocean</option></select></label><label>Image width <input data-width type="range" min="600" max="1000" step="40" value="760"></label><div class="note-image-preview" aria-label="Note image preview"><div class="note-image-dots"><i></i><i></i><i></i></div><strong></strong><div class="note-image-preview-content"></div></div><button type="button" class="primary-button" data-export>Save PNG…</button>`;
  const exportButton = root.querySelector<HTMLButtonElement>('[data-export]')!;
  exportButton.disabled = !canExport;
  if (!canExport) {
    exportButton.title = 'PNG export is available in the Mac app.';
    const hint = document.createElement('p'); hint.className = 'note-image-export-hint'; hint.textContent = 'PNG export is available in the Mac app.'; root.append(hint);
  }
  const select = root.querySelector<HTMLSelectElement>('[data-gradient]')!;
  const width = root.querySelector<HTMLInputElement>('[data-width]')!;
  width.value = String(request.width);
  select.value = (Object.entries(gradients).find(([, colors]) => colors[0] === request.backgroundStart)?.[0] || 'lavender');
  const preview = root.querySelector<HTMLElement>('.note-image-preview')!;
  const heading = root.querySelector<HTMLElement>('strong')!;
  const content = root.querySelector<HTMLElement>('.note-image-preview-content')!;
  const update = () => {
    const [start, end] = gradients[select.value as NoteImageGradient];
    preview.style.setProperty('--image-gradient', `linear-gradient(135deg, ${start}, ${end})`);
    preview.style.setProperty('--image-paper', request.paper); preview.style.setProperty('--image-ink', request.text);
    preview.style.setProperty('--image-width', `${Math.min(100, Number(width.value) / 10)}%`);
    heading.textContent = request.title;
    content.innerHTML = request.html;
  };
  select.addEventListener('change', update); width.addEventListener('input', update); update();
  root.querySelector('[data-export]')!.addEventListener('click', () => onExport({ ...request, ...gradientsFor(select.value as NoteImageGradient), width: Number(width.value) }));
  return root;
}
function gradientsFor(gradient: NoteImageGradient) { const [backgroundStart, backgroundEnd] = gradients[gradient]; return { backgroundStart, backgroundEnd }; }
