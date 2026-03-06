/**
 * Keyboard shortcut handler.
 *
 * All mutable app state is accessed via KeyboardContext callbacks,
 * keeping this module free of direct DOM or app-state dependencies.
 *
 * Zoom state (level + saved viewport) lives here because it is driven
 * exclusively by keyboard gestures and has no meaning outside of them.
 */

import { debug } from './debug.js';
import { cancelPending, removeSlice, moveMarker, type SlicerState } from './slicer.js';
import { playRegion, getPlaybackState } from './player.js';
import { getViewport, setViewport, zoomToRange } from './viewport.js';
import type { Viewport } from './coords.js';

export type ZoomLevel = 'out' | 'none' | 'segment' | 'marker';

/** Minimum sample span when zooming tight on a single marker. */
const MIN_MARKER_ZOOM = 500;

export interface KeyboardContext {
  getSlicer(): SlicerState | null;
  getAudioBuffer(): AudioBuffer | null;
  getSelectedSlice(): number | null;
  getSelectedMarker(): 'start' | 'end' | null;
  isLooping(): boolean;
  /** Central selection setter — updates state, scrolls viewport, redraws. */
  setSelection(slice: number | null, marker: 'start' | 'end' | null): void;
  saveSnapshot(): void;
  doUndo(): void;
  doRedo(): void;
  /** Stop playback, clear playhead, and redraw. */
  stopPlayback(): void;
  /** Tell main.ts that the viewport changed and peaks must be regenerated. */
  invalidatePeaks(): void;
  redraw(): void;
  /** Enter inline rename mode for the selected slice. */
  startRename(): void;
}

export function registerKeyboard(ctx: KeyboardContext): void {
  let zoomLevel: ZoomLevel = 'out';
  let zoomPrevViewport: Viewport | null = null;

  document.addEventListener('keydown', (e) => {
    const slicer = ctx.getSlicer();
    const selectedSlice = ctx.getSelectedSlice();
    const selectedMarker = ctx.getSelectedMarker();

    // Escape: cancel pending → deselect marker → deselect slice
    if (e.key === 'Escape') {
      if (slicer && slicer.pendingStart !== null) {
        ctx.saveSnapshot();
        cancelPending(slicer);
        debug('Pending slice cancelled');
        ctx.redraw();
      } else if (selectedMarker !== null) {
        debug('Marker deselected');
        ctx.setSelection(selectedSlice, null);
      } else if (selectedSlice !== null) {
        debug('Selection cleared');
        ctx.setSelection(null, null);
      }
    }

    // Space: play/stop
    if (e.key === ' ') {
      e.preventDefault();
      const ps = getPlaybackState();
      if (ps.isPlaying) {
        ctx.stopPlayback();
      } else {
        const audioBuffer = ctx.getAudioBuffer();
        if (audioBuffer && slicer && selectedSlice !== null && selectedSlice < slicer.slices.length) {
          const s = slicer.slices[selectedSlice];
          playRegion(audioBuffer, s.start, s.end, ctx.isLooping());
        } else if (audioBuffer && slicer && slicer.pendingStart !== null) {
          // Play from pending start to end of file so you can hear where you are
          playRegion(audioBuffer, slicer.pendingStart, slicer.totalSamples, false);
        }
      }
    }

    // Backspace/Delete: delete selected slice
    if ((e.key === 'Backspace' || e.key === 'Delete') && slicer && selectedSlice !== null && selectedSlice < slicer.slices.length) {
      e.preventDefault();
      ctx.saveSnapshot();
      removeSlice(slicer, selectedSlice);
      const next = slicer.slices.length === 0 ? null
        : Math.min(selectedSlice, slicer.slices.length - 1);
      ctx.setSelection(next, null);
    }

    // . — toggle selected marker between start/end
    if (e.key === '.' && slicer && selectedSlice !== null && selectedSlice < slicer.slices.length) {
      const next = selectedMarker === null ? 'start'
        : selectedMarker === 'start' ? 'end'
        : 'start';
      ctx.setSelection(selectedSlice, next);
    }

    // u / Cmd-Z — undo
    const mod = e.metaKey || e.ctrlKey;
    if (slicer && ((e.key === 'u' && !e.shiftKey && !mod) || (e.key === 'z' && mod && !e.shiftKey))) {
      e.preventDefault();
      ctx.doUndo();
    }

    // U / Cmd-Shift-Z — redo
    if (slicer && ((e.key === 'U' && !mod) || (e.key === 'z' && mod && e.shiftKey))) {
      e.preventDefault();
      ctx.doRedo();
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
      // Navigation resets the zoom toggle state so z works fresh on the new slice
      zoomLevel = 'out';
      zoomPrevViewport = null;
      ctx.setSelection(next, null);
    }

    // h/l/ArrowLeft/ArrowRight — select marker or nudge it
    if ((e.key === 'h' || e.key === 'l' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') && slicer && selectedSlice !== null && selectedSlice < slicer.slices.length) {
      e.preventDefault();
      const left = e.key === 'h' || e.key === 'ArrowLeft';
      if (selectedMarker === null) {
        // No marker selected: left picks start, right picks end
        ctx.setSelection(selectedSlice, left ? 'start' : 'end');
      } else {
        // Nudge amount scales with zoom level — tighter zoom = finer control
        const vp = getViewport();
        const vpLen = vp.end - vp.start;
        const nudge = Math.max(1, Math.round(vpLen * 0.005));
        const delta = left ? -nudge : nudge;
        ctx.saveSnapshot();
        const newIdx = moveMarker(slicer, selectedSlice, selectedMarker, slicer.slices[selectedSlice][selectedMarker] + delta);
        ctx.setSelection(newIdx, selectedMarker);
      }
    }

    // h/l/Arrow — nudge pending start when no slice is selected
    if ((e.key === 'h' || e.key === 'l' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') && slicer && slicer.pendingStart !== null && selectedSlice === null) {
      e.preventDefault();
      const left = e.key === 'h' || e.key === 'ArrowLeft';
      const vp = getViewport();
      const nudge = Math.max(1, Math.round((vp.end - vp.start) * 0.005));
      const delta = left ? -nudge : nudge;
      ctx.saveSnapshot();
      slicer.pendingStart = Math.max(0, Math.min(slicer.totalSamples, slicer.pendingStart + delta));
      ctx.redraw();
    }

    // z — toggle zoom based on current selection
    if (e.key === 'z' && !mod && slicer) {
      // Determine target zoom level from current selection
      let targetLevel: 'none' | 'segment' | 'marker' = 'none';
      if (selectedSlice !== null && selectedSlice < slicer.slices.length && selectedMarker !== null) {
        targetLevel = 'marker';
      } else if (selectedSlice !== null && selectedSlice < slicer.slices.length) {
        targetLevel = 'segment';
      }

      const shouldZoomOut = zoomLevel !== 'out' && zoomLevel === targetLevel;

      if (shouldZoomOut) {
        if (zoomPrevViewport) {
          setViewport(zoomPrevViewport);
          zoomPrevViewport = null;
        }
        zoomLevel = 'out';
      } else {
        zoomPrevViewport = { ...getViewport() };

        if (selectedSlice !== null && selectedSlice < slicer.slices.length && selectedMarker !== null) {
          const s = slicer.slices[selectedSlice];
          const markerPos = s[selectedMarker];
          const markerRange = Math.max(MIN_MARKER_ZOOM, (s.end - s.start) * 0.08);
          zoomToRange(markerPos - markerRange, markerPos + markerRange, 0.1);
          zoomLevel = 'marker';
        } else if (selectedSlice !== null && selectedSlice < slicer.slices.length) {
          const s = slicer.slices[selectedSlice];
          zoomToRange(s.start, s.end, 0.1);
          zoomLevel = 'segment';
        } else {
          const vp = getViewport();
          const center = (vp.start + vp.end) / 2;
          const range = (vp.end - vp.start) * 0.15;
          zoomToRange(center - range, center + range, 0.1);
          zoomLevel = 'none';
        }
      }

      ctx.invalidatePeaks();
      ctx.redraw();
    }

    // , — rename selected slice
    if (e.key === ',' && slicer && selectedSlice !== null && selectedSlice < slicer.slices.length) {
      e.preventDefault();
      ctx.startRename();
    }
  });
}
