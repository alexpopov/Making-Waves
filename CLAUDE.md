# CLAUDE.md — Project Instructions

## Working Style
- Do ONE thing at a time. Don't bundle multiple features into a single change.
- Explain what you're doing as you do it, so the user learns about web development.
- After each change, type-check with `npx tsc --noEmit` before moving on.
- Keep modules small and focused. When a function or concern grows, extract it into its own module rather than letting files become monolithic.
- Don't grow spaghetti — refactor proactively when things get tangled.

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
- `src/viewport.ts` — Zoom/pan state, gesture locking, dead-zone centering
- `src/main.ts` — Glue: DOM events, app state, wires modules together
- `src/style.css` — Dark theme, responsive

## Slice Model
Slices are independent [start, end] pairs that can overlap.
Colors match start/end markers like rainbow parentheses.
Two-click creation: first click = start, second click = end.
Slices are kept sorted by start position (then end). Indices may
change after creation or marker drag — track by object reference.

## Viewport
- Top 10% of canvas = selection zone (pointer cursor, heavier tint)
- Bottom 90% = marker placement zone (crosshair cursor)
- Waveform draws between 10%–90% of canvas height
- Zoom: fall-off via sqrt, sticky anchor per gesture, Cinemachine dead-zone centering
- Pan/zoom direction locks per gesture (first axis wins, 150ms reset)
- `j`/`k` selection triggers Cinemachine-style viewport follow

## Key Files
- `TASKS.md` — Feature checklist with milestones
- `Requirements.md` — Full product requirements

## Commands
- `npx vite` — dev server
- `npx tsc --noEmit` — type-check
- `npx vite build` — production build

## Git Commits
- Use `git commit -m "$(cat <<'COMMIT' ... COMMIT)"` heredoc style for commit messages.
- Avoid unescaped apostrophes/quotes inside the heredoc body.
