# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is
Making Waves — a browser-based WAV slicer for sample prep (Digitakt 2, etc).
Runs entirely client-side, no server processing. Works on desktop and iOS Safari.

## Commands
- `npx vite` — dev server
- `npx tsc --noEmit` — type-check (run after every change)
- `npx vite build` — production build (runs tsc first, output in `dist/`)

## Working Style
- Do ONE thing at a time. Don't bundle multiple features into a single change.
- Explain what you're doing as you do it, so the user learns about web development.
- After each change, type-check with `npx tsc --noEmit` before moving on.
- Keep modules small and focused. Extract new concerns into their own modules.
- Don't grow spaghetti — refactor proactively when things get tangled.

## Git Commits
- ALWAYS write commit message to `/tmp/commit-msg.txt`, then `git commit -F /tmp/commit-msg.txt`.
- NEVER use `git commit -m` — special chars break it.

## Tech Stack
- Vite + TypeScript (strict mode, ESNext target, `noUnusedLocals`/`noUnusedParameters`)
- Vanilla DOM — no frameworks
- Web Audio API (AudioContext, AudioBufferSourceNode, AnalyserNode)
- Canvas 2D for waveform rendering
- Pointer events for unified touch + mouse
- ES modules, no bundler plugins
- No runtime dependencies (devDependencies only: vite, typescript)

## Architecture

### Core Audio Pipeline
- `src/audio.ts` — AudioContext singleton, WAV decoding
- `src/player.ts` — Playback engine with AnalyserNode + animated playhead
- `src/wav-writer.ts` — RIFF/WAV PCM encoder (16-bit/24-bit)
- `src/dsp.ts` — Pure DSP utilities (transient detection, zero-crossing analysis), Web Worker safe

### Rendering & Viewport
- `src/waveform.ts` — Peak generation + Canvas 2D drawing
- `src/viewport.ts` — Zoom/pan state, gesture locking, dead-zone centering
- `src/zoom.ts` — Zoom state cycling (out → segment → marker → out)
- `src/coords.ts` — Coordinate-space types and conversion (sample ↔ pixel, viewport)
- `src/constants.ts` — Shared constants (e.g. SELECT_ZONE ratio)

### Slice Model & State
- `src/slicer.ts` — Slice state (overlapping start/end pairs, rainbow-paren colors)
- `src/undo.ts` — Undo/redo stack with full state snapshots
- `src/slice-list.ts` — Sidebar slice list UI with pooled DOM rows

### Input Handling
- `src/keyboard.ts` — Keyboard shortcut handler, delegates to context callbacks
- `src/touch.ts` — Multi-touch gestures (pan, pinch-zoom, hold-drag) for mobile

### Persistence & I/O
- `src/project.ts` — Project save/load via ZIP bundles and JSON sidecars (pure logic, no DOM)
- `src/persistence.ts` — Session persistence (IndexedDB for WAV, localStorage for metadata)
- `src/zip-writer.ts` — Minimal STORE-only ZIP encoder (no compression)
- `src/zip-reader.ts` — Minimal STORE-only ZIP decoder

### UI & Glue
- `src/main.ts` — Glue: DOM events, app state, wires all modules together
- `src/icons.ts` — Heroicon SVG strings for button icons
- `src/debug.ts` — Runtime-toggleable debug logging
- `src/style.css` — Dark theme, responsive layout

## Key Domain Concepts

### Slice Model
Slices are independent [start, end] sample-frame pairs that can overlap.
Colors match start/end markers like rainbow parentheses.
Two-click creation: first click = start, second click = end.
Slices are kept sorted by start position (then end). Indices may
change after creation or marker drag — track by object reference, not index.

### Viewport Zones
- Top 10% of canvas = selection zone (pointer cursor, heavier tint)
- Bottom 90% = marker placement zone (crosshair cursor)
- On mobile: bottom ~20% = cut zone (tap to place markers, scissors affordance)
- Waveform draws between 10%–90% of canvas height

### Viewport Behavior
- Zoom: fall-off via sqrt, sticky anchor per gesture, Cinemachine dead-zone centering
- Pan/zoom direction locks per gesture (first axis wins, 150ms reset)
- `j`/`k` selection triggers Cinemachine-style viewport follow

## Key Files
- `TASKS.md` — Feature checklist with milestones and issue numbers
- `Requirements.md` — Full product requirements
