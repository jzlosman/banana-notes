import { excerptOf, noteTaskProgress, tagsOf, titleOf, type Note } from '../domain/library';

/** Shared read surface for search results and notebook notes. */
export function renderNoteSummary(note: Note, options: { onOpen?: () => void; current?: boolean; date?: string; showTags?: boolean; explorer?: boolean } = {}): HTMLElement {
  const node = document.createElement(options.onOpen ? 'button' : 'div');
  node.className = `note-row library-row-title${options.current ? ' current' : ''}${options.explorer ? ' explorer-summary' : ''}`;
  if (node instanceof node.ownerDocument.defaultView!.HTMLButtonElement) node.type = 'button';
  const title = titleOf(note.markdown);
  const progress = options.explorer ? noteTaskProgress(note.markdown) : null;
  if (options.onOpen) { node.setAttribute('aria-label', `Open ${title || 'Untitled note'}`); node.addEventListener('click', options.onOpen); }
  const top = document.createElement('div'); top.className = 'note-row-top';
  if (options.explorer) {
    if (progress) {
      const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); ring.setAttribute('viewBox', '0 0 16 16'); ring.setAttribute('aria-hidden', 'true'); ring.classList.add('note-task-ring');
      const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); track.setAttribute('cx', '8'); track.setAttribute('cy', '8'); track.setAttribute('r', '6'); track.classList.add('note-task-track'); ring.append(track);
      if (progress.done) {
        const arc = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); arc.setAttribute('cx', '8'); arc.setAttribute('cy', '8'); arc.setAttribute('r', '6'); arc.setAttribute('transform', 'rotate(-90 8 8)'); arc.setAttribute('stroke-dasharray', `${(2 * Math.PI * 6 * progress.done) / progress.total} ${2 * Math.PI * 6}`); arc.classList.add('note-task-progress'); ring.append(arc);
      }
      top.append(ring);
    }
  }
  const heading = document.createElement('h2'); heading.textContent = title || 'Untitled note'; top.append(heading);
  const time = document.createElement('time'); time.dateTime = options.date ?? note.updatedAt;
  time.textContent = options.explorer
    ? new Date(time.dateTime).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : new Date(time.dateTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  top.append(time);
  const bottom = document.createElement('div'); bottom.className = 'note-row-bottom';
  const excerpt = document.createElement('p'); excerpt.className = 'note-excerpt';
  excerpt.textContent = `${progress ? `${progress.done} of ${progress.total} done · ` : ''}${excerptOf(note.markdown)}`;
  bottom.append(excerpt);
  if (options.showTags !== false) {
    const tags = document.createElement('div'); tags.className = 'row-tags';
    const allTags = tagsOf(note.markdown);
    const displayedTags = options.explorer && allTags.length > 2
      ? [...allTags.slice(0, 2).map(tag => `#${tag}`), `+${allTags.length - 2}`]
      : allTags.slice(0, 4).map(tag => `#${tag}`);
    tags.textContent = displayedTags.join('  ');
    bottom.append(tags);
  }
  node.append(top, bottom); return node;
}
