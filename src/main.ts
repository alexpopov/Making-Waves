/**
 * Main entry point — wires all modules together and handles UI events.
 *
 * Slice creation is two clicks: first click sets start, second sets end.
 * Uses pointer events throughout for unified touch + mouse handling.
 */

import { debug } from './debug.js';
import { decodeAudioFile } from './audio.js';
import { pixelToSample } from './coords.js';
import { SELECT_ZONE } from './constants.js';
import { getCachedPeaks, invalidatePeaks, drawWaveform, invalidateThemeCache } from './waveform.js';
import { SliceList } from './slice-list.js';
import { getViewport, resetViewport, onWheel, onPointerMove, ensureVisible } from './viewport.js';
import {
  createSlicer, beginSlice, endSlice,
  removeSlice, moveMarker, hitTestMarker, hitTestMarkerPreferSelected,
  findSliceAt,
  type SlicerState, type MarkerHit,
} from './slicer.js';
import { registerKeyboard } from './keyboard.js';
import { playRegion, stop, setCallbacks, getPlaybackState } from './player.js';
import { encodeWav, downloadBlob } from './wav-writer.js';
import { loadProjectZip, buildProjectZip, buildSidecarJson } from './project.js';
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
let slicer: SlicerState | null = null;
let selectedSlice: number | null = null;
let selectedMarker: 'start' | 'end' | null = null;
let playheadSample: number | null = null;
let dragging: MarkerHit | null = null;
let pendingDrag: { hit: MarkerHit; startX: number } | null = null;
const DRAG_THRESHOLD_PX = 5;
let isLooping = false;
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

/**
 * Open a session: wire up state, restore any slices, show the editor.
 * Both loadFile and loadProject funnel through here.
 */
function openSession(
  buffer: AudioBuffer,
  file: File,
  name: string,
  slices: { start: number; end: number; name?: string }[] = [],
): void {
  audioBuffer = buffer;
  originalFile = file;
  projectName = name;
  slicer = createSlicer(buffer.length);

  for (const s of slices) {
    beginSlice(slicer, s.start);
    const idx = endSlice(slicer, s.end);
    if (idx >= 0 && s.name) slicer.slices[idx].name = s.name;
  }

  selectedSlice = null;
  selectedMarker = null;
  invalidatePeaks();
  clearHistory();
  resetViewport(buffer.length);
  showEditor();

  requestAnimationFrame(() => {
    redraw();
    renderSliceList();
  });
}

async function loadFile(file: File): Promise<void> {
  debug('Loading file:', file.name, `(${(file.size / 1024 / 1024).toFixed(1)} MB)`);
  try {
    const buffer = await decodeAudioFile(file);
    debug('Decoded:', {
      channels: buffer.numberOfChannels,
      sampleRate: buffer.sampleRate,
      duration: buffer.duration.toFixed(2) + 's',
      samples: buffer.length,
    });
    openSession(buffer, file, file.name.replace(/\.wav$/i, ''));
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
  invalidatePeaks();
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
    const data = await loadProjectZip(file);
    openSession(data.audioBuffer, data.originalFile, data.projectName, data.slices);
    debug(`Project loaded: ${data.slices.length} slices restored`);
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
btnClose.addEventListener('click', async () => {
  if (!audioBuffer) return;
  const shouldSave = confirm('Save project before closing?');
  if (shouldSave) await saveProject();
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
  invalidatePeaks();
  redraw();
  renderSliceList();
});

// --- Waveform interaction (pointer events) ---

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

  // Second: if we have a pending start, either grab it (close click) or complete the slice
  if (slicer.pendingStart !== null) {
    const dPending = Math.abs(slicer.pendingStart - sample);
    if (dPending <= toleranceSamples) {
      // Close to the pending marker — grab it for dragging instead of completing
      pendingDrag = { hit: { sliceIndex: -1, which: 'start' }, startX: e.clientX };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
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
      const nearPending = slicer.pendingStart !== null
        && Math.abs(slicer.pendingStart - sample) <= toleranceSamples;
      canvas.style.cursor = (hit || nearPending) ? 'grab' : 'crosshair';
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

  // Dragging the pending start marker (sliceIndex sentinel -1)
  if (dragging.sliceIndex === -1) {
    slicer.pendingStart = Math.max(0, Math.min(slicer.totalSamples, sample));
    redraw();
    return;
  }

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

// --- Keyboard shortcuts ---
registerKeyboard({
  getSlicer: () => slicer,
  getAudioBuffer: () => audioBuffer,
  getSelectedSlice: () => selectedSlice,
  getSelectedMarker: () => selectedMarker,
  isLooping: () => isLooping,
  setSelection,
  saveSnapshot,
  doUndo() {
    const snap = undo(currentSnapshot());
    if (snap) { restoreSnapshot(snap); debug('Undo'); }
  },
  doRedo() {
    const snap = redo(currentSnapshot());
    if (snap) { restoreSnapshot(snap); debug('Redo'); }
  },
  stopPlayback() {
    stop();
    playheadSample = null;
    redraw();
  },
  invalidatePeaks,
  redraw,
  startRename() {
    if (selectedSlice === null || !slicer || selectedSlice >= slicer.slices.length) return;
    const i = selectedSlice;
    const currentName = slicer.slices[i].name ?? '';
    sliceList.startRename(
      i,
      currentName,
      (newName) => {
        if (!slicer) return;
        if (newName !== currentName) {
          saveSnapshot();
          slicer.slices[i].name = newName || undefined;
        }
        renderSliceList();
      },
      () => renderSliceList(),
    );
  },
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
async function saveProject(): Promise<void> {
  if (!slicer || !audioBuffer || !originalFile) return;
  const baseName = projectName || originalFile.name.replace(/\.wav$/i, '');
  const zip = await buildProjectZip(slicer.slices, audioBuffer, originalFile, baseName);
  downloadBlob(zip, `${baseName}.zip`);
}

btnSaveProject.addEventListener('click', () => {
  saveProject().catch(err => console.error('[making-waves] Save error:', err));
});

btnSaveJson.addEventListener('click', () => {
  if (!slicer || !audioBuffer) return;
  const baseName = projectName || 'slices';
  const blob = buildSidecarJson(
    slicer.slices,
    audioBuffer,
    originalFile?.name ?? `${baseName}.wav`,
    baseName,
  );
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
  invalidatePeaks(); // viewport may have changed
}

// --- Drawing ---
function redraw(): void {
  if (!audioBuffer || !slicer) return;

  const rect = canvas.getBoundingClientRect();
  const vp = getViewport();
  const peaks = getCachedPeaks(audioBuffer, Math.floor(rect.width), vp);

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
  invalidatePeaks();
  redraw();
});

// --- Zoom & pan (delegated to viewport module) ---
canvas.addEventListener('wheel', (e) => {
  if (!slicer) return;
  e.preventDefault();
  if (onWheel(e, canvas)) {
    invalidatePeaks();
    redraw();
  }
}, { passive: false });

// --- Slice list ---
const sliceList = new SliceList(slicesUl, {
  setSelection: (i, marker) => setSelection(i, marker),
  saveSnapshot,
  playSlice(start, end) {
    if (audioBuffer) playRegion(audioBuffer, start, end, isLooping);
  },
  removeSlice(i) {
    if (!slicer) return;
    removeSlice(slicer, i);
    const next = slicer.slices.length === 0 ? null
      : selectedSlice !== null && selectedSlice >= slicer.slices.length ? slicer.slices.length - 1
      : selectedSlice;
    setSelection(next, null);
  },
  exportSlice(i) {
    if (!audioBuffer || !slicer) return;
    const baseName = projectName || 'slice';
    const blob = encodeWav(audioBuffer, slicer.slices[i].start, slicer.slices[i].end);
    downloadBlob(blob, `${baseName}_${String(i + 1).padStart(3, '0')}.wav`);
  },
});

function renderSliceList(): void {
  if (!slicer || !audioBuffer) return;
  sliceList.render(slicer.slices, audioBuffer.sampleRate, selectedSlice);
}
