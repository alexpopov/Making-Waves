/**
 * AudioContext management and WAV file decoding.
 *
 * Uses 'interactive' latency hint for low-latency playback.
 * A silent keep-alive oscillator prevents Chrome from auto-suspending
 * the context after a few seconds of silence.
 * Eagerly resumes on user gestures so iOS Safari doesn't block audio.
 */

let ctx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive' });
    startKeepAlive(ctx);
  }
  return ctx;
}

/**
 * Resume AudioContext if suspended.
 * Call this synchronously inside a user gesture handler so iOS allows audio.
 * Returns the context immediately — the resume promise is fire-and-forget.
 */
export function ensureResumedSync(): AudioContext {
  const ac = getAudioContext();
  if (ac.state === 'suspended') {
    ac.resume();
  }
  return ac;
}

export async function ensureResumed(): Promise<AudioContext> {
  const ac = getAudioContext();
  if (ac.state === 'suspended') {
    await ac.resume();
  }
  return ac;
}

// Eagerly resume on any user gesture (iOS requires this in the gesture handler)
function onUserGesture(): void {
  if (ctx?.state === 'suspended') {
    ctx.resume();
  }
}
document.addEventListener('pointerdown', onUserGesture, { capture: true });
document.addEventListener('keydown', onUserGesture, { capture: true });

/**
 * Keep the AudioContext alive with a silent oscillator.
 * Chrome auto-suspends after ~5s of no audio output, which causes
 * a ~500ms resume delay on next play. A zero-gain oscillator prevents this.
 */
function startKeepAlive(ac: AudioContext): void {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  gain.gain.value = 0;
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start();
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
