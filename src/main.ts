/**
 * Main entry point — wires all modules together and handles UI events.
 *
 * Slice creation is two clicks: first click sets start, second sets end.
 * Uses pointer events throughout for unified touch + mouse handling.
 */

import { debug } from './debug.js';
import { decodeAudioFile, decodeAudioData } from './audio.js';
import {
  saveBufferToIDB, loadBufferFromIDB,
  saveMetaToLS, loadMetaFromLS,
  clearSession,
} from './persistence.js';
import { pixelToSample } from './coords.js';
import { SELECT_ZONE } from './constants.js';
import { getCachedPeaks, invalidatePeaks, drawWaveform, invalidateThemeCache } from './waveform.js';
import { SliceList } from './slice-list.js';
import { getViewport, resetViewport, onWheel, onPointerMove, ensureVisible } from './viewport.js';
import {
  createSlicer, beginSlice, endSlice, cancelPending,
  removeSlice, moveMarker, hitTestMarker, hitTestMarkerPreferSelected,
  findSliceAt,
  type SlicerState, type MarkerHit,
} from './slicer.js';
import { registerKeyboard } from './keyboard.js';
import { playRegion, stop, setCallbacks, getPlaybackState } from './player.js';
import { encodeWav, downloadBlob, requestSaveHandle, writeBlobTo } from './wav-writer.js';
import { loadProjectZip, buildProjectZip, buildSidecarJson } from './project.js';
import { pushUndo, undo, redo, cloneSnapshot, clearHistory, type Snapshot } from './undo.js';
import { monoMix, detectTransients, snapAllToZeroCrossingsBefore } from './dsp.js';
import { toggleZoom } from './zoom.js';
import { registerTouch } from './touch.js';
import { icons } from './icons.js';

// --- DOM elements ---
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const projectInput = document.getElementById('project-input') as HTMLInputElement;
const titleGroup = document.getElementById('title-group') as HTMLElement;
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
const btnUndo = document.getElementById('btn-undo') as HTMLButtonElement;
const btnRedo = document.getElementById('btn-redo') as HTMLButtonElement;
const btnNudgeLeft = document.getElementById('btn-nudge-left') as HTMLButtonElement;
const btnNudgeRight = document.getElementById('btn-nudge-right') as HTMLButtonElement;
const btnZoom = document.getElementById('btn-zoom') as HTMLButtonElement;
const btnEsc = document.getElementById('btn-esc') as HTMLButtonElement;
const btnDeleteSlice = document.getElementById('btn-delete-slice') as HTMLButtonElement;
const cutZone = document.getElementById('cut-zone') as HTMLElement;
const markerHint = document.getElementById('marker-hint') as HTMLDivElement;

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
  slicer.ghostMarkers = [];
  selectedSlice = snap.selectedSlice;
  redraw();
  renderSliceList();
}

// --- File loading ---
btnLoadWav.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) loadFile(file);
  fileInput.value = '';  // reset so re-selecting the same file triggers change
});

btnLoadProject.addEventListener('click', () => projectInput.click());
projectInput.addEventListener('change', () => {
  const file = projectInput.files?.[0];
  if (file) loadProject(file).catch(err => console.error('[making-waves] Unhandled project load error:', err));
  projectInput.value = '';  // reset so re-selecting the same file triggers change
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
    // Save raw WAV bytes to IDB once — the file never changes after upload
    file.arrayBuffer().then(ab => saveBufferToIDB(ab)).catch(() => {/* quota */ });
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
  titleGroup.classList.remove('hidden');
}

/** Reset to start screen */
function closeProject(): void {
  clearSession(); // wipe autosave so next launch shows start screen
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
  titleGroup.classList.add('hidden');
  projectTitleEl.textContent = '';
  projectTitleEl.setAttribute('contenteditable', 'false');
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
function startTitleEdit(): void {
  projectTitleEl.setAttribute('contenteditable', 'true');
  projectTitleEl.focus();
  const range = document.createRange();
  range.selectNodeContents(projectTitleEl);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

// Double-click on desktop, single tap on touch
projectTitleEl.addEventListener('dblclick', startTitleEdit);
projectTitleEl.addEventListener('click', (e) => {
  if ((e as PointerEvent).pointerType === 'touch' ||
      'ontouchstart' in window) {
    startTitleEdit();
  }
});

projectTitleEl.addEventListener('blur', () => {
  projectTitleEl.setAttribute('contenteditable', 'false');
  const newName = projectTitleEl.textContent?.trim();
  if (newName) {
    projectName = newName;
  } else {
    projectTitleEl.textContent = projectName;
  }
  debouncedSaveMeta();
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

// --- Ghost marker detection helper ---
function detectGhosts(sl: SlicerState, buf: AudioBuffer, fromSample: number): void {
  const channels = Array.from({ length: buf.numberOfChannels },
    (_, c) => buf.getChannelData(c));
  const mono = monoMix(channels);
  const region = mono.subarray(fromSample);
  const raw = detectTransients(region, buf.sampleRate, {
    sensitivity: 1.5,
    frameSize: 512,
  });
  const absolute = raw.map(p => p + fromSample);
  const windowSize20ms = Math.round(buf.sampleRate * 0.02);
  const snapped = snapAllToZeroCrossingsBefore(mono, absolute, windowSize20ms);
  sl.ghostMarkers = snapped.slice(0, 8);
}

// --- Waveform interaction (pointer events) ---

canvas.addEventListener('pointerdown', (e) => {
  if (!slicer || !audioBuffer) return;

  // Touch gestures (pan/zoom) are handled by touch.ts — skip marker placement
  if (e.pointerType === 'touch') return;

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
    const nearGhost = slicer.ghostMarkers.find(g => Math.abs(g - sample) <= toleranceSamples);
    const endSample = nearGhost ?? sample;
    const idx = endSlice(slicer, endSample);
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
  detectGhosts(slicer, audioBuffer, sample);
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

// --- Cut zone (marker placement for touch + mouse) ---
cutZone.addEventListener('pointerdown', (e) => {
  if (!slicer || !audioBuffer) return;

  const vp = getViewport();
  const sample = pixelToSample(cutZone, e.clientX, vp);

  // If pending start exists, complete the slice
  if (slicer.pendingStart !== null) {
    const rect = cutZone.getBoundingClientRect();
    const vpLen = vp.end - vp.start;
    const toleranceSamples = (12 / rect.width) * vpLen;
    const nearGhost = slicer.ghostMarkers.find(g => Math.abs(g - sample) <= toleranceSamples);
    const endSample = nearGhost ?? sample;
    saveSnapshot();
    const idx = endSlice(slicer, endSample);
    if (idx >= 0) {
      debug(`Slice #${idx + 1} created via cut zone`);
      setSelection(idx, null);
    }
    redraw();
    return;
  }

  // Begin a new slice
  saveSnapshot();
  beginSlice(slicer, sample);
  debug('Slice start placed via cut zone');
  detectGhosts(slicer, audioBuffer, sample);
  redraw();
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
    if (selectedSlice !== null) doRenameSlice(selectedSlice);
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
    if (isLooping) {
      // Enabling loop: restart the region from the top so the full loop plays
      playRegion(audioBuffer, ps.startSample, ps.endSample, true);
    } else {
      // Disabling loop: continue from current position and play to end once
      playRegion(audioBuffer, ps.currentSample, ps.endSample, false);
    }
  }
});

btnStop.addEventListener('click', () => {
  stop();
  playheadSample = null;
  redraw();
});

// --- Action bar ---
btnUndo.addEventListener('click', () => {
  const snap = undo(currentSnapshot());
  if (snap) { restoreSnapshot(snap); debug('Undo'); }
});

btnRedo.addEventListener('click', () => {
  const snap = redo(currentSnapshot());
  if (snap) { restoreSnapshot(snap); debug('Redo'); }
});

function doNudge(left: boolean): void {
  if (!slicer) return;

  // Nudge pending start marker if present and no slice selected
  if (slicer.pendingStart !== null && selectedSlice === null) {
    const vp = getViewport();
    const nudge = Math.max(1, Math.round((vp.end - vp.start) * 0.005));
    const delta = left ? -nudge : nudge;
    saveSnapshot();
    slicer.pendingStart = Math.max(0, Math.min(slicer.totalSamples, slicer.pendingStart + delta));
    redraw();
    return;
  }

  if (selectedSlice === null || selectedSlice >= slicer.slices.length) return;

  if (selectedMarker === null) {
    // No marker selected: left picks start, right picks end
    setSelection(selectedSlice, left ? 'start' : 'end');
  } else {
    const vp = getViewport();
    const vpLen = vp.end - vp.start;
    const nudge = Math.max(1, Math.round(vpLen * 0.005));
    const delta = left ? -nudge : nudge;
    saveSnapshot();
    const newIdx = moveMarker(slicer, selectedSlice, selectedMarker,
      slicer.slices[selectedSlice][selectedMarker] + delta);
    setSelection(newIdx, selectedMarker);
  }
}

btnNudgeLeft.addEventListener('click', () => doNudge(true));
btnNudgeRight.addEventListener('click', () => doNudge(false));

btnEsc.addEventListener('click', () => {
  if (slicer && slicer.pendingStart !== null) {
    saveSnapshot();
    cancelPending(slicer);
    debug('Pending slice cancelled');
    redraw();
  } else if (selectedMarker !== null) {
    debug('Marker deselected');
    setSelection(selectedSlice, null);
  } else if (selectedSlice !== null) {
    debug('Selection cleared');
    setSelection(null, null);
  }
});

btnDeleteSlice.addEventListener('click', () => {
  if (!slicer || selectedSlice === null) return;
  saveSnapshot();
  removeSlice(slicer, selectedSlice);
  setSelection(null, null);
});

btnZoom.addEventListener('click', () => {
  if (!slicer) return;
  toggleZoom({
    selectedSlice,
    selectedMarker,
    slices: slicer.slices,
  });
  invalidatePeaks();
  redraw();
});

// --- Save ---

// saveProject is split in two so the picker is shown before the heavy async
// work — the browser's user-gesture token expires after the first await.
async function saveProject(): Promise<void> {
  if (!slicer || !audioBuffer || !originalFile) return;
  const baseName = projectName || originalFile.name.replace(/\.wav$/i, '');

  // 1. Request handle NOW while gesture is still active
  const handle = await requestSaveHandle(`${baseName}.zip`, 'application/zip');

  // 2. Build the ZIP (gesture may have expired — that's fine)
  const zip = await buildProjectZip(slicer.slices, audioBuffer, originalFile, baseName);

  // 3. Write
  if (handle) await writeBlobTo(handle, zip);
  else downloadBlob(zip, `${baseName}.zip`);
}

btnSaveProject.addEventListener('click', () => {
  saveProject().catch(err => console.error('[making-waves] Save error:', err));
});

btnSaveJson.addEventListener('click', async () => {
  if (!slicer || !audioBuffer) return;
  const baseName = projectName || 'slices';
  const filename = `${baseName}.waves.json`;

  // buildSidecarJson is synchronous so the gesture is still active here
  const handle = await requestSaveHandle(filename, 'application/json');
  const blob = buildSidecarJson(slicer.slices, audioBuffer, originalFile?.name ?? `${baseName}.wav`, baseName);

  if (handle) await writeBlobTo(handle, blob);
  else downloadBlob(blob, filename);
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
  redraw(); // also calls updateMarkerHint
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

// --- Marker hint pill (touch only) ---
const isTouchDevice = 'ontouchstart' in window;

/**
 * Tracks whether the "hold to drag" hint should be shown for each marker side.
 *
 * Rules:
 * - Show at most twice per side (start / end) across the whole session.
 * - Auto-hide after HINT_TIMEOUT_MS of visibility.
 * - Once a drag is successfully completed, stop showing for that side.
 * - Never re-show after a drag completes, even if the count hasn't reached 2.
 */
class MarkerHintState {
  private showCount: Record<'start' | 'end', number> = { start: 0, end: 0 };
  private draggedSides: Set<'start' | 'end'> = new Set();
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private currentSide: 'start' | 'end' | null = null;
  private readonly MAX_SHOWS = 2;
  private readonly TIMEOUT_MS = 10_000;

  shouldShow(side: 'start' | 'end'): boolean {
    return !this.draggedSides.has(side) && this.showCount[side] < this.MAX_SHOWS;
  }

  /** Call when the hint becomes visible for a given side. */
  onShown(side: 'start' | 'end', hideCallback: () => void): void {
    if (this.currentSide === side) return; // already running for this side
    this.clearTimer();
    this.currentSide = side;
    this.showCount[side]++;
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      this.currentSide = null;
      hideCallback();
    }, this.TIMEOUT_MS);
  }

  /** Call when a hold-drag completes for the given side. */
  onDragCompleted(side: 'start' | 'end'): void {
    this.draggedSides.add(side);
    this.clearTimer();
    this.currentSide = null;
  }

  /** Call whenever the hint is hidden for any reason other than drag. */
  onHidden(): void {
    this.clearTimer();
    this.currentSide = null;
  }

  private clearTimer(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }
}

const hintState = new MarkerHintState();

function updateMarkerHint(): void {
  if (!isTouchDevice || !slicer || selectedSlice === null || selectedMarker === null || dragging !== null) {
    hintState.onHidden();
    markerHint.classList.add('hidden');
    return;
  }
  const slice = slicer.slices[selectedSlice];
  if (!slice || !hintState.shouldShow(selectedMarker)) {
    hintState.onHidden();
    markerHint.classList.add('hidden');
    return;
  }

  const markerSample = selectedMarker === 'start' ? slice.start : slice.end;
  const vp = getViewport();
  const containerRect = (canvas.parentElement as HTMLElement).getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();

  // X position of the marker line relative to the container
  const ratio = (markerSample - vp.start) / (vp.end - vp.start);
  const markerX = (canvasRect.left - containerRect.left) + ratio * canvasRect.width;

  // Hide if marker is scrolled off screen
  if (markerX < 0 || markerX > containerRect.width) {
    hintState.onHidden();
    markerHint.classList.add('hidden');
    return;
  }

  const GAP = 8;
  if (selectedMarker === 'start') {
    markerHint.innerHTML = `${icons.chevronLeft} hold to drag`;
    markerHint.style.left = 'auto';
    markerHint.style.right = `${containerRect.width - markerX + GAP}px`;
  } else {
    markerHint.innerHTML = `${icons.chevronRight} hold to drag`;
    markerHint.style.right = 'auto';
    markerHint.style.left = `${markerX + GAP}px`;
  }
  markerHint.classList.remove('hidden');
  hintState.onShown(selectedMarker, () => {
    markerHint.classList.add('hidden');
  });
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
    ghostMarkers: slicer.ghostMarkers,
  });
  updateMarkerHint();
}

// Prevent double-tap zoom on iOS (which ignores user-scalable=no since iOS 10)
let lastTouchEndMs = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouchEndMs < 300) e.preventDefault();
  lastTouchEndMs = now;
}, { passive: false });

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

// --- Touch pan/zoom ---
registerTouch(canvas, {
  onViewportChanged() {
    invalidatePeaks();
    redraw();
  },
  onTap(clientX, _clientY) {
    if (!slicer || !audioBuffer) return;

    const vp = getViewport();
    const rect = canvas.getBoundingClientRect();
    const sample = pixelToSample(canvas, clientX, vp);
    const vpLen = vp.end - vp.start;
    // Use a larger tolerance for touch (finger is less precise than mouse)
    const toleranceSamples = (20 / rect.width) * vpLen;

    // Tap near a marker → select that slice + marker (enables nudge buttons)
    const hit = hitTestMarkerPreferSelected(slicer, sample, toleranceSamples, selectedSlice);
    if (hit) {
      setSelection(hit.sliceIndex, hit.which);
      return;
    }

    // Tap inside a slice region → select the segment
    const sliceIdx = findSliceAt(slicer, sample);
    if (sliceIdx >= 0) {
      setSelection(sliceIdx, null);
      return;
    }

    // Tap on empty space → deselect
    setSelection(null, null);
  },

  onHoldStart(clientX, _clientY): boolean {
    // Only drag if there's already a selected marker to grab
    if (!slicer || !audioBuffer || selectedSlice === null || selectedMarker === null) return false;
    const rect = canvas.getBoundingClientRect();
    const vp = getViewport();
    const sample = pixelToSample(canvas, clientX, vp);
    const vpLen = vp.end - vp.start;
    // Generous fat-finger tolerance (~30px)
    const toleranceSamples = (30 / rect.width) * vpLen;
    // Only claim if the touch is near the selected marker specifically
    const slice = slicer.slices[selectedSlice];
    if (!slice) return false;
    const markerSample = selectedMarker === 'start' ? slice.start : slice.end;
    if (Math.abs(markerSample - sample) > toleranceSamples) return false;
    saveSnapshot();
    dragging = { sliceIndex: selectedSlice, which: selectedMarker };
    markerHint.classList.add('hidden');
    return true;
  },

  onHoldMove(clientX) {
    if (!dragging || !slicer) return;
    const sample = pixelToSample(canvas, clientX, getViewport());
    if (dragging.sliceIndex === -1) {
      slicer.pendingStart = Math.max(0, Math.min(slicer.totalSamples, sample));
    } else {
      const newIdx = moveMarker(slicer, dragging.sliceIndex, dragging.which, sample);
      dragging = { ...dragging, sliceIndex: newIdx };
      selectedSlice = newIdx;
    }
    redraw();
    renderSliceList();
  },

  onHoldEnd() {
    if (dragging) hintState.onDragCompleted(dragging.which);
    dragging = null;
    // Don't re-show hint after a completed drag
  },
});

// --- Slice list ---
function doRenameSlice(i: number): void {
  if (!slicer || i >= slicer.slices.length) return;
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
}

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
  async exportSlice(i) {
    if (!audioBuffer || !slicer) return;
    const baseName = projectName || 'slice';
    const filename = `${baseName}_${String(i + 1).padStart(3, '0')}.wav`;
    // encodeWav is synchronous — gesture still active when we request the handle
    const handle = await requestSaveHandle(filename, 'audio/wav');
    const blob = encodeWav(audioBuffer, slicer.slices[i].start, slicer.slices[i].end);
    if (handle) await writeBlobTo(handle, blob);
    else downloadBlob(blob, filename);
  },
  renameSlice(i) {
    doRenameSlice(i);
  },
});

function renderSliceList(): void {
  if (!slicer || !audioBuffer) return;
  sliceList.render(slicer.slices, audioBuffer.sampleRate, selectedSlice);
  btnDeleteSlice.disabled = selectedSlice === null;
  debouncedSaveMeta();
}

// --- Auto-save ---

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

function saveMeta(): void {
  if (!slicer || !originalFile) return;
  saveMetaToLS({
    version: 1,
    projectName,
    originalFileName: originalFile.name,
    slices: slicer.slices,
    savedAt: Date.now(),
  });
}

// Debounced: coalesces rapid changes (marker drags, etc.) into one write
const debouncedSaveMeta = debounce(saveMeta, 100);

// Flush immediately when the user leaves — catches any in-flight debounce
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden') return;
  saveMeta();
});

// --- Restore session on startup ---
(async () => {
  const meta = loadMetaFromLS();
  if (!meta) return;

  const rawWav = await loadBufferFromIDB();
  if (!rawWav) return;

  try {
    // Re-decode from the stored raw WAV bytes — never stores decoded PCM
    const buffer = await decodeAudioData(rawWav.slice(0));
    const file = new File([rawWav], meta.originalFileName, { type: 'audio/wav' });
    openSession(buffer, file, meta.projectName, meta.slices);
    debug(`Session restored: "${meta.projectName}", ${meta.slices.length} slices`);
  } catch (err) {
    // Corrupted data — clear and start fresh
    console.error('[making-waves] Session restore failed:', err);
    clearSession();
  }
})();
