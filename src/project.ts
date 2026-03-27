/**
 * Project save/load — ZIP bundle and JSON sidecar.
 *
 * This module is pure logic with no DOM side-effects: it returns Blobs
 * and structured data. main.ts handles downloads, error alerts, and UI
 * state updates after calling these functions.
 */

import { decodeAudioFile } from './audio.js';
import { encodeWavToUint8Array } from './wav-writer.js';
import { createZip } from './zip-writer.js';
import { readZip } from './zip-reader.js';

interface Sidecar {
  version: number;
  projectName?: string;
  originalFile: string;
  sampleRate: number;
  totalSamples: number;
  slices: { start: number; end: number; name?: string }[];
}

/**
 * Rescale slice positions when the sidecar was saved at a different sample
 * rate than the current AudioContext decoded the audio to.
 *
 * Web Audio's decodeAudioData resamples to the AudioContext's sample rate,
 * which varies by device (e.g. 48 kHz on iOS, 44.1 kHz on a Mac with a
 * 44.1 kHz audio interface). Slice positions stored as sample frames must
 * be converted to the new rate or they drift — increasingly toward the end.
 */
function rescaleSlices(
  slices: { start: number; end: number; name?: string }[],
  fromRate: number,
  toRate: number,
): { start: number; end: number; name?: string }[] {
  if (fromRate === toRate) return slices;
  const ratio = toRate / fromRate;
  return slices.map(s => ({
    start: Math.round(s.start * ratio),
    end: Math.round(s.end * ratio),
    name: s.name,
  }));
}

export interface ProjectData {
  audioBuffer: AudioBuffer;
  originalFile: File;
  slices: { start: number; end: number; name?: string }[];
  projectName: string;
}

/** Parse a .zip project file and decode its audio. */
export async function loadProjectZip(file: File): Promise<ProjectData> {
  const buffer = await file.arrayBuffer();
  const entries = readZip(buffer);

  const jsonEntry = entries.find(e => e.name.endsWith('.waves.json'));
  if (!jsonEntry) throw new Error('No .waves.json sidecar found in ZIP');

  const sidecar = JSON.parse(new TextDecoder().decode(jsonEntry.data)) as Sidecar;

  const wavEntry = entries.find(e => e.name === sidecar.originalFile)
    ?? entries.find(e => e.name.toLowerCase().endsWith('.wav'));
  if (!wavEntry) throw new Error('No WAV file found in ZIP');

  const wavFile = new File(
    [wavEntry.data.buffer as ArrayBuffer],
    sidecar.originalFile,
    { type: 'audio/wav' },
  );

  const audioBuffer = await decodeAudioFile(wavFile);
  const projectName = sidecar.projectName ?? sidecar.originalFile.replace(/\.wav$/i, '');
  const slices = rescaleSlices(sidecar.slices, sidecar.sampleRate, audioBuffer.sampleRate);

  return { audioBuffer, originalFile: wavFile, slices, projectName };
}

/** Build a ZIP bundle: original WAV + sidecar JSON + per-slice WAVs. */
export async function buildProjectZip(
  slices: { start: number; end: number; name?: string }[],
  audioBuffer: AudioBuffer,
  originalFile: File,
  projectName: string,
): Promise<Blob> {
  const baseName = projectName || originalFile.name.replace(/\.wav$/i, '');

  const sidecar: Sidecar = {
    version: 1,
    projectName: baseName,
    originalFile: originalFile.name,
    sampleRate: audioBuffer.sampleRate,
    totalSamples: audioBuffer.length,
    slices,
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(sidecar, null, 2));
  const originalBytes = new Uint8Array(await originalFile.arrayBuffer());

  const entries: { name: string; data: Uint8Array }[] = [
    { name: originalFile.name, data: originalBytes },
    { name: `${baseName}.waves.json`, data: jsonBytes },
  ];

  const usedNames = new Map<string, number>();
  slices.forEach((s, i) => {
    const sliceBytes = encodeWavToUint8Array(audioBuffer, s.start, s.end);
    const rawBase = s.name ?? `${baseName}_${String(i + 1).padStart(3, '0')}`;
    // Strip path separators and control characters so ZIP entry names are safe
    // regardless of what the user typed. The name in the JSON sidecar is untouched.
    const base = rawBase.replace(/[/\\]/g, '_').replace(/[\x00-\x1f\x7f]/g, '').trim() || `slice_${i + 1}`;
    const count = usedNames.get(base) ?? 0;
    usedNames.set(base, count + 1);
    const sliceName = count === 0 ? base : `${base}_${count + 1}`;
    entries.push({ name: `${sliceName}.wav`, data: sliceBytes });
  });

  return createZip(entries);
}

export interface SidecarData {
  projectName: string;
  sampleRate: number;
  totalSamples: number;
  slices: { start: number; end: number; name?: string }[];
}

/**
 * Parse a standalone .waves.json sidecar file.
 * Validates that the sampleRate and totalSamples match the loaded buffer.
 * Throws a descriptive error if the sidecar is incompatible.
 */
export async function loadSidecarJson(file: File, audioBuffer: AudioBuffer): Promise<SidecarData> {
  const text = await file.text();
  const data = JSON.parse(text) as Sidecar;

  // Sample rate may differ if the sidecar was created on a device whose
  // AudioContext ran at a different rate (e.g. 48 kHz iOS vs 44.1 kHz Mac).
  // Rescale positions instead of rejecting the file.
  const slices = rescaleSlices(data.slices, data.sampleRate, audioBuffer.sampleRate);

  // Verify total length matches after accounting for resampling.
  const expectedSamples = Math.round(data.totalSamples * audioBuffer.sampleRate / data.sampleRate);
  if (Math.abs(expectedSamples - audioBuffer.length) > 1) {
    throw new Error(
      `Sidecar length (${data.totalSamples} samples at ${data.sampleRate} Hz) does not match ` +
      `loaded audio (${audioBuffer.length} samples at ${audioBuffer.sampleRate} Hz). ` +
      `Make sure you're loading the sidecar for "${data.originalFile}".`
    );
  }

  return {
    projectName: data.projectName ?? data.originalFile.replace(/\.wav$/i, ''),
    sampleRate: audioBuffer.sampleRate,
    totalSamples: audioBuffer.length,
    slices,
  };
}

/** Build a standalone sidecar JSON blob (no audio). */
export function buildSidecarJson(
  slices: { start: number; end: number; name?: string }[],
  audioBuffer: AudioBuffer,
  originalFileName: string,
  projectName: string,
): Blob {
  const data: Sidecar = {
    version: 1,
    projectName,
    originalFile: originalFileName,
    sampleRate: audioBuffer.sampleRate,
    totalSamples: audioBuffer.length,
    slices,
  };
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}
