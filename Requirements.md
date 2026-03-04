Below is a clean, structured **requirements + milestones document** for the custom web‑based WAV slicer we’ve been shaping. It captures the full concept: a **local‑only, persistent, multi‑slice editor** that runs in the browser, works on iPhone/Mac, and exports Digitakt‑ready WAVs.

---

# **Web‑Based WAV Slicer — Requirements & Milestones Document**

## **1. Purpose**
A browser‑based tool for slicing long WAV files into multiple smaller WAVs, with **persistent slice metadata**, **local‑only processing**, and a **fast, minimal UI** optimized for sample‑prep workflows (e.g., Digitakt 2).

The tool must:
- Run entirely client‑side (no uploads, no server processing).
- Work on desktop and mobile browsers (including iOS Safari).
- Allow saving and reloading slice sessions.
- Export multiple WAV slices cleanly.

---

# **2. Core Functional Requirements**

## **2.1 File Handling**
- Load WAV files via:
  - File Picker API (all browsers)
  - Drag‑and‑drop (desktop)
- Support at least:
  - 16‑bit / 24‑bit WAV
  - 44.1 kHz / 48 kHz
- Decode WAV using Web Audio API (`decodeAudioData`).

## **2.2 Waveform Display**
- Generate a downsampled peak array for efficient rendering.
- Render waveform using:
  - Canvas 2D (baseline)
  - Optional WebGL for smoother zooming
- Support:
  - Zoom in/out
  - Horizontal scrolling
  - Tap/drag to set slice markers

## **2.3 Slicing**
- Add/remove slice markers manually.
- Drag slice boundaries to adjust.
- Snap to nearest zero‑crossing (optional toggle).
- Auto‑slice modes (optional, later milestone):
  - RMS energy threshold
  - Spectral flux transient detection
  - Adjustable sensitivity

## **2.4 Slice Persistence**
Two persistence mechanisms:

### **A. Sidecar JSON file**
Stored next to the WAV:
```
myfile.wav
myfile.slices.json
```

JSON contains:
- Version number
- Original WAV filename
- Sample rate
- Array of slice boundaries (in sample frames)
- Optional labels

### **B. Local auto‑save (IndexedDB)**
- Hash WAV file (e.g., first 64 KB) to create a stable key.
- Auto‑save slice metadata on every change.
- Auto‑restore when the same WAV is loaded again.

## **2.5 Export**
- Export each slice as a separate WAV file.
- WAV writer must:
  - Write proper RIFF/WAV headers
  - Support 16‑bit PCM output
- Export options:
  - Individual WAVs
  - ZIP archive containing all slices (optional)
- Naming template:
  - `basename_001.wav`
  - `basename_slice_01.wav`
  - Custom prefix

## **2.6 Playback**
- Preview playback of:
  - Entire file
  - Individual slices
- Playhead cursor synced to waveform.

---

# **3. Non‑Functional Requirements**

## **3.1 Performance**
- Handle files up to 10–20 minutes on desktop.
- Handle 1–5 minute files on iOS Safari without stutter.
- All DSP must run in:
  - Main thread (baseline)
  - Web Worker (optional for heavy auto‑slice)

## **3.2 Privacy & Local‑Only**
- No server‑side audio processing.
- No file uploads.
- All data stays in browser memory or local storage.

## **3.3 Cross‑Platform**
- Must work on:
  - macOS Safari/Chrome/Firefox
  - iOS Safari (PWA install recommended)
  - Windows/Linux desktop browsers
- Touch‑friendly UI for mobile.

## **3.4 PWA Support**
- Installable as a pseudo‑native app.
- Offline‑capable (static assets cached).

---

# **4. UI Requirements**

## **4.1 Layout**
- Top bar: Load WAV, Load Slices, Save Slices, Export.
- Main area: Waveform canvas with slice markers.
- Bottom bar: Zoom controls, playback controls, slice list.

## **4.2 Slice List**
- Shows all slices with:
  - Start/end times
  - Duration
  - Editable label
- Tap to jump to slice.
- Delete slice.

## **4.3 Interaction**
- Tap to add marker.
- Drag marker to adjust.
- Pinch‑zoom on mobile.
- Scroll/drag to navigate waveform.

---

# **5. Architecture Overview**

## **5.1 Modules**
- **AudioLoader** — loads WAV → AudioBuffer.
- **WaveformProcessor** — downsampling, peak generation.
- **SlicingEngine** — slice detection, zero‑crossing, adjustments.
- **PersistenceManager** — JSON sidecar + IndexedDB auto‑save.
- **WavWriter** — PCM → WAV file builder.
- **UI Layer** — waveform canvas, slice list, controls.

## **5.2 Optional WASM Module**
- For heavy DSP (spectral flux).
- Rust or AssemblyScript recommended.

---

# **6. Milestones**

## **Milestone 1 — MVP (1–2 weeks)**
- Load WAV
- Display waveform (static)
- Add/remove slice markers
- Export slices as WAVs
- Basic UI

## **Milestone 2 — Usable Editor (2–4 weeks)**
- Zoom + scroll
- Drag slice boundaries
- Zero‑crossing snapping
- Slice list panel
- Playback of slices
- Save/load JSON sidecar

## **Milestone 3 — Persistence & PWA (1–2 weeks)**
- IndexedDB auto‑save
- PWA install
- Offline support
- Better mobile UI

## **Milestone 4 — Auto‑Slicing (2–4 weeks)**
- RMS‑based transient detection
- Adjustable sensitivity
- Slice refinement tools
- WASM acceleration (optional)

## **Milestone 5 — Polish & Export Options (1–2 weeks)**
- ZIP export
- Naming templates
- Undo/redo
- Improved waveform rendering (WebGL optional)

---

# **7. Future Enhancements (Optional)**
- Per‑slice gain/fade
- Batch normalization
- Multi‑file project support
- Metadata tagging
- Integration with cloud storage APIs (local‑only by default)

---

If you want, I can also produce a **technical architecture diagram**, a **data model**, or a **UI wireframe** to help you start building.
