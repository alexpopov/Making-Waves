/**
 * DSP utilities for transient detection and zero-crossing analysis.
 *
 * All functions operate on raw Float32Array sample data and are
 * intentionally pure (no AudioBuffer dependency) so they can run
 * in a Web Worker without touching the main-thread AudioContext.
 *
 * Transient detection pipeline:
 *   1. Mix channels to mono                    → monoSamples()
 *   2. Compute RMS energy per frame            → rmsEnergy()
 *   3. Detect onset spikes (flux > threshold)  → detectTransients()
 *   4. Snap each result to nearest zero-cross  → snapToZeroCrossing()
 */

// ---------------------------------------------------------------------------
// Mono mix
// ---------------------------------------------------------------------------

/**
 * Mix an arbitrary number of channels down to a single Float32Array.
 * Returns a view of the first channel if there is only one (no copy).
 */
export function monoMix(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) throw new Error('monoMix: no channels');
  if (channels.length === 1) return channels[0];

  const len = channels[0].length;
  const out = new Float32Array(len);
  const inv = 1 / channels.length;
  for (let i = 0; i < len; i++) {
    let sum = 0;
    for (let c = 0; c < channels.length; c++) sum += channels[c][i];
    out[i] = sum * inv;
  }
  return out;
}

// ---------------------------------------------------------------------------
// RMS energy
// ---------------------------------------------------------------------------

/**
 * Compute root-mean-square energy for non-overlapping frames.
 *
 * @param samples   Mono sample data.
 * @param frameSize Number of samples per RMS frame (e.g. 512 or 1024).
 * @returns         Float32Array of RMS values, one per frame.
 */
export function rmsEnergy(samples: Float32Array, frameSize: number): Float32Array {
  const numFrames = Math.ceil(samples.length / frameSize);
  const out = new Float32Array(numFrames);

  for (let f = 0; f < numFrames; f++) {
    const start = f * frameSize;
    const end = Math.min(start + frameSize, samples.length);
    let sum = 0;
    for (let i = start; i < end; i++) sum += samples[i] * samples[i];
    out[f] = Math.sqrt(sum / (end - start));
  }

  return out;
}

// ---------------------------------------------------------------------------
// Spectral flux (onset strength)
// ---------------------------------------------------------------------------

/**
 * Compute frame-to-frame RMS flux: how much the energy *increased* from one
 * frame to the next (negative increases are clamped to 0 — we only care
 * about onsets, not offsets).
 *
 * This is a simple half-wave rectified first difference, which works well
 * for percussive material without needing an FFT.
 */
export function rmsFlux(energy: Float32Array): Float32Array {
  const out = new Float32Array(energy.length);
  for (let i = 1; i < energy.length; i++) {
    out[i] = Math.max(0, energy[i] - energy[i - 1]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Transient detection
// ---------------------------------------------------------------------------

export interface TransientDetectOptions {
  /**
   * Number of samples per RMS analysis frame.
   * Smaller = finer time resolution, more CPU. Default: 512.
   */
  frameSize?: number;
  /**
   * Multiplier applied to the median flux to derive the dynamic threshold.
   * Higher = fewer (only strong) transients. Default: 1.5.
   */
  sensitivity?: number;
  /**
   * Minimum gap between two accepted transients, in samples.
   * Prevents double-triggers on a single hit. Default: sampleRate / 8.
   */
  minGapSamples?: number;
}

/**
 * Detect transient onsets in mono sample data.
 *
 * Returns an array of sample frame positions (indices into `samples`)
 * where energy spikes above a dynamic threshold derived from the median
 * flux. Results are suitable for use as slice start/end suggestions.
 *
 * @param samples     Mono sample data (use monoMix first for multi-channel).
 * @param sampleRate  Sample rate of the audio (used for default minGapSamples).
 * @param options     Tuning parameters — all optional.
 */
export function detectTransients(
  samples: Float32Array,
  sampleRate: number,
  options: TransientDetectOptions = {},
): number[] {
  const frameSize = options.frameSize ?? 512;
  const sensitivity = options.sensitivity ?? 1.5;
  const minGapSamples = options.minGapSamples ?? Math.round(sampleRate / 8);

  const energy = rmsEnergy(samples, frameSize);
  const flux = rmsFlux(energy);

  // Dynamic threshold = sensitivity × median of non-zero flux values
  const nonZero = Array.from(flux).filter(v => v > 0).sort((a, b) => a - b);
  if (nonZero.length === 0) return [];
  const median = nonZero[Math.floor(nonZero.length / 2)];
  const threshold = median * sensitivity;

  const transients: number[] = [];
  let lastSample = -minGapSamples;

  for (let f = 0; f < flux.length; f++) {
    if (flux[f] < threshold) continue;
    const samplePos = f * frameSize;
    if (samplePos - lastSample < minGapSamples) continue;
    transients.push(samplePos);
    lastSample = samplePos;
  }

  return transients;
}

// ---------------------------------------------------------------------------
// Zero-crossing snap
// ---------------------------------------------------------------------------

/**
 * Snap a sample position to the nearest zero crossing within a search window.
 *
 * A zero crossing is where the signal changes sign. Cutting at a zero
 * crossing avoids the audible click caused by a discontinuity at the
 * splice point.
 *
 * @param samples     Mono sample data.
 * @param position    Starting search position.
 * @param windowSize  Max samples to search in each direction. Default: 512.
 * @returns           Adjusted sample position (original if no crossing found).
 */
export function snapToZeroCrossing(
  samples: Float32Array,
  position: number,
  windowSize = 512,
): number {
  const start = Math.max(0, position - windowSize);
  const end = Math.min(samples.length - 1, position + windowSize);

  let bestPos = position;
  let bestDist = Infinity;

  for (let i = start; i < end; i++) {
    // Detect sign change between adjacent samples
    if (samples[i] * samples[i + 1] <= 0) {
      const dist = Math.abs(i - position);
      if (dist < bestDist) {
        bestDist = dist;
        // Pick the sample closer to zero amplitude
        bestPos = Math.abs(samples[i]) <= Math.abs(samples[i + 1]) ? i : i + 1;
      }
    }
  }

  return bestPos;
}

/**
 * Snap an array of transient positions to their nearest zero crossings.
 * Convenience wrapper around snapToZeroCrossing for bulk use.
 */
export function snapAllToZeroCrossings(
  samples: Float32Array,
  positions: number[],
  windowSize = 512,
): number[] {
  return positions.map(p => snapToZeroCrossing(samples, p, windowSize));
}

// ---------------------------------------------------------------------------
// Silence detection
// ---------------------------------------------------------------------------

/**
 * Find regions of silence (RMS below threshold) and return the sample
 * positions of their midpoints. Useful for suggesting slice boundaries
 * between sounds.
 *
 * @param energy      RMS energy array (from rmsEnergy()).
 * @param frameSize   Frame size used to generate `energy`.
 * @param threshold   RMS value below which a frame is considered silent.
 *                    Typical values: 0.01–0.05.
 * @param minFrames   Minimum number of consecutive silent frames to count
 *                    as a silence region. Default: 4.
 */
export function detectSilences(
  energy: Float32Array,
  frameSize: number,
  threshold: number,
  minFrames = 4,
): number[] {
  const midpoints: number[] = [];
  let silenceStart = -1;
  let count = 0;

  for (let f = 0; f <= energy.length; f++) {
    const silent = f < energy.length && energy[f] < threshold;
    if (silent) {
      if (silenceStart < 0) silenceStart = f;
      count++;
    } else {
      if (count >= minFrames) {
        const midFrame = silenceStart + Math.floor(count / 2);
        midpoints.push(midFrame * frameSize);
      }
      silenceStart = -1;
      count = 0;
    }
  }

  return midpoints;
}
