/**
 * Main entry point — wires all modules together and handles UI events.
 *
 * Slice creation is two clicks: first click sets start, second sets end.
 * Uses pointer events throughout for unified touch + mouse handling.
 */

import { decodeAudioFile } from './audio.js';
import { generatePeaks, drawWaveform, pixelToSample, sliceColor, invalidateThemeCache, type Peaks } from './waveform.js';
import { getViewport, resetViewport, onWheel, onPointerMove, ensureVisible } from './viewport.js';
import {
  createSlicer, beginSlice, endSlice, cancelPending,
  removeSlice, moveMarker, hitTestMarker, hitTestMarkerPreferSelected,
  findSliceAt,
  type SlicerState, type MarkerHit,
} from './slicer.js';
import { playRegion, stop, setCallbacks, getPlaybackState } from './player.js';
import { encodeWav, downloadBlob } from './wav-writer.js';
import { pushUndo, undo, redo, cloneSnapshot, clearHistory, type Snapshot } from './undo.js';

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
const btnSettings = document.getElementById('btn-settings') as HTMLButtonElement;

// --- App state ---
let audioBuffer: AudioBuffer | null = null;
let peaks: Peaks | null = null;
let slicer: SlicerState | null = null;
let selectedSlice: number | null = null;
let selectedMarker: 'start' | 'end' | null = null;
let playheadSample: number | null = null;
let dragging: MarkerHit | null = null;
let pendingDrag: { hit: MarkerHit; startX: number } | null = null;
const DRAG_THRESHOLD_PX = 5;
let isLooping = false;

// --- Undo/redo helpers ---
function saveSnapshot(): void {
  if (!slicer) return;
  pushUndo(cloneSnapshot({
    slices: slicer.slices,
    pendingStart: slicer.pendingStart,
    selectedSlice,
  }));
}

function currentSnapshot(): Snapshot {
  return cloneSnapshot({
    slices: slicer?.slices ?? [],
    pendingStart: slicer?.pendingStart ?? null,
    selectedSlice,
  });
}

function restoreSnapshot(snap: Snapshot): void {
  if (!slicer) return;
  slicer.slices = snap.slices;
  slicer.pendingStart = snap.pendingStart;
  selectedSlice = snap.selectedSlice;
  redraw();
  renderSliceList();
}

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
    clearHistory();
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

// --- Settings popover ---
const settingsPopover = document.getElementById('settings-popover') as HTMLElement;
const themeSelect = document.getElementById('theme-select') as HTMLSelectElement;

btnSettings.addEventListener('click', (e) => {
  e.stopPropagation();
  settingsPopover.classList.toggle('hidden');
});

// Close popover when clicking outside
document.addEventListener('pointerdown', (e) => {
  if (!settingsPopover.classList.contains('hidden') &&
      !settingsPopover.contains(e.target as Node) &&
      e.target !== btnSettings) {
    settingsPopover.classList.add('hidden');
  }
});

themeSelect.addEventListener('change', () => {
  const theme = themeSelect.value;
  if (theme === 'midnight') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  invalidateThemeCache();
  peaks = null;
  redraw();
  renderSliceList();
});

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
    // --- Top 10%: selection only (no dragging) ---
    // Near a marker? Select its slice.
    const edgeHit = hitTestMarkerPreferSelected(slicer, sample, toleranceSamples, selectedSlice);
    if (edgeHit) {
      selectedSlice = edgeHit.sliceIndex;
      selectedMarker = null;
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
    selectedMarker = null;
    redraw();
    renderSliceList();
    return;
  }

  // --- Bottom 80%: marker placement zone ---

  // First: try to grab an existing marker (defer drag until threshold)
  const hit = hitTestMarker(slicer, sample, toleranceSamples);
  if (hit) {
    pendingDrag = { hit, startX: e.clientX };
    selectedSlice = hit.sliceIndex;
    selectedMarker = hit.which;
    canvas.setPointerCapture(e.pointerId);
    redraw();
    renderSliceList();
    return;
  }

  // Second: if we have a pending start, complete the slice
  if (slicer.pendingStart !== null) {
    saveSnapshot(); // before completing slice
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
  saveSnapshot(); // before placing start marker
  beginSlice(slicer, sample);
  console.log('[making-waves] Slice start placed — click again to set end');
  redraw();
});

canvas.addEventListener('pointermove', (e) => {
  // Mouse moved without drag — reset zoom anchor so next zoom targets new position
  if (dragging === null && pendingDrag === null) onPointerMove();

  // Update cursor based on position
  if (dragging === null && pendingDrag === null && slicer) {
    const rect = canvas.getBoundingClientRect();
    const yRatio = (e.clientY - rect.top) / rect.height;
    if (yRatio <= SELECT_ZONE) {
      canvas.style.cursor = 'pointer';
    } else {
      const vp = getViewport();
      const vpLen = vp.end - vp.start;
      const toleranceSamples = (12 / rect.width) * vpLen;
      const sample = pixelToSample(canvas, e.clientX, vp);
      const hit = hitTestMarker(slicer, sample, toleranceSamples);
      canvas.style.cursor = hit ? 'grab' : 'crosshair';
    }
  }

  // Promote pending drag to real drag once threshold is crossed
  if (pendingDrag && !dragging) {
    const dx = Math.abs(e.clientX - pendingDrag.startX);
    if (dx >= DRAG_THRESHOLD_PX) {
      saveSnapshot(); // before drag
      dragging = pendingDrag.hit;
      pendingDrag = null;
    } else {
      return; // still within threshold, don't move anything
    }
  }

  if (!dragging || !slicer) return;
  const sample = pixelToSample(canvas, e.clientX, getViewport());
  const newIdx = moveMarker(slicer, dragging.sliceIndex, dragging.which, sample);
  dragging = { ...dragging, sliceIndex: newIdx };
  selectedSlice = newIdx;
  redraw();
  renderSliceList();
});

canvas.addEventListener('pointerup', () => {
  // If we had a pending drag that never crossed threshold, it's a click — select the marker
  // (already selected in pointerdown, so just clean up)
  pendingDrag = null;
  dragging = null;
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (slicer && slicer.pendingStart !== null) {
      saveSnapshot(); // before cancelling pending
      cancelPending(slicer);
      console.log('[making-waves] Pending slice cancelled');
    } else if (selectedMarker !== null) {
      selectedMarker = null;
      console.log('[making-waves] Marker deselected');
    } else if (selectedSlice !== null) {
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

  // u/U or Cmd-Z/Ctrl-Z — undo/redo
  const mod = e.metaKey || e.ctrlKey;
  if (slicer && ((e.key === 'u' && !e.shiftKey && !mod) || (e.key === 'z' && mod && !e.shiftKey))) {
    e.preventDefault();
    const snap = undo(currentSnapshot());
    if (snap) {
      restoreSnapshot(snap);
      console.log('[making-waves] Undo');
    }
  }
  if (slicer && ((e.key === 'U' && !mod) || (e.key === 'z' && mod && e.shiftKey))) {
    e.preventDefault();
    const snap = redo(currentSnapshot());
    if (snap) {
      restoreSnapshot(snap);
      console.log('[making-waves] Redo');
    }
  }

  // j/k/ArrowDown/ArrowUp — select next/previous slice
  if ((e.key === 'j' || e.key === 'k' || e.key === 'ArrowDown' || e.key === 'ArrowUp') && slicer && slicer.slices.length > 0) {
    e.preventDefault();
    const forward = e.key === 'j' || e.key === 'ArrowDown';
    if (selectedSlice === null) {
      selectedSlice = forward ? 0 : slicer.slices.length - 1;
    } else {
      const delta = forward ? 1 : -1;
      selectedSlice = Math.max(0, Math.min(slicer.slices.length - 1, selectedSlice + delta));
    }
    selectedMarker = null;
    ensureSliceVisible(selectedSlice);
    redraw();
    renderSliceList();
  }

  // h/l/ArrowLeft/ArrowRight — select or nudge marker
  if ((e.key === 'h' || e.key === 'l' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') && slicer && selectedSlice !== null && selectedSlice < slicer.slices.length) {
    e.preventDefault();
    const left = e.key === 'h' || e.key === 'ArrowLeft';
    if (selectedMarker === null) {
      // No marker selected: left picks start, right picks end
      selectedMarker = left ? 'start' : 'end';
    } else {
      // Marker selected: nudge it. Amount scales with zoom level.
      const vp = getViewport();
      const vpLen = vp.end - vp.start;
      const nudge = Math.max(1, Math.round(vpLen * 0.005));
      const delta = left ? -nudge : nudge;
      saveSnapshot();
      const newIdx = moveMarker(slicer, selectedSlice, selectedMarker, slicer.slices[selectedSlice][selectedMarker] + delta);
      selectedSlice = newIdx;
    }
    // Ensure the selected marker is visible
    const markerSample = slicer.slices[selectedSlice][selectedMarker];
    ensureVisible(markerSample, markerSample);
    peaks = null;
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
    selectedMarker,
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
      saveSnapshot(); // before delete
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
