// Every posting / workflow function defined in the migrations must be exercised by at least one SQL test (Prompt 15).
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const sql = (dir: string) => readdirSync(join(root, dir)).filter((f) => f.endsWith('.sql')).map((f) => readFileSync(join(root, dir, f), 'utf8'));

describe('SQL test coverage of posting functions', () => {
  it('each post_* / void_* / approval function is called in supabase/tests/*.sql', () => {
    const defs = new Set<string>();
    for (const m of sql('migrations')) {
      for (const x of m.matchAll(/create or replace function public\.((?:post|void)_[a-z_]+|approve_purchase_order|reject_purchase_order|close_purchase_order|amend_sales_order|cancel_sales_order|generate_contract_drafts|recognize_deferred_revenue|invoice_service_ticket|set_contract_commission)\(/g)) defs.add(x[1]);
    }
    const tests = sql('tests').join('\n');
    const missing = [...defs].filter((f) => !new RegExp(`\\b${f}\\(`).test(tests));
    expect(defs.size).toBeGreaterThan(30);
    expect(missing).toEqual([]);
  });
});
