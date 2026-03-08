/**
 * Playback engine: AudioBufferSourceNode → masterGain → destination.
 *
 * Tracks playhead position via AudioContext.currentTime for
 * sample-accurate cursor rendering.
 *
 * Note: AnalyserNode was removed from the inline audio path because
 * Safari buffers it through its FFT window, adding 300-500ms of
 * audible latency. If we need visualisation in the future, tap the
 * signal on a parallel branch, not inline.
 */

import { getAudioContext, ensureResumedSync } from './audio.js';

export interface PlaybackState {
  isPlaying: boolean;
  isLooping: boolean;
  startSample: number;
  endSample: number;
  /** AudioContext.currentTime when playback started */
  startedAt: number;
  /** Current playhead in sample frames */
  currentSample: number;
}

let source: AudioBufferSourceNode | null = null;
let masterGain: GainNode | null = null;
let animFrameId: number | null = null;
let currentBuffer: AudioBuffer | null = null;

const state: PlaybackState = {
  isPlaying: false,
  isLooping: false,
  startSample: 0,
  endSample: 0,
  startedAt: 0,
  currentSample: 0,
};

type PlayheadCallback = (sampleFrame: number) => void;
type StopCallback = () => void;

let onPlayhead: PlayheadCallback | null = null;
let onStop: StopCallback | null = null;

export function getPlaybackState(): Readonly<PlaybackState> {
  return state;
}

/** Set master volume (0 = silent, 1 = unity). */
export function setMasterVolume(value: number): void {
  const ac = getAudioContext();
  if (!masterGain) {
    masterGain = ac.createGain();
    masterGain.connect(ac.destination);
  }
  masterGain.gain.setTargetAtTime(value, ac.currentTime, 0.01);
}

export function setCallbacks(playhead: PlayheadCallback, stop: StopCallback): void {
  onPlayhead = playhead;
  onStop = stop;
}

/**
 * Play a region of the audio buffer.
 * Synchronous to avoid microtask delays and keep iOS gesture context.
 */
export function playRegion(
  buffer: AudioBuffer,
  startSample: number,
  endSample: number,
  loop: boolean = false
): void {
  stop();

  const ac = ensureResumedSync();
  currentBuffer = buffer;

  // Lazy-init master gain (persists across plays)
  if (!masterGain) {
    masterGain = ac.createGain();
    masterGain.connect(ac.destination);
  }

  source = ac.createBufferSource();
  source.buffer = buffer;
  source.connect(masterGain);

  const startSeconds = startSample / buffer.sampleRate;
  const duration = (endSample - startSample) / buffer.sampleRate;

  source.loop = loop;
  if (loop) {
    source.loopStart = startSeconds;
    source.loopEnd = startSeconds + duration;
  }

  // Small lookahead (5ms) gives the audio render thread time to
  // schedule the buffer before the next hardware callback.
  const when = ac.currentTime + 0.005;
  source.start(when, startSeconds, loop ? undefined : duration);

  state.isPlaying = true;
  state.isLooping = loop;
  state.startSample = startSample;
  state.endSample = endSample;
  state.startedAt = when;

  source.onended = () => {
    if (state.isPlaying) {
      state.isPlaying = false;
      if (animFrameId !== null) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
      }
      onStop?.();
    }
  };

  // Start playhead animation
  animatePlayhead();
}

function animatePlayhead(): void {
  if (!state.isPlaying || !currentBuffer) return;

  const ac = getAudioContext();
  const elapsed = ac.currentTime - state.startedAt;
  const elapsedSamples = elapsed * currentBuffer.sampleRate;
  const regionLength = state.endSample - state.startSample;

  if (state.isLooping) {
    state.currentSample = state.startSample + (elapsedSamples % regionLength);
  } else {
    state.currentSample = Math.min(
      state.startSample + elapsedSamples,
      state.endSample
    );
  }

  onPlayhead?.(state.currentSample);

  animFrameId = requestAnimationFrame(animatePlayhead);
}

export function stop(): void {
  if (source) {
    try {
      source.onended = null;
      source.stop();
    } catch {
      // Already stopped
    }
    source.disconnect();
    source = null;
  }

  if (animFrameId !== null) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }

  state.isPlaying = false;
  state.currentSample = 0;
  currentBuffer = null;
}

export function toggleLoop(): boolean {
  state.isLooping = !state.isLooping;
  return state.isLooping;
}
