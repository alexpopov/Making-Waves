/**
 * Main entry point — wires all modules together and handles UI events.
 *
 * Slice creation is two clicks: first click sets start, second sets end.
 * Uses pointer events throughout for unified touch + mouse handling.
 */

import { decodeAudioFile } from './audio.js';
import { generatePeaks, drawWaveform, pixelToSample, sliceColor, type Peaks, type Viewport } from './waveform.js';
import {
  createSlicer, beginSlice, endSlice, cancelPending,
  removeSlice, moveMarker, hitTestMarker,
  type SlicerState, type MarkerHit,
} from './slicer.js';
import { playRegion, stop, setCallbacks, getPlaybackState } from './player.js';
import { encodeWav, downloadBlob } from './wav-writer.js';

// --- DOM elements ---
const btnLoad = document.getElementById('btn-load') as HTMLButtonElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const fileNameEl = document.getElementById('file-name') as HTMLSpanElement;
const editor = document.getElementById('editor') as HTMLElement;
const canvas = document.getElementById('waveform') as HTMLCanvasElement;
const btnPlay = document.getElementById('btn-play') as HTMLButtonElement;
const btnLoop = document.getElementById('btn-loop') as HTMLButtonElement;
const btnStop = document.getElementById('btn-stop') as HTMLButtonElement;
const slicesUl = document.getElementById('slices') as HTMLUListElement;
const dropZone = document.getElementById('drop-zone') as HTMLElement;

// --- App state ---
let audioBuffer: AudioBuffer | null = null;
let peaks: Peaks | null = null;
let slicer: SlicerState | null = null;
let selectedSlice: number | null = null;
let playheadSample: number | null = null;
let dragging: MarkerHit | null = null;
let isLooping = false;

// Viewport: which sample range is visible. Zoom changes the span.
let viewport: Viewport = { start: 0, end: 1 };

// --- File loading ---
btnLoad.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) loadFile(file);
});

// Drag-and-drop
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.remove('hidden');
});
document.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) dropZone.classList.add('hidden');
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.add('hidden');
  const file = e.dataTransfer?.files[0];
  if (file && file.name.toLowerCase().endsWith('.wav')) loadFile(file);
});

async function loadFile(file: File): Promise<void> {
  fileNameEl.textContent = file.name;
  console.log('[making-waves] Loading file:', file.name, `(${(file.size / 1024 / 1024).toFixed(1)} MB)`);
  try {
    audioBuffer = await decodeAudioFile(file);
    console.log('[making-waves] Decoded:', {
      channels: audioBuffer.numberOfChannels,
      sampleRate: audioBuffer.sampleRate,
      duration: audioBuffer.duration.toFixed(2) + 's',
      samples: audioBuffer.length,
    });
    slicer = createSlicer(audioBuffer.length);
    selectedSlice = null;
    viewport = { start: 0, end: audioBuffer.length };
    editor.classList.remove('hidden');

    requestAnimationFrame(() => {
      console.log('[making-waves] Canvas size:', canvas.getBoundingClientRect().width, 'x', canvas.getBoundingClientRect().height);
      redraw();
      renderSliceList();
    });
  } catch (err) {
    console.error('[making-waves] Load error:', err);
    fileNameEl.textContent = `Error: ${err}`;
  }
}

// --- Waveform interaction (pointer events) ---

canvas.addEventListener('pointerdown', (e) => {
  if (!slicer || !audioBuffer) return;

  const sample = pixelToSample(canvas, e.clientX, viewport);
  const tolerancePx = 12;
  // Tolerance in samples scales with zoom — when zoomed in, markers are easier to grab
  const vpLen = viewport.end - viewport.start;
  const toleranceSamples = (tolerancePx / canvas.getBoundingClientRect().width) * vpLen;

  // First: try to grab an existing marker
  const hit = hitTestMarker(slicer, sample, toleranceSamples);
  if (hit) {
    dragging = hit;
    selectedSlice = hit.sliceIndex;
    canvas.setPointerCapture(e.pointerId);
    redraw();
    renderSliceList();
    return;
  }

  // Second: if we have a pending start, complete the slice
  if (slicer.pendingStart !== null) {
    const idx = endSlice(slicer, sample);
    if (idx >= 0) {
      selectedSlice = idx;
      console.log(`[making-waves] Slice #${idx + 1} created`);
    }
    redraw();
    renderSliceList();
    return;
  }

  // Third: begin a new slice
  beginSlice(slicer, sample);
  console.log('[making-waves] Slice start placed — click again to set end');
  redraw();
});

canvas.addEventListener('pointermove', (e) => {
  if (!dragging || !slicer) return;
  const sample = pixelToSample(canvas, e.clientX, viewport);
  moveMarker(slicer, dragging.sliceIndex, dragging.which, sample);
  redraw();
  renderSliceList();
});

canvas.addEventListener('pointerup', () => {
  dragging = null;
});

// Escape cancels pending slice
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && slicer && slicer.pendingStart !== null) {
    cancelPending(slicer);
    console.log('[making-waves] Pending slice cancelled');
    redraw();
  }
});

// --- Transport controls ---
btnPlay.addEventListener('click', async () => {
  if (!audioBuffer || !slicer) return;
  if (selectedSlice !== null && selectedSlice < slicer.slices.length) {
    const s = slicer.slices[selectedSlice];
    await playRegion(audioBuffer, s.start, s.end, isLooping);
  }
});

btnLoop.addEventListener('click', () => {
  isLooping = !isLooping;
  btnLoop.classList.toggle('active', isLooping);

  const ps = getPlaybackState();
  if (ps.isPlaying && audioBuffer) {
    playRegion(audioBuffer, ps.startSample, ps.endSample, isLooping);
  }
});

btnStop.addEventListener('click', () => {
  stop();
  playheadSample = null;
  redraw();
});

// --- Playback callbacks ---
setCallbacks(
  (sample) => { playheadSample = sample; redraw(); },
  () => { playheadSample = null; redraw(); }
);

// --- Drawing ---
function redraw(): void {
  if (!audioBuffer || !slicer) return;

  const rect = canvas.getBoundingClientRect();
  const width = Math.floor(rect.width);

  // Regenerate peaks if canvas width changed or viewport changed
  if (!peaks || peaks.length !== width ||
      peaks.vpStart !== viewport.start || peaks.vpEnd !== viewport.end) {
    peaks = generatePeaks(audioBuffer, width, viewport);
  }

  drawWaveform(canvas, {
    peaks,
    slices: slicer.slices,
    totalSamples: slicer.totalSamples,
    viewport,
    playheadSample,
    selectedSlice,
    pendingStart: slicer.pendingStart,
  });
}

window.addEventListener('resize', () => {
  peaks = null;
  redraw();
});

// --- Zoom & pan (scroll wheel / trackpad) ---
// Direction locks on first event of a gesture and holds until scrolling stops.
// Vertical = zoom, horizontal = pan. Never both at once.
let scrollLock: 'pan' | 'zoom' | null = null;
let scrollLockTimer: ReturnType<typeof setTimeout> | null = null;

canvas.addEventListener('wheel', (e) => {
  if (!slicer) return;
  e.preventDefault();

  // Lock direction on first event; hold until 150ms of silence
  if (scrollLock === null) {
    scrollLock = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? 'pan' : 'zoom';
  }
  if (scrollLockTimer !== null) clearTimeout(scrollLockTimer);
  scrollLockTimer = setTimeout(() => { scrollLock = null; scrollLockTimer = null; }, 150);

  const totalSamples = slicer.totalSamples;
  const vpLen = viewport.end - viewport.start;

  if (scrollLock === 'pan') {
    // --- Horizontal: pan ---
    // deltaX > 0 = swipe left = scroll right (later in the file)
    const panSamples = (e.deltaX / canvas.getBoundingClientRect().width) * vpLen;
    let newStart = viewport.start + panSamples;
    let newEnd = viewport.end + panSamples;

    // Clamp
    if (newStart < 0) { newEnd -= newStart; newStart = 0; }
    if (newEnd > totalSamples) { newStart -= (newEnd - totalSamples); newEnd = totalSamples; }

    viewport = { start: Math.floor(Math.max(0, newStart)), end: Math.floor(Math.min(totalSamples, newEnd)) };
  } else {
    // --- Vertical: zoom toward cursor with fall-off ---
    // Always zoom toward where the mouse is pointing.
    // Fall-off: the more zoomed in, the smaller each step.
    // zoomRatio is 1.0 when fully zoomed out, approaches 0 when deep in.
    const anchor = pixelToSample(canvas, e.clientX, viewport);
    const zoomRatio = vpLen / totalSamples;
    // Base factor 0.15, scaled by sqrt of zoom ratio for smooth fall-off
    const strength = 0.15 * Math.sqrt(zoomRatio);
    const direction = e.deltaY > 0 ? 1 : -1; // down = zoom out, up = zoom in
    const factor = 1 + direction * strength;
    const newLen = Math.min(totalSamples, Math.max(100, vpLen * factor));

    // Keep the anchor at the same proportional position in the viewport
    const anchorRatio = (anchor - viewport.start) / vpLen;
    let newStart = anchor - anchorRatio * newLen;
    let newEnd = newStart + newLen;

    // Clamp
    if (newStart < 0) { newEnd -= newStart; newStart = 0; }
    if (newEnd > totalSamples) { newStart -= (newEnd - totalSamples); newEnd = totalSamples; }
    newStart = Math.max(0, newStart);
    newEnd = Math.min(totalSamples, newEnd);

    viewport = { start: Math.floor(newStart), end: Math.floor(newEnd) };
  }

  peaks = null;
  redraw();
}, { passive: false });

// --- Slice list ---
function renderSliceList(): void {
  if (!slicer || !audioBuffer) return;

  slicesUl.innerHTML = '';

  if (slicer.slices.length === 0) {
    const li = document.createElement('li');
    li.style.color = 'var(--text-dim)';
    li.textContent = 'Click waveform to set slice start, click again for end';
    slicesUl.appendChild(li);
    return;
  }

  slicer.slices.forEach((slice, i) => {
    const li = document.createElement('li');
    if (i === selectedSlice) li.classList.add('selected');
    li.style.borderLeft = `3px solid ${sliceColor(i)}`;
    li.style.paddingLeft = '8px';

    const startSec = (slice.start / audioBuffer!.sampleRate).toFixed(2);
    const endSec = (slice.end / audioBuffer!.sampleRate).toFixed(2);
    const durSec = ((slice.end - slice.start) / audioBuffer!.sampleRate).toFixed(2);

    const info = document.createElement('span');
    info.textContent = `#${i + 1}  ${startSec}s – ${endSec}s  (${durSec}s)`;
    info.style.cursor = 'pointer';
    info.addEventListener('click', () => {
      selectedSlice = i;
      redraw();
      renderSliceList();
    });

    const btnGroup = document.createElement('span');

    const playBtn = document.createElement('button');
    playBtn.textContent = '▶';
    playBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      selectedSlice = i;
      redraw();
      renderSliceList();
      if (audioBuffer) await playRegion(audioBuffer, slice.start, slice.end, isLooping);
    });

    const exportBtn = document.createElement('button');
    exportBtn.textContent = '⬇';
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!audioBuffer) return;
      const baseName = fileNameEl.textContent?.replace('.wav', '') ?? 'slice';
      const blob = encodeWav(audioBuffer, slice.start, slice.end);
      downloadBlob(blob, `${baseName}_${String(i + 1).padStart(3, '0')}.wav`);
    });

    const delBtn = document.createElement('button');
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!slicer) return;
      removeSlice(slicer, i);
      if (selectedSlice !== null && selectedSlice >= slicer.slices.length) {
        selectedSlice = slicer.slices.length > 0 ? slicer.slices.length - 1 : null;
      }
      redraw();
      renderSliceList();
    });

    btnGroup.appendChild(delBtn);
    btnGroup.appendChild(playBtn);
    btnGroup.appendChild(exportBtn);
    li.appendChild(info);
    li.appendChild(btnGroup);
    slicesUl.appendChild(li);
  });
}
