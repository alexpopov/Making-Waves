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
- [x] After placing slice start, show ghost markers (light grey) at suggested end points
- [ ] Transient detection: find next attack/hit after the start point using RMS energy spikes (#1)
- [ ] Silence detection: find next silence gap (RMS drops below threshold) (#2)
- [ ] Zero-crossing snapping: snap suggestions to nearest zero-crossing for click-free cuts (#3)
- [x] Click a ghost marker to accept it as the slice end
- [ ] Configurable sensitivity (threshold slider?) (#4)

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
- [ ] `g` — grab mode: drag selected marker from anywhere (Blender-style) (#5)
- [ ] `r` — toggle loop (repeat) mode (#6)
- [x] `,` (comma) — rename selected segment
- [x] `.` (period) — toggle selected marker between start/end of segment

## Cursor Feedback
- [x] Top 10% zone: pointer cursor
- [x] When hovering near a draggable marker: grab cursor (not crosshair)
- [x] When hovering over a selectable region in top zone: pointer cursor

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
- [ ] Slice names derived from project name (e.g. `projectname_001`) (#7)
- [x] `,` to rename individual slices
- [x] Slice names shown in slice list

## Export & Persistence
- [x] ZIP export containing: each slice WAV, sidecar JSON, original WAV
- [x] Sidecar stores: version, original filename, sample rate, slices, names
- [x] Use `showSaveFilePicker` ("Save to…") for all file exports on supported browsers
  (Safari 16.4+, Chrome 86+) as the primary flow; fall back to `<a download>` only when
  the API is unavailable. Replaces the current always-download approach.
- [ ] Save/load JSON sidecar file (`filename.slices.json`) (#8)
- [ ] Resume from sidecar: reload slice boundaries and names (#9)
- [ ] **Open question:** after resuming from sidecar, should renaming/reordering be locked
  to avoid confusion? Or allow it with a warning?

## Milestone 2 — iOS / Mobile (portrait-first)

### Touch Gesture System
- [x] Detect touch vs mouse (use `pointerType` or touch event count)
- [x] Single-finger drag to pan horizontally on waveform canvas
- [x] Two-finger pinch to zoom (replace wheel-based zoom on touch)
- [x] Decouple waveform canvas zones: on touch, entire waveform area is pan/zoom only
  (no marker placement from tapping the waveform on mobile)
- [x] Prevent iOS Safari bounce/refresh on overscroll (`touch-action`, `overscroll-behavior`)
- [x] Cannot tap/select markers on iOS — canvas taps currently only trigger pan/zoom; need
  a way to tap-to-select a marker on touch (e.g. via the cut zone or a dedicated hit-test
  that fires before the pan gesture)

### Cut Zone (marker placement for touch)
- [x] Bottom ~20% band below waveform with visual "cut here" affordance
  (dotted line + scissors icon repeating)
- [x] Tap in cut zone to place marker at the corresponding sample position
- [x] Cut zone scrolls/zooms in sync with the waveform viewport
- [x] Same two-tap flow: first tap = start marker, second tap = end marker

### Action Toolbar (above transport bar)
- [x] Undo button (↩) — calls existing undo logic
- [x] Redo button (↪) — calls existing redo logic
- [x] Zoom toggle button — cycles: zoom-to-fit → zoom-to-segment → zoom-to-marker → zoom-out
  Icon changes to reflect current state (magnifying glass +/−)
- [x] Nudge left button (◀) — nudges selected marker left (same as `h`/ArrowLeft)
- [x] Nudge right button (▶) — nudges selected marker right (same as `l`/ArrowRight)
- [x] These buttons also work on desktop (visible always, supplements keyboard shortcuts)

### Portrait Layout
- [x] Responsive CSS: on narrow screens (max-width ~600px), waveform takes ~35-40% height
  instead of flex:1 (much smaller wave, more room for controls and slice list)
- [x] Stack toolbars vertically: action toolbar → transport → slice list
- [x] Touch-sized buttons (min 44×44px tap targets per Apple HIG)
- [x] Slice list scrollable below transport

### Draggable Pending Marker (desktop + mobile)
- [x] Pending start marker is draggable on desktop (already works via pointer events)
- [x] Arrow keys / nudge buttons work on pending marker (already works for keys)
- [x] On mobile: drag pending marker in the cut zone, or nudge with toolbar buttons

### Future: Ghost Marker Confirmation Flow
_Idea: on iOS, a newly placed marker starts as a "ghost" (semi-transparent).
You can zoom in on it, drag it to refine position, then tap a confirm button
to commit it. This lets you precisely place even the first marker on a phone.
For now, we start with the simpler single-tap model and add confirmation later._
- [x] Ghost marker state (unconfirmed) with visual distinction
- [ ] Confirm button appears when ghost marker is active (#10)
- [x] Cancel/undo ghost marker
- [x] Works for both start and end markers independently

## Milestone 2b — Usable Editor
- [ ] Support co-located markers (one slice's end on another's start) (#11)
- [x] Undo/redo stack

## Milestone 3 — Persistence & PWA
- [ ] iOS Safari kills the tab aggressively when backgrounded — save on `visibilitychange` and `pagehide` as a belt-and- (#12)
  suspenders safety net.
- [ ] PWA manifest + service worker (#13)
- [ ] Offline support (cache static assets) (#14)

## Milestone 4 — Auto-Slicing

All cancelled, not interested in this for now
- [c] Full auto-slice: detect all transients and create slices automatically
- [c] RMS-based transient detection with adjustable sensitivity
- [c] Spectral flux transient detection (optional)
- [c] Web Worker for heavy DSP (keep UI responsive)
- [c] Slice refinement: merge/split adjacent slices

## Accessibility
- [ ] Convert all `px` font sizes to `rem` so the UI respects the user's system font (#15)
  preference (Dynamic Type on iOS). **Will break:** action bar fixed-size buttons
  (44×36px), settings popover `top: 48px` assumption, title `calc(100vw - 130px)`.
  Fix those three simultaneously when doing the conversion.
- [x] Make contenteditable fields (project title, slice names) obviously editable: add a
  visible affordance such as a subtle underline, pencil icon, or focus ring on hover so
  users know they can tap/click to edit.

## Mobile UX
- [ ] Reconsider marker triangle + handle panel placement on mobile: `markersAtBottom` (#16)
  flag exists in `DrawOptions` and `main.ts` (currently hardcoded `false`). Flip to
  `window.matchMedia('(max-width: 600px)').matches` when the interaction model
  (cut zone at bottom, thumb reach) is settled.
- [ ] Landscape layout is completely broken on iOS — elements overlap, waveform is unusable. (#17)
  Need a landscape-specific layout (probably similar to the desktop wide layout but with
  touch-sized targets).
- [ ] iOS silent mode blocks all audio. Fix: call `ctx.resume()` + play a silent 0-frame (#18)
  buffer on the first user gesture to unlock the AudioContext. Document that headphones
  bypass the silent switch. Consider a visible "tap to enable audio" prompt if `ctx.state`
  is `suspended` after first interaction.
- [ ] Contenteditable fields (project title, slice names) are hidden behind the iOS soft (#19)
  keyboard when focused — the page doesn't scroll to keep the field visible. Use
  `element.scrollIntoView({ behavior: 'smooth', block: 'nearest' })` on focus, or set
  `inputmode` + listen for `visualViewport` resize to nudge layout.

## Milestone 5 — Polish & Export
- [ ] Per-slice gain/fade (non-destructive) (#20)
- [ ] Batch normalize slices (#21)
- [x] Deprioritize slice duration in the slice list — smaller/muted text so the name
  is the primary identity and the timestamp feels secondary
- [x] Replace emoji in cut zone label with SVG scissors heroicon (consistent with the
  rest of the icon set, renders correctly on iOS regardless of emoji font)
- [x] Set up heroicons as a local SVG source: clone
  https://github.com/tailwindlabs/heroicons.git and reference icons by path rather than
  hand-copying `<path>` strings into source. Opens up the full icon library.
