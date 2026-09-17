/**
 * storage/zip.ts — a minimal ZIP writer and reader for the 📸 photo backup.
 *
 * STORED entries only (method 0, no compression): the payload is JPEGs, which
 * do not compress, plus one small JSON manifest — and "stored" keeps this at a
 * hundred lines with no dependency, no WebAssembly and nothing for `npm run
 * verify` to worry about. Any unzip tool opens the result; the reader here
 * accepts only what the writer makes (stored, no encryption, no ZIP64) and
 * returns `null` for anything else, so a stray archive fails loudly and early
 * instead of half-importing.
 *
 * Pure bytes in, pure bytes out — no DOM, so it is unit-tested directly.
 */

export interface ZipEntry {
  /** The path inside the archive, '/'-separated, UTF-8. */
  name: string;
  data: Uint8Array;
}

/** A Uint8Array over its own (non-shared) buffer — what `new Blob([...])` demands under strict lib types. */
export type Bytes = Uint8Array<ArrayBuffer>;

/* ------------------------------------------------------------------ crc32 */

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = (CRC_TABLE[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ----------------------------------------------------------------- writer */

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
/** DOS date/time of 1980-01-01 00:00 — timestamps live in the manifest, not here. */
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;

const enc = new TextEncoder();
const dec = new TextDecoder();

function u16(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff];
}
function u32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

/** Build a stored-only archive. Throws on a name over 65535 bytes or a total over 4 GB (never, here). */
export function buildZip(entries: readonly ZipEntry[]): Bytes {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const flags = 1 << 11; // bit 11: the name is UTF-8
    const local = new Uint8Array([
      ...u32(LOCAL_SIG), ...u16(20), ...u16(flags), ...u16(0), ...u16(DOS_TIME), ...u16(DOS_DATE),
      ...u32(crc), ...u32(e.data.length), ...u32(e.data.length), ...u16(name.length), ...u16(0),
    ]);
    parts.push(local, name, e.data);
    central.push(
      new Uint8Array([
        ...u32(CENTRAL_SIG), ...u16(20), ...u16(20), ...u16(flags), ...u16(0), ...u16(DOS_TIME), ...u16(DOS_DATE),
        ...u32(crc), ...u32(e.data.length), ...u32(e.data.length), ...u16(name.length), ...u16(0), ...u16(0),
        ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
      ]),
      name,
    );
    offset += local.length + name.length + e.data.length;
  }
  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array([
    ...u32(EOCD_SIG), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length),
    ...u32(centralSize), ...u32(offset), ...u16(0),
  ]);
  const total = offset + centralSize + eocd.length;
  const out: Bytes = new Uint8Array(new ArrayBuffer(total));
  let p = 0;
  for (const chunk of [...parts, ...central, eocd]) {
    out.set(chunk, p);
    p += chunk.length;
  }
  return out;
}

/* ----------------------------------------------------------------- reader */

/**
 * Read a stored-only archive. `null` when it is not a ZIP, uses compression
 * or encryption, or any entry's CRC does not match — a corrupt backup must
 * not import a single byte.
 */
export function readZip(bytes: Uint8Array): (ZipEntry & { data: Bytes })[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record is the LAST thing; walk back to its signature.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 0xffff; i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out: (ZipEntry & { data: Bytes })[] = [];
  for (let n = 0; n < count; n += 1) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== CENTRAL_SIG) return null;
    const method = view.getUint16(p + 10, true);
    const flags = view.getUint16(p + 8, true);
    const crc = view.getUint32(p + 16, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    if (method !== 0 || (flags & 1) !== 0) return null;
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (local + 30 > bytes.length || view.getUint32(local, true) !== LOCAL_SIG) return null;
    const lNameLen = view.getUint16(local + 26, true);
    const lExtraLen = view.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    if (start + size > bytes.length) return null;
    const data: Bytes = new Uint8Array(new ArrayBuffer(size));
    data.set(bytes.subarray(start, start + size));
    if (crc32(data) !== crc) return null;
    out.push({ name, data });
  }
  return out;
}
