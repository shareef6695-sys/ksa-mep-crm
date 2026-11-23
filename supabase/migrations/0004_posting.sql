-- =====================================================================
-- 0004_posting.sql — atomic posting functions. Closes A1, A2, A11, A12, T4, T5.
-- ---------------------------------------------------------------------
-- Run AFTER 0003. Idempotent; one transaction. Safe with the CURRENT app:
-- it only adds things. Deploy the new app next, then run 0005_lock_writes.sql,
-- which removes direct table writes from the browser.
--
-- What it adds
--  1. gl_journal_lines: one row per debit/credit, FK to gl_accounts, filled
--     automatically from gl_journal_entries.lines (old app and new functions alike).
--     Every journal must balance to the halala or it is rejected.
--  2. Account 5990 Rounding differences (drift up to SAR 0.05 is posted there).
--  3. Server-generated ids (uuid text) for new documents.
--  4. Foreign keys between documents, added NOT VALID: new rows are checked,
--     existing rows are not. See view public.orphan_references for old rows that
--     point nowhere; fix them, then VALIDATE (statements at the bottom of 0005).
--  5. One function per business event. Each checks the caller's role, computes
--     totals / VAT / numbers itself, and writes the document, its journal and
--     side effects in a single transaction. Accounting rules are unchanged from
--     the app (COGS at quoted cost, bills through 1200, etc. — later prompts).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Small helpers
-- ---------------------------------------------------------------------
create or replace function public._require_role(variadic roles text[]) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role(variadic roles) then
    raise exception 'Your role (%) cannot do this. Allowed: %.', coalesce(public.app_role(), 'none'), array_to_string(roles, ', ')
      using errcode = '42501';
  end if;
end $$;

create or replace function public._actor_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select full_name from public.team_profiles where id::text = auth.uid()::text), 'System')
$$;

create or replace function public._riyadh_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Riyadh')::date $$;

create or replace function public._r2(n numeric) returns numeric
language sql immutable as $$ select round(coalesce(n, 0), 2) $$;

create or replace function public._num(j jsonb) returns numeric
language sql immutable as $$
  select case when j is null or jsonb_typeof(j) = 'null' then 0
              when jsonb_typeof(j) = 'number' then (j #>> '{}')::numeric
              when jsonb_typeof(j) = 'string' and (j #>> '{}') ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$' then trim(j #>> '{}')::numeric
              else 0 end
$$;

create or replace function public._company() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.app_settings where key = 'company_profile'), '{}'::jsonb)
    || jsonb_build_object(
         'nameEn', coalesce((select value->>'nameEn' from public.app_settings where key = 'company_profile'), 'Horizon Business Solutions Est.'),
         'vatNumber', coalesce((select value->>'vatNumber' from public.app_settings where key = 'company_profile'), '300000000000003'))
$$;

-- ZATCA Phase 1 TLV QR (tags 1-5), identical to erpEngine.generateZatcaQrBase64
create or replace function public._zatca_qr(p_seller text, p_vat text, p_ts text, p_total numeric, p_vat_amt numeric) returns text
language plpgsql immutable as $$
declare
  vals text[] := array[p_seller, p_vat, p_ts, to_char(round(p_total, 2), 'FM999999999999990.00'), to_char(round(p_vat_amt, 2), 'FM999999999999990.00')];
  out bytea := ''::bytea;
  b bytea;
begin
  for i in 1..5 loop
    b := convert_to(coalesce(vals[i], ''), 'UTF8');
    out := out || decode(lpad(to_hex(i), 2, '0') || lpad(to_hex(length(b) % 256), 2, '0'), 'hex') || b;
  end loop;
  return replace(encode(out, 'base64'), E'\n', '');
end $$;

create or replace function public._iso_now() returns text
language sql stable as $$ select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

-- ---------------------------------------------------------------------
-- 1. Chart of accounts: rounding account
-- ---------------------------------------------------------------------
insert into public.gl_accounts (account_code, account_name_en, account_name_ar, account_type, normal_balance, is_system)
values ('5990', 'Rounding differences', 'فروقات التقريب', 'Expense', 'Debit', true)
on conflict (account_code) do nothing;

-- ---------------------------------------------------------------------
-- 2. Journal lines table, filled from gl_journal_entries.lines
-- ---------------------------------------------------------------------
create table if not exists public.gl_journal_lines (
  id            bigserial primary key,
  entry_id      text not null references public.gl_journal_entries(id) on delete restrict,
  line_no       integer not null,
  account_code  text not null references public.gl_accounts(account_code),
  debit         numeric(18,2) not null default 0 check (debit >= 0),
  credit        numeric(18,2) not null default 0 check (credit >= 0),
  memo          text default '',
  entry_date    date not null,
  source_module text,
  created_at    timestamptz not null default now(),
  constraint gl_journal_lines_one_side check (not (debit > 0 and credit > 0)),
  constraint gl_journal_lines_unique unique (entry_id, line_no)
);
create index if not exists idx_gl_lines_account_date on public.gl_journal_lines (account_code, entry_date);
create index if not exists idx_gl_lines_entry       on public.gl_journal_lines (entry_id);

alter table public.gl_journal_lines enable row level security;
revoke all on public.gl_journal_lines from anon, authenticated;
grant select on public.gl_journal_lines to authenticated;
drop policy if exists gl_journal_lines_read on public.gl_journal_lines;
create policy gl_journal_lines_read on public.gl_journal_lines for select to authenticated using (public.has_role('admin','ceo','finance'));

-- Expand an entry's jsonb lines into gl_journal_lines and check it balances
create or replace function public.gl_entry_expand_lines() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_dr numeric; v_cr numeric; v_bad text;
begin
  select string_agg(distinct l->>'account_code', ', ') into v_bad
  from jsonb_array_elements(coalesce(new.lines, '[]'::jsonb)) l
  where not exists (select 1 from public.gl_accounts a where a.account_code = l->>'account_code');
  if v_bad is not null then
    raise exception 'Journal % uses account(s) not in the Chart of Accounts: %', coalesce(new.voucher_number, new.id), v_bad using errcode = '23503';
  end if;

  insert into public.gl_journal_lines (entry_id, line_no, account_code, debit, credit, memo, entry_date, source_module)
  select new.id, o::int, l->>'account_code', public._r2(public._num(l->'debit')), public._r2(public._num(l->'credit')),
         coalesce(l->>'memo', ''), coalesce(new.entry_date, public._riyadh_today()), new.source_module
  from jsonb_array_elements(coalesce(new.lines, '[]'::jsonb)) with ordinality as x(l, o)
  where public._num(l->'debit') <> 0 or public._num(l->'credit') <> 0;

  select coalesce(sum(debit), 0), coalesce(sum(credit), 0) into v_dr, v_cr from public.gl_journal_lines where entry_id = new.id;
  if v_dr = 0 or v_dr <> v_cr then
    raise exception 'Journal % does not balance: debits SAR % vs credits SAR %.', coalesce(new.voucher_number, new.id), v_dr, v_cr using errcode = '23514';
  end if;
  return null;
end $$;
drop trigger if exists trg_gl_entry_expand_lines on public.gl_journal_entries;
create trigger trg_gl_entry_expand_lines after insert on public.gl_journal_entries
  for each row execute function public.gl_entry_expand_lines();

-- Backfill existing journals (only lines whose account exists; problems are listed in the view below)
insert into public.gl_journal_lines (entry_id, line_no, account_code, debit, credit, memo, entry_date, source_module)
select e.id, o::int, l->>'account_code', public._r2(public._num(l->'debit')), public._r2(public._num(l->'credit')),
       coalesce(l->>'memo', ''), coalesce(e.entry_date, (e.created_at at time zone 'Asia/Riyadh')::date), e.source_module
from public.gl_journal_entries e
cross join lateral jsonb_array_elements(case when jsonb_typeof(e.lines) = 'array' then e.lines else '[]'::jsonb end) with ordinality as x(l, o)
where (public._num(l->'debit') <> 0 or public._num(l->'credit') <> 0)
  and exists (select 1 from public.gl_accounts a where a.account_code = l->>'account_code')
  and not exists (select 1 from public.gl_journal_lines gl where gl.entry_id = e.id)
on conflict (entry_id, line_no) do nothing;

create or replace view public.gl_backfill_issues with (security_barrier = true) as
select e.id, e.voucher_number, e.entry_date, e.total_debit_sar, e.total_credit_sar,
       coalesce(sum(gl.debit), 0) as lines_debit, coalesce(sum(gl.credit), 0) as lines_credit,
       case when count(gl.id) = 0 then 'no lines copied (unknown account?)'
            when coalesce(sum(gl.debit), 0) <> coalesce(sum(gl.credit), 0) then 'unbalanced'
            else 'differs from header totals' end as issue
from public.gl_journal_entries e
left join public.gl_journal_lines gl on gl.entry_id = e.id
where public.has_role('admin','ceo','finance')
group by e.id
having count(gl.id) = 0 or coalesce(sum(gl.debit), 0) <> coalesce(sum(gl.credit), 0)
    or coalesce(sum(gl.debit), 0) <> public._r2(e.total_debit_sar);
revoke all on public.gl_backfill_issues from anon, public;
grant select on public.gl_backfill_issues to authenticated;

-- ---------------------------------------------------------------------
-- 3. Server-generated ids
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['sales_orders','delivery_notes','invoices','customer_receipts','credit_notes','commission_ledger',
                           'purchase_orders','supplier_payments','gl_journal_entries','expense_vouchers','fixed_assets'] loop
    execute format('alter table public.%I alter column id set default gen_random_uuid()::text', t);
  end loop;
end $$;

alter table public.supplier_payments add column if not exists bank_account_code text default '1020';

-- ---------------------------------------------------------------------
-- 4. Foreign keys (NOT VALID: enforced for new rows only)
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select * from (values
      ('delivery_notes',    'so_id',               'sales_orders',     'id', 'fk_dn_so'),
      ('invoices',          'so_id',               'sales_orders',     'id', 'fk_inv_so'),
      ('invoices',          'dn_id',               'delivery_notes',   'id', 'fk_inv_dn'),
      ('customer_receipts', 'invoice_id',          'invoices',         'id', 'fk_rcp_inv'),
      ('credit_notes',      'original_invoice_id', 'invoices',         'id', 'fk_cn_inv'),
      ('commission_ledger', 'invoice_id',          'invoices',         'id', 'fk_comm_inv'),
      ('purchase_orders',   'so_id',               'sales_orders',     'id', 'fk_po_so'),
      ('supplier_payments', 'po_id',               'purchase_orders',  'id', 'fk_spay_po'),
      ('expense_vouchers',  'expense_account_code','gl_accounts',      'account_code', 'fk_exp_acc'),
      ('fixed_assets',      'category_account_code','gl_accounts',     'account_code', 'fk_fa_acc')
    ) as t(tbl, col, ref_tbl, ref_col, name)
  loop
    if not exists (select 1 from pg_constraint where conname = r.name) then
      execute format('alter table public.%I add constraint %I foreign key (%I) references public.%I(%I) not valid',
                     r.tbl, r.name, r.col, r.ref_tbl, r.ref_col);
    end if;
  end loop;
end $$;

create or replace view public.orphan_references with (security_barrier = true) as
select * from (
  select 'delivery_notes'::text as table_name, d.id as row_id, d.dn_number as doc_number, 'so_id'::text as column_name, d.so_id as missing_value
    from public.delivery_notes d where d.so_id is not null and not exists (select 1 from public.sales_orders s where s.id = d.so_id)
  union all select 'invoices', i.id, i.invoice_number, 'so_id', i.so_id
    from public.invoices i where i.so_id is not null and not exists (select 1 from public.sales_orders s where s.id = i.so_id)
  union all select 'invoices', i.id, i.invoice_number, 'dn_id', i.dn_id
    from public.invoices i where i.dn_id is not null and not exists (select 1 from public.delivery_notes d where d.id = i.dn_id)
  union all select 'customer_receipts', r.id, r.receipt_number, 'invoice_id', r.invoice_id
    from public.customer_receipts r where r.invoice_id is not null and not exists (select 1 from public.invoices i where i.id = r.invoice_id)
  union all select 'credit_notes', c.id, c.credit_note_number, 'original_invoice_id', c.original_invoice_id
    from public.credit_notes c where c.original_invoice_id is not null and not exists (select 1 from public.invoices i where i.id = c.original_invoice_id)
  union all select 'commission_ledger', c.id, c.invoice_number, 'invoice_id', c.invoice_id
    from public.commission_ledger c where c.invoice_id is not null and not exists (select 1 from public.invoices i where i.id = c.invoice_id)
  union all select 'purchase_orders', p.id, p.po_number, 'so_id', p.so_id
    from public.purchase_orders p where p.so_id is not null and not exists (select 1 from public.sales_orders s where s.id = p.so_id)
  union all select 'supplier_payments', s.id, s.voucher_number, 'po_id', s.po_id
    from public.supplier_payments s where s.po_id is not null and not exists (select 1 from public.purchase_orders p where p.id = s.po_id)
  union all select 'expense_vouchers', e.id, e.voucher_number, 'expense_account_code', e.expense_account_code
    from public.expense_vouchers e where not exists (select 1 from public.gl_accounts a where a.account_code = e.expense_account_code)
  union all select 'fixed_assets', f.id, f.asset_code, 'category_account_code', f.category_account_code
    from public.fixed_assets f where not exists (select 1 from public.gl_accounts a where a.account_code = f.category_account_code)
) o where public.has_role('admin','ceo','finance');
revoke all on public.orphan_references from anon, public;
grant select on public.orphan_references to authenticated;

-- ---------------------------------------------------------------------
-- 5. Internal journal poster (not callable from the browser)
--    p_lines: [{account_code, debit, credit, memo}]
-- ---------------------------------------------------------------------
create or replace function public._gl_post(p_entry_date date, p_source_module text, p_source_doc text,
                                           p_description text, p_lines jsonb, p_reference text default null)
returns public.gl_journal_entries
language plpgsql security definer set search_path = public as $$
declare
  v_lines jsonb;
  v_dr numeric; v_cr numeric; v_diff numeric;
  v_entry public.gl_journal_entries;
  v_bad text;
begin
  -- clean, round, name each line from the live chart of accounts
  select coalesce(jsonb_agg(jsonb_build_object(
           'account_code', l->>'account_code',
           'account_name', (l->>'account_code') || ' - ' || coalesce(a.account_name_en, l->>'account_code'),
           'debit',  public._r2(public._num(l->'debit')),
           'credit', public._r2(public._num(l->'credit')),
           'memo',   coalesce(l->>'memo', '')) order by o), '[]'::jsonb)
    into v_lines
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality as x(l, o)
  left join public.gl_accounts a on a.account_code = l->>'account_code'
  where public._r2(public._num(l->'debit')) <> 0 or public._r2(public._num(l->'credit')) <> 0;

  select string_agg(distinct l->>'account_code', ', ') into v_bad
  from jsonb_array_elements(v_lines) l
  left join public.gl_accounts a on a.account_code = l->>'account_code'
  where a.account_code is null or not coalesce(a.is_active, true)
     or public._num(l->'debit') < 0 or public._num(l->'credit') < 0;
  if v_bad is not null then
    raise exception 'Journal lines use unknown, inactive or negative accounts: %', v_bad using errcode = '23514';
  end if;
  if jsonb_array_length(v_lines) < 2 then
    raise exception 'A journal needs at least two non-zero lines.' using errcode = '23514';
  end if;

  select sum(public._num(l->'debit')), sum(public._num(l->'credit')) into v_dr, v_cr from jsonb_array_elements(v_lines) l;
  v_diff := v_dr - v_cr;
  if v_diff <> 0 then
    if abs(v_diff) > 0.05 then
      raise exception 'Journal does not balance: debits SAR % vs credits SAR %.', v_dr, v_cr using errcode = '23514';
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_code', '5990', 'account_name', '5990 - Rounding differences',
      'debit', case when v_diff < 0 then abs(v_diff) else 0 end,
      'credit', case when v_diff > 0 then v_diff else 0 end,
      'memo', 'Rounding'));
    v_dr := greatest(v_dr, v_cr);
  end if;

  insert into public.gl_journal_entries (voucher_number, entry_date, reference, description, lines,
                                         total_debit_sar, total_credit_sar, source_module, source_doc_number, status, posted_by)
  values (public.next_doc_number('JOURNAL'), coalesce(p_entry_date, public._riyadh_today()), coalesce(p_reference, p_source_doc, ''),
          p_description, v_lines, v_dr, v_dr, p_source_module, coalesce(p_source_doc, ''), 'posted', public._actor_name())
  returning * into v_entry;
  return v_entry;
end $$;

-- ---------------------------------------------------------------------
-- 6. SALES
-- ---------------------------------------------------------------------
-- 6.1 Quote -> Sales Order
create or replace function public.post_sales_order(p_inquiry_id text) returns public.sales_orders
language plpgsql security definer set search_path = public as $$
declare
  d jsonb; m numeric; v_cost numeric := 0; v_sell numeric; v_factor numeric; v_items jsonb;
  v_so public.sales_orders;
begin
  perform public._require_role('admin','ceo','manager');
  select data into d from public.inquiries where id = p_inquiry_id for update;
  if d is null then raise exception 'Quote % not found.', p_inquiry_id; end if;
  if d->>'stage' = 'won' or exists (select 1 from public.sales_orders where inquiry_id = p_inquiry_id) then
    raise exception 'Quote % has already been converted to a Sales Order.', p_inquiry_id;
  end if;
  m := public._num(d->'marginPercent');

  select coalesce(sum(public._num(b->'qty') * public._num(b->'buyUnitCost') * public.fx_rate(b->>'buyCurrency')), 0)
    into v_cost from jsonb_array_elements(coalesce(d->'boqItems', '[]'::jsonb)) b;
  v_sell := case when m >= 100 then v_cost else v_cost / (1 - m / 100) end;
  v_factor := case when v_cost > 0 then v_sell / v_cost else 1.25 end;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b->>'id', 'desc', b->>'desc',
           'orderedQty', case when public._num(b->'qty') = 0 then 1 else public._num(b->'qty') end,
           'deliveredQty', 0, 'invoicedQty', 0, 'unit', coalesce(b->>'unit', 'PCS'),
           'unitCostSar', u.c,
           'unitSellSar', case when u.c > 0 then u.c * v_factor else 0 end) order by o), '[]'::jsonb)
    into v_items
  from jsonb_array_elements(coalesce(d->'boqItems', '[]'::jsonb)) with ordinality as x(b, o),
       lateral (select public._num(b->'buyUnitCost') * public.fx_rate(b->>'buyCurrency') as c) u;

  insert into public.sales_orders (so_number, division, inquiry_id, client_name, client_vat, contact_person, phone, email,
                                   salesman_id, salesman_name, commission_pct, status, items, subtotal_sar, vat_sar, grand_total_sar, total_cost_sar)
  values (public.next_doc_number('SO'), coalesce(d->>'division', 'MEP'), p_inquiry_id, d->>'clientName', coalesce(d->>'clientVat', ''),
          d->>'contactPerson', d->>'phone', coalesce(d->>'email', ''), nullif(d->>'salesmanId', ''), d->>'assignedSalesName',
          public._num(d->'commissionPct'), 'open', v_items, public._r2(v_sell), public._r2(v_sell * 0.15), public._r2(v_sell * 1.15), public._r2(v_cost))
  returning * into v_so;

  update public.inquiries set data = jsonb_set(data, '{stage}', '"won"'), updated_at = now(), updated_by = public._actor_name()
  where id = p_inquiry_id;
  return v_so;
end $$;

-- 6.2 Delivery note. p_qtys: {"<SO line id>": qty, ...}
create or replace function public.post_delivery_note(p_so_id text, p_qtys jsonb, p_notes text default '') returns public.delivery_notes
language plpgsql security definer set search_path = public as $$
declare
  so public.sales_orders; v_items jsonb; v_lines jsonb; v_all boolean; v_dn public.delivery_notes;
begin
  perform public._require_role('admin','ceo','procurement');
  select * into so from public.sales_orders where id = p_so_id for update;
  if so.id is null then raise exception 'Sales Order % not found.', p_so_id; end if;

  with x as (
    select it, o,
           greatest(0, least(public._num(p_qtys->(it->>'id')), public._num(it->'orderedQty') - public._num(it->'deliveredQty'))) as ship
    from jsonb_array_elements(coalesce(so.items, '[]'::jsonb)) with ordinality as t(it, o)
  )
  select
    coalesce(jsonb_agg(it || jsonb_build_object('deliveredQty', public._num(it->'deliveredQty') + ship) order by o), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('id', it->>'id', 'desc', it->>'desc', 'qty', ship, 'unit', it->>'unit',
                                          'unitSellSar', it->'unitSellSar', 'unitCostSar', it->'unitCostSar') order by o)
             filter (where ship > 0), '[]'::jsonb),
    coalesce(bool_and(public._num(it->'deliveredQty') + ship >= public._num(it->'orderedQty')), true)
  into v_items, v_lines, v_all
  from x;

  if jsonb_array_length(v_lines) = 0 then
    raise exception 'Nothing to deliver: enter a quantity up to the remaining amount on at least one line.';
  end if;

  insert into public.delivery_notes (dn_number, division, so_id, so_number, client_name, delivery_type, items, delivered_by, notes)
  values (public.next_doc_number('DN'), coalesce(so.division, 'MEP'), so.id, so.so_number, so.client_name,
          case when v_all then 'full' else 'partial' end, v_lines, public._actor_name(), coalesce(p_notes, ''))
  returning * into v_dn;

  update public.sales_orders set items = v_items, status = case when v_all then 'delivered' else 'partially_delivered' end, updated_at = now()
  where id = so.id;
  return v_dn;
end $$;

-- 6.3 ZATCA invoice from a delivery note
create or replace function public.post_invoice(p_dn_id text) returns public.invoices
language plpgsql security definer set search_path = public as $$
declare
  dn public.delivery_notes; so public.sales_orders; c jsonb := public._company();
  v_sub numeric; v_cost numeric; v_vat numeric; v_grand numeric; v_num text; v_iso text := public._iso_now();
  v_inv public.invoices; v_profit numeric; v_pct numeric; v_elig numeric; v_it boolean;
begin
  perform public._require_role('admin','ceo','finance');
  select * into dn from public.delivery_notes where id = p_dn_id for update;
  if dn.id is null then raise exception 'Delivery note % not found.', p_dn_id; end if;
  if exists (select 1 from public.invoices where dn_id = p_dn_id) then
    raise exception 'Delivery note % has already been invoiced.', dn.dn_number;
  end if;
  select * into so from public.sales_orders where id = dn.so_id;

  select coalesce(sum(public._num(it->'qty') * public._num(it->'unitSellSar')), 0),
         coalesce(sum(public._num(it->'qty') * public._num(it->'unitCostSar')), 0)
    into v_sub, v_cost from jsonb_array_elements(coalesce(dn.items, '[]'::jsonb)) it;
  v_vat := v_sub * 0.15; v_grand := v_sub + v_vat;
  v_num := public.next_doc_number('INVOICE');
  v_it := coalesce(dn.division, 'MEP') = 'IT & ELV';

  insert into public.invoices (invoice_number, division, invoice_type, so_id, so_number, dn_id, client_name, client_vat,
                               salesman_id, salesman_name, commission_pct, items, subtotal_sar, vat_sar, grand_total_sar,
                               landed_cost_sar, paid_amount_sar, payment_status, zatca_status, qr_base64, locked, issued_at)
  values (v_num, coalesce(dn.division, 'MEP'), case when coalesce(so.client_vat, '') <> '' then 'standard' else 'simplified' end,
          dn.so_id, dn.so_number, dn.id, dn.client_name, coalesce(so.client_vat, ''),
          so.salesman_id, coalesce(so.salesman_name, 'Unassigned'), coalesce(so.commission_pct, 0), dn.items,
          public._r2(v_sub), public._r2(v_vat), public._r2(v_grand), public._r2(v_cost), 0, 'unpaid',
          case when coalesce((c->>'zatcaPhase2Connected')::boolean, false) then 'cleared' else 'phase1_qr_ready' end,
          public._zatca_qr(c->>'nameEn', c->>'vatNumber', v_iso, v_grand, v_vat), true, v_iso::timestamptz)
  returning * into v_inv;

  perform public._gl_post(public.riyadh_date(v_inv.issued_at), 'INVOICE', v_num,
    format('ZATCA Invoice %s - %s (%s)', v_num, dn.client_name, coalesce(dn.so_number, '')),
    jsonb_build_array(
      jsonb_build_object('account_code', '1100', 'debit', v_grand, 'memo', dn.client_name),
      jsonb_build_object('account_code', case when v_it then '4020' else '4010' end, 'credit', v_sub, 'memo', v_num),
      jsonb_build_object('account_code', '2100', 'credit', v_vat, 'memo', 'Output VAT 15%'),
      jsonb_build_object('account_code', '5010', 'debit', v_cost, 'memo', 'COGS ' || v_num),
      jsonb_build_object('account_code', '1200', 'credit', v_cost, 'memo', 'Stock relief ' || coalesce(dn.dn_number, ''))));

  v_profit := greatest(0, v_sub - v_cost);
  v_pct := coalesce(so.commission_pct, 0);
  v_elig := v_profit * v_pct / 100;
  if v_pct > 0 and v_elig > 0 then
    insert into public.commission_ledger (invoice_id, invoice_number, division, client_name, salesman_id, salesman_name, commission_pct,
                                          net_profit_sar, total_eligible_commission_sar, unlocked_commission_sar, paid_out_sar, status)
    values (v_inv.id, v_num, coalesce(dn.division, 'MEP'), dn.client_name, so.salesman_id, coalesce(so.salesman_name, 'Salesman'), v_pct,
            public._r2(v_profit), public._r2(v_elig), 0, 0, 'awaiting_collection');
  end if;
  return v_inv;
end $$;

-- 6.4 Customer receipt
create or replace function public.post_customer_receipt(p_invoice_id text, p_amount numeric, p_method text,
                                                        p_reference text default '', p_date date default null)
returns public.customer_receipts
language plpgsql security definer set search_path = public as $$
declare
  inv public.invoices; v_new_paid numeric; v_applied numeric; v_num text; v_rcp public.customer_receipts;
  v_cash text := case when p_method = 'Cash' then '1010' else '1020' end; v_ratio numeric; v_date date := coalesce(p_date, public._riyadh_today());
begin
  perform public._require_role('admin','ceo','finance');
  if coalesce(p_amount, 0) <= 0 then raise exception 'Receipt amount must be greater than zero.'; end if;
  select * into inv from public.invoices where id = p_invoice_id for update;
  if inv.id is null then raise exception 'Invoice % not found.', p_invoice_id; end if;

  v_new_paid := least(inv.grand_total_sar, coalesce(inv.paid_amount_sar, 0) + p_amount);
  v_applied := public._r2(v_new_paid - coalesce(inv.paid_amount_sar, 0));
  if v_applied <= 0 then raise exception 'Invoice % is already fully collected.', inv.invoice_number; end if;

  v_num := public.next_doc_number('RECEIPT');
  insert into public.customer_receipts (receipt_number, invoice_id, invoice_number, client_name, amount_sar, payment_method, reference_no, recorded_by, received_at)
  values (v_num, inv.id, inv.invoice_number, inv.client_name, v_applied, p_method, coalesce(p_reference, ''), public._actor_name(),
          case when p_date is null then now() else (p_date + time '12:00') at time zone 'Asia/Riyadh' end)
  returning * into v_rcp;

  perform public._gl_post(v_date, 'RECEIPT', v_num,
    format('Customer Receipt %s - %s vs %s', v_num, inv.client_name, inv.invoice_number),
    jsonb_build_array(
      jsonb_build_object('account_code', v_cash, 'debit', v_applied, 'memo', trim(coalesce(p_method, '') || ' ' || coalesce(p_reference, ''))),
      jsonb_build_object('account_code', '1100', 'credit', v_applied, 'memo', inv.client_name)));

  update public.invoices
     set paid_amount_sar = public._r2(v_new_paid),
         payment_status = case when v_new_paid >= inv.grand_total_sar - 0.01 then 'paid' else 'partial' end
   where id = inv.id;

  v_ratio := least(1, v_new_paid / nullif(inv.grand_total_sar, 0));
  update public.commission_ledger
     set unlocked_commission_sar = public._r2(total_eligible_commission_sar * coalesce(v_ratio, 0)),
         status = case when coalesce(v_ratio, 0) >= 0.999 then 'ready_for_payout' else 'partially_unlocked' end,
         updated_at = now()
   where invoice_id = inv.id;
  return v_rcp;
end $$;

-- 6.5 Credit note (rules as today; Prompt 6 changes them). p_return_qtys: [qty for invoice line 0, line 1, ...]
create or replace function public.post_credit_note(p_invoice_id text, p_return_qtys jsonb, p_reason text) returns public.credit_notes
language plpgsql security definer set search_path = public as $$
declare
  inv public.invoices; c jsonb := public._company(); v_lines jsonb; v_sub numeric; v_cost numeric; v_vat numeric; v_grand numeric;
  v_num text; v_iso text := public._iso_now(); v_cn public.credit_notes; v_rev numeric; v_paid numeric;
  comm public.commission_ledger; v_np numeric; v_elig numeric; v_ratio numeric; v_unl numeric;
begin
  perform public._require_role('admin','ceo','finance');
  select * into inv from public.invoices where id = p_invoice_id for update;
  if inv.id is null then raise exception 'Invoice % not found.', p_invoice_id; end if;

  with x as (
    select it, o, least(public._num(it->'qty'), greatest(0, public._num(p_return_qtys->((o - 1)::int)))) as q
    from jsonb_array_elements(coalesce(inv.items, '[]'::jsonb)) with ordinality as t(it, o)
  )
  select coalesce(jsonb_agg(jsonb_build_object('desc', it->>'desc', 'qty', q, 'unit', coalesce(it->>'unit', 'PCS'),
                                               'unitSellSar', public._num(it->'unitSellSar'), 'unitCostSar', public._num(it->'unitCostSar')) order by o)
                  filter (where q > 0), '[]'::jsonb),
         coalesce(sum(q * public._num(it->'unitSellSar')), 0), coalesce(sum(q * public._num(it->'unitCostSar')), 0)
    into v_lines, v_sub, v_cost from x;
  if jsonb_array_length(v_lines) = 0 or v_sub <= 0 then
    raise exception 'Enter a return quantity on at least one line.';
  end if;
  v_vat := v_sub * 0.15; v_grand := v_sub + v_vat;
  v_num := public.next_doc_number('CREDIT_NOTE');

  insert into public.credit_notes (credit_note_number, original_invoice_id, original_invoice_number, client_name, client_vat, reason, items,
                                   subtotal_sar, vat_sar, grand_total_sar, landed_cost_reversed_sar, qr_base64, issued_by, issued_at)
  values (v_num, inv.id, inv.invoice_number, inv.client_name, coalesce(inv.client_vat, ''), p_reason, v_lines,
          public._r2(v_sub), public._r2(v_vat), public._r2(v_grand), public._r2(v_cost),
          public._zatca_qr(c->>'nameEn', c->>'vatNumber', v_iso, v_grand, v_vat), public._actor_name(), v_iso::timestamptz)
  returning * into v_cn;

  perform public._gl_post(public.riyadh_date(v_cn.issued_at), 'CREDIT_NOTE', v_num,
    format('ZATCA Credit Note %s vs %s (%s)', v_num, inv.invoice_number, inv.client_name),
    jsonb_build_array(
      jsonb_build_object('account_code', '4090', 'debit', v_sub, 'memo', p_reason),
      jsonb_build_object('account_code', '2100', 'debit', v_vat, 'memo', 'VAT Reversal 15%'),
      jsonb_build_object('account_code', '1100', 'credit', v_grand, 'memo', inv.client_name),
      jsonb_build_object('account_code', '1200', 'debit', v_cost, 'memo', 'Stock Return Valuation'),
      jsonb_build_object('account_code', '5010', 'credit', v_cost, 'memo', 'COGS Reversal')));

  v_rev := greatest(0, inv.grand_total_sar - v_grand);
  v_paid := coalesce(inv.paid_amount_sar, 0);
  update public.invoices
     set grand_total_sar = public._r2(v_rev),
         payment_status = case when v_rev <= 0.01 or v_paid >= v_rev - 0.01 then 'paid' when v_paid > 0 then 'partial' else 'unpaid' end
   where id = inv.id;

  select * into comm from public.commission_ledger where invoice_id = inv.id limit 1;
  if comm.id is not null then
    v_np := greatest(0, comm.net_profit_sar - greatest(0, v_sub - v_cost));
    v_elig := public._r2(v_np * comm.commission_pct / 100);
    v_ratio := case when v_rev > 0 then least(1, v_paid / v_rev) else 0 end;
    v_unl := public._r2(v_elig * v_ratio);
    update public.commission_ledger
       set net_profit_sar = public._r2(v_np), total_eligible_commission_sar = v_elig, unlocked_commission_sar = v_unl,
           status = case when v_elig <= 0 then 'reversed_by_credit_note' when v_ratio >= 0.999 then 'ready_for_payout'
                         when v_unl > 0 then 'partially_unlocked' else 'awaiting_collection' end,
           updated_at = now()
     where id = comm.id;
  end if;
  return v_cn;
end $$;

-- ---------------------------------------------------------------------
-- 7. PURCHASING
-- ---------------------------------------------------------------------
-- 7.1 Purchase order. p: {so_id, supplier_name, supplier_vat, currency, fx_rate, landed_cost_sar, items:[{desc, qty, unitCostFx, is_stocked_item}]}
create or replace function public.post_purchase_order(p jsonb) returns public.purchase_orders
language plpgsql security definer set search_path = public as $$
declare
  v_fx numeric := nullif(public._num(p->'fx_rate'), 0); v_items jsonb; v_goods_fx numeric; v_goods numeric; v_landed numeric; v_vat numeric;
  so public.sales_orders; v_po public.purchase_orders;
begin
  perform public._require_role('admin','ceo','procurement');
  if coalesce(trim(p->>'supplier_name'), '') = '' then raise exception 'Supplier is required.'; end if;
  v_fx := coalesce(v_fx, public.fx_rate(p->>'currency'));
  select coalesce(jsonb_agg(jsonb_build_object('desc', i->>'desc',
                                               'qty', case when public._num(i->'qty') = 0 then 1 else public._num(i->'qty') end,
                                               'unitCostFx', public._num(i->'unitCostFx'),
                                               'is_stocked_item', coalesce((i->>'is_stocked_item')::boolean, false)) order by o), '[]'::jsonb)
    into v_items from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) with ordinality as x(i, o);
  if jsonb_array_length(v_items) = 0 then raise exception 'A purchase order needs at least one line.'; end if;
  select sum(public._num(i->'qty') * public._num(i->'unitCostFx')) into v_goods_fx from jsonb_array_elements(v_items) i;
  v_goods := v_goods_fx * v_fx;
  v_landed := public._num(p->'landed_cost_sar');
  v_vat := case when coalesce(trim(p->>'supplier_vat'), '') <> '' then (v_goods + v_landed) * 0.15 else 0 end;
  if nullif(p->>'so_id', '') is not null then select * into so from public.sales_orders where id = p->>'so_id'; end if;

  insert into public.purchase_orders (po_number, so_id, so_number, supplier_name, supplier_vat, currency, fx_rate, status, items,
                                      goods_total_fx, goods_total_sar, landed_cost_sar, supplier_vat_sar, total_amount_fx, total_landed_sar,
                                      input_vat_sar, is_ksa_vat_recoverable, paid_amount_fx, paid_amount_sar, payment_status, bill_status)
  values (public.next_doc_number('PO'), so.id, coalesce(so.so_number, ''), trim(p->>'supplier_name'), coalesce(p->>'supplier_vat', ''),
          coalesce(p->>'currency', 'SAR'), v_fx, 'po_issued', v_items,
          public._r2(v_goods_fx), public._r2(v_goods), public._r2(v_landed), public._r2(v_vat),
          public._r2((v_goods + v_landed + v_vat) / v_fx), public._r2(v_goods + v_landed), public._r2(v_vat), v_vat > 0, 0, 0, 'unpaid', 'unbilled')
  returning * into v_po;
  return v_po;
end $$;

-- 7.2 Goods receipt (status only, as today)
create or replace function public.post_goods_receipt(p_po_id text) returns public.purchase_orders
language plpgsql security definer set search_path = public as $$
declare v_po public.purchase_orders;
begin
  perform public._require_role('admin','ceo','procurement');
  update public.purchase_orders set status = 'grn_completed', updated_at = now()
   where id = p_po_id and status = 'po_issued' returning * into v_po;
  if v_po.id is null then raise exception 'Purchase order % is not waiting for goods receipt.', p_po_id; end if;
  return v_po;
end $$;

-- 7.3 Supplier bill
create or replace function public.post_supplier_bill(p_po_id text) returns public.purchase_orders
language plpgsql security definer set search_path = public as $$
declare po public.purchase_orders; v_goods numeric; v_landed numeric; v_vat numeric; v_total numeric; v_bill text; v_fx numeric;
begin
  perform public._require_role('admin','ceo','finance');
  select * into po from public.purchase_orders where id = p_po_id for update;
  if po.id is null then raise exception 'Purchase order % not found.', p_po_id; end if;
  if coalesce(po.bill_status, '') in ('posted','paid') or po.status in ('billed','paid') then
    raise exception 'Purchase order % has already been billed (%).', po.po_number, coalesce(po.bill_number, '');
  end if;
  if po.status <> 'grn_completed' then raise exception 'Record the goods receipt for % before posting the bill.', po.po_number; end if;

  v_goods := coalesce(po.goods_total_sar, 0); v_landed := coalesce(po.landed_cost_sar, 0); v_vat := coalesce(po.supplier_vat_sar, 0);
  v_total := v_goods + v_landed + v_vat; v_fx := coalesce(nullif(po.fx_rate, 0), 1);
  v_bill := public.next_doc_number('BILL');

  perform public._gl_post(public._riyadh_today(), 'SUPPLIER_BILL', v_bill,
    format('Supplier Bill %s - %s (%s)', v_bill, po.supplier_name, po.po_number),
    jsonb_build_array(
      jsonb_build_object('account_code', '1200', 'debit', v_goods + v_landed, 'memo', format('Goods %s @ %s + landed cost', po.currency, v_fx)),
      jsonb_build_object('account_code', '1150', 'debit', v_vat, 'memo', case when coalesce(po.supplier_vat, '') <> '' then 'Supplier VAT ' || po.supplier_vat else '' end),
      jsonb_build_object('account_code', '2010', 'credit', v_total, 'memo', po.supplier_name)));

  update public.purchase_orders
     set status = 'billed', bill_status = 'posted', bill_number = v_bill, billed_at = now(), updated_at = now(),
         total_amount_fx = case when coalesce(total_amount_fx, 0) > 0 then total_amount_fx else public._r2(v_total / v_fx) end
   where id = po.id returning * into po;
  return po;
end $$;

-- 7.4 Supplier payment (Finance chooses the bank / cash account)
create or replace function public.post_supplier_payment(p_po_id text, p_amount_fx numeric, p_settlement_rate numeric, p_method text,
                                                        p_reference text default '', p_date date default null,
                                                        p_bank_account text default '1020', p_notes text default '')
returns public.supplier_payments
language plpgsql security definer set search_path = public as $$
declare
  po public.purchase_orders; v_booked numeric; v_settle numeric; v_sar numeric; v_booked_sar numeric; v_var numeric;
  v_num text; v_pay public.supplier_payments; v_date date := coalesce(p_date, public._riyadh_today()); v_lines jsonb; v_paid_fx numeric;
begin
  perform public._require_role('admin','ceo','finance');
  if coalesce(p_amount_fx, 0) <= 0 then raise exception 'Payment amount must be greater than zero.'; end if;
  if not exists (select 1 from public.gl_accounts where account_code = p_bank_account and account_type = 'Asset'
                  and account_code like '10%' and coalesce(is_active, true)) then
    raise exception 'Pay from a cash or bank account (10xx). % is not one.', p_bank_account;
  end if;
  select * into po from public.purchase_orders where id = p_po_id for update;
  if po.id is null then raise exception 'Purchase order % not found.', p_po_id; end if;
  if p_amount_fx > coalesce(po.total_amount_fx, 0) - coalesce(po.paid_amount_fx, 0) + 0.01 then
    raise exception 'Payment of % % is more than the open balance of % % on %.', p_amount_fx, po.currency,
      public._r2(coalesce(po.total_amount_fx, 0) - coalesce(po.paid_amount_fx, 0)), po.currency, po.po_number;
  end if;

  v_booked := coalesce(nullif(po.fx_rate, 0), 1);
  v_settle := coalesce(nullif(p_settlement_rate, 0), v_booked);
  v_sar := public._r2(p_amount_fx * v_settle);
  v_booked_sar := public._r2(p_amount_fx * v_booked);
  v_var := v_sar - v_booked_sar;
  v_num := public.next_doc_number('SUPPLIER_PAY');

  v_lines := jsonb_build_array(
    jsonb_build_object('account_code', '2010', 'debit', v_booked_sar, 'memo', format('%s (%s)', po.po_number, po.supplier_name)),
    jsonb_build_object('account_code', p_bank_account, 'credit', v_sar, 'memo', trim(coalesce(p_method, '') || ' ' || coalesce(p_reference, ''))));
  if v_var > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '5130', 'debit', v_var, 'memo', 'Realized FX Loss on ' || po.currency)); end if;
  if v_var < 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '5130', 'credit', abs(v_var), 'memo', 'Realized FX Gain on ' || po.currency)); end if;

  insert into public.supplier_payments (voucher_number, po_id, po_number, supplier_name, currency, amount_fx, booked_fx_rate, settlement_fx_rate,
                                        amount_sar, fx_variance_sar, payment_method, bank_reference, payment_date, notes, recorded_by, bank_account_code)
  values (v_num, po.id, po.po_number, po.supplier_name, coalesce(po.currency, 'SAR'), p_amount_fx, v_booked, v_settle,
          v_sar, v_var, p_method, coalesce(p_reference, ''), v_date, coalesce(p_notes, ''), public._actor_name(), p_bank_account)
  returning * into v_pay;

  perform public._gl_post(v_date, 'SUPPLIER_PAY', v_num,
    format('Supplier Payment %s - %s (%s)', v_num, po.supplier_name, po.po_number), v_lines);

  v_paid_fx := public._r2(coalesce(po.paid_amount_fx, 0) + p_amount_fx);
  update public.purchase_orders
     set paid_amount_fx = v_paid_fx,
         paid_amount_sar = public._r2(coalesce(paid_amount_sar, 0) + v_sar),
         payment_status = case when v_paid_fx >= coalesce(total_amount_fx, 0) - 0.01 then 'paid' else 'partial' end,
         status = case when v_paid_fx >= coalesce(total_amount_fx, 0) - 0.01 then 'paid' else status end,
         updated_at = now()
   where id = po.id;
  return v_pay;
end $$;

-- ---------------------------------------------------------------------
-- 8. FINANCE
-- ---------------------------------------------------------------------
-- 8.1 Expense voucher. p: {expense_date, payee, vendor_id, expense_account_code, description, division, amount_sar,
--                          vat_applied, vat_recoverable, paid_from_account_code, payment_reference}
create or replace function public.post_expense_voucher(p jsonb) returns public.expense_vouchers
language plpgsql security definer set search_path = public as $$
declare
  v_net numeric := public._r2(public._num(p->'amount_sar')); v_applied boolean := coalesce((p->>'vat_applied')::boolean, false);
  v_vat numeric; v_total numeric; v_rec boolean; v_exp text := p->>'expense_account_code'; v_from text := coalesce(p->>'paid_from_account_code', '1020');
  v_date date := coalesce(nullif(p->>'expense_date', '')::date, public._riyadh_today()); v_num text; v_jv public.gl_journal_entries; v_row public.expense_vouchers;
  v_lines jsonb;
begin
  perform public._require_role('admin','ceo','finance');
  if v_net <= 0 then raise exception 'Net amount must be greater than zero.'; end if;
  if coalesce(trim(p->>'payee'), '') = '' then raise exception 'Payee is required.'; end if;
  if not exists (select 1 from public.gl_accounts where account_code = v_exp and account_type = 'Expense') then
    raise exception 'Choose an Expense account (got %).', coalesce(v_exp, 'none');
  end if;
  v_vat := case when v_applied then public._r2(v_net * 0.15) else 0 end;
  v_total := v_net + v_vat;
  v_rec := v_applied and coalesce((p->>'vat_recoverable')::boolean, false);
  v_num := public.next_doc_number('EXPENSE');

  v_lines := jsonb_build_array(jsonb_build_object('account_code', v_exp, 'debit', case when v_rec then v_net else v_total end,
                                                  'memo', coalesce(nullif(p->>'description', ''), p->>'payee')));
  if v_rec and v_vat > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '1150', 'debit', v_vat, 'memo', 'Input VAT 15% recoverable')); end if;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', v_from, 'credit', v_total,
                                                             'memo', trim(trim(p->>'payee') || ' ' || coalesce(p->>'payment_reference', ''))));

  v_jv := public._gl_post(v_date, 'EXPENSE', v_num,
    format('Expense Voucher %s - %s%s', v_num, trim(p->>'payee'), case when coalesce(p->>'description', '') <> '' then ' (' || (p->>'description') || ')' else '' end),
    v_lines);

  insert into public.expense_vouchers (voucher_number, expense_date, payee, vendor_id, expense_account_code, description, division,
                                       amount_sar, vat_sar, total_sar, vat_recoverable, paid_from_account_code, payment_reference,
                                       status, journal_voucher_number, posted_by)
  values (v_num, v_date, trim(p->>'payee'), nullif(p->>'vendor_id', ''), v_exp, coalesce(p->>'description', ''), coalesce(p->>'division', 'Shared'),
          v_net, v_vat, v_total, v_rec, v_from, coalesce(p->>'payment_reference', ''), 'posted', v_jv.voucher_number, public._actor_name())
  returning * into v_row;
  return v_row;
end $$;

-- 8.2 Void an expense voucher (exact reversal)
create or replace function public.void_expense_voucher(p_id text, p_date date default null) returns public.expense_vouchers
language plpgsql security definer set search_path = public as $$
declare e public.expense_vouchers; v_lines jsonb; v_row public.expense_vouchers;
begin
  perform public._require_role('admin','ceo','finance');
  select * into e from public.expense_vouchers where id = p_id for update;
  if e.id is null then raise exception 'Expense voucher % not found.', p_id; end if;
  if e.status <> 'posted' then raise exception 'Expense voucher % is already %.', e.voucher_number, e.status; end if;
  v_lines := jsonb_build_array(
    jsonb_build_object('account_code', e.paid_from_account_code, 'debit', e.total_sar, 'memo', 'Reversal of ' || e.voucher_number),
    jsonb_build_object('account_code', e.expense_account_code, 'credit', case when e.vat_recoverable then e.amount_sar else e.total_sar end, 'memo', 'Reversal of ' || e.voucher_number));
  if e.vat_recoverable and e.vat_sar > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '1150', 'credit', e.vat_sar, 'memo', 'Input VAT reversal'));
  end if;
  perform public._gl_post(coalesce(p_date, public._riyadh_today()), 'EXPENSE_VOID', e.voucher_number,
    format('VOID Expense Voucher %s - %s', e.voucher_number, e.payee), v_lines);
  update public.expense_vouchers set status = 'void' where id = e.id returning * into v_row;
  return v_row;
end $$;

-- 8.3 Journals entered by Finance: manual JV, bank transfer, bank charge, year-end close
--     p_lines: [{account_code, debit, credit, memo}]
create or replace function public.post_journal(p_kind text, p_entry_date date, p_description text, p_lines jsonb,
                                               p_reference text default '') returns public.gl_journal_entries
language plpgsql security definer set search_path = public as $$
declare v_doc text; v_module text;
begin
  perform public._require_role('admin','ceo','finance');
  case p_kind
    when 'MANUAL' then v_module := null; v_doc := '';
    when 'BANK_TRANSFER' then v_module := 'BANK_TRANSFER'; v_doc := public.next_doc_number('BANK_TXN');
    when 'BANK_CHARGE' then v_module := 'BANK_CHARGE'; v_doc := public.next_doc_number('BANK_TXN');
    when 'YEAR_END_CLOSE' then
      v_module := 'YEAR_END_CLOSE'; v_doc := p_reference;
      if coalesce(v_doc, '') !~ '^FY[0-9]{4}$' then raise exception 'Year-end reference must look like FY2026.'; end if;
      if exists (select 1 from public.gl_journal_entries where source_module = 'YEAR_END_CLOSE' and source_doc_number = v_doc and status <> 'void') then
        raise exception '% has already been closed.', v_doc;
      end if;
    else raise exception 'Unknown journal type %.', p_kind;
  end case;
  return public._gl_post(p_entry_date, v_module, v_doc,
    case when p_kind = 'MANUAL' then p_description
         when p_kind in ('BANK_TRANSFER','BANK_CHARGE') then replace(coalesce(p_description, ''), '{doc}', v_doc)
         else p_description end,
    p_lines, case when p_kind = 'MANUAL' then p_reference else v_doc end);
end $$;

-- 8.4 Fixed asset acquisition. p: {name, category_account_code, acquisition_date, cost_sar, salvage_value_sar, useful_life_months, paid_from_account_code}
create or replace function public.post_fixed_asset(p jsonb) returns public.fixed_assets
language plpgsql security definer set search_path = public as $$
declare v_cost numeric := public._r2(public._num(p->'cost_sar')); v_salv numeric := public._r2(public._num(p->'salvage_value_sar'));
        v_life int := round(public._num(p->'useful_life_months'))::int; v_code text; v_date date := coalesce(nullif(p->>'acquisition_date', '')::date, public._riyadh_today());
        v_row public.fixed_assets;
begin
  perform public._require_role('admin','ceo','finance');
  if coalesce(trim(p->>'name'), '') = '' or v_cost <= 0 then raise exception 'Asset name and a cost greater than zero are required.'; end if;
  if v_salv >= v_cost then raise exception 'Salvage value must be less than cost.'; end if;
  if v_life < 1 then raise exception 'Useful life must be at least 1 month.'; end if;
  v_code := public.next_doc_number('ASSET');
  perform public._gl_post(v_date, 'ASSET', v_code, format('Fixed Asset Acquisition %s - %s', v_code, trim(p->>'name')),
    jsonb_build_array(
      jsonb_build_object('account_code', p->>'category_account_code', 'debit', v_cost, 'memo', trim(p->>'name')),
      jsonb_build_object('account_code', p->>'paid_from_account_code', 'credit', v_cost, 'memo', 'Purchase of ' || v_code)));
  insert into public.fixed_assets (asset_code, name, category_account_code, acquisition_date, cost_sar, salvage_value_sar, useful_life_months,
                                   depreciation_method, accumulated_depreciation_sar, paid_from_account_code, status)
  values (v_code, trim(p->>'name'), p->>'category_account_code', v_date, v_cost, v_salv, v_life, 'straight_line', 0, p->>'paid_from_account_code', 'active')
  returning * into v_row;
  return v_row;
end $$;

-- 8.5 Depreciation run. p_assets: [{id, amount, months}] as previewed in the app; validated here.
create or replace function public.post_depreciation_run(p_period text, p_assets jsonb) returns public.gl_journal_entries
language plpgsql security definer set search_path = public as $$
declare v_date date; v_doc text; v_lines jsonb; v_total numeric; v_bad text; v_jv public.gl_journal_entries;
begin
  perform public._require_role('admin','ceo','finance');
  if coalesce(p_period, '') !~ '^[0-9]{4}-[0-9]{2}$' then raise exception 'Period must look like 2026-11.'; end if;
  v_date := (to_date(p_period || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date;

  select string_agg(coalesce(f.asset_code, a->>'id'), ', ') into v_bad
  from jsonb_array_elements(coalesce(p_assets, '[]'::jsonb)) a
  left join public.fixed_assets f on f.id = a->>'id'
  where f.id is null or f.status <> 'active' or public._num(a->'amount') <= 0
     or f.accumulated_depreciation_sar + public._num(a->'amount') > f.cost_sar - f.salvage_value_sar + 0.01
     or coalesce(f.last_depreciation_period, '') >= p_period;
  if v_bad is not null then raise exception 'Depreciation not allowed for: % (inactive, already run for this period, or more than the remaining value).', v_bad; end if;

  select public._r2(sum(public._num(a->'amount'))) into v_total from jsonb_array_elements(p_assets) a;
  if coalesce(v_total, 0) <= 0 then raise exception 'No depreciation due up to %.', p_period; end if;
  v_doc := public.next_doc_number('DEPRECIATION');
  select jsonb_build_array(jsonb_build_object('account_code', '5270', 'debit', v_total, 'memo', 'Depreciation up to ' || p_period))
         || coalesce(jsonb_agg(jsonb_build_object('account_code', '1590', 'credit', public._r2(public._num(a->'amount')),
                                                  'memo', format('%s %s (%s mo)', f.asset_code, f.name, coalesce(a->>'months', '?')))), '[]'::jsonb)
    into v_lines
  from jsonb_array_elements(p_assets) a join public.fixed_assets f on f.id = a->>'id';

  v_jv := public._gl_post(v_date, 'DEPRECIATION', v_doc, format('Monthly Depreciation Run %s — up to %s', v_doc, p_period), v_lines);

  update public.fixed_assets f
     set accumulated_depreciation_sar = public._r2(f.accumulated_depreciation_sar + public._num(a->'amount')),
         last_depreciation_period = p_period,
         status = case when f.accumulated_depreciation_sar + public._num(a->'amount') >= f.cost_sar - f.salvage_value_sar - 0.01 then 'fully_depreciated' else 'active' end
    from jsonb_array_elements(p_assets) a
   where f.id = a->>'id';
  return v_jv;
end $$;

-- 8.6 Asset disposal
create or replace function public.dispose_fixed_asset(p_id text, p_date date, p_proceeds numeric, p_account text) returns public.fixed_assets
language plpgsql security definer set search_path = public as $$
declare a public.fixed_assets; v_proc numeric := public._r2(p_proceeds); v_gain numeric; v_lines jsonb := '[]'::jsonb; v_row public.fixed_assets;
begin
  perform public._require_role('admin','ceo','finance');
  select * into a from public.fixed_assets where id = p_id for update;
  if a.id is null then raise exception 'Asset % not found.', p_id; end if;
  if a.status = 'disposed' then raise exception 'Asset % is already disposed.', a.asset_code; end if;
  if v_proc < 0 then raise exception 'Proceeds cannot be negative.'; end if;
  v_gain := public._r2(v_proc - (a.cost_sar - a.accumulated_depreciation_sar));
  if v_proc > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', p_account, 'debit', v_proc, 'memo', 'Disposal proceeds')); end if;
  if a.accumulated_depreciation_sar > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '1590', 'debit', a.accumulated_depreciation_sar, 'memo', 'Remove accumulated depreciation')); end if;
  if v_gain < 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '5100', 'debit', abs(v_gain), 'memo', 'Loss on disposal')); end if;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', a.category_account_code, 'credit', a.cost_sar, 'memo', 'Derecognise ' || a.asset_code));
  if v_gain > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '4900', 'credit', v_gain, 'memo', 'Gain on disposal')); end if;
  perform public._gl_post(p_date, 'ASSET_DISPOSAL', a.asset_code, format('Disposal of Fixed Asset %s - %s', a.asset_code, a.name), v_lines);
  update public.fixed_assets set status = 'disposed', disposal_date = p_date, disposal_proceeds_sar = v_proc where id = a.id returning * into v_row;
  return v_row;
end $$;

-- ---------------------------------------------------------------------
-- 9. Privileges: event functions callable by signed-in users (each checks the role);
--    internal helpers are not.
-- ---------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public._gl_post(date, text, text, text, jsonb, text)', 'public._require_role(text[])', 'public._actor_name()',
    'public._company()', 'public._zatca_qr(text, text, text, numeric, numeric)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.post_sales_order(text)', 'public.post_delivery_note(text, jsonb, text)', 'public.post_invoice(text)',
    'public.post_customer_receipt(text, numeric, text, text, date)', 'public.post_credit_note(text, jsonb, text)',
    'public.post_purchase_order(jsonb)', 'public.post_goods_receipt(text)', 'public.post_supplier_bill(text)',
    'public.post_supplier_payment(text, numeric, numeric, text, text, date, text, text)',
    'public.post_expense_voucher(jsonb)', 'public.void_expense_voucher(text, date)',
    'public.post_journal(text, date, text, jsonb, text)', 'public.post_fixed_asset(jsonb)',
    'public.post_depreciation_run(text, jsonb)', 'public.dispose_fixed_asset(text, date, numeric, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
