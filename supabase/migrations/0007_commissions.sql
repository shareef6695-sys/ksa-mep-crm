-- =====================================================================
-- 0007_commissions.sql — commission is expensed, owed and paid out in the books.
-- Closes gaps A8, A9 (and F14).
-- ---------------------------------------------------------------------
-- Run AFTER 0006. Idempotent; one transaction.
--
-- 1. 5280 "Sales Commission Expense" is retired: any balance is moved to 5140 by
--    one reclass journal (posted journals are never edited) and 5280 is made inactive.
-- 2. Accrual follows collection (same rule as before: commission unlocks as the
--    customer pays). Every time the unlocked amount moves, the difference is posted
--    Dr 5140 Commission expense / Cr 2300 Commission payable (or reversed when a
--    credit note claws it back). commission_ledger.expensed_sar tracks what is in the GL.
--    Existing unlocked commission is caught up by one journal.
-- 3. Payout run: Finance picks a salesperson's rows with money payable, approves, and
--    post_commission_payout posts Dr 2300 / Cr bank or cash (10xx) or 2200 (via payroll).
--    commission_payouts + commission_payout_lines keep the history.
-- 4. Salespeople see only their own ledger and payouts; managers see all.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Columns, tables
-- ---------------------------------------------------------------------

-- Prompt 15 fix: views built on these tables' row types (jsonb_populate_record(null::table, ...)) must be dropped before
-- ALTER TABLE on newer Postgres; they are re-created further down in this migration and re-granted at the end.
drop view if exists public.commission_ledger_v;
alter table public.commission_ledger add column if not exists expensed_sar numeric(18,2) not null default 0;

alter table public.commission_ledger drop constraint if exists commission_ledger_status_check;
alter table public.commission_ledger add constraint commission_ledger_status_check check (status in
  ('awaiting_collection','partially_unlocked','ready_for_payout','reversed_by_credit_note','paid','overpaid')) not valid;

create table if not exists public.commission_payouts (
  id              text primary key default gen_random_uuid()::text,
  payout_number   text not null,
  salesman_id     text,
  salesman_name   text,
  payout_date     date not null default (now() at time zone 'Asia/Riyadh')::date,
  period_end      date,
  total_sar       numeric(18,2) not null check (total_sar > 0),
  paid_from_account_code text not null,
  reference       text default '',
  journal_voucher_number text,
  approved_by     text,
  created_by_uid  uuid default auth.uid(),
  created_at      timestamptz not null default now()
);
create table if not exists public.commission_payout_lines (
  id                   bigserial primary key,
  payout_id            text not null references public.commission_payouts(id),
  commission_id        text not null references public.commission_ledger(id),
  invoice_number       text,
  amount_sar           numeric(18,2) not null check (amount_sar > 0)
);
create index if not exists idx_comm_payout_lines_comm on public.commission_payout_lines (commission_id);

do $$
declare t text;
begin
  foreach t in array array['commission_payouts','commission_payout_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop trigger if exists trg_audit_row on public.%I', t);
    execute format('create trigger trg_audit_row after insert or update or delete on public.%I for each row execute function public.audit_row(''id'')', t);
  end loop;
end $$;
drop policy if exists commission_payouts_read on public.commission_payouts;
create policy commission_payouts_read on public.commission_payouts for select to authenticated
  using (public.has_role('admin','ceo','finance','manager') or (public.is_sales() and salesman_id = public.uid_text()));
drop policy if exists commission_payout_lines_read on public.commission_payout_lines;
create policy commission_payout_lines_read on public.commission_payout_lines for select to authenticated
  using (exists (select 1 from public.commission_payouts p where p.id = payout_id
                 and (public.has_role('admin','ceo','finance','manager') or (public.is_sales() and p.salesman_id = public.uid_text()))));
drop trigger if exists trg_guard_posted_row on public.commission_payouts;
create trigger trg_guard_posted_row before insert or update or delete on public.commission_payouts
  for each row execute function public.guard_posted_row('payout_date', 'no_change', 'payout_number');
drop trigger if exists trg_guard_posted_row on public.commission_payout_lines;
create trigger trg_guard_posted_row before update or delete on public.commission_payout_lines
  for each row execute function public.guard_posted_row('', 'no_change', 'id');

-- commission_ledger_v picks up expensed_sar
create or replace view public.commission_ledger_v with (security_barrier = true) as
select (jsonb_populate_record(null::public.commission_ledger,
          case when public.can_view_cost() then to_jsonb(t) else public.redact_costs(to_jsonb(t)) end)).*
from public.commission_ledger t
where public.has_role('admin','ceo','finance','manager') or (public.is_sales() and t.salesman_id = public.uid_text());
revoke all on public.commission_ledger_v from anon, public;
grant select on public.commission_ledger_v to authenticated;

-- One row per salesperson: earned, unlocked (expensed), paid, payable now
create or replace view public.commission_statement with (security_barrier = true) as
select c.salesman_id, min(c.salesman_name) as salesman_name,
       public._r2(sum(c.total_eligible_commission_sar)) as eligible_sar,
       public._r2(sum(c.unlocked_commission_sar)) as unlocked_sar,
       public._r2(sum(c.paid_out_sar)) as paid_sar,
       public._r2(sum(greatest(0, c.unlocked_commission_sar - c.paid_out_sar))) as payable_sar,
       public._r2(sum(greatest(0, c.paid_out_sar - c.unlocked_commission_sar))) as overpaid_sar
from public.commission_ledger c
where public.has_role('admin','ceo','finance','manager') or (public.is_sales() and c.salesman_id = public.uid_text())
group by c.salesman_id;
revoke all on public.commission_statement from anon, public;
grant select on public.commission_statement to authenticated;

-- ---------------------------------------------------------------------
-- 1. Retire 5280 (move its balance to 5140; never edit posted journals)
-- ---------------------------------------------------------------------
do $$
declare v_bal numeric;
begin
  perform set_config('request.jwt.claims', '', true);
  select coalesce(sum(debit - credit), 0) into v_bal from public.gl_journal_lines where account_code = '5280';
  if v_bal <> 0 and not exists (select 1 from public.gl_journal_entries where source_module = 'COA_RECLASS' and source_doc_number = '5280-TO-5140') then
    perform public._gl_post(public._riyadh_today(), 'COA_RECLASS', '5280-TO-5140',
      'Reclass: 5280 Sales Commission Expense merged into 5140 (migration 0007)',
      jsonb_build_array(
        jsonb_build_object('account_code', '5140', 'debit', greatest(v_bal, 0), 'credit', greatest(-v_bal, 0), 'memo', 'From 5280'),
        jsonb_build_object('account_code', '5280', 'debit', greatest(-v_bal, 0), 'credit', greatest(v_bal, 0), 'memo', 'To 5140')));
  end if;
  update public.gl_accounts set is_active = false, account_name_en = 'Sales Commission Expense (retired — use 5140)', updated_at = now()
   where account_code = '5280' and is_active;
  update public.gl_accounts set account_name_en = 'Sales Commission Expense', updated_at = now()
   where account_code = '5140' and account_name_en <> 'Sales Commission Expense';
end $$;

-- ---------------------------------------------------------------------
-- 2. Accrual: post the change in unlocked commission for one invoice
-- ---------------------------------------------------------------------
create or replace function public._commission_accrue(p_invoice_id text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.commission_ledger; v_delta numeric;
begin
  for c in select * from public.commission_ledger where invoice_id = p_invoice_id for update loop
    v_delta := public._r2(c.unlocked_commission_sar - c.expensed_sar);
    if v_delta = 0 then continue; end if;
    perform public._gl_post(public._riyadh_today(), 'COMMISSION_ACCRUAL', c.invoice_number,
      format('%s commission %s - %s (%s)', case when v_delta > 0 then 'Unlocked' else 'Clawed back' end,
             coalesce(c.salesman_name, ''), c.invoice_number, c.client_name),
      jsonb_build_array(
        jsonb_build_object('account_code', '5140', 'debit', greatest(v_delta, 0), 'credit', greatest(-v_delta, 0), 'memo', coalesce(c.salesman_name, '')),
        jsonb_build_object('account_code', '2300', 'debit', greatest(-v_delta, 0), 'credit', greatest(v_delta, 0), 'memo', c.invoice_number)));
    update public.commission_ledger set expensed_sar = unlocked_commission_sar where id = c.id;
  end loop;
end $$;

create or replace function public._commission_status(p_eligible numeric, p_unlocked numeric, p_paid numeric, p_ratio numeric, p_reversed boolean)
returns text language sql immutable as $$
  select case
    when p_paid > p_unlocked + 0.01 then 'overpaid'
    when p_eligible <= 0 or p_reversed then 'reversed_by_credit_note'
    when p_paid >= p_eligible - 0.01 and p_ratio >= 0.999 then 'paid'
    when p_ratio >= 0.999 then 'ready_for_payout'
    when p_ratio > 0 then 'partially_unlocked'
    else 'awaiting_collection' end
$$;

-- _invoice_sync (from 0006) now also keeps the GL in step with the unlocked commission
create or replace function public._invoice_sync(p_invoice_id text) returns void
language plpgsql security definer set search_path = public as $$
declare inv public.invoices; v_net numeric; v_ratio numeric; v_status text;
begin
  select * into inv from public.invoices where id = p_invoice_id;
  v_net := inv.grand_total_sar - coalesce(inv.credited_amount_sar, 0);
  v_status := case when inv.grand_total_sar - inv.paid_amount_sar - inv.credited_amount_sar <= 0.01 then 'paid'
                   when inv.paid_amount_sar > 0 then 'partial' else 'unpaid' end;
  update public.invoices set payment_status = v_status where id = inv.id and payment_status is distinct from v_status;

  v_ratio := case when v_net > 0.01 then least(1, greatest(0, coalesce(inv.paid_amount_sar, 0)) / v_net) else 1 end;
  update public.commission_ledger
     set unlocked_commission_sar = public._r2(total_eligible_commission_sar * v_ratio),
         status = public._commission_status(total_eligible_commission_sar, public._r2(total_eligible_commission_sar * v_ratio),
                                            paid_out_sar, v_ratio, status = 'reversed_by_credit_note' and total_eligible_commission_sar <= 0),
         updated_at = now()
   where invoice_id = inv.id;
  perform public._commission_accrue(inv.id);
end $$;

-- Catch-up: commission already unlocked before this migration goes into the GL as one journal
do $$
declare v_total numeric;
begin
  perform set_config('request.jwt.claims', '', true);
  select public._r2(sum(unlocked_commission_sar - expensed_sar)) into v_total from public.commission_ledger where unlocked_commission_sar <> expensed_sar;
  if coalesce(v_total, 0) <> 0 then
    perform public._gl_post(public._riyadh_today(), 'COMMISSION_ACCRUAL', 'CATCH-UP-0007',
      'Commission accrual catch-up: unlocked commission before migration 0007',
      jsonb_build_array(
        jsonb_build_object('account_code', '5140', 'debit', greatest(v_total, 0), 'credit', greatest(-v_total, 0), 'memo', 'Catch-up'),
        jsonb_build_object('account_code', '2300', 'debit', greatest(-v_total, 0), 'credit', greatest(v_total, 0), 'memo', 'Catch-up')));
    update public.commission_ledger set expensed_sar = unlocked_commission_sar where unlocked_commission_sar <> expensed_sar;
  end if;
  -- commission rows already paid out (outside the system) keep their status
  update public.commission_ledger
     set status = public._commission_status(total_eligible_commission_sar, unlocked_commission_sar, paid_out_sar,
                    case when total_eligible_commission_sar > 0 then unlocked_commission_sar / total_eligible_commission_sar else 1 end,
                    status = 'reversed_by_credit_note')
   where status is distinct from public._commission_status(total_eligible_commission_sar, unlocked_commission_sar, paid_out_sar,
                    case when total_eligible_commission_sar > 0 then unlocked_commission_sar / total_eligible_commission_sar else 1 end,
                    status = 'reversed_by_credit_note');
end $$;

-- ---------------------------------------------------------------------
-- 3. Payout run
--    p_commission_ids: rows to pay (each pays its unlocked-but-unpaid amount)
--    p_pay_from: a 10xx cash/bank account, or 2200 when paid through payroll
-- ---------------------------------------------------------------------
create or replace function public.post_commission_payout(p_salesman_id text, p_commission_ids text[], p_pay_from text,
                                                         p_reference text default '', p_date date default null, p_period_end date default null)
returns public.commission_payouts
language plpgsql security definer set search_path = public as $$
declare
  v_date date := coalesce(p_date, public._riyadh_today()); v_total numeric; v_num text; v_name text; v_bad text;
  v_payout public.commission_payouts; v_jv public.gl_journal_entries;
begin
  perform public._require_role('admin','ceo','finance');
  if coalesce(cardinality(p_commission_ids), 0) = 0 then raise exception 'Select at least one commission line to pay.'; end if;
  if not (p_pay_from = '2200' or exists (select 1 from public.gl_accounts where account_code = p_pay_from and account_type = 'Asset'
                                          and account_code like '10%' and coalesce(is_active, true))) then
    raise exception 'Pay commission from a cash or bank account (10xx) or 2200 Accrued Expenses (payroll). % is neither.', p_pay_from;
  end if;

  -- lock and validate the selected rows
  perform 1 from public.commission_ledger where id = any(p_commission_ids) for update;
  if (select count(*) from public.commission_ledger where id = any(p_commission_ids)) <> cardinality(p_commission_ids) then
    raise exception 'Some selected commission lines were not found.';
  end if;
  select string_agg(coalesce(invoice_number, id), ', ') into v_bad
  from public.commission_ledger where id = any(p_commission_ids) and salesman_id is distinct from p_salesman_id;
  if v_bad is not null then raise exception 'These lines belong to another salesperson: %.', v_bad; end if;
  select string_agg(format('%s (unlocked SAR %s, paid SAR %s)', coalesce(invoice_number, id), unlocked_commission_sar, paid_out_sar), ', ') into v_bad
  from public.commission_ledger where id = any(p_commission_ids) and public._r2(unlocked_commission_sar - paid_out_sar) <= 0;
  if v_bad is not null then raise exception 'Nothing payable on: %.', v_bad; end if;

  select public._r2(sum(unlocked_commission_sar - paid_out_sar)), min(salesman_name) into v_total, v_name
  from public.commission_ledger where id = any(p_commission_ids);

  v_num := public.next_doc_number('COMM_PAYOUT');
  v_jv := public._gl_post(v_date, 'COMMISSION_PAYOUT', v_num, format('Commission payout %s - %s', v_num, coalesce(v_name, '')),
    jsonb_build_array(
      jsonb_build_object('account_code', '2300', 'debit', v_total, 'memo', coalesce(v_name, '')),
      jsonb_build_object('account_code', p_pay_from, 'credit', v_total, 'memo', case when p_pay_from = '2200' then 'Via payroll' else coalesce(p_reference, '') end)));

  insert into public.commission_payouts (payout_number, salesman_id, salesman_name, payout_date, period_end, total_sar,
                                         paid_from_account_code, reference, journal_voucher_number, approved_by)
  values (v_num, p_salesman_id, v_name, v_date, p_period_end, v_total, p_pay_from, coalesce(p_reference, ''), v_jv.voucher_number, public._actor_name())
  returning * into v_payout;

  insert into public.commission_payout_lines (payout_id, commission_id, invoice_number, amount_sar)
  select v_payout.id, id, invoice_number, public._r2(unlocked_commission_sar - paid_out_sar)
  from public.commission_ledger where id = any(p_commission_ids);

  update public.commission_ledger
     set status = public._commission_status(total_eligible_commission_sar, unlocked_commission_sar, unlocked_commission_sar,
                    case when total_eligible_commission_sar > 0 then unlocked_commission_sar / total_eligible_commission_sar else 1 end, false),
         paid_out_sar = unlocked_commission_sar,
         updated_at = now()
   where id = any(p_commission_ids);
  return v_payout;
end $$;

-- ---------------------------------------------------------------------
-- 4. Privileges
-- ---------------------------------------------------------------------
revoke all on function public._commission_accrue(text) from public, anon, authenticated;
revoke all on function public._invoice_sync(text) from public, anon, authenticated;
revoke all on function public.post_commission_payout(text, text[], text, text, date, date) from public, anon;
grant execute on function public.post_commission_payout(text, text[], text, text, date, date) to authenticated;

insert into public.document_number_ranges (doc_type, label, prefix, include_year, padding, next_number, reset_annually)
values ('COMM_PAYOUT', 'Commission Payout', 'CPO', true, 5, 1, true)
on conflict (doc_type) do nothing;

notify pgrst, 'reload schema';


-- Prompt 15 fix: grants on the re-created views
do $$
declare v text;
begin
  foreach v in array array['commission_ledger_v'] loop
    execute format('revoke all on public.%I from anon, public', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end $$;

commit;
