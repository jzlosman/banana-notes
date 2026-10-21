import Image from '@tiptap/extension-image';
import { Node } from '@tiptap/core';
import { isManagedMediaURL } from './attachments';

// Preserve existing remote image source when editing; the app CSP intentionally blocks
// remote image loads. Imported assets are the supported, offline rendering path.
function imageSource(value: string): boolean {
  if (isManagedMediaURL(value)) return true;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}

/** Audio/video are restricted to native-managed assets and persist as a
 * narrowly recognized controls-only HTML convention; arbitrary raw HTML is not enabled. */
export const ManagedImage = Image.extend({
  addAttributes() {
    return { ...this.parent?.(), src: {
      default: null,
      parseHTML: (element: HTMLElement) => { const src = element.getAttribute('src') ?? ''; return imageSource(src) ? src : null; },
      renderHTML: (attributes: Record<string, unknown>) => imageSource(String(attributes.src ?? '')) ? { src: attributes.src } : {},
    } };
  },
  parseMarkdown(token: any, helpers: any) {
    const src = token.href ?? token.url ?? '';
    if (!imageSource(src)) return null;
    return helpers.createNode(this.name, { src, alt: token.text ?? '', title: token.title ?? null });
  },
  renderMarkdown(node: any) {
    const src = node.attrs?.src;
    if (!imageSource(src)) return '';
    const alt = String(node.attrs?.alt ?? '').replace(/[\\[\]]/g, '\\$&');
    return `![${alt}](${src})`;
  },
});

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
export const mediaExtensions = () => [ManagedImage, ManagedAudio, ManagedVideo];
