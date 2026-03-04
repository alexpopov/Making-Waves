/**
 * Main entry point — wires all modules together and handles UI events.
 *
 * Slice creation is two clicks: first click sets start, second sets end.
 * Uses pointer events throughout for unified touch + mouse handling.
 */

import { decodeAudioFile } from './audio.js';
import { generatePeaks, drawWaveform, pixelToSample, sliceColor, type Peaks } from './waveform.js';
import { getViewport, resetViewport, onWheel, onPointerMove, ensureVisible } from './viewport.js';
import {
  createSlicer, beginSlice, endSlice, cancelPending,
  removeSlice, moveMarker, hitTestMarker, hitTestMarkerPreferSelected,
  findSliceAt,
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
    resetViewport(audioBuffer.length);
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

const SELECT_ZONE = 0.10; // top 10% of canvas = selection zone

canvas.addEventListener('pointerdown', (e) => {
  if (!slicer || !audioBuffer) return;

  const rect = canvas.getBoundingClientRect();
  const vp = getViewport();
  const sample = pixelToSample(canvas, e.clientX, vp);
  const vpLen = vp.end - vp.start;
  const yRatio = (e.clientY - rect.top) / rect.height;
  const tolerancePx = 12;
  const toleranceSamples = (tolerancePx / rect.width) * vpLen;

  if (yRatio <= SELECT_ZONE) {
    // --- Top 20%: selection zone ---
    // Near an edge marker? Grab it (prefer the currently selected slice's markers).
    const edgeHit = hitTestMarkerPreferSelected(slicer, sample, toleranceSamples, selectedSlice);
    if (edgeHit) {
      dragging = edgeHit;
      selectedSlice = edgeHit.sliceIndex;
      canvas.setPointerCapture(e.pointerId);
      redraw();
      renderSliceList();
      return;
    }

    // Otherwise, select the slice region we clicked inside
    const sliceIdx = findSliceAt(slicer, sample);
    if (sliceIdx >= 0) {
      selectedSlice = sliceIdx;
    } else {
      selectedSlice = null;
    }
    redraw();
    renderSliceList();
    return;
  }

  // --- Bottom 80%: marker placement zone ---

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
  // Mouse moved without drag — reset zoom anchor so next zoom targets new position
  if (dragging === null) onPointerMove();

  // Update cursor based on Y position
  if (dragging === null) {
    const rect = canvas.getBoundingClientRect();
    const yRatio = (e.clientY - rect.top) / rect.height;
    canvas.style.cursor = yRatio <= SELECT_ZONE ? 'pointer' : 'crosshair';
  }

  if (!dragging || !slicer) return;
  const sample = pixelToSample(canvas, e.clientX, getViewport());
  moveMarker(slicer, dragging.sliceIndex, dragging.which, sample);
  redraw();
  renderSliceList();
});

canvas.addEventListener('pointerup', () => {
  dragging = null;
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (slicer && slicer.pendingStart !== null) {
      cancelPending(slicer);
      console.log('[making-waves] Pending slice cancelled');
    }
    if (selectedSlice !== null) {
      selectedSlice = null;
      console.log('[making-waves] Selection cleared');
    }
    redraw();
    renderSliceList();
  }

  if (e.key === ' ') {
    e.preventDefault(); // don't scroll the page
    const ps = getPlaybackState();
    if (ps.isPlaying) {
      stop();
      playheadSample = null;
      redraw();
    } else if (audioBuffer && slicer && selectedSlice !== null && selectedSlice < slicer.slices.length) {
      const s = slicer.slices[selectedSlice];
      playRegion(audioBuffer, s.start, s.end, isLooping);
    }
  }

  // j/k — select next/previous slice
  if ((e.key === 'j' || e.key === 'k') && slicer && slicer.slices.length > 0) {
    if (selectedSlice === null) {
      selectedSlice = e.key === 'j' ? 0 : slicer.slices.length - 1;
    } else {
      const delta = e.key === 'j' ? 1 : -1;
      selectedSlice = Math.max(0, Math.min(slicer.slices.length - 1, selectedSlice + delta));
    }
    ensureSliceVisible(selectedSlice);
    redraw();
    renderSliceList();
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

// --- Viewport follow ---
function ensureSliceVisible(sliceIdx: number): void {
  if (!slicer || sliceIdx < 0 || sliceIdx >= slicer.slices.length) return;
  const s = slicer.slices[sliceIdx];
  ensureVisible(s.start, s.end);
  peaks = null; // viewport may have changed
}

// --- Drawing ---
function redraw(): void {
  if (!audioBuffer || !slicer) return;

  const rect = canvas.getBoundingClientRect();
  const width = Math.floor(rect.width);

  const vp = getViewport();

  // Regenerate peaks if canvas width changed or viewport changed
  if (!peaks || peaks.length !== width ||
      peaks.vpStart !== vp.start || peaks.vpEnd !== vp.end) {
    peaks = generatePeaks(audioBuffer, width, vp);
  }

  drawWaveform(canvas, {
    peaks,
    slices: slicer.slices,
    totalSamples: slicer.totalSamples,
    viewport: vp,
    playheadSample,
    selectedSlice,
    pendingStart: slicer.pendingStart,
  });
}

window.addEventListener('resize', () => {
  peaks = null;
  redraw();
});

// --- Zoom & pan (delegated to viewport module) ---
canvas.addEventListener('wheel', (e) => {
  if (!slicer) return;
  e.preventDefault();
  if (onWheel(e, canvas)) {
    peaks = null;
    redraw();
  }
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
