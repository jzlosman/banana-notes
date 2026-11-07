import './tag-picker.css';
import { Plus, X } from 'lucide';
import type { TagCatalogEntry } from '../domain/queries';
import { LIMITS, normalizeTags } from '../domain/model';
import { renderIcon } from '../../ui/icon';
import { makeElement } from './helpers';

export interface MountedTagPicker {
  element: HTMLDivElement;
  input: HTMLInputElement;
  selectedTags(): string[];
  draftTags(): string[];
  setTags(tags: readonly string[]): void;
  setCatalog(catalog: readonly TagCatalogEntry[]): void;
  setDisabled(disabled: boolean): void;
  commitPending(): boolean;
  dispose(): void;
}

export interface TagPickerOptions {
  catalog: readonly TagCatalogEntry[];
  onChange(): void;
  onDuplicate(label: string): void;
  onInvalid(message: string): void;
  onLeave(): void;
}

type PickerOption = {
  key: string;
  label: string;
  count: number | null;
  create: boolean;
  disabled: boolean;
  reason: string | null;
};

type PickerGroup = { heading: string; options: PickerOption[] };

let pickerSequence = 0;

function canonicalTag(value: string): string | null {
  return normalizeTags([value])?.[0] ?? null;
}

function tagKey(value: string): string {
  return value.trim().normalize('NFC').replace(/\s+/g, ' ').toLowerCase();
}

function normalizedQuery(value: string): string {
  return value.trim().normalize('NFC').replace(/\s+/g, ' ').toLowerCase();
}

function validateNewTag(value: string): { label: string | null; reason: string | null } {
  const label = canonicalTag(value);
  if (label) return { label, reason: null };
  if (value.trim().length > LIMITS.tag) return { label: null, reason: `Tags can be up to ${LIMITS.tag} characters.` };
  if (/[\u0000-\u001f\u007f]/.test(value)) return { label: null, reason: 'Tags cannot contain control characters.' };
  return { label: null, reason: 'Enter a tag to create it.' };
}

function rankMatches(catalog: readonly TagCatalogEntry[], query: string, selected: Set<string>): TagCatalogEntry[] {
  const tiers: TagCatalogEntry[][] = [[], [], [], []];
  for (const entry of catalog) {
    if (selected.has(entry.key)) continue;
    const label = normalizedQuery(entry.label);
    if (label === query) tiers[0].push(entry);
    else if (label.startsWith(query)) tiers[1].push(entry);
    else if (label.split(/\s+/).some(word => word.startsWith(query))) tiers[2].push(entry);
    else if (label.includes(query)) tiers[3].push(entry);
  }
  return tiers.flat().slice(0, 6);
}

export function mountTaskTagPicker(document: Document, options: TagPickerOptions): MountedTagPicker {
  const instanceID = `tasks-tag-picker-${++pickerSequence}`;
  const wrapper = makeElement(document, 'div', 'tasks-detail-tags-label');
  const label = makeElement(document, 'label', 'tasks-tag-picker-label', 'Tags');
  label.htmlFor = `${instanceID}-input`;
  label.id = `${instanceID}-label`;
  const field = makeElement(document, 'div', 'tasks-detail-tags');
  field.setAttribute('role', 'group');
  field.setAttribute('aria-labelledby', label.id);
  const chips = makeElement(document, 'div', 'tasks-tag-picker-chips');
  const input = makeElement(document, 'input', 'tasks-tag-picker-input');
  input.type = 'text';
  input.id = `${instanceID}-input`;
  input.placeholder = 'Add a tag';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-labelledby', label.id);
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-haspopup', 'listbox');
  input.setAttribute('aria-expanded', 'false');
  const listboxID = `${instanceID}-listbox`;
  input.setAttribute('aria-controls', listboxID);
  field.append(chips, input);
  wrapper.append(label, field);

  const listbox = makeElement(document, 'div', 'tasks-tag-picker-listbox quiet-scroll');
  listbox.id = listboxID;
  listbox.setAttribute('role', 'listbox');
  listbox.setAttribute('aria-label', 'Tag suggestions');
  listbox.hidden = true;
  document.body.append(listbox);

  let selected: string[] = [];
  let catalog = [...options.catalog];
  let open = false;
  let manuallyDisabled = false;
  let activeKey: string | null = null;
  let renderedOptions: Array<PickerOption & { id: string }> = [];
  let disposed = false;

  function selectedKeys(): Set<string> { return new Set(selected.map(tagKey)); }
  function updateDisabledState(): void {
    input.disabled = manuallyDisabled;
    input.readOnly = selected.length >= LIMITS.tags;
    input.placeholder = selected.length >= LIMITS.tags ? `${LIMITS.tags} tag limit reached` : 'Add a tag';
  }
  function renderChips(): void {
    const focusedRemove = document.activeElement instanceof document.defaultView!.HTMLElement &&
      document.activeElement.classList.contains('tasks-tag-remove')
      ? document.activeElement.title : null;
    if (focusedRemove !== null) {
      updateDisabledState();
      input.focus();
    }
    const nodes = selected.map((tag, index) => {
      const chip = makeElement(document, 'span', 'tasks-tag tasks-tag-chip');
      chip.title = tag;
      const text = makeElement(document, 'span', 'tasks-tag-chip-label', tag);
      const remove = makeElement(document, 'button', 'tasks-tag-remove');
      remove.type = 'button';
      remove.disabled = manuallyDisabled;
      remove.setAttribute('aria-label', `Remove tag ${tag}`);
      remove.title = `Remove tag ${tag}`;
      remove.append(renderIcon(X, 12));
      remove.querySelector('svg')?.classList.add('tasks-tag-remove-icon');
      remove.addEventListener('click', () => removeTag(index));
      chip.append(text, remove);
      return chip;
    });
    chips.replaceChildren(...nodes);
    updateDisabledState();
    if (focusedRemove !== null) {
      const replacement = [...chips.querySelectorAll<HTMLButtonElement>('.tasks-tag-remove')]
        .find(button => button.title === focusedRemove && !button.disabled);
      (replacement ?? input).focus();
    }
  }

  function positionListbox(): void {
    if (listbox.hidden || disposed) return;
    const rect = field.getBoundingClientRect();
    const view = document.defaultView;
    const width = view?.innerWidth || document.documentElement.clientWidth || 320;
    const height = view?.innerHeight || document.documentElement.clientHeight || 600;
    const popupWidth = Math.max(0, Math.min(320, rect.width, width - 16));
    const left = Math.max(8, Math.min(rect.left, width - popupWidth - 8));
    listbox.style.width = `${popupWidth}px`;
    listbox.style.left = `${left}px`;
    listbox.style.right = 'auto';
    listbox.style.top = 'auto';
    listbox.style.bottom = 'auto';
    const below = Math.max(0, height - rect.bottom);
    const above = Math.max(0, rect.top);
    if (below < 160 && above >= 24) {
      listbox.style.bottom = `${Math.max(8, height - rect.top + 4)}px`;
      listbox.style.maxHeight = `${Math.max(0, Math.min(280, above - 12))}px`;
      listbox.dataset.placement = 'above';
    } else {
      listbox.style.top = `${Math.max(8, rect.bottom + 4)}px`;
      listbox.style.maxHeight = `${Math.max(0, Math.min(280, below - 12))}px`;
      listbox.dataset.placement = 'below';
    }
  }

  function close(): void {
    open = false;
    activeKey = null;
    listbox.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function emptyGroups(): PickerGroup[] {
    const selectedSet = selectedKeys();
    const popular = catalog.filter(entry => !selectedSet.has(entry.key)).slice(0, 5);
    const popularKeys = new Set(popular.map(entry => entry.key));
    const recent = [...catalog]
      .filter(entry => !selectedSet.has(entry.key) && !popularKeys.has(entry.key))
      .sort((left, right) => right.lastTaskActivityAt - left.lastTaskActivityAt || catalog.indexOf(left) - catalog.indexOf(right))
      .slice(0, 3);
    return [
      { heading: 'Most used', options: popular.map(entry => ({ key: `tag:${entry.key}`, label: entry.label, count: entry.taskCount, create: false, disabled: false, reason: null })) },
      { heading: 'From recent tasks', options: recent.map(entry => ({ key: `tag:${entry.key}`, label: entry.label, count: entry.taskCount, create: false, disabled: false, reason: null })) },
    ].filter(group => group.options.length > 0);
  }

  function typedOptions(query: string): PickerGroup[] {
    const queryKey = normalizedQuery(query);
    const matches = rankMatches(catalog, queryKey, selectedKeys());
    const exactMatch = catalog.some(entry => normalizedQuery(entry.label) === queryKey) ||
      selected.some(tag => tagKey(tag) === queryKey);
    const optionsForMatches: PickerOption[] = matches.map(entry => ({
      key: `tag:${entry.key}`, label: entry.label, count: entry.taskCount, create: false, disabled: false, reason: null,
    }));
    if (!exactMatch) {
      const validation = validateNewTag(query);
      const atLimit = selected.length >= LIMITS.tags;
      optionsForMatches.push({
        key: 'create-action', label: `Create “${query.trim()}”`, count: null, create: true,
        disabled: !validation.label || atLimit,
        reason: atLimit ? `${LIMITS.tags} tag limit reached` : validation.reason,
      });
    }
    return optionsForMatches.length ? [{ heading: '', options: optionsForMatches }] : [];
  }

  function appendOption(groupNode: HTMLElement, option: PickerOption, index: number): void {
    const id = `${instanceID}-option-${index}`;
    const row = makeElement(document, 'div', 'tasks-tag-picker-option');
    row.id = id;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(option.key === activeKey));
    if (option.disabled) row.setAttribute('aria-disabled', 'true');
    const labelNode = makeElement(document, 'span', 'tasks-tag-picker-option-label', option.label);
    row.append(labelNode);
    if (option.create) {
      const plus = renderIcon(Plus, 14);
      plus.classList.add('tasks-tag-picker-create-icon');
      row.prepend(plus);
    } else if (option.count !== null) {
      const count = makeElement(document, 'span', 'tasks-tag-picker-option-count', `${option.count} ${option.count === 1 ? 'task' : 'tasks'}`);
      row.append(count);
    }
    if (option.reason) {
      const reason = makeElement(document, 'span', 'tasks-tag-picker-option-reason', option.reason);
      row.append(reason);
      row.setAttribute('aria-label', `${option.label}. ${option.reason}`);
    }
    if (option.key === activeKey) row.classList.add('is-active');
    row.addEventListener('pointerdown', event => event.preventDefault());
    row.addEventListener('mousedown', event => event.preventDefault());
    row.addEventListener('click', () => {
      if (option.disabled) return;
      if (option.create) addTag(input.value);
      else addTag(option.label);
    });
    renderedOptions.push({ ...option, id });
    groupNode.append(row);
  }

  function renderPopup(preferFirst = false): void {
    if (!open || disposed) {
      close();
      return;
    }
    const query = input.value;
    if (!query.trim() && catalog.length === 0) {
      close();
      return;
    }
    const groups = query.trim() ? typedOptions(query) : emptyGroups();
    if (!groups.length) {
      close();
      return;
    }
    const previousActiveKey = activeKey;
    listbox.replaceChildren();
    renderedOptions = [];
    let index = 0;
    for (const [groupIndex, group] of groups.entries()) {
      if (groupIndex > 0) {
        const separator = makeElement(document, 'div', 'tasks-tag-picker-separator');
        separator.setAttribute('role', 'separator');
        separator.setAttribute('aria-orientation', 'horizontal');
        listbox.append(separator);
      }
      const groupNode = makeElement(document, group.heading ? 'section' : 'div', 'tasks-tag-picker-group');
      groupNode.setAttribute('role', 'group');
      if (group.heading) {
        const heading = makeElement(document, 'h3', 'tasks-tag-picker-heading', group.heading);
        heading.id = `${instanceID}-heading-${groupIndex}`;
        groupNode.setAttribute('aria-labelledby', heading.id);
        groupNode.append(heading);
      }
      for (const option of group.options) appendOption(groupNode, option, index++);
      listbox.append(groupNode);
    }
    if (preferFirst) {
      const exactSelected = selected.some(tag => tagKey(tag) === normalizedQuery(query));
      activeKey = exactSelected ? null : renderedOptions.find(option => !option.disabled)?.key ?? null;
    }
    else if (!renderedOptions.some(option => option.key === previousActiveKey && !option.disabled)) activeKey = null;
    listbox.querySelectorAll<HTMLElement>('[role="option"]').forEach(node => {
      const active = renderedOptions.find(option => option.id === node.id)?.key === activeKey;
      node.setAttribute('aria-selected', String(active));
      node.classList.toggle('is-active', active);
    });
    const active = renderedOptions.find(option => option.key === activeKey && !option.disabled);
    if (active) input.setAttribute('aria-activedescendant', active.id);
    else input.removeAttribute('aria-activedescendant');
    listbox.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    positionListbox();
    if (active) {
      const row = document.getElementById(active.id);
      if (row) {
        const bounds = listbox.getBoundingClientRect();
        const top = bounds.top + listbox.clientTop;
        const bottom = top + listbox.clientHeight;
        const optionBounds = row.getBoundingClientRect();
        if (optionBounds.top < top) listbox.scrollTop -= top - optionBounds.top;
        else if (optionBounds.bottom > bottom) listbox.scrollTop += optionBounds.bottom - bottom;
      }
    }
  }

  function openPopup(preferFirst = false): void {
    if (manuallyDisabled || selected.length >= LIMITS.tags) { close(); return; }
    open = true;
    renderPopup(preferFirst);
  }

  function addTag(value: string, keepFocus = true): boolean {
    const candidate = catalog.find(entry => tagKey(entry.label) === tagKey(value))?.label ?? canonicalTag(value);
    if (!candidate) {
      const validation = validateNewTag(value);
      options.onInvalid(validation.reason ?? 'Enter a valid tag.');
      return false;
    }
    const duplicate = selected.find(tag => tagKey(tag) === tagKey(candidate));
    if (duplicate) {
      input.value = '';
      options.onChange();
      options.onDuplicate(`${duplicate} is already added.`);
      openPopup(false);
      if (keepFocus) input.focus();
      return true;
    }
    const normalized = normalizeTags([...selected, candidate]);
    if (!normalized) {
      options.onInvalid(selected.length >= LIMITS.tags ? `${LIMITS.tags} tag limit reached` : `Tags can be up to ${LIMITS.tag} characters.`);
      return false;
    }
    selected = normalized;
    input.value = '';
    activeKey = null;
    renderChips();
    options.onChange();
    openPopup(false);
    if (keepFocus) input.focus();
    return true;
  }

  function removeTag(index: number): void {
    if (index < 0 || index >= selected.length) return;
    selected = selected.filter((_, candidateIndex) => candidateIndex !== index);
    activeKey = null;
    renderChips();
    options.onChange();
    openPopup(false);
    input.focus();
  }

  function commitPending(): boolean {
    const query = input.value;
    if (!query.trim()) {
      if (query) {
        input.value = '';
        options.onChange();
      }
      close();
      return true;
    }
    const didAdd = addTag(query, false);
    if (didAdd) close();
    return didAdd;
  }

  function onInput(): void {
    activeKey = null;
    options.onChange();
    openPopup(!!input.value.trim());
  }

  function onInputClick(): void { openPopup(!!input.value.trim()); }

  function moveActive(direction: -1 | 1): void {
    const enabled = renderedOptions.filter(option => !option.disabled);
    if (!enabled.length) return;
    const index = enabled.findIndex(option => option.key === activeKey);
    const next = index < 0 ? (direction > 0 ? 0 : enabled.length - 1) : index + direction;
    if (next < 0 || next >= enabled.length) return;
    activeKey = enabled[next].key;
    renderPopup();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        openPopup(!!input.value.trim());
        if (input.value.trim()) return;
      }
      moveActive(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'ArrowLeft' && input.selectionStart === 0 && selected.length > 0) {
      event.preventDefault();
      const removeButtons = chips.querySelectorAll<HTMLButtonElement>('.tasks-tag-remove');
      removeButtons.item(removeButtons.length - 1)?.focus();
      return;
    }
    if (event.key === 'Backspace' && input.value === '' && selected.length > 0) {
      event.preventDefault();
      removeTag(selected.length - 1);
      return;
    }
    if (event.key === 'Escape') {
      if (open) {
        close();
        event.preventDefault();
        event.stopPropagation();
      } else if (input.value) {
        input.value = '';
        activeKey = null;
        options.onChange();
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (event.key === ',') {
      event.preventDefault();
      if (input.value.trim()) commitPending();
      return;
    }
    if (event.key === 'Enter') {
      if (!open && !input.value.trim()) return;
      event.preventDefault();
      const active = renderedOptions.find(option => option.key === activeKey && !option.disabled);
      if (active?.create) addTag(input.value);
      else if (active) addTag(active.label);
      else if (input.value.trim()) commitPending();
    }
  }

  function onFieldFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof document.defaultView!.Node && (field.contains(next) || listbox.contains(next))) return;
    close();
    options.onLeave();
  }

  function onOutsidePointer(event: Event): void {
    const target = event.target;
    if (target instanceof document.defaultView!.Node && (field.contains(target) || listbox.contains(target))) return;
    close();
  }

  const reposition = (): void => positionListbox();
  input.addEventListener('click', onInputClick);
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKeyDown);
  field.addEventListener('focusout', onFieldFocusOut);
  document.addEventListener('pointerdown', onOutsidePointer, true);
  document.defaultView?.addEventListener('resize', reposition);
  document.defaultView?.addEventListener('scroll', reposition, true);

  return {
    element: wrapper,
    input,
    selectedTags: () => [...selected],
    draftTags: () => [...selected, ...(input.value.trim() ? [input.value] : [])],
    setTags(tags) {
      const normalized = normalizeTags([...tags]);
      if (!normalized) return;
      selected = normalized;
      input.value = '';
      activeKey = null;
      renderChips();
      close();
    },
    setCatalog(next) {
      catalog = [...next];
      if (open) renderPopup();
    },
    setDisabled(disabled) {
      manuallyDisabled = disabled;
      updateDisabledState();
      chips.querySelectorAll<HTMLButtonElement>('.tasks-tag-remove').forEach(button => { button.disabled = disabled; });
      if (disabled) close();
    },
    commitPending,
    dispose() {
      if (disposed) return;
      disposed = true;
      input.removeEventListener('click', onInputClick);
      input.removeEventListener('input', onInput);
      input.removeEventListener('keydown', onKeyDown);
      field.removeEventListener('focusout', onFieldFocusOut);
      document.removeEventListener('pointerdown', onOutsidePointer, true);
      document.defaultView?.removeEventListener('resize', reposition);
      document.defaultView?.removeEventListener('scroll', reposition, true);
      listbox.remove();
    },
  };
}
