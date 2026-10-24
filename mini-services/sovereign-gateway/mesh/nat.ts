// ═══ מש-הריבונות · קודקי-חוט טהורים — STUN RFC5389 · NAT-PMP RFC6886 · UPnP ═══
// אפס-תלויות · אפס-שעון-קיר · אפס-רשת בקוד-הטהור — הכל בתים ומתמטיקה מדויקת.
// חוק-האמת: כל-וקטור-כאן נגזר-ביד (ראה nat.test.ts) — לא מומצא.

const MAGIC_BYTES = Uint8Array.of(0x21, 0x12, 0xa4, 0x42); // RFC 5389 §6
export const MAGIC_COOKIE = MAGIC_BYTES;
const FINGERPRINT_XOR = 0x5354554e; // RFC 5389 §15.5

// ─── CRC32 (IEEE 802.3, poly 0xEDB88320 reflected) ───────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export const CRC32_TEST_VECTOR = crc32(new TextEncoder().encode('123456789'));

// ─── IP address byte/string conversion ───────────────────────────────────────
function ip4ToBytes(s: string): Uint8Array {
  const parts = s.split('.');
  if (parts.length !== 4) throw new Error(`bad ipv4: ${s}`);
  const b = parts.map((p) => Number(p));
  if (b.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) throw new Error(`bad ipv4: ${s}`);
  return Uint8Array.from(b);
}

function ip6ToBytes(s: string): Uint8Array {
  // supports full and '::' compressed forms; groups are 16-bit hex
  const head = s.startsWith('[') && s.endsWith(']') ? s.slice(1, -1) : s;
  const dbl = head.indexOf('::');
  let groups: number[];
  if (dbl === -1) {
    groups = head.split(':').map((g) => parseInt(g, 16));
  } else {
    const left = dbl === 0 ? [] : head.slice(0, dbl).split(':');
    const right = dbl + 2 >= head.length ? [] : head.slice(dbl + 2).split(':');
    const fill = 8 - left.length - right.length;
    if (fill < 1) throw new Error(`bad ipv6: ${s}`);
    groups = [...left.map((g) => parseInt(g, 16)), ...Array<number>(fill).fill(0), ...right.map((g) => parseInt(g, 16))];
  }
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) throw new Error(`bad ipv6: ${s}`);
  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    out[i * 2] = groups[i] >> 8;
    out[i * 2 + 1] = groups[i] & 0xff;
  }
  return out;
}

export function ipBytesToString(b: Uint8Array, family: 4 | 6): string {
  if (family === 4) return Array.from(b).join('.');
  const groups: number[] = [];
  for (let i = 0; i < 8; i++) groups.push((b[i * 2] << 8) | b[i * 2 + 1]);
  // compress the longest zero run (>=2) with '::'
  let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
  for (let i = 0; i < 8; i++) {
    if (groups[i] === 0) {
      if (curStart === -1) curStart = i;
      curLen++;
      if (curLen > bestLen) { bestStart = curStart; bestLen = curLen; }
    } else { curStart = -1; curLen = 0; }
  }
  if (bestLen >= 2) {
    const l = groups.slice(0, bestStart).map((g) => g.toString(16)).join(':');
    const r = groups.slice(bestStart + bestLen).map((g) => g.toString(16)).join(':');
    return `${l}::${r}`;
  }
  return groups.map((g) => g.toString(16)).join(':');
}

function xorAddr(addr: Uint8Array): Uint8Array {
  const out = new Uint8Array(addr.length);
  for (let i = 0; i < addr.length; i++) out[i] = addr[i] ^ MAGIC_BYTES[i % 4];
  return out;
}

// ─── STUN message codec (RFC 5389) ───────────────────────────────────────────
export interface StunEndpoint { address: string; port: number; family: 4 | 6 }

function attrBytes(type: number, value: Uint8Array): Uint8Array {
  const pad = (4 - (value.length % 4)) % 4;
  const out = new Uint8Array(4 + value.length + pad);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, type);
  dv.setUint16(2, value.length);
  out.set(value, 4);
  return out;
}

function buildAddressValue(addr: StunEndpoint, xor: boolean): Uint8Array {
  const family = addr.family;
  const ab = family === 4 ? ip4ToBytes(addr.address) : ip6ToBytes(addr.address);
  const port = xor ? (addr.port ^ ((MAGIC_BYTES[0] << 8) | MAGIC_BYTES[1])) & 0xffff : addr.port;
  const stored = xor ? xorAddr(ab) : ab;
  const v = new Uint8Array(4 + stored.length);
  v[1] = family === 4 ? 0x01 : 0x02; // RFC 5389 §15.1 wire family codes
  new DataView(v.buffer).setUint16(2, port);
  v.set(stored, 4);
  return v;
}

export function encodeBindingRequest(txId: Uint8Array): Uint8Array {
  if (txId.length !== 12) throw new Error('STUN txId must be exactly 12 bytes');
  const out = new Uint8Array(20);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 0x0001); // Binding Request
  dv.setUint16(2, 0); // no attributes
  out.set(MAGIC_BYTES, 4);
  out.set(txId, 8);
  return out;
}

export interface EncodeBindingResponseInput {
  txId: Uint8Array;
  xorMapped?: StunEndpoint;
  mapped?: StunEndpoint;
  errorCode?: { code: number; reason: string };
  fingerprint?: boolean;
}

export function encodeBindingResponse(input: EncodeBindingResponseInput): Uint8Array {
  if (input.txId.length !== 12) throw new Error('STUN txId must be exactly 12 bytes');
  const attrs: Uint8Array[] = [];
  if (input.mapped) attrs.push(attrBytes(0x0001, buildAddressValue(input.mapped, false)));
  if (input.xorMapped) attrs.push(attrBytes(0x0020, buildAddressValue(input.xorMapped, true)));
  if (input.errorCode) {
    const reason = new TextEncoder().encode(input.errorCode.reason);
    const v = new Uint8Array(4 + reason.length);
    v[2] = Math.floor(input.errorCode.code / 100);
    v[3] = input.errorCode.code % 100;
    v.set(reason, 4);
    attrs.push(attrBytes(0x0009, v));
  }
  // RFC 5389 §15.5: FINGERPRINT's CRC covers the message INCLUDING the header
  // (with the FINAL msgLen — which counts the fingerprint attr itself) up to
  // (excluding) the FINGERPRINT attribute.
  const attrsLenNoFp = attrs.reduce((a, b) => a + b.length, 0);
  const fpAttrLen = 4 + 4; // type+len + 4B crc value
  const msgLen = input.fingerprint ? attrsLenNoFp + fpAttrLen : attrsLenNoFp;
  const head = new Uint8Array(20);
  const hdv = new DataView(head.buffer);
  hdv.setUint16(0, 0x0101); // Binding Success Response
  hdv.setUint16(2, msgLen);
  head.set(MAGIC_BYTES, 4);
  head.set(input.txId, 8);
  if (input.fingerprint) {
    const pre = new Uint8Array(20 + attrsLenNoFp);
    let off = 0;
    pre.set(head, off); off += head.length;
    for (const p of attrs) { pre.set(p, off); off += p.length; }
    const crc = (crc32(pre) ^ FINGERPRINT_XOR) >>> 0;
    const fv = new Uint8Array(4);
    new DataView(fv.buffer).setUint32(0, crc);
    attrs.push(attrBytes(0x8028, fv));
  }
  const parts = [head, ...attrs];
  const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export interface DecodedStun {
  type: number;
  txId: Uint8Array;
  xorMapped?: StunEndpoint;
  mapped?: StunEndpoint;
  errorCode?: { code: number; reason: string };
  fingerprintValid?: boolean;
}

function decodeEndpoint(value: Uint8Array, xor: boolean): StunEndpoint {
  const family = value[1] === 0x01 ? 4 : value[1] === 0x02 ? 6 : 0;
  if (family !== 4 && family !== 6) throw new Error('bad STUN address family');
  const dv = new DataView(value.buffer, value.byteOffset, value.byteLength);
  const rawPort = dv.getUint16(2);
  const stored = value.slice(4, 4 + (family === 4 ? 4 : 16));
  const addrBytes = xor ? xorAddr(stored) : stored;
  return {
    address: ipBytesToString(addrBytes, family),
    port: xor ? rawPort ^ ((MAGIC_BYTES[0] << 8) | MAGIC_BYTES[1]) : rawPort,
    family,
  };
}

export function decodeStunMessage(b: Uint8Array): DecodedStun {
  if (b.length < 20) throw new Error('STUN message too short');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const type = dv.getUint16(0);
  const msgLen = dv.getUint16(2);
  const txId = b.slice(8, 20);
  const out: DecodedStun = { type, txId };
  let off = 20;
  const end = Math.min(20 + msgLen, b.length);
  while (off + 4 <= end) {
    const aType = dv.getUint16(off);
    const aLen = dv.getUint16(off + 2);
    const aStart = off;
    const value = b.slice(off + 4, Math.min(off + 4 + aLen, b.length));
    if (aType === 0x0020) out.xorMapped = decodeEndpoint(value, true);
    else if (aType === 0x0001) out.mapped = decodeEndpoint(value, false);
    else if (aType === 0x0009) {
      const cls = value[2], num = value[3];
      out.errorCode = { code: cls * 100 + num, reason: new TextDecoder().decode(value.slice(4)) };
    } else if (aType === 0x8028 && value.length === 4) {
      const covered = b.slice(0, aStart);
      const expected = (crc32(covered) ^ FINGERPRINT_XOR) >>> 0;
      out.fingerprintValid = expected === dv.getUint32(off + 4);
    }
    off += 4 + aLen + ((4 - (aLen % 4)) % 4);
  }
  return out;
}

// ─── NAT-PMP wire codec (RFC 6886) ───────────────────────────────────────────
export interface PmpMapRequestInput { opcode: 1 | 2; internalPort: number; externalPort: number; lifetimeSec: number }

export function buildPmpMapRequest(r: PmpMapRequestInput): Uint8Array {
  if (r.opcode !== 1 && r.opcode !== 2) throw new Error('NAT-PMP map opcode must be 1 (UDP) or 2 (TCP)');
  const out = new Uint8Array(12);
  const dv = new DataView(out.buffer);
  out[0] = 0; // version
  out[1] = r.opcode;
  dv.setUint16(4, r.internalPort);
  dv.setUint16(6, r.externalPort);
  dv.setUint32(8, r.lifetimeSec);
  return out;
}

export function buildPmpPublicAddressRequest(): Uint8Array {
  return Uint8Array.of(0x00, 0x00);
}

export interface PmpResponse {
  version: number;
  opcode: number;
  resultCode: number;
  ok: boolean;
  epochSec: number;
  internalPort?: number;
  externalPort?: number;
  lifetimeSec?: number;
}

export function parsePmpResponse(b: Uint8Array): PmpResponse {
  if (b.length < 8) throw new Error('NAT-PMP response too short');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const base: PmpResponse = {
    version: b[0],
    opcode: b[1],
    resultCode: dv.getUint16(2),
    ok: dv.getUint16(2) === 0,
    epochSec: dv.getUint32(4),
  };
  if (b.length >= 16 && (b[1] === 128 || b[1] === 129)) {
    base.internalPort = dv.getUint16(8);
    base.externalPort = dv.getUint16(10);
    base.lifetimeSec = dv.getUint32(12);
  }
  return base;
}

// ─── UPnP: SSDP discovery + IGD SOAP control (WANIPConnection:1) ─────────────
export function buildMsearch({ st, mx }: { st: string; mx: number }): string {
  return `M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: ${mx}\r\nST: ${st}\r\n\r\n`;
}

export interface SsdpHit { st?: string; usn?: string; location?: string }

export function parseSsdp(text: string): SsdpHit {
  const hit: SsdpHit = {};
  for (const line of text.split(/\r?\n|\r/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim().toUpperCase();
    const v = line.slice(idx + 1).trim();
    if (k === 'ST') hit.st = v;
    else if (k === 'USN') hit.usn = v;
    else if (k === 'LOCATION') hit.location = v;
  }
  return hit;
}

const SOAP_NS = 'urn:schemas-upnp-org:service:WANIPConnection:1';

export function buildSoapAction(action: string): string {
  return `"${SOAP_NS}#${action}"`;
}

function soapEnvelope(action: string, argsXml: string): string {
  return `<?xml version="1.0"?>` +
    `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
    `<s:Body><u:${action} xmlns:u="${SOAP_NS}">${argsXml}</u:${action}></s:Body></s:Envelope>`;
}

export interface AddPortMappingArgs {
  remoteHost: string; externalPort: number; protocol: 'TCP' | 'UDP'; internalPort: number;
  internalClient: string; description: string; leaseDuration: number;
}

export function buildAddPortMappingEnvelope(a: AddPortMappingArgs): string {
  const args =
    `<NewRemoteHost>${a.remoteHost}</NewRemoteHost>` +
    `<NewExternalPort>${a.externalPort}</NewExternalPort>` +
    `<NewProtocol>${a.protocol}</NewProtocol>` +
    `<NewInternalPort>${a.internalPort}</NewInternalPort>` +
    `<NewInternalClient>${a.internalClient}</NewInternalClient>` +
    `<NewEnabled>1</NewEnabled>` +
    `<NewPortMappingDescription>${a.description}</NewPortMappingDescription>` +
    `<NewLeaseDuration>${a.leaseDuration}</NewLeaseDuration>`;
  return soapEnvelope('AddPortMapping', args);
}

export function buildGetExternalIpEnvelope(): string {
  return soapEnvelope('GetExternalIPAddress', '');
}

/** First `<tag>value</tag>` occurrence — deterministic, honest null when absent. */
export function parseXmlValue(xml: string, tag: string): string | null {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const i = xml.indexOf(open);
  if (i === -1) return null;
  const j = xml.indexOf(close, i + open.length);
  if (j === -1) return null;
  return xml.slice(i + open.length, j);
}
