import { BookOpen, ChevronDown } from 'lucide';
import { renderIcon } from './icon';
import { openActionMenu, type MenuItem } from './action-menu';
import { installTagPinMenu } from './tag-pin-menu';

export interface ScopeBarController { update(options: ScopeBarOptions): void; dispose(): void }
const el = <K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className = '', text?: string): HTMLElementTagNameMap[K] => {
  const node = doc.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node;
};
const icon = (doc: Document, node: Parameters<typeof renderIcon>[0], size = 13): SVGElement => renderIcon(node, size);
const GAP = 5;
export interface ScopeBarOptions {
  pinnedTags: readonly string[];
  activeTags: readonly string[];
  inTrash: boolean;
  onAll(active: boolean): void;
  onTag(tag: string, active: boolean): void;
  onClear(): void;
  onTogglePin(tag: string): void;
  onMovePin(tag: string, delta: number): void;
  isPinned(tag: string): boolean;
  onError(error: unknown): void;
}

/** Responsive top-bar scope controls; hidden pins remain available through one menu. */
export function createScopeBar(root: HTMLElement, initial: ScopeBarOptions): ScopeBarController {
  const doc = root.ownerDocument;
  root.className = 'toolbar-context scope-navigation'; root.setAttribute('role', 'group'); root.setAttribute('aria-label', 'Note scopes');
  const all = el(doc, 'button', 'scope-button'); all.type = 'button'; all.append(icon(doc, BookOpen, 15));
  const allLabel = el(doc, 'span', 'scope-label'); all.append(allLabel);
  const row = el(doc, 'div', 'scope-pin-row');
  const measure = el(doc, 'div', 'scope-measure'); measure.setAttribute('aria-hidden', 'true'); measure.inert = true;
  root.replaceChildren(all, row, measure);
  let options = initial;
  let visibleCount = 0;
  let suppressClick = false;
  let drag: { tag: string; pointerId: number; x: number; y: number; moved: boolean; target: string | null } | undefined;
  let disposed = false;
  let measureFrame = 0;
  const allClick = () => {
    if (suppressClick) { suppressClick = false; return; }
    options.onAll(options.activeTags.length === 0);
  };
  all.addEventListener('click', allClick);

  const setDragTarget = (tag: string | null) => {
    row.querySelectorAll<HTMLElement>('[data-pin-tag]').forEach(chip => chip.classList.toggle('drag-over', chip.dataset.pinTag === tag && tag !== drag?.tag));
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !event.isPrimary) return;
    const target = (event.target as Element | null)?.closest<HTMLElement>('[data-pin-tag]');
    if (!target || !root.contains(target)) return;
    drag = { tag: target.dataset.pinTag!, pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false, target: null };
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
    drag.moved = true;
    const target = doc.elementFromPoint?.(event.clientX, event.clientY)?.closest<HTMLElement>('[data-pin-tag]');
    drag.target = target && root.contains(target) ? target.dataset.pinTag ?? null : null;
    [...row.querySelectorAll<HTMLElement>('[data-pin-tag]')].find(chip => chip.dataset.pinTag === drag?.tag)?.classList.add('dragging');
    setDragTarget(drag.target);
    event.preventDefault();
  };
  const onPointerUp = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const completed = drag; drag = undefined; setDragTarget(null);
    row.querySelectorAll('.dragging').forEach(chip => chip.classList.remove('dragging'));
    if (!completed.moved) return;
    event.preventDefault(); suppressClick = true;
    doc.defaultView?.setTimeout(() => { suppressClick = false; }, 0);
    if (completed.target && completed.target !== completed.tag) {
      const from = options.pinnedTags.indexOf(completed.tag), to = options.pinnedTags.indexOf(completed.target);
      if (from >= 0 && to >= 0) options.onMovePin(completed.tag, to - from);
    }
  };
  root.addEventListener('pointerdown', onPointerDown);
  doc.addEventListener('pointermove', onPointerMove);
  doc.addEventListener('pointerup', onPointerUp);
  doc.addEventListener('pointercancel', onPointerUp);

  const onResize = () => scheduleMeasure();
  const ResizeObserverType = doc.defaultView?.ResizeObserver;
  const observer = ResizeObserverType ? new ResizeObserverType(onResize) : undefined;
  observer?.observe(root);
  doc.defaultView?.addEventListener('resize', onResize);

  function pinItems(): MenuItem[] {
    return options.pinnedTags.map((tag, index) => ({
      label: `#${tag}`, checked: options.activeTags.length === 1 && options.activeTags[0] === tag,
      ...(index < 8 ? { shortcut: `⌘${index + 2}` } : {}),
      run: () => options.onTag(tag, options.activeTags.length === 1 && options.activeTags[0] === tag),
    }));
  }
  function contextMenu(chip: HTMLButtonElement, tag: string, index: number) {
    chip.setAttribute('aria-haspopup', 'menu'); chip.setAttribute('aria-keyshortcuts', index < 8 ? `Meta+${index + 2} Shift+F10` : 'Shift+F10');
    const open = (point?: { x: number; y: number }) => openActionMenu(chip, [
      { label: 'Unpin from top bar', run: () => options.onTogglePin(tag) },
      { separator: true },
      { label: 'Move left', disabled: index === 0, run: () => options.onMovePin(tag, -1) },
      { label: 'Move right', disabled: index === options.pinnedTags.length - 1, run: () => options.onMovePin(tag, 1) },
    ], { label: `#${tag} pin actions`, point, onError: options.onError });
    chip.addEventListener('contextmenu', event => {
      event.preventDefault(); event.stopPropagation();
      open(event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : undefined);
    });
    chip.addEventListener('keydown', event => {
      if (!(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) return;
      event.preventDefault(); event.stopPropagation(); open();
    });
  }
  function createPin(tag: string, index: number): HTMLButtonElement {
    const active = options.activeTags.length === 1 && options.activeTags[0] === tag;
    const chip = el(doc, 'button', `scope-chip${active ? ' active' : ''}`, `#${tag}`); chip.type = 'button';
    chip.dataset.pinTag = tag; chip.setAttribute('aria-label', `#${tag}${active ? ', active scope' : ''}`);
    chip.setAttribute('aria-pressed', String(active));
    if (index < 8) chip.setAttribute('aria-keyshortcuts', `Meta+${index + 2}`);
    chip.title = `#${tag}${index < 8 ? ` · ⌘${index + 2}` : ''} · right-click for pin options`;
    chip.onclick = () => {
      if (suppressClick) { suppressClick = false; return; }
      options.onTag(tag, active);
    };
    contextMenu(chip, tag, index);
    return chip;
  }
  function createActiveTag(tag: string): HTMLElement {
    const group = el(doc, 'span', 'scope-active-tag');
    const chip = el(doc, 'button', 'scope-chip active', `#${tag}`); chip.type = 'button';
    chip.setAttribute('aria-label', `#${tag}, active filter`); chip.setAttribute('aria-pressed', 'true');
    chip.title = `#${tag} · right-click to pin`;
    chip.onclick = () => options.onTag(tag, options.activeTags.length === 1 && options.activeTags[0] === tag);
    chip.setAttribute('aria-keyshortcuts', 'Shift+F10');
    const clear = el(doc, 'button', 'scope-clear', '×'); clear.type = 'button'; clear.title = 'Show all notes'; clear.setAttribute('aria-label', `Clear #${tag} scope`);
    clear.onclick = options.onClear;
    group.append(chip, clear);
    // The tag chip and close control are separate buttons with independent behavior.
    installTagPinMenu(chip, tag, { isPinned: options.isPinned, togglePin: options.onTogglePin, onError: options.onError });
    return group;
  }
  function render() {
    allLabel.textContent = options.inTrash ? 'Trash' : options.pinnedTags.length ? 'All' : 'All notes';
    all.setAttribute('aria-label', options.inTrash ? 'Show notes' : options.activeTags.length ? 'Show all notes' : 'All notes');
    const activeAll = !options.inTrash && options.activeTags.length === 0;
    all.classList.toggle('active', activeAll);
    all.setAttribute('aria-pressed', String(activeAll));
    if (options.inTrash) all.removeAttribute('aria-keyshortcuts'); else all.setAttribute('aria-keyshortcuts', 'Meta+1');
    all.title = options.inTrash ? 'Show notes' : `${options.pinnedTags.length ? 'All' : 'All notes'} · ⌘1`;
    row.hidden = options.inTrash;
    row.replaceChildren();
    for (const [index, tag] of options.pinnedTags.slice(0, visibleCount).entries()) row.append(createPin(tag, index));
    const hiddenTags = options.pinnedTags.slice(visibleCount);
    if (hiddenTags.length) {
      const more = el(doc, 'button', `scope-overflow${hiddenTags.some(tag => options.activeTags.length === 1 && options.activeTags[0] === tag) ? ' active' : ''}`);
      more.type = 'button'; more.setAttribute('aria-haspopup', 'menu'); more.dataset.hiddenCount = String(hiddenTags.length);
      const activeHidden = hiddenTags.find(tag => options.activeTags.length === 1 && options.activeTags[0] === tag);
      more.setAttribute('aria-label', `${hiddenTags.length} more pinned ${hiddenTags.length === 1 ? 'tag' : 'tags'}${activeHidden ? `; #${activeHidden} is active` : ''}`);
      more.append(doc.createTextNode(`+${hiddenTags.length}`), icon(doc, ChevronDown, 12));
      more.onclick = () => openActionMenu(more, pinItems().filter((_, index) => index >= visibleCount), { label: 'Hidden pinned tags', onError: options.onError });
      row.append(more);
    }
    const pinned = new Set(options.pinnedTags);
    options.activeTags.filter(tag => !pinned.has(tag)).forEach(tag => row.append(createActiveTag(tag)));
    measure.replaceChildren();
    options.pinnedTags.forEach(tag => measure.append(el(doc, 'button', 'scope-chip', `#${tag}`)));
    const activeUnpinned = options.activeTags.filter(tag => !pinned.has(tag));
    activeUnpinned.forEach(tag => {
      const group = el(doc, 'span', 'scope-active-tag scope-active-measure');
      group.append(el(doc, 'button', 'scope-chip active', `#${tag}`), el(doc, 'button', 'scope-clear', '×')); measure.append(group);
    });
    root.dataset.pinCount = String(options.pinnedTags.length);
    scheduleMeasure();
  }
  function measureWidths() {
    const chips = [...measure.querySelectorAll<HTMLElement>('.scope-chip')];
    const pinWidths = chips.slice(0, options.pinnedTags.length).map(chip => chip.getBoundingClientRect().width);
    const activeWidths = [...measure.querySelectorAll<HTMLElement>('.scope-active-measure')].map(chip => chip.getBoundingClientRect().width);
    const width = root.getBoundingClientRect().width || root.clientWidth;
    if (width <= 0) { visibleCount = options.pinnedTags.length; return; }
    const fixedWidth = all.getBoundingClientRect().width + GAP;
    let chosen = 0;
    for (let count = options.pinnedTags.length; count >= 0; count--) {
      const hidden = options.pinnedTags.length - count;
      let contents = pinWidths.slice(0, count).reduce((sum, value) => sum + value, 0);
      let items = count;
      if (hidden) {
        const candidate = el(doc, 'button', 'scope-overflow'); candidate.type = 'button';
        candidate.append(doc.createTextNode(`+${hidden}`), icon(doc, ChevronDown, 12)); measure.append(candidate);
        contents += candidate.getBoundingClientRect().width; measure.removeChild(candidate); items++;
      }
      contents += activeWidths.reduce((sum, value) => sum + value, 0); items += activeWidths.length;
      if (items > 1) contents += GAP * (items - 1);
      if (fixedWidth + contents <= width + 0.5) { chosen = count; break; }
    }
    visibleCount = chosen;
  }
  function scheduleMeasure() {
    if (disposed || measureFrame) return;
    const raf = doc.defaultView?.requestAnimationFrame;
    if (raf) measureFrame = raf(() => { measureFrame = 0; measureWidths(); renderVisible(); });
    else { measureWidths(); renderVisible(); }
  }
  function renderVisible() {
    if (disposed) return;
    // Avoid rebuilding when only a measurement ran; render() owns current controls.
    const currentCount = row.querySelectorAll('[data-pin-tag]').length;
    const hiddenCount = Number(row.querySelector<HTMLElement>('.scope-overflow')?.dataset.hiddenCount ?? 0);
    const currentActive = row.querySelectorAll('.scope-active-tag').length;
    const desiredHidden = options.pinnedTags.length - visibleCount;
    const desiredActive = options.inTrash ? 0 : options.activeTags.filter(tag => !options.pinnedTags.includes(tag)).length;
    if (currentCount === visibleCount && hiddenCount === desiredHidden && currentActive === desiredActive) return;
    render();
  }
  render();
  return {
    update(next) { options = next; visibleCount = Math.min(visibleCount, options.pinnedTags.length); render(); },
    dispose() {
      disposed = true; observer?.disconnect(); doc.defaultView?.removeEventListener('resize', onResize);
      root.removeEventListener('pointerdown', onPointerDown); doc.removeEventListener('pointermove', onPointerMove);
      doc.removeEventListener('pointerup', onPointerUp); doc.removeEventListener('pointercancel', onPointerUp);
      root.replaceChildren();
    },
  };
}
