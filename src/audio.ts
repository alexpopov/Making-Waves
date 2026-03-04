/**
 * AudioContext management and WAV file decoding.
 *
 * The AudioContext is created lazily on first user gesture
 * to satisfy iOS Safari's autoplay policy.
 */

let ctx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
  }
  return ctx;
}

export async function ensureResumed(): Promise<AudioContext> {
  const ac = getAudioContext();
  if (ac.state === 'suspended') {
    await ac.resume();
  }
  return ac;
}

/**
 * Decode a WAV File into an AudioBuffer.
 * Uses the Web Audio API's built-in decoder which handles
 * 16-bit, 24-bit, 32-bit float, various sample rates, etc.
 */
export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const ac = await ensureResumed();
  const arrayBuffer = await file.arrayBuffer();
  return ac.decodeAudioData(arrayBuffer);
}
