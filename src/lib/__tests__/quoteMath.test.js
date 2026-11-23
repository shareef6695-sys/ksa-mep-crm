import { describe, it, expect } from 'vitest';
import { computeQuoteFinancials, quoteLineUnitSellSar, quoteLineVat, quoteForPreview } from '../quoteMath';

const fx = { SAR: 1, USD: 3.75 };

describe('quote pricing', () => {
  it('sell price = cost / (1 - margin), FX converted to SAR', () => {
    expect(quoteLineUnitSellSar({ buyUnitCost: 80, buyCurrency: 'SAR' }, 20, fx)).toBeCloseTo(100, 10);
    expect(quoteLineUnitSellSar({ buyUnitCost: 10, buyCurrency: 'USD' }, 25, fx)).toBeCloseTo(50, 10);
  });
  it('margin of 100% or more falls back to cost; unknown currency counts as SAR', () => {
    expect(quoteLineUnitSellSar({ buyUnitCost: 80, buyCurrency: 'SAR' }, 100, fx)).toBe(80);
    expect(quoteLineUnitSellSar({ buyUnitCost: 80, buyCurrency: 'XYZ' }, 0, fx)).toBe(80);
  });
  it('lines without cost (sales roles) use the price the database computed', () => {
    expect(quoteLineUnitSellSar({ sellUnitSar: 123.45 }, 30, fx)).toBe(123.45);
    expect(quoteLineUnitSellSar({}, 30, fx)).toBe(0);
  });
  it('totals: cost, net, profit, VAT per line category', () => {
    const q = {
      marginPercent: 20,
      boqItems: [
        { qty: 2, buyUnitCost: 80, buyCurrency: 'SAR' }, // 200 net, 30 VAT
        { qty: 1, buyUnitCost: 20, buyCurrency: 'USD', vatCategory: 'Z' }, // 93.75 net, 0 VAT
      ],
    };
    const f = computeQuoteFinancials(q, fx);
    expect(f.totalCostSAR).toBeCloseTo(235, 10);
    expect(f.sellNetSAR).toBeCloseTo(293.75, 10);
    expect(f.profitSAR).toBeCloseTo(58.75, 10);
    expect(f.vatSAR).toBeCloseTo(30, 10);
    expect(f.grandTotalSAR).toBeCloseTo(323.75, 10);
  });
  it('VAT category from the line, else the catalogue item, else standard', () => {
    expect(quoteLineVat({ vatCategory: 'e' }).vatCategory).toBe('E');
    expect(quoteLineVat({ itemId: 'i1' }, { i1: { zatca_vat_type: 'Z', zatca_exemption_reason: 'VATEX-SA-32' } })).toEqual({ vatCategory: 'Z', vatRate: 0, exemptionReason: 'VATEX-SA-32' });
    expect(quoteLineVat({}).vatRate).toBe(0.15);
  });
  it('preview lines carry a 2-decimal unit price', () => {
    const p = quoteForPreview({ marginPercent: 30, boqItems: [{ desc: 'x', qty: 3, buyUnitCost: 10, buyCurrency: 'SAR' }] }, fx);
    expect(p.items[0]).toMatchObject({ desc: 'x', qty: 3, unit: 'PCS', unitSellSar: 14.29, vatCategory: 'S' });
  });
});
