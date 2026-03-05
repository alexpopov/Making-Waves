/**
 * Minimal ZIP file encoder — STORE only (no compression).
 *
 * WAV files don't compress well, so STORE is fine and keeps this tiny.
 * Produces a valid ZIP that any unzip tool can read.
 */

export interface ZipEntry {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Uint8Array<any>;
}

export function createZip(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const parts: ArrayBuffer[] = [];
  const centralDir: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const localHeader = buildLocalHeader(nameBytes, entry.data);
    parts.push(localHeader.buffer as ArrayBuffer);
    parts.push(entry.data.buffer as ArrayBuffer);

    centralDir.push(buildCentralDirEntry(nameBytes, entry.data, offset));
    offset += localHeader.byteLength + entry.data.byteLength;
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const cd of centralDir) {
    parts.push(cd.buffer as ArrayBuffer);
    centralDirSize += cd.byteLength;
  }

  const endRecord = buildEndOfCentralDir(entries.length, centralDirSize, centralDirOffset);
  parts.push(endRecord.buffer as ArrayBuffer);

  return new Blob(parts, { type: 'application/zip' });
}

function buildLocalHeader(name: Uint8Array, data: Uint8Array): Uint8Array {
  const buf = new ArrayBuffer(30 + name.byteLength);
  const view = new DataView(buf);
  const arr = new Uint8Array(buf);

  view.setUint32(0, 0x04034b50, true);   // local file header signature
  view.setUint16(4, 20, true);            // version needed (2.0)
  view.setUint16(6, 0, true);             // general purpose flags
  view.setUint16(8, 0, true);             // compression: STORE
  view.setUint16(10, 0, true);            // mod time
  view.setUint16(12, 0, true);            // mod date
  view.setUint32(14, crc32(data), true);  // CRC-32
  view.setUint32(18, data.byteLength, true); // compressed size
  view.setUint32(22, data.byteLength, true); // uncompressed size
  view.setUint16(26, name.byteLength, true); // filename length
  view.setUint16(28, 0, true);            // extra field length
  arr.set(name, 30);

  return arr;
}

function buildCentralDirEntry(name: Uint8Array, data: Uint8Array, localHeaderOffset: number): Uint8Array {
  const buf = new ArrayBuffer(46 + name.byteLength);
  const view = new DataView(buf);
  const arr = new Uint8Array(buf);

  view.setUint32(0, 0x02014b50, true);    // central dir signature
  view.setUint16(4, 20, true);            // version made by
  view.setUint16(6, 20, true);            // version needed
  view.setUint16(8, 0, true);             // flags
  view.setUint16(10, 0, true);            // compression: STORE
  view.setUint16(12, 0, true);            // mod time
  view.setUint16(14, 0, true);            // mod date
  view.setUint32(16, crc32(data), true);  // CRC-32
  view.setUint32(20, data.byteLength, true); // compressed size
  view.setUint32(24, data.byteLength, true); // uncompressed size
  view.setUint16(28, name.byteLength, true); // filename length
  view.setUint16(30, 0, true);            // extra field length
  view.setUint16(32, 0, true);            // comment length
  view.setUint16(34, 0, true);            // disk number start
  view.setUint16(36, 0, true);            // internal file attributes
  view.setUint32(38, 0, true);            // external file attributes
  view.setUint32(42, localHeaderOffset, true); // relative offset
  arr.set(name, 46);

  return arr;
}

function buildEndOfCentralDir(numEntries: number, centralDirSize: number, centralDirOffset: number): Uint8Array {
  const buf = new ArrayBuffer(22);
  const view = new DataView(buf);

  view.setUint32(0, 0x06054b50, true);    // end of central dir signature
  view.setUint16(4, 0, true);             // disk number
  view.setUint16(6, 0, true);             // disk with central dir
  view.setUint16(8, numEntries, true);     // entries on this disk
  view.setUint16(10, numEntries, true);    // total entries
  view.setUint32(12, centralDirSize, true);
  view.setUint32(16, centralDirOffset, true);
  view.setUint16(20, 0, true);            // comment length

  return new Uint8Array(buf);
}

/** CRC-32 (ISO 3309 / ITU-T V.42) */
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.byteLength; i++) {
    crc = crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
