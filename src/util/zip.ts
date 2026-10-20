// Minimal ZIP reader for the calendar import (Google exports all calendars as one .zip of .ics files).
// Reads the central directory (so data descriptors and odd local headers do not matter), supports the
// methods "stored" (0) and "deflate" (8, through the browser's DecompressionStream('deflate-raw')), skips
// directories and encrypted entries, and returns the text of entries whose name matches `accept`.
// No ZIP64: a file that needs it (over 4 GB or 65535 entries) is far beyond what a calendar export is.

export interface ZipText { name: string; text: string }

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

async function inflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZipTexts(buffer: ArrayBuffer, accept: RegExp, maxEntries = 200): Promise<ZipText[]> {
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(buffer);
  const view = new DataView(buffer);
  // End of central directory: last 22 bytes plus up to 64 KB comment.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_535); i--) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip: no end of central directory');
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const out: ZipText[] = [];
  const decoder = new TextDecoder('utf-8');
  for (let n = 0; n < count && n < maxEntries; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL) throw new Error('zip: bad central directory');
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || (flags & 1) === 1 || !accept.test(name)) continue;
    if (localAt + 30 > bytes.length || view.getUint32(localAt, true) !== LOCAL) continue;
    const dataAt = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    const data = bytes.subarray(dataAt, dataAt + compressed);
    let raw: Uint8Array<ArrayBufferLike>;
    if (method === 0) raw = data;
    else if (method === 8) raw = await inflateRaw(data);
    else continue;
    out.push({ name: name.split('/').pop() ?? name, text: decoder.decode(raw) });
  }
  return out;
}
