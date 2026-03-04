/**
 * Main entry point — wires all modules together and handles UI events.
 *
 * Uses pointer events throughout for unified touch + mouse handling.
 */

import { decodeAudioFile } from './audio.js';
import { generatePeaks, drawWaveform, pixelToSample, type Peaks } from './waveform.js';
import {
  createSlicer, addMarker, removeMarker, moveMarker,
  getRegions, hitTestMarker, findRegionAt, type SlicerState
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
let draggingMarker: number | null = null;
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
  if (e.relatedTarget === null) {
    dropZone.classList.add('hidden');
  }
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.add('hidden');
  const file = e.dataTransfer?.files[0];
  if (file && file.name.toLowerCase().endsWith('.wav')) {
    loadFile(file);
  }
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
    selectedSlice = 0;
    editor.classList.remove('hidden');

    // Wait one frame for the browser to lay out the now-visible editor,
    // otherwise the canvas has zero dimensions and nothing renders.
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

  // Hit-test: are we near an existing marker? (tolerance = canvas width / 200 in samples)
  const tolerancePx = 10;
  const toleranceSamples = (tolerancePx / canvas.getBoundingClientRect().width) * slicer.totalSamples;
  const hitIdx = hitTestMarker(slicer, sample, toleranceSamples);

  if (hitIdx >= 0) {
    // Start dragging
    draggingMarker = hitIdx;
    canvas.setPointerCapture(e.pointerId);
  } else {
    // Add new marker
    addMarker(slicer, sample);
    selectedSlice = findRegionAt(slicer, sample);
    redraw();
    renderSliceList();
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (draggingMarker === null || !slicer) return;
  const sample = pixelToSample(canvas, e.clientX, slicer.totalSamples);
  moveMarker(slicer, draggingMarker, sample);
  redraw();
  renderSliceList();
});

canvas.addEventListener('pointerup', () => {
  draggingMarker = null;
});

// --- Transport controls ---
btnPlay.addEventListener('click', async () => {
  if (!audioBuffer || !slicer) return;
  const regions = getRegions(slicer);
  const idx = selectedSlice ?? 0;
  const [start, end] = regions[idx];
  await playRegion(audioBuffer, start, end, isLooping);
});

btnLoop.addEventListener('click', () => {
  isLooping = !isLooping;
  btnLoop.classList.toggle('active', isLooping);

  // If already playing, restart with loop toggled
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
  (sample) => {
    playheadSample = sample;
    redraw();
  },
  () => {
    playheadSample = null;
    redraw();
  }
);

// --- Drawing ---
function redraw(): void {
  if (!audioBuffer || !slicer) return;

  const rect = canvas.getBoundingClientRect();
  const width = Math.floor(rect.width);

  // Regenerate peaks if canvas width changed
  if (!peaks || peaks.length !== width) {
    peaks = generatePeaks(audioBuffer, width);
  }

  drawWaveform(canvas, {
    peaks,
    markers: slicer.markers,
    totalSamples: slicer.totalSamples,
    playheadSample,
    selectedSlice,
  });
}

// Redraw on resize
window.addEventListener('resize', () => {
  peaks = null; // Force peak regeneration
  redraw();
});

// --- Slice list ---
function renderSliceList(): void {
  if (!slicer || !audioBuffer) return;

  const regions = getRegions(slicer);
  slicesUl.innerHTML = '';

  regions.forEach(([start, end], i) => {
    const li = document.createElement('li');
    if (i === selectedSlice) li.classList.add('selected');

    const startSec = (start / audioBuffer!.sampleRate).toFixed(2);
    const endSec = (end / audioBuffer!.sampleRate).toFixed(2);
    const durSec = ((end - start) / audioBuffer!.sampleRate).toFixed(2);

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
      if (audioBuffer) await playRegion(audioBuffer, start, end, isLooping);
    });

    const exportBtn = document.createElement('button');
    exportBtn.textContent = '⬇';
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!audioBuffer) return;
      const baseName = fileNameEl.textContent?.replace('.wav', '') ?? 'slice';
      const blob = encodeWav(audioBuffer, start, end);
      downloadBlob(blob, `${baseName}_${String(i + 1).padStart(3, '0')}.wav`);
    });

    // Delete marker button (not for first/last implicit boundaries)
    if (i < regions.length - 1) {
      const delBtn = document.createElement('button');
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (slicer) {
          removeMarker(slicer, i);
          if (selectedSlice !== null && selectedSlice >= getRegions(slicer).length) {
            selectedSlice = getRegions(slicer).length - 1;
          }
          redraw();
          renderSliceList();
        }
      });
      btnGroup.appendChild(delBtn);
    }

    btnGroup.appendChild(playBtn);
    btnGroup.appendChild(exportBtn);
    li.appendChild(info);
    li.appendChild(btnGroup);
    slicesUl.appendChild(li);
  });
}
