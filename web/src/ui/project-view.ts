import { type Note } from '../domain/library';
import { createElement, Ellipsis, ExternalLink, ScanText } from 'lucide';
import { openActionMenu, type MenuItem } from './action-menu';
import { renderNoteSummary } from './note-summary';
import { projectContent, type ProjectLink, type ProjectMedia, type ProjectTask } from '../domain/project-content';

export interface ProjectViewOptions {
  notes: Note[];
  onOpenNote: (noteID: string) => void;
  onToggleTask: (task: ProjectTask, checked: boolean) => void | Promise<void>;
  onOCR?: (media: ProjectMedia) => void | Promise<void>;
  onOpenMedia?: (media: ProjectMedia) => void | Promise<void>;
  onError?: (error: Error) => void;
  state?: ProjectViewState;
}
export interface ProjectViewState { section: 'notes' | 'tasks' | 'media' | 'links'; filter: 'open' | 'completed' }
export function createProjectViewState(): ProjectViewState { return { section: 'notes', filter: 'open' }; }
type Section = 'notes' | 'tasks' | 'media' | 'links';
type TaskFilter = 'open' | 'completed';
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node;
};
function openButton(title: string, noteID: string, open: (id: string) => void): HTMLButtonElement {
  const button = el('button', 'project-source', title); button.type = 'button'; button.setAttribute('aria-label', `Open note: ${title}`); button.onclick = () => open(noteID); return button;
}
function sourceLine(title: string, noteID: string, open: (id: string) => void): HTMLElement { const row = el('div', 'project-item-source'); row.append(openButton(title, noteID, open)); return row; }

export function renderProjectView(options: ProjectViewOptions): HTMLElement {
  const root = el('section', 'project-view'); root.setAttribute('aria-label', 'Notebook overview');
  const content = projectContent(options.notes);
  const nav = el('div', 'project-tabs'); nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', 'Notebook sections');
  const panel = el('div', 'project-panel quiet-scroll side-scroll'); panel.id = 'project-panel'; panel.setAttribute('role', 'tabpanel');
  const state = options.state ?? createProjectViewState();
  let section: Section = state.section, filter: TaskFilter = state.filter;
  const sections: { id: Section; label: string; count: number }[] = [
    { id: 'notes', label: 'Notes', count: options.notes.length }, { id: 'tasks', label: 'Tasks', count: content.counts.tasks },
    { id: 'media', label: 'Media', count: content.counts.media }, { id: 'links', label: 'Links', count: content.counts.links },
  ];
  const tabButtons = new Map<Section, HTMLButtonElement>();
  for (const item of sections) {
    const tab = el('button', 'project-tab', `${item.label} · ${item.count}`); tab.type = 'button'; tab.id = `project-tab-${item.id}`;
    tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', 'project-panel'); tab.onclick = () => { section = item.id; state.section = section; render(); };
    tabButtons.set(item.id, tab); nav.append(tab);
  }
  for (const [index, tab] of [...tabButtons.values()].entries()) tab.onkeydown = event => {
    let target: number | undefined;
    if (event.key === 'ArrowRight') target = (index + 1) % tabButtons.size;
    else if (event.key === 'ArrowLeft') target = (index + tabButtons.size - 1) % tabButtons.size;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = tabButtons.size - 1;
    if (target !== undefined) { event.preventDefault(); const next = [...tabButtons.values()][target]; next.focus(); next.click(); }
  };
  function render(): void {
    for (const [id, tab] of tabButtons) { const selected = id === section; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1; tab.classList.toggle('is-active', selected); }
    panel.setAttribute('aria-labelledby', `project-tab-${section}`); panel.replaceChildren();
    if (section === 'notes') {
      const sorted = [...options.notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
      const list = el('ul', 'project-list');
      for (const note of sorted) { const li = el('li', 'note-list-entry project-note-entry'); li.append(renderNoteSummary(note, { onOpen: () => options.onOpenNote(note.id) })); list.append(li); }
      if (!sorted.length) panel.append(el('p', 'project-empty', 'No notes in this notebook.'));
      panel.append(list);
    } else if (section === 'tasks') {
      const filters = el('div', 'project-filters');
      for (const f of ['open', 'completed'] as const) { const button = el('button', 'project-filter', `${f === 'open' ? 'Open' : 'Completed'} · ${content.tasks.filter(t => t.checked === (f === 'completed')).length}`); button.type = 'button'; button.setAttribute('aria-pressed', String(filter === f)); button.onclick = () => { filter = f; state.filter = filter; render(); }; filters.append(button); }
      panel.append(filters);
      const tasks = content.tasks.filter(task => task.checked === (filter === 'completed'));
      if (!tasks.length) panel.append(el('p', 'project-empty', filter === 'open' ? 'No open tasks.' : 'No completed tasks.'));
      const list = el('ul', 'project-list');
      for (const task of tasks) {
        const li = el('li', `project-row${task.checked ? ' is-complete' : ''}`), label = el('label', 'project-task');
        const checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.checked = task.checked; checkbox.setAttribute('aria-label', `${task.checked ? 'Mark incomplete' : 'Complete'}: ${task.label}`);
        checkbox.onchange = async () => {
          const previous = task.checked;
          checkbox.disabled = true;
          try { await options.onToggleTask(task, checkbox.checked); }
          catch (cause) { checkbox.checked = previous; options.onError?.(cause instanceof Error ? cause : new Error(String(cause))); }
          finally { checkbox.disabled = false; }
        };
        label.append(checkbox, el('span', 'project-task-label', task.label)); li.append(label, sourceLine(task.noteTitle, task.noteID, options.onOpenNote)); list.append(li);
      }
      panel.append(list);
    } else if (section === 'media') {
      if (!content.media.length) panel.append(el('p', 'project-empty', 'No media.'));
      const list = el('ul', 'project-list');
      for (const media of content.media) {
        const li = el('li', 'project-row project-media-row');
        if (media.kind === 'image') { const image = el('img', 'project-image'); image.src = media.url; image.alt = media.label; image.loading = 'lazy'; li.append(image); }
        else { const control = el(media.kind, 'project-player'); control.controls = true; control.preload = 'none'; control.src = media.url; li.append(control); }
        const details = el('div', 'project-item-details'); details.append(el('span', 'project-item-label', media.label), sourceLine(media.noteTitle, media.noteID, options.onOpenNote));
        li.append(details);
        const actions: MenuItem[] = [];
        if (options.onOpenMedia) actions.push({ label: 'Open file', icon: ExternalLink, run: () => options.onOpenMedia!(media) });
        if (options.onOCR && media.kind === 'image') actions.push({ label: 'Recognize text', icon: ScanText, run: () => options.onOCR!(media) });
        if (actions.length) {
          const more = el('button', 'icon-button row-more'); more.type = 'button'; more.title = 'Media actions'; more.setAttribute('aria-label', `Actions for ${media.label}`); more.setAttribute('aria-haspopup', 'menu');
          more.append(createElement([Ellipsis[0], { ...Ellipsis[1], width: 15, height: 15, 'stroke-width': 1.7, 'aria-hidden': 'true' }, Ellipsis[2]]));
          const open = (point?: { x: number; y: number }) => openActionMenu(more, actions, { label: 'Media actions', point, onError: error => options.onError?.(error instanceof Error ? error : new Error(String(error))) });
          more.onclick = () => open(); li.oncontextmenu = event => { if ((event.target as HTMLElement).closest('audio,video')) return; event.preventDefault(); open({ x: event.clientX, y: event.clientY }); }; li.append(more);
        }
        list.append(li);
      }
      panel.append(list);
    } else {
      if (!content.links.length) panel.append(el('p', 'project-empty', 'No links.'));
      const list = el('ul', 'project-list');
      for (const link of content.links) { const li = el('li', 'project-row'); li.append(linkRow(link, options.onOpenNote)); list.append(li); }
      panel.append(list);
    }
  }
  root.append(nav, panel); render(); return root;
}
function linkRow(link: ProjectLink, open: (id: string) => void): HTMLElement {
  const row = el('div', 'project-link-row'), label = el('span', 'project-item-label', link.label);
  row.append(label);
  if (link.safe) { const anchor = el('a', 'project-external', link.url); anchor.href = link.url; anchor.rel = 'noopener noreferrer'; anchor.target = '_blank'; anchor.setAttribute('aria-label', `Open external link: ${link.label}`); row.append(anchor); }
  row.append(sourceLine(link.noteTitle, link.noteID, open)); return row;
}
