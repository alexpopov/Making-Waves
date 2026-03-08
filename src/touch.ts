/**
 * Touch gesture handler for the waveform canvas.
 *
 * Single-finger drag = horizontal pan.
 * Two-finger pinch = zoom (around midpoint).
 *
 * Uses touch events (not pointer events) because we need
 * simultaneous multi-touch tracking for pinch detection.
 */

import { panBy, zoomAt, getViewport } from './viewport.js';
import { pixelToSample } from './coords.js';

/** Max displacement (px) from touchstart to touchend to count as a tap. */
const TAP_THRESHOLD_PX = 10;

export interface TouchCallbacks {
  /** Called after any pan/zoom so the host can invalidate peaks and redraw. */
  onViewportChanged(): void;
  /**
   * Called when a single-finger touch ends with little movement (a tap).
   * The host can use this to trigger selection hit-tests.
   */
  onTap?: (clientX: number, clientY: number) => void;
}

interface TouchState {
  /** Are we currently in a gesture? */
  active: boolean;
  /** Starting touch positions for each finger */
  startTouches: { id: number; x: number; y: number }[];
  /** Previous frame positions for delta computation */
  prevTouches: { id: number; x: number; y: number }[];
  /** Distance between two fingers last frame (for pinch) */
  prevPinchDist: number | null;
  /** Midpoint sample at pinch start (zoom anchor) */
  pinchAnchorSample: number | null;
}

export function registerTouch(canvas: HTMLCanvasElement, cb: TouchCallbacks): void {
  const state: TouchState = {
    active: false,
    startTouches: [],
    prevTouches: [],
    prevPinchDist: null,
    pinchAnchorSample: null,
  };

  canvas.addEventListener('touchstart', (e) => {
    // Prevent default to stop iOS Safari scroll/bounce/zoom
    e.preventDefault();

    state.active = true;
    state.startTouches = extractTouches(e);
    state.prevTouches = extractTouches(e);

    if (e.touches.length === 2) {
      state.prevPinchDist = touchDistance(e);
      // Capture zoom anchor as sample at midpoint of the two fingers
      const mid = touchMidpointX(e);
      state.pinchAnchorSample = pixelToSample(canvas, mid, getViewport());
    } else {
      state.prevPinchDist = null;
      state.pinchAnchorSample = null;
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (!state.active) return;

    if (e.touches.length === 2 && state.prevPinchDist !== null) {
      // --- Pinch to zoom ---
      const dist = touchDistance(e);
      const scale = state.prevPinchDist / dist; // >1 = zoom out, <1 = zoom in
      state.prevPinchDist = dist;

      // Use the original pinch anchor so the zoom point stays stable
      const anchor = state.pinchAnchorSample ?? pixelToSample(canvas, touchMidpointX(e), getViewport());
      zoomAt(scale, anchor);

      // Also handle any pan component (midpoint shift)
      const prevMid = avgX(state.prevTouches);
      const curMid = touchMidpointX(e);
      const dx = prevMid - curMid;
      if (Math.abs(dx) > 0.5) {
        const vp = getViewport();
        const rect = canvas.getBoundingClientRect();
        const deltaSamples = (dx / rect.width) * (vp.end - vp.start);
        panBy(deltaSamples);
      }

      state.prevTouches = extractTouches(e);
      cb.onViewportChanged();
    } else if (e.touches.length === 1) {
      // --- Single finger pan ---
      const prev = state.prevTouches[0];
      if (!prev) { state.prevTouches = extractTouches(e); return; }

      const cur = e.touches[0];
      const dx = prev.x - cur.clientX; // positive = dragged left = pan right
      if (Math.abs(dx) > 0.5) {
        const vp = getViewport();
        const rect = canvas.getBoundingClientRect();
        const deltaSamples = (dx / rect.width) * (vp.end - vp.start);
        panBy(deltaSamples);
        cb.onViewportChanged();
      }

      state.prevTouches = extractTouches(e);
    }
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) {
      // Detect tap: single finger lifted with small total displacement
      if (
        state.startTouches.length === 1 &&
        e.changedTouches.length === 1 &&
        cb.onTap
      ) {
        const start = state.startTouches[0];
        const end = e.changedTouches[0];
        const dx = end.clientX - start.x;
        const dy = end.clientY - start.y;
        if (Math.sqrt(dx * dx + dy * dy) < TAP_THRESHOLD_PX) {
          cb.onTap(end.clientX, end.clientY);
        }
      }
      state.active = false;
      state.prevPinchDist = null;
      state.pinchAnchorSample = null;
    } else if (e.touches.length === 1) {
      // Went from 2 fingers to 1 — reset to single-finger pan
      state.prevTouches = extractTouches(e);
      state.prevPinchDist = null;
      state.pinchAnchorSample = null;
    }
  });

  canvas.addEventListener('touchcancel', () => {
    state.active = false;
    state.prevPinchDist = null;
    state.pinchAnchorSample = null;
  });
}

// --- Helpers ---

function extractTouches(e: TouchEvent): { id: number; x: number; y: number }[] {
  const result: { id: number; x: number; y: number }[] = [];
  for (let i = 0; i < e.touches.length; i++) {
    result.push({ id: e.touches[i].identifier, x: e.touches[i].clientX, y: e.touches[i].clientY });
  }
  return result;
}

function touchDistance(e: TouchEvent): number {
  const t0 = e.touches[0];
  const t1 = e.touches[1];
  const dx = t1.clientX - t0.clientX;
  const dy = t1.clientY - t0.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function touchMidpointX(e: TouchEvent): number {
  return (e.touches[0].clientX + e.touches[1].clientX) / 2;
}

function avgX(touches: { x: number }[]): number {
  if (touches.length === 0) return 0;
  return touches.reduce((sum, t) => sum + t.x, 0) / touches.length;
}
