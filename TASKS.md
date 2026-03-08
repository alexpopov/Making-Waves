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
- [x] `,` (comma) — rename selected segment
- [x] `.` (period) — toggle selected marker between start/end of segment

## Cursor Feedback
- [x] Top 10% zone: pointer cursor
- [x] When hovering near a draggable marker: grab cursor (not crosshair)
- [ ] When hovering over a selectable region in top zone: pointer cursor

## Pending Marker Behavior
- [x] When only one marker is placed (pending start), pressing play should play from that point
- [x] `h`/`l` should nudge the pending marker
- [x] Pending marker should be draggable
- [x] Only complete the slice (place end) if the second click is sufficiently far from the start
  (close clicks should drag the pending marker instead)

## Project UI
- [x] Start screen with "Load WAV" and "Load Project" buttons (replaces toolbar Load WAV button)
- [x] Centered editable project title in toolbar (white, contenteditable)
- [x] Close [×] button beside title — native confirm to save or discard
- [x] Load project from ZIP: minimal STORE-only zip-reader.ts, restore WAV + slices
- [x] Show start screen on close, hide when project active

## Naming & Project
- [x] Project name (auto-generated, changeable)
- [ ] Slice names derived from project name (e.g. `projectname_001`)
- [x] `,` to rename individual slices
- [x] Slice names shown in slice list

## Export & Persistence
- [x] ZIP export containing: each slice WAV, sidecar JSON, original WAV
- [x] Sidecar stores: version, original filename, sample rate, slices, names
- [ ] Save/load JSON sidecar file (`filename.slices.json`)
- [ ] Resume from sidecar: reload slice boundaries and names
- [ ] **Open question:** after resuming from sidecar, should renaming/reordering be locked
  to avoid confusion? Or allow it with a warning?

## Milestone 2 — iOS / Mobile (portrait-first)

### Touch Gesture System
- [ ] Detect touch vs mouse (use `pointerType` or touch event count)
- [ ] Single-finger drag to pan horizontally on waveform canvas
- [ ] Two-finger pinch to zoom (replace wheel-based zoom on touch)
- [ ] Decouple waveform canvas zones: on touch, entire waveform area is pan/zoom only
  (no marker placement from tapping the waveform on mobile)
- [ ] Prevent iOS Safari bounce/refresh on overscroll (`touch-action`, `overscroll-behavior`)

### Cut Zone (marker placement for touch)
- [ ] Bottom ~20% band below waveform with visual "cut here" affordance
  (dotted line + scissors icon repeating)
- [ ] Tap in cut zone to place marker at the corresponding sample position
- [ ] Cut zone scrolls/zooms in sync with the waveform viewport
- [ ] Same two-tap flow: first tap = start marker, second tap = end marker

### Action Toolbar (above transport bar)
- [ ] Undo button (↩) — calls existing undo logic
- [ ] Redo button (↪) — calls existing redo logic
- [ ] Zoom toggle button — cycles: zoom-to-fit → zoom-to-segment → zoom-to-marker → zoom-out
  Icon changes to reflect current state (magnifying glass +/−)
- [ ] Nudge left button (◀) — nudges selected marker left (same as `h`/ArrowLeft)
- [ ] Nudge right button (▶) — nudges selected marker right (same as `l`/ArrowRight)
- [ ] These buttons also work on desktop (visible always, supplements keyboard shortcuts)

### Portrait Layout
- [ ] Responsive CSS: on narrow screens (max-width ~600px), waveform takes ~35-40% height
  instead of flex:1 (much smaller wave, more room for controls and slice list)
- [ ] Stack toolbars vertically: action toolbar → transport → slice list
- [ ] Touch-sized buttons (min 44×44px tap targets per Apple HIG)
- [ ] Slice list scrollable below transport

### Draggable Pending Marker (desktop + mobile)
- [ ] Pending start marker is draggable on desktop (already works via pointer events)
- [ ] Arrow keys / nudge buttons work on pending marker (already works for keys)
- [ ] On mobile: drag pending marker in the cut zone, or nudge with toolbar buttons

### Future: Ghost Marker Confirmation Flow
_Idea: on iOS, a newly placed marker starts as a "ghost" (semi-transparent).
You can zoom in on it, drag it to refine position, then tap a confirm button
to commit it. This lets you precisely place even the first marker on a phone.
For now, we start with the simpler single-tap model and add confirmation later._
- [ ] Ghost marker state (unconfirmed) with visual distinction
- [ ] Confirm button appears when ghost marker is active
- [ ] Cancel/undo ghost marker
- [ ] Works for both start and end markers independently

## Milestone 2b — Usable Editor
- [ ] Support co-located markers (one slice's end on another's start)
- [x] Undo/redo stack

## Milestone 3 — Persistence & PWA
- [ ] IndexedDB auto-save (hash-based WAV key)
- [ ] PWA manifest + service worker
- [ ] Offline support (cache static assets)

## Milestone 4 — Auto-Slicing
- [ ] Full auto-slice: detect all transients and create slices automatically
- [ ] RMS-based transient detection with adjustable sensitivity
- [ ] Spectral flux transient detection (optional)
- [ ] Web Worker for heavy DSP (keep UI responsive)
- [ ] Slice refinement: merge/split adjacent slices

## Accessibility
- [ ] Convert all `px` font sizes to `rem` so the UI respects the user's system font
  preference (Dynamic Type on iOS). **Will break:** action bar fixed-size buttons
  (44×36px), settings popover `top: 48px` assumption, title `calc(100vw - 130px)`.
  Fix those three simultaneously when doing the conversion.

## Milestone 5 — Polish & Export
- [ ] Per-slice gain/fade (non-destructive)
- [ ] Batch normalize slices
- [ ] Test + verify native save dialog (showSaveFilePicker) on iOS Safari
