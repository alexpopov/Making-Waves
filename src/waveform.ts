/**
 * Waveform peak generation and Canvas 2D rendering.
 *
 * Draws overlapping slice regions with rainbow-paren coloring:
 * each slice's start and end markers share a color.
 */

import type { Slice } from './slicer.js';
import { type Viewport, pixelToSample } from './coords.js';
import { SELECT_ZONE } from './constants.js';

export type { Viewport };

export interface Peaks {
  min: Float32Array;
  max: Float32Array;
  length: number;
  /** The viewport these peaks were generated for (cache key) */
  vpStart: number;
  vpEnd: number;
}

// --- Peak cache ---
// Keyed by canvas width + viewport range. Invalidated on viewport change,
// resize, theme change, or file load. Callers call invalidatePeaks() and
// then getCachedPeaks() on the next draw; generation is deferred until draw.

let _cachedPeaks: Peaks | null = null;

/** Discard the cached peaks. Must be called whenever the viewport changes. */
export function invalidatePeaks(): void {
  _cachedPeaks = null;
}

/**
 * Return cached peaks if still valid, otherwise generate fresh ones.
 * This is the preferred entry point for drawing code.
 */
export function getCachedPeaks(buffer: AudioBuffer, width: number, vp: Viewport): Peaks {
  if (
    _cachedPeaks &&
    _cachedPeaks.length === width &&
    _cachedPeaks.vpStart === vp.start &&
    _cachedPeaks.vpEnd === vp.end
  ) {
    return _cachedPeaks;
  }
  _cachedPeaks = generatePeaks(buffer, width, vp);
  return _cachedPeaks;
}

/**
 * Generate min/max peaks for a given pixel width over a viewport range.
 * Only processes samples within the viewport — zoomed-in views stay fast.
 */
export function generatePeaks(buffer: AudioBuffer, width: number, viewport: Viewport): Peaks {
  const numChannels = buffer.numberOfChannels;
  const vpLen = viewport.end - viewport.start;
  const samplesPerPixel = vpLen / width;

  const min = new Float32Array(width);
  const max = new Float32Array(width);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  for (let px = 0; px < width; px++) {
    const start = Math.floor(viewport.start + px * samplesPerPixel);
    const end = Math.min(Math.floor(viewport.start + (px + 1) * samplesPerPixel), buffer.length);

    let lo = 1.0;
    let hi = -1.0;

    for (let i = start; i < end; i++) {
      let sample = 0;
      for (let c = 0; c < numChannels; c++) {
        sample += channels[c][i];
      }
      sample /= numChannels;

      if (sample < lo) lo = sample;
      if (sample > hi) hi = sample;
    }

    min[px] = lo;
    max[px] = hi;
  }

  return { min, max, length: width, vpStart: viewport.start, vpEnd: viewport.end };
}

export interface DrawOptions {
  peaks: Peaks;
  slices: Slice[];
  totalSamples: number;
  viewport: Viewport;
  playheadSample: number | null;
  selectedSlice: number | null;
  selectedMarker: 'start' | 'end' | null;
  /** Sample position of a pending slice start (first click placed, waiting for second) */
  pendingStart: number | null;
}

/**
 * Default rainbow palette — used when no CSS --slice-N vars are set.
 */
const DEFAULT_SLICE_COLORS = [
  '#e94560', // red
  '#f5a623', // orange
  '#f7dc6f', // yellow
  '#2ecc71', // green
  '#4cc9f0', // cyan
  '#7b68ee', // purple
  '#e056a0', // pink
  '#00bcd4', // teal
];

/** Cached slice colors from CSS — invalidated on theme change. */
let cachedSliceColors: string[] | null = null;

function getSliceColors(): string[] {
  if (cachedSliceColors) return cachedSliceColors;

  const style = getComputedStyle(document.documentElement);
  const colors: string[] = [];
  for (let i = 0; ; i++) {
    const val = style.getPropertyValue(`--slice-${i}`).trim();
    if (!val) break;
    colors.push(val);
  }
  cachedSliceColors = colors.length > 0 ? colors : DEFAULT_SLICE_COLORS;
  return cachedSliceColors;
}

/** Call when the theme changes to pick up new slice colors. */
export function invalidateThemeCache(): void {
  cachedSliceColors = null;
}

export function sliceColor(index: number): string {
  const colors = getSliceColors();
  return colors[index % colors.length];
}

export function drawWaveform(canvas: HTMLCanvasElement, opts: DrawOptions): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;

  canvas.width = w * dpr;
  canvas.height = h * dpr;

  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  const { peaks, slices, viewport, playheadSample, selectedSlice, selectedMarker, pendingStart } = opts;
  const triW = 10;
  const triH = 15;

  // Read theme colors from CSS custom properties
  const style = getComputedStyle(canvas);
  const themeBg = style.getPropertyValue('--wave-bg').trim() || '#1a1a2e';
  const themeFill = style.getPropertyValue('--wave-fill').trim() || '#4cc9f0';
  const themeCenterLine = style.getPropertyValue('--wave-center-line').trim() || 'rgba(255,255,255,0.1)';
  const themeSelectLine = style.getPropertyValue('--wave-select-line').trim() || 'rgba(255,255,255,0.12)';
  const themePlayhead = style.getPropertyValue('--wave-playhead').trim() || '#ffffff';

  // Waveform lives in the middle 80% (10%–90%), matching SELECT_ZONE.
  const waveTop = h * SELECT_ZONE;
  const waveBottom = h * (1 - SELECT_ZONE);
  const waveHeight = waveBottom - waveTop;
  const waveMidY = waveTop + waveHeight / 2;

  // Map a sample frame to an X pixel position using the viewport
  const vpLen = viewport.end - viewport.start;
  const sampleToX = (s: number) => ((s - viewport.start) / vpLen) * w;

  // Background
  ctx.fillStyle = themeBg;
  ctx.fillRect(0, 0, w, h);

  // Selection zone boundary (top 10%) — skip over the selected slice's panel
  const selectLineY = waveTop;
  ctx.strokeStyle = themeSelectLine;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);

  let selX1 = -1, selX2 = -1;
  if (selectedSlice !== null && selectedSlice >= 0 && selectedSlice < slices.length) {
    const ss = slices[selectedSlice];
    selX1 = sampleToX(ss.start);
    selX2 = sampleToX(ss.end);
  }

  ctx.beginPath();
  if (selX1 >= 0) {
    ctx.moveTo(0, selectLineY);
    ctx.lineTo(Math.max(0, selX1), selectLineY);
    ctx.moveTo(Math.min(w, selX2), selectLineY);
    ctx.lineTo(w, selectLineY);
  } else {
    ctx.moveTo(0, selectLineY);
    ctx.lineTo(w, selectLineY);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw colored tint bands for each slice (overlapping slices stack additively)
  for (let i = 0; i < slices.length; i++) {
    const s = slices[i];
    const x1 = sampleToX(s.start);
    const x2 = sampleToX(s.end);
    // Skip slices entirely outside the viewport
    if (x2 < 0 || x1 > w) continue;
    const color = sliceColor(i);
    const isSelected = i === selectedSlice;
    ctx.fillStyle = isSelected
      ? hexToRgba(color, 0.22)
      : hexToRgba(color, 0.08);
    ctx.fillRect(x1, 0, x2 - x1, h);

    // Selected slice: solid "panel" in the grab zone with underglow
    if (isSelected) {
      // Semi-transparent panel over background
      ctx.fillStyle = themeBg;
      ctx.fillRect(x1, 0, x2 - x1, selectLineY);
      ctx.fillStyle = hexToRgba(color, 0.45);
      ctx.fillRect(x1, 0, x2 - x1, selectLineY);

    }
  }

  // Draw waveform — maps [-1, 1] into [waveBottom, waveTop]
  ctx.fillStyle = themeFill;
  const halfWave = waveHeight / 2;
  for (let px = 0; px < peaks.length && px < w; px++) {
    const minVal = peaks.min[px];
    const maxVal = peaks.max[px];
    const y1 = waveMidY - maxVal * halfWave;
    const y2 = waveMidY - minVal * halfWave;
    ctx.fillRect(px, y1, 1, Math.max(1, y2 - y1));
  }

  // Center line
  ctx.strokeStyle = themeCenterLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, waveMidY);
  ctx.lineTo(w, waveMidY);
  ctx.stroke();

  // Draw slice markers — each slice's start and end share a color
  for (let i = 0; i < slices.length; i++) {
    const s = slices[i];
    const color = sliceColor(i);
    const isSelected = i === selectedSlice;

    const xStart = sampleToX(s.start);
    const xEnd = sampleToX(s.end);

    // Skip if both markers are off-screen
    if (xStart > w + triW && xEnd > w + triW) continue;
    if (xStart < -triW && xEnd < -triW) continue;

    const startActive = isSelected && selectedMarker === 'start';
    const endActive = isSelected && selectedMarker === 'end';
    const hasActiveMarker = isSelected && selectedMarker !== null;

    // Start marker
    ctx.strokeStyle = startActive ? themePlayhead : color;
    ctx.lineWidth = startActive ? 3 : (hasActiveMarker ? 1 : (isSelected ? 2 : 1.5));
    ctx.beginPath();
    ctx.moveTo(xStart, 0);
    ctx.lineTo(xStart, h);
    ctx.stroke();

    // Start triangle: points RIGHT (inward toward slice content) ▷
    ctx.fillStyle = startActive ? themePlayhead : color;
    ctx.beginPath();
    ctx.moveTo(xStart - 1, 0);
    ctx.lineTo(xStart - 1, triH);
    ctx.lineTo(xStart - 1 + triW, 0);
    ctx.closePath();
    ctx.fill();

    // End marker
    ctx.strokeStyle = endActive ? themePlayhead : color;
    ctx.lineWidth = endActive ? 3 : (hasActiveMarker ? 1 : (isSelected ? 2 : 1.5));
    ctx.beginPath();
    ctx.moveTo(xEnd, 0);
    ctx.lineTo(xEnd, h);
    ctx.stroke();

    // End triangle: points LEFT (inward toward slice content) ◁
    ctx.fillStyle = endActive ? themePlayhead : color;
    ctx.beginPath();
    ctx.moveTo(xEnd + 1, 0);
    ctx.lineTo(xEnd + 1, triH);
    ctx.lineTo(xEnd + 1 - triW, 0);
    ctx.closePath();
    ctx.fill();
  }

  // Pending start marker (first click placed, waiting for second)
  if (pendingStart !== null) {
    const nextColor = sliceColor(slices.length);
    const xPending = sampleToX(pendingStart);

    ctx.strokeStyle = nextColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(xPending, 0);
    ctx.lineTo(xPending, h);
    ctx.stroke();
    ctx.setLineDash([]);

    // Inward triangle
    ctx.fillStyle = nextColor;
    ctx.beginPath();
    ctx.moveTo(xPending - 1, 0);
    ctx.lineTo(xPending - 1, triH);
    ctx.lineTo(xPending - 1 + triW, 0);
    ctx.closePath();
    ctx.fill();
  }

  // Playhead
  if (playheadSample !== null) {
    const px = sampleToX(playheadSample);
    ctx.strokeStyle = themePlayhead;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export { pixelToSample };
