# Making Waves — Tasks

## Milestone 1 — MVP
- [x] Project scaffolding (Vite + TypeScript)
- [x] File loading (file picker + drag-and-drop)
- [x] Waveform rendering (Canvas 2D, downsampled peaks)
- [x] Overlapping slice model (independent start/end pairs)
- [x] Rainbow-paren color-matched markers with inward triangles
- [x] Two-click slice creation (start → end)
- [x] Playback with AnalyserNode + animated playhead
- [x] WAV export (16-bit/24-bit PCM)
- [x] Slice list with play/export/delete per slice
- [x] Pointer events (unified touch + mouse)
- [x] Debug logging
- [x] Zoom with fall-off, sticky anchor, dead-zone centering
- [x] Horizontal pan (trackpad swipe / shift+scroll)
- [x] Gesture direction locking
- [x] Top 10% selection zone with heavier tint
- [x] `space` — play/stop
- [x] `escape` — cancel pending / deselect
- [x] `j`/`k` — select next/previous slice
- [x] Cinemachine-style viewport follow on slice selection
- [x] Slices sorted by start position
- [x] Theme support (Midnight default, Cobalt) with Settings popover
- [x] Drag threshold on markers (click to select, drag only after 5px)
- [x] Selected marker visual feedback (white/bright highlight)
- [x] Selected slice panel in grab zone (semi-transparent, dotted line masked)

## Slice Auto-Suggestions
- [ ] After placing slice start, show ghost markers (light grey) at suggested end points
- [ ] Transient detection: find next attack/hit after the start point using RMS energy spikes
- [ ] Silence detection: find next silence gap (RMS drops below threshold)
- [ ] Zero-crossing snapping: snap suggestions to nearest zero-crossing for click-free cuts
- [ ] Click a ghost marker to accept it as the slice end
- [ ] Configurable sensitivity (threshold slider?)

## Keyboard Shortcuts
- [x] `space` — play/stop selected slice
- [x] `escape` — cancel pending slice, deselect marker → deselect segment
- [x] `j`/`k` — select next/previous slice
- [x] `u` — undo last action
- [x] `backspace`/`delete` — delete selected slice
- [x] `h`/`l` — nudge selected *marker* left/right (amount scales with zoom level)
  - If only segment selected: `h` selects left marker, `l` selects right marker
  - Escape once deselects marker back to segment selection
- [x] `z` — zoom toggle (nothing → center, segment → fill, marker → tight), z again to zoom back
- [x] Arrow keys mirror hjkl behavior
- [x] `Cmd-Z`/`Ctrl-Z` — undo, `Cmd-Shift-Z`/`Ctrl-Shift-Z` — redo
- [ ] `a` — add mode: next click always adds, bypasses hit-test
- [ ] `g` — grab mode: drag selected marker from anywhere (Blender-style)
- [ ] `r` — toggle loop (repeat) mode
- [ ] `,` (comma) — rename selected segment
- [ ] `tab` (comma) — toggle selected marker?

## Cursor Feedback
- [x] Top 10% zone: pointer cursor
- [x] When hovering near a draggable marker: grab cursor (not crosshair)
- [ ] When hovering over a selectable region in top zone: pointer cursor

## Pending Marker Behavior
- [ ] When only one marker is placed (pending start), pressing play should play from that point
- [ ] `h`/`l` should nudge the pending marker
- [ ] Pending marker should be draggable
- [ ] Only complete the slice (place end) if the second click is sufficiently far from the start
  (close clicks should drag the pending marker instead)

## Project UI
- [ ] Start screen with "Load WAV" and "Load Project" buttons (replaces toolbar Load WAV button)
- [ ] Centered editable project title in toolbar (white, contenteditable)
- [ ] Close [×] button beside title — native confirm to save or discard
- [ ] Load project from ZIP: minimal STORE-only zip-reader.ts, restore WAV + slices
- [ ] Show start screen on close, hide when project active

## Naming & Project
- [ ] Project name (auto-generated, changeable)
- [ ] Slice names derived from project name (e.g. `projectname_001`)
- [ ] `,` to rename individual slices
- [ ] Slice names shown in slice list

## Export & Persistence
- [x] ZIP export containing: each slice WAV, sidecar JSON, original WAV
- [x] Sidecar stores: version, original filename, sample rate, slices
- [ ] Save/load JSON sidecar file (`filename.slices.json`)
- [ ] Resume from sidecar: reload slice boundaries and names
- [ ] **Open question:** after resuming from sidecar, should renaming/reordering be locked
  to avoid confusion? Or allow it with a warning?

## Milestone 2 — Usable Editor
- [ ] Pinch-zoom on mobile
- [ ] Support co-located markers (one slice's end on another's start)
- [x] Undo/redo stack

## Milestone 3 — Persistence & PWA
- [ ] IndexedDB auto-save (hash-based WAV key)
- [ ] PWA manifest + service worker
- [ ] Offline support (cache static assets)
- [ ] Improved mobile layout

## Milestone 4 — Auto-Slicing
- [ ] Full auto-slice: detect all transients and create slices automatically
- [ ] RMS-based transient detection with adjustable sensitivity
- [ ] Spectral flux transient detection (optional)
- [ ] Web Worker for heavy DSP (keep UI responsive)
- [ ] Slice refinement: merge/split adjacent slices

## Milestone 5 — Polish & Export
- [ ] Per-slice gain/fade (non-destructive)
- [ ] Batch normalize slices
