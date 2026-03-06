/**
 * Minimal ZIP file reader — STORE only (no compression).
 *
 * Mirrors zip-writer.ts: reads ZIPs that we produce (STORE method, no extras).
 * Parses central directory to find entries, then reads file data from local headers.
 */

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/**
 * Read a STORE-only ZIP from an ArrayBuffer.
 * Returns an array of { name, data } entries.
 */
export function readZip(buffer: ArrayBuffer): ZipEntry[] {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // Find End of Central Directory record (last 22+ bytes)
  const eocdOffset = findEOCD(bytes);
  if (eocdOffset < 0) throw new Error('Invalid ZIP: cannot find end of central directory');

  const numEntries = view.getUint16(eocdOffset + 8, true);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);

  const entries: ZipEntry[] = [];
  let cdOffset = centralDirOffset;

  for (let i = 0; i < numEntries; i++) {
    const sig = view.getUint32(cdOffset, true);
    if (sig !== 0x02014b50) throw new Error(`Invalid central directory entry at offset ${cdOffset}`);

    const compression = view.getUint16(cdOffset + 10, true);
    if (compression !== 0) throw new Error(`Unsupported compression method ${compression} (only STORE is supported)`);

    const compressedSize = view.getUint32(cdOffset + 20, true);
    const nameLen = view.getUint16(cdOffset + 28, true);
    const extraLen = view.getUint16(cdOffset + 30, true);
    const commentLen = view.getUint16(cdOffset + 32, true);
    const localHeaderOffset = view.getUint32(cdOffset + 42, true);

    const nameBytes = bytes.subarray(cdOffset + 46, cdOffset + 46 + nameLen);
    const name = new TextDecoder().decode(nameBytes);

    // Read data from local file header
    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const data = bytes.slice(dataOffset, dataOffset + compressedSize);

    entries.push({ name, data });

    cdOffset += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

/** Scan backward from end of buffer to find EOCD signature (0x06054b50) */
function findEOCD(bytes: Uint8Array): number {
  // EOCD is at least 22 bytes, search backward from the end
  const minOffset = Math.max(0, bytes.length - 65557); // max comment = 65535
  for (let i = bytes.length - 22; i >= minOffset; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b &&
        bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      return i;
    }
  }
  return -1;
}
