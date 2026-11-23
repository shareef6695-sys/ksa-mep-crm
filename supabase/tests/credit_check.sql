-- =====================================================================
-- credit_check.sql — proves 0006. LOCAL TEST DATABASE ONLY.
-- Order: stub -> 0001 -> rls_check (seed) -> 0002 -> 0003 -> 0004 -> posting_check.sql -> 0006 -> this file
-- (posting_check leaves an OLD-style credit note that reduced its invoice; 0006 must restore it.)
-- Prints "CREDIT OK".
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
create or replace function pg_temp.bal(p_code text) returns numeric language sql as $$
  select coalesce(sum(debit - credit), 0) from public.gl_journal_lines where account_code = p_code
$$;
grant execute on all functions in schema pg_temp to authenticated;

\set fin  '00000000-0000-0000-0000-0000000000f1'
\set mgr  '00000000-0000-0000-0000-0000000000b1'
\set proc '00000000-0000-0000-0000-0000000000d1'

create temp table t_inv1 as select id from public.invoices where landed_cost_sar = 1500;   -- 40 x Cable, fully paid, old CN of 10
create temp table t_inv2_dn as select id from public.delivery_notes where (items->0->>'qty')::numeric = 60;
grant select on t_inv1, t_inv2_dn to authenticated;

-- ---------- 1. Old credit note: invoice restored, overpayment reported ----------
select pg_temp.eq((select grand_total_sar from public.invoices where id = (select id from t_inv1)), 2156.25, 'invoice restored to issued total');
select pg_temp.eq((select credited_amount_sar from public.invoices where id = (select id from t_inv1)), 539.06, 'old CN recorded as credited');
select pg_temp.eq((public._invoice_credited_qty((select id from t_inv1)))[1], 10, 'old CN line matched by description + price');

set role authenticated;
select pg_temp.as_user(:'fin');
select pg_temp.eq((select overpaid_sar from public.legacy_overpaid_invoices where invoice_id = (select id from t_inv1)), 539.06, 'legacy overpayment listed');

-- ---------- 2. Invoices never change ----------
select pg_temp.expect_error(format($$update public.invoices set grand_total_sar = 1 where id = %L$$, (select id from t_inv1)), 'cannot be changed: grand_total_sar', 'invoice total locked');

-- ---------- 3. Credit-note caps ----------
select pg_temp.expect_error(format($$select public.post_credit_note(%L, '[31]', 'x')$$, (select id from t_inv1)), 'not yet credited', 'cannot re-credit the same units');
select pg_temp.expect_error(format($$select public.post_credit_note(%L, '[1]', 'x', 'NOPE')$$, (select id from t_inv1)), 'reason code', 'reason code validated');
create temp table t_cn2 as select * from public.post_credit_note((select id from t_inv1), '[5]', 'Second return', 'DAMAGED');
select pg_temp.eq((select grand_total_sar from t_cn2), 269.53, 'CN 5 x 46.875 + VAT');
select pg_temp.eq((select to_customer_credit_sar from t_cn2), 269.53, 'invoice already paid: whole CN becomes customer credit');
select pg_temp.eq((select applied_to_ar_sar from t_cn2), 0, 'nothing against AR');
select pg_temp.expect((select reason_code from t_cn2) = 'DAMAGED' and (select original_invoice_date from t_cn2) is not null, 'reason code + original invoice date stored');
select pg_temp.eq((select (items->0->>'invoiceLine')::int from t_cn2), 0, 'CN line linked to invoice line');
select pg_temp.eq((select grand_total_sar from public.invoices where id = (select id from t_inv1)), 2156.25, 'invoice still unchanged');
select pg_temp.eq((select credited_amount_sar from public.invoices where id = (select id from t_inv1)), 808.59, 'credited total accumulates');
select pg_temp.eq((select paid_amount_sar from public.invoices where id = (select id from t_inv1)), 1886.72, 'paid part released to customer credit');
select pg_temp.eq((public.invoice_credited_qty((select id from t_inv1)))[1], 15, '15 units credited so far');
select pg_temp.eq(pg_temp.bal('2050'), -269.53, '2050 holds the refund due');
select pg_temp.eq(coalesce((select credit_balance_sar from public.customer_credit_balances where lower(client_name) = lower('client one')), 0), 269.53, 'customer credit ledger (name match ignores case)');

-- ---------- 4. Second invoice + a receipt split across invoices with money on account ----------
create temp table t_inv2 as select * from public.post_invoice((select id from t_inv2_dn));
select pg_temp.eq((select grand_total_sar from t_inv2), 3234.38, 'second invoice');
-- a third invoice for the same customer
reset role;
select pg_temp.as_user(null);
insert into public.inquiries (id, data) values ('INQ-3', '{"id":"INQ-3","clientName":"Client One","salesmanId":"00000000-0000-0000-0000-0000000000c1","marginPercent":20,"commissionPct":10,
  "boqItems":[{"id":"x1","desc":"Switch","qty":2,"buyCurrency":"SAR","buyUnitCost":400}]}');
set role authenticated;
select pg_temp.as_user(:'mgr');
create temp table t_so3 as select * from public.post_sales_order('INQ-3');
select pg_temp.as_user(:'proc');
create temp table t_dn3 as select * from public.post_delivery_note((select id from t_so3), '{"x1": 2}');
select pg_temp.as_user(:'fin');
create temp table t_inv3 as select * from public.post_invoice((select id from t_dn3));
select pg_temp.eq((select grand_total_sar from t_inv3), 1150.00, 'third invoice 2 x 500 + VAT');

select pg_temp.expect_error(format($$select public.post_receipt('Client One', 100, 'Bank Transfer', '', null, '[{"invoice_id":"%s","amount":5000}]')$$, (select id from t_inv2)), 'more than the open balance', 'allocation capped at open balance');
select pg_temp.expect_error(format($$select public.post_receipt('Client One', 100, 'Bank Transfer', '', null, '[{"invoice_id":"%s","amount":200}]')$$, (select id from t_inv2)), 'more than the amount received', 'allocations cannot exceed receipt');
select pg_temp.expect_error($$select public.post_receipt('Client Two', 100, 'Bank Transfer', '', null, '[{"invoice_id":"inv-2","amount":10},{"invoice_id":"inv-1","amount":10}]')$$, 'belongs to', 'one customer per receipt');

create temp table t_rcp as select * from public.post_receipt('Client One', 4000, 'Bank Transfer', 'TT-77', null,
  format('[{"invoice_id":"%s","amount":3234.38},{"invoice_id":"%s","amount":500}]', (select id from t_inv2), (select id from t_inv3))::jsonb);
select pg_temp.eq((select unapplied_sar from t_rcp), 265.62, 'remainder held on account');
select pg_temp.expect((select invoice_number from t_rcp) like '%, %', 'receipt lists both invoices');
select pg_temp.eq((select count(*) from public.receipt_allocations where receipt_id = (select id from t_rcp)), 2, 'two allocations');
select pg_temp.expect((select payment_status from public.invoices where id = (select id from t_inv2)) = 'paid', 'invoice 2 paid');
select pg_temp.expect((select payment_status from public.invoices where id = (select id from t_inv3)) = 'partial', 'invoice 3 partial');
select pg_temp.eq(coalesce((select credit_balance_sar from public.customer_credit_balances where lower(client_name) = lower('Client One')), 0), 269.53 + 265.62, 'credit = CN excess + on-account');
select pg_temp.eq(pg_temp.bal('2050'), -(269.53 + 265.62), '2050 matches the credit ledger');

-- ---------- 5. Use the credit, then refund ----------
select pg_temp.expect_error(format($$select public.apply_customer_credit(%L, 700)$$, (select id from t_inv3)), 'more than the open balance', 'apply capped at open balance');
select pg_temp.expect_error(format($$select public.apply_customer_credit(%L, 650)$$, (select id from t_inv3)), 'only SAR 535.15', 'apply capped at available credit');
select public.apply_customer_credit((select id from t_inv3), 535.15);
select pg_temp.eq((select grand_total_sar - paid_amount_sar - credited_amount_sar from public.invoices where id = (select id from t_inv3)), 114.85, 'invoice 3 open after credit');
select pg_temp.eq(coalesce((select credit_balance_sar from public.customer_credit_balances where lower(client_name) = lower('Client One')), 0), 0, 'credit used up');
select pg_temp.eq(pg_temp.bal('2050'), 0, '2050 cleared');

create temp table t_rcp_acc as select * from public.post_receipt('Client One', 300, 'Cash', 'advance for next order');
select pg_temp.eq((select unapplied_sar from t_rcp_acc), 300, 'pure advance');
select pg_temp.expect_error($$select public.post_customer_refund('Client One', 400, '1030')$$, 'only SAR 300', 'refund capped at credit');
select pg_temp.expect_error($$select public.post_customer_refund('Client One', 100, '2010')$$, 'cash or bank', 'refund from 10xx only');
select public.post_customer_refund('Client One', 300, '1030', 'Bank Transfer', 'RF-1');
select pg_temp.eq(coalesce((select credit_balance_sar from public.customer_credit_balances where lower(client_name) = lower('Client One')), 0), 0, 'refunded');
select pg_temp.eq(pg_temp.bal('2050'), 0, '2050 back to zero');

-- ---------- 6. One-invoice receipt (existing screen) still works and still caps ----------
create temp table t_rcp_one as select * from public.post_customer_receipt((select id from t_inv3), 9999, 'Bank Transfer');
select pg_temp.eq((select amount_sar from t_rcp_one), 114.85, 'single-invoice receipt capped at open balance');
select pg_temp.expect((select payment_status from public.invoices where id = (select id from t_inv3)) = 'paid', 'invoice 3 paid');

-- ---------- 7. Commission follows collections after credit notes ----------
select pg_temp.expect((select status from public.commission_ledger where invoice_id = (select id from t_inv3)) = 'ready_for_payout', 'commission ready on invoice 3');
select pg_temp.eq((select total_eligible_commission_sar from public.commission_ledger where invoice_id = (select id from t_inv1)),
                  public._r2((375 - 93.75 - 46.875) * 10 / 100), 'commission reduced by both credit notes');

-- ---------- 8. Roles ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.expect_error($$select public.post_receipt('Client One', 1, 'Cash')$$, 'cannot do this', 'sales cannot take receipts');
select pg_temp.expect((select count(*) from public.customer_credit_ledger) = 0, 'sales cannot read the credit ledger');
select pg_temp.expect(array_length(public.invoice_credited_qty((select id from t_inv1)), 1) = 1, 'salesperson sees credited qty on own invoice');
select pg_temp.expect(public.invoice_credited_qty('inv-2') is null, 'but not on someone else''s');
select pg_temp.as_user(:'fin');
select pg_temp.expect_error($$insert into public.customer_credit_ledger (client_name, kind, amount_sar) values ('x','opening',1)$$, 'permission denied', 'ledger is read-only to the browser');

-- ---------- 9. Integrity ----------
reset role;
select pg_temp.expect((select sum(debit) = sum(credit) from public.gl_journal_lines), 'whole ledger balances');
-- AR in the GL = sum of invoice open balances (the legacy overpayment shows as a negative open balance)
select pg_temp.eq(pg_temp.bal('1100'),
  (select public._r2(sum(grand_total_sar - paid_amount_sar - credited_amount_sar)) from public.invoices
    where id in (select id from public.invoices where invoice_number like 'INV-%')), 'GL AR = sum of open balances');
select pg_temp.eq((select sum(amount_sar) from public.receipt_allocations where invoice_id = (select id from t_inv3)), 1150.00, 'allocations = invoice 3 total');

select pg_temp.expect(not exists (
  select 1 from public.invoices i
  where i.invoice_number like 'INV-____-%'
    and i.paid_amount_sar <> coalesce((select sum(amount_sar) from public.receipt_allocations a where a.invoice_id = i.id), 0)), 'every invoice: paid = sum of allocations');

set role authenticated;
select pg_temp.as_user(:'fin');
select pg_temp.expect((select count(*) from public.invoice_payment_mismatches) = 2, 'the two hand-seeded invoices are reported as mismatches');
reset role;

select 'CREDIT OK' as result;
