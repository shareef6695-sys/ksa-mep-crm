import { describe, it, expect } from 'vitest';
import { generateZatcaQrBase64, formatSAR, invoiceOpenSar, getZatcaComplianceAdvice, isValidKsaVat, isValidCr, vatRateOf } from '../erpEngine';

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

describe('invoiceOpenSar (0006: invoice total never changes)', () => {
  it('subtracts collections and credit notes', () => {
    expect(invoiceOpenSar({ grand_total_sar: 2156.25, paid_amount_sar: 1000, credited_amount_sar: 539.06 })).toBe(617.19);
  });
  it('treats missing amounts as zero', () => {
    expect(invoiceOpenSar({ grand_total_sar: 100 })).toBe(100);
    expect(invoiceOpenSar(null)).toBe(0);
  });
  it('can be negative for legacy overpaid invoices', () => {
    expect(invoiceOpenSar({ grand_total_sar: 100, paid_amount_sar: 100, credited_amount_sar: 20 })).toBe(-20);
    expect(invoiceOpenSar({ grand_total_sar: 115.4, debited_amount_sar: 28.76, paid_amount_sar: 0, credited_amount_sar: 0 })).toBe(144.16); // as zatca_check.sql
  });
});

describe('getZatcaComplianceAdvice', () => {
  it('Wave 24 when any of 2022-2024 is over SAR 375,000', () => {
    expect(getZatcaComplianceAdvice({ 2022: 100000, 2023: 400000 }, false).level).toBe('wave24');
  });
  it('Wave 25 (mandatory) when any of 2022-2025 is over SAR 187,500', () => {
    const a = getZatcaComplianceAdvice({ 2022: 100000, 2025: 190000 }, false);
    expect(a.level).toBe('wave25');
    expect(a.deadline).toBe('1 February 2027');
    expect(a.wave.toLowerCase()).not.toContain('voluntary');
  });
  it('2025 revenue alone does not trigger Wave 24', () => {
    expect(getZatcaComplianceAdvice({ 2025: 900000 }, false).level).toBe('wave25');
  });
  it('below both thresholds = Phase 1', () => {
    expect(getZatcaComplianceAdvice({ 2022: 1, 2023: 2, 2024: 3, 2025: 4 }, false).level).toBe('phase1');
  });
  it('still accepts a single number', () => {
    expect(getZatcaComplianceAdvice(500000, false).level).toBe('wave24');
  });
});

describe('VAT helpers', () => {
  it('validates KSA VAT and CR numbers', () => {
    expect(isValidKsaVat('310122393500003')).toBe(true);
    expect(isValidKsaVat('300000000000004')).toBe(false);
    expect(isValidKsaVat('31012239350000')).toBe(false);
    expect(isValidCr('4030000000')).toBe(true);
    expect(isValidCr('403000')).toBe(false);
  });
  it('line VAT rate', () => {
    expect(vatRateOf({})).toBe(0.15);
    expect(vatRateOf({ vatCategory: 'Z' })).toBe(0);
    expect(vatRateOf({ vatCategory: 'S', vatRate: 0.15 })).toBe(0.15);
  });
});
