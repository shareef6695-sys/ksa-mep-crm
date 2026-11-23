-- =====================================================================
-- 0013_sales_controls.sql — quote approval, revisions, pipeline, credit control, due dates, SO amendments (F8-F11)
--
--  * app_settings.sales_settings: minMarginPct (10), approvalAboveSar (250,000 excl. VAT), overdueBlockDays (90).
--  * A quote below the margin floor or above the value threshold needs a manager / CEO approval before it becomes a
--    sales order. The approval is tied to the priced content (margin, lines, costs): changing them voids it.
--    The salesman cannot approve their own quote (CEO / admin can). Checked when the SO row is inserted.
--  * Revisions (Rev A, B, C...): revise_quote snapshots the quote into quote_revisions; validity date (validUntil);
--    stages new_inquiry -> quoted -> negotiation -> won (by SO only) / lost (with a reason code); sales_pipeline().
--  * Credit control: a new SO or invoice is refused when the customer's open receivables + open orders + the new amount
--    exceed customers.credit_limit_sar, or when they have an invoice more than overdueBlockDays past due — unless Finance
--    grants a one-time override (grant_credit_override). credit_status() for the screens.
--  * Invoices get payment_terms and due_date (from the SO / customer terms; Net 30 by default); ar_aging() ages by days
--    past due: current, 1-30, 31-60, 61-90, 90+.
--  * amend_sales_order / cancel_sales_order for undelivered quantities, logged in sales_order_changes.
--
-- Run after 0012. Re-runnable.
-- =====================================================================
begin;

insert into public.app_settings (key, value)
values ('sales_settings', '{"minMarginPct": 10, "approvalAboveSar": 250000, "overdueBlockDays": 90}')
on conflict (key) do nothing;

create or replace function public._sales_settings() returns jsonb
language sql stable security definer set search_path = public as $$
  select '{"minMarginPct": 10, "approvalAboveSar": 250000, "overdueBlockDays": 90}'::jsonb
         || coalesce((select value from public.app_settings where key = 'sales_settings' and jsonb_typeof(value) = 'object'), '{}'::jsonb)
$$;

alter table public.invoices add column if not exists payment_terms text;
alter table public.invoices add column if not exists due_date date;
alter table public.sales_orders add column if not exists cancelled_reason text;

create table if not exists public.quote_revisions (
  id           bigserial primary key,
  inquiry_id   text not null references public.inquiries(id) on delete cascade,
  revision     text not null,
  data         jsonb not null,
  note         text,
  created_by   text,
  created_by_uid uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  unique (inquiry_id, revision)
);

create table if not exists public.credit_overrides (
  id           bigserial primary key,
  doc_type     text not null check (doc_type in ('SO','INVOICE','SO_AMEND')),
  ref_id       text not null,                 -- quote id (SO), delivery note id (invoice), SO id (amendment)
  client_name  text,
  reason       text not null,
  granted_by   text,
  granted_uid  uuid default auth.uid(),
  granted_at   timestamptz not null default now(),
  used_at      timestamptz,
  used_doc     text
);
create index if not exists credit_overrides_ref_idx on public.credit_overrides (doc_type, ref_id) where used_at is null;

create table if not exists public.sales_order_changes (
  id           bigserial primary key,
  so_id        text not null,
  so_number    text,
  change_type  text not null check (change_type in ('amend','cancel')),
  before_items jsonb,
  after_items  jsonb,
  before_total numeric(18,2),
  after_total  numeric(18,2),
  reason       text not null,
  changed_by   text,
  changed_uid  uuid default auth.uid(),
  changed_at   timestamptz not null default now()
);
create index if not exists sales_order_changes_so_idx on public.sales_order_changes (so_id, id);

-- ---------------------------------------------------------------------
-- 1. Quote pricing / approval helpers (same formula as post_sales_order)
-- ---------------------------------------------------------------------
create or replace function public._quote_cost(d jsonb) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(public._num(b->'qty') * public._num(b->'buyUnitCost') * public.fx_rate(b->>'buyCurrency')), 0)
  from jsonb_array_elements(coalesce(d->'boqItems', '[]'::jsonb)) b
$$;

create or replace function public._quote_sell(d jsonb) returns numeric
language sql stable security definer set search_path = public as $$
  select case when public._num(d->'marginPercent') >= 100 then public._quote_cost(d)
              else public._quote_cost(d) / (1 - public._num(d->'marginPercent') / 100) end
$$;

-- what an approval covers: margin and the priced lines
create or replace function public._quote_fingerprint(d jsonb) returns text
language sql immutable as $$
  select md5(jsonb_build_object('m', d->'marginPercent', 'lines', coalesce((
           select jsonb_agg(jsonb_build_object('id', b->>'id', 'q', b->'qty', 'c', b->'buyUnitCost', 'ccy', b->>'buyCurrency', 'i', b->>'itemId') order by o)
           from jsonb_array_elements(coalesce(d->'boqItems', '[]'::jsonb)) with ordinality as x(b, o)), '[]'::jsonb))::text)
$$;

create or replace function public._quote_approval(d jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s jsonb := public._sales_settings(); v_reasons text[] := '{}'; v_sell numeric := public._quote_sell(d); v_ok boolean;
begin
  if public._num(d->'marginPercent') < public._num(s->'minMarginPct') then
    v_reasons := array_append(v_reasons, format('margin %s%% is below the %s%% floor', round(public._num(d->'marginPercent'), 2), public._num(s->'minMarginPct')));
  end if;
  if v_sell > public._num(s->'approvalAboveSar') then
    v_reasons := array_append(v_reasons, format('value SAR %s is above SAR %s', to_char(round(v_sell, 2), 'FM999,999,999,990.00'), to_char(public._num(s->'approvalAboveSar'), 'FM999,999,999,990')));
  end if;
  v_ok := d->'approval'->>'status' = 'approved' and d->'approval'->>'fingerprint' = public._quote_fingerprint(d);
  return jsonb_build_object('needed', cardinality(v_reasons) > 0, 'reasons', to_jsonb(v_reasons), 'approved', coalesce(v_ok, false),
                            'stale', d->'approval'->>'status' = 'approved' and not coalesce(v_ok, false),
                            'approvedBy', d->'approval'->>'by', 'approvedAt', d->'approval'->>'at');
end $$;

-- approval state of the quotes the caller can see (for badges / the approvals list)
create or replace function public.quote_approvals()
returns table (inquiry_id text, needed boolean, approved boolean, stale boolean, reasons jsonb, approved_by text, approved_at text)
language sql stable security definer set search_path = public as $$
  select i.id, (a->>'needed')::boolean, (a->>'approved')::boolean, (a->>'stale')::boolean,
         -- the margin itself is hidden from roles without cost visibility
         case when public.can_view_cost() then a->'reasons'
              else (select coalesce(jsonb_agg(case when r like 'margin%' then 'margin is below the approval floor' else r end), '[]'::jsonb)
                    from jsonb_array_elements_text(a->'reasons') r) end,
         a->>'approvedBy', a->>'approvedAt'
  from public.inquiries i, lateral (select public._quote_approval(i.data) as a) x
  where public.has_role('admin','ceo','manager','finance') or (public.is_sales() and i.data->>'salesmanId' = public.uid_text())
$$;

create or replace function public.approve_quote(p_inquiry_id text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d jsonb; a jsonb;
begin
  perform public._require_role('admin','ceo','manager');
  select data into d from public.inquiries where id = p_inquiry_id for update;
  if d is null then raise exception 'Quote % not found.', p_inquiry_id; end if;
  if d->>'stage' in ('won','lost') then raise exception 'Quote % is %.', coalesce(d->>'refNo', p_inquiry_id), d->>'stage'; end if;
  if d->>'salesmanId' = public.uid_text() and public.app_role() not in ('admin','ceo') then
    raise exception 'This is your own quote; another manager or the CEO must approve it.';
  end if;
  d := d || jsonb_build_object('approval', jsonb_build_object('status', 'approved', 'by', public._actor_name(), 'byUid', public.uid_text(),
         'at', now(), 'note', p_note, 'revision', coalesce(d->>'revision', 'A'), 'marginPercent', d->'marginPercent',
         'sellSar', public._r2(public._quote_sell(d)), 'fingerprint', public._quote_fingerprint(d)));
  update public.inquiries set data = d, updated_at = now(), updated_by = public._actor_name() where id = p_inquiry_id;
  a := public._quote_approval(d);
  return a;
end $$;

-- ---------------------------------------------------------------------
-- 2. Stages, revisions, pipeline
-- ---------------------------------------------------------------------
create or replace function public._can_edit_quote(d jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('admin','ceo','manager') or (public.is_sales() and d->>'salesmanId' = public.uid_text())
$$;

create or replace function public.set_quote_stage(p_inquiry_id text, p_stage text, p_lost_reason text default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d jsonb;
begin
  select data into d from public.inquiries where id = p_inquiry_id for update;
  if d is null then raise exception 'Quote % not found.', p_inquiry_id; end if;
  if not public._can_edit_quote(d) then raise exception 'You can only change your own quotes.'; end if;
  if d->>'stage' = 'won' then raise exception 'Quote % is already a sales order.', coalesce(d->>'refNo', p_inquiry_id); end if;
  if p_stage not in ('new_inquiry','quoted','negotiation','lost') then raise exception 'Unknown stage % (won is set by converting to a sales order).', p_stage; end if;
  if p_stage = 'lost' and coalesce(p_lost_reason, '') not in ('PRICE','LEAD_TIME','SPECIFICATION','COMPETITOR','NO_BUDGET','NO_RESPONSE','PROJECT_CANCELLED','OTHER') then
    raise exception 'Choose why the quote was lost.';
  end if;
  d := (d - 'lostReason' - 'lostNote' - 'lostAt') || jsonb_build_object('stage', p_stage, 'stageChangedAt', now())
       || case when p_stage = 'lost' then jsonb_build_object('lostReason', p_lost_reason, 'lostNote', p_note, 'lostAt', now()) else '{}'::jsonb end;
  update public.inquiries set data = d, updated_at = now(), updated_by = public._actor_name() where id = p_inquiry_id;
  return public.inquiry_public_data(d, public.can_view_cost());
end $$;

create or replace function public._next_revision(r text) returns text
language sql immutable as $$
  select case when coalesce(r, '') = '' then 'B'
              when r ~ '^[A-Y]$' then chr(ascii(r) + 1)
              when r = 'Z' then 'Z2'
              when r ~ '^Z\d+$' then 'Z' || (substring(r from 2)::int + 1)
              else r || '2' end
$$;

create or replace function public.revise_quote(p_inquiry_id text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d jsonb; v_rev text;
begin
  select data into d from public.inquiries where id = p_inquiry_id for update;
  if d is null then raise exception 'Quote % not found.', p_inquiry_id; end if;
  if not public._can_edit_quote(d) then raise exception 'You can only revise your own quotes.'; end if;
  if d->>'stage' = 'won' then raise exception 'Quote % is already a sales order; amend the sales order instead.', coalesce(d->>'refNo', p_inquiry_id); end if;
  v_rev := coalesce(nullif(d->>'revision', ''), 'A');
  insert into public.quote_revisions (inquiry_id, revision, data, note, created_by) values (p_inquiry_id, v_rev, d, p_note, public._actor_name())
  on conflict (inquiry_id, revision) do nothing;
  d := (d - 'approval') || jsonb_build_object('revision', public._next_revision(v_rev), 'revisedAt', now(), 'revisionNote', p_note,
         'validUntil', to_char(public._riyadh_today() + 30, 'YYYY-MM-DD'),
         'stage', case when d->>'stage' = 'lost' then 'quoted' else coalesce(d->>'stage', 'new_inquiry') end);
  update public.inquiries set data = d, updated_at = now(), updated_by = public._actor_name() where id = p_inquiry_id;
  return public.inquiry_public_data(d, public.can_view_cost());
end $$;

create or replace function public.sales_pipeline(p_from date default null, p_to date default null)
returns table (stage text, salesman_id text, salesman_name text, division text, lost_reason text, quotes integer, value_sar numeric)
language sql stable security definer set search_path = public as $$
  select coalesce(i.data->>'stage', 'new_inquiry'), i.data->>'salesmanId', max(i.data->>'assignedSalesName'), coalesce(i.data->>'division', 'MEP'),
         i.data->>'lostReason', count(*)::int, public._r2(sum(public._quote_sell(i.data)))
  from public.inquiries i
  where (public.has_role('admin','ceo','manager','finance') or (public.is_sales() and i.data->>'salesmanId' = public.uid_text()))
    and (p_from is null or public.riyadh_date(i.created_at) >= p_from)
    and (p_to is null or public.riyadh_date(i.created_at) <= p_to)
  group by 1, 2, 4, 5
  order by 1, 3
$$;

-- inquiry_public_data (0002 version; 0013 also hides the approval's margin snapshot)
create or replace function public.inquiry_public_data(d jsonb, p_with_cost boolean) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  m numeric := coalesce(nullif(d->>'marginPercent','')::numeric, 0);
  items jsonb;
begin
  select coalesce(jsonb_agg(
           (case when p_with_cost then e else e - array['buyUnitCost','buyCurrency'] end)
           || jsonb_build_object('sellUnitSar', round(
                case when m >= 100 then c else c / (1 - m / 100) end, 4))
           order by o), '[]'::jsonb)
    into items
  from jsonb_array_elements(case when jsonb_typeof(d->'boqItems') = 'array' then d->'boqItems' else '[]'::jsonb end)
       with ordinality as x(e, o),
       lateral (select coalesce(nullif(e->>'buyUnitCost','')::numeric, 0) * public.fx_rate(e->>'buyCurrency') as c) cc;
  d := jsonb_set(d, '{boqItems}', items);
  if not p_with_cost then
    d := (d - array['marginPercent'])
         || case when d ? 'approval' then jsonb_build_object('approval', (d->'approval') - 'marginPercent' - 'fingerprint') else '{}'::jsonb end;   -- 0013
  end if;
  return d;
end $$;

-- save_inquiry (0002 version; 0013 protects the approval / stage / revision fields)
create or replace function public.save_inquiry(p_id text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role  text := public.app_role();
  v_uid   text := auth.uid()::text;
  v_old   jsonb;
  v_new   jsonb := coalesce(p_data, '{}'::jsonb);
  v_name  text;
  v_items jsonb;
begin
  if v_role is null or v_role not in ('admin','ceo','manager','sales_mep','sales_it') then
    raise exception 'Your role cannot create or edit quotes.';
  end if;
  if p_id is null or p_id = '' then
    raise exception 'save_inquiry: id is required';
  end if;

  select data into v_old from public.inquiries where id = p_id for update;
  select full_name into v_name from public.team_profiles where id::text = v_uid;

  -- drop values the read view computes
  select coalesce(jsonb_agg(e - 'sellUnitSar' order by o), '[]'::jsonb) into v_items
  from jsonb_array_elements(case when jsonb_typeof(v_new->'boqItems') = 'array' then v_new->'boqItems' else '[]'::jsonb end)
       with ordinality as x(e, o);
  v_new := jsonb_set(v_new, '{boqItems}', v_items);

  if v_role in ('sales_mep','sales_it') then
    if v_old is not null and v_old->>'salesmanId' is distinct from v_uid then
      raise exception 'You can only edit your own quotes.';
    end if;

    v_new := v_new
      || jsonb_build_object(
           'id', p_id,
           'salesmanId', v_uid,
           'assignedSalesName', coalesce(v_name, v_new->>'assignedSalesName'),
           'commissionPct', coalesce((select commission_pct from public.team_profiles where id::text = v_uid), 0),
           'marginPercent', coalesce(v_old->'marginPercent', '20'::jsonb),
           'managerApproved', coalesce(v_old->'managerApproved', 'false'::jsonb),
           'stage', case when v_new->>'stage' = 'won' and coalesce(v_old->>'stage','') <> 'won'
                         then coalesce(v_old->'stage', '"new_inquiry"'::jsonb)
                         else coalesce(v_new->'stage', v_old->'stage', '"new_inquiry"'::jsonb) end);

    -- restore protected cost fields line by line:
    --   line switched to (or newly given) a catalogue item -> that item's cost
    --   existing line                                      -> the stored cost
    --   new free-text line                                 -> 0 SAR (a manager prices it)
    select coalesce(jsonb_agg(
             e || case
               when im.id is not null and (ol.oe is null or ol.oe->>'itemId' is distinct from e->>'itemId') then
                 jsonb_build_object('buyUnitCost', to_jsonb(coalesce(im.purchase_price, 0)),
                                    'buyCurrency', to_jsonb(coalesce(im.purchase_currency, 'SAR')))
               when ol.oe is not null then
                 jsonb_build_object('buyUnitCost', coalesce(ol.oe->'buyUnitCost', '0'::jsonb),
                                    'buyCurrency', coalesce(ol.oe->'buyCurrency', '"SAR"'::jsonb))
               else
                 jsonb_build_object('buyUnitCost', 0, 'buyCurrency', 'SAR')
             end
             order by o), '[]'::jsonb)
      into v_items
    from jsonb_array_elements(v_new->'boqItems') with ordinality as x(e, o)
    left join lateral (
      select oe from jsonb_array_elements(coalesce(v_old->'boqItems', '[]'::jsonb)) oe where oe->>'id' = e->>'id' limit 1
    ) ol on true
    left join public.items im on im.id = e->>'itemId';
    v_new := jsonb_set(v_new, '{boqItems}', v_items);
  else
    v_new := v_new || jsonb_build_object('id', p_id);
  end if;

  -- 0013: approval, stage, revision and lost reason change only through approve_quote / set_quote_stage / revise_quote /
  -- post_sales_order. A quote that is already a sales order cannot be edited.
  if v_old->>'stage' = 'won' then raise exception 'This quote is already a sales order; amend the sales order instead.'; end if;
  v_new := (v_new - 'approval' - 'stage' - 'revision' - 'lostReason' - 'lostNote' - 'lostAt' - 'managerApproved')
           || jsonb_build_object('stage', coalesce(v_old->'stage', '"new_inquiry"'::jsonb), 'revision', coalesce(v_old->'revision', '"A"'::jsonb),
                                 'validUntil', coalesce(nullif(v_new->>'validUntil', ''), v_old->>'validUntil', to_char(public._riyadh_today() + 30, 'YYYY-MM-DD')))
           || jsonb_strip_nulls(jsonb_build_object('approval', v_old->'approval', 'lostReason', v_old->'lostReason', 'lostNote', v_old->'lostNote',
                                                   'lostAt', v_old->'lostAt'));

  insert into public.inquiries (id, data, updated_at, updated_by)
  values (p_id, v_new, now(), coalesce(v_name, 'ERP User'))
  on conflict (id) do update set data = excluded.data, updated_at = now(), updated_by = excluded.updated_by;

  return public.inquiry_public_data(v_new, public.can_view_cost());
end $$;

-- ---------------------------------------------------------------------
-- 3. Credit control
-- ---------------------------------------------------------------------
-- p_exclude_so: the SO being invoiced (its open value becomes the invoice)
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
  select coalesce(sum(greatest(0, so.grand_total_sar - coalesce((select sum(grand_total_sar) from public.invoices where so_id = so.id), 0))), 0)
    into v_so
  from public.sales_orders so
  where so.status not in ('cancelled') and so.id is distinct from p_exclude_so
    and ((c.id is not null and so.customer_id = c.id) or lower(trim(so.client_name)) = coalesce(lower(trim(c.name_en)), v_name));
  return jsonb_build_object('customerId', c.id, 'customer', coalesce(c.name_en, p_client_name), 'creditLimit', coalesce(c.credit_limit_sar, 0),
    'paymentTerms', coalesce(c.payment_terms, 'Net 30'), 'openAr', public._r2(v_ar), 'openOrders', public._r2(v_so),
    'overdueInvoices', v_overdue, 'oldestDaysPastDue', greatest(coalesce(v_oldest, 0), 0), 'overdueBlockDays', v_days);
end $$;

drop function if exists public._credit_problems(jsonb, numeric);
create or replace function public._credit_problems(e jsonb, p_new numeric, p_check_limit boolean default true) returns text[]
language sql immutable as $$
  select array_remove(array[
    case when p_check_limit and public._num(e->'creditLimit') > 0 and public._num(e->'openAr') + public._num(e->'openOrders') + coalesce(p_new, 0) > public._num(e->'creditLimit') + 0.01
         then format('open receivables SAR %s + open orders SAR %s + this SAR %s exceed the credit limit of SAR %s',
                     public._num(e->'openAr'), public._num(e->'openOrders'), public._r2(coalesce(p_new, 0)), public._num(e->'creditLimit')) end,
    case when public._num(e->'overdueInvoices') > 0
         then format('%s invoice(s) more than %s days past due', e->>'overdueInvoices', e->>'overdueBlockDays') end], null)
$$;

create or replace function public.credit_status(p_customer_id text, p_client_name text default null, p_new_amount numeric default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e jsonb;
begin
  if not public.has_any_role() then raise exception 'Not allowed.'; end if;
  e := public._customer_exposure(p_customer_id, p_client_name);
  return e || jsonb_build_object('available', case when public._num(e->'creditLimit') > 0 then public._r2(public._num(e->'creditLimit') - public._num(e->'openAr') - public._num(e->'openOrders')) end,
                                 'problems', to_jsonb(public._credit_problems(e, p_new_amount)));
end $$;

-- Finance: let one blocked document through. p_ref_id: quote id (SO), delivery note id (invoice), SO id (amendment)
create or replace function public.grant_credit_override(p_doc_type text, p_ref_id text, p_reason text) returns public.credit_overrides
language plpgsql security definer set search_path = public as $$
declare o public.credit_overrides; v_client text;
begin
  perform public._require_role('admin','ceo','finance');
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for the credit override.'; end if;
  v_client := case p_doc_type when 'SO' then (select data->>'clientName' from public.inquiries where id = p_ref_id)
                              when 'INVOICE' then (select client_name from public.delivery_notes where id = p_ref_id)
                              when 'SO_AMEND' then (select client_name from public.sales_orders where id = p_ref_id) end;
  if v_client is null then raise exception 'Document % not found.', p_ref_id; end if;
  insert into public.credit_overrides (doc_type, ref_id, client_name, reason, granted_by) values (p_doc_type, p_ref_id, v_client, trim(p_reason), public._actor_name())
  returning * into o;
  return o;
end $$;

create or replace function public._use_credit_override(p_doc_type text, p_ref_id text, p_doc text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  select id into v_id from public.credit_overrides where doc_type = p_doc_type and ref_id = p_ref_id and used_at is null order by id limit 1 for update;
  if v_id is null then return false; end if;
  update public.credit_overrides set used_at = now(), used_doc = p_doc where id = v_id;
  return true;
end $$;

-- ---------------------------------------------------------------------
-- 4. Checks when a sales order / invoice row is created (covers every posting path)
-- ---------------------------------------------------------------------
create or replace function public._so_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare d jsonb; a jsonb; e jsonb; v_prob text[];
begin
  if public.is_maintenance_session() then return new; end if;
  select data into d from public.inquiries where id = new.inquiry_id;
  if d is not null then
    a := public._quote_approval(d);
    if (a->>'needed')::boolean and not (a->>'approved')::boolean then
      raise exception 'Quote % needs manager approval before it becomes a sales order (%).%', coalesce(d->>'refNo', new.inquiry_id),
        (select string_agg(x, '; ') from jsonb_array_elements_text(a->'reasons') x),
        case when (a->>'stale')::boolean then ' It was approved, but the pricing changed afterwards.' else '' end
        using errcode = 'P0001';
    end if;
  end if;
  new.payment_terms := coalesce(nullif(new.payment_terms, ''), nullif(d->>'paymentTerms', ''),
                                (select payment_terms from public.customers where id = new.customer_id), 'Net 30');
  e := public._customer_exposure(new.customer_id, new.client_name);
  v_prob := public._credit_problems(e, new.grand_total_sar);
  if cardinality(v_prob) > 0 and not public._use_credit_override('SO', coalesce(new.inquiry_id, ''), new.so_number) then
    raise exception 'Credit check failed for %: %. Ask Finance for a credit override, or collect first.', new.client_name, array_to_string(v_prob, '; ')
      using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_b_so_controls on public.sales_orders;
create trigger trg_b_so_controls before insert on public.sales_orders for each row execute function public._so_before_insert();

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
  if new.so_id is not null then
    select greatest(0, so.grand_total_sar - coalesce((select sum(grand_total_sar) from public.invoices where so_id = so.id), 0)) into v_so_open
      from public.sales_orders so where so.id = new.so_id;
  end if;
  v_prob := public._credit_problems(e || jsonb_build_object('openOrders', public._num(e->'openOrders') + coalesce(v_so_open, 0)),
                                    greatest(0, new.grand_total_sar - coalesce(v_so_open, 0)),
                                    new.grand_total_sar > coalesce(v_so_open, 0) + 0.01);
  if cardinality(v_prob) > 0 and not public._use_credit_override('INVOICE', coalesce(new.dn_id, ''), new.invoice_number) then
    raise exception 'Credit check failed for %: %. Ask Finance for a credit override before invoicing.', new.client_name, array_to_string(v_prob, '; ')
      using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_b_invoice_controls on public.invoices;
create trigger trg_b_invoice_controls before insert on public.invoices for each row execute function public._invoice_before_insert();

-- existing invoices get terms and a due date
do $$
begin
  perform set_config('request.jwt.claims', '', true);
  update public.invoices i
     set payment_terms = coalesce(nullif(i.payment_terms, ''), (select nullif(payment_terms, '') from public.sales_orders where id = i.so_id),
                                  (select payment_terms from public.customers where id = i.customer_id), 'Net 30')
   where i.payment_terms is null or i.payment_terms = '';
  update public.invoices set due_date = public.riyadh_date(issued_at) + public._terms_days(payment_terms) where due_date is null;
end $$;

-- the posted-invoice guard: terms / due date are set on insert and never change afterwards (no guard change needed)

-- ---------------------------------------------------------------------
-- 5. AR aging by days past due (replaces the issue-date version)
-- ---------------------------------------------------------------------
drop function if exists public.ar_aging(date);
create or replace function public.ar_aging(p_as_of date default null)
returns table (invoice_id text, invoice_number text, client_name text, issued_on date, due_date date, days_past_due integer, bucket text,
               grand_total_sar numeric, settled_sar numeric, open_sar numeric, days_old integer)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_d date := coalesce(p_as_of, public._riyadh_today());
begin
  perform public._require_role('admin','ceo','finance','manager');
  return query
  select i.id, i.invoice_number, i.client_name, public.riyadh_date(i.issued_at),
         coalesce(i.due_date, public.riyadh_date(i.issued_at) + 30),
         (v_d - coalesce(i.due_date, public.riyadh_date(i.issued_at) + 30))::int as dpd,
         case when v_d - coalesce(i.due_date, public.riyadh_date(i.issued_at) + 30) <= 0 then 'current'
              when v_d - coalesce(i.due_date, public.riyadh_date(i.issued_at) + 30) <= 30 then '1-30'
              when v_d - coalesce(i.due_date, public.riyadh_date(i.issued_at) + 30) <= 60 then '31-60'
              when v_d - coalesce(i.due_date, public.riyadh_date(i.issued_at) + 30) <= 90 then '61-90' else '90+' end,
         i.grand_total_sar + i.debited_amount_sar, public._r2(i.paid_amount_sar + coalesce(i.credited_amount_sar, 0)),
         public._r2(i.grand_total_sar + i.debited_amount_sar - i.paid_amount_sar - coalesce(i.credited_amount_sar, 0)),
         (v_d - public.riyadh_date(i.issued_at))::int
  from public.invoices i
  where public.riyadh_date(i.issued_at) <= v_d
    and i.grand_total_sar + i.debited_amount_sar - i.paid_amount_sar - coalesce(i.credited_amount_sar, 0) > 0.009
  order by 6 desc, 2;
end $$;

-- ---------------------------------------------------------------------
-- 6. Sales order amendments and cancellation (undelivered quantities only), logged
--    p_lines: [{id, orderedQty?, unitSellSar?}] — qty not below what was delivered; price only on lines nothing was delivered on
-- ---------------------------------------------------------------------
create or replace function public._so_totals(p_items jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'sub', coalesce((select sum(public._r2(public._num(l->'orderedQty') * public._num(l->'unitSellSar'))) from jsonb_array_elements(p_items) l), 0),
    'vat', public._breakdown_vat(public._vat_breakdown(p_items, 'orderedQty')),
    'cost', coalesce((select sum(public._num(l->'orderedQty') * public._num(l->'unitCostSar')) from jsonb_array_elements(p_items) l), 0))
$$;

create or replace function public.amend_sales_order(p_so_id text, p_lines jsonb, p_reason text) returns public.sales_orders
language plpgsql security definer set search_path = public as $$
declare so public.sales_orders; it jsonb; ch jsonb; v_items jsonb := '[]'::jsonb; t jsonb; v_grand numeric; v_bad text; e jsonb; v_prob text[];
begin
  perform public._require_role('admin','ceo','manager');
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for the change.'; end if;
  select * into so from public.sales_orders where id = p_so_id for update;
  if so.id is null then raise exception 'Sales order % not found.', p_so_id; end if;
  if so.status = 'cancelled' then raise exception 'Sales order % is cancelled.', so.so_number; end if;
  for it in select x from jsonb_array_elements(so.items) x loop
    select x into ch from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x where x->>'id' = it->>'id' limit 1;
    if ch is not null then
      if ch ? 'orderedQty' then
        if public._num(ch->'orderedQty') < public._num(it->'deliveredQty') then
          v_bad := format('%s: quantity %s is below the %s already delivered', it->>'desc', public._num(ch->'orderedQty'), public._num(it->'deliveredQty'));
          exit;
        end if;
        it := it || jsonb_build_object('orderedQty', public._num(ch->'orderedQty'));
      end if;
      if ch ? 'unitSellSar' and public._num(ch->'unitSellSar') <> public._num(it->'unitSellSar') then
        if public._num(it->'deliveredQty') > 0 then
          v_bad := format('%s: price cannot change after a delivery (issue a debit or credit note instead)', it->>'desc');
          exit;
        end if;
        if public._num(ch->'unitSellSar') < 0 then v_bad := format('%s: price cannot be negative', it->>'desc'); exit; end if;
        it := it || jsonb_build_object('unitSellSar', public._num(ch->'unitSellSar'));
      end if;
    end if;
    v_items := v_items || jsonb_build_array(it);
  end loop;
  if v_bad is not null then raise exception 'Cannot amend %: %.', so.so_number, v_bad; end if;
  t := public._so_totals(v_items);
  v_grand := public._r2(public._num(t->'sub') + public._num(t->'vat'));
  if v_grand > so.grand_total_sar + 0.01 then
    e := public._customer_exposure(so.customer_id, so.client_name, so.id);
    v_prob := public._credit_problems(e, v_grand - coalesce((select sum(grand_total_sar) from public.invoices where so_id = so.id), 0));
    if cardinality(v_prob) > 0 and not public._use_credit_override('SO_AMEND', so.id, so.so_number) then
      raise exception 'Credit check failed for %: %. Ask Finance for a credit override.', so.client_name, array_to_string(v_prob, '; ');
    end if;
  end if;
  insert into public.sales_order_changes (so_id, so_number, change_type, before_items, after_items, before_total, after_total, reason, changed_by)
  values (so.id, so.so_number, 'amend', so.items, v_items, so.grand_total_sar, v_grand, trim(p_reason), public._actor_name());
  update public.sales_orders
     set items = v_items, subtotal_sar = public._r2(public._num(t->'sub')), vat_sar = public._r2(public._num(t->'vat')), grand_total_sar = v_grand,
         total_cost_sar = public._r2(public._num(t->'cost')), updated_at = now(),
         status = case when not exists (select 1 from jsonb_array_elements(v_items) l where public._num(l->'deliveredQty') < public._num(l->'orderedQty')) then 'delivered'
                       when exists (select 1 from jsonb_array_elements(v_items) l where public._num(l->'deliveredQty') > 0) then 'partially_delivered' else 'open' end
   where id = so.id returning * into so;
  return so;
end $$;

create or replace function public.cancel_sales_order(p_so_id text, p_reason text) returns public.sales_orders
language plpgsql security definer set search_path = public as $$
declare so public.sales_orders; v_items jsonb; t jsonb; v_delivered boolean;
begin
  perform public._require_role('admin','ceo','manager');
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for cancelling.'; end if;
  select * into so from public.sales_orders where id = p_so_id for update;
  if so.id is null then raise exception 'Sales order % not found.', p_so_id; end if;
  if so.status in ('cancelled','delivered') then raise exception 'Sales order % has nothing left to cancel.', so.so_number; end if;
  select jsonb_agg(l || jsonb_build_object('orderedQty', public._num(l->'deliveredQty'), 'cancelledQty', public._num(l->'orderedQty') - public._num(l->'deliveredQty')))
    into v_items from jsonb_array_elements(so.items) l;
  v_delivered := exists (select 1 from jsonb_array_elements(so.items) l where public._num(l->'deliveredQty') > 0);
  t := public._so_totals(v_items);
  insert into public.sales_order_changes (so_id, so_number, change_type, before_items, after_items, before_total, after_total, reason, changed_by)
  values (so.id, so.so_number, 'cancel', so.items, v_items, so.grand_total_sar, public._r2(public._num(t->'sub') + public._num(t->'vat')), trim(p_reason), public._actor_name());
  update public.sales_orders
     set items = v_items, subtotal_sar = public._r2(public._num(t->'sub')), vat_sar = public._r2(public._num(t->'vat')),
         grand_total_sar = public._r2(public._num(t->'sub') + public._num(t->'vat')), total_cost_sar = public._r2(public._num(t->'cost')),
         status = case when v_delivered then 'delivered' else 'cancelled' end, cancelled_reason = trim(p_reason), updated_at = now()
   where id = so.id returning * into so;
  if not v_delivered and so.inquiry_id is not null then
    update public.inquiries set data = data || jsonb_build_object('stage', 'lost', 'lostReason', 'PROJECT_CANCELLED', 'lostNote', trim(p_reason), 'lostAt', now()),
           updated_at = now(), updated_by = public._actor_name()
     where id = so.inquiry_id;
  end if;
  return so;
end $$;

-- ---------------------------------------------------------------------
-- 7. RLS, audit, privileges
-- ---------------------------------------------------------------------
alter table public.quote_revisions enable row level security;
alter table public.credit_overrides enable row level security;
alter table public.sales_order_changes enable row level security;
drop policy if exists quote_revisions_read on public.quote_revisions;
create policy quote_revisions_read on public.quote_revisions for select to authenticated
  using (public.has_role('admin','ceo','manager','finance') or (public.is_sales() and data->>'salesmanId' = public.uid_text()));
drop policy if exists credit_overrides_read on public.credit_overrides;
create policy credit_overrides_read on public.credit_overrides for select to authenticated using (public.has_role('admin','ceo','finance','manager'));
drop policy if exists sales_order_changes_read on public.sales_order_changes;
create policy sales_order_changes_read on public.sales_order_changes for select to authenticated
  using (public.has_role('admin','ceo','manager','finance','procurement')
         or (public.is_sales() and public.so_owned(so_id)));
revoke all on public.quote_revisions, public.credit_overrides, public.sales_order_changes from anon, public;
grant select on public.quote_revisions, public.credit_overrides, public.sales_order_changes to authenticated;
revoke insert, update, delete on public.quote_revisions, public.credit_overrides, public.sales_order_changes from authenticated;
do $$
declare t text;
begin
  foreach t in array array['quote_revisions','credit_overrides','sales_order_changes'] loop
    execute format('drop trigger if exists trg_audit_row on public.%I', t);
    execute format('create trigger trg_audit_row after insert or update or delete on public.%I for each row execute function public.audit_row(%L)', t, 'id');
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public._quote_cost(jsonb)', 'public._quote_sell(jsonb)', 'public._quote_approval(jsonb)', 'public._sales_settings()',
                           'public._customer_exposure(text, text, text)', 'public._use_credit_override(text, text, text)', 'public._credit_problems(jsonb, numeric, boolean)', 'public._so_totals(jsonb)',
                           'public._can_edit_quote(jsonb)', 'public._so_before_insert()', 'public._invoice_before_insert()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.quote_approvals()', 'public.approve_quote(text, text)', 'public.set_quote_stage(text, text, text, text)',
                           'public.revise_quote(text, text)', 'public.sales_pipeline(date, date)', 'public.credit_status(text, text, numeric)',
                           'public.grant_credit_override(text, text, text)', 'public.ar_aging(date)', 'public.amend_sales_order(text, jsonb, text)',
                           'public.cancel_sales_order(text, text)', 'public.save_inquiry(text, jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
