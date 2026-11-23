// Minimal ASN.1 DER encoder / parser — just what ZATCA needs (CSR building, X.509 certificate reading).
// Pure TypeScript, no dependencies: runs in Deno (Edge Functions) and Node (Vitest).

export type Bytes = Uint8Array;

export const utf8 = (s: string): Bytes => new TextEncoder().encode(s);
export const fromUtf8 = (b: Bytes): string => new TextDecoder().decode(b);

export function concat(...parts: Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function toBase64(b: Bytes): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(s: string): Bytes {
  const bin = atob(s.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const toHex = (b: Bytes): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export function fromHex(h: string): Bytes {
  const clean = h.replace(/[^0-9a-f]/gi, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

// ---------------- encoding ----------------
function encLength(n: number): Bytes {
  if (n < 0x80) return Uint8Array.of(n);
  const bytes: number[] = [];
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

export const tlv = (tag: number, value: Bytes): Bytes => concat(Uint8Array.of(tag), encLength(value.length), value);
export const seq = (...items: Bytes[]): Bytes => tlv(0x30, concat(...items));
export const set = (...items: Bytes[]): Bytes => tlv(0x31, concat(...items));
export const octet = (b: Bytes): Bytes => tlv(0x04, b);
export const bitString = (b: Bytes): Bytes => tlv(0x03, concat(Uint8Array.of(0), b));
export const utf8String = (s: string): Bytes => tlv(0x0c, utf8(s));
export const printableString = (s: string): Bytes => tlv(0x13, utf8(s));
export const ctx = (n: number, value: Bytes, constructed = true): Bytes => tlv((constructed ? 0xa0 : 0x80) | n, value);

export function integer(n: number | bigint): Bytes {
  let v = BigInt(n);
  if (v === 0n) return tlv(0x02, Uint8Array.of(0));
  const bytes: number[] = [];
  while (v > 0n) {
    bytes.unshift(Number(v & 0xffn));
    v >>= 8n;
  }
  if (bytes[0] & 0x80) bytes.unshift(0);
  return tlv(0x02, Uint8Array.from(bytes));
}

export function oid(dotted: string): Bytes {
  const parts = dotted.split('.').map((p) => BigInt(p));
  const out: number[] = [Number(parts[0] * 40n + parts[1])];
  for (const p of parts.slice(2)) {
    const chunk: number[] = [];
    let v = p;
    do {
      chunk.unshift(Number(v & 0x7fn));
      v >>= 7n;
    } while (v > 0n);
    for (let i = 0; i < chunk.length - 1; i++) chunk[i] |= 0x80;
    out.push(...chunk);
  }
  return tlv(0x06, Uint8Array.from(out));
}

// ---------------- parsing ----------------
export interface Node {
  tag: number;
  start: number; // offset of the tag byte
  header: number; // tag + length bytes
  length: number; // content length
  bytes: Bytes; // the whole TLV
  content: Bytes;
  children?: Node[];
}

export function parse(buf: Bytes, offset = 0): Node {
  const tag = buf[offset];
  let len = buf[offset + 1];
  let header = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[offset + 2 + i];
    header += n;
  }
  const bytes = buf.subarray(offset, offset + header + len);
  const content = buf.subarray(offset + header, offset + header + len);
  const node: Node = { tag, start: offset, header, length: len, bytes, content };
  if (tag & 0x20) {
    node.children = [];
    let p = 0;
    while (p < content.length) {
      const child = parse(content, p);
      node.children.push(child);
      p += child.header + child.length;
    }
  }
  return node;
}

export function decodeOid(content: Bytes): string {
  const parts: bigint[] = [];
  let v = 0n;
  for (let i = 0; i < content.length; i++) {
    v = (v << 7n) | BigInt(content[i] & 0x7f);
    if (!(content[i] & 0x80)) {
      parts.push(v);
      v = 0n;
    }
  }
  const first = parts.shift() as bigint;
  const a = first < 80n ? first / 40n : 2n;
  return [a, first - a * 40n, ...parts].join('.');
}

export function decodeInteger(content: Bytes): bigint {
  let v = 0n;
  for (const b of content) v = (v << 8n) | BigInt(b);
  if (content.length && content[0] & 0x80) v -= 1n << BigInt(content.length * 8);
  return v;
}

export function pem(label: string, der: Bytes): string {
  const b64 = toBase64(der);
  const lines = b64.match(/.{1,64}/g) || [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}
