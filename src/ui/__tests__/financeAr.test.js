// Every text the finance screens pass to tr() has an Arabic translation (Prompt 15).
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FINANCE_AR } from '../financeAr';
import { tr, setFinanceLang } from '../financeI18n';

const src = join(__dirname, '..', '..');
const files = ['erp/GeneralLedgerView.jsx', 'erp/FinancialStatementsView.jsx', 'erp/VatReturnView.jsx', 'erp/PaymentsAndAgingView.jsx',
  'erp/VatAndProfitabilityView.jsx', ...readdirSync(join(src, 'features/finance/suite')).filter((f) => f.endsWith('.jsx')).map((f) => `features/finance/suite/${f}`)];

describe('Arabic finance screens', () => {
  it('every tr("...") text has an Arabic entry', () => {
    const missing = [];
    for (const f of files) {
      const s = readFileSync(join(src, f), 'utf8');
      for (const m of s.matchAll(/\btr\(("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\)/g)) {
        const text = m[1][0] === '"' ? JSON.parse(m[1]) : m[1].slice(1, -1).replace(/\\'/g, "'");
        if (!FINANCE_AR[text]) missing.push(`${f}: ${text}`);
      }
    }
    expect(missing).toEqual([]);
  });
  it('switches with the interface language', () => {
    setFinanceLang('ar');
    expect(tr('Debit')).toBe('مدين');
    expect(tr('Not in the dictionary')).toBe('Not in the dictionary');
    setFinanceLang('en');
    expect(tr('Debit')).toBe('Debit');
  });
});
