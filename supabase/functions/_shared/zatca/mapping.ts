// Database document (public.zatca_doc_payload) -> ZatcaDocument, and the sample set for ZATCA's compliance checks.
import { computeTotals, prepaidAmount, r2, riyadhTimestamp, type DocLine, type Party, type ZatcaDocument } from './ubl.ts';

// App units -> UN/ECE Recommendation 20 codes
const UNIT_CODES: Record<string, string> = {
  PCS: 'PCE', PC: 'PCE', PCE: 'PCE', EA: 'EA', EACH: 'EA', NOS: 'PCE', NO: 'PCE', UNIT: 'C62', UNITS: 'C62',
  M: 'MTR', MTR: 'MTR', METER: 'MTR', METRE: 'MTR', LM: 'MTR', M2: 'MTK', SQM: 'MTK', M3: 'MTQ', CBM: 'MTQ',
  KG: 'KGM', KGS: 'KGM', G: 'GRM', TON: 'TNE', T: 'TNE', L: 'LTR', LTR: 'LTR',
  SET: 'SET', SETS: 'SET', LOT: 'LO', LS: 'LS', LUMPSUM: 'LS', BOX: 'BX', BX: 'BX', ROLL: 'RO', RL: 'RO', PKT: 'PK', PACK: 'PK', PAIR: 'PR',
  HR: 'HUR', HRS: 'HUR', HOUR: 'HUR', DAY: 'DAY', DAYS: 'DAY', WEEK: 'WEE', MTH: 'MON', MONTH: 'MON', MON: 'MON', YR: 'ANN', YEAR: 'ANN',
  JOB: 'E48', SERVICE: 'E48', VISIT: 'E48',
};
export const unitCode = (u?: string) => UNIT_CODES[String(u || 'PCS').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')] || 'PCE';

export interface DocPayload {
  docType: 'invoice' | 'credit_note' | 'debit_note';
  docId: string;
  kind: 'invoice' | 'credit' | 'debit';
  number: string;
  profile: 'standard' | 'simplified';
  issuedAt: string;
  billingReference?: string | null;
  reason?: string | null;
  seller: Record<string, string>;
  buyer: Record<string, string>;
  lines: { name: string; qty: number; unitPrice: number; unit?: string; vatCategory?: string; vatRate?: number; exemptionCode?: string | null }[];
  subtotal: number;
  vat: number;
  grand: number; // payable: total less any advance deducted (0014)
  prepayment?: boolean;
  prepaid?: number;
  prepayments?: { id: string; uuid?: string | null; issueDate: string; issueTime: string; vatCategory?: string; vatRate?: number; taxable: number; vat: number }[];
}

const party = (p: Record<string, string> | null | undefined): Party => ({
  name: p?.name || p?.nameEn || '',
  vatNumber: p?.vatNumber || undefined,
  crNumber: p?.crNumber || undefined,
  buildingNo: p?.buildingNo || undefined,
  street: p?.street || undefined,
  district: p?.district || undefined,
  city: p?.city || undefined,
  postalCode: p?.postalCode || undefined,
  additionalNo: p?.additionalNo || undefined,
  country: (p?.country || 'SA').toUpperCase().slice(0, 2),
});

export function payloadToDocument(p: DocPayload, chain: { icv: number; pih: string; uuid: string }): ZatcaDocument {
  const ts = riyadhTimestamp(new Date(p.issuedAt));
  return {
    kind: p.kind,
    profile: p.profile,
    number: p.number,
    uuid: chain.uuid,
    issueDate: ts.slice(0, 10),
    issueTime: ts.slice(11, 19),
    icv: chain.icv,
    pih: chain.pih,
    billingReference: p.billingReference || undefined,
    reason: p.reason || undefined,
    paymentMeansCode: p.profile === 'simplified' ? '10' : '30',
    prepayment: p.kind === 'invoice' && !!p.prepayment,
    prepayments: (p.prepayments || []).map((x) => ({
      id: x.id, uuid: x.uuid || undefined, issueDate: x.issueDate, issueTime: x.issueTime,
      vatCategory: (['S', 'Z', 'E', 'O'].includes(String(x.vatCategory)) ? x.vatCategory : 'S') as DocLine['vatCategory'],
      vatRate: Number(x.vatRate ?? 0.15), taxable: Number(x.taxable), vat: Number(x.vat),
    })),
    seller: party(p.seller),
    buyer: party(p.buyer),
    lines: p.lines.map((l): DocLine => ({
      name: l.name,
      qty: Number(l.qty),
      unitPrice: Number(l.unitPrice),
      unitCode: unitCode(l.unit),
      vatCategory: (['S', 'Z', 'E', 'O'].includes(String(l.vatCategory)) ? l.vatCategory : 'S') as DocLine['vatCategory'],
      vatRate: Number(l.vatRate ?? 0.15),
      exemptionCode: l.exemptionCode || undefined,
    })),
  };
}

/** The XML must carry exactly the amounts the invoice row and the GL carry. */
export function totalsMismatch(doc: ZatcaDocument, p: DocPayload): string | null {
  const t = computeTotals(doc.lines);
  const off = (a: number, b: number) => Math.abs(a - Number(b || 0)) > 0.005;
  const payable = r2(t.total - prepaidAmount(doc));
  if (off(t.net, p.subtotal) || off(t.vat, p.vat) || off(payable, p.grand)) {
    return `XML totals (net ${t.net.toFixed(2)}, VAT ${t.vat.toFixed(2)}, payable ${payable.toFixed(2)}) differ from ${p.number} `
      + `(net ${Number(p.subtotal).toFixed(2)}, VAT ${Number(p.vat).toFixed(2)}, payable ${Number(p.grand).toFixed(2)}). `
      + 'It was probably issued before migration 0010; it cannot be submitted as it is.';
  }
  return null;
}

/** Company profile (app_settings.company_profile) -> seller party. */
export function sellerFromCompany(c: Record<string, string>): Party {
  return party({ ...c, name: c.nameEn || c.name, country: 'SA' });
}

/** The documents ZATCA's compliance step expects for the EGS invoice type ("1100" = standard + simplified). */
export function complianceDocuments(seller: Party, invoiceType: string): Omit<ZatcaDocument, 'pih'>[] {
  const now = riyadhTimestamp();
  const date = now.slice(0, 10);
  const time = now.slice(11, 19);
  const buyer: Party = {
    name: 'Compliance Test Buyer Co.', vatNumber: '399999999800003', crNumber: '1010010000', buildingNo: '1111',
    street: 'King Fahd Rd', district: 'Al Olaya', city: 'Riyadh', postalCode: '12211', country: 'SA',
  };
  const lines: DocLine[] = [
    { name: 'Compliance test item', qty: 2, unitPrice: 100, vatCategory: 'S', vatRate: 0.15, unitCode: 'PCE' },
    { name: 'Compliance test service', qty: 1, unitPrice: 50.5, vatCategory: 'S', vatRate: 0.15, unitCode: 'E48' },
  ];
  const out: Omit<ZatcaDocument, 'pih'>[] = [];
  const profiles: ('standard' | 'simplified')[] = [];
  if (invoiceType[0] === '1') profiles.push('standard');
  if (invoiceType[1] === '1') profiles.push('simplified');
  let icv = 1;
  for (const profile of profiles) {
    const tag = profile === 'standard' ? 'STD' : 'SMP';
    const base = { profile, issueDate: date, issueTime: time, seller, buyer: profile === 'standard' ? buyer : { name: 'Walk-in customer' }, paymentMeansCode: profile === 'standard' ? '30' : '10' };
    out.push({ ...base, kind: 'invoice', number: `CMP-${tag}-INV-1`, uuid: crypto.randomUUID(), icv: icv++, lines });
    out.push({ ...base, kind: 'credit', number: `CMP-${tag}-CRN-1`, uuid: crypto.randomUUID(), icv: icv++, lines: [lines[0]],
      billingReference: `CMP-${tag}-INV-1`, reason: 'Returned goods' });
    out.push({ ...base, kind: 'debit', number: `CMP-${tag}-DBN-1`, uuid: crypto.randomUUID(), icv: icv++, lines: [lines[1]],
      billingReference: `CMP-${tag}-INV-1`, reason: 'Price increase' });
  }
  return out;
}
