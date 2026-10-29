import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url:'http://localhost' });
for (const key of ['window','document','navigator','Node','HTMLElement','Element','MutationObserver','DOMParser','getComputedStyle'] as const) if (key in dom.window) Object.defineProperty(globalThis,key,{value:(dom.window as any)[key],configurable:true,writable:true});
const [{ Editor }, { StarterKit }, { Markdown }, { mediaExtensions }] = await Promise.all([import('@tiptap/core'), import('@tiptap/starter-kit'), import('@tiptap/markdown'), import('../src/ui/media-extension')]);
const asset = (ext:string) => `foldnote-asset://media/12345678-1234-1234-1234-123456789abc.${ext}`;
function parse(markdown:string) { return new Editor({ extensions:[StarterKit, Markdown.configure(), ...mediaExtensions()], content:markdown, contentType:'markdown' }); }
test('image, audio and video Markdown survive editor save and reparse with safe rendering', () => {
  const source = `![Photo](${asset('png')})\n\n<audio controls src="${asset('mp3')}"></audio>\n\n<video controls src="${asset('mp4')}"></video>`;
  const first = parse(source);
  const html = first.getHTML();
  assert.match(html, /<img[^>]+src="foldnote-asset:\/\/media\//);
  assert.match(html, /<audio[^>]*controls[^>]*preload="metadata"/);
  assert.match(html, /<video[^>]*controls[^>]*preload="metadata"/);
  assert.doesNotMatch(html, /autoplay/);
  const saved = first.getMarkdown();
  assert.match(saved, /!\[Photo\]/); assert.match(saved, /<audio controls src=/); assert.match(saved, /<video controls src=/);
  const second = parse(saved);
  assert.equal(second.view.dom.querySelectorAll('img,audio,video').length, 3);
  first.destroy(); second.destroy();
});
test('unmanaged image and arbitrary media HTML are not rendered as active media', () => {
  const editor = parse(`![bad](file:///etc/passwd)\n\n<audio controls src="javascript:alert(1)"></audio>\n\n<script>alert(1)</script>`);
  assert.equal(editor.view.dom.querySelector('img[src^="file:"]'), null);
  assert.equal(editor.view.dom.querySelector('audio[src^="javascript:"]'), null);
  assert.equal(editor.view.dom.querySelector('script'), null);
  editor.destroy();
});
test('image alt serialization escapes backslashes, opening brackets and closing brackets', () => {
  const expectedAlt = 'a\\b[c]d]';
  const first = parse('');
  first.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: asset('png'), alt: expectedAlt, title: null } }] }] });
  const firstAlt = first.state.doc.firstChild?.firstChild?.attrs.alt;
  assert.equal(firstAlt, expectedAlt);
  const serialized = first.getMarkdown();
  assert.ok(serialized.includes(`![a\\\\b\\[c\\]d\\]](${asset('png')})`), serialized);
  first.destroy();
});
