-- =====================================================================
-- posting_check.sql — full sales and purchase cycles through the 0004 functions,
-- with exact GL balances. LOCAL TEST DATABASE ONLY.
-- Order: supabase_stub.sql -> 0001 -> rls_check.sql (part=seed) -> 0002 -> 0003 -> 0004 -> this file
-- Prints "POSTING OK"; raises on the first failure.
-- =====================================================================
create or replace function pg_temp.as_user(p_uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid)::text end, false); end $$;
create or replace function pg_temp.expect(cond boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'CHECK FAILED: %', msg; end if; end $$;
create or replace function pg_temp.eq(a numeric, b numeric, msg text) returns void language plpgsql as $$
begin if a is distinct from b then raise exception 'CHECK FAILED: % (got %, expected %)', msg, a, b; end if; end $$;
create or replace function pg_temp.expect_error(p_sql text, p_like text, msg text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'CHECK FAILED (no error): %', msg;
exception when others then
  if sqlerrm like 'CHECK FAILED%' then raise; end if;
  if sqlerrm not ilike '%' || p_like || '%' then raise exception 'CHECK FAILED (wrong error "%"): %', sqlerrm, msg; end if;
end $$;
-- GL balance of an account (debit positive)
create or replace function pg_temp.bal(p_code text) returns numeric language sql as $$
  select coalesce(sum(debit - credit), 0) from public.gl_journal_lines where account_code = p_code and entry_id not in ('jv-1')
$$;
grant execute on all functions in schema pg_temp to authenticated;

\set fin  '00000000-0000-0000-0000-0000000000f1'
\set mgr  '00000000-0000-0000-0000-0000000000b1'
\set proc '00000000-0000-0000-0000-0000000000d1'
\set sales '00000000-0000-0000-0000-0000000000c1'

-- give the seeded quote a commission rate
update public.inquiries set data = data || '{"commissionPct": 10, "division": "MEP"}' where id = 'INQ-1';
-- seed journal jv-1 had no lines; drop it from the test's balances (see bal())

set role authenticated;

-- ============ SALES CYCLE ============
select pg_temp.as_user(:'sales');
select pg_temp.expect_error($$select public.post_sales_order('INQ-1')$$, 'cannot do this', 'sales cannot convert a quote');

select pg_temp.as_user(:'mgr');
create temp table t_so as select * from public.post_sales_order('INQ-1');
select pg_temp.eq((select subtotal_sar from t_so), 4687.50, 'SO subtotal = 100 x 10 USD x 3.75 / 0.8');
select pg_temp.eq((select vat_sar from t_so), 703.13, 'SO VAT');
select pg_temp.eq((select grand_total_sar from t_so), 5390.63, 'SO total');
select pg_temp.eq((select total_cost_sar from t_so), 3750.00, 'SO cost');
select pg_temp.eq((select (items->0->>'unitSellSar')::numeric from t_so), 46.875, 'SO unit sell');
select pg_temp.expect((select so_number from t_so) like 'SO-%', 'SO number from range');
select pg_temp.expect((select data->>'stage' from public.inquiries where id = 'INQ-1') = 'won', 'quote marked won');
select pg_temp.expect_error($$select public.post_sales_order('INQ-1')$$, 'already been converted', 'no double conversion');

select pg_temp.as_user(:'mgr');
select pg_temp.expect_error(format($$select public.post_delivery_note(%L, '{"b1": 10}')$$, (select id from t_so)), 'cannot do this', 'manager cannot deliver');
select pg_temp.as_user(:'proc');
create temp table t_dn1 as select * from public.post_delivery_note((select id from t_so), '{"b1": 40}', 'first lot');
select pg_temp.expect((select delivery_type from t_dn1) = 'partial', 'partial delivery');
select pg_temp.expect((select status from public.sales_orders where id = (select id from t_so)) = 'partially_delivered', 'SO partially delivered');
create temp table t_dn2 as select * from public.post_delivery_note((select id from t_so), '{"b1": 999}');
select pg_temp.eq((select (items->0->>'qty')::numeric from t_dn2), 60, 'over-delivery capped at remaining 60');
select pg_temp.expect((select status from public.sales_orders where id = (select id from t_so)) = 'delivered', 'SO delivered');
select pg_temp.expect_error(format($$select public.post_delivery_note(%L, '{"b1": 1}')$$, (select id from t_so)), 'Nothing to deliver', 'nothing left');

select pg_temp.as_user(:'fin');
create temp table t_inv as select * from public.post_invoice((select id from t_dn1));
select pg_temp.eq((select subtotal_sar from t_inv), 1875.00, 'invoice subtotal 40 x 46.875');
select pg_temp.eq((select vat_sar from t_inv), 281.25, 'invoice VAT');
select pg_temp.eq((select grand_total_sar from t_inv), 2156.25, 'invoice total');
select pg_temp.eq((select landed_cost_sar from t_inv), 1500.00, 'invoice cost');
select pg_temp.expect((select qr_base64 from t_inv) is not null and (select invoice_type from t_inv) = 'simplified', 'QR + simplified (no client VAT)');
select pg_temp.expect_error(format($$select public.post_invoice(%L)$$, (select id from t_dn1)), 'already been invoiced', 'no double invoice');
select pg_temp.eq((select total_eligible_commission_sar from public.commission_ledger where invoice_id = (select id from t_inv)), 37.50, 'commission 10% of 375 profit');
select pg_temp.eq(pg_temp.bal('1100'), 2156.25, 'AR after invoice');
select pg_temp.eq(pg_temp.bal('4010'), -1875.00, 'MEP revenue');
select pg_temp.eq(pg_temp.bal('2100'), -281.25, 'output VAT');

create temp table t_rcp1 as select * from public.post_customer_receipt((select id from t_inv), 1000, 'Bank Transfer', 'TT-1');
select pg_temp.eq(pg_temp.bal('1020'), 1000.00, 'bank after receipt');
select pg_temp.expect((select payment_status from public.invoices where id = (select id from t_inv)) = 'partial', 'invoice partial');
select pg_temp.eq((select unlocked_commission_sar from public.commission_ledger where invoice_id = (select id from t_inv)), 17.39, 'commission unlocked pro rata');
create temp table t_rcp2 as select * from public.post_customer_receipt((select id from t_inv), 5000, 'Cash');
select pg_temp.eq((select amount_sar from t_rcp2), 1156.25, 'receipt capped at open balance');
select pg_temp.eq(pg_temp.bal('1010'), 1156.25, 'cash account for Cash method');
select pg_temp.expect((select status from public.commission_ledger where invoice_id = (select id from t_inv)) = 'ready_for_payout', 'commission ready');
select pg_temp.expect_error(format($$select public.post_customer_receipt(%L, 1, 'Cash')$$, (select id from t_inv)), 'fully collected', 'no receipt on paid invoice');
select pg_temp.eq(pg_temp.bal('1100'), 0.00, 'AR cleared');

create temp table t_cn as select * from public.post_credit_note((select id from t_inv), '[10]', 'Damaged');
select pg_temp.eq((select subtotal_sar from t_cn), 468.75, 'CN subtotal');
select pg_temp.eq((select vat_sar from t_cn), 70.31, 'CN VAT');
select pg_temp.eq((select grand_total_sar from t_cn), 539.06, 'CN total');
select pg_temp.eq(pg_temp.bal('4090'), 468.75, 'sales returns');
select pg_temp.eq(pg_temp.bal('2100'), -281.25 + 70.31, 'VAT after CN');

-- ============ PURCHASE CYCLE ============
select pg_temp.as_user(:'fin');
select pg_temp.expect_error($$select public.post_purchase_order('{"supplier_name":"X","items":[{"desc":"a","qty":1,"unitCostFx":1}]}')$$, 'cannot do this', 'finance cannot raise POs');
select pg_temp.as_user(:'proc');
create temp table t_po as select * from public.post_purchase_order(format(
  '{"so_id":"%s","supplier_name":"Gulf Cables","supplier_vat":"300111111100003","currency":"USD","fx_rate":3.75,"landed_cost_sar":500,
    "items":[{"desc":"Copper cable","qty":100,"unitCostFx":10,"is_stocked_item":false}]}', (select id from t_so))::jsonb);
select pg_temp.eq((select goods_total_sar from t_po), 3750.00, 'PO goods SAR');
select pg_temp.eq((select supplier_vat_sar from t_po), 637.50, 'PO VAT on goods + landed');
select pg_temp.eq((select total_amount_fx from t_po), 1303.33, 'PO total in USD');
select pg_temp.as_user(:'fin');
select pg_temp.expect_error(format($$select public.post_supplier_bill(%L)$$, (select id from t_po)), 'goods receipt', 'bill needs GRN first');
select pg_temp.as_user(:'proc');
select public.post_goods_receipt((select id from t_po));
select pg_temp.expect_error(format($$select public.post_goods_receipt(%L)$$, (select id from t_po)), 'not waiting', 'no double GRN');
select pg_temp.as_user(:'fin');
create temp table t_bill as select * from public.post_supplier_bill((select id from t_po));
select pg_temp.expect((select bill_number from t_bill) like 'BILL-%' and (select bill_number from t_bill) <> 'BILL-' || (select po_number from t_po), 'bill has its own number');
select pg_temp.expect_error(format($$select public.post_supplier_bill(%L)$$, (select id from t_po)), 'already been billed', 'no double bill');
select pg_temp.eq(pg_temp.bal('2010'), -4887.50, 'AP after bill');
select pg_temp.eq(pg_temp.bal('1150'), 637.50, 'input VAT after bill');

select pg_temp.expect_error(format($$select public.post_supplier_payment(%L, 2000, 3.75, 'TT')$$, (select id from t_po)), 'more than the open balance', 'no overpayment');
select pg_temp.expect_error(format($$select public.post_supplier_payment(%L, 10, 3.75, 'TT', '', null, '2010')$$, (select id from t_po)), 'cash or bank', 'pay only from 10xx');
create temp table t_pay as select * from public.post_supplier_payment((select id from t_po), 1303.33, 3.80, 'TT', 'SWIFT-9', null, '1030', 'final');
select pg_temp.eq((select amount_sar from t_pay), 4952.65, 'payment SAR at settled rate');
select pg_temp.eq((select fx_variance_sar from t_pay), 65.16, 'FX loss');
select pg_temp.eq(pg_temp.bal('1030'), -4952.65, 'paid from secondary bank');
select pg_temp.eq(pg_temp.bal('5130'), 65.16, 'FX loss posted');
select pg_temp.eq(pg_temp.bal('2010'), -0.01, 'AP left with 0.01 rounding (PO total rounded to USD cents)');
select pg_temp.expect((select payment_status from public.purchase_orders where id = (select id from t_po)) = 'paid', 'PO paid');

-- ============ FINANCE ============
create temp table t_exp as select * from public.post_expense_voucher('{"payee":"STC","expense_account_code":"5220","amount_sar":1000,"vat_applied":true,"vat_recoverable":true,"paid_from_account_code":"1020","description":"Internet"}');
select pg_temp.eq((select total_sar from t_exp), 1150.00, 'expense total');
select pg_temp.eq(pg_temp.bal('5220'), 1000.00, 'expense net');
select pg_temp.expect_error($$select public.post_expense_voucher('{"payee":"x","expense_account_code":"1020","amount_sar":10}')$$, 'Expense account', 'expense must hit an expense account');
select public.void_expense_voucher((select id from t_exp));
select pg_temp.eq(pg_temp.bal('5220'), 0.00, 'void reverses expense');
select pg_temp.expect_error(format($$select public.void_expense_voucher(%L)$$, (select id from t_exp)), 'already void', 'no double void');

select pg_temp.expect_error($$select public.post_journal('MANUAL', current_date, 'bad', '[{"account_code":"5100","debit":100},{"account_code":"1020","credit":90}]')$$, 'does not balance', 'unbalanced JV refused');
select pg_temp.expect_error($$select public.post_journal('MANUAL', current_date, 'bad', '[{"account_code":"9999","debit":100},{"account_code":"1020","credit":100}]')$$, 'unknown', 'unknown account refused');
create temp table t_jv as select * from public.post_journal('MANUAL', current_date, 'Accrual', '[{"account_code":"5210","debit":100.03},{"account_code":"2200","credit":100}]', 'ACR-1');
select pg_temp.eq(pg_temp.bal('5990'), -0.03, '3 halala drift to 5990');
select pg_temp.eq((select count(*) from public.gl_journal_lines where entry_id = (select id from t_jv)), 3, 'JV has its 3 lines in gl_journal_lines');
create temp table t_bt as select * from public.post_journal('BANK_TRANSFER', current_date, 'Transfer {doc}', '[{"account_code":"1030","debit":5000},{"account_code":"1020","credit":5000}]');
select pg_temp.expect((select description from t_bt) like 'Transfer BNK-%', 'bank transfer gets a BNK number');

create temp table t_fa as select * from public.post_fixed_asset('{"name":"Van","category_account_code":"1500","cost_sar":12000,"useful_life_months":12,"paid_from_account_code":"1020"}');
select pg_temp.eq(pg_temp.bal('1500'), 12000.00, 'asset capitalised');
select pg_temp.expect_error(format($$select public.post_depreciation_run(to_char(current_date, 'YYYY-MM'), '[{"id":"%s","amount":99999,"months":1}]')$$, (select id from t_fa)), 'not allowed', 'no over-depreciation');
select public.post_depreciation_run(to_char(current_date, 'YYYY-MM'), format('[{"id":"%s","amount":1000,"months":1}]', (select id from t_fa))::jsonb);
select pg_temp.eq(pg_temp.bal('5270'), 1000.00, 'depreciation expense');
select pg_temp.eq((select accumulated_depreciation_sar from public.fixed_assets where id = (select id from t_fa)), 1000.00, 'asset register updated');
select pg_temp.expect_error(format($$select public.post_depreciation_run(to_char(current_date, 'YYYY-MM'), '[{"id":"%s","amount":1000,"months":1}]')$$, (select id from t_fa)), 'not allowed', 'no double run for a period');
select public.dispose_fixed_asset((select id from t_fa), current_date, 10000, '1020');
select pg_temp.eq(pg_temp.bal('1500'), 0.00, 'asset derecognised');
select pg_temp.eq(pg_temp.bal('1590'), 0.00, 'accumulated depreciation removed');
select pg_temp.eq(pg_temp.bal('5100'), 1000.00, 'loss on disposal (10000 vs NBV 11000)');

select public.post_journal('YEAR_END_CLOSE', make_date(extract(year from current_date)::int, 12, 31), 'Close', '[{"account_code":"4010","debit":1875},{"account_code":"3020","credit":1875}]', 'FY' || extract(year from current_date));
select pg_temp.expect_error(format($$select public.post_journal('YEAR_END_CLOSE', current_date, 'x', '[{"account_code":"4010","debit":1},{"account_code":"3020","credit":1}]', 'FY%s')$$, extract(year from current_date)), 'already been closed', 'no double year-end');

-- ============ Integrity ============
reset role;
select pg_temp.expect((select sum(debit) = sum(credit) from public.gl_journal_lines), 'whole ledger balances');
select pg_temp.expect(not exists (
  select 1 from public.gl_journal_entries e where e.id <> 'jv-1' and e.total_debit_sar <> (select sum(debit) from public.gl_journal_lines l where l.entry_id = e.id)), 'every header total = its lines');
select pg_temp.expect((select count(*) from public.gl_backfill_issues) = 1, 'only the seeded line-less jv-1 is reported');
-- the old app's direct inserts still work before 0005 and get their lines
set role authenticated;
select pg_temp.as_user(:'fin');
insert into public.gl_journal_entries (id, voucher_number, entry_date, lines, total_debit_sar, total_credit_sar, status)
values ('jv-old-app', 'JV-OLD', current_date, '[{"account_code":"5100","debit":50},{"account_code":"1010","credit":50}]', 50, 50, 'posted');
select pg_temp.eq((select count(*) from public.gl_journal_lines where entry_id = 'jv-old-app'), 2, 'old-app JV expanded into lines');
select pg_temp.expect_error($$insert into public.gl_journal_entries (id, lines, status) values ('jv-bad', '[{"account_code":"5100","debit":50},{"account_code":"1010","credit":40}]', 'posted')$$, 'does not balance', 'old-app unbalanced JV refused');
reset role;

select 'POSTING OK' as result;
