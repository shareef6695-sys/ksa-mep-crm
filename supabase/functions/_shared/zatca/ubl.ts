// ZATCA Phase 2: UBL 2.1 XML for tax invoices (B2B), simplified invoices (B2C), credit and debit notes,
// the invoice hash, the XAdES cryptographic stamp, and the Phase 2 QR code (TLV tags 1-9).
//
// Formatting follows ZATCA's samples: 4-space indentation, one element per line. The hash and the signed-
// properties digest depend on that exact layout, so all XML is produced by the serializer below — never by hand.
import { readCertificate, sha256Bytes, sha256Hex, signDer, verifyDer, type CertificateInfo } from './crypto.ts';
import { concat, fromBase64, toBase64, utf8, type Bytes } from './der.ts';

// ---------------------------------------------------------------- amounts
/** Half-up rounding to 2 decimals (ZATCA). Works on the decimal string, so 1.005 -> 1.01. */
export function r2(n: number): number {
  const v = Number(n) || 0;
  const sign = v < 0 ? -1 : 1;
  const [i, f = ''] = Math.abs(v).toFixed(10).split('.');
  let cents = BigInt(i) * 100n + BigInt((f + '00').slice(0, 2));
  if (Number(f[2] || '0') >= 5) cents += 1n;
  return (sign * Number(cents)) / 100;
}
const money = (n: number) => r2(n).toFixed(2);
/** Price / quantity: full precision (no decimal limit in ZATCA), without float noise. */
const exact = (n: number) => {
  const s = (Number(n) || 0).toFixed(6).replace(/\.?0+$/, '');
  return s.includes('.') ? s : `${s}.00`;
};

export type VatCategory = 'S' | 'Z' | 'E' | 'O';
export interface DocLine {
  name: string;
  qty: number;
  unitPrice: number; // SAR, VAT exclusive
  unitCode?: string;
  vatCategory?: VatCategory;
  vatRate?: number; // 0.15
  exemptionCode?: string; // VATEX-SA-...
  exemptionText?: string;
}
export interface Party {
  name: string;
  vatNumber?: string;
  crNumber?: string;
  buildingNo?: string;
  street?: string;
  district?: string;
  city?: string;
  postalCode?: string;
  additionalNo?: string;
  country?: string;
}
/** A prepayment (advance, type 386) invoice deducted on this invoice (KSA-26..34). */
export interface PrepaymentRef {
  id: string; // number of the 386 invoice
  uuid?: string;
  issueDate: string;
  issueTime: string;
  vatCategory?: VatCategory;
  vatRate?: number;
  taxable: number; // KSA-31
  vat: number; // KSA-32
}
export interface ZatcaDocument {
  kind: 'invoice' | 'credit' | 'debit';
  prepayment?: boolean; // advance payment invoice: type code 386
  prepayments?: PrepaymentRef[]; // advance invoices deducted (zero-value adjustment lines + PrepaidAmount)
  profile: 'standard' | 'simplified';
  number: string;
  uuid: string;
  issueDate: string; // YYYY-MM-DD, Riyadh
  issueTime: string; // HH:MM:SS, Riyadh
  supplyDate?: string;
  icv: number;
  pih: string; // base64 SHA-256 of the previous document
  billingReference?: string; // original invoice number (credit / debit notes)
  reason?: string; // credit / debit note reason (KSA-10)
  paymentMeansCode?: string; // UN/ECE 4461: 10 cash, 30 credit transfer, 42 bank account, 48 card, 1 not defined
  seller: Party;
  buyer?: Party;
  lines: DocLine[];
}

export const INITIAL_PIH = 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==';

const EXEMPTION_TEXT: Record<string, string> = {
  'VATEX-SA-29': 'Financial services mentioned in Article 29 of the VAT Regulations',
  'VATEX-SA-29-7': 'Life insurance services mentioned in Article 29 of the VAT Regulations',
  'VATEX-SA-30': 'Real estate transactions mentioned in Article 30 of the VAT Regulations',
  'VATEX-SA-32': 'Export of goods',
  'VATEX-SA-33': 'Export of services',
  'VATEX-SA-34-1': 'The international transport of Goods',
  'VATEX-SA-34-2': 'International transport of passengers',
  'VATEX-SA-34-3': 'Services directly connected and incidental to a Supply of international passenger transport',
  'VATEX-SA-34-4': 'Supply of a qualifying means of transport',
  'VATEX-SA-34-5': 'Any services relating to Goods or passenger transportation, as defined in article twenty five of these Regulations',
  'VATEX-SA-35': 'Medicines and medical equipment',
  'VATEX-SA-36': 'Qualifying metals',
  'VATEX-SA-EDU': 'Private education to citizen',
  'VATEX-SA-HEA': 'Private healthcare to citizen',
  'VATEX-SA-MLTRY': 'Supply of qualified military goods',
  'VATEX-SA-OOS': 'Not subject to VAT',
};

/** BT-113: sum of the prepayment taxable amounts and their VAT. */
export function prepaidAmount(d: Pick<ZatcaDocument, 'prepayments'>): number {
  return r2((d.prepayments || []).reduce((s, p) => s + r2(Number(p.taxable)) + r2(Number(p.vat)), 0));
}

export interface Totals {
  lines: { net: number; vat: number; rate: number; category: VatCategory }[];
  breakdown: { category: VatCategory; rate: number; exemptionCode?: string; taxable: number; vat: number }[];
  net: number;
  vat: number;
  total: number;
}

/** ZATCA rounding: line net = round(qty x price); VAT per category = round(sum of line nets x rate). */
export function computeTotals(lines: DocLine[]): Totals {
  const out: Totals = { lines: [], breakdown: [], net: 0, vat: 0, total: 0 };
  const groups = new Map<string, Totals['breakdown'][number]>();
  for (const l of lines) {
    const category = (l.vatCategory || 'S') as VatCategory;
    const rate = category === 'S' ? (l.vatRate ?? 0.15) : 0;
    const net = r2(Number(l.qty) * Number(l.unitPrice));
    out.lines.push({ net, vat: r2(net * rate), rate, category });
    const key = `${category}|${rate}|${category === 'S' ? '' : l.exemptionCode || ''}`;
    const g = groups.get(key) || { category, rate, exemptionCode: category === 'S' ? undefined : l.exemptionCode, taxable: 0, vat: 0 };
    g.taxable = r2(g.taxable + net);
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    g.vat = r2(g.taxable * g.rate);
    out.breakdown.push(g);
  }
  out.net = r2(out.lines.reduce((s, l) => s + l.net, 0));
  out.vat = r2(out.breakdown.reduce((s, g) => s + g.vat, 0));
  out.total = r2(out.net + out.vat);
  return out;
}

/** Checks ZATCA needs before signing. Returns blocking errors (empty = OK). */
export function validateDocument(d: ZatcaDocument): string[] {
  const e: string[] = [];
  const s = d.seller || ({} as Party);
  if (!/^3\d{13}3$/.test(s.vatNumber || '')) e.push('Seller VAT number must be 15 digits, starting and ending with 3.');
  if (!s.crNumber) e.push('Seller CR number is missing (company profile).');
  for (const [k, label] of [['street', 'street'], ['buildingNo', 'building number'], ['district', 'district'], ['city', 'city'], ['postalCode', 'postal code']] as const) {
    if (!String(s[k] || '').trim()) e.push(`Seller ${label} is missing (company profile).`);
  }
  if (s.buildingNo && !/^\d{4}$/.test(s.buildingNo)) e.push('Seller building number must be 4 digits.');
  if (s.postalCode && !/^\d{5}$/.test(s.postalCode)) e.push('Seller postal code must be 5 digits.');
  if (d.profile === 'standard') {
    const b = d.buyer || ({} as Party);
    if (!String(b.name || '').trim()) e.push('Buyer name is required on a tax invoice.');
    const foreign = (b.country || 'SA') !== 'SA';
    if (!foreign) {
      if (!/^3\d{13}3$/.test(b.vatNumber || '') && !b.crNumber) e.push('Buyer needs a valid VAT number (or CR number) on a tax invoice.');
      for (const [k, label] of [['street', 'street'], ['buildingNo', 'building number'], ['district', 'district'], ['city', 'city'], ['postalCode', 'postal code']] as const) {
        if (!String(b[k] || '').trim()) e.push(`Buyer ${label} is missing (customer master).`);
      }
      if (b.buildingNo && !/^\d{4}$/.test(b.buildingNo)) e.push('Buyer building number must be 4 digits.');
      if (b.postalCode && !/^\d{5}$/.test(b.postalCode)) e.push('Buyer postal code must be 5 digits.');
    }
  }
  if (d.kind !== 'invoice') {
    if (!d.billingReference) e.push('Credit / debit notes must reference the original invoice number.');
    if (!String(d.reason || '').trim()) e.push('Credit / debit notes need a reason.');
  }
  if (!d.lines?.length) e.push('The document has no lines.');
  if (d.prepayment && d.kind !== 'invoice') e.push('Only an invoice can be a prepayment (386) invoice.');
  d.prepayments?.forEach((p, i) => {
    if (!p.id || !/^\d{4}-\d{2}-\d{2}$/.test(p.issueDate) || !/^\d{2}:\d{2}:\d{2}$/.test(p.issueTime)) e.push(`Prepayment ${i + 1}: number, issue date and time of the advance invoice are required.`);
    if (!(Number(p.taxable) > 0) || Number(p.vat) < 0) e.push(`Prepayment ${i + 1}: the deducted amount must be above zero.`);
  });
  if (d.prepayments?.length) {
    const t = computeTotals(d.lines || []);
    if (prepaidAmount(d) > t.total + 0.005) e.push('The advance deducted is more than the invoice total.');
  }
  d.lines?.forEach((l, i) => {
    const c = l.vatCategory || 'S';
    if (!(Number(l.qty) > 0)) e.push(`Line ${i + 1}: quantity must be above zero.`);
    if (Number(l.unitPrice) < 0) e.push(`Line ${i + 1}: price cannot be negative.`);
    if (c !== 'S' && !l.exemptionCode) e.push(`Line ${i + 1}: VAT category ${c} needs a ZATCA exemption reason code.`);
  });
  const cats = new Set(d.lines?.map((l) => l.vatCategory || 'S'));
  if (cats.has('O') && cats.size > 1) e.push('A document with out-of-scope (O) lines cannot contain other VAT categories (BR-O-11). Split it.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.issueDate) || !/^\d{2}:\d{2}:\d{2}$/.test(d.issueTime)) e.push('Issue date / time are malformed.');
  return e;
}

// ---------------------------------------------------------------- XML tree + serializer
export interface El {
  n: string; // qualified name
  a?: [string, string][]; // attributes in output order
  t?: string; // text (leaf)
  c?: (El | null | undefined | false)[]; // children
}
const el = (n: string, ...rest: (El | null | undefined | false | string | [string, string][])[]): El => {
  const node: El = { n, c: [] };
  for (const r of rest) {
    if (typeof r === 'string') node.t = r;
    else if (Array.isArray(r)) node.a = r;
    else if (r) node.c!.push(r);
  }
  return node;
};
const escText = (s: string) => s.replace(/\r/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** lxml-style pretty print (4 spaces). Elements in `omit` are dropped but their surrounding whitespace stays —
 *  exactly what ZATCA's pre-hash transform does, so serialize(root, omit) is the canonical text that gets hashed. */
export function serialize(node: El, level = 0, omit?: Set<El>): string {
  const attrs = (node.a || []).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
  const kids = (node.c || []).filter(Boolean) as El[];
  if (!kids.length) {
    if (node.t !== undefined && node.t !== '') return `<${node.n}${attrs}>${escText(node.t)}</${node.n}>`;
    return `<${node.n}${attrs}/>`;
  }
  const pad = '    '.repeat(level + 1);
  const inner = kids.map((k) => `\n${pad}${omit?.has(k) ? '' : serialize(k, level + 1, omit)}`).join('');
  return `<${node.n}${attrs}>${inner}\n${'    '.repeat(level)}</${node.n}>`;
}

const NS = {
  inv: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
  ext: 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
  sig: 'urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2',
  sac: 'urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2',
  sbc: 'urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2',
  ds: 'http://www.w3.org/2000/09/xmldsig#',
  xades: 'http://uri.etsi.org/01903/v1.3.2#',
};
const SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';
const amt = (n: string, v: number) => el(n, [['currencyID', 'SAR']], money(v));
const txt = (n: string, v?: string | number | null) => (v === undefined || v === null || String(v).trim() === '' ? null : el(n, String(v).trim()));

function address(name: string, p: Party): El {
  return el(name,
    txt('cbc:StreetName', p.street),
    txt('cbc:BuildingNumber', p.buildingNo),
    txt('cbc:PlotIdentification', p.additionalNo),
    txt('cbc:CitySubdivisionName', p.district),
    txt('cbc:CityName', p.city),
    txt('cbc:PostalZone', p.postalCode),
    el('cac:Country', el('cbc:IdentificationCode', p.country || 'SA')));
}

function partyEl(p: Party, role: 'seller' | 'buyer'): El {
  const vat = p.vatNumber && /^\d{15}$/.test(p.vatNumber) ? p.vatNumber : '';
  return el('cac:Party',
    p.crNumber ? el('cac:PartyIdentification', el('cbc:ID', [['schemeID', 'CRN']], String(p.crNumber).trim())) : null,
    address('cac:PostalAddress', p),
    role === 'seller' || vat ? el('cac:PartyTaxScheme', txt('cbc:CompanyID', vat), el('cac:TaxScheme', el('cbc:ID', 'VAT'))) : null,
    el('cac:PartyLegalEntity', el('cbc:RegistrationName', String(p.name || '').trim())));
}

function taxCategory(name: string, c: VatCategory, rate: number, code?: string): El {
  return el(name,
    el('cbc:ID', [['schemeAgencyID', '6'], ['schemeID', 'UN/ECE 5305']], c),
    el('cbc:Percent', (rate * 100).toFixed(2)),
    c !== 'S' && code ? el('cbc:TaxExemptionReasonCode', code) : null,
    c !== 'S' && code ? el('cbc:TaxExemptionReason', EXEMPTION_TEXT[code] || code) : null,
    el('cac:TaxScheme', el('cbc:ID', [['schemeAgencyID', '6'], ['schemeID', 'UN/ECE 5153']], 'VAT')));
}

// The cryptographic stamp. Values are filled in after hashing.
export interface Stamp {
  invoiceDigest: string;
  signedPropsDigest: string;
  signatureValue: string;
  certificate: string;
  signingTime: string;
  certDigest: string;
  issuerName: string;
  serialNumber: string;
}

function signedProperties(s: Stamp): El {
  // Namespaces are declared on the element itself (as in ZATCA's template) — the digest is computed over this text.
  const ds = (n: string, attrsOrText: [string, string][] | string) =>
    Array.isArray(attrsOrText) ? el(`ds:${n}`, [['xmlns:ds', NS.ds], ...attrsOrText]) : el(`ds:${n}`, [['xmlns:ds', NS.ds]], attrsOrText);
  return el('xades:SignedProperties', [['xmlns:xades', NS.xades], ['Id', 'xadesSignedProperties']],
    el('xades:SignedSignatureProperties',
      el('xades:SigningTime', s.signingTime),
      el('xades:SigningCertificate',
        el('xades:Cert',
          el('xades:CertDigest', ds('DigestMethod', [['Algorithm', SHA256]]), ds('DigestValue', s.certDigest)),
          el('xades:IssuerSerial', ds('X509IssuerName', s.issuerName), ds('X509SerialNumber', s.serialNumber))))));
}

export const signedPropertiesText = (s: Stamp) => serialize(signedProperties(s), 9);
export const signedPropertiesDigest = (s: Stamp) => btoa(sha256Hex(utf8(signedPropertiesText(s))));

function extensions(s: Stamp): El {
  const xpath = (expr: string) => el('ds:Transform', [['Algorithm', 'http://www.w3.org/TR/1999/REC-xpath-19991116']], el('ds:XPath', expr));
  return el('ext:UBLExtensions',
    el('ext:UBLExtension',
      el('ext:ExtensionURI', 'urn:oasis:names:specification:ubl:dsig:enveloped:xades'),
      el('ext:ExtensionContent',
        el('sig:UBLDocumentSignatures', [['xmlns:sig', NS.sig], ['xmlns:sac', NS.sac], ['xmlns:sbc', NS.sbc]],
          el('sac:SignatureInformation',
            el('cbc:ID', 'urn:oasis:names:specification:ubl:signature:1'),
            el('sbc:ReferencedSignatureID', 'urn:oasis:names:specification:ubl:signature:Invoice'),
            el('ds:Signature', [['xmlns:ds', NS.ds], ['Id', 'signature']],
              el('ds:SignedInfo',
                el('ds:CanonicalizationMethod', [['Algorithm', 'http://www.w3.org/2006/12/xml-c14n11']]),
                el('ds:SignatureMethod', [['Algorithm', 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256']]),
                el('ds:Reference', [['Id', 'invoiceSignedData'], ['URI', '']],
                  el('ds:Transforms',
                    xpath('not(//ancestor-or-self::ext:UBLExtensions)'),
                    xpath('not(//ancestor-or-self::cac:Signature)'),
                    xpath("not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])"),
                    el('ds:Transform', [['Algorithm', 'http://www.w3.org/2006/12/xml-c14n11']])),
                  el('ds:DigestMethod', [['Algorithm', SHA256]]),
                  el('ds:DigestValue', s.invoiceDigest)),
                el('ds:Reference', [['Type', 'http://www.w3.org/2000/09/xmldsig#SignatureProperties'], ['URI', '#xadesSignedProperties']],
                  el('ds:DigestMethod', [['Algorithm', SHA256]]),
                  el('ds:DigestValue', s.signedPropsDigest))),
              el('ds:SignatureValue', s.signatureValue),
              el('ds:KeyInfo', el('ds:X509Data', el('ds:X509Certificate', s.certificate))),
              el('ds:Object',
                el('xades:QualifyingProperties', [['xmlns:xades', NS.xades], ['Target', 'signature']], signedProperties(s)))))))));
}

const TYPE_CODE = { invoice: '388', credit: '381', debit: '383' } as const;

export interface BuiltDocument {
  root: El;
  ext: El;
  signatureRef: El;
  qrRef: El | null;
  qrText: El | null; // EmbeddedDocumentBinaryObject of the QR (filled after signing)
  totals: Totals;
}

export function buildDocument(d: ZatcaDocument, stamp: Stamp): BuiltDocument {
  const totals = computeTotals(d.lines);
  const prepaid = prepaidAmount(d);
  const isNote = d.kind !== 'invoice';
  const simplified = d.profile === 'simplified';
  const ext = extensions(stamp);
  const qrText = simplified ? el('cbc:EmbeddedDocumentBinaryObject', [['mimeCode', 'text/plain']], 'N/A') : null;
  const qrRef = simplified ? el('cac:AdditionalDocumentReference', el('cbc:ID', 'QR'), el('cac:Attachment', qrText)) : null;
  const signatureRef = el('cac:Signature',
    el('cbc:ID', 'urn:oasis:names:specification:ubl:signature:Invoice'),
    el('cbc:SignatureMethod', 'urn:oasis:names:specification:ubl:dsig:enveloped:xades'));
  const buyer = d.buyer || { name: '' };
  const root = el('Invoice', [['xmlns', NS.inv], ['xmlns:cac', NS.cac], ['xmlns:cbc', NS.cbc], ['xmlns:ext', NS.ext]],
    ext,
    el('cbc:ProfileID', 'reporting:1.0'),
    el('cbc:ID', d.number),
    el('cbc:UUID', d.uuid),
    el('cbc:IssueDate', d.issueDate),
    el('cbc:IssueTime', d.issueTime),
    el('cbc:InvoiceTypeCode', [['name', simplified ? '0200000' : '0100000']], d.kind === 'invoice' && d.prepayment ? '386' : TYPE_CODE[d.kind]),
    el('cbc:DocumentCurrencyCode', 'SAR'),
    el('cbc:TaxCurrencyCode', 'SAR'),
    isNote ? el('cac:BillingReference', el('cac:InvoiceDocumentReference', el('cbc:ID', d.billingReference || ''))) : null,
    el('cac:AdditionalDocumentReference', el('cbc:ID', 'ICV'), el('cbc:UUID', String(d.icv))),
    el('cac:AdditionalDocumentReference', el('cbc:ID', 'PIH'),
      el('cac:Attachment', el('cbc:EmbeddedDocumentBinaryObject', [['mimeCode', 'text/plain']], d.pih))),
    qrRef,
    signatureRef,
    el('cac:AccountingSupplierParty', partyEl(d.seller, 'seller')),
    el('cac:AccountingCustomerParty', simplified && !String(buyer.name || '').trim() ? el('cac:Party', address('cac:PostalAddress', { name: '', country: 'SA' })) : partyEl(buyer, 'buyer')),
    !simplified || d.supplyDate ? el('cac:Delivery', el('cbc:ActualDeliveryDate', d.supplyDate || d.issueDate)) : null,
    el('cac:PaymentMeans', el('cbc:PaymentMeansCode', d.paymentMeansCode || '30'), isNote ? txt('cbc:InstructionNote', d.reason) : null),
    el('cac:TaxTotal', amt('cbc:TaxAmount', totals.vat),
      ...totals.breakdown.map((g) => el('cac:TaxSubtotal', amt('cbc:TaxableAmount', g.taxable), amt('cbc:TaxAmount', g.vat),
        taxCategory('cac:TaxCategory', g.category, g.rate, g.exemptionCode)))),
    el('cac:TaxTotal', amt('cbc:TaxAmount', totals.vat)),
    el('cac:LegalMonetaryTotal',
      amt('cbc:LineExtensionAmount', totals.net),
      amt('cbc:TaxExclusiveAmount', totals.net),
      amt('cbc:TaxInclusiveAmount', totals.total),
      amt('cbc:AllowanceTotalAmount', 0),
      amt('cbc:PrepaidAmount', prepaid),
      amt('cbc:PayableAmount', r2(totals.total - prepaid))),
    ...d.lines.map((l, i) => {
      const t = totals.lines[i];
      return el('cac:InvoiceLine',
        el('cbc:ID', String(i + 1)),
        el('cbc:InvoicedQuantity', [['unitCode', l.unitCode || 'PCE']], exact(l.qty)),
        amt('cbc:LineExtensionAmount', t.net),
        el('cac:TaxTotal', amt('cbc:TaxAmount', t.vat), amt('cbc:RoundingAmount', t.net + t.vat)),
        el('cac:Item',
          el('cbc:Name', String(l.name || 'Item').trim() || 'Item'),
          el('cac:ClassifiedTaxCategory',
            el('cbc:ID', t.category),
            el('cbc:Percent', (t.rate * 100).toFixed(2)),
            el('cac:TaxScheme', el('cbc:ID', 'VAT')))),
        el('cac:Price', el('cbc:PriceAmount', [['currencyID', 'SAR']], exact(l.unitPrice))));
    }),
    // prepayment adjustment: one zero-value line per advance invoice deducted (XML implementation standard 9.5)
    ...(d.prepayments || []).map((p, i) => {
      const c = (p.vatCategory || 'S') as VatCategory;
      const rate = c === 'S' ? Number(p.vatRate ?? 0.15) : 0;
      return el('cac:InvoiceLine',
        el('cbc:ID', String(d.lines.length + i + 1)),
        el('cbc:InvoicedQuantity', [['unitCode', 'PCE']], '0.000000'),
        amt('cbc:LineExtensionAmount', 0),
        el('cac:DocumentReference',
          el('cbc:ID', p.id),
          p.uuid ? el('cbc:UUID', p.uuid) : null,
          el('cbc:IssueDate', p.issueDate),
          el('cbc:IssueTime', p.issueTime),
          el('cbc:DocumentTypeCode', '386')),
        el('cac:TaxTotal', amt('cbc:TaxAmount', 0), amt('cbc:RoundingAmount', 0),
          el('cac:TaxSubtotal', amt('cbc:TaxableAmount', Number(p.taxable)), amt('cbc:TaxAmount', Number(p.vat)),
            el('cac:TaxCategory',
              el('cbc:ID', [['schemeAgencyID', '6'], ['schemeID', 'UN/ECE 5305']], c),
              el('cbc:Percent', (rate * 100).toFixed(2)),
              el('cac:TaxScheme', el('cbc:ID', [['schemeAgencyID', '6'], ['schemeID', 'UN/ECE 5153']], 'VAT'))))),
        el('cac:Item',
          el('cbc:Name', 'Prepayment adjustment'),
          el('cac:ClassifiedTaxCategory',
            el('cbc:ID', c),
            el('cbc:Percent', (rate * 100).toFixed(2)),
            el('cac:TaxScheme', el('cbc:ID', 'VAT')))),
        el('cac:Price', el('cbc:PriceAmount', [['currencyID', 'SAR']], '0.00')));
    }));
  return { root, ext, signatureRef, qrRef, qrText, totals };
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>\n';

/** Base64 SHA-256 of the canonical document without UBLExtensions, cac:Signature and the QR reference. */
export function canonicalForHash(b: BuiltDocument): string {
  return serialize(b.root, 0, new Set([b.ext, b.signatureRef, ...(b.qrRef ? [b.qrRef] : [])]));
}

// ---------------------------------------------------------------- QR (TLV)
export function tlv(tags: [number, Bytes][]): Bytes {
  return concat(...tags.map(([t, v]) => {
    if (v.length > 255) throw new Error(`QR tag ${t} is longer than 255 bytes.`);
    return concat(Uint8Array.of(t, v.length), v);
  }));
}

export function readTlv(b64: string): Record<number, Bytes> {
  const b = fromBase64(b64);
  const out: Record<number, Bytes> = {};
  for (let i = 0; i < b.length;) {
    const t = b[i];
    const len = b[i + 1];
    out[t] = b.slice(i + 2, i + 2 + len);
    i += 2 + len;
  }
  return out;
}

// ---------------------------------------------------------------- signing
export interface SignedDocument {
  xml: string;
  invoiceHash: string; // base64 SHA-256 (DigestValue, API invoiceHash, next document's PIH)
  signature: string;
  qr: string | null; // base64 TLV for simplified documents (standard ones get ZATCA's QR on clearance)
  totals: Totals;
  uuid: string;
}

/** Riyadh local time as YYYY-MM-DDTHH:MM:SS. */
export function riyadhTimestamp(d = new Date()): string {
  return new Date(d.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 19);
}

export function signDocument(d: ZatcaDocument, privateKey: Bytes, certificateInput: string, signingTime = riyadhTimestamp()): SignedDocument {
  const errors = validateDocument(d);
  if (errors.length) throw new Error(errors.join(' '));
  const cert: CertificateInfo = readCertificate(certificateInput);
  const stamp: Stamp = {
    invoiceDigest: '', signedPropsDigest: '', signatureValue: '', certificate: cert.base64, signingTime,
    // ZATCA: base64 of the hex SHA-256 of the base64 certificate text
    certDigest: btoa(sha256Hex(utf8(cert.base64))),
    issuerName: cert.issuerName, serialNumber: cert.serialNumber,
  };
  const built = buildDocument(d, stamp);
  const canonical = canonicalForHash(built);
  const digest = sha256Bytes(utf8(canonical));
  const invoiceHash = toBase64(digest);
  const hexHash = sha256Hex(utf8(canonical));
  const signature = toBase64(signDer(privateKey, utf8(hexHash)));
  // Signed properties digest: base64 of the hex SHA-256 over the element exactly as it is laid out in the document
  // (it sits at depth 9, i.e. 36 spaces), which is how ZATCA recomputes it.
  stamp.invoiceDigest = invoiceHash;
  stamp.signatureValue = signature;
  stamp.signedPropsDigest = signedPropertiesDigest(stamp);
  built.root.c![0] = extensions(stamp); // re-render the stamp with the final values

  let qr: string | null = null;
  if (built.qrText) {
    const t = built.totals;
    qr = toBase64(tlv([
      [1, utf8(d.seller.name)],
      [2, utf8(d.seller.vatNumber || '')],
      [3, utf8(`${d.issueDate}T${d.issueTime}`)],
      [4, utf8(money(t.total))],
      [5, utf8(money(t.vat))],
      [6, utf8(invoiceHash)],
      [7, utf8(signature)],
      [8, cert.publicKeyDer],
      [9, cert.signature],
    ]));
    built.qrText.t = qr;
  }
  const xml = XML_DECL + serialize(built.root);
  return { xml, invoiceHash, signature, qr, totals: built.totals, uuid: d.uuid };
}

/** Recomputes what can be checked locally on a signed document (used by the tests and before submitting). */
export function verifySigned(d: ZatcaDocument, signed: SignedDocument, certificateInput: string): string[] {
  const cert = readCertificate(certificateInput);
  const problems: string[] = [];
  const built = buildDocument(d, {
    invoiceDigest: '', signedPropsDigest: '', signatureValue: '', certificate: cert.base64, signingTime: '',
    certDigest: '', issuerName: '', serialNumber: '',
  });
  const canonical = canonicalForHash(built);
  if (toBase64(sha256Bytes(utf8(canonical))) !== signed.invoiceHash) problems.push('invoice hash');
  if (!verifyDer(cert.publicKeyPoint, utf8(sha256Hex(utf8(canonical))), fromBase64(signed.signature))) problems.push('signature');
  if (!signed.xml.includes(`<ds:DigestValue>${signed.invoiceHash}</ds:DigestValue>`)) problems.push('digest not in XML');
  return problems;
}

/** Pulls the QR out of a cleared (ZATCA-stamped) XML. */
export function qrFromXml(xml: string): string | null {
  const m = xml.match(/<cbc:ID>QR<\/cbc:ID>\s*<cac:Attachment>\s*<cbc:EmbeddedDocumentBinaryObject[^>]*>([^<]+)</);
  return m ? m[1].trim() : null;
}
