// Vendor and item CSV import: map a file (the blank templates, or a Zoho Books vendors / items export) onto the
// vendors and items columns and list each row's problems. Pure functions, unit-tested in __tests__/masterImport.test.js.
// The database (import_vendors / import_items, migration 0019) does the final checks and skips duplicates.
import { mapPaymentTerms, parseCsv, toCsv } from './customerImport';

export { toCsv };

const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const nameKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '');
const isKsaVat = (v) => /^3\d{13}3$/.test(v);

function picker(values) {
  const byNorm = Object.fromEntries(Object.entries(values).map(([k, v]) => [norm(k), v]));
  return (aliases) => {
    for (const a of aliases) {
      const v = byNorm[norm(a)];
      if (v) return String(v).trim();
    }
    return '';
  };
}

// ---------------------------------------------------------------- vendors
export const VENDOR_TEMPLATE_HEADERS = ['name_en', 'name_ar', 'vendor_origin', 'vat_number', 'cr_number', 'contact_person', 'phone', 'email',
  'country', 'city', 'address', 'default_currency', 'payment_terms', 'iban'];

const GCC = ['saudi arabia', 'united arab emirates', 'uae', 'qatar', 'bahrain', 'kuwait', 'oman'];

// "Net 30" / "Advance / Cash" from the template, or Zoho's day count ("Payment Terms") plus its label
const vendorTerms = (terms, label) => mapPaymentTerms(/^\d+$/.test(terms) ? terms : '', label || terms);

export function mapVendorRecord(rec) {
  const pick = picker(rec.values);
  const type = pick(['Contact Type']).toLowerCase();
  if (type && type !== 'vendor') return { row: rec.row, skip: `Contact type "${type}" is not a vendor.` };
  const status = pick(['Status']);
  if (status && !/^active$/i.test(status)) return { row: rec.row, skip: `Status "${status}".` };

  const country = pick(['country', 'Billing Country', 'Country']) || '';
  const treatment = pick(['VAT Treatment', 'tax_treatment']).toLowerCase();
  let origin = pick(['vendor_origin', 'Origin']);
  if (!origin) {
    if (treatment === 'non_gcc' || (country && !GCC.includes(country.toLowerCase()))) origin = 'International';
    else if (treatment.startsWith('gcc') || (country && country.toLowerCase() !== 'saudi arabia' && GCC.includes(country.toLowerCase()))) origin = 'GCC';
    else origin = 'KSA';
  }
  origin = /^gcc$/i.test(origin) ? 'GCC' : /^(international|foreign|import)/i.test(origin) ? 'International' : 'KSA';
  const currency = (pick(['default_currency', 'Currency Code', 'Currency']) || (origin === 'KSA' ? 'SAR' : '')).toUpperCase();
  const address = pick(['address']) || [pick(['Billing Address']), pick(['Billing Street2']), pick(['Billing District']), pick(['Billing Code'])]
    .filter(Boolean).join(', ').replace(/\s*\n\s*/g, ', ');
  const vendor = {
    row: rec.row,
    name_en: pick(['name_en', 'Company Name', 'Display Name', 'Vendor Name', 'Contact Name', 'Name']),
    name_ar: pick(['name_ar', 'Display Name (Secondary Language)', 'Arabic Name']),
    vendor_origin: origin,
    vat_number: pick(['vat_number', 'Tax Registration Number', 'TRN', 'VAT Number', 'VAT']).replace(/\s/g, ''),
    cr_number: pick(['cr_number', 'CR Number']),
    contact_person: pick(['contact_person', 'Contact Person']) || [pick(['First Name']), pick(['Last Name'])].filter(Boolean).join(' '),
    phone: pick(['phone', 'Phone', 'MobilePhone', 'Mobile', 'Billing Phone']),
    email: pick(['email', 'EmailID', 'Email']).toLowerCase(),
    country: country || (origin === 'KSA' ? 'Saudi Arabia' : ''),
    city: pick(['city', 'Billing City', 'City']).replace(/\s+\d{5}$/, ''),
    address,
    default_currency: currency || 'SAR',
    payment_terms: vendorTerms(pick(['payment_terms', 'Terms']), pick(['Payment Terms Label'])),
    iban: pick(['iban', 'IBAN']).replace(/\s/g, ''),
  };
  return { row: rec.row, record: vendor };
}

export function checkVendor(v, { existing = [] } = {}) {
  const errors = [];
  const warnings = [];
  if (!v.name_en) errors.push('Name is missing');
  if (v.vendor_origin === 'KSA' && v.vat_number && !isKsaVat(v.vat_number)) errors.push(`VAT ${v.vat_number} is not 15 digits starting and ending with 3`);
  const dup = existing.find((e) => (v.vat_number && e.vat_number === v.vat_number) || (nameKey(e.name_en) && nameKey(e.name_en) === nameKey(v.name_en)));
  if (dup) warnings.push(`Already in the ERP as ${dup.vendor_code || dup.name_en} (will be skipped)`);
  if (v.vendor_origin === 'KSA' && !v.vat_number) warnings.push('No VAT number (not VAT-registered?)');
  if (!v.city && !v.address) warnings.push('No address');
  return { errors, warnings, duplicate: !!dup };
}

// ---------------------------------------------------------------- items
export const ITEM_TEMPLATE_HEADERS = ['item_type', 'name_en', 'name_ar', 'category', 'uom', 'sales_price_sar', 'purchase_price',
  'purchase_currency', 'zatca_vat_type', 'zatca_exemption_reason', 'preferred_vendor', 'is_stocked_item'];

/** The app's standard units (MasterDataViews STANDARD_UOMS) and common spellings of them. */
const UNIT_ALIASES = {
  PCS: ['pcs', 'pc', 'piece', 'pieces', 'ea', 'each', 'unit', 'units', 'no', 'nos', 'number', 'qty'],
  SET: ['set', 'sets', 'kit'], MTR: ['mtr', 'mtrs', 'meter', 'meters', 'metre', 'm', 'lm'], ROL: ['rol', 'roll', 'rolls', 'drum'],
  BOX: ['box', 'boxes', 'ctn', 'carton'], PKT: ['pkt', 'pkts', 'packet', 'pack', 'pkg'], KG: ['kg', 'kgs'], TON: ['ton', 'tons', 'mt'],
  LTR: ['ltr', 'l', 'litre', 'liter', 'liters'], SQM: ['sqm', 'm2'], CBM: ['cbm', 'm3'], HRS: ['hrs', 'hr', 'hour', 'hours'],
  DAY: ['day', 'days'], MTH: ['mth', 'month', 'months', 'monthly'], LOT: ['lot', 'ls', 'lumpsum'],
};
export const STANDARD_UNITS = Object.keys(UNIT_ALIASES).concat('NOS');
const ALIAS = Object.fromEntries(Object.entries(UNIT_ALIASES).flatMap(([code, list]) => list.map((a) => [a, code])));
const NEW_UNIT = { year: 'YR', years: 'YR', yr: 'YR', yearly: 'YR', annual: 'YR', point: 'PTS', points: 'PTS', user: 'USR', users: 'USR', license: 'LIC', licence: 'LIC' };

export function mapUnit(raw, itemType) {
  const s = String(raw || '').trim();
  if (!s) return { uom: itemType === 'Service' ? 'LOT' : 'PCS' };
  if (/^\d+$/.test(s)) return { uom: 'PCS' }; // a bare number ("1") is a count
  const k = s.toLowerCase().replace(/\.$/, '');
  if (ALIAS[k]) return { uom: ALIAS[k] };
  if (STANDARD_UNITS.includes(s.toUpperCase())) return { uom: s.toUpperCase() };
  const code = NEW_UNIT[k] || s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'PCS';
  return { uom: code, uom_label: s.charAt(0).toUpperCase() + s.slice(1), newUnit: true };
}

// Division from the name, for files that don't carry one (Zoho has none). Editable afterwards.
const IT_WORDS = /\b(cat ?6a?|cat ?5e?|utp|ftp|rj ?45|fib(er|re)|patch ?(cord|panel)|switch(es)?|router|access point|wi-?fi|cctv|camera|nvr|dvr|hdd|ssd|server|laptop|desktop|monitor|printer|ups|rack|network|software|licen[cs]e|subscription|cloud|hosting|domain|email|sap|erp|cyber|firewall|access control|intercom|pabx|ip phone|data ?cable)\b/i;
export function guessCategory(name, productType) {
  if (/digital/i.test(productType || '')) return 'IT & ELV';
  return IT_WORDS.test(name || '') ? 'IT & ELV' : 'MEP';
}

export function mapItemRecord(rec) {
  const pick = picker(rec.values);
  const status = pick(['Status']);
  if (status && !/^active$/i.test(status)) return { row: rec.row, skip: `Status "${status}".` };
  const name = pick(['name_en', 'Item Name', 'Name', 'Item']).replace(/^"+|"+$/g, '').replace(/\s+/g, ' ').trim();
  const productType = pick(['item_type', 'Product Type', 'Type']);
  const itemType = /service/i.test(productType) ? 'Service' : 'Goods';
  const unit = mapUnit(pick(['uom', 'Usage unit', 'Unit']), itemType);
  const taxPct = pick(['Tax Percentage', 'Tax Rate']);
  let vat = pick(['zatca_vat_type', 'VAT Category']).toUpperCase();
  let noZohoRate = false;
  if (!vat) {
    // Zoho export: 15% -> S; an empty or 0% rate on an ordinary item is treated as standard and flagged for review
    vat = 'S';
    const hasTaxColumn = Object.keys(rec.values).some((k) => ['taxpercentage', 'taxrate'].includes(norm(k)));
    noZohoRate = hasTaxColumn && !(Number(taxPct) > 0);
  }
  const num = (v) => { const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
  const item = {
    row: rec.row,
    item_type: itemType,
    name_en: name,
    name_ar: pick(['name_ar', 'Item Name (Secondary Language)', 'Arabic Name']),
    category: pick(['category', 'Division']) || guessCategory(name, productType),
    uom: unit.uom,
    uom_label: unit.uom_label || '',
    sales_price_sar: num(pick(['sales_price_sar', 'Rate', 'Selling Price', 'Sales Price'])),
    purchase_price: num(pick(['purchase_price', 'Purchase Rate', 'Cost Price', 'Purchase Price'])),
    purchase_currency: (pick(['purchase_currency']) || 'SAR').toUpperCase(),
    zatca_vat_type: vat,
    zatca_exemption_reason: pick(['zatca_exemption_reason', 'Exemption Reason']),
    preferred_vendor: pick(['preferred_vendor', 'Preferred Vendor', 'Vendor']),
    is_stocked_item: /^(true|yes|1|y)$/i.test(pick(['is_stocked_item', 'Track Inventory'])),
  };
  return { row: rec.row, record: item, newUnit: !!unit.newUnit, noZohoRate };
}

export function checkItem(it, { existing = [], newUnit = false, noZohoRate = false, categoryGuessed = false } = {}) {
  const errors = [];
  const warnings = [];
  if (!it.name_en) errors.push('Name is missing');
  if (!['S', 'Z', 'E', 'O'].includes(it.zatca_vat_type)) errors.push(`Unknown VAT category "${it.zatca_vat_type}"`);
  else if (it.zatca_vat_type !== 'S' && !it.zatca_exemption_reason) errors.push(`VAT category ${it.zatca_vat_type} needs an exemption reason`);
  if (it.sales_price_sar < 0 || it.purchase_price < 0) errors.push('Negative price');
  const dup = existing.find((e) => nameKey(e.name_en) && nameKey(e.name_en) === nameKey(it.name_en));
  if (dup) warnings.push(`Already in the ERP as ${dup.item_code || dup.name_en} (will be skipped)`);
  if (noZohoRate) warnings.push('No VAT rate in the source; set to Standard 15% — confirm');
  if (!it.sales_price_sar) warnings.push('No selling price');
  if (newUnit) warnings.push(`New unit ${it.uom} (${it.uom_label}) will be added`);
  if (categoryGuessed) warnings.push(`Division guessed: ${it.category}`);
  return { errors, warnings, duplicate: !!dup };
}

// ---------------------------------------------------------------- preview (both)
export function buildMasterPreview(kind, text, existing = []) {
  const { headers, records } = parseCsv(text);
  const h = new Set(headers.map(norm));
  const format = h.has('contactid') || h.has('itemid') || h.has('itemname') ? 'zoho' : headers.length ? 'template' : 'unknown';
  const hasCategory = h.has('category') || h.has('division');
  const rows = records.map((rec) => {
    const m = kind === 'vendor' ? mapVendorRecord(rec) : mapItemRecord(rec);
    if (m.skip) return { row: m.row, status: 'ignored', reason: m.skip };
    const chk = kind === 'vendor'
      ? checkVendor(m.record, { existing })
      : checkItem(m.record, { existing, newUnit: m.newUnit, noZohoRate: m.noZohoRate, categoryGuessed: !hasCategory });
    return { row: m.row, record: m.record, ...chk, status: chk.errors.length ? 'error' : chk.duplicate ? 'duplicate' : chk.warnings.length ? 'warning' : 'ready' };
  });
  const seen = new Map();
  for (const r of rows) {
    if (!r.record || r.status === 'error' || r.status === 'duplicate') continue;
    const keys = [kind === 'vendor' && r.record.vat_number && `v:${r.record.vat_number}`, `n:${nameKey(r.record.name_en)}`].filter(Boolean);
    const first = keys.map((k) => seen.get(k)).find(Boolean);
    if (first) { r.status = 'duplicate'; r.warnings = [...r.warnings, `Same as row ${first} (will be skipped)`]; } else keys.forEach((k) => seen.set(k, r.row));
  }
  const count = (s) => rows.filter((r) => r.status === s).length;
  return {
    format, headers, rows,
    summary: { total: rows.length, ready: count('ready'), warning: count('warning'), error: count('error'), duplicate: count('duplicate'), ignored: count('ignored') },
    importable: rows.filter((r) => r.status === 'ready' || r.status === 'warning').map((r) => r.record),
  };
}
