-- =====================================================================
-- 0008_reporting.sql — reports computed in the database. Closes T1 (with the app's paged
-- loading), part of T2/T3.
-- ---------------------------------------------------------------------
-- Run AFTER 0004 (needs gl_journal_lines). Idempotent; one transaction.
--
-- Functions (Finance / CEO / Admin; AR/AP aging also Sales Manager):
--   gl_account_activity(from, to)   per account: period debits/credits and cumulative to `to`
--   trial_balance(as_of)            debit / credit balance per account, totals must agree
--   profit_and_loss(from, to)       revenue, COGS (50xx), operating expenses, net profit
--   balance_sheet(as_of)            assets, liabilities, equity incl. current-year profit
--   ar_aging(as_of), ap_aging(as_of) open documents in 0-30 / 31-60 / 61-90 / 90+ day buckets
--   gl_integrity_issues()           anything that would make the reports wrong
-- All work from gl_journal_lines, so they read every row, however many there are.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Indexes the reports and the app's ordered, paged loads use
-- ---------------------------------------------------------------------
create index if not exists idx_gl_lines_entry_date      on public.gl_journal_lines (entry_date);
create index if not exists idx_gl_entries_status_date   on public.gl_journal_entries (status, entry_date);
create index if not exists idx_gl_entries_source        on public.gl_journal_entries (source_module, source_doc_number);
create index if not exists idx_gl_entries_list          on public.gl_journal_entries (entry_date desc, created_at desc, id);
create index if not exists idx_invoices_list            on public.invoices (issued_at desc, id);
create index if not exists idx_invoices_client          on public.invoices (lower(trim(client_name)));
create index if not exists idx_invoices_open            on public.invoices (payment_status) where payment_status <> 'paid';
create index if not exists idx_receipts_list            on public.customer_receipts (received_at desc, id);
create index if not exists idx_receipts_client          on public.customer_receipts (lower(trim(client_name)));
create index if not exists idx_so_list                  on public.sales_orders (created_at desc, id);
create index if not exists idx_dn_list                  on public.delivery_notes (delivered_at desc, id);
create index if not exists idx_po_list                  on public.purchase_orders (created_at desc, id);
create index if not exists idx_po_status                on public.purchase_orders (status);
create index if not exists idx_spay_list                on public.supplier_payments (payment_date desc, id);
create index if not exists idx_cn_list                  on public.credit_notes (issued_at desc, id);
create index if not exists idx_comm_list                on public.commission_ledger (updated_at desc, id);
create index if not exists idx_exp_list                 on public.expense_vouchers (expense_date desc, id);
create index if not exists idx_inquiries_list           on public.inquiries (updated_at desc, id);
create index if not exists idx_inquiries_salesman       on public.inquiries ((data->>'salesmanId'));

-- ---------------------------------------------------------------------
-- Core: per-account activity. Void journals are excluded (as the app's Finance screens do).
-- p_from null = from the beginning; p_to null = up to today and beyond.
-- ---------------------------------------------------------------------
create or replace function public.gl_account_activity(p_from date default null, p_to date default null)
returns table (account_code text, account_name_en text, account_name_ar text, account_type text, normal_balance text,
               period_dr numeric, period_cr numeric, cum_dr numeric, cum_cr numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public._require_role('admin','ceo','finance');
  return query
  with lines as (
    select l.account_code, l.debit, l.credit, l.entry_date
    from public.gl_journal_lines l
    join public.gl_journal_entries e on e.id = l.entry_id
    where coalesce(e.status, 'posted') <> 'void'
      and (p_to is null or l.entry_date <= p_to)
  ), agg as (
    select l.account_code,
           sum(case when p_from is null or l.entry_date >= p_from then l.debit else 0 end) as pdr,
           sum(case when p_from is null or l.entry_date >= p_from then l.credit else 0 end) as pcr,
           sum(l.debit) as cdr, sum(l.credit) as ccr
    from lines l group by l.account_code
  )
  select a.account_code, a.account_name_en, a.account_name_ar, a.account_type, a.normal_balance,
         coalesce(g.pdr, 0)::numeric(18,2), coalesce(g.pcr, 0)::numeric(18,2), coalesce(g.cdr, 0)::numeric(18,2), coalesce(g.ccr, 0)::numeric(18,2)
  from public.gl_accounts a
  left join agg g on g.account_code = a.account_code
  order by a.account_code;
end $$;

create or replace function public.trial_balance(p_as_of date default null)
returns table (account_code text, account_name_en text, account_type text, debit_balance numeric, credit_balance numeric)
language sql stable security definer set search_path = public as $$
  select account_code, account_name_en, account_type,
         greatest(cum_dr - cum_cr, 0)::numeric(18,2), greatest(cum_cr - cum_dr, 0)::numeric(18,2)
  from public.gl_account_activity(null, p_as_of)
  where cum_dr <> 0 or cum_cr <> 0
  order by account_code
$$;

-- Same classification as FinancialStatementsView: revenue = Revenue accounts (4090 nets negative),
-- COGS = Expense accounts starting 50, operating expenses = other Expense accounts.
create or replace function public.profit_and_loss(p_from date default null, p_to date default null)
returns table (section text, account_code text, account_name_en text, amount numeric)
language sql stable security definer set search_path = public as $$
  with a as (select * from public.gl_account_activity(p_from, p_to)),
  rows as (
    select 'revenue' as section, account_code, account_name_en, (period_cr - period_dr) as amount from a where account_type = 'Revenue'
    union all
    select 'cogs', account_code, account_name_en, (period_dr - period_cr) from a where account_type = 'Expense' and account_code like '50%'
    union all
    select 'opex', account_code, account_name_en, (period_dr - period_cr) from a where account_type = 'Expense' and account_code not like '50%'
  )
  select section, account_code, account_name_en, amount::numeric(18,2) from rows where amount <> 0
  union all
  select 'total_revenue', null, 'Net revenue', coalesce(sum(amount) filter (where section = 'revenue'), 0)::numeric(18,2) from rows
  union all
  select 'gross_profit', null, 'Gross profit',
         (coalesce(sum(amount) filter (where section = 'revenue'), 0) - coalesce(sum(amount) filter (where section = 'cogs'), 0))::numeric(18,2) from rows
  union all
  select 'net_profit', null, 'Net profit',
         (coalesce(sum(amount) filter (where section = 'revenue'), 0) - coalesce(sum(amount) filter (where section in ('cogs','opex')), 0))::numeric(18,2) from rows
$$;

-- Assets / liabilities / equity as of a date; revenue and expense balances are shown as current earnings
create or replace function public.balance_sheet(p_as_of date default null)
returns table (section text, account_code text, account_name_en text, amount numeric)
language sql stable security definer set search_path = public as $$
  with a as (select * from public.gl_account_activity(null, p_as_of)),
  rows as (
    select case when account_code < '1400' then 'current_assets' else 'non_current_assets' end as section,
           account_code, account_name_en, (cum_dr - cum_cr) as amount from a where account_type = 'Asset'
    union all select 'liabilities', account_code, account_name_en, (cum_cr - cum_dr) from a where account_type = 'Liability'
    union all select 'equity', account_code, account_name_en, (cum_cr - cum_dr) from a where account_type = 'Equity'
    union all select 'equity', null, 'Current earnings (not yet closed)',
                     coalesce(sum(cum_cr - cum_dr) filter (where account_type in ('Revenue','Expense')), 0) from a
  )
  select section, account_code, account_name_en, amount::numeric(18,2) from rows where amount <> 0
  union all select 'total_assets', null, 'Total assets', coalesce(sum(amount) filter (where section like '%assets'), 0)::numeric(18,2) from rows
  union all select 'total_liabilities_equity', null, 'Total liabilities and equity',
                   coalesce(sum(amount) filter (where section in ('liabilities','equity')), 0)::numeric(18,2) from rows
$$;

-- AR: open balance (0006 rule) by days since issue
create or replace function public.ar_aging(p_as_of date default null)
returns table (invoice_id text, invoice_number text, client_name text, issued_on date, days_old integer, bucket text,
               grand_total_sar numeric, settled_sar numeric, open_sar numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public._require_role('admin','ceo','finance','manager');
  return query
  select i.id, i.invoice_number, i.client_name, public.riyadh_date(i.issued_at),
         (coalesce(p_as_of, public._riyadh_today()) - public.riyadh_date(i.issued_at))::int as d,
         case when coalesce(p_as_of, public._riyadh_today()) - public.riyadh_date(i.issued_at) <= 30 then '0-30'
              when coalesce(p_as_of, public._riyadh_today()) - public.riyadh_date(i.issued_at) <= 60 then '31-60'
              when coalesce(p_as_of, public._riyadh_today()) - public.riyadh_date(i.issued_at) <= 90 then '61-90' else '90+' end,
         i.grand_total_sar, public._r2(i.paid_amount_sar + coalesce(i.credited_amount_sar, 0)),
         public._r2(i.grand_total_sar - i.paid_amount_sar - coalesce(i.credited_amount_sar, 0))
  from public.invoices i
  where public.riyadh_date(i.issued_at) <= coalesce(p_as_of, public._riyadh_today())
    and i.grand_total_sar - i.paid_amount_sar - coalesce(i.credited_amount_sar, 0) > 0.009
  order by d desc, i.invoice_number;
end $$;

-- AP: billed / open POs, amounts in SAR at the booked rate, by days since billing (or PO date)
create or replace function public.ap_aging(p_as_of date default null)
returns table (po_id text, po_number text, supplier_name text, billed_on date, days_old integer, bucket text,
               total_sar numeric, paid_sar numeric, open_sar numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public._require_role('admin','ceo','finance','manager');
  return query
  with p as (
    select po.*, public.riyadh_date(coalesce(po.billed_at, po.created_at)) as d0,
           public._r2(coalesce(po.total_amount_fx, 0) * coalesce(nullif(po.fx_rate, 0), 1)) as tot,
           public._r2(coalesce(po.paid_amount_fx, 0) * coalesce(nullif(po.fx_rate, 0), 1)) as paid
    from public.purchase_orders po
    where coalesce(po.total_amount_fx, 0) - coalesce(po.paid_amount_fx, 0) > 0.009
  )
  select p.id, p.po_number, p.supplier_name, p.d0, (coalesce(p_as_of, public._riyadh_today()) - p.d0)::int,
         case when coalesce(p_as_of, public._riyadh_today()) - p.d0 <= 30 then '0-30'
              when coalesce(p_as_of, public._riyadh_today()) - p.d0 <= 60 then '31-60'
              when coalesce(p_as_of, public._riyadh_today()) - p.d0 <= 90 then '61-90' else '90+' end,
         p.tot, p.paid, public._r2(p.tot - p.paid)
  from p where p.d0 <= coalesce(p_as_of, public._riyadh_today())
  order by 5 desc, p.po_number;
end $$;

-- Anything that would make line-based reports disagree with the journals
create or replace function public.gl_integrity_issues()
returns table (issue text, entry_id text, voucher_number text, detail text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public._require_role('admin','ceo','finance');
  return query
  select 'journal without lines', e.id, e.voucher_number, format('header SAR %s', e.total_debit_sar)
  from public.gl_journal_entries e
  where not exists (select 1 from public.gl_journal_lines l where l.entry_id = e.id)
  union all
  select 'lines do not balance', e.id, e.voucher_number, format('Dr %s / Cr %s', s.dr, s.cr)
  from public.gl_journal_entries e
  join (select entry_id, sum(debit) dr, sum(credit) cr from public.gl_journal_lines group by entry_id) s on s.entry_id = e.id
  where s.dr <> s.cr
  union all
  select 'header differs from lines', e.id, e.voucher_number, format('header %s vs lines %s', e.total_debit_sar, s.dr)
  from public.gl_journal_entries e
  join (select entry_id, sum(debit) dr from public.gl_journal_lines group by entry_id) s on s.entry_id = e.id
  where public._r2(e.total_debit_sar) <> s.dr;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.gl_account_activity(date, date)', 'public.trial_balance(date)', 'public.profit_and_loss(date, date)',
                           'public.balance_sheet(date)', 'public.ar_aging(date)', 'public.ap_aging(date)', 'public.gl_integrity_issues()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
