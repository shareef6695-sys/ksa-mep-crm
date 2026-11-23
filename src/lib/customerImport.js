// Customer CSV import: parse a CSV (Zoho Books "Contacts" export or a plain template), map it onto the customers
// columns and list what each row is missing. Pure functions, unit-tested in __tests__/customerImport.test.js.
// The database (import_customers, migration 0018) does the final checks and skips duplicates.

/** RFC 4180 CSV: quoted fields, "" escapes, commas / newlines inside quotes, CRLF, UTF-8 BOM. Also ; or tab separated. */
export function parseCsv(text) {
  const s = String(text || '').replace(/^\uFEFF/, '');
  const firstLine = s.slice(0, s.search(/\r?\n|$/));
  const sep = [',', ';', '\t'].reduce((best, c) => (firstLine.split(c).length > firstLine.split(best).length ? c : best), ',');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map((h) => h.trim());
  const records = rows.slice(1).map((r, idx) => ({
    row: idx + 2, // spreadsheet row number (header is row 1)
    values: Object.fromEntries(headers.map((h, j) => [h, (r[j] ?? '').trim()])),
  }));
  return { headers, records };
}

const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// For each customers field, the CSV headers that can feed it (Zoho Books export first, then plain names).
const SOURCES = {
  name_en: ['Display Name', 'Company Name', 'Contact Name', 'name_en', 'Name', 'Customer Name', 'Company'],
  name_ar: ['Display Name (Secondary Language)', 'name_ar', 'Arabic Name', 'Name (Arabic)'],
  vat_number: ['Tax Registration Number', 'TRN', 'vat_number', 'VAT Number', 'VAT', 'VAT No'],
  cr_number: ['cr_number', 'CR Number', 'CR', 'Commercial Registration'],
  email: ['EmailID', 'Email', 'email', 'E-mail'],
  phone: ['Phone', 'Billing Phone', 'phone', 'Telephone', 'MobilePhone', 'Mobile'],
  whatsapp: ['whatsapp', 'WhatsApp', 'MobilePhone', 'Mobile'],
  street: ['Billing Address', 'Billing Street2', 'street', 'Street', 'Address Line 1'],
  street2: ['Billing Street2', 'Address Line 2'],
  building_no: ['building_no', 'Building No', 'Building Number'],
  additional_no: ['Billing Additional Number', 'additional_no', 'Additional Number'],
  district: ['Billing District', 'district', 'District'],
  city: ['Billing City', 'city', 'City'],
  state: ['Billing State', 'State', 'Region'],
  postal_code: ['Billing Code', 'postal_code', 'Postal Code', 'ZIP', 'Zip Code'],
  country: ['Billing Country', 'country', 'Country'],
  address_en: ['address_en', 'Address'],
  credit_limit_sar: ['Credit Limit', 'credit_limit_sar', 'Credit Limit (SAR)'],
  payment_terms_days: ['Payment Terms'],
  payment_terms_label: ['Payment Terms Label', 'payment_terms', 'Terms'],
  customer_type: ['customer_type', 'Customer Type'],
  sub_type: ['Customer Sub Type'],
  vat_treatment: ['VAT Treatment'],
  contact_type: ['Contact Type'],
  status: ['Status'],
  salutation: ['Salutation'],
  first_name: ['First Name'],
  last_name: ['Last Name'],
  contact_person: ['contact_person', 'Contact Person', 'Billing Attention'],
};

export function detectFormat(headers) {
  const h = new Set(headers.map(norm));
  if (h.has('displayname') && h.has('contactid')) return 'zoho';
  if (h.has('nameen') || h.has('name') || h.has('customername') || h.has('companyname')) return 'template';
  return 'unknown';
}

const COUNTRY = { 'saudi arabia': 'SA', ksa: 'SA', sa: 'SA', 'kingdom of saudi arabia': 'SA', qatar: 'QA', qa: 'QA', 'united arab emirates': 'AE', uae: 'AE', ae: 'AE',
  bahrain: 'BH', bh: 'BH', kuwait: 'KW', kw: 'KW', oman: 'OM', om: 'OM', egypt: 'EG', jordan: 'JO', india: 'IN', china: 'CN' };
const GCC_CITY = { doha: 'QA', dubai: 'AE', 'abu dhabi': 'AE', sharjah: 'AE', manama: 'BH', 'kuwait city': 'KW', muscat: 'OM' };

/** The ERP's payment-terms choices: Advance / Cash, Net 15/30/45/60 (other day counts kept as "Net N"). */
export function mapPaymentTerms(days, label) {
  const l = String(label || '').toLowerCase();
  if (/advance|cash|receipt|immediate|cod/.test(l)) return 'Advance / Cash';
  const n = Number(String(days ?? '').trim() === '' ? (l.match(/(\d+)/) || [])[1] : days);
  if (Number.isFinite(n) && n > 0) return `Net ${Math.round(n)}`;
  if (Number.isFinite(n) && n === 0 && String(days ?? '').trim() !== '') return 'Advance / Cash';
  return 'Net 30';
}

/** One CSV record -> { row, customer (customers columns), skip?: reason } */
export function mapCustomerRecord(rec) {
  const v = rec.values;
  const byNorm = Object.fromEntries(Object.entries(v).map(([k, val]) => [norm(k), val]));
  const pick = (field) => {
    for (const h of SOURCES[field] || []) {
      const val = byNorm[norm(h)];
      if (val) return val;
    }
    return '';
  };
  const type = pick('contact_type').toLowerCase();
  if (type && type !== 'customer') return { row: rec.row, skip: `Contact type "${type}" is not a customer.` };
  if (pick('status') && !/^active$/i.test(pick('status'))) return { row: rec.row, skip: `Status "${pick('status')}".` };

  // city may carry the postal code ("Al Khobar 31952")
  let city = pick('city');
  let postal = pick('postal_code').replace(/\s/g, '');
  const cityPostal = city.match(/^(.*?)[\s,]+(\d{5})$/);
  if (cityPostal) { city = cityPostal[1].trim(); if (!postal) postal = cityPostal[2]; }

  const countryRaw = pick('country');
  const country = COUNTRY[countryRaw.toLowerCase()] || (countryRaw.length === 2 ? countryRaw.toUpperCase() : '') || GCC_CITY[city.toLowerCase()] || 'SA';

  let street1 = pick('street');
  const street2 = pick('street2');
  let building = pick('building_no');
  // Zoho KSA addresses often keep the 4-digit building number (or the 5-digit postal code) alone in address line 1
  if (/^\d{4}$/.test(street1) && !building) { building = street1; street1 = ''; }
  else if (/^\d{5}$/.test(street1)) { if (!/^\d{5}$/.test(postal)) postal = street1; street1 = ''; }
  const street = [street1, street2 && street2 !== street1 ? street2 : ''].filter(Boolean).join(', ').replace(/\s*\n\s*/g, ', ');
  // a postal code at the end of the street line ("Al Rawdah 23435") when the postal-code column is empty or not 5 digits
  const streetPostal = street.match(/(?:^|[\s,،])(\d{5})\s*$/);
  if (streetPostal && !/^\d{5}$/.test(postal)) postal = streetPostal[1];
  const vat = pick('vat_number').replace(/\s/g, '');
  const subType = pick('sub_type').toLowerCase();
  const explicitType = pick('customer_type').toUpperCase();
  const customerType = explicitType === 'B2C' || explicitType === 'B2B' ? explicitType : subType === 'individual' ? 'B2C' : 'B2B';
  const person = pick('contact_person') || [pick('salutation'), pick('first_name'), pick('last_name')].filter(Boolean).join(' ');
  const creditLimit = Number(String(pick('credit_limit_sar')).replace(/,/g, '')) || 0;

  const customer = {
    row: rec.row,
    name_en: pick('name_en'),
    name_ar: pick('name_ar'),
    customer_type: customerType,
    vat_number: vat,
    cr_number: pick('cr_number'),
    contact_person: person,
    phone: pick('phone'),
    whatsapp: pick('whatsapp'),
    email: pick('email').toLowerCase(),
    building_no: building,
    street,
    additional_no: pick('additional_no'),
    district: pick('district'),
    city,
    postal_code: postal,
    country,
    address_en: pick('address_en') || [street, pick('district'), city, postal, countryRaw && country !== 'SA' ? countryRaw : ''].filter(Boolean).join(', '),
    credit_limit_sar: creditLimit > 0 ? creditLimit : 0,
    payment_terms: mapPaymentTerms(pick('payment_terms_days'), pick('payment_terms_label')),
  };
  return { row: rec.row, customer, vatTreatment: pick('vat_treatment') };
}

const isKsaVat = (v) => /^3\d{13}3$/.test(v);

/**
 * Problems per row. errors block the row (the database would reject it); warnings are imported and listed
 * so the customer can be completed later (ZATCA standard invoices need the buyer's VAT number and national address).
 */
export function checkCustomer(c, { existing = [] } = {}) {
  const errors = [];
  const warnings = [];
  if (!c.name_en) errors.push('Name is missing');
  if (c.vat_number && !isKsaVat(c.vat_number)) errors.push(`VAT ${c.vat_number} is not 15 digits starting and ending with 3`);
  const key = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '');
  const dup = existing.find((e) => (c.vat_number && e.vat_number === c.vat_number) || (key(e.name_en) && key(e.name_en) === key(c.name_en)));
  if (dup) warnings.push(`Already in the ERP as ${dup.customer_code || dup.name_en} (will be skipped)`);
  if (c.customer_type === 'B2B' && c.country === 'SA') {
    if (!c.vat_number) warnings.push('No VAT number');
    const missing = [];
    if (!/^\d{4}$/.test(c.building_no || '')) missing.push('building no.');
    if (!c.street) missing.push('street');
    if (!c.district) missing.push('district');
    if (!c.city) missing.push('city');
    if (!/^\d{5}$/.test(c.postal_code || '')) missing.push('postal code');
    if (missing.length === 5) warnings.push('No address');
    else if (missing.length) warnings.push(`Address incomplete: ${missing.join(', ')}`);
  }
  if (!c.email && !c.phone) warnings.push('No email or phone');
  return { errors, warnings, duplicate: !!dup };
}

/** Whole file -> preview model. */
export function buildImportPreview(text, existing = []) {
  const { headers, records } = parseCsv(text);
  const format = detectFormat(headers);
  const rows = records.map((rec) => {
    const m = mapCustomerRecord(rec);
    if (m.skip) return { row: m.row, status: 'ignored', reason: m.skip };
    const chk = checkCustomer(m.customer, { existing });
    return { row: m.row, customer: m.customer, ...chk, status: chk.errors.length ? 'error' : chk.duplicate ? 'duplicate' : chk.warnings.length ? 'warning' : 'ready' };
  });
  // the same customer twice in the file: the first one wins
  const seen = new Map(); // 'v:<vat>' and 'n:<name>' -> first row
  for (const r of rows) {
    if (!r.customer || r.status === 'error' || r.status === 'duplicate') continue;
    const keys = [r.customer.vat_number && `v:${r.customer.vat_number}`, `n:${r.customer.name_en.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '')}`].filter(Boolean);
    const first = keys.map((k) => seen.get(k)).find(Boolean);
    if (first) { r.status = 'duplicate'; r.warnings = [...r.warnings, `Same customer as row ${first} (will be skipped)`]; } else keys.forEach((k) => seen.set(k, r.row));
  }
  const count = (s) => rows.filter((r) => r.status === s).length;
  return {
    format, headers, rows,
    summary: { total: rows.length, ready: count('ready'), warning: count('warning'), error: count('error'), duplicate: count('duplicate'), ignored: count('ignored') },
    importable: rows.filter((r) => r.status === 'ready' || r.status === 'warning').map((r) => r.customer),
  };
}

/** Columns of the blank template offered for download. */
export const TEMPLATE_HEADERS = ['name_en', 'name_ar', 'customer_type', 'vat_number', 'cr_number', 'contact_person', 'phone', 'email',
  'building_no', 'street', 'district', 'city', 'postal_code', 'additional_no', 'country', 'credit_limit_sar', 'payment_terms'];

const csvCell = (v) => (/[",\n\r]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
export const toCsv = (headers, rows) => [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
