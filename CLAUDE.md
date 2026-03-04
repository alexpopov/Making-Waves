# CLAUDE.md — Project Instructions

## Working Style
- Do ONE thing at a time. Don't bundle multiple features into a single change.
- Explain what you're doing as you do it, so the user learns about web development.
- After each change, type-check with `npx tsc --noEmit` before moving on.

## Tech Stack
- Vite + TypeScript (strict mode, ESNext target)
- Vanilla DOM — no frameworks
- Web Audio API (AudioContext, AudioBufferSourceNode, AnalyserNode)
- Canvas 2D for waveform rendering
- Pointer events for unified touch + mouse
- ES modules, no bundler plugins

## Architecture
- `src/audio.ts` — AudioContext singleton, WAV decoding
- `src/waveform.ts` — Peak generation + Canvas 2D drawing
- `src/slicer.ts` — Slice state (overlapping start/end pairs, like rainbow parens)
- `src/player.ts` — Playback engine with AnalyserNode
- `src/wav-writer.ts` — RIFF/WAV PCM encoder
- `src/main.ts` — Glue: DOM events, app state, wires modules together
- `src/style.css` — Dark theme, responsive

## Slice Model
Slices are independent [start, end] pairs that can overlap.
Colors match start/end markers like rainbow parentheses.
Two-click creation: first click = start, second click = end.

## Key Files
- `TASKS.md` — Feature checklist with milestones
- `Requirements.md` — Full product requirements

## Commands
- `npx vite` — dev server
- `npx tsc --noEmit` — type-check
- `npx vite build` — production build
