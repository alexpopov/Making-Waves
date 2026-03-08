/**
 * Coordinate-space types and utilities shared across waveform, viewport,
 * and input-handling modules.
 *
 * Keeping these here breaks the circular dependency that would arise if
 * viewport.ts imported from waveform.ts just to get the Viewport type.
 */

/** Defines which sample range is currently visible on screen. */
export interface Viewport {
  start: number;  // first visible sample frame
  end: number;    // last visible sample frame
}

/**
 * Convert a pixel X position on an element to a sample frame,
 * accounting for the current viewport (zoom/scroll state).
 * Works with any element (canvas, div, etc.) via getBoundingClientRect.
 */
export function pixelToSample(el: HTMLElement, x: number, viewport: Viewport): number {
  const rect = el.getBoundingClientRect();
  const ratio = (x - rect.left) / rect.width;
  const sample = viewport.start + ratio * (viewport.end - viewport.start);
  return Math.round(Math.max(0, sample));
}
