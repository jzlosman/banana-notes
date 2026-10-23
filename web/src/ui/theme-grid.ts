export function updateThemeGridTabStop(grid: HTMLElement, selectedID: string): void {
  const options = [...grid.querySelectorAll<HTMLButtonElement>('[role="radio"]:not([hidden])')];
  for (const option of options) option.tabIndex = -1;
  (options.find(option => option.dataset.themeId === selectedID) ?? options[0])?.setAttribute('tabindex', '0');
}

export function installThemeGridKeyboard(grid: HTMLElement, columnCount?: () => number): () => void {
  const columns = columnCount ?? (() => {
    const template = grid.ownerDocument.defaultView?.getComputedStyle(grid).gridTemplateColumns ?? '';
    return Math.max(1, template.split(/\s+/).filter(Boolean).length || 2);
  });
  const onKeyDown = (event: KeyboardEvent) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[role="radio"]');
    if (!target || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const options = [...grid.querySelectorAll<HTMLButtonElement>('[role="radio"]:not([hidden])')];
    const index = options.indexOf(target); if (index < 0 || !options.length) return;
    const count = Math.max(1, columns());
    let next = index;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else if (event.key === 'ArrowRight' && index % count < count - 1) next = index + 1;
    else if (event.key === 'ArrowLeft' && index % count > 0) next = index - 1;
    else if (event.key === 'ArrowDown' && index + count < options.length) next = index + count;
    else if (event.key === 'ArrowUp' && index - count >= 0) next = index - count;
    if (next === index) return;
    event.preventDefault(); options[next].focus(); options[next].click();
  };
  grid.addEventListener('keydown', onKeyDown);
  return () => grid.removeEventListener('keydown', onKeyDown);
}
