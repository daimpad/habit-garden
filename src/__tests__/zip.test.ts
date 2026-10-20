// ZIP reader (util/zip.ts): stored and deflated entries, directories and other files skipped.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isZip, readZipTexts } from '../util/zip.js';

async function deflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Builds a ZIP with the given entries (method 0 or 8), CRC left at 0 (the reader does not check it). */
async function makeZip(entries: { name: string; text: string; method: 0 | 8 }[]): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const raw = enc.encode(e.text);
    const data = e.method === 8 ? await deflateRaw(raw) : raw;
    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, e.method, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, e.method, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = new Uint8Array(offset + cdSize + 22);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    all.set(part, at);
    at += part.length;
  }
  return all.buffer;
}

describe('zip', () => {
  test('reads stored and deflated .ics entries, skips others', async () => {
    const buf = await makeZip([
      { name: 'Privat_abc@group.calendar.google.com.ics', text: 'BEGIN:VCALENDAR\r\nX-WR-CALNAME:Privat\r\nEND:VCALENDAR', method: 8 },
      { name: 'ordner/', text: '', method: 0 },
      { name: 'ordner/Arbeit.ics', text: 'BEGIN:VCALENDAR\r\nX-WR-CALNAME:Arbeit\r\nEND:VCALENDAR', method: 0 },
      { name: 'liesmich.txt', text: 'x', method: 0 },
    ]);
    assert.equal(isZip(new Uint8Array(buf)), true);
    const files = await readZipTexts(buf, /\.ics$/iu);
    assert.deepEqual(files.map((f) => f.name), ['Privat_abc@group.calendar.google.com.ics', 'Arbeit.ics']);
    assert.match(files[0]?.text ?? '', /X-WR-CALNAME:Privat/u);
  });
  test('not a zip', async () => {
    assert.equal(isZip(new TextEncoder().encode('BEGIN:VCALENDAR')), false);
    await assert.rejects(readZipTexts(new TextEncoder().encode('nope').buffer as ArrayBuffer, /x/u));
  });
});
