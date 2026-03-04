/**
 * Main entry point — wires all modules together and handles UI events.
 *
 * Slice creation is two clicks: first click sets start, second sets end.
 * Uses pointer events throughout for unified touch + mouse handling.
 */

import { decodeAudioFile } from './audio.js';
import { generatePeaks, drawWaveform, pixelToSample, sliceColor, type Peaks } from './waveform.js';
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

  const sample = pixelToSample(canvas, e.clientX, slicer.totalSamples);
  const tolerancePx = 12;
  const toleranceSamples = (tolerancePx / canvas.getBoundingClientRect().width) * slicer.totalSamples;

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
  const sample = pixelToSample(canvas, e.clientX, slicer.totalSamples);
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

  if (!peaks || peaks.length !== width) {
    peaks = generatePeaks(audioBuffer, width);
  }

  drawWaveform(canvas, {
    peaks,
    slices: slicer.slices,
    totalSamples: slicer.totalSamples,
    playheadSample,
    selectedSlice,
    pendingStart: slicer.pendingStart,
  });
}

window.addEventListener('resize', () => {
  peaks = null;
  redraw();
});

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
