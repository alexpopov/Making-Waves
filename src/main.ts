/**
 * Main entry point — wires all modules together and handles UI events.
 *
 * Slice creation is two clicks: first click sets start, second sets end.
 * Uses pointer events throughout for unified touch + mouse handling.
 */

import { debug } from './debug.js';
import { decodeAudioFile } from './audio.js';
import { generatePeaks, drawWaveform, pixelToSample, sliceColor, invalidateThemeCache, type Peaks } from './waveform.js';
import { getViewport, resetViewport, onWheel, onPointerMove, ensureVisible, zoomToRange, setViewport, type Viewport } from './viewport.js';
import {
  createSlicer, beginSlice, endSlice, cancelPending,
  removeSlice, moveMarker, hitTestMarker, hitTestMarkerPreferSelected,
  findSliceAt,
  type SlicerState, type MarkerHit,
} from './slicer.js';
import { playRegion, stop, setCallbacks, getPlaybackState } from './player.js';
import { encodeWav, downloadBlob, encodeWavToUint8Array } from './wav-writer.js';
import { createZip } from './zip-writer.js';
import { readZip } from './zip-reader.js';
import { pushUndo, undo, redo, cloneSnapshot, clearHistory, type Snapshot } from './undo.js';

// --- DOM elements ---
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const projectInput = document.getElementById('project-input') as HTMLInputElement;
const projectTitleEl = document.getElementById('project-title') as HTMLSpanElement;
const btnClose = document.getElementById('btn-close') as HTMLButtonElement;
const startScreen = document.getElementById('start-screen') as HTMLElement;
const btnLoadWav = document.getElementById('btn-load-wav') as HTMLButtonElement;
const btnLoadProject = document.getElementById('btn-load-project') as HTMLButtonElement;
const editor = document.getElementById('editor') as HTMLElement;
const canvas = document.getElementById('waveform') as HTMLCanvasElement;
const btnPlay = document.getElementById('btn-play') as HTMLButtonElement;
const btnLoop = document.getElementById('btn-loop') as HTMLButtonElement;
const btnStop = document.getElementById('btn-stop') as HTMLButtonElement;
const slicesUl = document.getElementById('slices') as HTMLUListElement;
const dropZone = document.getElementById('drop-zone') as HTMLElement;
const btnSettings = document.getElementById('btn-settings') as HTMLButtonElement;
const btnSaveProject = document.getElementById('btn-save-project') as HTMLButtonElement;
const btnSaveJson = document.getElementById('btn-save-json') as HTMLButtonElement;

// --- App state ---
let audioBuffer: AudioBuffer | null = null;
let originalFile: File | null = null;
let peaks: Peaks | null = null;
let slicer: SlicerState | null = null;
let selectedSlice: number | null = null;
let selectedMarker: 'start' | 'end' | null = null;
let playheadSample: number | null = null;
let dragging: MarkerHit | null = null;
let pendingDrag: { hit: MarkerHit; startX: number } | null = null;
const DRAG_THRESHOLD_PX = 5;
let isLooping = false;
let zoomPrevViewport: Viewport | null = null;
let zoomLevel: 'out' | 'none' | 'segment' | 'marker' = 'out';
let projectName = '';

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
btnLoadWav.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) loadFile(file);
});

btnLoadProject.addEventListener('click', () => projectInput.click());
projectInput.addEventListener('change', () => {
  const file = projectInput.files?.[0];
  if (file) loadProject(file).catch(err => console.error('[making-waves] Unhandled project load error:', err));
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
  if (file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.wav')) loadFile(file);
    else if (name.endsWith('.zip')) loadProject(file);
  }
});

async function loadFile(file: File): Promise<void> {
  originalFile = file;
  projectName = file.name.replace(/\.wav$/i, '');
  debug('Loading file:', file.name, `(${(file.size / 1024 / 1024).toFixed(1)} MB)`);
  try {
    audioBuffer = await decodeAudioFile(file);
    debug('Decoded:', {
      channels: audioBuffer.numberOfChannels,
      sampleRate: audioBuffer.sampleRate,
      duration: audioBuffer.duration.toFixed(2) + 's',
      samples: audioBuffer.length,
    });
    slicer = createSlicer(audioBuffer.length);
    selectedSlice = null;
    clearHistory();
    resetViewport(audioBuffer.length);
    showEditor();

    requestAnimationFrame(() => {
      debug('Canvas size:', canvas.getBoundingClientRect().width, 'x', canvas.getBoundingClientRect().height);
      redraw();
      renderSliceList();
    });
  } catch (err) {
    console.error('[making-waves] Load error:', err);
    alert(`Error loading file: ${err}`);
  }
}

/** Show editor, hide start screen, update title bar */
function showEditor(): void {
  startScreen.classList.add('hidden');
  editor.classList.remove('hidden');
  projectTitleEl.textContent = projectName;
  projectTitleEl.classList.remove('hidden');
  btnClose.classList.remove('hidden');
}

/** Reset to start screen */
function closeProject(): void {
  stop();
  audioBuffer = null;
  originalFile = null;
  peaks = null;
  slicer = null;
  selectedSlice = null;
  selectedMarker = null;
  playheadSample = null;
  projectName = '';
  clearHistory();
  editor.classList.add('hidden');
  startScreen.classList.remove('hidden');
  projectTitleEl.classList.add('hidden');
  projectTitleEl.textContent = '';
  projectTitleEl.setAttribute('contenteditable', 'false');
  btnClose.classList.add('hidden');
}

// --- Load project from ZIP ---
async function loadProject(file: File): Promise<void> {
  debug('Loading project:', file.name);
  try {
    const buffer = await file.arrayBuffer();
    const entries = readZip(buffer);

    // Find the sidecar JSON
    const jsonEntry = entries.find(e => e.name.endsWith('.waves.json'));
    if (!jsonEntry) throw new Error('No .waves.json sidecar found in ZIP');

    const sidecar = JSON.parse(new TextDecoder().decode(jsonEntry.data)) as {
      version: number;
      projectName?: string;
      originalFile: string;
      sampleRate: number;
      totalSamples: number;
      slices: { start: number; end: number }[];
    };

    // Find the original WAV
    const wavEntry = entries.find(e => e.name === sidecar.originalFile) ??
                     entries.find(e => e.name.toLowerCase().endsWith('.wav'));
    if (!wavEntry) throw new Error('No WAV file found in ZIP');

    // Create a File object from the WAV data so decodeAudioFile can use it
    const wavFile = new File([wavEntry.data.buffer as ArrayBuffer], sidecar.originalFile, { type: 'audio/wav' });
    originalFile = wavFile;
    projectName = sidecar.projectName ?? sidecar.originalFile.replace(/\.wav$/i, '');

    audioBuffer = await decodeAudioFile(wavFile);
    slicer = createSlicer(audioBuffer.length);

    // Restore slices
    for (const s of sidecar.slices) {
      beginSlice(slicer, s.start);
      endSlice(slicer, s.end);
    }

    selectedSlice = null;
    clearHistory();
    resetViewport(audioBuffer.length);
    showEditor();

    requestAnimationFrame(() => {
      redraw();
      renderSliceList();
    });

    debug(`Project loaded: ${sidecar.slices.length} slices restored`);
  } catch (err) {
    console.error('[making-waves] Project load error:', err);
    alert(`Error loading project: ${err}`);
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

// --- Close project ---
btnClose.addEventListener('click', () => {
  if (!audioBuffer) return;
  const shouldSave = confirm('Save project before closing?');
  if (shouldSave) {
    // Trigger save, then close
    btnSaveProject.click();
  }
  closeProject();
});

// --- Editable project title ---
projectTitleEl.addEventListener('dblclick', () => {
  projectTitleEl.setAttribute('contenteditable', 'true');
  projectTitleEl.focus();
  // Select all text
  const range = document.createRange();
  range.selectNodeContents(projectTitleEl);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
});

projectTitleEl.addEventListener('blur', () => {
  projectTitleEl.setAttribute('contenteditable', 'false');
  const newName = projectTitleEl.textContent?.trim();
  if (newName) {
    projectName = newName;
  } else {
    projectTitleEl.textContent = projectName;
  }
});

projectTitleEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    projectTitleEl.blur();
  }
  if (e.key === 'Escape') {
    projectTitleEl.textContent = projectName;
    projectTitleEl.blur();
  }
  // Stop keyboard shortcuts from firing while editing title
  e.stopPropagation();
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
const MIN_MARKER_ZOOM = 500; // minimum sample range when zooming on a marker

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
      setSelection(edgeHit.sliceIndex, null);
      return;
    }

    // Otherwise, select the slice region we clicked inside
    const sliceIdx = findSliceAt(slicer, sample);
    setSelection(sliceIdx >= 0 ? sliceIdx : null, null);
    return;
  }

  // --- Bottom 80%: marker placement zone ---

  // First: try to grab an existing marker (defer drag until threshold)
  const hit = hitTestMarker(slicer, sample, toleranceSamples);
  if (hit) {
    pendingDrag = { hit, startX: e.clientX };
    canvas.setPointerCapture(e.pointerId);
    setSelection(hit.sliceIndex, hit.which);
    return;
  }

  // Second: if we have a pending start, complete the slice
  if (slicer.pendingStart !== null) {
    saveSnapshot(); // before completing slice
    const idx = endSlice(slicer, sample);
    if (idx >= 0) {
      debug(`Slice #${idx + 1} created`);
      setSelection(idx, null);
    }
    return;
  }

  // Third: begin a new slice
  saveSnapshot(); // before placing start marker
  beginSlice(slicer, sample);
  debug('Slice start placed — click again to set end');
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
      debug('Pending slice cancelled');
      redraw();
      renderSliceList();
    } else if (selectedMarker !== null) {
      debug('Marker deselected');
      setSelection(selectedSlice, null);
    } else if (selectedSlice !== null) {
      debug('Selection cleared');
      setSelection(null, null);
    }
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

  // Backspace/Delete — delete selected slice
  if ((e.key === 'Backspace' || e.key === 'Delete') && slicer && selectedSlice !== null && selectedSlice < slicer.slices.length) {
    e.preventDefault();
    saveSnapshot();
    removeSlice(slicer, selectedSlice);
    const next = slicer.slices.length === 0 ? null : Math.min(selectedSlice, slicer.slices.length - 1);
    setSelection(next, null);
  }

  // . — toggle selected marker between start/end
  if (e.key === '.' && slicer && selectedSlice !== null && selectedSlice < slicer.slices.length) {
    const next = selectedMarker === null ? 'start' : selectedMarker === 'start' ? 'end' : 'start';
    setSelection(selectedSlice, next);
  }

  // u/U or Cmd-Z/Ctrl-Z — undo/redo
  const mod = e.metaKey || e.ctrlKey;
  if (slicer && ((e.key === 'u' && !e.shiftKey && !mod) || (e.key === 'z' && mod && !e.shiftKey))) {
    e.preventDefault();
    const snap = undo(currentSnapshot());
    if (snap) {
      restoreSnapshot(snap);
      debug('Undo');
    }
  }
  if (slicer && ((e.key === 'U' && !mod) || (e.key === 'z' && mod && e.shiftKey))) {
    e.preventDefault();
    const snap = redo(currentSnapshot());
    if (snap) {
      restoreSnapshot(snap);
      debug('Redo');
    }
  }

  // j/k/ArrowDown/ArrowUp — select next/previous slice
  if ((e.key === 'j' || e.key === 'k' || e.key === 'ArrowDown' || e.key === 'ArrowUp') && slicer && slicer.slices.length > 0) {
    e.preventDefault();
    const forward = e.key === 'j' || e.key === 'ArrowDown';
    let next: number;
    if (selectedSlice === null) {
      next = forward ? 0 : slicer.slices.length - 1;
    } else {
      const delta = forward ? 1 : -1;
      next = Math.max(0, Math.min(slicer.slices.length - 1, selectedSlice + delta));
    }
    zoomLevel = 'out';
    zoomPrevViewport = null;
    setSelection(next, null);
  }

  // h/l/ArrowLeft/ArrowRight — select or nudge marker
  if ((e.key === 'h' || e.key === 'l' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') && slicer && selectedSlice !== null && selectedSlice < slicer.slices.length) {
    e.preventDefault();
    const left = e.key === 'h' || e.key === 'ArrowLeft';
    if (selectedMarker === null) {
      // No marker selected: left picks start, right picks end
      setSelection(selectedSlice, left ? 'start' : 'end');
    } else {
      // Marker selected: nudge it. Amount scales with zoom level.
      const vp = getViewport();
      const vpLen = vp.end - vp.start;
      const nudge = Math.max(1, Math.round(vpLen * 0.005));
      const delta = left ? -nudge : nudge;
      saveSnapshot();
      const newIdx = moveMarker(slicer, selectedSlice, selectedMarker, slicer.slices[selectedSlice][selectedMarker] + delta);
      setSelection(newIdx, selectedMarker);
    }
  }

  // z — toggle zoom based on selection state
  if (e.key === 'z' && !mod && slicer) {
    // Determine what zoom target matches current selection
    let targetLevel: 'none' | 'segment' | 'marker' = 'none';
    if (selectedSlice !== null && selectedSlice < slicer.slices.length && selectedMarker !== null) {
      targetLevel = 'marker';
    } else if (selectedSlice !== null && selectedSlice < slicer.slices.length) {
      targetLevel = 'segment';
    }

    // If we're zoomed in to the right target, zoom back out.
    // Otherwise, zoom in to the current target (even if already zoomed to something else).
    const shouldZoomOut = zoomLevel !== 'out' && zoomLevel === targetLevel;

    if (shouldZoomOut) {
      // Already zoomed in to this target — toggle back
      if (zoomPrevViewport) {
        setViewport(zoomPrevViewport);
        zoomPrevViewport = null;
      }
      zoomLevel = 'out';
    } else {
      // Save current viewport
      zoomPrevViewport = { ...getViewport() };

      if (selectedSlice !== null && selectedSlice < slicer.slices.length && selectedMarker !== null) {
        // Marker selected — zoom tight on the marker
        const s = slicer.slices[selectedSlice];
        const markerPos = s[selectedMarker];
        const markerRange = Math.max(MIN_MARKER_ZOOM, (s.end - s.start) * 0.08);
        zoomToRange(markerPos - markerRange, markerPos + markerRange, 0.1);
        zoomLevel = 'marker';
      } else if (selectedSlice !== null && selectedSlice < slicer.slices.length) {
        // Segment selected — zoom to fill with the segment
        const s = slicer.slices[selectedSlice];
        zoomToRange(s.start, s.end, 0.1);
        zoomLevel = 'segment';
      } else {
        // Nothing selected — zoom into the center of the viewport
        const vp = getViewport();
        const center = (vp.start + vp.end) / 2;
        const range = (vp.end - vp.start) * 0.15;
        zoomToRange(center - range, center + range, 0.1);
        zoomLevel = 'none';
      }
    }
    peaks = null;
    redraw();
  }
});

// --- Transport controls ---
btnPlay.addEventListener('click', () => {
  if (!audioBuffer || !slicer) return;
  if (selectedSlice !== null && selectedSlice < slicer.slices.length) {
    const s = slicer.slices[selectedSlice];
    playRegion(audioBuffer, s.start, s.end, isLooping);
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

// --- Save ---
btnSaveProject.addEventListener('click', async () => {
  if (!slicer || !audioBuffer || !originalFile) return;

  const baseName = projectName || originalFile.name.replace(/\.wav$/i, '');

  // Sidecar JSON
  const sidecar = {
    version: 1,
    projectName: baseName,
    originalFile: originalFile.name,
    sampleRate: audioBuffer.sampleRate,
    totalSamples: audioBuffer.length,
    slices: slicer.slices.map(s => ({ start: s.start, end: s.end })),
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(sidecar, null, 2));

  // Original WAV as Uint8Array
  const originalBytes = new Uint8Array(await originalFile.arrayBuffer());

  // Slice WAVs
  const entries: { name: string; data: Uint8Array }[] = [
    { name: originalFile.name, data: originalBytes },
    { name: `${baseName}.waves.json`, data: jsonBytes },
  ];

  slicer.slices.forEach((s, i) => {
    const sliceBytes = encodeWavToUint8Array(audioBuffer!, s.start, s.end);
    entries.push({ name: `${baseName}_${String(i + 1).padStart(3, '0')}.wav`, data: sliceBytes });
  });

  const zip = createZip(entries);
  downloadBlob(zip, `${baseName}.zip`);
});

btnSaveJson.addEventListener('click', () => {
  if (!slicer || !audioBuffer) return;
  const baseName = projectName || 'slices';
  const data = {
    version: 1,
    originalFile: originalFile?.name ?? `${baseName}.wav`,
    sampleRate: audioBuffer.sampleRate,
    totalSamples: audioBuffer.length,
    slices: slicer.slices.map(s => ({ start: s.start, end: s.end })),
  };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  downloadBlob(blob, `${baseName}.waves.json`);
});

// --- Playback callbacks ---
setCallbacks(
  (sample) => { playheadSample = sample; redraw(); },
  () => { playheadSample = null; redraw(); }
);

// --- Selection + viewport follow ---

/**
 * Central selection setter. Updates selectedSlice/selectedMarker,
 * scrolls the viewport to keep the focus visible, then redraws.
 */
function setSelection(slice: number | null, marker: 'start' | 'end' | null): void {
  selectedSlice = slice;
  selectedMarker = marker;
  followSelection();
  redraw();
  renderSliceList();
}

/** Ensure the current selection focus point is visible in the viewport. */
function followSelection(): void {
  if (!slicer || selectedSlice === null || selectedSlice >= slicer.slices.length) return;
  const s = slicer.slices[selectedSlice];
  if (selectedMarker !== null) {
    // Single marker — keep it centered-ish
    const markerSample = s[selectedMarker];
    ensureVisible(markerSample, markerSample);
  } else {
    // Whole segment
    ensureVisible(s.start, s.end);
  }
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
      setSelection(i, null);
    });

    const btnGroup = document.createElement('span');

    const playBtn = document.createElement('button');
    playBtn.textContent = '▶';
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setSelection(i, null);
      if (audioBuffer) playRegion(audioBuffer, slice.start, slice.end, isLooping);
    });

    const exportBtn = document.createElement('button');
    exportBtn.textContent = '⬇';
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!audioBuffer) return;
      const baseName = projectName || 'slice';
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
      const next = slicer.slices.length === 0 ? null
        : selectedSlice !== null && selectedSlice >= slicer.slices.length ? slicer.slices.length - 1
        : selectedSlice;
      setSelection(next, null);
    });

    btnGroup.appendChild(delBtn);
    btnGroup.appendChild(playBtn);
    btnGroup.appendChild(exportBtn);
    li.appendChild(info);
    li.appendChild(btnGroup);
    slicesUl.appendChild(li);
  });
}
