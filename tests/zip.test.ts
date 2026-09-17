/**
 * The stored-only ZIP codec behind the 📸 photo backup: a round trip, the
 * CRC, the layout an unzip tool expects, and the refusals (compressed,
 * encrypted, corrupt, not a zip at all).
 */
import { describe, expect, it } from 'vitest';

import { buildZip, crc32, readZip } from '../src/storage/zip.ts';

const enc = new TextEncoder();

describe('the zip codec', () => {
  it('crc32 matches the reference value for "123456789"', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('round-trips entries, names (UTF-8) and bytes exactly', () => {
    const entries = [
      { name: 'photos.json', data: enc.encode('{"a":1}') },
      { name: 'photos/2026-09-14_front_abc.jpg', data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]) },
      { name: 'שם/עברי.txt', data: enc.encode('שלום') },
      { name: 'empty', data: new Uint8Array(0) },
    ];
    const zip = buildZip(entries);
    const back = readZip(zip);
    expect(back?.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    for (let i = 0; i < entries.length; i += 1) expect([...(back?.[i]?.data ?? [])]).toEqual([...(entries[i]?.data ?? [])]);
  });

  it('lays out the archive the way every unzip tool expects', () => {
    const zip = buildZip([{ name: 'a.txt', data: enc.encode('hi') }]);
    const v = new DataView(zip.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50); // local header first
    expect(v.getUint32(zip.length - 22, true)).toBe(0x06054b50); // EOCD last
    expect(v.getUint16(zip.length - 22 + 10, true)).toBe(1); // one entry
    expect(v.getUint16(8, true)).toBe(0); // method: stored
  });

  it('refuses what it did not write: junk, a truncated archive, a flipped byte, compression, encryption', () => {
    expect(readZip(enc.encode('not a zip'))).toBeNull();
    const zip = buildZip([{ name: 'a.txt', data: enc.encode('hello world') }]);
    expect(readZip(zip.slice(0, zip.length - 5))).toBeNull();
    const flipped = zip.slice();
    flipped[30 + 5 + 2] = (flipped[30 + 5 + 2] as number) ^ 0xff; // a byte inside the data: the CRC catches it
    expect(readZip(flipped)).toBeNull();
    const deflated = zip.slice();
    deflated[8] = 8; // local method
    const central = zip.length - 22 - (46 + 5);
    deflated[central + 10] = 8; // central method
    expect(readZip(deflated)).toBeNull();
    const encrypted = zip.slice();
    encrypted[central + 8] = (encrypted[central + 8] as number) | 1;
    expect(readZip(encrypted)).toBeNull();
  });
});
