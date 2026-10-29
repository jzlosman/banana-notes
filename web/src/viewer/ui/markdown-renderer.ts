import { Editor } from '@tiptap/core';
import { markdownExtensions } from '../../ui/editor-schema';
import { installMarkdownSource } from '../../ui/editor/markdown-source';
import { isResolvedViewerImageSource, isSafeViewerLink, resolveViewerImageSource } from '../domain/model';

export type ReadOnlyMarkdownRenderer = { root: HTMLElement; destroy(): void };

function headingSlug(title: string): string {
  return title.normalize('NFC').toLocaleLowerCase()
    .trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'section';
}

function assignHeadingIDs(root: HTMLElement): void {
  const used = new Set<string>();
  for (const heading of root.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4, h5, h6')) {
    const base = headingSlug(heading.textContent ?? '');
    let id = base, suffix = 2;
    while (used.has(id)) id = `${base}-${suffix++}`;
    used.add(id); heading.id = id; heading.tabIndex = -1;
  }
}

export function renderReadOnlyMarkdown(host: HTMLElement, markdown: string, resourceBaseURL: string, onOpenLink: (href: string) => void): ReadOnlyMarkdownRenderer {
  const root = host.ownerDocument.createElement('div');
  root.className = 'markdown-editor viewer-markdown';
  root.setAttribute('aria-readonly', 'true');
  root.dataset.viewerReadonly = 'true';
  host.replaceChildren(root);

  const imageResolver = {
    resolve: (source: string) => resolveViewerImageSource(source, resourceBaseURL),
    isResolved: (source: string) => isResolvedViewerImageSource(source, resourceBaseURL),
  };
  const editor = new Editor({
    element: root,
    extensions: markdownExtensions({ imageResolver }),
    editable: false,
    content: '',
  });
  installMarkdownSource(editor, markdown, { supportsImage: source => resolveViewerImageSource(source, resourceBaseURL) !== null });
  assignHeadingIDs(root);
  root.setAttribute('contenteditable', 'false');
  root.setAttribute('aria-readonly', 'true');
  root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(input => {
    input.disabled = true;
    input.tabIndex = -1;
    input.setAttribute('aria-readonly', 'true');
  });

  const onClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof root.ownerDocument.defaultView!.Element)) return;
    const anchor = target.closest<HTMLAnchorElement>('a[href]');
    if (!anchor || !root.contains(anchor)) return;
    event.preventDefault();
    const href = anchor.getAttribute('href') ?? '';
    if (href.startsWith('#')) {
      let fragment: string;
      try { fragment = decodeURIComponent(href.slice(1)); } catch { return; }
      const heading = [...root.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4, h5, h6')].find(item => item.id === fragment);
      if (heading) {
        heading.scrollIntoView?.({ block: 'start', behavior: 'auto' });
        heading.focus({ preventScroll: true });
      }
      return;
    }
    if (!isSafeViewerLink(href)) return;
    onOpenLink(href);
  };
  const preventMutation = (event: Event) => event.preventDefault();
  const preventMutationShortcut = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && ['v', 'x'].includes(event.key.toLowerCase())) event.preventDefault();
  };
  root.addEventListener('click', onClick);
  root.addEventListener('beforeinput', preventMutation);
  root.addEventListener('paste', preventMutation);
  root.addEventListener('cut', preventMutation);
  root.addEventListener('drop', preventMutation);
  root.addEventListener('dragover', preventMutation);
  root.addEventListener('keydown', preventMutationShortcut);

  return {
    root,
    destroy() {
      root.removeEventListener('click', onClick);
      root.removeEventListener('beforeinput', preventMutation);
      root.removeEventListener('paste', preventMutation);
      root.removeEventListener('cut', preventMutation);
      root.removeEventListener('drop', preventMutation);
      root.removeEventListener('dragover', preventMutation);
      root.removeEventListener('keydown', preventMutationShortcut);
      editor.destroy();
      root.remove();
    },
  };
}
