/**
 * Playback engine using AudioBufferSourceNode → AnalyserNode → destination.
 *
 * Tracks playhead position via AudioContext.currentTime for
 * sample-accurate cursor rendering.
 */

import { getAudioContext, ensureResumed } from './audio.js';

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
let analyser: AnalyserNode | null = null;
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

export function getAnalyser(): AnalyserNode | null {
  return analyser;
}

export function setCallbacks(playhead: PlayheadCallback, stop: StopCallback): void {
  onPlayhead = playhead;
  onStop = stop;
}

/**
 * Play a region of the audio buffer.
 */
export async function playRegion(
  buffer: AudioBuffer,
  startSample: number,
  endSample: number,
  loop: boolean = false
): Promise<void> {
  stop();

  const ac = await ensureResumed();
  currentBuffer = buffer;

  // Create AnalyserNode for real-time visualization
  if (!analyser) {
    analyser = ac.createAnalyser();
    analyser.fftSize = 2048;
    analyser.connect(ac.destination);
  }

  // Create source
  source = ac.createBufferSource();
  source.buffer = buffer;
  source.connect(analyser);

  const startSeconds = startSample / buffer.sampleRate;
  const duration = (endSample - startSample) / buffer.sampleRate;

  source.loop = loop;
  if (loop) {
    source.loopStart = startSeconds;
    source.loopEnd = startSeconds + duration;
  }

  source.start(0, startSeconds, loop ? undefined : duration);

  state.isPlaying = true;
  state.isLooping = loop;
  state.startSample = startSample;
  state.endSample = endSample;
  state.startedAt = ac.currentTime;

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
