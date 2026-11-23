// Quote pricing maths (pure; moved from App.jsx). Server-side truth: post_sales_order / _quote_* in SQL.
import { vatRateOf } from '../erp/erpEngine';

export const hasLineCost = (item) => item.buyUnitCost !== undefined && item.buyUnitCost !== null;
// Unit selling price in SAR for one BOQ line. Users who can't see cost get it precomputed
// by the database (sellUnitSar from inquiries_v); everyone else computes it from cost + margin.
export const quoteLineUnitSellSar = (item, marginPercent, fxRates) => {
  if (!hasLineCost(item)) return Number(item.sellUnitSar) || 0;
  const unitCostSar = (Number(item.buyUnitCost) || 0) * (fxRates[item.buyCurrency] || 1);
  const m = Number(marginPercent) || 0;
  return m >= 100 ? unitCostSar : unitCostSar / (1 - m / 100);
};
// VAT category of a quote line: set on the line, else the catalogue item's, else standard (S)
export const quoteLineVat = (item, itemsById = {}) => {
  const master = item.itemId ? itemsById[item.itemId] : null;
  const vatCategory = String(item.vatCategory || master?.zatca_vat_type || 'S').toUpperCase();
  return { vatCategory, vatRate: vatRateOf({ vatCategory }), exemptionReason: item.exemptionReason || master?.zatca_exemption_reason || '' };
};
export const computeQuoteFinancials = (inquiry, fxRates, itemsById = {}) => {
  const lines = inquiry.boqItems || [];
  const totalCostSAR = lines.reduce((sum, item) => {
    if (!hasLineCost(item)) return sum;
    const rate = fxRates[item.buyCurrency] || 1;
    return sum + (Number(item.qty) || 0) * (Number(item.buyUnitCost) || 0) * rate;
  }, 0);
  const sellNetSAR = lines.reduce((sum, item) => sum + (Number(item.qty) || 0) * quoteLineUnitSellSar(item, inquiry.marginPercent, fxRates), 0);
  const profitSAR = sellNetSAR - totalCostSAR;
  const vatSAR = lines.reduce(
    (sum, item) => sum + (Number(item.qty) || 0) * quoteLineUnitSellSar(item, inquiry.marginPercent, fxRates) * quoteLineVat(item, itemsById).vatRate,
    0
  );
  const grandTotalSAR = sellNetSAR + vatSAR;
  return { totalCostSAR, sellNetSAR, profitSAR, vatSAR, grandTotalSAR };
};
// Quote shaped for the A4 quotation preview (it expects items[] with unitSellSar)
export const quoteForPreview = (inq, fxRates, itemsById = {}) =>
  inq && {
    ...inq,
    items: (inq.boqItems || []).map((b) => ({
      desc: b.desc,
      qty: Number(b.qty) || 0,
      unit: b.unit || 'PCS',
      unitSellSar: Number(quoteLineUnitSellSar(b, inq.marginPercent, fxRates).toFixed(2)),
      ...quoteLineVat(b, itemsById),
    })),
  };
