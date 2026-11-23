-- =====================================================================
-- 0002_roles_rls.sql — server-side roles and row-level security
-- Closes gaps S1, S3, S5, S6 (and the database half of S4).
-- ---------------------------------------------------------------------
-- Run AFTER 0001_baseline.sql. Idempotent. Runs in one transaction:
-- if anything fails, nothing changes.
--
-- ACCESS MATRIX   W = create/edit   R = read   own = salesperson's own records
-- -------------------------------------------------------------------------------------------
--                          | admin/ceo | finance | manager | sales_mep/it  | procurement
-- customers                | W         | W       | W       | W own         | R
-- inquiries / quotes       | W         | R       | W       | W own (*)     | R
-- sales_orders             | W         | R       | W       | R own (view)  | R + update (deliveries)
-- delivery_notes           | W         | R       | R       | R own (view)  | W
-- invoices, credit_notes   | W         | W       | R       | R own (view)  | -
-- customer_receipts        | W         | W       | R       | R own         | -
-- commission_ledger        | W         | W       | R       | R own (view)  | -
-- vendors                  | W         | W       | R       | -             | W
-- items, custom_uoms       | W         | W       | W       | R (view, no cost) | W
-- purchase_orders          | W         | W       | R       | -             | W
-- supplier_payments        | W         | W       | -       | -             | R
-- GL, bank, expenses, fixed assets, budgets, reconciliations | W admin/ceo/finance only
-- app_settings, document_number_ranges | W admin/ceo/finance; R everyone with a role
-- team_profiles            | R everyone; admin manages; users may edit own name/phone only
-- user_roles               | admin W; users R own row
--
-- (*) Sales never see costs or margins. They read sales documents through the
--     *_v views below, which strip cost fields, and save quotes through
--     save_inquiry(), which keeps the costs and margin a manager entered.
--     Cost is visible to: admin, ceo, finance, manager, procurement.
-- Users with no active row in user_roles get no access at all.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Safety check: refuse to run if nobody would end up as an active admin
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.user_roles') is null and not exists (
    select 1 from public.team_profiles tp
    join auth.users u on u.id::text = tp.id::text
    where tp.role_key = 'admin' and coalesce(tp.active, true)
  ) then
    raise exception '0002_roles_rls: no active team_profiles row with role_key = ''admin'' (linked to auth.users). Set one user''s role to admin first, then re-run.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. user_roles — the only source of truth for roles
-- ---------------------------------------------------------------------
create table if not exists public.user_roles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null check (role in ('admin','ceo','finance','manager','sales_mep','sales_it','procurement')),
  division   text,
  active     boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.user_roles (user_id, role, division, active)
select u.id, tp.role_key, tp.division, coalesce(tp.active, true)
from public.team_profiles tp
join auth.users u on u.id::text = tp.id::text
where tp.role_key in ('admin','ceo','finance','manager','sales_mep','sales_it','procurement')
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------
-- 2. Helper functions (security definer so they can read user_roles under RLS)
-- ---------------------------------------------------------------------
create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.user_roles where user_id = auth.uid() and active
$$;

create or replace function public.has_role(variadic roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() = any(roles), false)
$$;

create or replace function public.has_any_role() returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() is not null
$$;

create or replace function public.is_sales() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('sales_mep','sales_it')
$$;

create or replace function public.can_view_cost() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('admin','ceo','finance','manager','procurement')
$$;

create or replace function public.uid_text() returns text
language sql stable as $$ select auth.uid()::text $$;

create or replace function public.so_owned(p_so_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sales_orders where id = p_so_id and salesman_id = auth.uid()::text)
$$;

create or replace function public.invoice_owned(p_invoice_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.invoices where id = p_invoice_id and salesman_id = auth.uid()::text)
$$;

-- Remove cost fields from a row (as jsonb) and from its line items
create or replace function public.redact_costs(j jsonb) returns jsonb
language sql immutable as $$
  select
    (j - array['total_cost_sar','landed_cost_sar','landed_cost_reversed_sar','net_profit_sar','purchase_price','purchase_currency'])
    || case when jsonb_typeof(j->'items') = 'array' then
         jsonb_build_object('items', coalesce((
           select jsonb_agg(e - array['unitCostSar','unitCostFx','buyUnitCost','buyCurrency','landedCostSar'] order by o)
           from jsonb_array_elements(j->'items') with ordinality as x(e, o)), '[]'::jsonb))
       else '{}'::jsonb end
$$;

-- FX rates as stored by the app (app_settings key 'fx_rates'), with the app's defaults
create or replace function public.fx_rate(p_ccy text) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(value->>coalesce(p_ccy,'SAR'), '')::numeric from public.app_settings where key = 'fx_rates'),
    case coalesce(p_ccy,'SAR') when 'SAR' then 1 when 'USD' then 3.75 when 'EUR' then 4.08
                               when 'GBP' then 4.78 when 'AED' then 1.021 else 1 end)
$$;

-- Quote data as a given viewer should see it: every BOQ line gets sellUnitSar;
-- for non-cost viewers, cost, currency and margin are removed.
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
    d := d - array['marginPercent'];
  end if;
  return d;
end $$;

-- ---------------------------------------------------------------------
-- 3. Drop every existing policy on the app's tables (they were all "using (true)")
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in (
      'inquiries','app_settings','team_profiles','user_roles','customers','vendors','custom_uoms','items',
      'sales_orders','delivery_notes','invoices','customer_receipts','credit_notes','commission_ledger',
      'purchase_orders','supplier_payments','gl_accounts','gl_journal_entries','document_number_ranges',
      'expense_vouchers','fixed_assets','gl_budgets','bank_reconciliations')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. New policies
--    _apply_policies(table, read_roles, insert_roles, update_roles, delete_roles)
--    '*' in read_roles = anyone with an active role.
-- ---------------------------------------------------------------------
create or replace function pg_temp._roles_expr(roles text[]) returns text language sql immutable as $$
  select case
    when roles is null or cardinality(roles) = 0 then 'false'
    when '*' = any(roles) then 'public.has_any_role()'
    else format('public.has_role(%s)', (select string_agg(quote_literal(x), ',') from unnest(roles) x))
  end
$$;

create or replace function pg_temp._apply_policies(t text, rd text[], ins text[], upd text[], del text[]) returns void
language plpgsql as $$
begin
  execute format('alter table public.%I enable row level security', t);
  execute format('revoke all on public.%I from anon', t);
  execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  execute format('create policy %I on public.%I for select to authenticated using (%s)', t||'_read',   t, pg_temp._roles_expr(rd));
  execute format('create policy %I on public.%I for insert to authenticated with check (%s)', t||'_insert', t, pg_temp._roles_expr(ins));
  execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', t||'_update', t, pg_temp._roles_expr(upd), pg_temp._roles_expr(upd));
  execute format('create policy %I on public.%I for delete to authenticated using (%s)', t||'_delete', t, pg_temp._roles_expr(del));
end $$;

select pg_temp._apply_policies('inquiries',        '{admin,ceo,manager,finance,procurement}', '{admin,ceo,manager}', '{admin,ceo,manager}', '{admin,ceo}');
select pg_temp._apply_policies('customers',        '{admin,ceo,manager,finance,procurement}', '{admin,ceo,manager,finance}', '{admin,ceo,manager,finance}', '{admin,ceo}');
select pg_temp._apply_policies('sales_orders',     '{admin,ceo,manager,finance,procurement}', '{admin,ceo,manager}', '{admin,ceo,manager,procurement}', '{admin,ceo}');
select pg_temp._apply_policies('delivery_notes',   '{admin,ceo,manager,finance,procurement}', '{admin,ceo,procurement}', '{admin,ceo,procurement}', '{admin,ceo}');
select pg_temp._apply_policies('invoices',         '{admin,ceo,finance,manager}', '{admin,ceo,finance}', '{admin,ceo,finance}', '{admin,ceo}');
select pg_temp._apply_policies('credit_notes',     '{admin,ceo,finance,manager}', '{admin,ceo,finance}', '{admin,ceo,finance}', '{admin,ceo}');
select pg_temp._apply_policies('customer_receipts','{admin,ceo,finance,manager}', '{admin,ceo,finance}', '{admin,ceo,finance}', '{admin,ceo}');
select pg_temp._apply_policies('commission_ledger','{admin,ceo,finance,manager}', '{admin,ceo,finance}', '{admin,ceo,finance}', '{admin,ceo}');
select pg_temp._apply_policies('vendors',          '{admin,ceo,finance,manager,procurement}', '{admin,ceo,finance,procurement}', '{admin,ceo,finance,procurement}', '{admin,ceo}');
select pg_temp._apply_policies('items',            '{admin,ceo,finance,manager,procurement}', '{admin,ceo,finance,manager,procurement}', '{admin,ceo,finance,manager,procurement}', '{admin,ceo}');
select pg_temp._apply_policies('custom_uoms',      '{*}', '{admin,ceo,finance,manager,procurement}', '{admin,ceo,finance,manager,procurement}', '{admin,ceo}');
select pg_temp._apply_policies('purchase_orders',  '{admin,ceo,finance,manager,procurement}', '{admin,ceo,procurement}', '{admin,ceo,finance,procurement}', '{admin,ceo}');
select pg_temp._apply_policies('supplier_payments','{admin,ceo,finance,procurement}', '{admin,ceo,finance}', '{admin,ceo,finance}', '{admin,ceo}');
select pg_temp._apply_policies('gl_accounts',      '{admin,ceo,finance}', '{admin,ceo,finance}', '{admin,ceo,finance}', '{admin,ceo}');
select pg_temp._apply_policies('gl_journal_entries','{admin,ceo,finance}', '{admin,ceo,finance}', '{admin,ceo,finance}', '{admin,ceo}');
select pg_temp._apply_policies('expense_vouchers', '{admin,ceo,finance}', '{admin,ceo,finance}', '{admin,ceo,finance}', '{admin,ceo}');
select pg_temp._apply_policies('fixed_assets',     '{admin,ceo,finance}', '{admin,ceo,finance}', '{admin,ceo,finance}', '{admin,ceo}');
select pg_temp._apply_policies('gl_budgets',       '{admin,ceo,finance}', '{admin,ceo,finance}', '{admin,ceo,finance}', '{admin,ceo}');
select pg_temp._apply_policies('bank_reconciliations','{admin,ceo,finance}', '{admin,ceo,finance}', '{admin,ceo,finance}', '{admin,ceo}');
select pg_temp._apply_policies('document_number_ranges','{*}', '{admin,ceo,finance}', '{admin,ceo,finance}', '{admin,ceo}');
select pg_temp._apply_policies('app_settings',     '{*}', '{admin,ceo,finance}', '{admin,ceo,finance}', '{admin,ceo}');
select pg_temp._apply_policies('team_profiles',    '{*}', '{admin}', '{admin}', '{admin}');
select pg_temp._apply_policies('user_roles',       '{admin}', '{admin}', '{admin}', '{admin}');

-- Extra row-level grants for salespeople (own records) and for self-service
create policy customers_sales_read   on public.customers for select to authenticated using (public.is_sales() and assigned_salesman_id = public.uid_text());
create policy customers_sales_insert on public.customers for insert to authenticated with check (public.is_sales());
create policy customers_sales_update on public.customers for update to authenticated
  using (public.is_sales() and assigned_salesman_id = public.uid_text())
  with check (public.is_sales() and assigned_salesman_id = public.uid_text());
create policy customer_receipts_sales_read on public.customer_receipts for select to authenticated using (public.is_sales() and public.invoice_owned(invoice_id));
create policy team_profiles_self_update on public.team_profiles for update to authenticated
  using (id::text = public.uid_text()) with check (id::text = public.uid_text());
create policy user_roles_self_read on public.user_roles for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 5. Triggers
-- ---------------------------------------------------------------------
-- Salespeople own the customers they create and can't reassign them
create or replace function public.customers_sales_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_sales() then
    if tg_op = 'INSERT' then
      new.assigned_salesman_id := auth.uid()::text;
    else
      new.assigned_salesman_id := old.assigned_salesman_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_customers_sales_owner on public.customers;
create trigger trg_customers_sales_owner before insert or update on public.customers
  for each row execute function public.customers_sales_owner();

-- Non-admins may only change their own name / phone on team_profiles
create or replace function public.team_profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.has_role('admin') or auth.uid() is null then
    return new;  -- admin, or a migration / service-role call
  end if;
  if (to_jsonb(new) - array['full_name','phone','updated_at']) is distinct from (to_jsonb(old) - array['full_name','phone','updated_at']) then
    raise exception 'Only an administrator can change roles, division, commission or status.';
  end if;
  return new;
end $$;
drop trigger if exists trg_team_profiles_guard on public.team_profiles;
create trigger trg_team_profiles_guard before update on public.team_profiles
  for each row execute function public.team_profiles_guard();

-- Keep user_roles in step when an admin sets role / division / active in the Team screen
create or replace function public.team_profiles_sync_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from auth.users where id::text = new.id::text) then
    return new;
  end if;
  if new.role_key in ('admin','ceo','finance','manager','sales_mep','sales_it','procurement') then
    insert into public.user_roles (user_id, role, division, active, updated_at)
    values (new.id::text::uuid, new.role_key, new.division, coalesce(new.active, true), now())
    on conflict (user_id) do update
      set role = excluded.role, division = excluded.division, active = excluded.active, updated_at = now();
  else
    update public.user_roles set active = false, updated_at = now() where user_id = new.id::text::uuid;
  end if;
  return new;
end $$;
drop trigger if exists trg_team_profiles_sync_role on public.team_profiles;
create trigger trg_team_profiles_sync_role after insert or update of role_key, division, active on public.team_profiles
  for each row execute function public.team_profiles_sync_role();

-- Guard: never leave the system without an active admin
create or replace function public.user_roles_keep_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.user_roles where role = 'admin' and active) then
    raise exception 'At least one active administrator is required.';
  end if;
  return null;
end $$;
drop trigger if exists trg_user_roles_keep_admin on public.user_roles;
create constraint trigger trg_user_roles_keep_admin after update or delete on public.user_roles
  deferrable initially deferred for each row execute function public.user_roles_keep_admin();

-- ---------------------------------------------------------------------
-- 6. Read views: same columns as the tables, rows filtered by role,
--    cost fields removed for roles that may not see cost.
--    Views run with the owner's rights, so they are the ONLY way sales
--    users can read these tables.
-- ---------------------------------------------------------------------
create or replace view public.inquiries_v with (security_barrier = true) as
select t.id,
       public.inquiry_public_data(t.data, public.can_view_cost()) as data,
       t.updated_by, t.updated_at
from public.inquiries t
where public.can_view_cost() or (public.is_sales() and t.data->>'salesmanId' = public.uid_text());

create or replace view public.sales_orders_v with (security_barrier = true) as
select (jsonb_populate_record(null::public.sales_orders,
          case when public.can_view_cost() then to_jsonb(t) else public.redact_costs(to_jsonb(t)) end)).*
from public.sales_orders t
where public.has_role('admin','ceo','manager','finance','procurement') or (public.is_sales() and t.salesman_id = public.uid_text());

create or replace view public.delivery_notes_v with (security_barrier = true) as
select (jsonb_populate_record(null::public.delivery_notes,
          case when public.can_view_cost() then to_jsonb(t) else public.redact_costs(to_jsonb(t)) end)).*
from public.delivery_notes t
where public.has_role('admin','ceo','manager','finance','procurement') or (public.is_sales() and public.so_owned(t.so_id));

create or replace view public.invoices_v with (security_barrier = true) as
select (jsonb_populate_record(null::public.invoices,
          case when public.can_view_cost() then to_jsonb(t) else public.redact_costs(to_jsonb(t)) end)).*
from public.invoices t
where public.has_role('admin','ceo','finance','manager') or (public.is_sales() and t.salesman_id = public.uid_text());

create or replace view public.credit_notes_v with (security_barrier = true) as
select (jsonb_populate_record(null::public.credit_notes,
          case when public.can_view_cost() then to_jsonb(t) else public.redact_costs(to_jsonb(t)) end)).*
from public.credit_notes t
where public.has_role('admin','ceo','finance','manager') or (public.is_sales() and public.invoice_owned(t.original_invoice_id));

create or replace view public.commission_ledger_v with (security_barrier = true) as
select (jsonb_populate_record(null::public.commission_ledger,
          case when public.can_view_cost() then to_jsonb(t) else public.redact_costs(to_jsonb(t)) end)).*
from public.commission_ledger t
where public.has_role('admin','ceo','finance','manager') or (public.is_sales() and t.salesman_id = public.uid_text());

create or replace view public.items_v with (security_barrier = true) as
select (jsonb_populate_record(null::public.items,
          case when public.can_view_cost() then to_jsonb(t) else public.redact_costs(to_jsonb(t)) end)).*
from public.items t
where public.has_any_role();

do $$
declare v text;
begin
  foreach v in array array['inquiries_v','sales_orders_v','delivery_notes_v','invoices_v','credit_notes_v','commission_ledger_v','items_v'] loop
    execute format('revoke all on public.%I from anon, public', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 7. save_inquiry: the only write path for quotes
--    Sales: own quotes only; costs, currency, margin, approval and the
--    'won' stage are kept from the stored quote (or taken from the item
--    master for newly picked catalogue items).
-- ---------------------------------------------------------------------
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

  insert into public.inquiries (id, data, updated_at, updated_by)
  values (p_id, v_new, now(), coalesce(v_name, 'ERP User'))
  on conflict (id) do update set data = excluded.data, updated_at = now(), updated_by = excluded.updated_by;

  return public.inquiry_public_data(v_new, public.can_view_cost());
end $$;

-- ---------------------------------------------------------------------
-- 8. Function privileges
-- ---------------------------------------------------------------------
revoke all on function public.save_inquiry(text, jsonb) from public, anon;
grant execute on function public.save_inquiry(text, jsonb) to authenticated;
revoke all on function public.next_doc_number(text) from public, anon;
grant execute on function public.next_doc_number(text) to authenticated;
grant execute on function public.app_role(), public.has_role(text[]), public.has_any_role(), public.is_sales(),
                          public.can_view_cost(), public.uid_text() to authenticated;

notify pgrst, 'reload schema';

commit;
