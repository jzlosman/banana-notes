export interface NoteTagControlActions {
  onOverview(tag: string): void;
  onRemove(tag: string): void;
}

/** Render independent, keyboard-reachable overview and removal actions for each note tag. */
export function renderNoteTagControls(root: HTMLElement, tags: readonly string[], actions: NoteTagControlActions): void {
  root.replaceChildren();
  for (const tag of tags) {
    const group = root.ownerDocument.createElement('span');
    group.className = 'tag-badge-group';

    const overview = root.ownerDocument.createElement('button');
    overview.type = 'button'; overview.className = 'tag-badge';
    overview.setAttribute('aria-label', `Open #${tag} notebook overview`);
    overview.title = `Open #${tag} notebook overview`;
    overview.textContent = `#${tag}`;
    overview.addEventListener('click', () => actions.onOverview(tag));

    const remove = root.ownerDocument.createElement('button');
    remove.type = 'button'; remove.className = 'tag-remove';
    remove.setAttribute('aria-label', `Remove tag ${tag}`);
    remove.title = `Remove tag ${tag}`;
    remove.textContent = '×';
    remove.addEventListener('click', () => actions.onRemove(tag));

    group.append(overview, remove);
    root.append(group);
  }
}
