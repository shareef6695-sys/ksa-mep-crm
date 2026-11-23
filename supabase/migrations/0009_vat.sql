-- =====================================================================
-- 0009_vat.sql — VAT accuracy. Closes Z5, Z6, Z7, Z10, Z11 (data side), Z12.
-- ---------------------------------------------------------------------
-- Run AFTER 0008. Idempotent; one transaction.
--
-- 1. VAT per line. vat_categories holds the rates (S 15%, Z/E/O 0%) and ZATCA exemption
--    reason codes. Every quote -> SO -> DN -> invoice / credit-note line carries
--    vatCategory, vatRate and exemptionReason (from the item master, or set on the quote line;
--    default S). VAT = sum over lines, computed in the posting functions.
-- 2. Input VAT: claimed only from POSTED supplier bills (by bill date), expense vouchers
--    (by expense date) and customs declarations — never from unbilled purchase orders.
-- 3. Foreign suppliers (vendor_origin <> 'KSA'): no supplier VAT on the PO. Services from
--    abroad are reverse charged on the bill (Dr 1150 / Cr 2100, 15%). VAT paid to customs on
--    imported goods is recorded with post_import_vat (Dr 1150 / Cr bank or 2010).
-- 4. Addresses: customers get building no., street, district, postal code, additional no.,
--    country; standard (B2B) invoices snapshot seller and buyer addresses and list anything
--    ZATCA needs that is missing in zatca_warnings. VAT numbers must be 15 digits starting
--    and ending with 3.
-- 5. vat_return(from, to): the ZATCA VAT return boxes, plus a reconciliation against the
--    movement on GL 2100 (output VAT) and 1150 (input VAT) for the same period.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. VAT categories and exemption reasons
-- ---------------------------------------------------------------------
create table if not exists public.vat_categories (
  code       text primary key check (code in ('S','Z','E','O')),
  label_en   text not null,
  label_ar   text,
  rate       numeric(6,4) not null,
  requires_reason boolean not null default false
);
insert into public.vat_categories (code, label_en, label_ar, rate, requires_reason) values
  ('S', 'Standard rated 15%', 'خاضع للنسبة الأساسية 15%', 0.15, false),
  ('Z', 'Zero rated 0%',      'خاضع لنسبة الصفر',         0,    true),
  ('E', 'Exempt',             'معفى',                     0,    true),
  ('O', 'Out of scope',       'خارج نطاق الضريبة',        0,    true)
on conflict (code) do update set rate = excluded.rate, label_en = excluded.label_en, label_ar = excluded.label_ar;

-- ZATCA exemption / zero-rating reason codes (BT-121) used on invoice lines
create table if not exists public.vat_exemption_reasons (
  code      text primary key,
  category  text not null references public.vat_categories(code),
  label_en  text not null,
  is_export boolean not null default false
);
insert into public.vat_exemption_reasons (code, category, label_en, is_export) values
  ('VATEX-SA-29',   'E', 'Financial services', false),
  ('VATEX-SA-29-7', 'E', 'Life insurance services', false),
  ('VATEX-SA-30',   'E', 'Real estate transactions', false),
  ('VATEX-SA-32',   'Z', 'Export of goods', true),
  ('VATEX-SA-33',   'Z', 'Export of services', true),
  ('VATEX-SA-34-1', 'Z', 'International transport of goods', false),
  ('VATEX-SA-34-2', 'Z', 'International transport of passengers', false),
  ('VATEX-SA-34-3', 'Z', 'Services directly connected to international transport of passengers', false),
  ('VATEX-SA-34-4', 'Z', 'Supply of a qualifying means of transport', false),
  ('VATEX-SA-34-5', 'Z', 'Services relating to goods or passenger transportation', false),
  ('VATEX-SA-35',   'Z', 'Medicines and medical equipment', false),
  ('VATEX-SA-36',   'Z', 'Qualifying metals', false),
  ('VATEX-SA-EDU',  'Z', 'Private education to citizens', false),
  ('VATEX-SA-HEA',  'Z', 'Private healthcare to citizens', false),
  ('VATEX-SA-MLTRY','Z', 'Supply of qualified military goods', false),
  ('VATEX-SA-OOS',  'O', 'Not subject to VAT (out of scope)', false)
on conflict (code) do update set label_en = excluded.label_en, category = excluded.category, is_export = excluded.is_export;

do $$
declare t text;
begin
  foreach t in array array['vat_categories','vat_exemption_reasons'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.has_any_role())', t || '_read', t);
  end loop;
end $$;

create or replace function public._vat_rate(p_cat text) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select rate from public.vat_categories where code = coalesce(nullif(upper(trim(p_cat)), ''), 'S')), 0.15)
$$;

-- ---------------------------------------------------------------------
-- 2. VAT number validation, addresses
-- ---------------------------------------------------------------------
create or replace function public.is_valid_ksa_vat(p text) returns boolean
language sql immutable as $$ select coalesce(p, '') ~ '^3[0-9]{13}3$' $$;
grant execute on function public.is_valid_ksa_vat(text) to authenticated;

alter table public.customers add column if not exists building_no   text;
alter table public.customers add column if not exists street        text;
alter table public.customers add column if not exists district      text;
alter table public.customers add column if not exists postal_code   text;
alter table public.customers add column if not exists additional_no text;
alter table public.customers add column if not exists country       text default 'SA';

alter table public.vendors   add column if not exists is_ksa_vat_registered boolean;

-- New and changed rows must carry a valid KSA VAT number when they carry one at all
-- (existing rows are not checked; see view invalid_vat_numbers).
alter table public.customers drop constraint if exists customers_vat_format;
alter table public.customers add constraint customers_vat_format
  check (coalesce(vat_number, '') = '' or public.is_valid_ksa_vat(vat_number)) not valid;
alter table public.vendors drop constraint if exists vendors_vat_format;
alter table public.vendors add constraint vendors_vat_format
  check (coalesce(vat_number, '') = '' or coalesce(vendor_origin, 'KSA') <> 'KSA' or public.is_valid_ksa_vat(vat_number)) not valid;

create or replace view public.invalid_vat_numbers with (security_barrier = true) as
select 'customer'::text as party_type, id, name_en, vat_number from public.customers
 where coalesce(vat_number, '') <> '' and not public.is_valid_ksa_vat(vat_number)
union all
select 'vendor', id, name_en, vat_number from public.vendors
 where coalesce(vat_number, '') <> '' and coalesce(vendor_origin, 'KSA') = 'KSA' and not public.is_valid_ksa_vat(vat_number);
revoke all on public.invalid_vat_numbers from anon, public;
grant select on public.invalid_vat_numbers to authenticated;


-- Prompt 15 fix: views built on these tables' row types (jsonb_populate_record(null::table, ...)) must be dropped before
-- ALTER TABLE on newer Postgres; they are re-created further down in this migration and re-granted at the end.
drop view if exists public.sales_orders_v;
drop view if exists public.invoices_v;
drop view if exists public.credit_notes_v;
alter table public.sales_orders    add column if not exists customer_id      text;
alter table public.invoices        add column if not exists customer_id      text;
alter table public.invoices        add column if not exists vat_breakdown    jsonb not null default '[]'::jsonb;
alter table public.invoices        add column if not exists seller_address   jsonb;
alter table public.invoices        add column if not exists buyer_address    jsonb;
alter table public.invoices        add column if not exists zatca_warnings   text[] not null default '{}';
alter table public.credit_notes    add column if not exists vat_breakdown    jsonb not null default '[]'::jsonb;
alter table public.purchase_orders add column if not exists vendor_id        text;
alter table public.purchase_orders add column if not exists supply_type      text not null default 'goods';
alter table public.purchase_orders add column if not exists is_foreign_supplier boolean not null default false;
alter table public.purchase_orders add column if not exists reverse_charge_vat_sar numeric(18,2) not null default 0;

-- the 0006 invoice guard allows only collection fields; nothing new here needs to change after issue

-- invoices_v / credit_notes_v pick up the new columns
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
create or replace view public.sales_orders_v with (security_barrier = true) as
select (jsonb_populate_record(null::public.sales_orders,
          case when public.can_view_cost() then to_jsonb(t) else public.redact_costs(to_jsonb(t)) end)).*
from public.sales_orders t
where public.has_role('admin','ceo','manager','finance','procurement') or (public.is_sales() and t.salesman_id = public.uid_text());

-- line helper: VAT fields for a line, from the line itself, else the item master, else standard
create or replace function public._line_vat_fields(p_line jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'vatCategory', c.cat,
    'vatRate', public._vat_rate(c.cat),
    'exemptionReason', case when c.cat = 'S' then null
                            else coalesce(nullif(p_line->>'exemptionReason', ''), (select nullif(zatca_exemption_reason, '') from public.items where id = p_line->>'itemId')) end)
  from (select coalesce(nullif(upper(p_line->>'vatCategory'), ''),
                        (select nullif(upper(zatca_vat_type), '') from public.items where id = p_line->>'itemId'),
                        'S') as cat) c
$$;

-- VAT rate of a line: its stored vatRate, else its category's rate, else 15% (lines from before 0009 have neither)
create or replace function public._line_rate(l jsonb) returns numeric
language sql stable security definer set search_path = public as $$
  select case when l ? 'vatRate' and jsonb_typeof(l->'vatRate') = 'number' then (l->>'vatRate')::numeric
              else public._vat_rate(l->>'vatCategory') end
$$;

-- [{category, rate, exemptionReason, net, vat}] for an array of lines priced qty * unitSellSar
create or replace function public._vat_breakdown(p_lines jsonb, p_qty_key text default 'qty') returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('category', cat, 'rate', rate, 'exemptionReason', reason,
                                               'net', public._r2(net), 'vat', public._r2(vat)) order by cat, reason), '[]'::jsonb)
  from (
    select coalesce(l->>'vatCategory', 'S') as cat, public._line_rate(l) as rate, l->>'exemptionReason' as reason,
           sum(public._num(l->p_qty_key) * public._num(l->'unitSellSar')) as net,
           sum(public._num(l->p_qty_key) * public._num(l->'unitSellSar') * public._line_rate(l)) as vat
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l
    group by 1, 2, 3
  ) g
$$;

-- ---------------------------------------------------------------------
-- 3. Posting functions with per-line VAT (replace the 0004 / 0006 versions)
-- ---------------------------------------------------------------------
create or replace function public.post_sales_order(p_inquiry_id text) returns public.sales_orders
language plpgsql security definer set search_path = public as $$
declare
  d jsonb; m numeric; v_cost numeric := 0; v_sell numeric; v_factor numeric; v_items jsonb; v_vat numeric;
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
           'unitSellSar', case when u.c > 0 then u.c * v_factor else 0 end) || public._line_vat_fields(b) order by o), '[]'::jsonb)
    into v_items
  from jsonb_array_elements(coalesce(d->'boqItems', '[]'::jsonb)) with ordinality as x(b, o),
       lateral (select public._num(b->'buyUnitCost') * public.fx_rate(b->>'buyCurrency') as c) u;

  -- VAT per line (category from the quote line or the item master)
  select coalesce(sum(public._num(it->'unitSellSar') * public._num(b->'qty') * public._line_rate(it)), 0) into v_vat
  from jsonb_array_elements(v_items) with ordinality as x(it, o)
  join jsonb_array_elements(coalesce(d->'boqItems', '[]'::jsonb)) with ordinality as y(b, o2) on o2 = o;

  insert into public.sales_orders (customer_id, so_number, division, inquiry_id, client_name, client_vat, contact_person, phone, email,
                                   salesman_id, salesman_name, commission_pct, status, items, subtotal_sar, vat_sar, grand_total_sar, total_cost_sar)
  values (nullif(d->>'customerId', ''), public.next_doc_number('SO'), coalesce(d->>'division', 'MEP'), p_inquiry_id, d->>'clientName', coalesce(d->>'clientVat', ''),
          d->>'contactPerson', d->>'phone', coalesce(d->>'email', ''), nullif(d->>'salesmanId', ''), d->>'assignedSalesName',
          public._num(d->'commissionPct'), 'open', v_items, public._r2(v_sell), public._r2(v_vat), public._r2(v_sell + v_vat), public._r2(v_cost))
  returning * into v_so;

  update public.inquiries set data = jsonb_set(data, '{stage}', '"won"'), updated_at = now(), updated_by = public._actor_name()
  where id = p_inquiry_id;
  return v_so;
end $$;

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
                                          'unitSellSar', it->'unitSellSar', 'unitCostSar', it->'unitCostSar')
                      || jsonb_strip_nulls(jsonb_build_object('vatCategory', it->'vatCategory', 'vatRate', it->'vatRate', 'exemptionReason', it->'exemptionReason'))
                      order by o)
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

  select coalesce(sum(public._num(it->'qty') * public._num(it->'unitSellSar')), 0),
         coalesce(sum(public._num(it->'qty') * public._num(it->'unitCostSar')), 0)
    into v_sub, v_cost from jsonb_array_elements(coalesce(dn.items, '[]'::jsonb)) it;
  select coalesce(sum(public._num(it->'qty') * public._num(it->'unitSellSar') * public._line_rate(it)), 0)
    into v_vat from jsonb_array_elements(coalesce(dn.items, '[]'::jsonb)) it;
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
                               customer_id, vat_breakdown, seller_address, buyer_address, zatca_warnings)
  values (v_num, coalesce(dn.division, 'MEP'), v_type,
          dn.so_id, dn.so_number, dn.id, dn.client_name, coalesce(so.client_vat, ''),
          so.salesman_id, coalesce(so.salesman_name, 'Unassigned'), coalesce(so.commission_pct, 0), dn.items,
          public._r2(v_sub), public._r2(v_vat), public._r2(v_grand), public._r2(v_cost), 0, 'unpaid',
          case when coalesce((c->>'zatcaPhase2Connected')::boolean, false) then 'cleared' else 'phase1_qr_ready' end,
          public._zatca_qr(c->>'nameEn', c->>'vatNumber', v_iso, v_grand, v_vat), true, v_iso::timestamptz,
          coalesce(so.customer_id, cust.id), public._vat_breakdown(dn.items), v_seller, v_buyer, v_warn)
  returning * into v_inv;

  perform public._gl_post(public.riyadh_date(v_inv.issued_at), 'INVOICE', v_num,
    format('ZATCA Invoice %s - %s (%s)', v_num, dn.client_name, coalesce(dn.so_number, '')),
    jsonb_build_array(
      jsonb_build_object('account_code', '1100', 'debit', v_grand, 'memo', dn.client_name),
      jsonb_build_object('account_code', case when v_it then '4020' else '4010' end, 'credit', v_sub, 'memo', v_num),
      jsonb_build_object('account_code', '2100', 'credit', v_vat, 'memo', 'Output VAT'),
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

create or replace function public.post_credit_note(p_invoice_id text, p_return_qtys jsonb, p_reason text,
                                                   p_reason_code text default 'RETURN') returns public.credit_notes
language plpgsql security definer set search_path = public as $$
declare
  inv public.invoices; c jsonb := public._company(); v_done numeric[]; v_lines jsonb; v_sub numeric; v_cost numeric; v_vat numeric; v_grand numeric;
  v_num text; v_iso text := public._iso_now(); v_cn public.credit_notes; v_open numeric; v_to_ar numeric; v_excess numeric;
  comm public.commission_ledger; v_np numeric; v_elig numeric; v_over text;
begin
  perform public._require_role('admin','ceo','finance');
  if coalesce(p_reason_code, '') not in ('RETURN','DAMAGED','PRICE_ADJUSTMENT','CANCELLATION','OTHER') then
    raise exception 'Unknown credit note reason code %.', p_reason_code;
  end if;
  select * into inv from public.invoices where id = p_invoice_id for update;
  if inv.id is null then raise exception 'Invoice % not found.', p_invoice_id; end if;
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
                             || jsonb_strip_nulls(jsonb_build_object('exemptionReason', it->'exemptionReason')) order by o)
                  filter (where q > 0), '[]'::jsonb),
         coalesce(sum(q * public._num(it->'unitSellSar')), 0), coalesce(sum(q * public._num(it->'unitCostSar')), 0),
         coalesce(sum(q * public._num(it->'unitSellSar') * public._line_rate(it)), 0)
    into v_lines, v_sub, v_cost, v_vat from x;
  if jsonb_array_length(v_lines) = 0 or v_sub <= 0 then raise exception 'Enter a return quantity on at least one line.'; end if;

  v_grand := public._r2(v_sub + v_vat);
  if v_grand > public._r2(inv.grand_total_sar - inv.credited_amount_sar) + 0.01 then
    raise exception 'Credit note SAR % is more than the un-credited value of invoice % (SAR %).', v_grand, inv.invoice_number,
      public._r2(inv.grand_total_sar - inv.credited_amount_sar);
  end if;
  v_open := greatest(0, public._r2(inv.grand_total_sar - inv.paid_amount_sar - inv.credited_amount_sar));
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

  perform public._gl_post(public.riyadh_date(v_cn.issued_at), 'CREDIT_NOTE', v_num,
    format('ZATCA Credit Note %s vs %s (%s)', v_num, inv.invoice_number, inv.client_name),
    jsonb_build_array(
      jsonb_build_object('account_code', '4090', 'debit', v_sub, 'memo', coalesce(p_reason, p_reason_code)),
      jsonb_build_object('account_code', '2100', 'debit', v_vat, 'memo', 'VAT reversal'),
      jsonb_build_object('account_code', '1100', 'credit', v_to_ar, 'memo', inv.client_name),
      jsonb_build_object('account_code', '2050', 'credit', v_excess, 'memo', 'Refund due / credit - ' || inv.client_name),
      jsonb_build_object('account_code', '1200', 'debit', v_cost, 'memo', 'Stock Return Valuation'),
      jsonb_build_object('account_code', '5010', 'credit', v_cost, 'memo', 'COGS Reversal')));

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

create or replace function public.post_purchase_order(p jsonb) returns public.purchase_orders
language plpgsql security definer set search_path = public as $$
declare
  v_fx numeric := nullif(public._num(p->'fx_rate'), 0); v_items jsonb; v_goods_fx numeric; v_goods numeric; v_landed numeric; v_vat numeric;
  so public.sales_orders; v_po public.purchase_orders; vend public.vendors; v_foreign boolean; v_supply text;
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
  if nullif(p->>'vendor_id', '') is not null then select * into vend from public.vendors where id = p->>'vendor_id'; end if;
  v_foreign := coalesce((p->>'is_foreign_supplier')::boolean, coalesce(vend.vendor_origin, 'KSA') <> 'KSA');
  v_supply := case when p->>'supply_type' = 'services' then 'services' else 'goods' end;
  -- KSA VAT is charged only by KSA suppliers with a VAT number; foreign supplies are handled at customs / by reverse charge
  v_vat := case when not v_foreign and coalesce(trim(p->>'supplier_vat'), '') <> '' then (v_goods + v_landed) * 0.15 else 0 end;
  if nullif(p->>'so_id', '') is not null then select * into so from public.sales_orders where id = p->>'so_id'; end if;

  insert into public.purchase_orders (po_number, so_id, so_number, supplier_name, supplier_vat, currency, fx_rate, status, items,
                                      goods_total_fx, goods_total_sar, landed_cost_sar, supplier_vat_sar, total_amount_fx, total_landed_sar,
                                      input_vat_sar, is_ksa_vat_recoverable, paid_amount_fx, paid_amount_sar, payment_status, bill_status,
                                      vendor_id, supply_type, is_foreign_supplier)
  values (public.next_doc_number('PO'), so.id, coalesce(so.so_number, ''), trim(p->>'supplier_name'), coalesce(p->>'supplier_vat', ''),
          coalesce(p->>'currency', 'SAR'), v_fx, 'po_issued', v_items,
          public._r2(v_goods_fx), public._r2(v_goods), public._r2(v_landed), public._r2(v_vat),
          public._r2((v_goods + v_landed + v_vat) / v_fx), public._r2(v_goods + v_landed), public._r2(v_vat), v_vat > 0, 0, 0, 'unpaid', 'unbilled',
          vend.id, v_supply, v_foreign)
  returning * into v_po;
  return v_po;
end $$;

create or replace function public.post_supplier_bill(p_po_id text) returns public.purchase_orders
language plpgsql security definer set search_path = public as $$
declare po public.purchase_orders; v_goods numeric; v_landed numeric; v_vat numeric; v_total numeric; v_bill text; v_fx numeric; v_rc numeric := 0; v_lines jsonb;
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

  v_lines := jsonb_build_array(
      jsonb_build_object('account_code', '1200', 'debit', v_goods + v_landed, 'memo', format('Goods %s @ %s + landed cost', po.currency, v_fx)),
      jsonb_build_object('account_code', '1150', 'debit', v_vat, 'memo', case when coalesce(po.supplier_vat, '') <> '' then 'Supplier VAT ' || po.supplier_vat else '' end),
      jsonb_build_object('account_code', '2010', 'credit', v_total, 'memo', po.supplier_name));
  -- services bought from abroad: self-assess 15% VAT (output) and recover it (input) — reverse charge
  if coalesce(po.is_foreign_supplier, false) and po.supply_type = 'services' then
    v_rc := public._r2((v_goods + v_landed) * 0.15);
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_code', '1150', 'debit', v_rc, 'memo', 'Reverse charge VAT (input)'),
      jsonb_build_object('account_code', '2100', 'credit', v_rc, 'memo', 'Reverse charge VAT (output)'));
  end if;
  perform public._gl_post(public._riyadh_today(), 'SUPPLIER_BILL', v_bill,
    format('Supplier Bill %s - %s (%s)', v_bill, po.supplier_name, po.po_number), v_lines);

  update public.purchase_orders
     set status = 'billed', bill_status = 'posted', bill_number = v_bill, billed_at = now(), updated_at = now(), reverse_charge_vat_sar = v_rc,
         total_amount_fx = case when coalesce(total_amount_fx, 0) > 0 then total_amount_fx else public._r2(v_total / v_fx) end
   where id = po.id returning * into po;
  return po;
end $$;

-- ---------------------------------------------------------------------
-- 4. Customs import VAT
-- ---------------------------------------------------------------------
create table if not exists public.customs_import_vat (
  id               text primary key default gen_random_uuid()::text,
  declaration_no   text not null,
  declaration_date date not null,
  po_id            text references public.purchase_orders(id),
  customs_value_sar numeric(18,2) not null default 0,
  vat_sar          numeric(18,2) not null check (vat_sar > 0),
  paid_from_account_code text not null,
  journal_voucher_number text,
  notes            text default '',
  created_by_uid   uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  constraint customs_import_vat_unique unique (declaration_no)
);
alter table public.customs_import_vat enable row level security;
revoke all on public.customs_import_vat from anon, authenticated;
grant select on public.customs_import_vat to authenticated;
drop policy if exists customs_import_vat_read on public.customs_import_vat;
create policy customs_import_vat_read on public.customs_import_vat for select to authenticated using (public.has_role('admin','ceo','finance','procurement'));
drop trigger if exists trg_audit_row on public.customs_import_vat;
create trigger trg_audit_row after insert or update or delete on public.customs_import_vat for each row execute function public.audit_row('id');
drop trigger if exists trg_guard_posted_row on public.customs_import_vat;
create trigger trg_guard_posted_row before insert or update or delete on public.customs_import_vat
  for each row execute function public.guard_posted_row('declaration_date', 'no_change', 'declaration_no');

create or replace function public.post_import_vat(p_declaration_no text, p_declaration_date date, p_vat_sar numeric,
                                                  p_customs_value_sar numeric default 0, p_po_id text default null,
                                                  p_paid_from text default '1020', p_notes text default '')
returns public.customs_import_vat
language plpgsql security definer set search_path = public as $$
declare v_row public.customs_import_vat; v_jv public.gl_journal_entries; v_vat numeric := public._r2(p_vat_sar);
begin
  perform public._require_role('admin','ceo','finance');
  if coalesce(trim(p_declaration_no), '') = '' then raise exception 'Customs declaration number is required.'; end if;
  if v_vat <= 0 then raise exception 'Import VAT must be greater than zero.'; end if;
  if not (p_paid_from = '2010' or exists (select 1 from public.gl_accounts where account_code = p_paid_from and account_type = 'Asset'
                                           and account_code like '10%' and coalesce(is_active, true))) then
    raise exception 'Pay import VAT from a cash or bank account (10xx), or 2010 if a clearing agent will invoice it.';
  end if;
  if exists (select 1 from public.customs_import_vat where declaration_no = trim(p_declaration_no)) then
    raise exception 'Customs declaration % is already recorded.', trim(p_declaration_no);
  end if;
  v_jv := public._gl_post(p_declaration_date, 'IMPORT_VAT', trim(p_declaration_no),
    format('Import VAT paid at customs - declaration %s', trim(p_declaration_no)),
    jsonb_build_array(
      jsonb_build_object('account_code', '1150', 'debit', v_vat, 'memo', 'Import VAT ' || trim(p_declaration_no)),
      jsonb_build_object('account_code', p_paid_from, 'credit', v_vat, 'memo', 'Customs ' || trim(p_declaration_no))));
  insert into public.customs_import_vat (declaration_no, declaration_date, po_id, customs_value_sar, vat_sar, paid_from_account_code, journal_voucher_number, notes)
  values (trim(p_declaration_no), p_declaration_date, nullif(p_po_id, ''), public._r2(p_customs_value_sar), v_vat, p_paid_from, v_jv.voucher_number, coalesce(p_notes, ''))
  returning * into v_row;
  return v_row;
end $$;

-- ---------------------------------------------------------------------
-- 5. VAT return (ZATCA boxes) + GL reconciliation
-- ---------------------------------------------------------------------
create or replace function public.vat_return(p_from date, p_to date)
returns table (box text, label text, amount_sar numeric, adjustment_sar numeric, vat_sar numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  r record;
begin
  perform public._require_role('admin','ceo','finance');
  return query
  with inv_lines as (
    select coalesce(l->>'vatCategory', 'S') as cat, l->>'exemptionReason' as reason,
           public._num(l->'qty') * public._num(l->'unitSellSar') as net,
           public._num(l->'qty') * public._num(l->'unitSellSar') * public._line_rate(l) as vat
    from public.invoices i cross join lateral jsonb_array_elements(coalesce(i.items, '[]'::jsonb)) l
    where public.riyadh_date(i.issued_at) between p_from and p_to
  ), cn_lines as (
    select coalesce(l->>'vatCategory', 'S') as cat, l->>'exemptionReason' as reason,
           public._num(l->'qty') * public._num(l->'unitSellSar') as net,
           public._num(l->'qty') * public._num(l->'unitSellSar') * public._line_rate(l) as vat
    from public.credit_notes c cross join lateral jsonb_array_elements(coalesce(c.items, '[]'::jsonb)) l
    where public.riyadh_date(c.issued_at) between p_from and p_to
  ), sales as (
    select case when cat = 'S' then '1'
                when cat = 'Z' and reason in ('VATEX-SA-EDU','VATEX-SA-HEA') then '2'
                when cat = 'Z' and exists (select 1 from public.vat_exemption_reasons e where e.code = reason and e.is_export) then '4'
                when cat = 'Z' then '3'
                else '5' end as box,
           sum(net) as net, sum(vat) as vat, 0::numeric as adj_net, 0::numeric as adj_vat from inv_lines group by 1
    union all
    select case when cat = 'S' then '1'
                when cat = 'Z' and reason in ('VATEX-SA-EDU','VATEX-SA-HEA') then '2'
                when cat = 'Z' and exists (select 1 from public.vat_exemption_reasons e where e.code = reason and e.is_export) then '4'
                when cat = 'Z' then '3'
                else '5' end, 0, 0, -sum(net), -sum(vat) from cn_lines group by 1
  ), bills as (
    select p.*, coalesce(p.goods_total_sar, 0) + coalesce(p.landed_cost_sar, 0) as base
    from public.purchase_orders p
    where p.bill_status in ('posted','paid') and p.billed_at is not null
      and public.riyadh_date(p.billed_at) between p_from and p_to
  ), purchases as (
    select '7' as box, sum(base) as net, sum(coalesce(supplier_vat_sar, 0)) as vat from bills where coalesce(supplier_vat_sar, 0) > 0 and not is_foreign_supplier
    union all
    select '7', sum(amount_sar), sum(vat_sar) from public.expense_vouchers
      where status = 'posted' and vat_recoverable and vat_sar > 0 and expense_date between p_from and p_to
    union all
    select '8', sum(customs_value_sar), sum(vat_sar) from public.customs_import_vat where declaration_date between p_from and p_to
    union all
    select '9', sum(base), sum(reverse_charge_vat_sar) from bills where reverse_charge_vat_sar > 0
    union all
    select '10', sum(base), 0 from bills where coalesce(supplier_vat_sar, 0) = 0 and reverse_charge_vat_sar = 0
  ), rc as (
    select coalesce(sum(reverse_charge_vat_sar), 0) as vat from bills
  ), boxes(box, label) as (values
    ('1','Standard rated sales'), ('2','Private healthcare / education to citizens'), ('3','Zero rated domestic sales'), ('4','Exports'), ('5','Exempt / out-of-scope sales'),
    ('6','Total sales'), ('7','Standard rated domestic purchases'), ('8','Imports subject to VAT paid at customs'),
    ('9','Imports subject to VAT under reverse charge'), ('10','Zero rated / non-VAT purchases'), ('12','Total purchases'),
    ('13','Total VAT due for current period'), ('16','Net VAT due (or claimable)'),
    ('GL-2100','GL check: output VAT movement on 2100'), ('GL-1150','GL check: input VAT movement on 1150'),
    ('GL-DIFF-OUT','Difference: return output VAT vs GL 2100'), ('GL-DIFF-IN','Difference: return input VAT vs GL 1150'))
  , s as (select box, sum(net) net, sum(adj_net) adj, sum(vat) + sum(adj_vat) vat from sales group by box)
  , pu as (select box, coalesce(sum(net), 0) net, coalesce(sum(vat), 0) vat from purchases group by box)
  , totals as (
    select (select coalesce(sum(vat), 0) from s) + (select vat from rc) as out_vat,
           (select coalesce(sum(vat), 0) from pu) as in_vat
  ), gl as (
    select coalesce(sum(credit - debit) filter (where account_code = '2100'), 0) as g2100,
           coalesce(sum(debit - credit) filter (where account_code = '1150'), 0) as g1150
    from public.gl_journal_lines where entry_date between p_from and p_to
  )
  select b.box, b.label,
    public._r2(case b.box
      when '6' then (select coalesce(sum(net), 0) from s)
      when '12' then (select coalesce(sum(net), 0) from pu)
      when '13' then null when '16' then null
      when 'GL-2100' then null when 'GL-1150' then null when 'GL-DIFF-OUT' then null when 'GL-DIFF-IN' then null
      else coalesce((select net from s where s.box = b.box), (select net from pu where pu.box = b.box), 0) end),
    public._r2(case b.box when '6' then (select coalesce(sum(adj), 0) from s)
                          else coalesce((select adj from s where s.box = b.box), 0) end),
    public._r2(case b.box
      when '6' then (select coalesce(sum(vat), 0) from s)
      when '9' then (select coalesce(vat, 0) from pu where pu.box = '9')
      when '12' then (select in_vat from totals)
      when '13' then (select out_vat from totals)
      when '16' then (select out_vat - in_vat from totals)
      when 'GL-2100' then (select g2100 from gl)
      when 'GL-1150' then (select g1150 from gl)
      when 'GL-DIFF-OUT' then (select out_vat from totals) - (select g2100 from gl)
      when 'GL-DIFF-IN' then (select in_vat from totals) - (select g1150 from gl)
      else coalesce((select vat from s where s.box = b.box), (select vat from pu where pu.box = b.box), 0) end)
  from boxes b
  order by case when b.box ~ '^[0-9]+$' then lpad(b.box, 3, '0') else 'z' || b.box end;
end $$;

-- ---------------------------------------------------------------------
-- 6. Privileges
-- ---------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['public._line_vat_fields(jsonb)', 'public._vat_rate(text)', 'public._line_rate(jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.post_import_vat(text, date, numeric, numeric, text, text, text)', 'public.vat_return(date, date)',
                           'public.post_purchase_order(jsonb)', 'public.post_supplier_bill(text)', 'public.post_invoice(text)',
                           'public.post_sales_order(text)', 'public.post_delivery_note(text, jsonb, text)',
                           'public.post_credit_note(text, jsonb, text, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';


-- Prompt 15 fix: grants on the re-created views
do $$
declare v text;
begin
  foreach v in array array['sales_orders_v', 'invoices_v', 'credit_notes_v'] loop
    execute format('revoke all on public.%I from anon, public', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end $$;

commit;
