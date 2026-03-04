/**
 * WAV file encoder — writes proper RIFF/WAV headers with PCM data.
 *
 * WAV structure:
 *   RIFF header (12 bytes)
 *   fmt  chunk  (24 bytes) — sample rate, bit depth, channels
 *   data chunk  (8 + N bytes) — raw PCM samples
 */

export interface WavOptions {
  sampleRate: number;
  numChannels: number;
  bitDepth: 16 | 24;
}

/**
 * Encode a region of an AudioBuffer to a WAV Blob.
 */
export function encodeWav(
  buffer: AudioBuffer,
  startSample: number,
  endSample: number,
  bitDepth: 16 | 24 = 16
): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = endSample - startSample;
  const bytesPerSample = bitDepth / 8;
  const dataSize = length * numChannels * bytesPerSample;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);

  // Collect channel data
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, totalSize - 8, true);       // file size - 8
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);                  // chunk size (PCM = 16)
  view.setUint16(20, 1, true);                   // audio format (1 = PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // byte rate
  view.setUint16(32, numChannels * bytesPerSample, true);              // block align
  view.setUint16(34, bitDepth, true);

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Write interleaved PCM samples
  let offset = headerSize;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = channels[c][startSample + i];

      if (bitDepth === 16) {
        const val = Math.max(-1, Math.min(1, sample));
        view.setInt16(offset, val < 0 ? val * 0x8000 : val * 0x7FFF, true);
        offset += 2;
      } else {
        // 24-bit: scale to [-8388608, 8388607]
        const val = Math.max(-1, Math.min(1, sample));
        const intVal = val < 0 ? val * 0x800000 : val * 0x7FFFFF;
        const rounded = Math.round(intVal);
        view.setUint8(offset, rounded & 0xFF);
        view.setUint8(offset + 1, (rounded >> 8) & 0xFF);
        view.setUint8(offset + 2, (rounded >> 16) & 0xFF);
        offset += 3;
      }
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * Trigger a file download in the browser.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
