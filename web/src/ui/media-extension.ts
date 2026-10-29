import Image from '@tiptap/extension-image';
import { Node } from '@tiptap/core';
import { isManagedMediaURL } from '../domain/managed-media';

// Preserve existing remote image source when editing; the app CSP intentionally blocks
// remote image loads. Imported assets are the supported, offline rendering path.
function imageSource(value: string): boolean {
  if (isManagedMediaURL(value)) return true;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}

export type MarkdownImageResolver = {
  resolve(source: string): string | null;
  isResolved?(source: string): boolean;
};

function imageExtension(resolveSource?: MarkdownImageResolver) {
  const acceptedSource = (value: unknown): string | null => {
    const source = String(value ?? '');
    if (resolveSource) {
      if (resolveSource.isResolved?.(source)) return source;
      return resolveSource.resolve(source);
    }
    return imageSource(source) ? source : null;
  };

  return Image.extend({
    addAttributes() {
      return { ...this.parent?.(), src: {
        default: null,
        parseHTML: (element: HTMLElement) => acceptedSource(element.getAttribute('src')),
        renderHTML: (attributes: Record<string, unknown>) => {
          const src = acceptedSource(attributes.src);
          return src ? { src } : {};
        },
      } };
    },
    parseMarkdown(token: any, helpers: any) {
      const source = String(token.href ?? token.url ?? '');
      const src = resolveSource ? resolveSource.resolve(source) : acceptedSource(source);
      if (!src) return null;
      return helpers.createNode(this.name, { src, alt: token.text ?? '', title: token.title ?? null });
    },
    renderMarkdown(node: any) {
      const src = acceptedSource(node.attrs?.src);
      if (!src) return '';
      const alt = String(node.attrs?.alt ?? '').replace(/[\\[\]]/g, '\\$&');
      return `![${alt}](${src})`;
    },
  });
}

/** Existing Notes grammar; viewer-only resolution is an explicit opt-in. */
export const ManagedImage = imageExtension();

function mediaNode(kind: 'audio' | 'video') {
  const pattern = new RegExp(`^<${kind} controls src="(foldnote-asset:\\/\\/media\\/[0-9a-f-]+\\.[a-z0-9]+)"></${kind}>`);
  return Node.create({
    name: kind, group: 'block', atom: true, draggable: false,
    addAttributes() { return { src: { default: null } }; },
    parseHTML() { return [{ tag: `${kind}[controls][src]`, getAttrs: (node: HTMLElement) => isManagedMediaURL(node.getAttribute('src') ?? '') ? { src: node.getAttribute('src') } : false }]; },
    renderHTML({ node }) {
      if (!isManagedMediaURL(String(node.attrs.src ?? ''))) return ['div', { 'data-invalid-media': 'true' }];
      return [kind, { controls: '', preload: 'metadata', src: node.attrs.src }];
    },
    markdownTokenName: `foldnote${kind}`,
    markdownTokenizer: {
      name: `foldnote${kind}`, level: 'block', start: `<${kind} `,
      tokenize(source: string) {
        const match = source.match(pattern);
        if (!match || !isManagedMediaURL(match[1])) return undefined;
        return { type: `foldnote${kind}`, raw: match[0], src: match[1] } as any;
      },
    },
    parseMarkdown(token: any, helpers: any) {
      return isManagedMediaURL(token.src) ? helpers.createNode(kind, { src: token.src }) : null;
    },
    renderMarkdown(node: any) {
      const src = node.attrs?.src;
      return isManagedMediaURL(src) ? `<${kind} controls src="${src}"></${kind}>` : '';
    },
  });
}

export const ManagedAudio = mediaNode('audio');
export const ManagedVideo = mediaNode('video');
export function mediaExtensions(options: { imageResolver?: MarkdownImageResolver } = {}) {
  return [options.imageResolver ? imageExtension(options.imageResolver) : ManagedImage, ManagedAudio, ManagedVideo];
}
