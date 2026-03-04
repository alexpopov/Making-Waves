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

## Slice Auto-Suggestions
- [ ] After placing slice start, show ghost markers (light grey) at suggested end points
- [ ] Transient detection: find next attack/hit after the start point using RMS energy spikes
- [ ] Silence detection: find next silence gap (RMS drops below threshold)
- [ ] Zero-crossing snapping: snap suggestions to nearest zero-crossing for click-free cuts
- [ ] Click a ghost marker to accept it as the slice end
- [ ] Configurable sensitivity (threshold slider?)

## Milestone 2 — Usable Editor
- [ ] Zoom + horizontal scroll
- [ ] Pinch-zoom on mobile
- [ ] Drag slice boundaries (already works)
- [ ] Support co-located markers (one slice's end on another's start)
- [ ] Slice labels (editable names)
- [ ] Save/load JSON sidecar file
- [ ] Keyboard shortcuts:
  - [ ] `a` — add mode: next click always adds, bypasses hit-test
  - [ ] `g` — grab mode: drag selected marker from anywhere (Blender-style)
  - [ ] `space` — play/stop
  - [ ] `delete`/`backspace` — remove selected slice
  - [ ] `escape` — cancel pending slice or exit mode
  - [ ] `j`/`k` — select next/previous slice (vim bindings)

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
- [ ] ZIP export (all slices in one download)
- [ ] Naming templates (customizable prefix, numbering)
- [ ] Undo/redo
- [ ] Per-slice gain/fade (non-destructive)
- [ ] Batch normalize slices
