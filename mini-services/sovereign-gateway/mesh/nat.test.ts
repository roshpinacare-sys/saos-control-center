// ═══ מש-הריבונות · חוזי-חוט — STUN RFC5389 · NAT-PMP RFC6886 · UPnP SSDP/IGD ═══
// וקטורי-בתים-מדויקים — בנויים-ידנית-מתמטית; אפס-רשת, אפס-תלות, אפס-שעון-קיר.
// שיעור-הצי: codec-לא-מבוקש-בבדיקה = codec-שקרן. כל-בית-כאן נגזר-בכתב.

import { describe, test, expect } from 'bun:test';
import {
  MAGIC_COOKIE,
  CRC32_TEST_VECTOR,
  encodeBindingRequest,
  encodeBindingResponse,
  decodeStunMessage,
  buildPmpMapRequest,
  buildPmpPublicAddressRequest,
  parsePmpResponse,
  buildMsearch,
  parseSsdp,
  buildAddPortMappingEnvelope,
  buildGetExternalIpEnvelope,
  buildSoapAction,
  parseXmlValue,
} from './nat';

const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');

describe('STUN RFC5389 wire codec', () => {
  test('MAGIC_COOKIE is the RFC constant 0x2112A442 big-endian', () => {
    expect(hex(MAGIC_COOKIE)).toBe('2112a442');
  });

  test('binding request: exact 20-byte header (type 0x0001, zero length, cookie, echoed txId)', () => {
    const tx = Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);
    const req = encodeBindingRequest(tx);
    expect(hex(req)).toBe('000100002112a442000102030405060708090a0b');
  });

  test('binding request rejects a wrong txId length (fail-closed wire discipline)', () => {
    expect(() => encodeBindingRequest(new Uint8Array(11))).toThrow();
  });

  test('XOR-MAPPED-ADDRESS v4: 192.0.2.1:34853 decodes exactly (x-port 0xA937, x-addr 0xE112A643)', () => {
    // port 34853 = 0x8825 ^ 0x2112 = 0xA937 ; addr C0 00 02 01 ^ 21 12 A4 42 = E1 12 A6 43
    const tx = Uint8Array.from({ length: 12 }, (_, i) => i);
    const msg = Uint8Array.from([
      0x01, 0x01, 0x00, 0x0c, // Binding Success Response, msgLen 12
      0x21, 0x12, 0xa4, 0x42, ...tx, // magic + txId
      0x00, 0x20, 0x00, 0x08, // XOR-MAPPED-ADDRESS, len 8
      0x00, 0x01, 0xa9, 0x37, // zero, family v4, x-port
      0xe1, 0x12, 0xa6, 0x43, // x-addr
    ]);
    const decoded = decodeStunMessage(msg);
    expect(decoded.type).toBe(0x0101);
    expect(decoded.xorMapped).toEqual({ address: '192.0.2.1', port: 34853, family: 4 });
  });

  test('XOR-MAPPED-ADDRESS v6: 2001:db8::1:50000 decodes exactly', () => {
    const addr = [0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
    const magic = [0x21, 0x12, 0xa4, 0x42];
    const xAddr = addr.map((b, i) => b ^ magic[i % 4]);
    const tx = Uint8Array.from({ length: 12 }, (_, i) => i);
    const msg = Uint8Array.from([
      0x01, 0x01, 0x00, 0x18, 0x21, 0x12, 0xa4, 0x42, ...tx,
      0x00, 0x20, 0x00, 0x14, 0x00, 0x02, (0xc350 ^ 0x2112) >> 8, (0xc350 ^ 0x2112) & 0xff, ...xAddr,
    ]);
    const decoded = decodeStunMessage(msg);
    expect(decoded.xorMapped).toEqual({ address: '2001:db8::1', port: 50000, family: 6 });
  });

  test('MAPPED-ADDRESS (plain 0x0001) decodes as the fallback attribute', () => {
    const tx = Uint8Array.from({ length: 12 }, (_, i) => i);
    const msg = Uint8Array.from([
      0x01, 0x01, 0x00, 0x0c, 0x21, 0x12, 0xa4, 0x42, ...tx,
      0x00, 0x01, 0x00, 0x08, 0x00, 0x01, 0x88, 0x25, 0xc0, 0x00, 0x02, 0x01,
    ]);
    const decoded = decodeStunMessage(msg);
    expect(decoded.mapped).toEqual({ address: '192.0.2.1', port: 34853, family: 4 });
  });

  test('ERROR-CODE 420 "Unknown Attribute" surfaces with class+number law', () => {
    const tx = Uint8Array.from({ length: 12 }, (_, i) => i);
    const reason = new TextEncoder().encode('Unknown Attribute');
    const pad = (4 - (reason.length % 4)) % 4;
    // RFC 5389 §5: LENGTH counts the value WITHOUT padding; padding bytes still physically present.
    const msg = Uint8Array.from([
      0x01, 0x01, 0x00, Number(4 + 4 + reason.length + pad), 0x21, 0x12, 0xa4, 0x42, ...tx,
      0x00, 0x09, 0x00, Number(4 + reason.length), 0x00, 0x00, 0x04, 0x14, ...reason, ...new Uint8Array(pad),
    ]);
    const decoded = decodeStunMessage(msg);
    expect(decoded.errorCode).toEqual({ code: 420, reason: 'Unknown Attribute' });
  });

  test('FINGERPRINT: response round-trip validates; a tampered byte invalidates (CRC32 integrity law)', () => {
    const tx = Uint8Array.from({ length: 12 }, (_, i) => i);
    const good = encodeBindingResponse({ txId: tx, xorMapped: { address: '192.0.2.1', port: 34853, family: 4 }, fingerprint: true });
    expect(decodeStunMessage(good).fingerprintValid).toBe(true);
    const evil = Uint8Array.from(good);
    evil[4] ^= 0xff; // corrupt magic cookie
    expect(decodeStunMessage(evil).fingerprintValid).toBe(false);
  });

  test('CRC32 carries the universal test vector "123456789" → 0xCBF43926', () => {
    expect(CRC32_TEST_VECTOR).toBe(0xcbf43926);
  });
});

describe('NAT-PMP RFC6886 wire codec', () => {
  test('map UDP request for port 22, lifetime 3600 → exact 12 bytes (big-endian law)', () => {
    const req = buildPmpMapRequest({ opcode: 1, internalPort: 22, externalPort: 22, lifetimeSec: 3600 });
    expect(hex(req)).toBe('000100000016001600000e10');
  });

  test('public-address request → 2 bytes [ver 0, op 0]', () => {
    expect(hex(buildPmpPublicAddressRequest())).toBe('0000');
  });

  test('successful map response (epoch 100, 22→5555, 7200s) parses field-per-field', () => {
    const res = Uint8Array.from([0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x64, 0x00, 0x16, 0x15, 0xb3, 0x00, 0x00, 0x1c, 0x20]);
    const parsed = parsePmpResponse(res);
    expect(parsed.version).toBe(0);
    expect(parsed.opcode).toBe(128);
    expect(parsed.resultCode).toBe(0);
    expect(parsed.epochSec).toBe(100);
    expect(parsed.internalPort).toBe(22);
    expect(parsed.externalPort).toBe(5555);
    expect(parsed.lifetimeSec).toBe(7200);
    expect(parsed.ok).toBe(true);
  });

  test('refused response (resultCode 2) surfaces honestly as ok:false — never masked', () => {
    const res = Uint8Array.from([0x00, 0x80, 0x00, 0x02, 0x00, 0x00, 0x00, 0x64]);
    const parsed = parsePmpResponse(res);
    expect(parsed.ok).toBe(false);
    expect(parsed.resultCode).toBe(2);
  });

  test('truncated response throws (fail-closed wire discipline)', () => {
    expect(() => parsePmpResponse(new Uint8Array([0x00, 0x80, 0x00]))).toThrow();
  });
});

describe('UPnP SSDP + IGD control builders', () => {
  test('M-SEARCH carries HOST/MAN/MX/ST in the canonical order and terminates with a blank line', () => {
    const m = buildMsearch({ st: 'ssdp:all', mx: 2 });
    expect(m).toBe('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n');
  });

  test('SSDP response parses case-insensitive headers (ST/USN/LOCATION)', () => {
    const raw = 'HTTP/1.1 200 OK\rCache-Control: max-age=1800\rst: urn:schemas-upnp-org:device:Router\rUSN: uuid:abc\rLOCATION: http://192.0.2.2:49152/desc.xml\r\r';
    const p = parseSsdp(raw);
    expect(p.st).toBe('urn:schemas-upnp-org:device:Router');
    expect(p.usn).toBe('uuid:abc');
    expect(p.location).toBe('http://192.0.2.2:49152/desc.xml');
  });

  test('AddPortMapping envelope: action named, argument order stable, port/protocol/client present', () => {
    const env = buildAddPortMappingEnvelope({
      remoteHost: '', externalPort: 3140, protocol: 'TCP', internalPort: 3140,
      internalClient: '192.168.1.50', description: 'SAOS sovereign gateway', leaseDuration: 0,
    });
    expect(env).toContain('AddPortMapping');
    expect(env.indexOf('<NewRemoteHost>')).toBeLessThan(env.indexOf('<NewExternalPort>'));
    expect(env).toContain('<NewExternalPort>3140</NewExternalPort>');
    expect(env).toContain('<NewProtocol>TCP</NewProtocol>');
    expect(env).toContain('<NewInternalPort>3140</NewInternalPort>');
    expect(env).toContain('<NewInternalClient>192.168.1.50</NewInternalClient>');
    expect(env).toContain('<NewEnabled>1</NewEnabled>');
  });

  test('GetExternalIPAddress envelope names the action', () => {
    expect(buildGetExternalIpEnvelope()).toContain('GetExternalIPAddress');
  });

  test('SOAPACTION header follows the urn#action wire form', () => {
    expect(buildSoapAction('AddPortMapping')).toBe('"urn:schemas-upnp-org:service:WANIPConnection:1#AddPortMapping"');
  });

  test('parseXmlValue extracts the first occurrence and returns null honestly when absent', () => {
    expect(parseXmlValue('<A><Y>1.2.3.4</Y></A>', 'Y')).toBe('1.2.3.4');
    expect(parseXmlValue('<A><Y>1.2.3.4</Y><Y>5.6.7.8</Y></A>', 'Y')).toBe('1.2.3.4');
    expect(parseXmlValue('<A><Z>x</Z></A>', 'Y')).toBe(null);
  });
});
