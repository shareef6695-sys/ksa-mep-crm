import { describe, it, expect } from 'vitest';
import { buildMasterPreview, checkItem, checkVendor, guessCategory, ITEM_TEMPLATE_HEADERS, mapItemRecord, mapUnit, mapVendorRecord, toCsv,
  VENDOR_TEMPLATE_HEADERS } from '../masterImport';
import { parseCsv } from '../customerImport';

// Invented data only.
const rec = (values, row = 2) => ({ row, values });

describe('vendors', () => {
  it('maps a Zoho-style vendor: company name, TRN, address lines, terms', () => {
    const v = mapVendorRecord(rec({ 'Contact Type': 'vendor', Status: 'Active', 'Display Name': 'Sample', 'Company Name': 'Sample Pipes Factory',
      'Tax Registration Number': '300000000000023', 'VAT Treatment': 'vat_registered', 'Billing Address': '2817', 'Billing Street2': 'Industrial Area\nPhase 2',
      'Billing City': 'Jeddah', 'Billing Code': '22525', 'Billing Country': 'Saudi Arabia', 'Currency Code': 'SAR', 'Payment Terms': '0', 'Payment Terms Label': 'Due on Receipt' })).record;
    expect(v).toMatchObject({ name_en: 'Sample Pipes Factory', vendor_origin: 'KSA', vat_number: '300000000000023', city: 'Jeddah',
      address: '2817, Industrial Area, Phase 2, 22525', default_currency: 'SAR', payment_terms: 'Advance / Cash', country: 'Saudi Arabia' });
  });
  it('foreign vendors: non_gcc or a non-GCC country is International; GCC country is GCC; customers are ignored', () => {
    expect(mapVendorRecord(rec({ 'Display Name': 'Example Software Ltd', 'VAT Treatment': 'non_gcc', 'Currency Code': 'usd' })).record)
      .toMatchObject({ vendor_origin: 'International', default_currency: 'USD', country: '' });
    expect(mapVendorRecord(rec({ name_en: 'Doha Supplies', country: 'Qatar' })).record.vendor_origin).toBe('GCC');
    expect(mapVendorRecord(rec({ 'Display Name': 'A Customer', 'Contact Type': 'customer' })).skip).toMatch(/not a vendor/);
  });
  it('checks: bad KSA VAT blocks, foreign tax ids are fine, missing VAT / address are warnings, duplicates by VAT or name', () => {
    expect(checkVendor({ name_en: 'X', vendor_origin: 'KSA', vat_number: '123' }).errors[0]).toMatch(/not 15 digits/);
    expect(checkVendor({ name_en: 'X', vendor_origin: 'International', vat_number: 'GB123', city: 'London' }).errors).toEqual([]);
    expect(checkVendor({ name_en: 'X', vendor_origin: 'KSA', vat_number: '' }).warnings).toEqual(['No VAT number (not VAT-registered?)', 'No address']);
    expect(checkVendor({ name_en: 'SAMPLE PIPES FACTORY.', vendor_origin: 'KSA', city: 'J' }, { existing: [{ vendor_code: 'VEND-00001', name_en: 'Sample Pipes Factory' }] }).duplicate).toBe(true);
  });
  it('preview: same VAT twice in a file keeps the first', () => {
    const text = toCsv(VENDOR_TEMPLATE_HEADERS, [
      ['Sample Pipes Factory', '', 'KSA', '300000000000023', '', '', '', '', '', 'Jeddah', '', 'SAR', 'Net 30', ''],
      ['Sample Pipes Factory - Khobar', '', 'KSA', '300000000000023', '', '', '', '', '', 'Al Khobar', '', 'SAR', 'Net 30', ''],
    ]);
    const p = buildMasterPreview('vendor', text);
    expect(p.rows.map((r) => r.status)).toEqual(['ready', 'duplicate']);
    expect(p.importable).toHaveLength(1);
  });
});

describe('items', () => {
  it('units: aliases to standard codes, empty by type, unknown becomes a new unit', () => {
    expect(mapUnit('pcs', 'Goods')).toEqual({ uom: 'PCS' });
    expect(mapUnit('Mtrs', 'Goods')).toEqual({ uom: 'MTR' });
    expect(mapUnit('Rolls', 'Goods')).toEqual({ uom: 'ROL' });
    expect(mapUnit('', 'Service')).toEqual({ uom: 'LOT' });
    expect(mapUnit('1', 'Goods')).toEqual({ uom: 'PCS' });
    expect(mapUnit('Year', 'Service')).toEqual({ uom: 'YR', uom_label: 'Year', newUnit: true });
  });
  it('division guess from the name', () => {
    expect(guessCategory('Cat6 UTP Cable 305m')).toBe('IT & ELV');
    expect(guessCategory('Annual cloud hosting', 'service')).toBe('IT & ELV');
    expect(guessCategory('Anything', 'digital_service')).toBe('IT & ELV');
    expect(guessCategory('HDPE Pipe 110mm PN16')).toBe('MEP');
  });
  it('maps a Zoho-style item; a missing VAT rate becomes Standard and is flagged', () => {
    const m = mapItemRecord(rec({ 'Item Name': '"Sample Conduit 1 inch"', 'Product Type': 'goods', 'Usage unit': 'Pcs', Rate: '115.5', 'Purchase Rate': '80',
      'Tax Percentage': '0', Status: 'Active' }));
    expect(m.record).toMatchObject({ name_en: 'Sample Conduit 1 inch', item_type: 'Goods', uom: 'PCS', sales_price_sar: 115.5, purchase_price: 80, zatca_vat_type: 'S', category: 'MEP' });
    expect(m.noZohoRate).toBe(true);
    expect(mapItemRecord(rec({ 'Item Name': 'B', 'Tax Percentage': '15' })).noZohoRate).toBe(false);
    expect(mapItemRecord(rec({ name_en: 'C', zatca_vat_type: 'z', zatca_exemption_reason: 'VATEX-SA-32' })).record.zatca_vat_type).toBe('Z');
  });
  it('checks', () => {
    const base = { name_en: 'A', item_type: 'Goods', zatca_vat_type: 'S', sales_price_sar: 10, purchase_price: 5, uom: 'PCS', category: 'MEP' };
    expect(checkItem(base)).toEqual({ errors: [], warnings: [], duplicate: false });
    expect(checkItem({ ...base, zatca_vat_type: 'Z' }).errors[0]).toMatch(/exemption reason/);
    expect(checkItem({ ...base, zatca_vat_type: 'Q' }).errors[0]).toMatch(/Unknown VAT/);
    expect(checkItem({ ...base, sales_price_sar: -1 }).errors).toContain('Negative price');
    expect(checkItem({ ...base, sales_price_sar: 0 }, { noZohoRate: true }).warnings).toEqual(['No VAT rate in the source; set to Standard 15% — confirm', 'No selling price']);
  });
  it('preview from the template: duplicate names inside the file, division taken from the file', () => {
    const text = toCsv(ITEM_TEMPLATE_HEADERS, [
      ['Goods', 'Sample PVC Pipe', '', 'MEP', 'MTR', '25', '18', 'SAR', 'S', '', '', 'no'],
      ['Goods', 'sample pvc pipe', '', 'MEP', 'MTR', '25', '18', 'SAR', 'S', '', '', 'no'],
      ['Service', 'Sample Licence', '', 'IT & ELV', 'Year', '1200', '', 'SAR', 'S', '', '', ''],
    ]);
    const p = buildMasterPreview('item', text);
    expect(p.format).toBe('template');
    expect(p.rows.map((r) => r.status)).toEqual(['ready', 'duplicate', 'warning']);
    expect(p.rows[2].warnings).toEqual(['New unit YR (Year) will be added']);
    expect(p.importable.map((i) => [i.name_en, i.uom])).toEqual([['Sample PVC Pipe', 'MTR'], ['Sample Licence', 'YR']]);
    expect(parseCsv(text).records).toHaveLength(3);
  });
});
