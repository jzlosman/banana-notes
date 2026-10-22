import { excerptOf, tagsOf, titleOf, type Note } from '../domain/library';

/** Shared read surface for search results and notebook notes. */
export function renderNoteSummary(note: Note, options: { onOpen?: () => void; current?: boolean; date?: string } = {}): HTMLElement {
  const node = document.createElement(options.onOpen ? 'button' : 'div');
  node.className = `note-row library-row-title${options.current ? ' current' : ''}`;
  if (node instanceof node.ownerDocument.defaultView!.HTMLButtonElement) node.type = 'button';
  const title = titleOf(note.markdown);
  if (options.onOpen) { node.setAttribute('aria-label', `Open ${title}`); node.addEventListener('click', options.onOpen); }
  const top = document.createElement('div'); top.className = 'note-row-top';
  const heading = document.createElement('h2'); heading.textContent = title;
  const date = document.createElement('time'); date.dateTime = options.date ?? note.updatedAt;
  date.textContent = new Date(date.dateTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  top.append(heading, date);
  const excerpt = document.createElement('p'); excerpt.className = 'note-excerpt'; excerpt.textContent = excerptOf(note.markdown);
  const tags = document.createElement('div'); tags.className = 'row-tags';
  tagsOf(note.markdown).slice(0, 4).forEach(tag => { const badge = document.createElement('span'); badge.textContent = `#${tag}`; tags.append(badge); });
  node.append(top, excerpt, tags); return node;
}
