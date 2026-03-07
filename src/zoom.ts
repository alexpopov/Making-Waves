/**
 * Zoom toggle state and logic.
 *
 * Extracted from keyboard.ts so both keyboard shortcuts and toolbar
 * buttons can share the same zoom cycling behavior.
 *
 * Zoom levels cycle: out → segment → marker → out (depending on selection).
 * Pressing zoom again at the same level zooms back out.
 */

import { getViewport, setViewport, zoomToRange } from './viewport.js';
import type { Viewport } from './coords.js';

export type ZoomLevel = 'out' | 'none' | 'segment' | 'marker';

/** Minimum sample span when zooming tight on a single marker. */
const MIN_MARKER_ZOOM = 500;

let zoomLevel: ZoomLevel = 'out';
let zoomPrevViewport: Viewport | null = null;

export function getZoomLevel(): ZoomLevel {
  return zoomLevel;
}

/** Reset zoom state (e.g. when navigating to a different slice). */
export function resetZoom(): void {
  zoomLevel = 'out';
  zoomPrevViewport = null;
}

export interface ZoomContext {
  selectedSlice: number | null;
  selectedMarker: 'start' | 'end' | null;
  slices: ReadonlyArray<{ start: number; end: number }>;
}

/**
 * Toggle zoom based on the current selection.
 * Returns true if the viewport changed.
 */
export function toggleZoom(ctx: ZoomContext): boolean {
  const { selectedSlice, selectedMarker, slices } = ctx;

  // Determine target zoom level from current selection
  let targetLevel: 'none' | 'segment' | 'marker' = 'none';
  if (selectedSlice !== null && selectedSlice < slices.length && selectedMarker !== null) {
    targetLevel = 'marker';
  } else if (selectedSlice !== null && selectedSlice < slices.length) {
    targetLevel = 'segment';
  }

  const shouldZoomOut = zoomLevel !== 'out' && zoomLevel === targetLevel;

  if (shouldZoomOut) {
    if (zoomPrevViewport) {
      setViewport(zoomPrevViewport);
      zoomPrevViewport = null;
    }
    zoomLevel = 'out';
  } else {
    zoomPrevViewport = { ...getViewport() };

    if (selectedSlice !== null && selectedSlice < slices.length && selectedMarker !== null) {
      const s = slices[selectedSlice];
      const markerPos = s[selectedMarker];
      const markerRange = Math.max(MIN_MARKER_ZOOM, (s.end - s.start) * 0.08);
      zoomToRange(markerPos - markerRange, markerPos + markerRange, 0.1);
      zoomLevel = 'marker';
    } else if (selectedSlice !== null && selectedSlice < slices.length) {
      const s = slices[selectedSlice];
      zoomToRange(s.start, s.end, 0.1);
      zoomLevel = 'segment';
    } else {
      const vp = getViewport();
      const center = (vp.start + vp.end) / 2;
      const range = (vp.end - vp.start) * 0.15;
      zoomToRange(center - range, center + range, 0.1);
      zoomLevel = 'none';
    }
  }

  return true;
}
