-- =====================================================================
-- reporting_check.sql — proves 0008 at volume. LOCAL TEST DATABASE ONLY.
-- Order: stub -> 0001 -> rls_check (seed) -> 0002 -> 0003 -> 0004 -> 0006 -> 0007 -> 0008
--        -> posting_check.sql -> this file
-- Seeds 5,000 invoices + 4,000 receipts (~22,000 journal lines, far past Supabase's 1,000-row
-- response cap) and checks every report against the raw ledger. Prints "REPORTING OK".
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
grant execute on all functions in schema pg_temp to authenticated;

-- ---------- bulk seed (maintenance session: no user, guards bypassed, audited) ----------
select pg_temp.as_user(null);
insert into public.invoices (id, invoice_number, client_name, subtotal_sar, vat_sar, grand_total_sar, paid_amount_sar, issued_at, payment_status)
select 'bulk-inv-' || g, 'BULK-' || g, 'Bulk Client ' || (g % 50), 1000 + g % 97, public._r2((1000 + g % 97) * 0.15),
       public._r2((1000 + g % 97) * 1.15), case when g % 5 = 0 then 0 else public._r2((1000 + g % 97) * 1.15) end,
       now() - make_interval(days => g % 200), case when g % 5 = 0 then 'unpaid' else 'paid' end
from generate_series(1, 5000) g;
insert into public.gl_journal_entries (id, voucher_number, entry_date, source_module, source_doc_number, status, lines, total_debit_sar, total_credit_sar)
select 'bulk-jv-inv-' || i.invoice_number, 'BJ-I-' || i.invoice_number, public.riyadh_date(i.issued_at), 'INVOICE', i.invoice_number, 'posted',
       jsonb_build_array(
         jsonb_build_object('account_code', '1100', 'debit', i.grand_total_sar),
         jsonb_build_object('account_code', '4010', 'credit', i.subtotal_sar),
         jsonb_build_object('account_code', '2100', 'credit', i.vat_sar),
         jsonb_build_object('account_code', '5010', 'debit', public._r2(i.subtotal_sar * 0.8)),
         jsonb_build_object('account_code', '1200', 'credit', public._r2(i.subtotal_sar * 0.8))),
       i.grand_total_sar + public._r2(i.subtotal_sar * 0.8), i.grand_total_sar + public._r2(i.subtotal_sar * 0.8)
from public.invoices i where i.id like 'bulk-inv-%';
insert into public.gl_journal_entries (id, voucher_number, entry_date, source_module, source_doc_number, status, lines, total_debit_sar, total_credit_sar)
select 'bulk-jv-rcp-' || i.invoice_number, 'BJ-R-' || i.invoice_number, public.riyadh_date(i.issued_at), 'RECEIPT', 'R-' || i.invoice_number, 'posted',
       jsonb_build_array(jsonb_build_object('account_code', '1020', 'debit', i.paid_amount_sar),
                         jsonb_build_object('account_code', '1100', 'credit', i.paid_amount_sar)),
       i.paid_amount_sar, i.paid_amount_sar
from public.invoices i where i.id like 'bulk-inv-%' and i.paid_amount_sar > 0;

select pg_temp.expect((select count(*) from public.gl_journal_lines) > 20000, 'over 20,000 journal lines (way past the 1,000-row cap)');

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');

-- ---------- trial balance = raw ledger ----------
select pg_temp.eq((select sum(debit_balance) from public.trial_balance()), (select sum(credit_balance) from public.trial_balance()), 'trial balance agrees');
select pg_temp.eq((select sum(cum_dr) from public.gl_account_activity()), (select sum(debit) from public.gl_journal_lines), 'activity reads every line');
select pg_temp.eq((select debit_balance - credit_balance from public.trial_balance() where account_code = '1100'),
                  (select sum(debit - credit) from public.gl_journal_lines where account_code = '1100'), 'AR balance = raw lines');

-- ---------- P&L ----------
select pg_temp.eq((select amount from public.profit_and_loss() where section = 'total_revenue'),
                  (select sum(credit - debit) from public.gl_journal_lines l join public.gl_accounts a using (account_code) where a.account_type = 'Revenue'),
                  'net revenue = revenue lines');
select pg_temp.eq((select amount from public.profit_and_loss() where section = 'net_profit'),
                  (select sum(case when a.account_type = 'Revenue' then credit - debit else -(debit - credit) end)
                   from public.gl_journal_lines l join public.gl_accounts a using (account_code) where a.account_type in ('Revenue','Expense')),
                  'net profit = revenue - expenses');
-- period filter: only last 30 days of bulk revenue
select pg_temp.eq((select amount from public.profit_and_loss(current_date - 30, current_date) where section = 'total_revenue'),
                  (select sum(credit - debit) from public.gl_journal_lines l join public.gl_accounts a using (account_code)
                    where a.account_type = 'Revenue' and l.entry_date between current_date - 30 and current_date),
                  'period P&L');

-- ---------- balance sheet balances ----------
select pg_temp.eq((select amount from public.balance_sheet() where section = 'total_assets'),
                  (select amount from public.balance_sheet() where section = 'total_liabilities_equity'), 'balance sheet balances');
select pg_temp.eq((select amount from public.balance_sheet(current_date - 100) where section = 'total_assets'),
                  (select amount from public.balance_sheet(current_date - 100) where section = 'total_liabilities_equity'), 'balance sheet balances at a past date');

-- ---------- aging = open invoices ----------
select pg_temp.eq((select count(*) from public.ar_aging() where invoice_number like 'BULK-%'), 1000, '1,000 open bulk invoices (every 5th)');
select pg_temp.eq((select sum(open_sar) from public.ar_aging()),
                  (select public._r2(sum(grand_total_sar - paid_amount_sar - credited_amount_sar)) from public.invoices
                    where grand_total_sar - paid_amount_sar - credited_amount_sar > 0.009), 'AR aging total = open balances');
select pg_temp.expect((select count(distinct bucket) from public.ar_aging()) >= 4, 'aging buckets used (4 by issue date before 0013, up to 5 by due date after)');

-- ---------- integrity ----------
select pg_temp.expect(not exists (select 1 from public.gl_integrity_issues() where entry_id <> 'jv-1'), 'no integrity issues (except the seeded line-less jv-1)');

-- ---------- speed (local Postgres; Supabase is similar) ----------
do $$
declare t0 timestamptz := clock_timestamp(); n int;
begin
  select count(*) into n from public.trial_balance();
  perform * from public.profit_and_loss();
  perform * from public.balance_sheet();
  perform * from public.ar_aging();
  if clock_timestamp() - t0 > interval '3 seconds' then
    raise exception 'CHECK FAILED: reports took %', clock_timestamp() - t0;
  end if;
  raise notice 'reports over 22k lines took %', clock_timestamp() - t0;
end $$;

-- ---------- roles ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.expect_error($$select * from public.trial_balance()$$, 'cannot do this', 'sales cannot run the trial balance');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.expect((select count(*) from public.ar_aging()) > 0, 'manager can run AR aging');
select pg_temp.expect_error($$select * from public.profit_and_loss()$$, 'cannot do this', 'manager cannot run the P&L');

reset role;
select 'REPORTING OK' as result;
