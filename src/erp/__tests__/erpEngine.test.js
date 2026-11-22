import { describe, it, expect } from 'vitest';
import { generateZatcaQrBase64, formatSAR } from '../erpEngine';

// Decode a ZATCA Phase 1 TLV QR (tag byte, length byte, UTF-8 value)
function decodeTlv(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const out = {};
  let i = 0;
  while (i < bytes.length) {
    const tag = bytes[i];
    const len = bytes[i + 1];
    out[tag] = new TextDecoder().decode(bytes.slice(i + 2, i + 2 + len));
    i += 2 + len;
  }
  return out;
}

describe('generateZatcaQrBase64', () => {
  it('encodes the five Phase 1 tags in order', () => {
    const qr = generateZatcaQrBase64({
      sellerName: 'Horizon Business Solutions Est.',
      vatNumber: '300000000000003',
      timestampIso: '2026-11-22T09:00:00Z',
      totalWithVat: 1150,
      vatAmount: 150,
    });
    expect(decodeTlv(qr)).toEqual({
      1: 'Horizon Business Solutions Est.',
      2: '300000000000003',
      3: '2026-11-22T09:00:00Z',
      4: '1150.00',
      5: '150.00',
    });
  });

  it('uses UTF-8 byte length for Arabic seller names', () => {
    const name = 'مؤسسة حلول الأفق';
    const qr = generateZatcaQrBase64({ sellerName: name, vatNumber: '300000000000003', timestampIso: 'x', totalWithVat: 0, vatAmount: 0 });
    expect(decodeTlv(qr)[1]).toBe(name);
  });
});

describe('formatSAR', () => {
  it('always shows two decimals', () => {
    expect(formatSAR(1234.5)).toMatch(/1,?234\.50/);
    expect(formatSAR(null)).toBe('0.00');
  });
});
