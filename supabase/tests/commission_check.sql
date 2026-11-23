-- =====================================================================
-- commission_check.sql — proves 0007. LOCAL TEST DATABASE ONLY.
-- Order: stub -> 0001 -> rls_check (seed) -> 0002 -> 0003 -> 0004 -> 0006
--        -> (this file, part=pre: puts a balance on 5280) -> 0007 -> this file (part=check)
-- Prints "COMMISSION OK".
-- =====================================================================
\if :{?part}
\else
  \set part check
\endif
select :'part' = 'pre' as is_pre \gset

\if :is_pre
-- an old-app style journal on the account being retired
insert into public.gl_journal_entries (id, voucher_number, entry_date, lines, total_debit_sar, total_credit_sar, status, source_module)
values ('jv-5280', 'JV-5280', current_date, '[{"account_code":"5280","debit":40},{"account_code":"1020","credit":40}]', 40, 40, 'posted', null);
\else

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
create or replace function pg_temp.comm() returns public.commission_ledger language sql as $$
  select * from public.commission_ledger where invoice_number = (select invoice_number from public.invoices where landed_cost_sar = 3750) limit 1
$$;
grant execute on all functions in schema pg_temp to authenticated;

\set fin   '00000000-0000-0000-0000-0000000000f1'
\set mgr   '00000000-0000-0000-0000-0000000000b1'
\set proc  '00000000-0000-0000-0000-0000000000d1'
\set sales '00000000-0000-0000-0000-0000000000c1'
\set sales2 '00000000-0000-0000-0000-0000000000c2'

-- ---------- 5280 retired ----------
select pg_temp.eq(pg_temp.bal('5280'), 0, '5280 balance moved out');
select pg_temp.eq(pg_temp.bal('5140'), 40, '... into 5140');
select pg_temp.expect((select not is_active from public.gl_accounts where account_code = '5280'), '5280 inactive');

update public.inquiries set data = data || '{"commissionPct": 10, "division": "MEP"}' where id = 'INQ-1';

set role authenticated;
select pg_temp.as_user(:'fin');
select pg_temp.expect_error($$select public.post_journal('MANUAL', current_date, 'x', '[{"account_code":"5280","debit":1},{"account_code":"1020","credit":1}]')$$, 'inactive', 'cannot post to retired 5280');

-- ---------- Invoice 100 x 46.875 ----------
select pg_temp.as_user(:'mgr');
create temp table t_so as select * from public.post_sales_order('INQ-1');
select pg_temp.as_user(:'proc');
create temp table t_dn as select * from public.post_delivery_note((select id from t_so), '{"b1": 100}');
select pg_temp.as_user(:'fin');
create temp table t_inv as select * from public.post_invoice((select id from t_dn));
select pg_temp.eq((select grand_total_sar from t_inv), 5390.63, 'invoice total');
select pg_temp.eq((pg_temp.comm()).total_eligible_commission_sar, 93.75, 'eligible 10% of 937.50 profit');
select pg_temp.eq(pg_temp.bal('2300'), 0, 'nothing owed before collection');

-- ---------- 50% receipt: half the commission is expensed and owed ----------
select public.post_customer_receipt((select id from t_inv), 2695.32, 'Bank Transfer');
select pg_temp.eq((pg_temp.comm()).unlocked_commission_sar, 46.88, 'half unlocked');
select pg_temp.eq(pg_temp.bal('5140'), 40 + 46.88, 'commission expense posted');
select pg_temp.eq(pg_temp.bal('2300'), -46.88, 'commission payable');
select pg_temp.expect((pg_temp.comm()).status = 'partially_unlocked', 'status partially unlocked');

-- ---------- Credit note 20 units (customer still owes more than the CN) ----------
select public.post_credit_note((select id from t_inv), '[20]', 'Return', 'RETURN');
select pg_temp.eq((pg_temp.comm()).total_eligible_commission_sar, 75.00, 'eligible reduced to 10% of 750');
select pg_temp.eq((pg_temp.comm()).unlocked_commission_sar, 46.88, '62.5% of 75 still unlocked');
select pg_temp.eq(pg_temp.bal('2300'), -46.88, 'no change in payable');

-- ---------- Pay what is payable now ----------
select pg_temp.expect_error(format($$select public.post_commission_payout(%L, array[%L], '2010')$$, :'sales', (pg_temp.comm()).id), 'neither', 'pay only from 10xx or 2200');
select pg_temp.expect_error(format($$select public.post_commission_payout(%L, array[%L], '1020')$$, :'sales2', (pg_temp.comm()).id), 'another salesperson', 'lines must belong to the salesperson');
create temp table t_pay1 as select * from public.post_commission_payout(:'sales', array[(pg_temp.comm()).id], '1020', 'TT-C1');
select pg_temp.eq((select total_sar from t_pay1), 46.88, 'payout amount');
select pg_temp.expect((select journal_voucher_number from t_pay1) is not null and (select payout_number from t_pay1) like 'CPO-%', 'payout numbered and journalled');
select pg_temp.eq(pg_temp.bal('2300'), 0, 'payable cleared after payout');
select pg_temp.expect_error(format($$select public.post_commission_payout(%L, array[%L], '1020')$$, :'sales', (pg_temp.comm()).id), 'Nothing payable', 'no double payout');

-- ---------- Full collection, rest of the commission, paid via payroll ----------
select public.post_customer_receipt((select id from t_inv), 99999, 'Bank Transfer');
select pg_temp.eq((pg_temp.comm()).unlocked_commission_sar, 75.00, 'fully unlocked');
select pg_temp.expect((pg_temp.comm()).status = 'ready_for_payout', 'ready for payout');
select pg_temp.eq(pg_temp.bal('2300'), -28.12, 'remaining payable');
select public.post_commission_payout(:'sales', array[(pg_temp.comm()).id], '2200', 'Nov payroll');
select pg_temp.eq(pg_temp.bal('2300'), 0, '2300 ends at zero');
select pg_temp.eq(pg_temp.bal('2200'), -28.12, 'owed through payroll (2200)');
select pg_temp.eq(pg_temp.bal('5140'), 40 + 75, 'expense = commission earned');
select pg_temp.expect((pg_temp.comm()).status = 'paid', 'status paid');

-- ---------- Clawback after payout ----------
select public.post_credit_note((select id from t_inv), '[10]', 'Late return', 'RETURN');
select pg_temp.eq((pg_temp.comm()).unlocked_commission_sar, 65.63, 'clawed back to 10% of 656.25');
select pg_temp.expect((pg_temp.comm()).status = 'overpaid', 'status overpaid');
select pg_temp.eq(pg_temp.bal('2300'), 9.37, '2300 debit = owed back by the salesperson');
select pg_temp.eq(pg_temp.bal('5140'), 40 + 65.63, 'expense reduced');
select pg_temp.eq((select overpaid_sar from public.commission_statement where salesman_id = :'sales'), 9.37, 'statement shows the overpayment');

-- ---------- Visibility ----------
select pg_temp.as_user(:'sales');
select pg_temp.eq((select count(*) from public.commission_payouts), 2, 'salesperson sees own payouts');
select pg_temp.eq((select count(*) from public.commission_payout_lines), 2, '... and their lines');
select pg_temp.eq((select paid_sar from public.commission_statement), 75.00, 'own statement');
select pg_temp.expect_error(format($$select public.post_commission_payout(%L, array[%L], '1020')$$, :'sales', (pg_temp.comm()).id), 'cannot do this', 'sales cannot pay themselves');
select pg_temp.as_user(:'sales2');
select pg_temp.eq((select count(*) from public.commission_payouts), 0, 'other salesperson sees none');
select pg_temp.expect(not exists (select 1 from public.commission_statement where salesman_id is distinct from :'sales2'), '... and only their own statement row');
select pg_temp.as_user(:'mgr');
select pg_temp.expect((select count(*) from public.commission_statement) >= 1, 'manager sees statements');

-- ---------- Payouts are immutable ----------
select pg_temp.as_user(:'fin');
select pg_temp.expect_error($$update public.commission_payouts set total_sar = 1$$, 'permission denied', 'browser cannot edit payouts');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_error($$delete from public.commission_payouts$$, 'cannot', 'payout cannot be deleted even by a definer path');
select pg_temp.as_user(null);

select pg_temp.expect((select sum(debit) = sum(credit) from public.gl_journal_lines), 'ledger balances');
select 'COMMISSION OK' as result;
\endif
