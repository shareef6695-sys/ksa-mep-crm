// Unit tests for the ZATCA Phase 2 core (supabase/functions/_shared/zatca). `npm test` runs them.
// The independent cross-check against Python cryptography / lxml is crosscheck.py in this folder.
import { describe, expect, it } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import { bitString, ctx, integer, oid, parse, printableString, seq, set, toBase64, utf8, utf8String, type Node } from '../../functions/_shared/zatca/der.ts';
import { buildCsr, newPrivateKey, publicKeyDer, readCertificate, signDer, validateCsrInput } from '../../functions/_shared/zatca/crypto.ts';
import { computeTotals, INITIAL_PIH, qrFromXml, r2, readTlv, signDocument, validateDocument, verifySigned } from '../../functions/_shared/zatca/ubl.ts';
import { complianceDocuments, payloadToDocument, totalsMismatch, unitCode, type DocPayload } from '../../functions/_shared/zatca/mapping.ts';
import { simplifiedCredit, standardInvoice, seller } from './sample_docs.ts';

// A throw-away secp256k1 test CA issuing the EGS certificate
function testCertificate(egsKey: Uint8Array) {
  const caKey = newPrivateKey();
  const name = (cn: string) => seq(
    set(seq(oid('0.9.2342.19200300.100.1.25'), utf8String('local'))),
    set(seq(oid('0.9.2342.19200300.100.1.25'), utf8String('gov'))),
    set(seq(oid('2.5.4.3'), utf8String(cn))));
  const time = (s: string) => new Uint8Array([0x17, s.length, ...utf8(s)]);
  const tbs = seq(ctx(0, integer(2)), integer(123456789012345678901234567890n), seq(oid('1.2.840.10045.4.3.2')),
    name('TSZEINVOICE-SubCA-1'), seq(time('260101000000Z'), time('310101000000Z')),
    seq(set(seq(oid('2.5.4.6'), printableString('SA')))), publicKeyDer(egsKey));
  const der = seq(tbs, seq(oid('1.2.840.10045.4.3.2')), bitString(signDer(caKey, tbs)));
  return { b64: toBase64(der), token: btoa(toBase64(der)), caKey };
}

const egsKey = newPrivateKey();
const cert = testCertificate(egsKey);

describe('amounts', () => {
  it('rounds half-up to 2 decimals', () => {
    expect(r2(1.005)).toBe(1.01);
    expect(r2(100.005)).toBe(100.01);
    expect(r2(2.675)).toBe(2.68);
    expect(r2(-1.005)).toBe(-1.01);
    expect(r2(0.004)).toBe(0);
  });
  it('rounds per line, VAT per category', () => {
    const t = computeTotals([
      { name: 'a', qty: 3, unitPrice: 33.335 },
      { name: 'b', qty: 1, unitPrice: 0.335 },
      { name: 'z', qty: 1, unitPrice: 10, vatCategory: 'Z', exemptionCode: 'VATEX-SA-32' },
    ]);
    expect(t.lines.map((l) => l.net)).toEqual([100.01, 0.34, 10]);
    expect(t.breakdown).toEqual([
      { category: 'S', rate: 0.15, exemptionCode: undefined, taxable: 100.35, vat: 15.05 },
      { category: 'Z', rate: 0, exemptionCode: 'VATEX-SA-32', taxable: 10, vat: 0 },
    ]);
    expect([t.net, t.vat, t.total]).toEqual([110.35, 15.05, 125.4]); // same numbers as zatca_check.sql
  });
});

describe('validation', () => {
  it('accepts the samples', () => {
    expect(validateDocument(standardInvoice)).toEqual([]);
    expect(validateDocument(simplifiedCredit)).toEqual([]);
  });
  it('blocks what ZATCA would reject', () => {
    const bad = { ...standardInvoice, buyer: { name: 'X', vatNumber: '123', country: 'SA' }, lines: [{ name: 'z', qty: 1, unitPrice: 5, vatCategory: 'Z' as const }] };
    const e = validateDocument(bad).join(' ');
    expect(e).toMatch(/Buyer needs a valid VAT/);
    expect(e).toMatch(/Buyer street is missing/);
    expect(e).toMatch(/exemption reason/);
    expect(validateDocument({ ...simplifiedCredit, billingReference: '' }).join(' ')).toMatch(/reference the original invoice/);
    expect(validateDocument({ ...standardInvoice, lines: [{ name: 'o', qty: 1, unitPrice: 1, vatCategory: 'O', exemptionCode: 'VATEX-SA-OOS' }, { name: 's', qty: 1, unitPrice: 1 }] }).join(' ')).toMatch(/BR-O-11/);
  });
});

describe('certificate and CSR', () => {
  it('reads a CSID given as binarySecurityToken, base64 or PEM', () => {
    for (const form of [cert.token, cert.b64, `-----BEGIN CERTIFICATE-----\n${cert.b64}\n-----END CERTIFICATE-----`]) {
      const c = readCertificate(form);
      expect(c.issuerName).toBe('CN=TSZEINVOICE-SubCA-1, DC=gov, DC=local');
      expect(c.serialNumber).toBe('123456789012345678901234567890');
      expect(c.base64).toBe(cert.b64);
      expect(c.notAfter).toBe('2031-01-01T00:00:00Z');
    }
  });
  it('builds a ZATCA CSR signed by the EGS key', () => {
    const csr = buildCsr(egsKey, {
      environment: 'production', vatNumber: '399999999900003', organizationName: 'Horizon', commonName: 'EGS-1',
      serialNumber: '1-Horizon|2-1.0|3-abc', invoiceType: '1100', location: 'Jeddah', industry: 'Trading',
    });
    expect(atob(csr.apiCsr)).toContain('-----BEGIN CERTIFICATE REQUEST-----');
    const root = parse(csr.der);
    const [info, , sig] = root.children as Node[];
    const ok = secp256k1.verify(sig.content.subarray(1), sha256(info.bytes), secp256k1.getPublicKey(egsKey, false), { format: 'der' });
    expect(ok).toBe(true);
    expect(new TextDecoder().decode(csr.der)).toContain('ZATCA-Code-Signing');
    expect(new TextDecoder().decode(csr.der)).not.toContain('PREZATCA');
  });
  it('validates CSR fields', () => {
    const e = validateCsrInput({ environment: 'sandbox', vatNumber: '1', organizationName: 'x'.repeat(65), commonName: '', serialNumber: 'abc', invoiceType: '0011', location: 'a', industry: 'b' });
    expect(e.join(' ')).toMatch(/VAT number/);
    expect(e.join(' ')).toMatch(/at most 64 bytes/);
    expect(e.join(' ')).toMatch(/1-Solution/);
    expect(e.join(' ')).toMatch(/Invoice type/);
  });
});

describe('signing', () => {
  const std = signDocument(standardInvoice, egsKey, cert.token, '2026-11-22T14:15:03');
  const smp = signDocument(simplifiedCredit, egsKey, cert.token, '2026-11-22T14:20:07');
  it('hash and signature verify', () => {
    expect(verifySigned(standardInvoice, std, cert.token)).toEqual([]);
    expect(verifySigned(simplifiedCredit, smp, cert.token)).toEqual([]);
  });
  it('detects tampering', () => {
    const changed = { ...standardInvoice, lines: [{ ...standardInvoice.lines[0], qty: 41 }, ...standardInvoice.lines.slice(1)] };
    expect(verifySigned(changed, std, cert.token)).toContain('invoice hash');
  });
  it('the hash does not depend on the stamp (signing time / certificate)', () => {
    const again = signDocument(standardInvoice, egsKey, cert.token, '2027-01-01T00:00:00');
    expect(again.invoiceHash).toBe(std.invoiceHash);
  });
  it('chains: PIH and ICV are in the document', () => {
    expect(std.xml).toContain(`<cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${INITIAL_PIH}</cbc:EmbeddedDocumentBinaryObject>`);
    expect(std.xml).toMatch(/<cbc:ID>ICV<\/cbc:ID>\s*<cbc:UUID>17<\/cbc:UUID>/);
  });
  it('escapes text', () => {
    expect(std.xml).toContain('Copper cable 4mm &lt;armoured&gt; &amp; "fire rated"');
    expect(std.xml).toContain('كابل نحاسي');
  });
  it('B2C QR carries tags 1-9', () => {
    const t = readTlv(smp.qr!);
    const s = (n: number) => new TextDecoder().decode(t[n]);
    expect(s(1)).toBe(seller.name);
    expect(s(2)).toBe(seller.vatNumber);
    expect(s(3)).toBe('2026-11-22T14:20:05');
    expect([s(4), s(5)]).toEqual([smp.totals.total.toFixed(2), smp.totals.vat.toFixed(2)]);
    expect(s(6)).toBe(smp.invoiceHash);
    expect(s(7)).toBe(smp.signature);
    expect(t[8]).toEqual(readCertificate(cert.token).publicKeyDer);
    expect(t[9]).toEqual(readCertificate(cert.token).signature);
    expect(qrFromXml(smp.xml)).toBe(smp.qr);
  });
  it('B2B carries no own QR (ZATCA adds it on clearance)', () => {
    expect(std.qr).toBeNull();
    expect(qrFromXml(std.xml)).toBeNull();
  });
  it('refuses to sign an invalid document', () => {
    expect(() => signDocument({ ...standardInvoice, seller: { ...seller, crNumber: '' } }, egsKey, cert.token)).toThrow(/CR number/);
  });
});

describe('mapping', () => {
  const payload: DocPayload = {
    docType: 'invoice', docId: 'inv-1', kind: 'invoice', number: 'INV-1', profile: 'standard', issuedAt: '2026-11-22T11:15:00Z',
    seller: { name: seller.name, vatNumber: seller.vatNumber, crNumber: seller.crNumber, buildingNo: '1234', street: 's', district: 'd', city: 'c', postalCode: '23435' },
    buyer: { name: 'B', vatNumber: '300000000000003', buildingNo: '4321', street: 's', district: 'd', city: 'c', postalCode: '12345' },
    lines: [{ name: 'Cable', qty: 3, unitPrice: 33.335, unit: 'mtr', vatCategory: 'S', vatRate: 0.15 }],
    subtotal: 100.01, vat: 15, grand: 115.01,
  };
  it('maps the database payload (Riyadh time, units)', () => {
    const d = payloadToDocument(payload, { icv: 5, pih: 'P', uuid: 'U' });
    expect([d.issueDate, d.issueTime]).toEqual(['2026-11-22', '14:15:00']);
    expect(d.lines[0].unitCode).toBe('MTR');
    expect(unitCode('Lot')).toBe('LO');
    expect(unitCode('weird')).toBe('PCE');
    expect(totalsMismatch(d, payload)).toBeNull();
    expect(totalsMismatch(d, { ...payload, subtotal: 100 })).toMatch(/differ/);
  });
  it('compliance set: 6 documents for 1100, 3 for 1000', () => {
    expect(complianceDocuments(seller, '1100').map((d) => `${d.profile}-${d.kind}`)).toEqual(
      ['standard-invoice', 'standard-credit', 'standard-debit', 'simplified-invoice', 'simplified-credit', 'simplified-debit']);
    expect(complianceDocuments(seller, '1000')).toHaveLength(3);
    for (const d of complianceDocuments(seller, '1100')) expect(validateDocument({ ...d, pih: INITIAL_PIH })).toEqual([]);
  });
});

describe('advance payments (0014)', () => {
  const claim = {
    ...standardInvoice, number: 'INV-2026-00031', lines: [{ name: 'Progress claim 1 - 30% complete', qty: 1, unitPrice: 270000, vatCategory: 'S' as const, vatRate: 0.15 }],
    prepayments: [{ id: 'INV-2026-00030', uuid: '11111111-2222-3333-4444-555555555555', issueDate: '2026-11-01', issueTime: '09:00:00', vatCategory: 'S' as const, vatRate: 0.15, taxable: 30000, vat: 4500 }],
  };
  it('an advance invoice is type 386', () => {
    const s = signDocument({ ...standardInvoice, prepayment: true }, egsKey, cert.token, '2026-11-22T14:15:03');
    expect(s.xml).toContain('<cbc:InvoiceTypeCode name="0100000">386</cbc:InvoiceTypeCode>');
  });
  it('a claim carries the prepayment adjustment line and PrepaidAmount', () => {
    const s = signDocument(claim, egsKey, cert.token, '2026-11-22T14:15:03');
    expect(s.xml).toContain('<cbc:InvoiceTypeCode name="0100000">388</cbc:InvoiceTypeCode>');
    expect(s.xml).toContain('<cbc:PrepaidAmount currencyID="SAR">34500.00</cbc:PrepaidAmount>');
    expect(s.xml).toContain('<cbc:PayableAmount currencyID="SAR">276000.00</cbc:PayableAmount>');
    expect(s.xml).toContain('<cbc:TaxInclusiveAmount currencyID="SAR">310500.00</cbc:TaxInclusiveAmount>');
    expect(s.xml).toMatch(/<cbc:DocumentTypeCode>386<\/cbc:DocumentTypeCode>/);
    expect(s.xml).toMatch(/<cbc:TaxableAmount currencyID="SAR">30000.00<\/cbc:TaxableAmount>\s*<cbc:TaxAmount currencyID="SAR">4500.00<\/cbc:TaxAmount>/);
    expect(s.xml.match(/<cac:InvoiceLine>/g)).toHaveLength(2);
    expect(verifySigned(claim, s, cert.token)).toEqual([]);
  });
  it('payload grand is the payable amount', () => {
    const p: DocPayload = {
      docType: 'invoice', docId: 'c1', kind: 'invoice', number: 'INV-2026-00031', profile: 'standard', issuedAt: '2026-11-22T11:15:00Z',
      seller: {}, buyer: {}, lines: [{ name: 'Claim', qty: 1, unitPrice: 270000, vatCategory: 'S', vatRate: 0.15 }],
      subtotal: 270000, vat: 40500, grand: 276000, prepaid: 34500,
      prepayments: [{ id: 'INV-2026-00030', issueDate: '2026-11-01', issueTime: '09:00:00', vatCategory: 'S', vatRate: 0.15, taxable: 30000, vat: 4500 }],
    };
    const d = payloadToDocument(p, { icv: 1, pih: 'P', uuid: 'U' });
    expect(totalsMismatch(d, p)).toBeNull();
    expect(totalsMismatch(d, { ...p, grand: 310500 })).toMatch(/differ/);
  });
  it('refuses a deduction above the invoice total', () => {
    expect(validateDocument({ ...claim, prepayments: [{ ...claim.prepayments[0], taxable: 300000, vat: 45000 }] }).join(' ')).toMatch(/more than the invoice total/);
  });
});
