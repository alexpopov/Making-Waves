/**
 * Waveform peak generation and Canvas 2D rendering.
 *
 * Produces a downsampled min/max peak array so we can draw
 * the waveform at any zoom level without iterating all samples.
 */

export interface Peaks {
  min: Float32Array;
  max: Float32Array;
  length: number;
}

/**
 * Generate min/max peaks for a given pixel width.
 * Mixes down to mono by averaging all channels.
 */
export function generatePeaks(buffer: AudioBuffer, width: number): Peaks {
  const numChannels = buffer.numberOfChannels;
  const totalSamples = buffer.length;
  const samplesPerPixel = totalSamples / width;

  const min = new Float32Array(width);
  const max = new Float32Array(width);

  // Get all channel data upfront
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  for (let px = 0; px < width; px++) {
    const start = Math.floor(px * samplesPerPixel);
    const end = Math.min(Math.floor((px + 1) * samplesPerPixel), totalSamples);

    let lo = 1.0;
    let hi = -1.0;

    for (let i = start; i < end; i++) {
      // Average across channels for mono mix
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

  return { min, max, length: width };
}

export interface DrawOptions {
  peaks: Peaks;
  markers: number[];          // marker positions in sample frames
  totalSamples: number;
  playheadSample: number | null;
  selectedSlice: number | null; // index into regions (between markers)
}

/**
 * Draw the waveform, slice markers, and playhead onto a canvas.
 */
export function drawWaveform(canvas: HTMLCanvasElement, opts: DrawOptions): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;

  // Size canvas buffer to match CSS size × device pixel ratio
  canvas.width = w * dpr;
  canvas.height = h * dpr;

  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  const { peaks, markers, totalSamples, playheadSample, selectedSlice } = opts;
  const midY = h / 2;

  // Background
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, w, h);

  // Highlight selected slice region
  if (selectedSlice !== null) {
    const regions = getRegions(markers, totalSamples);
    if (selectedSlice >= 0 && selectedSlice < regions.length) {
      const [rStart, rEnd] = regions[selectedSlice];
      const x1 = (rStart / totalSamples) * w;
      const x2 = (rEnd / totalSamples) * w;
      ctx.fillStyle = 'rgba(15, 52, 96, 0.5)';
      ctx.fillRect(x1, 0, x2 - x1, h);
    }
  }

  // Draw waveform
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

  // Slice markers
  ctx.strokeStyle = '#e94560';
  ctx.lineWidth = 1.5;
  for (const marker of markers) {
    const x = (marker / totalSamples) * w;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();

    // Small triangle handle at top
    ctx.fillStyle = '#e94560';
    ctx.beginPath();
    ctx.moveTo(x - 5, 0);
    ctx.lineTo(x + 5, 0);
    ctx.lineTo(x, 8);
    ctx.closePath();
    ctx.fill();
  }

  // Playhead
  if (playheadSample !== null) {
    const px = (playheadSample / totalSamples) * w;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();
  }
}

/** Convert markers into [start, end] regions */
function getRegions(markers: number[], totalSamples: number): [number, number][] {
  const sorted = [0, ...markers, totalSamples];
  const regions: [number, number][] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    regions.push([sorted[i], sorted[i + 1]]);
  }
  return regions;
}

/**
 * Convert a pixel X position on the canvas to a sample frame index.
 */
export function pixelToSample(canvas: HTMLCanvasElement, x: number, totalSamples: number): number {
  const rect = canvas.getBoundingClientRect();
  const ratio = (x - rect.left) / rect.width;
  return Math.round(Math.max(0, Math.min(1, ratio)) * totalSamples);
}
