import { describe, it, expect } from 'vitest';
import { parseCsv, detectFormat, mapPaymentTerms, mapCustomerRecord, checkCustomer, buildImportPreview, toCsv, TEMPLATE_HEADERS } from '../customerImport';

// Shape of a Zoho Books "Contacts" export (only the columns the import reads; invented customers).
const ZOHO_HEADERS = ['Display Name', 'Display Name (Secondary Language)', 'Company Name', 'Salutation', 'First Name', 'Last Name', 'Phone',
  'Status', 'Credit Limit', 'Customer Sub Type', 'Billing Address', 'Billing Street2', 'Billing Additional Number', 'Billing City',
  'Billing District', 'Billing Country', 'Billing Code', 'Payment Terms', 'Payment Terms Label', 'Tax Registration Number',
  'VAT Treatment', 'EmailID', 'Contact ID', 'Contact Type'];
const zohoRow = (o) => ZOHO_HEADERS.map((h) => o[h] ?? '');
const zoho = (...rows) => '﻿' + toCsv(ZOHO_HEADERS, rows.map(zohoRow));

describe('parseCsv', () => {
  it('handles BOM, quotes, escaped quotes, commas and newlines inside quotes, CRLF and blank lines', () => {
    const { headers, records } = parseCsv('﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n\r\n2,"line1\nline2",\n');
    expect(headers).toEqual(['a', 'b', 'c']);
    expect(records).toEqual([
      { row: 2, values: { a: '1', b: 'x, y', c: 'say "hi"' } },
      { row: 3, values: { a: '2', b: 'line1\nline2', c: '' } },
    ]);
  });
  it('detects semicolon separated files', () => {
    expect(parseCsv('name_en;city\nAcme;Jeddah').records[0].values).toEqual({ name_en: 'Acme', city: 'Jeddah' });
  });
  it('empty input', () => {
    expect(parseCsv('')).toEqual({ headers: [], records: [] });
  });
});

describe('mapping', () => {
  it('recognises the formats', () => {
    expect(detectFormat(ZOHO_HEADERS)).toBe('zoho');
    expect(detectFormat(TEMPLATE_HEADERS)).toBe('template');
    expect(detectFormat(['foo', 'bar'])).toBe('unknown');
  });
  it('payment terms map to the ERP choices', () => {
    expect(mapPaymentTerms('0', 'Due on Receipt')).toBe('Advance / Cash');
    expect(mapPaymentTerms('', 'Advance 100%')).toBe('Advance / Cash');
    expect(mapPaymentTerms('30', 'Net 30')).toBe('Net 30');
    expect(mapPaymentTerms('', 'Net 45')).toBe('Net 45');
    expect(mapPaymentTerms('', '')).toBe('Net 30');
  });
  it('a Zoho row: building number in address line 1, postal code at the end of the street, city with postal code', () => {
    const { records } = parseCsv(zoho(
      { 'Display Name': 'Test Steel Co', 'Display Name (Secondary Language)': 'شركة الاختبار', Salutation: 'Mr.', 'First Name': 'Sami', 'Last Name': 'Ali',
        'Billing Address': '1234', 'Billing Street2': 'Street 10 23435', 'Billing City': 'Jeddah', 'Billing Country': 'Saudi Arabia',
        'Payment Terms': '0', 'Payment Terms Label': 'Due on Receipt', 'Tax Registration Number': '300000000000003', 'EmailID': 'AP@Test.sa',
        'Customer Sub Type': 'business', Status: 'Active', 'Contact Type': 'customer', 'Credit Limit': '0.000' },
      { 'Display Name': 'Khobar Co', 'Billing Street2': 'Tower A', 'Billing City': 'Al Khobar 31952', 'Customer Sub Type': 'business',
        Status: 'Active', 'Contact Type': 'customer' },
    ));
    const a = mapCustomerRecord(records[0]).customer;
    expect(a).toMatchObject({ name_en: 'Test Steel Co', name_ar: 'شركة الاختبار', customer_type: 'B2B', vat_number: '300000000000003',
      contact_person: 'Mr. Sami Ali', email: 'ap@test.sa', building_no: '1234', street: 'Street 10 23435', city: 'Jeddah',
      postal_code: '23435', country: 'SA', payment_terms: 'Advance / Cash', credit_limit_sar: 0 });
    const b = mapCustomerRecord(records[1]).customer;
    expect(b).toMatchObject({ city: 'Al Khobar', postal_code: '31952' });
  });
  it('individuals are B2C; vendors and inactive contacts are ignored; foreign cities set the country', () => {
    const { records } = parseCsv(zoho(
      { 'Display Name': 'Cash', 'Customer Sub Type': 'individual', Status: 'Active', 'Contact Type': 'customer' },
      { 'Display Name': 'A Supplier', Status: 'Active', 'Contact Type': 'vendor' },
      { 'Display Name': 'Old Co', Status: 'Inactive', 'Contact Type': 'customer' },
      { 'Display Name': 'Doha Co', 'Billing City': 'Doha', Status: 'Active', 'Contact Type': 'customer' },
    ));
    expect(mapCustomerRecord(records[0]).customer.customer_type).toBe('B2C');
    expect(mapCustomerRecord(records[1]).skip).toMatch(/vendor/);
    expect(mapCustomerRecord(records[2]).skip).toMatch(/Inactive/);
    expect(mapCustomerRecord(records[3]).customer.country).toBe('QA');
  });
});

describe('checks and preview', () => {
  const complete = { name_en: 'Full Co', name_ar: 'شركة', customer_type: 'B2B', vat_number: '300000000000003', building_no: '1234', street: 'King Rd',
    district: 'Al Rawdah', city: 'Jeddah', postal_code: '23435', country: 'SA', email: 'a@b.sa' };
  it('a complete B2B customer has no warnings', () => {
    expect(checkCustomer(complete)).toEqual({ errors: [], warnings: [], duplicate: false });
  });
  it('errors block, warnings list what to complete', () => {
    expect(checkCustomer({ ...complete, vat_number: '12345' }).errors[0]).toMatch(/not 15 digits/);
    expect(checkCustomer({ ...complete, name_en: '' }).errors).toContain('Name is missing');
    const w = checkCustomer({ ...complete, vat_number: '', district: '', postal_code: '' }).warnings;
    expect(w).toEqual(['No VAT number', 'Address incomplete: district, postal code']);
  });
  it('existing customers (same VAT or same name) are marked as duplicates', () => {
    expect(checkCustomer(complete, { existing: [{ customer_code: 'CUST-00001', name_en: 'FULL CO.', vat_number: '' }] }).duplicate).toBe(true);
  });
  it('builds a preview: importable rows, duplicates within the file, summary', () => {
    const text = toCsv(TEMPLATE_HEADERS, [
      ['Alpha Co', '', 'B2B', '300000000000003', '', '', '', 'a@alpha.sa', '1234', 'Rd', 'Dist', 'Jeddah', '23435', '', 'SA', '', 'Net 30'],
      ['Beta Co', '', 'B2B', '12345', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['ALPHA CO.', '', 'B2B', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['Gamma', '', 'B2C', '', '', '', '0500000000', '', '', '', '', '', '', '', '', '', ''],
    ]);
    const p = buildImportPreview(text);
    expect(p.format).toBe('template');
    expect(p.rows.map((r) => r.status)).toEqual(['warning', 'error', 'duplicate', 'ready']);
    expect(p.summary).toMatchObject({ total: 4, ready: 1, warning: 1, error: 1, duplicate: 1 });
    expect(p.importable.map((c) => [c.row, c.name_en])).toEqual([[2, 'Alpha Co'], [5, 'Gamma']]);
  });
});
