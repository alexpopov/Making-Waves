/**
 * Waveform peak generation and Canvas 2D rendering.
 *
 * Draws overlapping slice regions with rainbow-paren coloring:
 * each slice's start and end markers share a color.
 */

import type { Slice } from './slicer.js';

/**
 * Viewport defines which sample range is visible on screen.
 * At zoom=1, this is [0, totalSamples]. Zooming in narrows the range.
 */
export interface Viewport {
  start: number;  // first visible sample
  end: number;    // last visible sample
}

export interface Peaks {
  min: Float32Array;
  max: Float32Array;
  length: number;
  /** The viewport these peaks were generated for (cache key) */
  vpStart: number;
  vpEnd: number;
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
  /** Sample position of a pending slice start (first click placed, waiting for second) */
  pendingStart: number | null;
}

/**
 * Rainbow palette — cycles like rainbow parentheses.
 * A slice's start and end markers share the same color.
 */
const SLICE_COLORS = [
  '#e94560', // red
  '#f5a623', // orange
  '#f7dc6f', // yellow
  '#2ecc71', // green
  '#4cc9f0', // cyan
  '#7b68ee', // purple
  '#e056a0', // pink
  '#00bcd4', // teal
];

export function sliceColor(index: number): string {
  return SLICE_COLORS[index % SLICE_COLORS.length];
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

  const { peaks, slices, viewport, playheadSample, selectedSlice, pendingStart } = opts;
  const midY = h / 2;
  const triSize = 10;

  // Map a sample frame to an X pixel position using the viewport
  const vpLen = viewport.end - viewport.start;
  const sampleToX = (s: number) => ((s - viewport.start) / vpLen) * w;

  // Background
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, w, h);

  // Draw colored tint bands for each slice (overlapping slices stack additively)
  for (let i = 0; i < slices.length; i++) {
    const s = slices[i];
    const x1 = sampleToX(s.start);
    const x2 = sampleToX(s.end);
    // Skip slices entirely outside the viewport
    if (x2 < 0 || x1 > w) continue;
    const color = sliceColor(i);
    ctx.fillStyle = i === selectedSlice
      ? hexToRgba(color, 0.22)
      : hexToRgba(color, 0.08);
    ctx.fillRect(x1, 0, x2 - x1, h);
  }

  // Draw waveform (peaks are already generated for this viewport)
  ctx.fillStyle = '#4cc9f0';
  for (let px = 0; px < peaks.length && px < w; px++) {
    const minVal = peaks.min[px];
    const maxVal = peaks.max[px];
    const y1 = midY - maxVal * midY;
    const y2 = midY - minVal * midY;
    ctx.fillRect(px, y1, 1, Math.max(1, y2 - y1));
  }

  // Center line
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(w, midY);
  ctx.stroke();

  // Draw slice markers — each slice's start and end share a color
  for (let i = 0; i < slices.length; i++) {
    const s = slices[i];
    const color = sliceColor(i);
    const isSelected = i === selectedSlice;

    const xStart = sampleToX(s.start);
    const xEnd = sampleToX(s.end);

    // Skip if both markers are off-screen
    if (xStart > w + triSize && xEnd > w + triSize) continue;
    if (xStart < -triSize && xEnd < -triSize) continue;

    // Start marker
    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 2 : 1.5;
    ctx.beginPath();
    ctx.moveTo(xStart, 0);
    ctx.lineTo(xStart, h);
    ctx.stroke();

    // Start triangle: points RIGHT (inward toward slice content) ▷
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(xStart, 0);
    ctx.lineTo(xStart, triSize * 2);
    ctx.lineTo(xStart + triSize, 0);
    ctx.closePath();
    ctx.fill();

    // End marker
    ctx.beginPath();
    ctx.moveTo(xEnd, 0);
    ctx.lineTo(xEnd, h);
    ctx.stroke();

    // End triangle: points LEFT (inward toward slice content) ◁
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(xEnd, 0);
    ctx.lineTo(xEnd, triSize * 2);
    ctx.lineTo(xEnd - triSize, 0);
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
    ctx.moveTo(xPending, 0);
    ctx.lineTo(xPending, triSize * 2);
    ctx.lineTo(xPending + triSize, 0);
    ctx.closePath();
    ctx.fill();
  }

  // Playhead
  if (playheadSample !== null) {
    const px = sampleToX(playheadSample);
    ctx.strokeStyle = '#ffffff';
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

/**
 * Convert a pixel X position on the canvas to a sample frame,
 * accounting for the current viewport (zoom/scroll state).
 */
export function pixelToSample(canvas: HTMLCanvasElement, x: number, viewport: Viewport): number {
  const rect = canvas.getBoundingClientRect();
  const ratio = (x - rect.left) / rect.width;
  const sample = viewport.start + ratio * (viewport.end - viewport.start);
  return Math.round(Math.max(0, sample));
}
