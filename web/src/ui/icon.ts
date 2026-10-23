import { createElement, type IconNode } from 'lucide';

/** Render one Lucide node with the app-wide icon sizing and accessibility defaults. */
export function renderIcon(node: IconNode, size: number): SVGElement {
  return createElement(node, {
    width: size,
    height: size,
    'stroke-width': 1.7,
    'aria-hidden': 'true',
  });
}
