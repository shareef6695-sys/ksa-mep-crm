-- =====================================================================
-- 0014_projects_contracts.sql — MEP project billing, IT & ELV recurring contracts, service tickets (F12, F13)
--
--  * projects: customer, division, cost centre, contract value, billing method (delivery | percent | boq), retention %,
--    budget and BOQ. Sales orders link to a project (link_sales_order_to_project).
--  * Every GL line can carry project_id (gl_journal_lines.project_id). Posting functions tag their lines from the document:
--    delivery notes / invoices / credit notes from the SO's project, GRNs / supplier bills from the PO's project, expense
--    vouchers from their own project; manual journal lines can set project_id themselves. project_job_cost() reports
--    revenue, material (5010/5020), labour (5200/5310), subcontract (5300), other costs and margin per project.
--  * Advance invoices (ZATCA type 386, VAT due when issued): Dr 1100 / Cr 2060 advance billings / Cr 2100.
--  * Progress claims (percent complete or cumulative BOQ quantities). Claims are cumulative: each one bills work to date less
--    what was billed before. Retention (e.g. 10%) is held back from the invoice and recognised as revenue into 1110 Retention
--    receivable; the advance is deducted pro rata to the value claimed (all of it on the final claim) using ZATCA's
--    prepayment adjustment (PrepaidAmount + a zero line referencing the 386 invoice). VAT on the deducted advance was
--    already declared, so output VAT on the claim is the claim's VAT less the advance VAT deducted.
--      Dr 1100 payable, Dr 2060 advance deducted, Dr 1110 retention / Cr 4010|4020 work done, Cr 2100 net new VAT.
--  * Retention release invoice: VAT is charged when the retention is invoiced. Dr 1100 / Cr 1110 / Cr 2100.
--  * Service contracts (AMC / subscription / support / licence): start / end, monthly / quarterly / semi-annual / annual
--    billing in advance or arrears, lines priced per month (UoM MTH). generate_contract_drafts() makes a draft billing
--    period when one falls due (for review), post_contract_invoice() issues the invoice. Optional deferred revenue:
--    Cr 2400 on invoice, recognised month by month by recognize_deferred_revenue(). contract_renewals_due(), renew_contract().
--  * Service tickets against warranties (item_serials.warranty_end) and AMCs (contract covers the serial or all of the
--    customer's assets), with SLA due time from the contract or the priority.
--
-- Run after 0013 (and before 0005 when 0005 is used). Re-runnable.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. Accounts
-- ---------------------------------------------------------------------
insert into public.gl_accounts (account_code, account_name_en, account_name_ar, account_type, normal_balance, is_system) values
  ('1110', 'Retention Receivable', 'محتجزات ضمان مستحقة القبض', 'Asset', 'Debit', true),
  ('2060', 'Advance Billings (Contract Liabilities)', 'دفعات مقدمة مفوترة (التزامات عقود)', 'Liability', 'Credit', true),
  ('2400', 'Deferred Revenue', 'إيرادات مؤجلة', 'Liability', 'Credit', true),
  ('5300', 'Subcontractor Costs', 'تكاليف مقاولي الباطن', 'Expense', 'Debit', true),
  ('5310', 'Direct Labour - Projects', 'العمالة المباشرة - المشاريع', 'Expense', 'Debit', true)
on conflict (account_code) do nothing;

-- ---------------------------------------------------------------------
-- 2. Tables and columns
-- ---------------------------------------------------------------------
create table if not exists public.projects (
  id                 text primary key default gen_random_uuid()::text,
  project_code       text not null unique,
  name               text not null check (length(trim(name)) > 0),
  customer_id        text references public.customers(id),
  client_name        text not null,
  client_vat         text not null default '',
  division           text not null default 'MEP' check (division in ('MEP','IT & ELV')),
  cost_centre        text not null default '',
  project_manager    text not null default '',
  status             text not null default 'active' check (status in ('active','on_hold','completed','closed')),
  contract_value_sar numeric(18,2) not null default 0 check (contract_value_sar >= 0),
  billing_method     text not null default 'delivery' check (billing_method in ('delivery','percent','boq')),
  retention_pct      numeric(7,4) not null default 0 check (retention_pct between 0 and 50),
  advance_pct        numeric(7,4) not null default 0 check (advance_pct between 0 and 100),
  budget             jsonb not null default '{}'::jsonb,     -- {revenue, material, labour, subcontract, other} SAR
  boq                jsonb not null default '[]'::jsonb,     -- [{code, description, unit, qty, rate}]
  start_date         date,
  end_date           date,
  main_so_id         text,
  notes              text not null default '',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by_uid     uuid,
  updated_by_uid     uuid
);


-- Prompt 15 fix: views built on these tables' row types (jsonb_populate_record(null::table, ...)) must be dropped before
-- ALTER TABLE on newer Postgres; they are re-created further down in this migration and re-granted at the end.
drop view if exists public.sales_orders_v;
drop view if exists public.invoices_v;
alter table public.sales_orders add column if not exists project_id text references public.projects(id);
alter table public.purchase_orders add column if not exists project_id text references public.projects(id);
alter table public.purchase_orders add column if not exists cost_type text not null default 'material';
alter table public.expense_vouchers add column if not exists project_id text references public.projects(id);
alter table public.gl_journal_lines add column if not exists project_id text references public.projects(id);
create index if not exists idx_gl_lines_project on public.gl_journal_lines (project_id, entry_date) where project_id is not null;
create index if not exists idx_sales_orders_project on public.sales_orders (project_id) where project_id is not null;

alter table public.invoices add column if not exists project_id text references public.projects(id);
alter table public.invoices add column if not exists contract_id text;
alter table public.invoices add column if not exists invoice_kind text not null default 'sale';
alter table public.invoices add column if not exists billing jsonb not null default '{}'::jsonb;
alter table public.invoices add column if not exists prepayments jsonb not null default '[]'::jsonb;
alter table public.invoices add column if not exists prepaid_sar numeric(18,2) not null default 0;
alter table public.invoices add column if not exists retention_sar numeric(18,2) not null default 0;
alter table public.invoices add column if not exists billing_source_id text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_invoice_kind_check') then
    alter table public.invoices add constraint invoices_invoice_kind_check check (invoice_kind in ('sale','advance','progress','retention','contract'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'purchase_orders_cost_type_check') then
    alter table public.purchase_orders add constraint purchase_orders_cost_type_check check (cost_type in ('material','subcontract'));
  end if;
end $$;
create index if not exists idx_invoices_project on public.invoices (project_id) where project_id is not null;

create table if not exists public.service_contracts (
  id                  text primary key default gen_random_uuid()::text,
  contract_number     text not null unique,
  contract_type       text not null default 'amc' check (contract_type in ('amc','subscription','support','licence')),
  title               text not null check (length(trim(title)) > 0),
  customer_id         text references public.customers(id),
  client_name         text not null,
  client_vat          text not null default '',
  division            text not null default 'IT & ELV' check (division in ('MEP','IT & ELV')),
  salesman_id         text,
  salesman_name       text not null default '',
  start_date          date not null,
  end_date            date not null,
  billing_frequency   text not null default 'monthly' check (billing_frequency in ('monthly','quarterly','semiannual','annual')),
  billing_timing      text not null default 'advance' check (billing_timing in ('advance','arrears')),
  lines               jsonb not null default '[]'::jsonb,   -- [{desc, qty, monthlySar, vatCategory, exemptionReason}] price per unit per month
  monthly_value_sar   numeric(18,2) not null default 0,
  deferred_revenue    boolean not null default false,
  renewal_notice_days integer not null default 30 check (renewal_notice_days between 0 and 365),
  sla_response_hours  integer not null default 24 check (sla_response_hours > 0),
  covered_serials     text[] not null default '{}',
  covers_all_assets   boolean not null default false,
  status              text not null default 'draft' check (status in ('draft','active','expired','cancelled')),
  next_period_start   date,
  renewed_from        text,
  renewed_to          text,
  cancelled_reason    text,
  notes               text not null default '',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by_uid      uuid,
  updated_by_uid      uuid,
  constraint service_contracts_dates check (end_date >= start_date)
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_contract_id_fkey') then
    alter table public.invoices add constraint invoices_contract_id_fkey foreign key (contract_id) references public.service_contracts(id);
  end if;
end $$;

create table if not exists public.contract_billing_periods (
  id             text primary key default gen_random_uuid()::text,
  contract_id    text not null references public.service_contracts(id),
  period_no      integer not null,
  period_start   date not null,
  period_end     date not null,
  bill_date      date not null,
  lines          jsonb not null default '[]'::jsonb,   -- invoice lines: {desc, qty (months x units), unit MTH, unitSellSar, vatCategory, vatRate, exemptionReason}
  amount_sar     numeric(18,2) not null default 0,
  status         text not null default 'draft' check (status in ('draft','invoiced','skipped')),
  invoice_id     text references public.invoices(id),
  invoice_number text,
  note           text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by_uid uuid,
  updated_by_uid uuid,
  unique (contract_id, period_start)
);

create table if not exists public.deferred_revenue_schedule (
  id             bigserial primary key,
  contract_id    text not null references public.service_contracts(id),
  invoice_id     text not null references public.invoices(id),
  invoice_number text,
  division       text not null,
  month          date not null,
  amount_sar     numeric(18,2) not null check (amount_sar >= 0),
  recognized     boolean not null default false,
  journal_number text,
  recognized_at  timestamptz,
  unique (invoice_id, month)
);

create table if not exists public.service_tickets (
  id             text primary key default gen_random_uuid()::text,
  ticket_number  text not null unique,
  customer_id    text references public.customers(id),
  client_name    text not null,
  division       text not null default 'IT & ELV',
  item_id        text,
  item_name      text not null default '',
  serial         text not null default '',
  contract_id    text references public.service_contracts(id),
  coverage       text not null check (coverage in ('warranty','amc','chargeable')),
  priority       text not null default 'normal' check (priority in ('low','normal','high','critical')),
  status         text not null default 'open' check (status in ('open','in_progress','on_hold','resolved','closed','cancelled')),
  subject        text not null check (length(trim(subject)) > 0),
  description    text not null default '',
  contact_name   text not null default '',
  contact_phone  text not null default '',
  assigned_to    text not null default '',
  sla_due_at     timestamptz,
  opened_at      timestamptz not null default now(),
  resolved_at    timestamptz,
  closed_at      timestamptz,
  resolution     text not null default '',
  labour_hours   numeric(10,2) not null default 0 check (labour_hours >= 0),
  chargeable_sar numeric(18,2) not null default 0 check (chargeable_sar >= 0),
  history        jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by_uid uuid,
  updated_by_uid uuid
);
create index if not exists idx_service_tickets_status on public.service_tickets (status, opened_at desc);

-- ---------------------------------------------------------------------
-- 3. Project tagging of journal lines
--    Posting functions call _project_ctx(project) before they post; _gl_post stamps the project on every line that
--    does not carry its own project_id and clears the context after use.
-- ---------------------------------------------------------------------
create or replace function public._project_ctx(p_project text) returns void
language sql as $$ select set_config('app.project_id', coalesce(p_project, ''), true) $$;

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
           'memo',   coalesce(l->>'memo', ''),
           'project_id', coalesce(nullif(l->>'project_id', ''), nullif(current_setting('app.project_id', true), ''))) order by o), '[]'::jsonb)   -- 0014
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
  perform set_config('app.project_id', '', true);   -- 0014: the context is for this one journal
  return v_entry;
end $$;

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
  select string_agg(distinct l->>'project_id', ', ') into v_bad
  from jsonb_array_elements(coalesce(new.lines, '[]'::jsonb)) l
  where nullif(l->>'project_id', '') is not null and not exists (select 1 from public.projects p where p.id = l->>'project_id');
  if v_bad is not null then raise exception 'Journal % refers to unknown project(s): %', coalesce(new.voucher_number, new.id), v_bad; end if;

  insert into public.gl_journal_lines (entry_id, line_no, account_code, debit, credit, memo, entry_date, source_module, project_id)
  select new.id, o::int, l->>'account_code', public._r2(public._num(l->'debit')), public._r2(public._num(l->'credit')),
         coalesce(l->>'memo', ''), coalesce(new.entry_date, public._riyadh_today()), new.source_module, nullif(l->>'project_id', '')
  from jsonb_array_elements(coalesce(new.lines, '[]'::jsonb)) with ordinality as x(l, o)
  where public._num(l->'debit') <> 0 or public._num(l->'credit') <> 0;

  select coalesce(sum(debit), 0), coalesce(sum(credit), 0) into v_dr, v_cr from public.gl_journal_lines where entry_id = new.id;
  if v_dr = 0 or v_dr <> v_cr then
    raise exception 'Journal % does not balance: debits SAR % vs credits SAR %.', coalesce(new.voucher_number, new.id), v_dr, v_cr using errcode = '23514';
  end if;
  return null;
end $$;

create or replace function public.post_delivery_note(p_so_id text, p_qtys jsonb, p_notes text default '',
                                                     p_serials jsonb default '{}'::jsonb, p_warehouse text default null) returns public.delivery_notes
language plpgsql security definer set search_path = public as $$
declare
  so public.sales_orders; v_items jsonb; v_lines jsonb; v_all boolean; v_dn public.delivery_notes;
  v_wh text := coalesce(nullif(p_warehouse, ''), public._default_warehouse()); v_id text := gen_random_uuid()::text; v_num text;
  v_l jsonb; v_o int; v_m public.items; v_r jsonb; v_out jsonb := '[]'::jsonb; v_cogs numeric := 0; v_warn text[] := '{}'; v_sw text;
begin
  perform public._require_role('admin','ceo','procurement');
  select * into so from public.sales_orders where id = p_so_id for update;
  if so.id is null then raise exception 'Sales Order % not found.', p_so_id; end if;
  perform public._project_ctx(so.project_id);   -- 0014: COGS lands on the project

  with x as (
    select it, o,
           greatest(0, least(public._num(p_qtys->(it->>'id')), public._num(it->'orderedQty') - public._num(it->'deliveredQty'))) as ship
    from jsonb_array_elements(coalesce(so.items, '[]'::jsonb)) with ordinality as t(it, o)
  )
  select
    coalesce(jsonb_agg(it || jsonb_build_object('deliveredQty', public._num(it->'deliveredQty') + ship) order by o), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('id', it->>'id', 'desc', it->>'desc', 'qty', ship, 'unit', it->>'unit',
                                          'unitSellSar', it->'unitSellSar', 'unitCostSar', it->'unitCostSar')
                      || jsonb_strip_nulls(jsonb_build_object('vatCategory', it->'vatCategory', 'vatRate', it->'vatRate', 'exemptionReason', it->'exemptionReason',
                                                              'itemId', nullif(it->>'itemId', '')))
                      order by o)
             filter (where ship > 0), '[]'::jsonb),
    coalesce(bool_and(public._num(it->'deliveredQty') + ship >= public._num(it->'orderedQty')), true)
  into v_items, v_lines, v_all
  from x;

  if jsonb_array_length(v_lines) = 0 then
    raise exception 'Nothing to deliver: enter a quantity up to the remaining amount on at least one line.';
  end if;

  -- 0011: stocked items leave the warehouse now, at moving-average cost (Dr 5010 / Cr 1200)
  v_num := public.next_doc_number('DN');
  for v_l, v_o in select x, ord from jsonb_array_elements(v_lines) with ordinality as t(x, ord) loop
    v_m := null;
    select * into v_m from public.items where id = v_l->>'itemId' and is_stocked_item;
    if v_m.id is not null then
      v_r := public._stock_move(v_m.id, v_wh, -public._num(v_l->'qty'), public._num(v_l->'unitCostSar'), 'DN', 'DN', v_id, v_num, public._riyadh_today(),
                              v_l->>'id', so.client_name);
      v_cogs := v_cogs + (v_r->>'value')::numeric;
      if (v_r->>'negative')::boolean then
        v_warn := array_append(v_warn, format('%s: delivered more than in stock in %s (now %s). Cost taken at SAR %s per unit and corrected when goods are received.',
                                              v_m.name_en, v_wh, round((v_r->>'qty_after')::numeric, 2), round((v_r->>'unit_cost')::numeric, 2)));
      end if;
      if v_m.is_serialized then
        v_sw := public._serials_out(v_m.id, v_wh, p_serials->(v_l->>'id'), public._num(v_l->'qty'), v_id, v_num);
        if v_sw is not null then v_warn := array_append(v_warn, v_sw); end if;
      end if;
      v_l := v_l || jsonb_build_object('estUnitCostSar', v_l->'unitCostSar', 'unitCostSar', (v_r->>'unit_cost')::numeric,
                                   'cogsSar', (v_r->>'value')::numeric, 'stockIssued', true, 'warehouse', v_wh);
    end if;
    v_out := v_out || jsonb_build_array(v_l);
  end loop;
  v_lines := v_out;

  insert into public.delivery_notes (id, dn_number, division, so_id, so_number, client_name, delivery_type, items, delivered_by, notes,
                                     warehouse, inventory_posted, cogs_sar, stock_warnings)
  values (v_id, v_num, coalesce(so.division, 'MEP'), so.id, so.so_number, so.client_name,
          case when v_all then 'full' else 'partial' end, v_lines, public._actor_name(), coalesce(p_notes, ''),
          v_wh, true, public._r2(v_cogs), v_warn)
  returning * into v_dn;
  if v_cogs <> 0 then
    perform public._gl_post(public._riyadh_today(), 'DELIVERY_NOTE', v_num, format('COGS - Delivery %s (%s, %s)', v_num, so.client_name, coalesce(so.so_number, '')),
      jsonb_build_array(
        jsonb_build_object('account_code', '5010', 'debit', public._r2(v_cogs), 'memo', 'COGS at moving-average cost'),
        jsonb_build_object('account_code', '1200', 'credit', public._r2(v_cogs), 'memo', 'Stock out ' || v_wh)));
  end if;

  update public.sales_orders set items = v_items, status = case when v_all then 'delivered' else 'partially_delivered' end, updated_at = now()
  where id = so.id;
  return v_dn;
end $$;

create or replace function public.post_invoice(p_dn_id text) returns public.invoices
language plpgsql security definer set search_path = public as $$
declare
  dn public.delivery_notes; so public.sales_orders; c jsonb := public._company();
  v_sub numeric; v_cost numeric; v_vat numeric; v_grand numeric; v_num text; v_iso text := public._iso_now();
  v_inv public.invoices; v_profit numeric; v_pct numeric; v_elig numeric; v_it boolean;
  cust public.customers; v_seller jsonb; v_buyer jsonb; v_warn text[] := '{}'; v_type text;
begin
  perform public._require_role('admin','ceo','finance');
  select * into dn from public.delivery_notes where id = p_dn_id for update;
  if dn.id is null then raise exception 'Delivery note % not found.', p_dn_id; end if;
  if exists (select 1 from public.invoices where dn_id = p_dn_id) then
    raise exception 'Delivery note % has already been invoiced.', dn.dn_number;
  end if;
  select * into so from public.sales_orders where id = dn.so_id;
  -- 0014: orders of a project billed by progress claims are not invoiced per delivery
  if exists (select 1 from public.projects pr where pr.id = so.project_id and pr.billing_method <> 'delivery') then
    raise exception 'Sales Order % belongs to project % which is billed by progress claims, not per delivery.', so.so_number,
      (select project_code from public.projects where id = so.project_id);
  end if;
  perform public._project_ctx(so.project_id);

  select coalesce(sum(public._r2(public._num(it->'qty') * public._num(it->'unitSellSar'))), 0),
         coalesce(sum(public._num(it->'qty') * public._num(it->'unitCostSar')), 0)
    into v_sub, v_cost from jsonb_array_elements(coalesce(dn.items, '[]'::jsonb)) it;
  v_vat := public._breakdown_vat(public._vat_breakdown(dn.items));   -- 0010: ZATCA rounding
  v_grand := v_sub + v_vat;
  v_type := case when coalesce(so.client_vat, '') <> '' then 'standard' else 'simplified' end;

  -- seller / buyer details ZATCA needs on a standard (B2B) tax invoice
  v_seller := jsonb_strip_nulls(jsonb_build_object('name', c->>'nameEn', 'nameAr', c->>'nameAr', 'vatNumber', c->>'vatNumber', 'crNumber', c->>'crNumber',
    'buildingNo', c->>'buildingNo', 'street', c->>'street', 'district', c->>'district', 'city', c->>'city',
    'postalCode', c->>'postalCode', 'additionalNo', c->>'additionalNo', 'country', 'SA'));
  select * into cust from public.customers
   where id = coalesce(so.customer_id, '') or (so.customer_id is null and lower(trim(name_en)) = lower(trim(dn.client_name)))
   order by (id = coalesce(so.customer_id, '')) desc limit 1;
  v_buyer := jsonb_strip_nulls(jsonb_build_object('name', coalesce(cust.name_en, dn.client_name), 'nameAr', cust.name_ar, 'vatNumber', so.client_vat,
    'crNumber', cust.cr_number, 'buildingNo', cust.building_no, 'street', cust.street, 'district', cust.district,
    'city', cust.city, 'postalCode', cust.postal_code, 'additionalNo', cust.additional_no, 'country', coalesce(cust.country, 'SA')));
  if not public.is_valid_ksa_vat(c->>'vatNumber') then v_warn := array_append(v_warn, 'Seller VAT number is not 15 digits starting and ending with 3'::text); end if;
  if exists (select 1 from unnest(array['buildingNo','street','district','city','postalCode']) k where coalesce(v_seller->>k, '') = '') then
    v_warn := array_append(v_warn, 'Seller address incomplete (building no., street, district, city, postal code)'::text);
  end if;
  if v_type = 'standard' then
    if not public.is_valid_ksa_vat(so.client_vat) then v_warn := array_append(v_warn, ('Buyer VAT number ' || so.client_vat || ' is not a valid KSA VAT number')::text); end if;
    if exists (select 1 from unnest(array['buildingNo','street','district','city','postalCode']) k where coalesce(v_buyer->>k, '') = '') then
      v_warn := array_append(v_warn, 'Buyer address incomplete (building no., street, district, city, postal code)'::text);
    end if;
  end if;
  v_num := public.next_doc_number('INVOICE');
  v_it := coalesce(dn.division, 'MEP') = 'IT & ELV';

  insert into public.invoices (invoice_number, division, invoice_type, so_id, so_number, dn_id, client_name, client_vat,
                               salesman_id, salesman_name, commission_pct, items, subtotal_sar, vat_sar, grand_total_sar,
                               landed_cost_sar, paid_amount_sar, payment_status, zatca_status, qr_base64, locked, issued_at,
                               customer_id, vat_breakdown, seller_address, buyer_address, zatca_warnings, project_id)
  values (v_num, coalesce(dn.division, 'MEP'), v_type,
          dn.so_id, dn.so_number, dn.id, dn.client_name, coalesce(so.client_vat, ''),
          so.salesman_id, coalesce(so.salesman_name, 'Unassigned'), coalesce(so.commission_pct, 0), dn.items,
          public._r2(v_sub), public._r2(v_vat), public._r2(v_grand), public._r2(v_cost), 0, 'unpaid',
          'phase1_qr_ready',
          public._zatca_qr(c->>'nameEn', c->>'vatNumber', v_iso, v_grand, v_vat), true, v_iso::timestamptz,
          coalesce(so.customer_id, cust.id), public._vat_breakdown(dn.items), v_seller, v_buyer, v_warn, so.project_id)
  returning * into v_inv;

  perform public._gl_post(public.riyadh_date(v_inv.issued_at), 'INVOICE', v_num,
    format('ZATCA Invoice %s - %s (%s)', v_num, dn.client_name, coalesce(dn.so_number, '')),
    jsonb_build_array(
      jsonb_build_object('account_code', '1100', 'debit', v_grand, 'memo', dn.client_name),
      jsonb_build_object('account_code', case when v_it then '4020' else '4010' end, 'credit', v_sub, 'memo', v_num),
      jsonb_build_object('account_code', '2100', 'credit', v_vat, 'memo', 'Output VAT'),
      -- 0011: COGS is posted by the delivery note; only deliveries from before 0011 still relieve stock here
      jsonb_build_object('account_code', '5010', 'debit', case when dn.inventory_posted then 0 else v_cost end, 'memo', 'COGS ' || v_num),
      jsonb_build_object('account_code', '1200', 'credit', case when dn.inventory_posted then 0 else v_cost end, 'memo', 'Stock relief ' || coalesce(dn.dn_number, ''))));

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

create or replace function public.post_credit_note(p_invoice_id text, p_return_qtys jsonb, p_reason text,
                                                   p_reason_code text default 'RETURN') returns public.credit_notes
language plpgsql security definer set search_path = public as $$
declare
  inv public.invoices; c jsonb := public._company(); v_done numeric[]; v_lines jsonb; v_sub numeric; v_cost numeric; v_vat numeric; v_grand numeric;
  v_num text; v_iso text := public._iso_now(); v_cn public.credit_notes; v_open numeric; v_to_ar numeric; v_excess numeric;
  comm public.commission_ledger; v_np numeric; v_elig numeric; v_over text;
  v_ret numeric := 0; l jsonb; m public.items; r jsonb;
begin
  perform public._require_role('admin','ceo','finance');
  if coalesce(p_reason_code, '') not in ('RETURN','DAMAGED','PRICE_ADJUSTMENT','CANCELLATION','OTHER') then
    raise exception 'Unknown credit note reason code %.', p_reason_code;
  end if;
  select * into inv from public.invoices where id = p_invoice_id for update;
  if inv.id is null then raise exception 'Invoice % not found.', p_invoice_id; end if;
  perform public._project_ctx(inv.project_id);   -- 0014
  v_done := public._invoice_credited_qty(inv.id);

  -- refuse quantities above what is still un-credited on each line
  select string_agg(format('line %s "%s": %s requested, %s left', o, it->>'desc', public._num(p_return_qtys->((o - 1)::int)),
                           public._num(it->'qty') - coalesce(v_done[o], 0)), '; ')
    into v_over
  from jsonb_array_elements(coalesce(inv.items, '[]'::jsonb)) with ordinality as t(it, o)
  where public._num(p_return_qtys->((o - 1)::int)) > public._num(it->'qty') - coalesce(v_done[o], 0) + 0.0001;
  if v_over is not null then raise exception 'Cannot credit more than was invoiced and not yet credited: %.', v_over; end if;

  with x as (
    select it, o, greatest(0, public._num(p_return_qtys->((o - 1)::int))) as q
    from jsonb_array_elements(coalesce(inv.items, '[]'::jsonb)) with ordinality as t(it, o)
  )
  select coalesce(jsonb_agg(jsonb_build_object('invoiceLine', o - 1, 'desc', it->>'desc', 'qty', q, 'unit', coalesce(it->>'unit', 'PCS'),
                                               'unitSellSar', public._num(it->'unitSellSar'), 'unitCostSar', public._num(it->'unitCostSar'),
                                               'vatCategory', coalesce(it->>'vatCategory', 'S'), 'vatRate', public._line_rate(it))
                             || jsonb_strip_nulls(jsonb_build_object('exemptionReason', it->'exemptionReason', 'itemId', it->'itemId',
                                                                     'warehouse', it->'warehouse', 'stockIssued', it->'stockIssued')) order by o)
                  filter (where q > 0), '[]'::jsonb),
         coalesce(sum(public._r2(q * public._num(it->'unitSellSar'))), 0), coalesce(sum(q * public._num(it->'unitCostSar')), 0),
         coalesce(sum(q * public._num(it->'unitSellSar') * public._line_rate(it)), 0)
    into v_lines, v_sub, v_cost, v_vat from x;
  v_vat := public._breakdown_vat(public._vat_breakdown(v_lines));   -- 0010: ZATCA rounding
  if jsonb_array_length(v_lines) = 0 or v_sub <= 0 then raise exception 'Enter a return quantity on at least one line.'; end if;

  v_grand := public._r2(v_sub + v_vat);
  if v_grand > public._r2(inv.grand_total_sar + inv.debited_amount_sar - inv.credited_amount_sar) + 0.01 then
    raise exception 'Credit note SAR % is more than the un-credited value of invoice % (SAR %).', v_grand, inv.invoice_number,
      public._r2(inv.grand_total_sar + inv.debited_amount_sar - inv.credited_amount_sar);
  end if;
  v_open := greatest(0, public._r2(inv.grand_total_sar + inv.debited_amount_sar - inv.paid_amount_sar - inv.credited_amount_sar));
  v_to_ar := least(v_grand, v_open);
  v_excess := public._r2(v_grand - v_to_ar);
  v_num := public.next_doc_number('CREDIT_NOTE');

  insert into public.credit_notes (credit_note_number, original_invoice_id, original_invoice_number, original_invoice_date, client_name, client_vat,
                                   reason, reason_code, items, subtotal_sar, vat_sar, grand_total_sar, landed_cost_reversed_sar,
                                   applied_to_ar_sar, to_customer_credit_sar, qr_base64, issued_by, issued_at, vat_breakdown)
  values (v_num, inv.id, inv.invoice_number, inv.issued_at, inv.client_name, coalesce(inv.client_vat, ''),
          p_reason, p_reason_code, v_lines, public._r2(v_sub), public._r2(v_vat), v_grand, public._r2(v_cost),
          v_to_ar, v_excess, public._zatca_qr(c->>'nameEn', c->>'vatNumber', v_iso, v_grand, v_vat), public._actor_name(), v_iso::timestamptz,
          public._vat_breakdown(v_lines))
  returning * into v_cn;

  -- 0011: returned stocked items go back into stock at the cost they left at
  for l in select x from jsonb_array_elements(v_lines) x loop
    m := null;
    select * into m from public.items where id = l->>'itemId' and is_stocked_item;
    if m.id is not null then
      r := public._stock_move(m.id, coalesce(nullif(l->>'warehouse', ''), public._default_warehouse()), public._num(l->'qty'), public._num(l->'unitCostSar'),
                              'CN_RETURN', 'CREDIT_NOTE', v_cn.id, v_num, public.riyadh_date(v_cn.issued_at), l->>'invoiceLine', inv.client_name);
      v_ret := v_ret + (r->>'value')::numeric - (r->>'correction')::numeric;
    end if;
  end loop;

  perform public._gl_post(public.riyadh_date(v_cn.issued_at), 'CREDIT_NOTE', v_num,
    format('ZATCA Credit Note %s vs %s (%s)', v_num, inv.invoice_number, inv.client_name),
    jsonb_build_array(
      jsonb_build_object('account_code', case inv.invoice_kind when 'advance' then '2060' when 'retention' then '1110'          -- 0014
                                              when 'contract' then case when exists (select 1 from public.deferred_revenue_schedule s where s.invoice_id = inv.id) then '2400' else '4090' end
                                              else '4090' end, 'debit', v_sub, 'memo', coalesce(p_reason, p_reason_code)),
      jsonb_build_object('account_code', '2100', 'debit', v_vat, 'memo', 'VAT reversal'),
      jsonb_build_object('account_code', '1100', 'credit', v_to_ar, 'memo', inv.client_name),
      jsonb_build_object('account_code', '2050', 'credit', v_excess, 'memo', 'Refund due / credit - ' || inv.client_name),
      jsonb_build_object('account_code', '1200', 'debit', greatest(v_ret, 0), 'credit', greatest(-v_ret, 0), 'memo', 'Stock Return Valuation'),
      jsonb_build_object('account_code', '5010', 'debit', greatest(-v_ret, 0), 'credit', greatest(v_ret, 0), 'memo', 'COGS Reversal')));

  if v_excess > 0 then
    -- the customer had already paid this part: release it from the invoice into their credit balance
    insert into public.customer_credit_ledger (client_name, kind, amount_sar, source_doc, invoice_id, entry_date, notes)
    values (inv.client_name, 'credit_note_excess', v_excess, v_num, inv.id, public.riyadh_date(v_cn.issued_at),
            'Credit note on an already-paid invoice');
    insert into public.receipt_allocations (receipt_id, invoice_id, amount_sar, source, source_doc, entry_date)
    values (null, inv.id, -v_excess, 'credit_note_release', v_num, public.riyadh_date(v_cn.issued_at));
  end if;

  update public.invoices
     set credited_amount_sar = public._r2(credited_amount_sar + v_grand),
         paid_amount_sar = public._r2(paid_amount_sar - v_excess)
   where id = inv.id;

  -- claw back commission on the profit returned, then re-sync status / unlock
  select * into comm from public.commission_ledger where invoice_id = inv.id limit 1;
  if comm.id is not null then
    v_np := greatest(0, comm.net_profit_sar - greatest(0, v_sub - v_cost));
    v_elig := public._r2(v_np * comm.commission_pct / 100);
    update public.commission_ledger
       set net_profit_sar = public._r2(v_np), total_eligible_commission_sar = v_elig,
           status = case when v_elig <= 0 then 'reversed_by_credit_note' else status end, updated_at = now()
     where id = comm.id;
  end if;
  perform public._invoice_sync(inv.id);
  return v_cn;
end $$;

create or replace function public.post_goods_receipt(p_po_id text, p_serials jsonb default '{}'::jsonb, p_warehouse text default null,
                                                     p_qtys jsonb default null, p_notes text default null) returns public.goods_receipts
language plpgsql security definer set search_path = public as $$
declare
  po public.purchase_orders; v_wh text := coalesce(nullif(p_warehouse, ''), public._default_warehouse()); it jsonb; m public.items;
  v_q numeric; v_open numeric; v_unit numeric; r jsonb; v_val numeric := 0; v_corr numeric := 0; v_items jsonb := '[]'::jsonb;
  v_lines jsonb := '[]'::jsonb; v_num text; v_gl jsonb; v_tol numeric := public._num(public._proc_settings()->'qtyTolerancePct');
  v_grn public.goods_receipts; v_any boolean := false; v_lv numeric;
begin
  perform public._require_role('admin','ceo','procurement');
  select * into po from public.purchase_orders where id = p_po_id for update;
  if po.id is null then raise exception 'Purchase order % not found.', p_po_id; end if;
  perform public._project_ctx(po.project_id);   -- 0014
  if po.status = 'pending_approval' then raise exception 'Purchase order % is waiting for approval; goods cannot be received yet.', po.po_number; end if;
  if po.status not in ('po_issued','partially_received','partially_billed','billed') then
    raise exception 'Purchase order % is not waiting for goods receipt.', po.po_number;
  end if;
  v_num := public.next_doc_number('GRN');

  for it in select x from jsonb_array_elements(po.items) x order by (x->>'line')::int loop
    v_open := public._num(it->'qty') - public._num(it->'receivedQty') - public._num(it->'closedQty');
    v_q := case when p_qtys is null then greatest(v_open, 0) else public._num(p_qtys->(it->>'line')) end;
    if v_q < 0 then raise exception 'Line %: received quantity cannot be negative.', it->>'line'; end if;
    if v_q > v_open * (1 + v_tol / 100) + 0.0001 then
      raise exception 'Line % (%): % received but only % still open on %. Over-receipt is not allowed.', it->>'line', it->>'desc', v_q, greatest(v_open, 0), po.po_number;
    end if;
    if v_q > 0 then
      v_any := true;
      m := null;
      if coalesce((it->>'is_stocked_item')::boolean, false) then select * into m from public.items where id = it->>'itemId' and is_stocked_item; end if;
      v_lv := 0;
      if m.id is not null then
        v_unit := public._po_line_unit_cost(po, it);
        r := public._stock_move(m.id, v_wh, v_q, v_unit, 'GRN', 'PO', po.id, v_num, public._riyadh_today(), it->>'line', 'GRN ' || v_num || ' / ' || po.po_number);
        v_lv := (r->>'value')::numeric;
        v_val := v_val + v_lv;
        v_corr := v_corr + (r->>'correction')::numeric;
        if m.is_serialized then perform public._serials_in(m.id, v_wh, p_serials->(it->>'line'), v_q, po.id, v_num); end if;
      end if;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('line', (it->>'line')::int, 'desc', it->>'desc', 'qty', v_q, 'stocked', m.id is not null,
                   'unitCostSar', case when m.id is not null then round(v_unit, 6) end, 'valueSar', v_lv)
                 || jsonb_strip_nulls(jsonb_build_object('itemId', it->'itemId', 'serials', p_serials->(it->>'line'))));
      it := it || jsonb_build_object('receivedQty', public._num(it->'receivedQty') + v_q, 'receivedValue', public._num(it->'receivedValue') + v_lv,
                                     'warehouse', v_wh) || case when m.id is not null then jsonb_build_object('unitCostSar', round(v_unit, 6)) else '{}'::jsonb end;
    end if;
    v_items := v_items || jsonb_build_array(it);
  end loop;
  if not v_any then raise exception 'Enter a received quantity on at least one line.'; end if;

  v_gl := jsonb_build_array(
    jsonb_build_object('account_code', '1200', 'debit', v_val, 'memo', 'Stock in ' || v_wh),
    jsonb_build_object('account_code', '2150', 'credit', v_val, 'memo', po.supplier_name || ' - ' || po.po_number),
    jsonb_build_object('account_code', '5010', 'debit', greatest(v_corr, 0), 'credit', greatest(-v_corr, 0), 'memo', 'Cost correction (stock was negative)'),
    jsonb_build_object('account_code', '1200', 'debit', greatest(-v_corr, 0), 'credit', greatest(v_corr, 0), 'memo', 'Cost correction (stock was negative)'));
  if v_val <> 0 or v_corr <> 0 then
    perform public._gl_post(public._riyadh_today(), 'GRN', v_num, format('Goods Receipt %s - %s (%s)', v_num, po.supplier_name, po.po_number), v_gl);
  end if;
  insert into public.goods_receipts (grn_number, po_id, po_number, supplier_name, warehouse, receipt_date, lines, value_sar, notes, received_by)
  values (v_num, po.id, po.po_number, po.supplier_name, v_wh, public._riyadh_today(), v_lines, public._r2(v_val), p_notes, public._actor_name())
  returning * into v_grn;
  update public.purchase_orders
     set items = v_items, grn_number = v_num, grn_at = now(), grn_warehouse = v_wh,
         grn_value_sar = coalesce(grn_value_sar, 0) + v_val, grn_source = coalesce(nullif(grn_source, 'legacy'), 'grn'),
         status = public._po_status(v_items, status, paid_amount_fx, total_amount_fx), updated_at = now()
   where id = po.id;
  return v_grn;
end $$;

create or replace function public.post_supplier_bill(p_po_id text, p jsonb default null) returns public.supplier_bills
language plpgsql security definer set search_path = public as $$
declare
  po public.purchase_orders; s jsonb := public._proc_settings(); v_fx numeric; it jsonb; bl jsonb; v_q numeric; v_unit numeric;
  v_open numeric; v_net numeric; v_lines jsonb := '[]'::jsonb; v_items jsonb := '[]'::jsonb; v_goods numeric := 0; v_goods_fx numeric := 0;
  v_landed numeric; v_alloc text; v_qty_tot numeric := 0; v_share numeric; v_grni numeric := 0; v_var numeric := 0; v_line_grni numeric;
  v_line_tot numeric; v_vat_base numeric := 0; v_vat numeric; v_rc numeric := 0; v_total numeric; v_bill text; v_gl jsonb;
  v_warn text[] := '{}'; v_legacy boolean; v_inv_date date; v_due date; v_b public.supplier_bills; v_landed_billed numeric;
  v_ksa_vat boolean; v_tol_p numeric; v_tol_q numeric; v_legacy_1200 numeric := 0; v_n int := 0; v_i int := 0; v_landed_used numeric := 0;
begin
  perform public._require_role('admin','ceo','finance');
  select * into po from public.purchase_orders where id = p_po_id for update;
  if po.id is null then raise exception 'Purchase order % not found.', p_po_id; end if;
  perform public._project_ctx(po.project_id);   -- 0014
  if po.status in ('pending_approval','cancelled') then raise exception 'Purchase order % is % and cannot be billed.', po.po_number, replace(po.status, '_', ' '); end if;
  if not exists (select 1 from jsonb_array_elements(po.items) i where public._num(i->'receivedQty') > public._num(i->'billedQty')) then
    if po.status in ('billed','paid') or coalesce(po.bill_status, '') in ('posted','paid') then
      raise exception 'Purchase order % has already been billed (%).', po.po_number, coalesce(po.bill_number, '');
    end if;
    raise exception 'Record the goods receipt for % before posting the bill.', po.po_number;
  end if;
  v_fx := coalesce(nullif(po.fx_rate, 0), 1);
  v_tol_p := public._num(s->'priceTolerancePct'); v_tol_q := public._num(s->'qtyTolerancePct');
  v_legacy := po.grn_source = 'legacy';
  v_ksa_vat := not coalesce(po.is_foreign_supplier, false) and coalesce(trim(po.supplier_vat), '') <> '';
  v_inv_date := coalesce(nullif(p->>'supplierInvoiceDate', '')::date, public._riyadh_today());
  if v_inv_date > public._riyadh_today() then raise exception 'The supplier invoice date cannot be in the future.'; end if;
  if p is not null and coalesce(trim(p->>'supplierInvoiceNo'), '') = '' then raise exception 'Enter the supplier''s invoice number.'; end if;

  -- what to bill per PO line
  for it in select x from jsonb_array_elements(po.items) x order by (x->>'line')::int loop
    v_open := public._num(it->'receivedQty') - public._num(it->'billedQty');
    if p is null or p->'lines' is null then
      v_q := greatest(v_open, 0); v_unit := public._num(it->'unitCostFx');
    else
      select x into bl from jsonb_array_elements(p->'lines') x where (x->>'line')::int = (it->>'line')::int limit 1;
      v_q := coalesce(public._num(bl->'qty'), 0);
      v_unit := case when bl ? 'unitCostFx' and bl->>'unitCostFx' <> '' then public._num(bl->'unitCostFx') else public._num(it->'unitCostFx') end;
    end if;
    if v_q < 0 or v_unit < 0 then raise exception 'Line %: quantity and price cannot be negative.', it->>'line'; end if;
    if v_q > v_open * (1 + v_tol_q / 100) + 0.0001 then
      raise exception 'Line % (%): billing % but only % received and not yet billed (3-way match). Receive the goods first or correct the bill.',
        it->>'line', it->>'desc', v_q, greatest(v_open, 0);
    end if;
    if v_q > 0 then
      v_n := v_n + 1;
      if public._num(it->'unitCostFx') > 0 and abs(v_unit - public._num(it->'unitCostFx')) / public._num(it->'unitCostFx') * 100 > v_tol_p then
        v_warn := array_append(v_warn, format('Line %s (%s): billed price %s vs PO %s %s (%s%% difference, tolerance %s%%).', it->>'line', it->>'desc',
                   round(v_unit, 4), round(public._num(it->'unitCostFx'), 4), po.currency,
                   round((v_unit - public._num(it->'unitCostFx')) / public._num(it->'unitCostFx') * 100, 1), v_tol_p));
      end if;
      v_net := public._r2(v_q * v_unit * v_fx);
      v_goods := v_goods + v_net; v_goods_fx := v_goods_fx + v_q * v_unit; v_qty_tot := v_qty_tot + v_q;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('line', (it->>'line')::int, 'desc', it->>'desc', 'qty', v_q, 'unitCostFx', v_unit,
                   'poUnitCostFx', public._num(it->'unitCostFx'), 'netSar', v_net, 'vatCategory', coalesce(it->>'vatCategory', 'S'),
                   'stocked', coalesce((it->>'is_stocked_item')::boolean, false) and it ? 'itemId'));
    end if;
  end loop;
  if v_n = 0 then raise exception 'Enter a quantity on at least one bill line.'; end if;

  -- landed cost on this bill: as entered, else what the PO still has unbilled
  select coalesce(sum(landed_sar), 0) into v_landed_billed from public.supplier_bills where po_id = po.id;
  v_landed := public._r2(case when p ? 'landedCostSar' and p->>'landedCostSar' <> '' then public._num(p->'landedCostSar')
                              else greatest(coalesce(po.landed_cost_sar, 0) - v_landed_billed, 0) end);
  v_alloc := case when p->>'landedAllocation' = 'qty' then 'qty' else 'value' end;

  -- per line: landed share, GRNI cleared, variance
  for bl in select x from jsonb_array_elements(v_lines) x loop
    v_i := v_i + 1;
    v_share := case when v_i = v_n then v_landed - v_landed_used
                    when v_alloc = 'qty' and v_qty_tot > 0 then public._r2(v_landed * public._num(bl->'qty') / v_qty_tot)
                    when v_goods > 0 then public._r2(v_landed * public._num(bl->'netSar') / v_goods)
                    else public._r2(v_landed / v_n) end;
    v_landed_used := v_landed_used + v_share;
    v_line_tot := public._num(bl->'netSar') + v_share;
    select x into it from jsonb_array_elements(po.items) x where (x->>'line')::int = (bl->>'line')::int;
    v_line_grni := 0;
    if (bl->>'stocked')::boolean and not v_legacy then
      -- clear GRNI pro rata to the quantity billed; the last bill on the line clears what is left
      v_line_grni := case when public._num(it->'billedQty') + public._num(bl->'qty') >= public._num(it->'receivedQty') - 0.0001
                          then public._num(it->'receivedValue') - public._num(it->'grniCleared')
                          else public._r2(public._num(it->'receivedValue') * public._num(bl->'qty') / nullif(public._num(it->'receivedQty'), 0)) end;
      v_grni := v_grni + v_line_grni;
      v_var := v_var + (v_line_tot - v_line_grni);
    elsif (bl->>'stocked')::boolean and v_legacy then
      v_legacy_1200 := v_legacy_1200 + v_line_tot;       -- received under the old rules: into 1200 as before
    else
      v_var := v_var + v_line_tot;                        -- non-stock: straight to cost of sales
    end if;
    if bl->>'vatCategory' = 'S' then v_vat_base := v_vat_base + v_line_tot; end if;
    bl := bl || jsonb_build_object('landedSar', v_share, 'grniSar', v_line_grni, 'varianceSar', case when (bl->>'stocked')::boolean and not v_legacy then v_line_tot - v_line_grni else 0 end);
    v_items := v_items || jsonb_build_array(bl);
  end loop;
  v_lines := v_items;
  v_vat := case when v_ksa_vat then public._r2(v_vat_base * 0.15) else 0 end;
  if coalesce(po.is_foreign_supplier, false) and po.supply_type = 'services' then v_rc := public._r2((v_goods + v_landed) * 0.15); end if;
  v_total := public._r2(v_goods + v_landed + v_vat);
  v_bill := public.next_doc_number('BILL');
  v_due := coalesce(nullif(p->>'dueDate', '')::date, v_inv_date + public._terms_days(po.payment_terms));

  v_gl := jsonb_build_array(
    jsonb_build_object('account_code', '2150', 'debit', greatest(v_grni, 0), 'credit', greatest(-v_grni, 0), 'memo', 'Clear goods received not invoiced'),
    jsonb_build_object('account_code', '1200', 'debit', v_legacy_1200, 'memo', 'Goods received before 0011'),
    jsonb_build_object('account_code', case when po.project_id is not null and po.cost_type = 'subcontract' then '5300' else '5010' end, 'debit', greatest(v_var, 0), 'credit', greatest(-v_var, 0), 'memo', 'Non-stock lines / price and landed cost differences'),
    jsonb_build_object('account_code', '1150', 'debit', v_vat, 'memo', case when v_vat > 0 then 'Supplier VAT ' || po.supplier_vat else '' end),
    jsonb_build_object('account_code', '2010', 'credit', v_total, 'memo', po.supplier_name || coalesce(' inv ' || nullif(p->>'supplierInvoiceNo', ''), '')));
  if v_rc > 0 then
    v_gl := v_gl || jsonb_build_array(
      jsonb_build_object('account_code', '1150', 'debit', v_rc, 'memo', 'Reverse charge VAT (input)'),
      jsonb_build_object('account_code', '2100', 'credit', v_rc, 'memo', 'Reverse charge VAT (output)'));
  end if;
  perform public._gl_post(v_inv_date, 'SUPPLIER_BILL', v_bill,
    format('Supplier Bill %s - %s (%s)%s', v_bill, po.supplier_name, po.po_number, coalesce(' / inv ' || nullif(p->>'supplierInvoiceNo', ''), '')), v_gl);

  insert into public.supplier_bills (bill_number, po_id, po_number, vendor_id, supplier_name, supplier_vat, supplier_invoice_no, supplier_invoice_date,
                                     bill_date, due_date, payment_terms, currency, fx_rate, lines, goods_fx, goods_sar, landed_sar, landed_allocation,
                                     supplier_vat_sar, reverse_charge_vat_sar, total_fx, total_sar, grni_cleared_sar, variance_sar,
                                     is_foreign_supplier, supply_type, warnings, notes, posted_by)
  values (v_bill, po.id, po.po_number, po.vendor_id, po.supplier_name, po.supplier_vat, nullif(trim(p->>'supplierInvoiceNo'), ''), v_inv_date,
          v_inv_date, v_due, po.payment_terms, coalesce(po.currency, 'SAR'), v_fx, v_lines, public._r2(v_goods_fx), public._r2(v_goods), v_landed, v_alloc,
          v_vat, v_rc, public._r2(v_total / v_fx), v_total, public._r2(v_grni), public._r2(v_var), coalesce(po.is_foreign_supplier, false),
          coalesce(po.supply_type, 'goods'), v_warn, p->>'notes', public._actor_name())
  returning * into v_b;

  -- update the PO lines and status
  select jsonb_agg(case when b.x is null then i else i || jsonb_build_object(
           'billedQty', public._num(i->'billedQty') + public._num(b.x->'qty'),
           'billedSar', public._num(i->'billedSar') + public._num(b.x->'netSar') + public._num(b.x->'landedSar'),
           'grniCleared', public._num(i->'grniCleared') + public._num(b.x->'grniSar')) end order by (i->>'line')::int)
    into v_items
  from jsonb_array_elements(po.items) i
  left join lateral (select x from jsonb_array_elements(v_lines) x where (x->>'line')::int = (i->>'line')::int) b on true;
  update public.purchase_orders
     set items = v_items, bill_number = v_bill, billed_at = now(),
         billed_total_sar = billed_total_sar + v_total, billed_total_fx = billed_total_fx + public._r2(v_total / v_fx),
         reverse_charge_vat_sar = coalesce(reverse_charge_vat_sar, 0) + v_rc,
         -- once everything is billed the bills, not the estimate, are what is owed
         total_amount_fx = case when public._po_status(v_items, status, paid_amount_fx, total_amount_fx) in ('billed','paid')
                                then billed_total_fx + public._r2(v_total / v_fx) else greatest(total_amount_fx, billed_total_fx + public._r2(v_total / v_fx)) end,
         updated_at = now()
   where id = po.id returning * into po;
  update public.purchase_orders
     set status = public._po_status(items, status, paid_amount_fx, total_amount_fx),
         bill_status = case when public._po_status(items, status, paid_amount_fx, total_amount_fx) = 'paid' then 'paid'
                            when public._po_status(items, status, paid_amount_fx, total_amount_fx) in ('billed','closed') then 'posted' else 'partial' end
   where id = po.id;
  return v_b;
end $$;

create or replace function public.post_purchase_order(p jsonb) returns public.purchase_orders
language plpgsql security definer set search_path = public as $$
declare
  v_fx numeric := nullif(public._num(p->'fx_rate'), 0); v_items jsonb; v_goods_fx numeric; v_goods numeric; v_landed numeric; v_vat numeric;
  v_vat_base numeric; so public.sales_orders; v_po public.purchase_orders; vend public.vendors; v_foreign boolean; v_supply text;
  v_total numeric; s jsonb := public._proc_settings(); v_level text; v_bad text; v_pr public.purchase_requisitions;
begin
  perform public._require_role('admin','ceo','procurement');
  if coalesce(trim(p->>'supplier_name'), '') = '' then raise exception 'Supplier is required.'; end if;
  v_fx := coalesce(v_fx, public.fx_rate(p->>'currency'));
  select coalesce(jsonb_agg(jsonb_build_object(
           'line', o, 'desc', coalesce(nullif(trim(i->>'desc'), ''), (select name_en from public.items where id = i->>'itemId'), 'Item'),
           'qty', public._num(i->'qty'), 'uom', coalesce(nullif(i->>'uom', ''), (select uom from public.items where id = i->>'itemId'), 'PCS'),
           'unitCostFx', public._num(i->'unitCostFx'),
           'vatCategory', coalesce(nullif(upper(i->>'vatCategory'), ''), (select nullif(upper(zatca_vat_type), '') from public.items where id = i->>'itemId'), 'S'),
           'is_stocked_item', coalesce((i->>'is_stocked_item')::boolean, (select is_stocked_item from public.items where id = i->>'itemId'), false),
           'receivedQty', 0, 'receivedValue', 0, 'billedQty', 0, 'billedSar', 0, 'grniCleared', 0, 'closedQty', 0)
         || jsonb_strip_nulls(jsonb_build_object('itemId', nullif(i->>'itemId', ''), 'soId', coalesce(nullif(i->>'soId', ''), nullif(p->>'so_id', '')),
                                                 'soLineId', nullif(i->>'soLineId', ''))) order by o), '[]'::jsonb)
    into v_items
  from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) with ordinality as x(i, o)
  where public._num(i->'qty') <> 0 or coalesce(trim(i->>'desc'), '') <> '';
  if jsonb_array_length(v_items) = 0 then raise exception 'A purchase order needs at least one line.'; end if;
  select string_agg(format('line %s', i->>'line'), ', ') into v_bad from jsonb_array_elements(v_items) i
   where public._num(i->'qty') <= 0 or public._num(i->'unitCostFx') < 0 or (i->>'vatCategory') not in ('S','Z','E','O');
  if v_bad is not null then raise exception 'Every PO line needs a quantity above zero, a cost of zero or more and a VAT category S/Z/E/O (%).', v_bad; end if;
  -- 0011: a stocked line must name a stocked item, so the goods receipt can put it into stock
  if exists (select 1 from jsonb_array_elements(v_items) i
             where (i->>'is_stocked_item')::boolean
               and not exists (select 1 from public.items m where m.id = i->>'itemId' and m.is_stocked_item)) then
    raise exception 'A stocked purchase order line must be linked to an item marked "stocked" in the item master.';
  end if;

  select sum(public._num(i->'qty') * public._num(i->'unitCostFx')) into v_goods_fx from jsonb_array_elements(v_items) i;
  v_goods := v_goods_fx * v_fx;
  v_landed := public._num(p->'landed_cost_sar');
  if nullif(p->>'vendor_id', '') is not null then select * into vend from public.vendors where id = p->>'vendor_id'; end if;
  v_foreign := coalesce((p->>'is_foreign_supplier')::boolean, coalesce(vend.vendor_origin, 'KSA') <> 'KSA');
  v_supply := case when p->>'supply_type' = 'services' then 'services' else 'goods' end;
  -- KSA VAT only from a KSA supplier with a VAT number, on standard-rated lines and their share of the landed cost
  select coalesce(sum(public._num(i->'qty') * public._num(i->'unitCostFx') * v_fx) filter (where i->>'vatCategory' = 'S'), 0) into v_vat_base from jsonb_array_elements(v_items) i;
  v_vat_base := v_vat_base + case when v_goods > 0 then v_landed * v_vat_base / v_goods else v_landed end;
  v_vat := case when not v_foreign and coalesce(trim(p->>'supplier_vat'), '') <> '' then public._r2(v_vat_base * 0.15) else 0 end;
  v_total := public._r2(v_goods + v_landed + v_vat);
  v_level := case when v_total > public._num(s->'ceoApprovalAboveSar') then 'ceo'
                  when v_total > public._num(s->'managerApprovalAboveSar') then 'manager' end;
  if nullif(p->>'so_id', '') is not null then select * into so from public.sales_orders where id = p->>'so_id'; end if;
  if nullif(p->>'pr_id', '') is not null then
    select * into v_pr from public.purchase_requisitions where id = p->>'pr_id' for update;
    if v_pr.id is null or v_pr.status <> 'open' then raise exception 'Requisition % is not open.', coalesce(v_pr.pr_number, p->>'pr_id'); end if;
  end if;

  insert into public.purchase_orders (po_number, so_id, so_number, supplier_name, supplier_vat, currency, fx_rate, status, items,
                                      goods_total_fx, goods_total_sar, landed_cost_sar, supplier_vat_sar, total_amount_fx, total_landed_sar,
                                      input_vat_sar, is_ksa_vat_recoverable, paid_amount_fx, paid_amount_sar, payment_status, bill_status,
                                      vendor_id, supply_type, is_foreign_supplier, payment_terms, approval_status, approval_level, pr_id, raised_by_uid, project_id, cost_type)
  values (public.next_doc_number('PO'), so.id, coalesce(so.so_number, ''), trim(p->>'supplier_name'), coalesce(p->>'supplier_vat', ''),
          coalesce(p->>'currency', 'SAR'), v_fx, case when v_level is null then 'po_issued' else 'pending_approval' end, v_items,
          public._r2(v_goods_fx), public._r2(v_goods), public._r2(v_landed), v_vat,
          public._r2(v_total / v_fx), public._r2(v_goods + v_landed), v_vat, v_vat > 0, 0, 0, 'unpaid', 'unbilled',
          vend.id, v_supply, v_foreign, coalesce(nullif(p->>'payment_terms', ''), vend.payment_terms, 'Net 30'),
          case when v_level is null then 'not_required' else 'pending' end, v_level, v_pr.id, auth.uid(),
          coalesce(nullif(p->>'project_id', ''), so.project_id), case when p->>'cost_type' = 'subcontract' then 'subcontract' else 'material' end)
  returning * into v_po;
  if v_pr.id is not null then
    update public.purchase_requisitions set status = 'ordered', po_ids = array_append(po_ids, v_po.id), updated_at = now() where id = v_pr.id;
  end if;
  return v_po;
end $$;

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
  perform public._project_ctx(nullif(p->>'project_id', ''));   -- 0014

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
                                       status, journal_voucher_number, posted_by, project_id)
  values (v_num, v_date, trim(p->>'payee'), nullif(p->>'vendor_id', ''), v_exp, coalesce(p->>'description', ''), coalesce(p->>'division', 'Shared'),
          v_net, v_vat, v_total, v_rec, v_from, coalesce(p->>'payment_reference', ''), 'posted', v_jv.voucher_number, public._actor_name(), nullif(p->>'project_id', ''))
  returning * into v_row;
  return v_row;
end $$;

create or replace function public._customer_exposure(p_customer_id text, p_client_name text, p_exclude_so text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c public.customers; v_name text := lower(trim(coalesce(p_client_name, ''))); v_ar numeric; v_so numeric; v_overdue int; v_oldest int;
  v_days int := public._num(public._sales_settings()->'overdueBlockDays')::int;
begin
  select * into c from public.customers
   where id = coalesce(p_customer_id, '') or (coalesce(p_customer_id, '') = '' and lower(trim(name_en)) = v_name)
   order by (id = coalesce(p_customer_id, '')) desc limit 1;
  with inv as (
    select i.*, i.grand_total_sar + coalesce(i.debited_amount_sar, 0) - coalesce(i.paid_amount_sar, 0) - coalesce(i.credited_amount_sar, 0) as open
    from public.invoices i
    where (c.id is not null and i.customer_id = c.id) or lower(trim(i.client_name)) = coalesce(lower(trim(c.name_en)), v_name)
  )
  select coalesce(sum(open) filter (where open > 0.009), 0),
         count(*) filter (where open > 0.009 and public._riyadh_today() - coalesce(due_date, public.riyadh_date(issued_at) + 30) > v_days),
         max(public._riyadh_today() - coalesce(due_date, public.riyadh_date(issued_at) + 30)) filter (where open > 0.009)
    into v_ar, v_overdue, v_oldest from inv;
  -- 0014: orders of a project are open for what the project has not billed yet (all its invoices count, whichever SO)
  with mine as (
    select so.* from public.sales_orders so
    where so.status not in ('cancelled')
      and ((c.id is not null and so.customer_id = c.id) or lower(trim(so.client_name)) = coalesce(lower(trim(c.name_en)), v_name))
      and so.id is distinct from p_exclude_so
      and (so.project_id is null or so.project_id is distinct from (select project_id from public.sales_orders where id = p_exclude_so))
  )
  select coalesce(sum(o), 0) into v_so from (
    select greatest(0, so.grand_total_sar - coalesce((select sum(grand_total_sar) from public.invoices where so_id = so.id), 0)) as o
    from mine so where so.project_id is null
    union all
    select greatest(0, sum(so.grand_total_sar) - coalesce((select sum(i.grand_total_sar) from public.invoices i where i.project_id = so.project_id), 0))
    from mine so where so.project_id is not null group by so.project_id
  ) x;
  return jsonb_build_object('customerId', c.id, 'customer', coalesce(c.name_en, p_client_name), 'creditLimit', coalesce(c.credit_limit_sar, 0),
    'paymentTerms', coalesce(c.payment_terms, 'Net 30'), 'openAr', public._r2(v_ar), 'openOrders', public._r2(v_so),
    'overdueInvoices', v_overdue, 'oldestDaysPastDue', greatest(coalesce(v_oldest, 0), 0), 'overdueBlockDays', v_days);
end $$;

create or replace function public._invoice_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare e jsonb; v_prob text[]; v_terms text; v_so_open numeric := 0;
begin
  v_terms := coalesce(nullif(new.payment_terms, ''), (select nullif(payment_terms, '') from public.sales_orders where id = new.so_id),
                      (select payment_terms from public.customers where id = new.customer_id), 'Net 30');
  new.payment_terms := v_terms;
  new.due_date := coalesce(new.due_date, public.riyadh_date(coalesce(new.issued_at, now())) + public._terms_days(v_terms));
  if public.is_maintenance_session() then return new; end if;
  e := public._customer_exposure(new.customer_id, new.client_name, new.so_id);
  -- invoicing an order turns its open value into receivables: the limit is checked only for what goes beyond it
  if new.project_id is not null and exists (select 1 from public.sales_orders where project_id = new.project_id) then
    -- 0014: a project's orders turn into its invoices, whichever order an invoice names
    select greatest(0, coalesce(sum(so.grand_total_sar), 0) - coalesce((select sum(grand_total_sar) from public.invoices where project_id = new.project_id), 0))
      into v_so_open from public.sales_orders so where so.project_id = new.project_id and so.status <> 'cancelled';
  elsif new.so_id is not null then
    select greatest(0, so.grand_total_sar - coalesce((select sum(grand_total_sar) from public.invoices where so_id = so.id), 0)) into v_so_open
      from public.sales_orders so where so.id = new.so_id;
  end if;
  v_prob := public._credit_problems(e || jsonb_build_object('openOrders', public._num(e->'openOrders') + coalesce(v_so_open, 0)),
                                    greatest(0, new.grand_total_sar - coalesce(v_so_open, 0)),
                                    new.grand_total_sar > coalesce(v_so_open, 0) + 0.01);
  if cardinality(v_prob) > 0 and not public._use_credit_override('INVOICE', coalesce(new.dn_id, new.billing_source_id, ''), new.invoice_number) then
    raise exception 'Credit check failed for %: %. Ask Finance for a credit override before invoicing.', new.client_name, array_to_string(v_prob, '; ')
      using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function public.grant_credit_override(p_doc_type text, p_ref_id text, p_reason text) returns public.credit_overrides
language plpgsql security definer set search_path = public as $$
declare o public.credit_overrides; v_client text;
begin
  perform public._require_role('admin','ceo','finance');
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for the credit override.'; end if;
  v_client := case p_doc_type when 'SO' then (select data->>'clientName' from public.inquiries where id = p_ref_id)
                              when 'INVOICE' then coalesce((select client_name from public.delivery_notes where id = p_ref_id),   -- 0014: project / contract invoices
                                                (select client_name from public.projects where id = p_ref_id),
                                                (select client_name from public.service_contracts where id = p_ref_id))
                              when 'SO_AMEND' then (select client_name from public.sales_orders where id = p_ref_id) end;
  if v_client is null then raise exception 'Document % not found.', p_ref_id; end if;
  insert into public.credit_overrides (doc_type, ref_id, client_name, reason, granted_by) values (p_doc_type, p_ref_id, v_client, trim(p_reason), public._actor_name())
  returning * into o;
  return o;
end $$;

create or replace function public.zatca_doc_payload(p_doc_type text, p_doc_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  d jsonb; inv public.invoices; c jsonb := public._company(); v_seller jsonb; v_buyer jsonb; v_kind text; v_lines jsonb;
begin
  if p_doc_type = 'invoice' then
    select to_jsonb(i) into d from public.invoices i where id = p_doc_id;
    select * into inv from public.invoices where id = p_doc_id;
    v_kind := 'invoice';
  elsif p_doc_type = 'credit_note' then
    select to_jsonb(x) into d from public.credit_notes x where id = p_doc_id;
    select * into inv from public.invoices where id = d->>'original_invoice_id';
    v_kind := 'credit';
  elsif p_doc_type = 'debit_note' then
    select to_jsonb(x) into d from public.debit_notes x where id = p_doc_id;
    select * into inv from public.invoices where id = d->>'original_invoice_id';
    v_kind := 'debit';
  else
    raise exception 'Unknown document type %.', p_doc_type;
  end if;
  if d is null then raise exception '% % not found.', p_doc_type, p_doc_id; end if;
  if inv.id is null then raise exception 'Original invoice of % % not found.', p_doc_type, p_doc_id; end if;

  -- seller / buyer as snapshotted on the invoice (0009), else today's company profile / customer master
  v_seller := coalesce(inv.seller_address, jsonb_strip_nulls(jsonb_build_object('name', c->>'nameEn', 'vatNumber', c->>'vatNumber', 'crNumber', c->>'crNumber',
    'buildingNo', c->>'buildingNo', 'street', c->>'street', 'district', c->>'district', 'city', c->>'city',
    'postalCode', c->>'postalCode', 'additionalNo', c->>'additionalNo', 'country', 'SA')));
  v_buyer := coalesce(inv.buyer_address, jsonb_build_object('name', inv.client_name, 'vatNumber', inv.client_vat));

  select coalesce(jsonb_agg(jsonb_build_object(
           'name', coalesce(nullif(l->>'desc', ''), nullif(l->>'description', ''), 'Item'),
           'qty', public._num(l->'qty'), 'unitPrice', public._num(l->'unitSellSar'), 'unit', coalesce(l->>'unit', 'PCS'),
           'vatCategory', coalesce(l->>'vatCategory', 'S'), 'vatRate', public._line_rate(l),
           'exemptionCode', case when coalesce(l->>'vatCategory', 'S') = 'S' then null else l->>'exemptionReason' end) order by o), '[]'::jsonb)
    into v_lines
  from jsonb_array_elements(coalesce(d->'items', '[]'::jsonb)) with ordinality as x(l, o)
  where public._num(l->'qty') <> 0;

  return jsonb_build_object(
    'docType', p_doc_type, 'docId', p_doc_id, 'kind', v_kind,
    'number', coalesce(d->>'invoice_number', d->>'credit_note_number', d->>'debit_note_number'),
    'profile', case when inv.invoice_type = 'standard' then 'standard' else 'simplified' end,
    'issuedAt', d->>'issued_at', 'zatcaStatus', d->>'zatca_status', 'zatcaUuid', d->>'zatca_uuid',
    'billingReference', case when v_kind <> 'invoice' then inv.invoice_number end,
    'reason', case when v_kind <> 'invoice' then coalesce(nullif(d->>'reason', ''), d->>'reason_code') end,
    'seller', v_seller, 'buyer', v_buyer, 'lines', v_lines,
    'subtotal', (d->>'subtotal_sar')::numeric, 'vat', (d->>'vat_sar')::numeric, 'grand', (d->>'grand_total_sar')::numeric,
    -- 0014: an advance invoice is ZATCA type 386; a claim lists the advance invoices it deducts (KSA-26..34, BT-113)
    'prepayment', v_kind = 'invoice' and inv.invoice_kind = 'advance',
    'prepaid', case when v_kind = 'invoice' then coalesce(inv.prepaid_sar, 0) else 0 end,
    'prepayments', case when v_kind = 'invoice' then coalesce((
       select jsonb_agg(jsonb_build_object('id', x->>'number', 'uuid', x->>'uuid',
                'issueDate', to_char((x->>'issuedAt')::timestamptz at time zone 'Asia/Riyadh', 'YYYY-MM-DD'),
                'issueTime', to_char((x->>'issuedAt')::timestamptz at time zone 'Asia/Riyadh', 'HH24:MI:SS'),
                'vatCategory', coalesce(x->>'category', 'S'), 'vatRate', (x->>'rate')::numeric,
                'taxable', (x->>'taxable')::numeric, 'vat', (x->>'vat')::numeric) order by o)
       from jsonb_array_elements(inv.prepayments) with ordinality as p(x, o)), '[]'::jsonb) else '[]'::jsonb end);
end $$;


-- ---------------------------------------------------------------------
-- 4. Shared invoice helpers
-- ---------------------------------------------------------------------
-- ZATCA rounding per category: net = sum of rounded line nets, VAT = round(net x rate)
create or replace function public._rounded_breakdown(p_items jsonb) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('category', cat, 'rate', rate, 'exemptionReason', reason, 'net', net, 'vat', public._r2(net * rate))
                            order by cat, reason), '[]'::jsonb)
  from (
    select coalesce(l->>'vatCategory', 'S') as cat, public._line_rate(l) as rate, l->>'exemptionReason' as reason,
           sum(public._r2(public._num(l->'qty') * public._num(l->'unitSellSar'))) as net
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) l
    group by 1, 2, 3
  ) g
$$;

-- Inserts a billing invoice (project / contract). h: {kind, division, so_id, so_number, client_name, client_vat, customer_id,
-- salesman_id, salesman_name, project_id, contract_id, source_id, billing, prepayments, prepaid, retention}
create or replace function public._insert_billing_invoice(h jsonb, p_items jsonb, p_breakdown jsonb, p_sub numeric, p_vat numeric, p_grand numeric)
returns public.invoices
language plpgsql security definer set search_path = public as $$
declare
  c jsonb := public._company(); cust public.customers; v_seller jsonb; v_buyer jsonb; v_warn text[] := '{}'; v_type text;
  v_vatno text := coalesce(nullif(trim(h->>'client_vat'), ''), ''); v_iso text := public._iso_now(); v_num text; v_inv public.invoices;
begin
  select * into cust from public.customers
   where id = coalesce(h->>'customer_id', '') or (coalesce(h->>'customer_id', '') = '' and lower(trim(name_en)) = lower(trim(h->>'client_name')))
   order by (id = coalesce(h->>'customer_id', '')) desc limit 1;
  if v_vatno = '' then v_vatno := coalesce(cust.vat_number, ''); end if;
  v_type := case when v_vatno <> '' then 'standard' else 'simplified' end;
  v_seller := jsonb_strip_nulls(jsonb_build_object('name', c->>'nameEn', 'nameAr', c->>'nameAr', 'vatNumber', c->>'vatNumber', 'crNumber', c->>'crNumber',
    'buildingNo', c->>'buildingNo', 'street', c->>'street', 'district', c->>'district', 'city', c->>'city',
    'postalCode', c->>'postalCode', 'additionalNo', c->>'additionalNo', 'country', 'SA'));
  v_buyer := jsonb_strip_nulls(jsonb_build_object('name', coalesce(cust.name_en, h->>'client_name'), 'nameAr', cust.name_ar, 'vatNumber', nullif(v_vatno, ''),
    'crNumber', cust.cr_number, 'buildingNo', cust.building_no, 'street', cust.street, 'district', cust.district,
    'city', cust.city, 'postalCode', cust.postal_code, 'additionalNo', cust.additional_no, 'country', coalesce(cust.country, 'SA')));
  if not public.is_valid_ksa_vat(c->>'vatNumber') then v_warn := array_append(v_warn, 'Seller VAT number is not 15 digits starting and ending with 3'::text); end if;
  if exists (select 1 from unnest(array['buildingNo','street','district','city','postalCode']) k where coalesce(v_seller->>k, '') = '') then
    v_warn := array_append(v_warn, 'Seller address incomplete (building no., street, district, city, postal code)'::text);
  end if;
  if v_type = 'standard' then
    if not public.is_valid_ksa_vat(v_vatno) then v_warn := array_append(v_warn, ('Buyer VAT number ' || v_vatno || ' is not a valid KSA VAT number')::text); end if;
    if exists (select 1 from unnest(array['buildingNo','street','district','city','postalCode']) k where coalesce(v_buyer->>k, '') = '') then
      v_warn := array_append(v_warn, 'Buyer address incomplete (building no., street, district, city, postal code)'::text);
    end if;
  end if;
  v_num := public.next_doc_number('INVOICE');

  insert into public.invoices (invoice_number, division, invoice_type, so_id, so_number, dn_id, client_name, client_vat,
                               salesman_id, salesman_name, commission_pct, items, subtotal_sar, vat_sar, grand_total_sar,
                               landed_cost_sar, paid_amount_sar, payment_status, zatca_status, qr_base64, locked, issued_at,
                               customer_id, vat_breakdown, seller_address, buyer_address, zatca_warnings,
                               project_id, contract_id, invoice_kind, billing, prepayments, prepaid_sar, retention_sar, billing_source_id)
  values (v_num, coalesce(h->>'division', 'MEP'), v_type, nullif(h->>'so_id', ''), coalesce(h->>'so_number', ''), null,
          h->>'client_name', v_vatno, nullif(h->>'salesman_id', ''), coalesce(nullif(h->>'salesman_name', ''), 'Unassigned'), 0, p_items,
          public._r2(p_sub), public._r2(p_vat), public._r2(p_grand), 0, 0, 'unpaid', 'phase1_qr_ready',
          public._zatca_qr(c->>'nameEn', c->>'vatNumber', v_iso, public._r2(p_sub + p_vat), p_vat), true, v_iso::timestamptz,
          coalesce(nullif(h->>'customer_id', ''), cust.id), p_breakdown, v_seller, v_buyer, v_warn,
          nullif(h->>'project_id', ''), nullif(h->>'contract_id', ''), h->>'kind', coalesce(h->'billing', '{}'::jsonb),
          coalesce(h->'prepayments', '[]'::jsonb), public._r2(public._num(h->'prepaid')), public._r2(public._num(h->'retention')), nullif(h->>'source_id', ''))
  returning * into v_inv;
  return v_inv;
end $$;

-- ---------------------------------------------------------------------
-- 5. Projects
-- ---------------------------------------------------------------------
-- billing position of a project (internal; no role check)
create or replace function public._project_billing(p_project_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  with inv as (select * from public.invoices where project_id = p_project_id),
  ded as (
    select x->>'invoiceId' as adv_id, sum((x->>'taxable')::numeric) as taxable
    from inv cross join lateral jsonb_array_elements(inv.prepayments) x where inv.invoice_kind = 'progress' group by 1
  ),
  adv as (
    select i.id, i.invoice_number, i.issued_at, i.zatca_uuid, i.subtotal_sar as net,
           coalesce((select sum(c.subtotal_sar) from public.credit_notes c where c.original_invoice_id = i.id), 0) as credited,
           coalesce((select taxable from ded where adv_id = i.id), 0) as deducted
    from inv i where i.invoice_kind = 'advance'
  ),
  boq as (
    select l->>'boqCode' as code, sum(public._num(l->'qty')) as qty
    from inv cross join lateral jsonb_array_elements(inv.items) l where inv.invoice_kind = 'progress' and l ? 'boqCode' group by 1
  )
  select jsonb_build_object(
    'claims', (select count(*) from inv where invoice_kind = 'progress'),
    'billedGross', coalesce((select sum(public._num(billing->'gross')) from inv where invoice_kind = 'progress'), 0),
    'lastPercent', coalesce((select public._num(billing->'percentComplete') from inv where invoice_kind = 'progress' order by issued_at desc, invoice_number desc limit 1), 0),
    'advanceNet', coalesce((select sum(net - credited) from adv), 0),
    'advanceDeducted', coalesce((select sum(deducted) from adv), 0),
    'advanceRemaining', coalesce((select sum(greatest(0, net - credited - deducted)) from adv), 0),
    'advances', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'number', invoice_number, 'issuedAt', issued_at, 'uuid', zatca_uuid,
                                'net', net, 'credited', credited, 'deducted', deducted, 'remaining', greatest(0, net - credited - deducted)) order by issued_at, invoice_number) from adv), '[]'::jsonb),
    'retentionHeld', coalesce((select sum(retention_sar) from inv where invoice_kind = 'progress'), 0)
                     - coalesce((select sum(subtotal_sar) from inv where invoice_kind = 'retention'), 0)
                     + coalesce((select sum(c.subtotal_sar) from public.credit_notes c join inv on inv.id = c.original_invoice_id where inv.invoice_kind = 'retention'), 0),
    'retentionReleased', coalesce((select sum(subtotal_sar) from inv where invoice_kind = 'retention'), 0),
    'invoicedTotal', coalesce((select sum(grand_total_sar) from inv), 0),
    'boqQty', coalesce((select jsonb_object_agg(code, qty) from boq), '{}'::jsonb))
$$;

create or replace function public.project_billing(p_project_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_role('admin','ceo','finance','manager','procurement');
  return public._project_billing(p_project_id);
end $$;

create or replace function public.save_project(p jsonb) returns public.projects
language plpgsql security definer set search_path = public as $$
declare
  pr public.projects; cust public.customers; v_id text := nullif(p->>'id', ''); v_boq jsonb; v_bad text; v_billed boolean;
  v_method text := coalesce(nullif(p->>'billing_method', ''), 'delivery'); v_value numeric; v_ret numeric := coalesce(public._num(p->'retention_pct'), 0);
  st jsonb; v_budget jsonb;
begin
  perform public._require_role('admin','ceo','manager','finance');
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Project name is required.'; end if;
  if v_method not in ('delivery','percent','boq') then raise exception 'Billing method must be delivery, percent or boq.'; end if;
  if nullif(p->>'customer_id', '') is not null then
    select * into cust from public.customers where id = p->>'customer_id';
    if cust.id is null then raise exception 'Customer % not found.', p->>'customer_id'; end if;
  end if;
  if coalesce(cust.name_en, nullif(trim(p->>'client_name'), '')) is null then raise exception 'Choose the customer.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('code', trim(b->>'code'), 'description', coalesce(b->>'description', ''), 'unit', coalesce(nullif(trim(b->>'unit'), ''), 'LS'),
                                               'qty', public._num(b->'qty'), 'rate', public._num(b->'rate')) order by o), '[]'::jsonb)
    into v_boq
  from jsonb_array_elements(coalesce(p->'boq', '[]'::jsonb)) with ordinality as x(b, o)
  where coalesce(trim(b->>'code'), '') <> '';
  select string_agg(code, ', ') into v_bad from (select b->>'code' as code from jsonb_array_elements(v_boq) b group by 1 having count(*) > 1) d;
  if v_bad is not null then raise exception 'BOQ codes must be unique (repeated: %).', v_bad; end if;
  if exists (select 1 from jsonb_array_elements(v_boq) b where public._num(b->'qty') <= 0 or public._num(b->'rate') < 0) then
    raise exception 'Each BOQ line needs a quantity above zero and a rate of zero or more.';
  end if;
  if v_method = 'boq' then
    if jsonb_array_length(v_boq) = 0 then raise exception 'BOQ billing needs BOQ lines.'; end if;
    select coalesce(sum(public._r2(public._num(b->'qty') * public._num(b->'rate'))), 0) into v_value from jsonb_array_elements(v_boq) b;
  else
    v_value := public._r2(public._num(p->'contract_value_sar'));
  end if;
  if v_method <> 'delivery' and v_value <= 0 then raise exception 'Enter the contract value (excl. VAT) for progress billing.'; end if;
  v_budget := jsonb_build_object('revenue', public._r2(public._num(p->'budget'->'revenue')), 'material', public._r2(public._num(p->'budget'->'material')),
                                 'labour', public._r2(public._num(p->'budget'->'labour')), 'subcontract', public._r2(public._num(p->'budget'->'subcontract')),
                                 'other', public._r2(public._num(p->'budget'->'other')));

  if v_id is null then
    insert into public.projects (project_code, name, customer_id, client_name, client_vat, division, cost_centre, project_manager, status,
                                 contract_value_sar, billing_method, retention_pct, advance_pct, budget, boq, start_date, end_date, notes)
    values (public.next_doc_number('PROJECT'), trim(p->>'name'), cust.id, coalesce(cust.name_en, trim(p->>'client_name')),
            coalesce(nullif(trim(p->>'client_vat'), ''), cust.vat_number, ''),
            case when p->>'division' = 'IT & ELV' then 'IT & ELV' else 'MEP' end, coalesce(trim(p->>'cost_centre'), ''),
            coalesce(trim(p->>'project_manager'), ''), 'active', v_value, v_method, v_ret, coalesce(public._num(p->'advance_pct'), 0),
            v_budget, v_boq, nullif(p->>'start_date', '')::date, nullif(p->>'end_date', '')::date, coalesce(p->>'notes', ''))
    returning * into pr;
    return pr;
  end if;

  select * into pr from public.projects where id = v_id for update;
  if pr.id is null then raise exception 'Project % not found.', v_id; end if;
  v_billed := exists (select 1 from public.invoices where project_id = pr.id and invoice_kind in ('advance','progress','retention'));
  if v_billed then
    st := public._project_billing(pr.id);
    if v_method <> pr.billing_method or v_ret <> pr.retention_pct then
      raise exception 'Project % has been billed: its billing method and retention %% can no longer change.', pr.project_code;
    end if;
    if coalesce(cust.id, '') is distinct from coalesce(pr.customer_id, '') and cust.id is not null then
      raise exception 'Project % has been billed: the customer can no longer change.', pr.project_code;
    end if;
    if v_value < public._num(st->'billedGross') - 0.005 then
      raise exception 'The contract value cannot go below what has been claimed (SAR %).', public._num(st->'billedGross');
    end if;
    select string_agg(o->>'code', ', ') into v_bad
    from jsonb_array_elements(pr.boq) o
    where public._num(st->'boqQty'->(o->>'code')) > 0
      and not exists (select 1 from jsonb_array_elements(v_boq) n where n->>'code' = o->>'code' and public._num(n->'rate') = public._num(o->'rate')
                                                                    and public._num(n->'qty') >= public._num(st->'boqQty'->(o->>'code')));
    if v_bad is not null then raise exception 'BOQ lines already claimed keep their rate and cannot drop below the claimed quantity: %.', v_bad; end if;
  end if;
  update public.projects set
    name = trim(p->>'name'), customer_id = coalesce(cust.id, customer_id), client_name = coalesce(cust.name_en, nullif(trim(p->>'client_name'), ''), client_name),
    client_vat = coalesce(nullif(trim(p->>'client_vat'), ''), cust.vat_number, client_vat),
    division = case when v_billed then division when p->>'division' = 'IT & ELV' then 'IT & ELV' else 'MEP' end,
    cost_centre = coalesce(trim(p->>'cost_centre'), cost_centre), project_manager = coalesce(trim(p->>'project_manager'), project_manager),
    status = case when p->>'status' in ('active','on_hold','completed','closed') then p->>'status' else status end,
    contract_value_sar = v_value, billing_method = v_method, retention_pct = v_ret, advance_pct = coalesce(public._num(p->'advance_pct'), advance_pct),
    budget = v_budget, boq = v_boq, start_date = nullif(p->>'start_date', '')::date, end_date = nullif(p->>'end_date', '')::date,
    notes = coalesce(p->>'notes', notes), updated_at = now()
  where id = pr.id returning * into pr;
  return pr;
end $$;

create or replace function public.link_sales_order_to_project(p_so_id text, p_project_id text) returns public.sales_orders
language plpgsql security definer set search_path = public as $$
declare so public.sales_orders; pr public.projects;
begin
  perform public._require_role('admin','ceo','manager','finance');
  select * into so from public.sales_orders where id = p_so_id for update;
  if so.id is null then raise exception 'Sales Order % not found.', p_so_id; end if;
  if nullif(p_project_id, '') is null then
    if exists (select 1 from public.invoices where so_id = so.id and invoice_kind in ('advance','progress','retention')) then
      raise exception 'Sales Order % carries project invoices and cannot be unlinked.', so.so_number;
    end if;
    update public.sales_orders set project_id = null where id = so.id returning * into so;
    update public.projects set main_so_id = (select id from public.sales_orders where project_id = projects.id order by created_at limit 1), updated_at = now()
     where main_so_id = p_so_id;
    return so;
  end if;
  select * into pr from public.projects where id = p_project_id for update;
  if pr.id is null then raise exception 'Project % not found.', p_project_id; end if;
  if pr.status = 'closed' then raise exception 'Project % is closed.', pr.project_code; end if;
  if not ((pr.customer_id is not null and so.customer_id = pr.customer_id) or lower(trim(so.client_name)) = lower(trim(pr.client_name))) then
    raise exception 'Sales Order % is for %, project % is for %.', so.so_number, so.client_name, pr.project_code, pr.client_name;
  end if;
  if coalesce(so.division, 'MEP') <> pr.division then raise exception 'Sales Order % is % division; project % is %.', so.so_number, so.division, pr.project_code, pr.division; end if;
  if pr.billing_method <> 'delivery' and exists (select 1 from public.invoices where so_id = so.id) then
    raise exception 'Sales Order % has already been invoiced per delivery; project % is billed by progress claims.', so.so_number, pr.project_code;
  end if;
  update public.sales_orders set project_id = pr.id where id = so.id returning * into so;
  update public.projects set main_so_id = coalesce(main_so_id, so.id), updated_at = now() where id = pr.id;
  return so;
end $$;

-- header for a project invoice
create or replace function public._project_header(pr public.projects, p_kind text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('kind', p_kind, 'division', pr.division, 'so_id', so.id, 'so_number', coalesce(so.so_number, ''),
           'client_name', pr.client_name, 'client_vat', coalesce(nullif(pr.client_vat, ''), so.client_vat, ''), 'customer_id', coalesce(pr.customer_id, so.customer_id),
           'salesman_id', so.salesman_id, 'salesman_name', so.salesman_name, 'project_id', pr.id, 'source_id', pr.id)
  from (select 1) one left join public.sales_orders so on so.id = pr.main_so_id
$$;

create or replace function public._project_for_billing(p_project_id text) returns public.projects
language plpgsql security definer set search_path = public as $$
declare pr public.projects;
begin
  select * into pr from public.projects where id = p_project_id for update;
  if pr.id is null then raise exception 'Project % not found.', p_project_id; end if;
  if pr.status not in ('active','completed') then raise exception 'Project % is % and cannot be billed.', pr.project_code, replace(pr.status, '_', ' '); end if;
  if pr.contract_value_sar <= 0 then raise exception 'Project % has no contract value.', pr.project_code; end if;
  return pr;
end $$;

-- 5.1 Advance payment invoice (ZATCA 386). Amount excl. VAT; default = advance % of the contract value.
create or replace function public.post_advance_invoice(p_project_id text, p_amount_sar numeric default null, p_note text default '') returns public.invoices
language plpgsql security definer set search_path = public as $$
declare
  pr public.projects; st jsonb; v_amt numeric; v_rate numeric := public._vat_rate('S'); v_vat numeric; v_items jsonb; v_inv public.invoices; h jsonb;
begin
  perform public._require_role('admin','ceo','finance');
  pr := public._project_for_billing(p_project_id);
  if pr.billing_method = 'delivery' then raise exception 'Project % is billed per delivery; set it to percent or BOQ billing to use advances and claims.', pr.project_code; end if;
  st := public._project_billing(pr.id);
  v_amt := public._r2(coalesce(p_amount_sar, pr.contract_value_sar * pr.advance_pct / 100));
  if v_amt <= 0 then raise exception 'Enter the advance amount (excl. VAT).'; end if;
  if public._num(st->'advanceNet') + v_amt > pr.contract_value_sar + 0.005 then
    raise exception 'Advances (SAR %) would exceed the contract value (SAR %).', public._num(st->'advanceNet') + v_amt, pr.contract_value_sar;
  end if;
  if public._num(st->'billedGross') >= pr.contract_value_sar - 0.005 then raise exception 'Project % has been fully claimed.', pr.project_code; end if;
  perform public._project_ctx(pr.id);
  v_vat := public._r2(v_amt * v_rate);
  v_items := jsonb_build_array(jsonb_build_object('desc', format('Advance payment - %s (%s)%s', pr.name, pr.project_code, coalesce(' - ' || nullif(trim(p_note), ''), '')),
               'qty', 1, 'unit', 'LS', 'unitSellSar', v_amt, 'vatCategory', 'S', 'vatRate', v_rate));
  h := public._project_header(pr, 'advance') || jsonb_build_object('billing', jsonb_build_object('note', coalesce(p_note, ''),
         'advancePct', round(v_amt / pr.contract_value_sar * 100, 4), 'contractValue', pr.contract_value_sar));
  v_inv := public._insert_billing_invoice(h, v_items, public._rounded_breakdown(v_items), v_amt, v_vat, v_amt + v_vat);
  perform public._gl_post(public.riyadh_date(v_inv.issued_at), 'INVOICE', v_inv.invoice_number,
    format('Advance invoice %s - %s (%s)', v_inv.invoice_number, pr.client_name, pr.project_code),
    jsonb_build_array(
      jsonb_build_object('account_code', '1100', 'debit', v_amt + v_vat, 'memo', pr.client_name),
      jsonb_build_object('account_code', '2060', 'credit', v_amt, 'memo', 'Advance billed ' || pr.project_code),
      jsonb_build_object('account_code', '2100', 'credit', v_vat, 'memo', 'Output VAT on advance')));
  return v_inv;
end $$;

-- 5.2 Progress claim. p: {percentComplete} (percent billing) or {quantities: {boqCode: cumulative qty}} (BOQ billing),
--     optional advanceDeductionSar (default: pro rata to the value claimed; the rest on the final claim), note.
create or replace function public.post_progress_invoice(p_project_id text, p jsonb) returns public.invoices
language plpgsql security definer set search_path = public as $$
declare
  pr public.projects; st jsonb; v_rate numeric := public._vat_rate('S'); v_prev numeric; v_cum numeric; v_g numeric := 0; v_n numeric := 0;
  v_v numeric; v_r numeric; v_d numeric := 0; v_dv numeric := 0; v_left numeric; v_take numeric; v_items jsonb := '[]'::jsonb; v_boq jsonb := '[]'::jsonb;
  v_pre jsonb := '[]'::jsonb; v_pct numeric; v_prev_pct numeric; v_claim int; v_ret numeric; v_price numeric; v_q numeric; v_pq numeric; v_cq numeric;
  v_final boolean; b jsonb; a jsonb; v_bd jsonb; v_pay numeric; v_inv public.invoices; h jsonb; v_rev text;
begin
  perform public._require_role('admin','ceo','finance');
  pr := public._project_for_billing(p_project_id);
  if pr.billing_method not in ('percent','boq') then raise exception 'Project % is billed per delivery, not by progress claims.', pr.project_code; end if;
  st := public._project_billing(pr.id);
  v_prev := public._num(st->'billedGross'); v_prev_pct := public._num(st->'lastPercent');
  v_claim := (st->>'claims')::int + 1; v_ret := pr.retention_pct;

  if pr.billing_method = 'percent' then
    v_pct := public._num(p->'percentComplete');
    if v_pct <= 0 or v_pct > 100 then raise exception 'Enter the cumulative percentage complete (above 0, at most 100).'; end if;
    v_cum := public._r2(pr.contract_value_sar * v_pct / 100);
    v_g := v_cum - v_prev;
    if v_g <= 0 then raise exception 'Work to date (% %%, SAR %) is not above what has already been claimed (SAR %). Claims are cumulative.', v_pct, v_cum, v_prev; end if;
    v_price := case when v_ret = 0 then v_g else public._r2(v_g * (1 - v_ret / 100)) end;
    v_items := jsonb_build_array(jsonb_build_object(
      'desc', format('Progress claim %s - %s - %s%% complete (previously %s%%)%s', v_claim, pr.name, v_pct, v_prev_pct,
                     case when v_ret > 0 then format(', work value SAR %s less %s%% retention', v_g, v_ret) else '' end),
      'qty', 1, 'unit', 'LS', 'unitSellSar', v_price, 'vatCategory', 'S', 'vatRate', v_rate));
    v_n := v_price;
  else
    if jsonb_typeof(p->'quantities') is distinct from 'object' then raise exception 'Enter the cumulative quantity done per BOQ line.'; end if;
    for b in select x from jsonb_array_elements(pr.boq) x loop
      v_pq := public._num(st->'boqQty'->(b->>'code'));
      v_cq := case when p->'quantities' ? (b->>'code') and p->'quantities'->>(b->>'code') <> '' then public._num(p->'quantities'->(b->>'code')) else v_pq end;
      if v_cq < v_pq - 0.0001 then raise exception 'BOQ %: cumulative quantity % is below what has already been claimed (%). Claims are cumulative.', b->>'code', v_cq, v_pq; end if;
      if v_cq > public._num(b->'qty') + 0.0001 then raise exception 'BOQ %: % is more than the BOQ quantity %. Revise the BOQ (variation) first.', b->>'code', v_cq, public._num(b->'qty'); end if;
      v_q := v_cq - v_pq;
      if v_q > 0 then
        v_price := case when v_ret = 0 then public._num(b->'rate') else public._r2(public._num(b->'rate') * (1 - v_ret / 100)) end;
        v_g := v_g + public._r2(v_q * public._num(b->'rate'));
        v_n := v_n + public._r2(v_q * v_price);
        v_items := v_items || jsonb_build_array(jsonb_build_object('desc', trim(format('%s %s%s', b->>'code', b->>'description',
                       case when v_ret > 0 then format(' (rate %s less %s%% retention)', public._num(b->'rate'), v_ret) else '' end)),
                     'qty', v_q, 'unit', b->>'unit', 'unitSellSar', v_price, 'vatCategory', 'S', 'vatRate', v_rate,
                     'boqCode', b->>'code', 'boqRate', public._num(b->'rate')));
      end if;
      v_boq := v_boq || jsonb_build_array(jsonb_build_object('code', b->>'code', 'previousQty', v_pq, 'cumulativeQty', v_cq, 'qty', v_q));
    end loop;
    if v_g <= 0 then raise exception 'Enter cumulative quantities above what has already been claimed on at least one BOQ line.'; end if;
    v_cum := v_prev + v_g;
    v_pct := round(v_cum / pr.contract_value_sar * 100, 2);
  end if;
  v_r := v_g - v_n;
  if v_r < 0 then v_g := v_n; v_r := 0; end if;         -- rounding of rates without retention
  v_final := v_cum >= pr.contract_value_sar - 0.005;

  -- advance deduction (prepayment adjustment), FIFO over the advance invoices
  if public._num(st->'advanceRemaining') > 0 then
    v_d := case when p ? 'advanceDeductionSar' and p->>'advanceDeductionSar' <> '' then public._r2(public._num(p->'advanceDeductionSar'))
                when v_final then public._num(st->'advanceRemaining')
                else public._r2(public._num(st->'advanceNet') * v_g / pr.contract_value_sar) end;
    if v_d < 0 then raise exception 'The advance deduction cannot be negative.'; end if;
    if v_final and v_d < public._num(st->'advanceRemaining') - 0.005 then
      raise exception 'The final claim must deduct the rest of the advance (SAR %).', public._num(st->'advanceRemaining');
    end if;
    v_d := least(v_d, public._num(st->'advanceRemaining'), v_n);
    v_left := v_d;
    for a in select x from jsonb_array_elements(st->'advances') x where public._num(x->'remaining') > 0 loop
      exit when v_left <= 0;
      v_take := least(public._num(a->'remaining'), v_left);
      v_pre := v_pre || jsonb_build_array(jsonb_build_object('invoiceId', a->>'id', 'number', a->>'number', 'issuedAt', a->>'issuedAt', 'uuid', a->>'uuid',
                 'category', 'S', 'rate', v_rate, 'taxable', v_take, 'vat', public._r2(v_take * v_rate)));
      v_dv := v_dv + public._r2(v_take * v_rate);
      v_left := v_left - v_take;
    end loop;
  end if;

  perform public._project_ctx(pr.id);
  v_v := public._r2(v_n * v_rate);
  v_pay := v_n + v_v - v_d - v_dv;
  v_bd := public._rounded_breakdown(v_items);
  if v_d > 0 then
    v_bd := v_bd || jsonb_build_array(jsonb_build_object('category', 'S', 'rate', v_rate, 'exemptionReason', null, 'net', -v_d, 'vat', -v_dv, 'prepayment', true));
  end if;
  h := public._project_header(pr, 'progress') || jsonb_build_object(
         'billing', jsonb_build_object('claimNo', v_claim, 'method', pr.billing_method, 'percentComplete', v_pct, 'previousPercent', v_prev_pct,
                    'previousGross', v_prev, 'cumulativeGross', v_cum, 'gross', v_g, 'retentionPct', v_ret, 'retention', v_r,
                    'advanceDeducted', v_d, 'advanceVatDeducted', v_dv, 'final', v_final, 'boq', v_boq, 'note', coalesce(p->>'note', ''),
                    'contractValue', pr.contract_value_sar),
         'prepayments', v_pre, 'prepaid', v_d + v_dv, 'retention', v_r);
  v_inv := public._insert_billing_invoice(h, v_items, v_bd, v_n, v_v, v_pay);
  v_rev := case when pr.division = 'IT & ELV' then '4020' else '4010' end;
  perform public._gl_post(public.riyadh_date(v_inv.issued_at), 'INVOICE', v_inv.invoice_number,
    format('Progress claim %s (%s) - %s (%s)', v_claim, v_inv.invoice_number, pr.client_name, pr.project_code),
    jsonb_build_array(
      jsonb_build_object('account_code', '1100', 'debit', v_pay, 'memo', pr.client_name),
      jsonb_build_object('account_code', '2060', 'debit', v_d, 'memo', 'Advance deducted'),
      jsonb_build_object('account_code', '1110', 'debit', v_r, 'memo', format('Retention %s%% held', v_ret)),
      jsonb_build_object('account_code', v_rev, 'credit', v_g, 'memo', format('Work done claim %s', v_claim)),
      jsonb_build_object('account_code', '2100', 'credit', greatest(v_v - v_dv, 0), 'debit', greatest(v_dv - v_v, 0), 'memo', 'Output VAT less VAT on advance deducted')));
  return v_inv;
end $$;

-- 5.3 Retention release invoice (VAT charged now). Default: all retention held.
create or replace function public.post_retention_release(p_project_id text, p_amount_sar numeric default null, p_note text default '') returns public.invoices
language plpgsql security definer set search_path = public as $$
declare pr public.projects; st jsonb; v_amt numeric; v_rate numeric := public._vat_rate('S'); v_vat numeric; v_items jsonb; v_inv public.invoices;
begin
  perform public._require_role('admin','ceo','finance');
  select * into pr from public.projects where id = p_project_id for update;
  if pr.id is null then raise exception 'Project % not found.', p_project_id; end if;
  st := public._project_billing(pr.id);
  v_amt := public._r2(coalesce(p_amount_sar, public._num(st->'retentionHeld')));
  if v_amt <= 0 then raise exception 'Project % has no retention to release.', pr.project_code; end if;
  if v_amt > public._num(st->'retentionHeld') + 0.005 then raise exception 'Only SAR % of retention is held on %.', public._num(st->'retentionHeld'), pr.project_code; end if;
  perform public._project_ctx(pr.id);
  v_vat := public._r2(v_amt * v_rate);
  v_items := jsonb_build_array(jsonb_build_object('desc', format('Retention release - %s (%s)%s', pr.name, pr.project_code, coalesce(' - ' || nullif(trim(p_note), ''), '')),
               'qty', 1, 'unit', 'LS', 'unitSellSar', v_amt, 'vatCategory', 'S', 'vatRate', v_rate));
  v_inv := public._insert_billing_invoice(public._project_header(pr, 'retention') || jsonb_build_object('billing', jsonb_build_object('note', coalesce(p_note, ''),
             'retentionHeldBefore', public._num(st->'retentionHeld'))), v_items, public._rounded_breakdown(v_items), v_amt, v_vat, v_amt + v_vat);
  perform public._gl_post(public.riyadh_date(v_inv.issued_at), 'INVOICE', v_inv.invoice_number,
    format('Retention release %s - %s (%s)', v_inv.invoice_number, pr.client_name, pr.project_code),
    jsonb_build_array(
      jsonb_build_object('account_code', '1100', 'debit', v_amt + v_vat, 'memo', pr.client_name),
      jsonb_build_object('account_code', '1110', 'credit', v_amt, 'memo', 'Retention released'),
      jsonb_build_object('account_code', '2100', 'credit', v_vat, 'memo', 'Output VAT on retention')));
  return v_inv;
end $$;

-- 5.4 Job cost
create or replace function public.project_job_cost(p_project_id text default null, p_from date default null, p_to date default null)
returns table (project_id text, project_code text, name text, client_name text, division text, cost_centre text, status text, billing_method text,
               contract_value_sar numeric, budget_revenue_sar numeric, budget_cost_sar numeric,
               revenue_sar numeric, material_sar numeric, labour_sar numeric, subcontract_sar numeric, other_cost_sar numeric,
               total_cost_sar numeric, margin_sar numeric, margin_pct numeric, billed_gross_sar numeric, retention_held_sar numeric, advance_unapplied_sar numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public._require_role('admin','ceo','finance','manager','procurement');
  return query
  with g as (
    select l.project_id as pid,
      sum(case when a.account_type = 'Revenue' then l.credit - l.debit else 0 end) as rev,
      sum(case when l.account_code in ('5010','5020') then l.debit - l.credit else 0 end) as mat,
      sum(case when l.account_code in ('5200','5310') then l.debit - l.credit else 0 end) as lab,
      sum(case when l.account_code = '5300' then l.debit - l.credit else 0 end) as sub,
      sum(case when a.account_type = 'Expense' and l.account_code not in ('5010','5020','5200','5310','5300') then l.debit - l.credit else 0 end) as oth
    from public.gl_journal_lines l join public.gl_accounts a on a.account_code = l.account_code
    where l.project_id is not null and (p_project_id is null or l.project_id = p_project_id)
      and (p_from is null or l.entry_date >= p_from) and (p_to is null or l.entry_date <= p_to)
    group by l.project_id
  )
  select pr.id, pr.project_code, pr.name, pr.client_name, pr.division, pr.cost_centre, pr.status, pr.billing_method,
         pr.contract_value_sar, public._num(pr.budget->'revenue'),
         public._num(pr.budget->'material') + public._num(pr.budget->'labour') + public._num(pr.budget->'subcontract') + public._num(pr.budget->'other'),
         coalesce(g.rev, 0), coalesce(g.mat, 0), coalesce(g.lab, 0), coalesce(g.sub, 0), coalesce(g.oth, 0),
         coalesce(g.mat, 0) + coalesce(g.lab, 0) + coalesce(g.sub, 0) + coalesce(g.oth, 0),
         coalesce(g.rev, 0) - (coalesce(g.mat, 0) + coalesce(g.lab, 0) + coalesce(g.sub, 0) + coalesce(g.oth, 0)),
         case when coalesce(g.rev, 0) <> 0 then round((coalesce(g.rev, 0) - (coalesce(g.mat, 0) + coalesce(g.lab, 0) + coalesce(g.sub, 0) + coalesce(g.oth, 0))) / g.rev * 100, 2) end,
         public._num(b.st->'billedGross'), public._num(b.st->'retentionHeld'), public._num(b.st->'advanceRemaining')
  from public.projects pr
  left join g on g.pid = pr.id
  cross join lateral (select public._project_billing(pr.id) as st) b
  where p_project_id is null or pr.id = p_project_id
  order by pr.project_code;
end $$;

create or replace function public.project_cost_lines(p_project_id text, p_from date default null, p_to date default null)
returns table (entry_date date, voucher_number text, source_module text, source_doc text, account_code text, account_name text,
               account_type text, memo text, debit numeric, credit numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public._require_role('admin','ceo','finance','manager','procurement');
  return query
  select l.entry_date, e.voucher_number, e.source_module, e.source_doc_number, l.account_code, a.account_name_en, a.account_type, l.memo, l.debit, l.credit
  from public.gl_journal_lines l
  join public.gl_journal_entries e on e.id = l.entry_id
  join public.gl_accounts a on a.account_code = l.account_code
  where l.project_id = p_project_id and a.account_type in ('Revenue','Expense')
    and (p_from is null or l.entry_date >= p_from) and (p_to is null or l.entry_date <= p_to)
  order by l.entry_date, e.voucher_number, l.line_no;
end $$;

-- credit notes on project / contract invoices (runs inside post_credit_note, after the credit note row is written)
create or replace function public._credit_note_billing_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv public.invoices; v_left numeric; r record; v_cut numeric;
begin
  select * into inv from public.invoices where id = new.original_invoice_id;
  if inv.invoice_kind = 'progress' then
    raise exception 'Progress claims are cumulative: correct % in the next claim (or with a debit note), not with a credit note.', inv.invoice_number;
  elsif inv.invoice_kind = 'advance' then
    -- this credit note is already counted in 'credited'
    select public._num(x->'net') - public._num(x->'credited') - public._num(x->'deducted') into v_left
      from jsonb_array_elements(public._project_billing(inv.project_id)->'advances') x where x->>'id' = inv.id;
    if coalesce(v_left, 0) < -0.005 then
      raise exception 'Only SAR % of advance % has not been deducted from claims yet; that is the most that can be credited.', coalesce(v_left, 0) + new.subtotal_sar, inv.invoice_number;
    end if;
  elsif inv.invoice_kind = 'contract' and exists (select 1 from public.deferred_revenue_schedule where invoice_id = inv.id) then
    select coalesce(sum(amount_sar), 0) into v_left from public.deferred_revenue_schedule where invoice_id = inv.id and not recognized;
    if new.subtotal_sar > v_left + 0.005 then
      raise exception 'Only SAR % of % is still deferred (not yet recognised); that is the most that can be credited.', v_left, inv.invoice_number;
    end if;
    v_left := new.subtotal_sar;
    for r in select * from public.deferred_revenue_schedule where invoice_id = inv.id and not recognized order by month desc loop
      exit when v_left <= 0;
      v_cut := least(r.amount_sar, v_left);
      update public.deferred_revenue_schedule set amount_sar = amount_sar - v_cut where id = r.id;
      v_left := v_left - v_cut;
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists trg_credit_note_billing_check on public.credit_notes;
create trigger trg_credit_note_billing_check after insert on public.credit_notes for each row execute function public._credit_note_billing_check();

-- ---------------------------------------------------------------------
-- 6. Service contracts (AMC / subscription) and recurring billing
-- ---------------------------------------------------------------------
create or replace function public._contract_months(p_freq text) returns integer
language sql immutable as $$ select case p_freq when 'quarterly' then 3 when 'semiannual' then 6 when 'annual' then 12 else 1 end $$;

create or replace function public._clean_contract_lines(p_lines jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('desc', trim(l->>'desc'), 'qty', public._num(l->'qty'), 'monthlySar', public._num(l->'monthlySar'),
                    'vatCategory', coalesce(nullif(upper(l->>'vatCategory'), ''), 'S'),
                    'exemptionReason', case when coalesce(nullif(upper(l->>'vatCategory'), ''), 'S') = 'S' then null else nullif(l->>'exemptionReason', '') end,
                    'itemId', nullif(l->>'itemId', ''))) order by o), '[]'::jsonb)
    into v
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality as x(l, o)
  where coalesce(trim(l->>'desc'), '') <> '';
  if exists (select 1 from jsonb_array_elements(v) l where public._num(l->'qty') <= 0 or public._num(l->'monthlySar') < 0) then
    raise exception 'Each contract line needs a quantity above zero and a monthly price of zero or more.';
  end if;
  if exists (select 1 from jsonb_array_elements(v) l where l->>'vatCategory' not in ('S','Z','E','O')) then raise exception 'Unknown VAT category on a contract line.'; end if;
  if exists (select 1 from jsonb_array_elements(v) l where l->>'vatCategory' <> 'S' and l->>'exemptionReason' is null) then
    raise exception 'Zero-rated / exempt contract lines need a ZATCA exemption reason.';
  end if;
  return v;
end $$;

create or replace function public.save_contract(p jsonb) returns public.service_contracts
language plpgsql security definer set search_path = public as $$
declare
  k public.service_contracts; cust public.customers; v_id text := nullif(p->>'id', ''); v_lines jsonb; v_monthly numeric; v_sales boolean := public.is_sales();
  v_sm text; v_smn text;
begin
  perform public._require_role('admin','ceo','manager','finance','sales_mep','sales_it');
  if v_id is not null then
    select * into k from public.service_contracts where id = v_id for update;
    if k.id is null then raise exception 'Contract % not found.', v_id; end if;
    if v_sales and k.salesman_id is distinct from public.uid_text() then raise exception 'You can only edit your own contracts.'; end if;
    if k.status <> 'draft' then
      -- running contracts: only the service side can change; prices and dates change by renewal
      if v_sales then raise exception 'Contract % is %; ask a manager to change it.', k.contract_number, k.status; end if;
      update public.service_contracts set
        renewal_notice_days = coalesce(nullif(p->>'renewal_notice_days', '')::int, renewal_notice_days),
        sla_response_hours = coalesce(nullif(p->>'sla_response_hours', '')::int, sla_response_hours),
        covered_serials = case when p ? 'covered_serials' then coalesce((select array_agg(distinct trim(s)) from jsonb_array_elements_text(p->'covered_serials') s where trim(s) <> ''), '{}') else covered_serials end,
        covers_all_assets = coalesce((p->>'covers_all_assets')::boolean, covers_all_assets),
        notes = coalesce(p->>'notes', notes), updated_at = now()
      where id = k.id returning * into k;
      return k;
    end if;
  end if;
  if coalesce(trim(p->>'title'), '') = '' then raise exception 'Contract title is required.'; end if;
  if nullif(p->>'customer_id', '') is not null then
    select * into cust from public.customers where id = p->>'customer_id';
    if cust.id is null then raise exception 'Customer % not found.', p->>'customer_id'; end if;
  end if;
  if coalesce(cust.name_en, nullif(trim(p->>'client_name'), '')) is null then raise exception 'Choose the customer.'; end if;
  if nullif(p->>'start_date', '') is null or nullif(p->>'end_date', '') is null then raise exception 'Enter the contract start and end dates.'; end if;
  if (p->>'end_date')::date < (p->>'start_date')::date then raise exception 'The end date is before the start date.'; end if;
  v_lines := public._clean_contract_lines(p->'lines');
  if jsonb_array_length(v_lines) = 0 then raise exception 'Add at least one contract line.'; end if;
  select coalesce(sum(public._r2(public._num(l->'qty') * public._num(l->'monthlySar'))), 0) into v_monthly from jsonb_array_elements(v_lines) l;
  if v_sales then v_sm := public.uid_text(); v_smn := coalesce((select full_name from public.team_profiles where id::text = v_sm), '');
  else v_sm := coalesce(nullif(p->>'salesman_id', ''), k.salesman_id); v_smn := coalesce((select full_name from public.team_profiles where id::text = v_sm), p->>'salesman_name', k.salesman_name, '');
  end if;
  if v_id is null then
    insert into public.service_contracts (contract_number, contract_type, title, customer_id, client_name, client_vat, division, salesman_id, salesman_name,
                                          start_date, end_date, billing_frequency, billing_timing, lines, monthly_value_sar, deferred_revenue,
                                          renewal_notice_days, sla_response_hours, covered_serials, covers_all_assets, notes)
    values (public.next_doc_number('CONTRACT'), coalesce(nullif(p->>'contract_type', ''), 'amc'), trim(p->>'title'), cust.id,
            coalesce(cust.name_en, trim(p->>'client_name')), coalesce(nullif(trim(p->>'client_vat'), ''), cust.vat_number, ''),
            case when p->>'division' = 'MEP' then 'MEP' else 'IT & ELV' end, v_sm, v_smn,
            (p->>'start_date')::date, (p->>'end_date')::date, coalesce(nullif(p->>'billing_frequency', ''), 'monthly'),
            coalesce(nullif(p->>'billing_timing', ''), 'advance'), v_lines, v_monthly, coalesce((p->>'deferred_revenue')::boolean, false),
            coalesce(nullif(p->>'renewal_notice_days', '')::int, 30), coalesce(nullif(p->>'sla_response_hours', '')::int, 24),
            coalesce((select array_agg(distinct trim(s)) from jsonb_array_elements_text(coalesce(p->'covered_serials', '[]'::jsonb)) s where trim(s) <> ''), '{}'),
            coalesce((p->>'covers_all_assets')::boolean, false), coalesce(p->>'notes', ''))
    returning * into k;
  else
    update public.service_contracts set
      contract_type = coalesce(nullif(p->>'contract_type', ''), contract_type), title = trim(p->>'title'), customer_id = coalesce(cust.id, customer_id),
      client_name = coalesce(cust.name_en, nullif(trim(p->>'client_name'), ''), client_name),
      client_vat = coalesce(nullif(trim(p->>'client_vat'), ''), cust.vat_number, client_vat),
      division = case when p->>'division' = 'MEP' then 'MEP' else 'IT & ELV' end, salesman_id = v_sm, salesman_name = v_smn,
      start_date = (p->>'start_date')::date, end_date = (p->>'end_date')::date,
      billing_frequency = coalesce(nullif(p->>'billing_frequency', ''), billing_frequency), billing_timing = coalesce(nullif(p->>'billing_timing', ''), billing_timing),
      lines = v_lines, monthly_value_sar = v_monthly, deferred_revenue = coalesce((p->>'deferred_revenue')::boolean, deferred_revenue),
      renewal_notice_days = coalesce(nullif(p->>'renewal_notice_days', '')::int, renewal_notice_days),
      sla_response_hours = coalesce(nullif(p->>'sla_response_hours', '')::int, sla_response_hours),
      covered_serials = case when p ? 'covered_serials' then coalesce((select array_agg(distinct trim(s)) from jsonb_array_elements_text(p->'covered_serials') s where trim(s) <> ''), '{}') else covered_serials end,
      covers_all_assets = coalesce((p->>'covers_all_assets')::boolean, covers_all_assets), notes = coalesce(p->>'notes', notes), updated_at = now()
    where id = k.id returning * into k;
  end if;
  return k;
end $$;

create or replace function public.activate_contract(p_id text) returns public.service_contracts
language plpgsql security definer set search_path = public as $$
declare k public.service_contracts;
begin
  perform public._require_role('admin','ceo','manager','finance');
  select * into k from public.service_contracts where id = p_id for update;
  if k.id is null then raise exception 'Contract % not found.', p_id; end if;
  if k.status <> 'draft' then raise exception 'Contract % is already %.', k.contract_number, k.status; end if;
  if k.monthly_value_sar <= 0 then raise exception 'Contract % has no value to bill.', k.contract_number; end if;
  update public.service_contracts set status = 'active', next_period_start = start_date, updated_at = now() where id = k.id returning * into k;
  return k;
end $$;

create or replace function public.cancel_contract(p_id text, p_reason text) returns public.service_contracts
language plpgsql security definer set search_path = public as $$
declare k public.service_contracts;
begin
  perform public._require_role('admin','ceo','manager','finance');
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for cancelling.'; end if;
  select * into k from public.service_contracts where id = p_id for update;
  if k.id is null then raise exception 'Contract % not found.', p_id; end if;
  if k.status in ('cancelled','expired') then raise exception 'Contract % is already %.', k.contract_number, k.status; end if;
  update public.contract_billing_periods set status = 'skipped', note = 'Contract cancelled: ' || trim(p_reason), updated_at = now() where contract_id = k.id and status = 'draft';
  update public.service_contracts set status = 'cancelled', cancelled_reason = trim(p_reason), updated_at = now() where id = k.id returning * into k;
  return k;
end $$;

-- Draft billing periods that have fallen due by p_as_of (bill date = period start when billed in advance, end when in arrears).
-- Run from the Contracts screen or a schedule (snippets/contract_billing_schedule.sql). Returns the number of drafts made.
create or replace function public.generate_contract_drafts(p_as_of date default null, p_contract_id text default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  k public.service_contracts; v_as_of date := coalesce(p_as_of, public._riyadh_today()); v_m int; v_start date; v_full_end date; v_end date; v_bill date;
  v_factor numeric; v_months numeric; v_lines jsonb; v_amt numeric; v_no int; v_n int := 0;
begin
  if not public.is_maintenance_session() then perform public._require_role('admin','ceo','manager','finance'); end if;
  for k in select * from public.service_contracts where status = 'active' and (p_contract_id is null or id = p_contract_id) order by contract_number for update loop
    v_m := public._contract_months(k.billing_frequency);
    v_start := k.next_period_start;
    loop
      exit when v_start is null or v_start > k.end_date;
      v_full_end := (v_start + make_interval(months => v_m))::date - 1;
      v_end := least(v_full_end, k.end_date);
      v_bill := case when k.billing_timing = 'arrears' then v_end else v_start end;
      exit when v_bill > v_as_of;
      v_factor := case when v_end = v_full_end then 1 else round((v_end - v_start + 1)::numeric / (v_full_end - v_start + 1), 4) end;
      v_months := round(v_m * v_factor, 4);
      select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('desc', format('%s (%s to %s)', l->>'desc', to_char(v_start, 'DD Mon YYYY'), to_char(v_end, 'DD Mon YYYY')),
                       'qty', round(public._num(l->'qty') * v_months, 4), 'unit', 'MTH', 'unitSellSar', public._num(l->'monthlySar'),
                       'vatCategory', coalesce(l->>'vatCategory', 'S'), 'vatRate', public._vat_rate(coalesce(l->>'vatCategory', 'S')),
                       'exemptionReason', l->>'exemptionReason', 'itemId', l->>'itemId')) order by o), '[]'::jsonb)
        into v_lines from jsonb_array_elements(k.lines) with ordinality as x(l, o);
      select coalesce(sum(public._r2(public._num(l->'qty') * public._num(l->'unitSellSar'))), 0) into v_amt from jsonb_array_elements(v_lines) l;
      select coalesce(max(period_no), 0) + 1 into v_no from public.contract_billing_periods where contract_id = k.id;
      insert into public.contract_billing_periods (contract_id, period_no, period_start, period_end, bill_date, lines, amount_sar)
      values (k.id, v_no, v_start, v_end, v_bill, v_lines, v_amt)
      on conflict (contract_id, period_start) do nothing;
      if found then v_n := v_n + 1; end if;
      v_start := v_end + 1;
    end loop;
    update public.service_contracts set next_period_start = v_start, updated_at = now() where id = k.id and next_period_start is distinct from v_start;
  end loop;
  update public.service_contracts set status = 'expired', updated_at = now()
   where status = 'active' and end_date < v_as_of and (next_period_start is null or next_period_start > end_date);
  return v_n;
end $$;

create or replace function public.update_contract_draft(p_period_id text, p_lines jsonb, p_note text default null) returns public.contract_billing_periods
language plpgsql security definer set search_path = public as $$
declare d public.contract_billing_periods; v_lines jsonb; v_amt numeric;
begin
  perform public._require_role('admin','ceo','manager','finance');
  select * into d from public.contract_billing_periods where id = p_period_id for update;
  if d.id is null then raise exception 'Billing period % not found.', p_period_id; end if;
  if d.status <> 'draft' then raise exception 'This billing period is % and cannot be edited.', d.status; end if;
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('desc', trim(l->>'desc'), 'qty', public._num(l->'qty'), 'unit', coalesce(nullif(l->>'unit', ''), 'MTH'),
                  'unitSellSar', public._num(l->'unitSellSar'), 'vatCategory', coalesce(nullif(upper(l->>'vatCategory'), ''), 'S'),
                  'vatRate', public._vat_rate(coalesce(nullif(upper(l->>'vatCategory'), ''), 'S')), 'exemptionReason', nullif(l->>'exemptionReason', ''),
                  'itemId', nullif(l->>'itemId', ''))) order by o), '[]'::jsonb)
    into v_lines from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality as x(l, o) where coalesce(trim(l->>'desc'), '') <> '';
  if exists (select 1 from jsonb_array_elements(v_lines) l where public._num(l->'qty') < 0 or public._num(l->'unitSellSar') < 0) then
    raise exception 'Quantities and prices cannot be negative.';
  end if;
  select coalesce(sum(public._r2(public._num(l->'qty') * public._num(l->'unitSellSar'))), 0) into v_amt from jsonb_array_elements(v_lines) l;
  update public.contract_billing_periods set lines = v_lines, amount_sar = v_amt, note = coalesce(p_note, note), updated_at = now()
   where id = d.id returning * into d;
  return d;
end $$;

create or replace function public.skip_contract_draft(p_period_id text, p_reason text) returns public.contract_billing_periods
language plpgsql security definer set search_path = public as $$
declare d public.contract_billing_periods;
begin
  perform public._require_role('admin','ceo','manager','finance');
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for skipping this period.'; end if;
  update public.contract_billing_periods set status = 'skipped', note = trim(p_reason), updated_at = now()
   where id = p_period_id and status = 'draft' returning * into d;
  if d.id is null then raise exception 'Billing period % is not a draft.', p_period_id; end if;
  return d;
end $$;

create or replace function public.post_contract_invoice(p_period_id text) returns public.invoices
language plpgsql security definer set search_path = public as $$
declare
  d public.contract_billing_periods; k public.service_contracts; v_items jsonb; v_bd jsonb; v_sub numeric; v_vat numeric; v_inv public.invoices;
  v_rev text; m date; v_days int; v_share numeric; v_used numeric := 0; v_last date;
begin
  perform public._require_role('admin','ceo','finance');
  select * into d from public.contract_billing_periods where id = p_period_id for update;
  if d.id is null then raise exception 'Billing period % not found.', p_period_id; end if;
  if d.status <> 'draft' then raise exception 'This billing period is already %.', d.status; end if;
  select * into k from public.service_contracts where id = d.contract_id for update;
  if k.status = 'cancelled' then raise exception 'Contract % is cancelled.', k.contract_number; end if;
  select coalesce(jsonb_agg(l order by o), '[]'::jsonb) into v_items from jsonb_array_elements(d.lines) with ordinality as x(l, o) where public._num(l->'qty') > 0;
  if jsonb_array_length(v_items) = 0 then raise exception 'The draft has no lines to invoice.'; end if;
  v_bd := public._rounded_breakdown(v_items);
  select coalesce(sum(public._num(b->'net')), 0), coalesce(sum(public._num(b->'vat')), 0) into v_sub, v_vat from jsonb_array_elements(v_bd) b;
  if v_sub + v_vat <= 0 then raise exception 'The draft has a zero total.'; end if;
  v_inv := public._insert_billing_invoice(jsonb_build_object('kind', 'contract', 'division', k.division, 'client_name', k.client_name, 'client_vat', k.client_vat,
             'customer_id', k.customer_id, 'salesman_id', k.salesman_id, 'salesman_name', k.salesman_name, 'contract_id', k.id, 'source_id', k.id,
             'billing', jsonb_build_object('contractNumber', k.contract_number, 'periodNo', d.period_no, 'periodStart', d.period_start, 'periodEnd', d.period_end,
                                           'deferred', k.deferred_revenue)),
             v_items, v_bd, v_sub, v_vat, v_sub + v_vat);
  v_rev := case when k.division = 'MEP' then '4010' else '4020' end;
  perform public._gl_post(public.riyadh_date(v_inv.issued_at), 'INVOICE', v_inv.invoice_number,
    format('Contract invoice %s - %s (%s, %s to %s)', v_inv.invoice_number, k.client_name, k.contract_number, d.period_start, d.period_end),
    jsonb_build_array(
      jsonb_build_object('account_code', '1100', 'debit', v_sub + v_vat, 'memo', k.client_name),
      jsonb_build_object('account_code', case when k.deferred_revenue then '2400' else v_rev end, 'credit', v_sub,
                         'memo', case when k.deferred_revenue then 'Deferred ' else '' end || k.contract_number),
      jsonb_build_object('account_code', '2100', 'credit', v_vat, 'memo', 'Output VAT')));
  if k.deferred_revenue then
    -- spread the net over the calendar months of the period by days
    v_days := d.period_end - d.period_start + 1;
    v_last := date_trunc('month', d.period_end)::date;
    for m in select generate_series(date_trunc('month', d.period_start), date_trunc('month', d.period_end), interval '1 month')::date loop
      v_share := case when m = v_last then v_sub - v_used
                      else public._r2(v_sub * ((least((m + interval '1 month')::date - 1, d.period_end) - greatest(m, d.period_start) + 1)::numeric / v_days)) end;
      insert into public.deferred_revenue_schedule (contract_id, invoice_id, invoice_number, division, month, amount_sar)
      values (k.id, v_inv.id, v_inv.invoice_number, k.division, m, v_share);
      v_used := v_used + v_share;
    end loop;
  end if;
  update public.contract_billing_periods set status = 'invoiced', invoice_id = v_inv.id, invoice_number = v_inv.invoice_number, updated_at = now() where id = d.id;
  return v_inv;
end $$;

-- Recognise deferred contract revenue for every month up to p_through (default: today): Dr 2400 / Cr 4010|4020.
create or replace function public.recognize_deferred_revenue(p_through date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_through date := coalesce(p_through, public._riyadh_today()); v_lines jsonb; v_total numeric; v_rows int; v_doc text; v_jv public.gl_journal_entries;
begin
  if not public.is_maintenance_session() then perform public._require_role('admin','ceo','finance'); end if;
  select count(*), coalesce(sum(amount_sar), 0) into v_rows, v_total from public.deferred_revenue_schedule
   where not recognized and month <= date_trunc('month', v_through)::date;
  if v_rows = 0 or v_total = 0 then
    update public.deferred_revenue_schedule set recognized = true, recognized_at = now() where not recognized and month <= date_trunc('month', v_through)::date and amount_sar = 0;
    return jsonb_build_object('rows', v_rows, 'amount', 0, 'journal', null);
  end if;
  select jsonb_build_array(jsonb_build_object('account_code', '2400', 'debit', v_total, 'memo', 'Deferred revenue recognised to ' || v_through))
         || coalesce(jsonb_agg(jsonb_build_object('account_code', case when division = 'MEP' then '4010' else '4020' end, 'credit', amt, 'memo', 'Contract revenue ' || division)), '[]'::jsonb)
    into v_lines
  from (select division, sum(amount_sar) as amt from public.deferred_revenue_schedule
        where not recognized and month <= date_trunc('month', v_through)::date group by division) g;
  v_doc := public.next_doc_number('REV_RECOGNITION');
  v_jv := public._gl_post(v_through, 'REV_RECOGNITION', v_doc, format('Deferred contract revenue recognised up to %s', v_through), v_lines);
  update public.deferred_revenue_schedule set recognized = true, journal_number = v_jv.voucher_number, recognized_at = now()
   where not recognized and month <= date_trunc('month', v_through)::date;
  return jsonb_build_object('rows', v_rows, 'amount', v_total, 'journal', v_jv.voucher_number);
end $$;

create or replace function public.contract_renewals_due(p_within_days integer default null)
returns table (contract_id text, contract_number text, title text, client_name text, salesman_name text, end_date date, days_left integer,
               monthly_value_sar numeric, renewed_to text)
language sql stable security definer set search_path = public as $$
  select k.id, k.contract_number, k.title, k.client_name, k.salesman_name, k.end_date, (k.end_date - public._riyadh_today())::int, k.monthly_value_sar, k.renewed_to
  from public.service_contracts k
  where k.status = 'active' and k.renewed_to is null
    and k.end_date - public._riyadh_today() <= coalesce(p_within_days, k.renewal_notice_days)
    and (public.has_role('admin','ceo','manager','finance') or (public.is_sales() and k.salesman_id = public.uid_text()))
  order by k.end_date, k.contract_number
$$;

-- New draft contract for the next term (same length, prices raised by upliftPct). The old one runs to its end date.
create or replace function public.renew_contract(p_id text, p jsonb default '{}'::jsonb) returns public.service_contracts
language plpgsql security definer set search_path = public as $$
declare k public.service_contracts; n public.service_contracts; v_up numeric := coalesce(public._num(p->'upliftPct'), 0); v_start date; v_end date;
begin
  perform public._require_role('admin','ceo','manager','finance','sales_mep','sales_it');
  select * into k from public.service_contracts where id = p_id for update;
  if k.id is null then raise exception 'Contract % not found.', p_id; end if;
  if public.is_sales() and k.salesman_id is distinct from public.uid_text() then raise exception 'You can only renew your own contracts.'; end if;
  if k.renewed_to is not null then raise exception 'Contract % has already been renewed.', k.contract_number; end if;
  if k.status not in ('active','expired') then raise exception 'Contract % is % and cannot be renewed.', k.contract_number, k.status; end if;
  v_start := coalesce(nullif(p->>'startDate', '')::date, k.end_date + 1);
  v_end := coalesce(nullif(p->>'endDate', '')::date, (v_start + age(k.end_date + 1, k.start_date))::date - 1);
  insert into public.service_contracts (contract_number, contract_type, title, customer_id, client_name, client_vat, division, salesman_id, salesman_name,
                                        start_date, end_date, billing_frequency, billing_timing, lines, monthly_value_sar, deferred_revenue,
                                        renewal_notice_days, sla_response_hours, covered_serials, covers_all_assets, renewed_from, notes)
  select public.next_doc_number('CONTRACT'), k.contract_type, k.title, k.customer_id, k.client_name, k.client_vat, k.division, k.salesman_id, k.salesman_name,
         v_start, v_end, k.billing_frequency, k.billing_timing,
         (select coalesce(jsonb_agg(l || jsonb_build_object('monthlySar', public._r2(public._num(l->'monthlySar') * (1 + v_up / 100))) order by o), '[]'::jsonb)
            from jsonb_array_elements(k.lines) with ordinality as x(l, o)),
         0, k.deferred_revenue, k.renewal_notice_days, k.sla_response_hours, k.covered_serials, k.covers_all_assets, k.id,
         format('Renewal of %s%s', k.contract_number, case when v_up <> 0 then format(' (+%s%%)', v_up) else '' end)
  returning * into n;
  update public.service_contracts set monthly_value_sar = (select coalesce(sum(public._r2(public._num(l->'qty') * public._num(l->'monthlySar'))), 0) from jsonb_array_elements(n.lines) l)
   where id = n.id returning * into n;
  update public.service_contracts set renewed_to = n.id, updated_at = now() where id = k.id;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 7. Service tickets
-- ---------------------------------------------------------------------
create or replace function public.serial_coverage(p_serial text, p_customer_id text default null, p_client_name text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.item_serials; v_item text; dn public.delivery_notes; so public.sales_orders; v_cust text; v_client text; k public.service_contracts; v_warr boolean;
begin
  if public.app_role() is null and not public.is_maintenance_session() then raise exception 'No access.'; end if;
  select * into s from public.item_serials where upper(serial) = upper(trim(p_serial)) order by (status = 'delivered') desc, delivered_at desc nulls last limit 1;
  if s.serial is not null then
    select name_en into v_item from public.items where id = s.item_id;
    select * into dn from public.delivery_notes where id = s.dn_id;
    select * into so from public.sales_orders where id = dn.so_id;
  end if;
  v_cust := coalesce(so.customer_id, nullif(p_customer_id, ''));
  v_client := coalesce(dn.client_name, (select name_en from public.customers where id = v_cust), nullif(trim(p_client_name), ''));
  v_warr := s.warranty_end is not null and s.warranty_end >= public._riyadh_today();
  select * into k from public.service_contracts c
   where c.status = 'active' and public._riyadh_today() between c.start_date and c.end_date
     and ((v_cust is not null and c.customer_id = v_cust) or lower(trim(c.client_name)) = lower(trim(coalesce(v_client, ''))))
     and (upper(trim(coalesce(p_serial, ''))) = any (select upper(x) from unnest(c.covered_serials) x) or c.covers_all_assets)
   order by (upper(trim(coalesce(p_serial, ''))) = any (select upper(x) from unnest(c.covered_serials) x)) desc, c.end_date desc limit 1;
  return jsonb_strip_nulls(jsonb_build_object('serial', coalesce(s.serial, nullif(trim(p_serial), '')), 'found', s.serial is not null, 'itemId', s.item_id, 'itemName', v_item,
    'serialStatus', s.status, 'dnNumber', s.dn_number, 'deliveredAt', s.delivered_at, 'warrantyEnd', s.warranty_end, 'underWarranty', v_warr,
    'customerId', v_cust, 'clientName', v_client, 'contractId', k.id, 'contractNumber', k.contract_number, 'contractEnd', k.end_date,
    'slaHours', k.sla_response_hours,
    'coverage', case when v_warr then 'warranty' when k.id is not null then 'amc' else 'chargeable' end));
end $$;

-- p: {serial, customer_id, client_name, subject, description, priority, contact_name, contact_phone, assigned_to, chargeable (true = bill even if covered)}
create or replace function public.open_service_ticket(p jsonb) returns public.service_tickets
language plpgsql security definer set search_path = public as $$
declare cov jsonb; t public.service_tickets; v_pri text := coalesce(nullif(p->>'priority', ''), 'normal'); v_hours int; k public.service_contracts; v_cov text;
begin
  if public.app_role() is null then raise exception 'No access.'; end if;
  if coalesce(trim(p->>'subject'), '') = '' then raise exception 'Describe the problem (subject).'; end if;
  if v_pri not in ('low','normal','high','critical') then raise exception 'Unknown priority %.', v_pri; end if;
  cov := public.serial_coverage(p->>'serial', p->>'customer_id', p->>'client_name');
  if cov->>'clientName' is null then raise exception 'Choose the customer (or enter a serial number we delivered).'; end if;
  v_cov := case when coalesce((p->>'chargeable')::boolean, false) then 'chargeable' else cov->>'coverage' end;
  if cov ? 'contractId' then select * into k from public.service_contracts where id = cov->>'contractId'; end if;
  v_hours := case when v_cov = 'amc' and k.id is not null then k.sla_response_hours
                  else case v_pri when 'critical' then 4 when 'high' then 8 when 'low' then 72 else 24 end end;
  insert into public.service_tickets (ticket_number, customer_id, client_name, division, item_id, item_name, serial, contract_id, coverage, priority,
                                      subject, description, contact_name, contact_phone, assigned_to, sla_due_at, history)
  values (public.next_doc_number('TICKET'), cov->>'customerId', cov->>'clientName', coalesce(k.division, 'IT & ELV'), cov->>'itemId', coalesce(cov->>'itemName', ''),
          coalesce(cov->>'serial', ''), case when v_cov = 'amc' then k.id end, v_cov, v_pri, trim(p->>'subject'), coalesce(p->>'description', ''),
          coalesce(p->>'contact_name', ''), coalesce(p->>'contact_phone', ''), coalesce(p->>'assigned_to', ''), now() + make_interval(hours => v_hours),
          jsonb_build_array(jsonb_build_object('at', now(), 'by', public._actor_name(), 'status', 'open', 'note', 'Opened - ' || v_cov)))
  returning * into t;
  return t;
end $$;

-- p: {status, assigned_to, priority, resolution, labour_hours, chargeable_sar, note}
create or replace function public.update_service_ticket(p_id text, p jsonb) returns public.service_tickets
language plpgsql security definer set search_path = public as $$
declare t public.service_tickets; v_status text;
begin
  if public.app_role() is null then raise exception 'No access.'; end if;
  select * into t from public.service_tickets where id = p_id for update;
  if t.id is null then raise exception 'Ticket % not found.', p_id; end if;
  if t.status in ('closed','cancelled') then raise exception 'Ticket % is % and cannot change.', t.ticket_number, t.status; end if;
  v_status := coalesce(nullif(p->>'status', ''), t.status);
  if v_status not in ('open','in_progress','on_hold','resolved','closed','cancelled') then raise exception 'Unknown status %.', v_status; end if;
  if v_status in ('resolved','closed') and coalesce(nullif(trim(p->>'resolution'), ''), nullif(t.resolution, '')) is null then
    raise exception 'Enter the resolution before resolving or closing the ticket.';
  end if;
  if coalesce(public._num(p->'chargeable_sar'), 0) > 0 and t.coverage <> 'chargeable' and coalesce(p->>'coverage', '') <> 'chargeable' then
    raise exception 'Ticket % is covered by %; it is not charged.', t.ticket_number, t.coverage;
  end if;
  update public.service_tickets set
    status = v_status,
    assigned_to = coalesce(p->>'assigned_to', assigned_to),
    priority = case when p->>'priority' in ('low','normal','high','critical') then p->>'priority' else priority end,
    coverage = case when p->>'coverage' = 'chargeable' then 'chargeable' else coverage end,
    resolution = coalesce(nullif(trim(p->>'resolution'), ''), resolution),
    labour_hours = coalesce(nullif(p->>'labour_hours', '')::numeric, labour_hours),
    chargeable_sar = coalesce(nullif(p->>'chargeable_sar', '')::numeric, chargeable_sar),
    resolved_at = case when v_status in ('resolved','closed') then coalesce(resolved_at, now()) when v_status in ('open','in_progress','on_hold') then null else resolved_at end,
    closed_at = case when v_status in ('closed','cancelled') then now() else closed_at end,
    history = history || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('at', now(), 'by', public._actor_name(), 'status', v_status, 'note', nullif(trim(p->>'note'), '')))),
    updated_at = now()
  where id = t.id returning * into t;
  return t;
end $$;

-- ---------------------------------------------------------------------
-- 8. Views re-created with the new invoice / SO columns (their column lists are fixed when created)
-- ---------------------------------------------------------------------
create or replace view public.invoices_v with (security_barrier = true) as
select (jsonb_populate_record(null::public.invoices,
          case when public.can_view_cost() then to_jsonb(t) else public.redact_costs(to_jsonb(t)) end)).*
from public.invoices t
where public.has_role('admin','ceo','finance','manager') or (public.is_sales() and t.salesman_id = public.uid_text());

create or replace view public.sales_orders_v with (security_barrier = true) as
select (jsonb_populate_record(null::public.sales_orders,
          case when public.can_view_cost() then to_jsonb(t) else public.redact_costs(to_jsonb(t)) end)).*
from public.sales_orders t
where public.has_role('admin','ceo','manager','finance','procurement') or (public.is_sales() and t.salesman_id = public.uid_text());


-- ---------------------------------------------------------------------
-- 9. RLS, grants, audit
-- ---------------------------------------------------------------------
alter table public.projects enable row level security;
alter table public.service_contracts enable row level security;
alter table public.contract_billing_periods enable row level security;
alter table public.deferred_revenue_schedule enable row level security;
alter table public.service_tickets enable row level security;

drop policy if exists projects_read on public.projects;
create policy projects_read on public.projects for select to authenticated using (public.has_role('admin','ceo','finance','manager','procurement'));
drop policy if exists service_contracts_read on public.service_contracts;
create policy service_contracts_read on public.service_contracts for select to authenticated
  using (public.has_role('admin','ceo','finance','manager') or (public.is_sales() and salesman_id = public.uid_text()));
drop policy if exists contract_billing_periods_read on public.contract_billing_periods;
create policy contract_billing_periods_read on public.contract_billing_periods for select to authenticated
  using (public.has_role('admin','ceo','finance','manager')
         or (public.is_sales() and exists (select 1 from public.service_contracts k where k.id = contract_id and k.salesman_id = public.uid_text())));
drop policy if exists deferred_revenue_schedule_read on public.deferred_revenue_schedule;
create policy deferred_revenue_schedule_read on public.deferred_revenue_schedule for select to authenticated using (public.has_role('admin','ceo','finance','manager'));
drop policy if exists service_tickets_read on public.service_tickets;
create policy service_tickets_read on public.service_tickets for select to authenticated using (public.app_role() is not null);

revoke all on public.projects, public.service_contracts, public.contract_billing_periods, public.deferred_revenue_schedule, public.service_tickets from anon, public;
grant select on public.projects, public.service_contracts, public.contract_billing_periods, public.deferred_revenue_schedule, public.service_tickets to authenticated;
revoke insert, update, delete on public.projects, public.service_contracts, public.contract_billing_periods, public.deferred_revenue_schedule, public.service_tickets from authenticated;

do $$
declare t text;
begin
  foreach t in array array['projects','service_contracts','contract_billing_periods','service_tickets'] loop
    execute format('drop trigger if exists trg_audit_row on public.%I', t);
    execute format('create trigger trg_audit_row after insert or update or delete on public.%I for each row execute function public.audit_row(%L)', t, 'id');
    execute format('drop trigger if exists trg_stamp_row_user on public.%I', t);
    execute format('create trigger trg_stamp_row_user before insert or update on public.%I for each row execute function public.stamp_row_user()', t);
  end loop;
  execute 'drop trigger if exists trg_audit_row on public.deferred_revenue_schedule';
  execute 'create trigger trg_audit_row after insert or update or delete on public.deferred_revenue_schedule for each row execute function public.audit_row(''id'')';
end $$;

do $$
declare f text;
begin
  foreach f in array array['public._project_ctx(text)', 'public._rounded_breakdown(jsonb)', 'public._insert_billing_invoice(jsonb, jsonb, jsonb, numeric, numeric, numeric)',
                           'public._project_billing(text)', 'public._project_header(public.projects, text)', 'public._project_for_billing(text)',
                           'public._credit_note_billing_check()', 'public._contract_months(text)', 'public._clean_contract_lines(jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.project_billing(text)', 'public.save_project(jsonb)', 'public.link_sales_order_to_project(text, text)',
                           'public.post_advance_invoice(text, numeric, text)', 'public.post_progress_invoice(text, jsonb)', 'public.post_retention_release(text, numeric, text)',
                           'public.project_job_cost(text, date, date)', 'public.project_cost_lines(text, date, date)',
                           'public.save_contract(jsonb)', 'public.activate_contract(text)', 'public.cancel_contract(text, text)', 'public.generate_contract_drafts(date, text)',
                           'public.update_contract_draft(text, jsonb, text)', 'public.skip_contract_draft(text, text)', 'public.post_contract_invoice(text)',
                           'public.recognize_deferred_revenue(date)', 'public.contract_renewals_due(integer)', 'public.renew_contract(text, jsonb)',
                           'public.serial_coverage(text, text, text)', 'public.open_service_ticket(jsonb)', 'public.update_service_ticket(text, jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';


-- Prompt 15 fix: grants on the re-created views
do $$
declare v text;
begin
  foreach v in array array['sales_orders_v', 'invoices_v'] loop
    execute format('revoke all on public.%I from anon, public', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end $$;

commit;
