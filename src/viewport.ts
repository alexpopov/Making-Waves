/**
 * Viewport state and zoom/pan logic.
 *
 * The viewport defines which sample range is visible on screen.
 * Zoom uses a sticky anchor (captured once per gesture), fall-off
 * that slows down as you zoom deeper, and Cinemachine-style dead-zone
 * centering that only nudges the anchor when it's near the frame edge.
 */

import { pixelToSample, type Viewport } from './coords.js';

export type { Viewport };

// --- State ---
let viewport: Viewport = { start: 0, end: 1 };
let totalSamples = 1;

// Gesture tracking
let scrollLock: 'pan' | 'zoom' | null = null;
let scrollLockTimer: ReturnType<typeof setTimeout> | null = null;
let zoomAnchor: number | null = null;
let zoomAnchorTimer: ReturnType<typeof setTimeout> | null = null;

// --- Config ---
const SCROLL_LOCK_MS = 150;
const ZOOM_ANCHOR_MS = 1500;
const EDGE_ZONE = 0.10;       // 10% dead-zone buffer on each side
const EDGE_PUSH = 0.08;       // max centering nudge per tick
const BASE_ZOOM_STRENGTH = 0.25;
const MIN_VIEWPORT_SAMPLES = 100;

// --- Public API ---

export function getViewport(): Viewport {
  return viewport;
}

export function resetViewport(samples: number): void {
  totalSamples = samples;
  viewport = { start: 0, end: samples };
  clearGesture();
}

/** Call on mouse move (no drag) to reset the zoom anchor early. */
export function onPointerMove(): void {
  if (zoomAnchor !== null) {
    zoomAnchor = null;
    if (zoomAnchorTimer !== null) { clearTimeout(zoomAnchorTimer); zoomAnchorTimer = null; }
  }
}

/**
 * Handle a wheel event. Returns true if the viewport changed.
 */
export function onWheel(e: WheelEvent, canvas: HTMLCanvasElement): boolean {
  // Lock direction on first event of a gesture
  if (scrollLock === null) {
    scrollLock = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? 'pan' : 'zoom';
  }

  // Scroll lock resets quickly; zoom anchor persists longer.
  // Anchor also resets early on mouse movement (see onPointerMove).
  if (scrollLockTimer !== null) clearTimeout(scrollLockTimer);
  scrollLockTimer = setTimeout(() => { scrollLock = null; scrollLockTimer = null; }, SCROLL_LOCK_MS);

  if (zoomAnchorTimer !== null) clearTimeout(zoomAnchorTimer);
  zoomAnchorTimer = setTimeout(() => { zoomAnchor = null; zoomAnchorTimer = null; }, ZOOM_ANCHOR_MS);

  if (scrollLock === 'pan') {
    applyPan(e, canvas);
  } else {
    applyZoom(e, canvas);
  }

  return true;
}

/**
 * Pan the viewport by a sample delta. Positive = pan right.
 */
export function panBy(deltaSamples: number): void {
  let newStart = viewport.start + deltaSamples;
  let newEnd = viewport.end + deltaSamples;

  if (newStart < 0) { newEnd -= newStart; newStart = 0; }
  if (newEnd > totalSamples) { newStart -= (newEnd - totalSamples); newEnd = totalSamples; }

  viewport = {
    start: Math.floor(Math.max(0, newStart)),
    end: Math.floor(Math.min(totalSamples, Math.max(newStart + MIN_VIEWPORT_SAMPLES, newEnd))),
  };
}

/**
 * Zoom by a scale factor around an anchor sample.
 * factor < 1 = zoom in, factor > 1 = zoom out.
 */
export function zoomAt(factor: number, anchorSample: number): void {
  const vpLen = viewport.end - viewport.start;
  const newLen = Math.min(totalSamples, Math.max(MIN_VIEWPORT_SAMPLES, vpLen * factor));

  // Keep anchor at the same proportional position in the viewport
  const anchorRatio = (anchorSample - viewport.start) / vpLen;
  let newStart = anchorSample - anchorRatio * newLen;
  let newEnd = newStart + newLen;

  if (newStart < 0) { newEnd -= newStart; newStart = 0; }
  if (newEnd > totalSamples) { newStart -= (newEnd - totalSamples); newEnd = totalSamples; }

  viewport = {
    start: Math.floor(Math.max(0, newStart)),
    end: Math.floor(Math.min(totalSamples, newEnd)),
  };
}

// --- Internals ---

function applyPan(e: WheelEvent, canvas: HTMLCanvasElement): void {
  const vpLen = viewport.end - viewport.start;
  const deltaSamples = (e.deltaX / canvas.getBoundingClientRect().width) * vpLen;
  panBy(deltaSamples);
}

function applyZoom(e: WheelEvent, canvas: HTMLCanvasElement): void {
  const vpLen = viewport.end - viewport.start;

  // Capture anchor once per gesture so it doesn't drift
  if (zoomAnchor === null) {
    zoomAnchor = pixelToSample(canvas, e.clientX, viewport);
  }
  const anchor = zoomAnchor;

  // Fall-off: the deeper you're zoomed, the smaller each step
  const zoomRatio = vpLen / totalSamples;
  const strength = BASE_ZOOM_STRENGTH * Math.sqrt(zoomRatio);
  const direction = e.deltaY > 0 ? 1 : -1; // down = out, up = in
  const factor = 1 + direction * strength;
  const newLen = Math.min(totalSamples, Math.max(MIN_VIEWPORT_SAMPLES, vpLen * factor));

  // Dead-zone centering (Cinemachine-style):
  // Anchor sits freely in the middle (1 - 2*EDGE_ZONE) of the viewport.
  // Only when it's in the outer edge zones does it get nudged inward.
  const rawRatio = (anchor - viewport.start) / vpLen;
  let anchorRatio = rawRatio;

  if (direction < 0) { // only center when zooming in
    if (rawRatio < EDGE_ZONE) {
      const depth = (EDGE_ZONE - rawRatio) / EDGE_ZONE;
      anchorRatio = rawRatio + depth * EDGE_PUSH;
    } else if (rawRatio > 1 - EDGE_ZONE) {
      const depth = (rawRatio - (1 - EDGE_ZONE)) / EDGE_ZONE;
      anchorRatio = rawRatio - depth * EDGE_PUSH;
    }
  }

  let newStart = anchor - anchorRatio * newLen;
  let newEnd = newStart + newLen;

  // Clamp
  if (newStart < 0) { newEnd -= newStart; newStart = 0; }
  if (newEnd > totalSamples) { newStart -= (newEnd - totalSamples); newEnd = totalSamples; }

  viewport = {
    start: Math.floor(Math.max(0, newStart)),
    end: Math.floor(Math.min(totalSamples, newEnd)),
  };
}

/**
 * Ensure a sample range [start, end] is visible in the viewport.
 * Uses Cinemachine-style dead zone: if the range is fully inside the
 * middle 80% of the viewport, do nothing. If any part pokes into the
 * outer 10% margins, pan just enough to bring it back to the edge
 * of the dead zone. If the range is wider than the viewport, zoom
 * out to fit it with some padding.
 */
export function ensureVisible(start: number, end: number): void {
  const vpLen = viewport.end - viewport.start;
  const margin = vpLen * EDGE_ZONE;
  const safeStart = viewport.start + margin;
  const safeEnd = viewport.end - margin;
  const sliceLen = end - start;

  // If the slice is wider than the safe zone, zoom out to fit
  if (sliceLen > safeEnd - safeStart) {
    const padding = sliceLen * 0.15;
    let newStart = start - padding;
    let newEnd = end + padding;
    if (newStart < 0) { newEnd -= newStart; newStart = 0; }
    if (newEnd > totalSamples) { newStart -= (newEnd - totalSamples); newEnd = totalSamples; }
    viewport = {
      start: Math.floor(Math.max(0, newStart)),
      end: Math.floor(Math.min(totalSamples, newEnd)),
    };
    return;
  }

  // Pan if any part is outside the safe zone
  let shift = 0;
  if (start < safeStart) {
    shift = start - safeStart; // negative = pan left
  } else if (end > safeEnd) {
    shift = end - safeEnd;     // positive = pan right
  }

  if (shift !== 0) {
    let newStart = viewport.start + shift;
    let newEnd = viewport.end + shift;
    if (newStart < 0) { newEnd -= newStart; newStart = 0; }
    if (newEnd > totalSamples) { newStart -= (newEnd - totalSamples); newEnd = totalSamples; }
    viewport = {
      start: Math.floor(Math.max(0, newStart)),
      end: Math.floor(Math.min(totalSamples, newEnd)),
    };
  }
}

/**
 * Zoom to fit a sample range with padding. Returns the previous viewport
 * so the caller can toggle back.
 */
export function zoomToRange(start: number, end: number, padding = 0.1): Viewport {
  const prev = { ...viewport };
  const len = end - start;
  const pad = len * padding;
  let newStart = start - pad;
  let newEnd = end + pad;
  if (newStart < 0) { newEnd -= newStart; newStart = 0; }
  if (newEnd > totalSamples) { newStart -= (newEnd - totalSamples); newEnd = totalSamples; }
  viewport = {
    start: Math.floor(Math.max(0, newStart)),
    end: Math.floor(Math.min(totalSamples, newEnd)),
  };
  return prev;
}

/** Restore a previously saved viewport. */
export function setViewport(vp: Viewport): void {
  viewport = { ...vp };
}

function clearGesture(): void {
  scrollLock = null;
  zoomAnchor = null;
  if (scrollLockTimer !== null) { clearTimeout(scrollLockTimer); scrollLockTimer = null; }
  if (zoomAnchorTimer !== null) { clearTimeout(zoomAnchorTimer); zoomAnchorTimer = null; }
}
