export type WindowDragRegion = { x: number; y: number; width: number; height: number };

/** Geometry is measured before mouse input; AppKit keeps the actual drag event.
 * This lets labels and controls resize without an overlay swallowing their clicks.
 */
export function observeWindowDragRegion(spacer: HTMLElement, send: (region: WindowDragRegion) => void): () => void {
  let disposed = false;
  let frame = 0;
  const schedule = () => {
    if (disposed || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (disposed) return;
      const rect = spacer.getBoundingClientRect();
      send({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    });
  };
  const observer = new ResizeObserver(schedule);
  observer.observe(spacer);
  schedule();
  return () => {
    if (disposed) return;
    disposed = true; observer.disconnect(); if (frame) cancelAnimationFrame(frame);
    // A new view may have different buttons before its next layout callback.
    send({ x: 0, y: 0, width: 0, height: 0 });
  };
}
