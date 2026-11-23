-- =====================================================================
-- 0011_inventory.sql — stock ledger, moving-average cost, GRNI, serials (gaps F1, F2, A7, F6)
--
-- Decisions (Nov 2026): stock may go negative on delivery (warned, corrected when goods arrive);
-- the go-live difference between the counted opening stock and the old GL 1200 balance goes to
-- 3020 Retained earnings (POs received under the old rules and not yet billed move to 2150 GRNI).
--
--  * warehouses, item_stock (qty / value / moving-average cost per item and warehouse), stock_moves (the ledger),
--    item_serials, stock_documents (opening, adjustment, count, transfer).
--  * GRN:            Dr 1200 Inventory / Cr 2150 GRNI at PO cost incl. landed cost (stocked lines only).
--  * Supplier bill:  Dr 2150 (what the GRN put in) + Dr 5010 for non-stock lines and any difference / Cr 2010.
--  * Delivery note:  Dr 5010 COGS / Cr 1200 at moving-average cost, at delivery. The invoice no longer touches 1200 / 5010
--                    (except for deliveries made before this migration).
--  * Credit note:    returned stocked lines go back into stock at their original delivery cost (Dr 1200 / Cr 5010).
--  * Adjustments / counts: Dr|Cr 1200 against 5020 Inventory adjustments. Transfers move value between warehouses.
--  * Negative stock: a receipt into negative stock re-prices the units already delivered; the difference goes to 5010,
--    so stock value always equals quantity x average cost and the valuation equals GL 1200.
--
-- Run after 0010. Re-runnable.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. Accounts, number ranges, columns
-- ---------------------------------------------------------------------
insert into public.gl_accounts (account_code, account_name_en, account_name_ar, account_type, normal_balance, is_system) values
  ('2150', 'Goods Received Not Invoiced (GRNI)', 'بضاعة مستلمة لم تصل فواتيرها', 'Liability', 'Credit', true),
  ('5020', 'Inventory Adjustments', 'تسويات المخزون', 'Expense', 'Debit', true)
on conflict (account_code) do nothing;

insert into public.document_number_ranges (doc_type, label, prefix, include_year, padding, next_number, reset_annually) values
  ('GRN', 'Goods Receipt Note', 'GRN', true, 5, 1, true),
  ('STOCK_DOC', 'Stock Document (opening / adjustment / count / transfer)', 'STK', true, 5, 1, true)
on conflict (doc_type) do nothing;


-- Prompt 15 fix: views built on these tables' row types (jsonb_populate_record(null::table, ...)) must be dropped before
-- ALTER TABLE on newer Postgres; they are re-created further down in this migration and re-granted at the end.
drop view if exists public.delivery_notes_v;
drop view if exists public.items_v;
alter table public.items add column if not exists is_serialized boolean not null default false;
alter table public.items add column if not exists reorder_level numeric(18,4) not null default 0;

alter table public.purchase_orders add column if not exists grn_number text;
alter table public.purchase_orders add column if not exists grn_at timestamptz;
alter table public.purchase_orders add column if not exists grn_warehouse text;
alter table public.purchase_orders add column if not exists grn_value_sar numeric(18,2);   -- null = received under the old rules
alter table public.purchase_orders add column if not exists grn_source text;

alter table public.delivery_notes add column if not exists warehouse text;
alter table public.delivery_notes add column if not exists inventory_posted boolean not null default false;
alter table public.delivery_notes add column if not exists cogs_sar numeric(18,2) not null default 0;
alter table public.delivery_notes add column if not exists stock_warnings text[] not null default '{}';

-- ---------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------
create table if not exists public.warehouses (
  code        text primary key check (code ~ '^[A-Z0-9_-]{2,20}$'),
  name_en     text not null,
  name_ar     text,
  city        text,
  is_default  boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by_uid uuid,
  updated_by_uid uuid
);
create unique index if not exists warehouses_one_default on public.warehouses ((true)) where is_default;
insert into public.warehouses (code, name_en, name_ar, city, is_default)
select 'MAIN', 'Main Warehouse', 'المستودع الرئيسي', coalesce((select value->>'city' from public.app_settings where key = 'company_profile'), 'Jeddah'), true
where not exists (select 1 from public.warehouses);

create table if not exists public.item_stock (
  item_id     text not null references public.items(id),
  warehouse   text not null references public.warehouses(code),
  qty         numeric(18,4) not null default 0,
  value_sar   numeric(18,2) not null default 0,
  avg_cost    numeric(18,6),
  updated_at  timestamptz not null default now(),
  primary key (item_id, warehouse)
);

create table if not exists public.stock_moves (
  id                 bigserial primary key,
  move_date          date not null,
  item_id            text not null references public.items(id),
  warehouse          text not null references public.warehouses(code),
  qty                numeric(18,4) not null check (qty <> 0),          -- + in / - out
  unit_cost_sar      numeric(18,6) not null,
  value_sar          numeric(18,2) not null,                          -- signed, = what GL 1200 moves (before correction)
  correction_sar     numeric(18,2) not null default 0,                -- re-pricing of units delivered while negative
  move_type          text not null check (move_type in ('OPENING','GRN','DN','CN_RETURN','ADJUST','COUNT','TRANSFER')),
  source_doc_type    text,
  source_doc_id      text,
  source_doc_number  text,
  line_ref           text,
  qty_after          numeric(18,4) not null,
  value_after        numeric(18,2) not null,
  avg_after          numeric(18,6),
  negative           boolean not null default false,
  notes              text,
  created_by_uid     uuid default auth.uid(),
  created_at         timestamptz not null default now()
);
create index if not exists stock_moves_item_idx on public.stock_moves (item_id, warehouse, id);
create index if not exists stock_moves_doc_idx on public.stock_moves (source_doc_type, source_doc_id);
create index if not exists stock_moves_date_idx on public.stock_moves (move_date);

create table if not exists public.item_serials (
  item_id       text not null references public.items(id),
  serial        text not null check (length(trim(serial)) > 0),
  warehouse     text references public.warehouses(code),
  status        text not null default 'in_stock' check (status in ('in_stock','delivered','returned','scrapped')),
  po_id         text,
  grn_number    text,
  dn_id         text,
  dn_number     text,
  received_at   timestamptz,
  delivered_at  timestamptz,
  warranty_end  date,
  notes         text,
  updated_at    timestamptz not null default now(),
  primary key (item_id, serial)
);

create table if not exists public.stock_documents (
  id             text primary key default gen_random_uuid()::text,
  doc_number     text unique,
  doc_type       text not null check (doc_type in ('OPENING','ADJUST','COUNT','TRANSFER')),
  warehouse      text not null references public.warehouses(code),
  to_warehouse   text references public.warehouses(code),
  doc_date       date not null,
  lines          jsonb not null default '[]'::jsonb,
  reason         text,
  value_sar      numeric(18,2) not null default 0,
  summary        jsonb not null default '{}'::jsonb,
  posted_by      text,
  created_by_uid uuid default auth.uid(),
  updated_by_uid uuid,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. Costs stay hidden from sales roles (0002 redaction + the new cost fields)
-- ---------------------------------------------------------------------
create or replace function public.redact_costs(j jsonb) returns jsonb
language sql immutable as $$
  select
    (j - array['total_cost_sar','landed_cost_sar','landed_cost_reversed_sar','net_profit_sar','purchase_price','purchase_currency',
               'avg_cost_sar','cogs_sar','grn_value_sar'])
    || case when jsonb_typeof(j->'items') = 'array' then
         jsonb_build_object('items', coalesce((
           select jsonb_agg(e - array['unitCostSar','unitCostFx','buyUnitCost','buyCurrency','landedCostSar','cogsSar','estUnitCostSar'] order by o)
           from jsonb_array_elements(j->'items') with ordinality as x(e, o)), '[]'::jsonb))
       else '{}'::jsonb end
$$;

-- ---------------------------------------------------------------------
-- 4. The stock engine (internal; only posting functions call it)
--    Returns {value (>= 0, what moves in / out of 1200), correction, unit_cost, negative, qty_after}
-- ---------------------------------------------------------------------
create or replace function public._default_warehouse() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select code from public.warehouses where is_default and active), (select code from public.warehouses where active order by code limit 1))
$$;

create or replace function public._stock_move(p_item text, p_wh text, p_qty numeric, p_unit_cost numeric, p_type text,
                                              p_doc_type text, p_doc_id text, p_doc_number text, p_date date,
                                              p_line_ref text default null, p_notes text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.item_stock; it public.items; v_cost numeric; v_val numeric; v_corr numeric := 0; v_cov numeric;
  v_qty numeric; v_value numeric; v_avg numeric; v_neg boolean := false;
begin
  if coalesce(p_qty, 0) = 0 then raise exception 'A stock movement needs a quantity.'; end if;
  select * into it from public.items where id = p_item;
  if it.id is null then raise exception 'Item % not found.', p_item; end if;
  if not exists (select 1 from public.warehouses where code = p_wh and active) then raise exception 'Warehouse % does not exist or is inactive.', p_wh; end if;
  insert into public.item_stock (item_id, warehouse) values (p_item, p_wh) on conflict do nothing;
  select * into s from public.item_stock where item_id = p_item and warehouse = p_wh for update;

  if p_qty > 0 then
    v_cost := coalesce(p_unit_cost, s.avg_cost, it.avg_cost_sar, 0);
    if v_cost < 0 then raise exception 'Unit cost cannot be negative (%).', it.name_en; end if;
    v_val := public._r2(p_qty * v_cost);
    v_cov := least(p_qty, greatest(0, -s.qty));
    if v_cov > 0 and s.avg_cost is not null then v_corr := public._r2(v_cov * (v_cost - s.avg_cost)); end if;
    v_qty := s.qty + p_qty;
    v_value := s.value_sar + v_val - v_corr;
    if v_qty = 0 then v_corr := v_corr + v_value; v_value := 0; end if;   -- rounding left over when back to zero
    v_avg := case when v_qty > 0 then v_value / v_qty else coalesce(s.avg_cost, v_cost) end;
  else
    -- issue at moving-average cost; with no history, the item's last known cost or its purchase price
    v_cost := coalesce(s.avg_cost, p_unit_cost, it.avg_cost_sar,
                       nullif(it.purchase_price, 0) * public.fx_rate(coalesce(it.purchase_currency, 'SAR')), 0);
    if s.qty > 0 and -p_qty >= s.qty then
      v_val := s.value_sar + public._r2((-p_qty - s.qty) * v_cost);        -- empties the stock exactly
    else
      v_val := public._r2(-p_qty * v_cost);
    end if;
    v_qty := s.qty + p_qty;
    v_value := s.value_sar - v_val;
    v_neg := v_qty < 0;
    v_avg := coalesce(s.avg_cost, v_cost);
    v_cost := case when p_qty <> 0 then v_val / -p_qty else v_cost end;
  end if;

  insert into public.stock_moves (move_date, item_id, warehouse, qty, unit_cost_sar, value_sar, correction_sar, move_type,
                                  source_doc_type, source_doc_id, source_doc_number, line_ref, qty_after, value_after, avg_after, negative, notes)
  values (coalesce(p_date, public._riyadh_today()), p_item, p_wh, p_qty, round(v_cost, 6), case when p_qty > 0 then v_val else -v_val end, v_corr, p_type,
          p_doc_type, p_doc_id, p_doc_number, p_line_ref, v_qty, v_value, round(v_avg, 6), v_neg, p_notes);
  update public.item_stock set qty = v_qty, value_sar = v_value, avg_cost = round(v_avg, 6), updated_at = now()
   where item_id = p_item and warehouse = p_wh;
  update public.items i
     set stock_on_hand = t.q,
         avg_cost_sar = case when t.q > 0 then round(t.v / t.q, 4) else coalesce(round(v_avg, 4), i.avg_cost_sar) end,
         updated_at = now()
    from (select coalesce(sum(qty), 0) as q, coalesce(sum(value_sar), 0) as v from public.item_stock where item_id = p_item) t
   where i.id = p_item;
  return jsonb_build_object('value', v_val, 'correction', v_corr, 'unit_cost', round(v_cost, 6), 'negative', v_neg, 'qty_after', v_qty);
end $$;

-- serials: register on receipt, check out on delivery
create or replace function public._serials_in(p_item text, p_wh text, p_serials jsonb, p_qty numeric, p_po text, p_grn text) returns void
language plpgsql security definer set search_path = public as $$
declare v text; v_n int := 0; it public.items;
begin
  select * into it from public.items where id = p_item;
  for v in select trim(x) from jsonb_array_elements_text(coalesce(p_serials, '[]'::jsonb)) x where trim(x) <> '' loop
    v_n := v_n + 1;
    insert into public.item_serials (item_id, serial, warehouse, status, po_id, grn_number, received_at)
    values (p_item, v, p_wh, 'in_stock', p_po, p_grn, now())
    on conflict (item_id, serial) do update set warehouse = excluded.warehouse, status = 'in_stock', po_id = coalesce(excluded.po_id, item_serials.po_id),
      grn_number = coalesce(excluded.grn_number, item_serials.grn_number), received_at = now(), updated_at = now()
    where item_serials.status in ('delivered','returned');
    if not found then raise exception 'Serial % of % is already in stock.', v, it.name_en; end if;
  end loop;
  if v_n <> p_qty then
    raise exception '% is serialised: enter one serial number per unit (% entered, % received).', it.name_en, v_n, p_qty;
  end if;
end $$;

create or replace function public._serials_out(p_item text, p_wh text, p_serials jsonb, p_qty numeric, p_dn_id text, p_dn_number text) returns text
language plpgsql security definer set search_path = public as $$
declare v text; v_n int := 0; it public.items; v_avail int;
begin
  select * into it from public.items where id = p_item;
  select count(*) into v_avail from public.item_serials where item_id = p_item and warehouse = p_wh and status = 'in_stock';
  if coalesce(jsonb_array_length(p_serials), 0) = 0 and v_avail < p_qty then
    return format('%s: serial numbers not captured (only %s in stock with serials).', it.name_en, v_avail);
  end if;
  for v in select trim(x) from jsonb_array_elements_text(coalesce(p_serials, '[]'::jsonb)) x where trim(x) <> '' loop
    v_n := v_n + 1;
    update public.item_serials set status = 'delivered', dn_id = p_dn_id, dn_number = p_dn_number, delivered_at = now(), updated_at = now()
     where item_id = p_item and serial = v and warehouse = p_wh and status = 'in_stock';
    if not found then raise exception 'Serial % of % is not in stock in warehouse %.', v, it.name_en, p_wh; end if;
  end loop;
  if v_n <> p_qty then
    raise exception '% is serialised: pick one serial number per unit delivered (% picked, % delivered).', it.name_en, v_n, p_qty;
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------
-- 4b. Sales order lines keep the quote's item link, so the delivery can take it out of stock (0009 version + itemId)
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
           'unitSellSar', case when u.c > 0 then u.c * v_factor else 0 end) || public._line_vat_fields(b) || jsonb_strip_nulls(jsonb_build_object('itemId', nullif(b->>'itemId', ''))) order by o), '[]'::jsonb)
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

-- ---------------------------------------------------------------------
-- 5. Purchase order lines keep their item (0009 version + itemId)
-- ---------------------------------------------------------------------
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
                                               'is_stocked_item', coalesce((i->>'is_stocked_item')::boolean, false))
                             || jsonb_strip_nulls(jsonb_build_object('itemId', nullif(i->>'itemId', ''))) order by o), '[]'::jsonb)
    into v_items from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) with ordinality as x(i, o);
  if jsonb_array_length(v_items) = 0 then raise exception 'A purchase order needs at least one line.'; end if;
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

-- ---------------------------------------------------------------------
-- 6. Goods receipt: stocked lines into stock at PO cost incl. landed cost; Dr 1200 / Cr 2150
--    p_serials: {"<line index from 0>": ["SN1", ...]} for serialised items
-- ---------------------------------------------------------------------
drop function if exists public.post_goods_receipt(text);
create or replace function public.post_goods_receipt(p_po_id text, p_serials jsonb default '{}'::jsonb, p_warehouse text default null)
returns public.purchase_orders
language plpgsql security definer set search_path = public as $$
declare
  po public.purchase_orders; v_wh text := coalesce(nullif(p_warehouse, ''), public._default_warehouse()); v_fx numeric; v_goods numeric;
  v_landed numeric; v_n int; it jsonb; o int; m public.items; v_line_sar numeric; v_unit numeric; r jsonb;
  v_val numeric := 0; v_corr numeric := 0; v_items jsonb := '[]'::jsonb; v_num text; v_lines jsonb;
begin
  perform public._require_role('admin','ceo','procurement');
  select * into po from public.purchase_orders where id = p_po_id for update;
  if po.id is null or po.status <> 'po_issued' then raise exception 'Purchase order % is not waiting for goods receipt.', coalesce(po.po_number, p_po_id); end if;
  v_fx := coalesce(nullif(po.fx_rate, 0), 1);
  v_landed := coalesce(po.landed_cost_sar, 0);
  select coalesce(sum(public._num(i->'qty') * public._num(i->'unitCostFx')), 0) * v_fx, count(*) into v_goods, v_n
    from jsonb_array_elements(coalesce(po.items, '[]'::jsonb)) i;
  v_num := public.next_doc_number('GRN');

  for it, o in select x, ord from jsonb_array_elements(coalesce(po.items, '[]'::jsonb)) with ordinality as t(x, ord) loop
    m := null;
    if coalesce((it->>'is_stocked_item')::boolean, false) then
      select * into m from public.items where id = it->>'itemId' and is_stocked_item;
    end if;
    if m.id is not null and public._num(it->'qty') > 0 then
      v_line_sar := public._num(it->'qty') * public._num(it->'unitCostFx') * v_fx;
      -- landed cost (freight, customs, clearance) shared by value
      v_unit := (v_line_sar + case when v_goods > 0 then v_landed * v_line_sar / v_goods else v_landed / greatest(v_n, 1) end) / public._num(it->'qty');
      r := public._stock_move(m.id, v_wh, public._num(it->'qty'), v_unit, 'GRN', 'PO', po.id, v_num, public._riyadh_today(), (o - 1)::text,
                              'GRN ' || v_num || ' / ' || po.po_number);
      v_val := v_val + (r->>'value')::numeric;
      v_corr := v_corr + (r->>'correction')::numeric;
      if m.is_serialized then
        perform public._serials_in(m.id, v_wh, p_serials->((o - 1)::text), public._num(it->'qty'), po.id, v_num);
      end if;
      it := it || jsonb_build_object('received', true, 'warehouse', v_wh, 'unitCostSar', round(v_unit, 6));
    end if;
    v_items := v_items || jsonb_build_array(it);
  end loop;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_code', '1200', 'debit', v_val, 'memo', 'Stock in ' || v_wh),
    jsonb_build_object('account_code', '2150', 'credit', v_val, 'memo', po.supplier_name || ' - ' || po.po_number),
    -- units delivered while stock was negative are re-priced at this receipt's cost
    jsonb_build_object('account_code', '5010', 'debit', greatest(v_corr, 0), 'credit', greatest(-v_corr, 0), 'memo', 'Cost correction (stock was negative)'),
    jsonb_build_object('account_code', '1200', 'debit', greatest(-v_corr, 0), 'credit', greatest(v_corr, 0), 'memo', 'Cost correction (stock was negative)'));
  if v_val <> 0 or v_corr <> 0 then
    perform public._gl_post(public._riyadh_today(), 'GRN', v_num, format('Goods Receipt %s - %s (%s)', v_num, po.supplier_name, po.po_number), v_lines);
  end if;

  update public.purchase_orders
     set status = 'grn_completed', items = v_items, grn_number = v_num, grn_at = now(), grn_warehouse = v_wh,
         grn_value_sar = v_val, grn_source = 'grn', updated_at = now()
   where id = po.id returning * into po;
  return po;
end $$;

-- ---------------------------------------------------------------------
-- 7. Supplier bill: Dr 2150 GRNI + Dr 5010 non-stock / Cr 2010 (0009 version; change marked 0011)
-- ---------------------------------------------------------------------
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
      -- 0011: what the goods receipt put into stock clears GRNI; non-stock lines and any difference are cost of sales.
      --       POs received under the old rules (no GRN value) still debit 1200 as before.
      jsonb_build_object('account_code', case when po.grn_value_sar is null then '1200' else '2150' end,
                         'debit', case when po.grn_value_sar is null then v_goods + v_landed else po.grn_value_sar end,
                         'memo', format('Goods %s @ %s + landed cost', po.currency, v_fx)),
      jsonb_build_object('account_code', '5010',
                         'debit', case when po.grn_value_sar is null then 0 else greatest(public._r2(v_goods + v_landed) - po.grn_value_sar, 0) end,
                         'credit', case when po.grn_value_sar is null then 0 else greatest(po.grn_value_sar - public._r2(v_goods + v_landed), 0) end,
                         'memo', 'Non-stock lines / price difference vs goods receipt'),
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
-- 8. Delivery note: COGS at moving-average cost (0009 version; changes marked 0011)
--    p_serials: {"<SO line id>": ["SN1", ...]}; p_warehouse defaults to the default warehouse
-- ---------------------------------------------------------------------
drop function if exists public.post_delivery_note(text, jsonb, text);
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

-- ---------------------------------------------------------------------
-- 9. Invoice no longer relieves stock; credit notes return stock (0010 versions; changes marked 0011)
-- ---------------------------------------------------------------------
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
                               customer_id, vat_breakdown, seller_address, buyer_address, zatca_warnings)
  values (v_num, coalesce(dn.division, 'MEP'), v_type,
          dn.so_id, dn.so_number, dn.id, dn.client_name, coalesce(so.client_vat, ''),
          so.salesman_id, coalesce(so.salesman_name, 'Unassigned'), coalesce(so.commission_pct, 0), dn.items,
          public._r2(v_sub), public._r2(v_vat), public._r2(v_grand), public._r2(v_cost), 0, 'unpaid',
          'phase1_qr_ready',
          public._zatca_qr(c->>'nameEn', c->>'vatNumber', v_iso, v_grand, v_vat), true, v_iso::timestamptz,
          coalesce(so.customer_id, cust.id), public._vat_breakdown(dn.items), v_seller, v_buyer, v_warn)
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
      jsonb_build_object('account_code', '4090', 'debit', v_sub, 'memo', coalesce(p_reason, p_reason_code)),
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

-- ---------------------------------------------------------------------
-- 10. Stock documents
-- ---------------------------------------------------------------------
-- Opening stock for a warehouse with no movements yet. GL 1200 is brought to the stock ledger's value:
--   Dr 1200 (ledger value after - GL 1200 now); Cr 2150 for POs received under the old rules and not yet billed
--   (first opening only); the rest to 3020 Retained earnings.
--   p_lines: [{itemId, qty, unitCost, serials?: [...]}]
create or replace function public.post_opening_stock(p_warehouse text, p_lines jsonb, p_notes text default null) returns public.stock_documents
language plpgsql security definer set search_path = public as $$
declare
  v_first boolean := not exists (select 1 from public.stock_moves);
  v_before numeric; v_gl numeric; v_val numeric := 0; v_x numeric; v_grni numeric := 0; v_num text := public.next_doc_number('STOCK_DOC');
  v_doc public.stock_documents; l jsonb; m public.items; r jsonb; po record; v_po_grni numeric; v_fx numeric; v_goods numeric; v_n int;
begin
  perform public._require_role('admin','ceo','finance');
  if not exists (select 1 from public.warehouses where code = p_warehouse and active) then raise exception 'Warehouse % not found.', p_warehouse; end if;
  if exists (select 1 from public.stock_moves where warehouse = p_warehouse) then
    raise exception 'Warehouse % already has stock movements; use a stock count or adjustment instead.', p_warehouse;
  end if;
  select coalesce(sum(value_sar), 0) into v_before from public.item_stock;
  select coalesce(sum(debit - credit), 0) into v_gl from public.gl_journal_lines where account_code = '1200';
  -- built in memory and inserted once at the end (posted stock documents never change)
  v_doc := jsonb_populate_record(null::public.stock_documents, jsonb_build_object('id', gen_random_uuid()::text, 'created_at', now(),
           'created_by_uid', auth.uid(), 'value_sar', 0, 'summary', '{}'::jsonb, 'lines', '[]'::jsonb, 'doc_number', v_num, 'doc_type', 'OPENING', 'warehouse', p_warehouse, 'doc_date', public._riyadh_today(), 'lines', coalesce(p_lines, '[]'::jsonb), 'reason', coalesce(p_notes, 'Opening stock'), 'posted_by', public._actor_name()));

  for l in select x from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x loop
    select * into m from public.items where id = l->>'itemId' and is_stocked_item;
    if m.id is null then raise exception 'Opening stock: % is not a stocked item.', coalesce(l->>'itemId', '?'); end if;
    if public._num(l->'qty') <= 0 then raise exception 'Opening stock: quantity for % must be above zero.', m.name_en; end if;
    if public._num(l->'unitCost') < 0 then raise exception 'Opening stock: cost for % cannot be negative.', m.name_en; end if;
    r := public._stock_move(m.id, p_warehouse, public._num(l->'qty'), public._num(l->'unitCost'), 'OPENING', 'STOCK_DOC', v_doc.id, v_num, v_doc.doc_date, null, 'Opening stock');
    v_val := v_val + (r->>'value')::numeric;
    if m.is_serialized then perform public._serials_in(m.id, p_warehouse, l->'serials', public._num(l->'qty'), null, v_num); end if;
  end loop;

  if v_first then
    -- goods received under the old rules and not billed yet: they are in the count, and their bill must clear GRNI
    for po in select * from public.purchase_orders where status = 'grn_completed' and grn_value_sar is null and coalesce(bill_status, 'unbilled') = 'unbilled' loop
      v_fx := coalesce(nullif(po.fx_rate, 0), 1);
      select coalesce(sum(public._num(i->'qty') * public._num(i->'unitCostFx')), 0) * v_fx, count(*) into v_goods, v_n from jsonb_array_elements(coalesce(po.items, '[]'::jsonb)) i;
      select public._r2(coalesce(sum(public._num(i->'qty') * public._num(i->'unitCostFx') * v_fx
               + case when v_goods > 0 then coalesce(po.landed_cost_sar, 0) * public._num(i->'qty') * public._num(i->'unitCostFx') * v_fx / v_goods
                      else coalesce(po.landed_cost_sar, 0) / greatest(v_n, 1) end), 0))
        into v_po_grni
      from jsonb_array_elements(coalesce(po.items, '[]'::jsonb)) i where coalesce((i->>'is_stocked_item')::boolean, false);
      update public.purchase_orders set grn_value_sar = v_po_grni, grn_source = 'golive ' || v_num, updated_at = now() where id = po.id;
      v_grni := v_grni + v_po_grni;
    end loop;
  end if;

  v_x := public._r2(v_before + v_val - v_gl);
  if v_x <> 0 or v_grni <> 0 then
  perform public._gl_post(v_doc.doc_date, 'STOCK_OPENING', v_num, format('Opening stock %s (%s)', v_num, p_warehouse), jsonb_build_array(
    jsonb_build_object('account_code', '1200', 'debit', greatest(v_x, 0), 'credit', greatest(-v_x, 0), 'memo', 'Stock ledger value ' || p_warehouse),
    jsonb_build_object('account_code', '2150', 'credit', greatest(v_grni, 0), 'memo', 'Received, not yet billed (before go-live)'),
    jsonb_build_object('account_code', '3020', 'debit', greatest(v_grni - v_x, 0), 'credit', greatest(v_x - v_grni, 0), 'memo', 'Inventory go-live difference')));
  end if;
  v_doc.value_sar := public._r2(v_val);
  v_doc.summary := jsonb_build_object('stock_value', public._r2(v_val), 'gl_1200_before', public._r2(v_gl), 'ledger_before', public._r2(v_before),
                                 'to_1200', v_x, 'to_grni', v_grni, 'to_retained_earnings', public._r2(v_x - v_grni));
  insert into public.stock_documents select v_doc.* returning * into v_doc;
  return v_doc;
end $$;

-- Adjustment (damage, loss, found stock): p_lines [{itemId, qty (+ / -), unitCost? (for + lines)}]; Dr|Cr 1200 vs 5020
create or replace function public.post_stock_adjustment(p_warehouse text, p_lines jsonb, p_reason text) returns public.stock_documents
language plpgsql security definer set search_path = public as $$
declare v_num text; v_doc public.stock_documents; l jsonb; m public.items; r jsonb; v_net numeric := 0;
begin
  perform public._require_role('admin','ceo','finance');
  if coalesce(trim(p_reason), '') = '' then raise exception 'A stock adjustment needs a reason.'; end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then raise exception 'Enter at least one line.'; end if;
  v_num := public.next_doc_number('STOCK_DOC');
  -- built in memory and inserted once at the end (posted stock documents never change)
  v_doc := jsonb_populate_record(null::public.stock_documents, jsonb_build_object('id', gen_random_uuid()::text, 'created_at', now(),
           'created_by_uid', auth.uid(), 'value_sar', 0, 'summary', '{}'::jsonb, 'lines', '[]'::jsonb, 'doc_number', v_num, 'doc_type', 'ADJUST', 'warehouse', p_warehouse, 'doc_date', public._riyadh_today(), 'lines', p_lines, 'reason', trim(p_reason), 'posted_by', public._actor_name()));
  for l in select x from jsonb_array_elements(p_lines) x loop
    select * into m from public.items where id = l->>'itemId' and is_stocked_item;
    if m.id is null then raise exception 'Adjustment: % is not a stocked item.', coalesce(l->>'itemId', '?'); end if;
    if public._num(l->'qty') = 0 then continue; end if;
    r := public._stock_move(m.id, p_warehouse, public._num(l->'qty'), nullif(public._num(l->'unitCost'), 0), 'ADJUST', 'STOCK_DOC', v_doc.id, v_num, v_doc.doc_date, null, trim(p_reason));
    v_net := v_net + case when public._num(l->'qty') > 0 then (r->>'value')::numeric - (r->>'correction')::numeric else -(r->>'value')::numeric end;
  end loop;
  perform public._gl_post(v_doc.doc_date, 'STOCK_ADJUST', v_num, format('Stock adjustment %s (%s): %s', v_num, p_warehouse, trim(p_reason)), jsonb_build_array(
    jsonb_build_object('account_code', '1200', 'debit', greatest(v_net, 0), 'credit', greatest(-v_net, 0), 'memo', 'Stock ' || p_warehouse),
    jsonb_build_object('account_code', '5020', 'debit', greatest(-v_net, 0), 'credit', greatest(v_net, 0), 'memo', trim(p_reason))));
  v_doc.value_sar := public._r2(v_net);
  insert into public.stock_documents select v_doc.* returning * into v_doc;
  return v_doc;
end $$;

-- Physical count: p_counts [{itemId, countedQty}]; the difference to the system quantity is posted like an adjustment
create or replace function public.post_stock_count(p_warehouse text, p_counts jsonb, p_notes text default null) returns public.stock_documents
language plpgsql security definer set search_path = public as $$
declare v_num text; v_doc public.stock_documents; l jsonb; m public.items; r jsonb; v_net numeric := 0; v_sys numeric; v_lines jsonb := '[]'::jsonb;
begin
  perform public._require_role('admin','ceo','finance','procurement');
  if jsonb_array_length(coalesce(p_counts, '[]'::jsonb)) = 0 then raise exception 'Enter at least one counted item.'; end if;
  v_num := public.next_doc_number('STOCK_DOC');
  -- built in memory and inserted once at the end (posted stock documents never change)
  v_doc := jsonb_populate_record(null::public.stock_documents, jsonb_build_object('id', gen_random_uuid()::text, 'created_at', now(),
           'created_by_uid', auth.uid(), 'value_sar', 0, 'summary', '{}'::jsonb, 'lines', '[]'::jsonb, 'doc_number', v_num, 'doc_type', 'COUNT', 'warehouse', p_warehouse, 'doc_date', public._riyadh_today(), 'reason', coalesce(p_notes, 'Stock count'), 'posted_by', public._actor_name()));
  for l in select x from jsonb_array_elements(p_counts) x loop
    select * into m from public.items where id = l->>'itemId' and is_stocked_item;
    if m.id is null then raise exception 'Count: % is not a stocked item.', coalesce(l->>'itemId', '?'); end if;
    if public._num(l->'countedQty') < 0 then raise exception 'Count: % cannot be negative.', m.name_en; end if;
    select coalesce((select qty from public.item_stock where item_id = m.id and warehouse = p_warehouse), 0) into v_sys;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('itemId', m.id, 'name', m.name_en, 'systemQty', v_sys, 'countedQty', public._num(l->'countedQty'),
                                                               'difference', public._num(l->'countedQty') - v_sys));
    if public._num(l->'countedQty') - v_sys = 0 then continue; end if;
    r := public._stock_move(m.id, p_warehouse, public._num(l->'countedQty') - v_sys, null, 'COUNT', 'STOCK_DOC', v_doc.id, v_num, v_doc.doc_date, null, 'Count');
    v_net := v_net + case when public._num(l->'countedQty') > v_sys then (r->>'value')::numeric - (r->>'correction')::numeric else -(r->>'value')::numeric end;
  end loop;
  if v_net <> 0 then
    perform public._gl_post(v_doc.doc_date, 'STOCK_COUNT', v_num, format('Stock count %s (%s)', v_num, p_warehouse), jsonb_build_array(
      jsonb_build_object('account_code', '1200', 'debit', greatest(v_net, 0), 'credit', greatest(-v_net, 0), 'memo', 'Count ' || p_warehouse),
      jsonb_build_object('account_code', '5020', 'debit', greatest(-v_net, 0), 'credit', greatest(v_net, 0), 'memo', 'Count differences')));
  end if;
  v_doc.lines := v_lines;
  v_doc.value_sar := public._r2(v_net);
  insert into public.stock_documents select v_doc.* returning * into v_doc;
  return v_doc;
end $$;

-- Transfer between warehouses at moving-average cost: p_lines [{itemId, qty, serials?: [...]}]. No P&L effect.
create or replace function public.post_stock_transfer(p_from text, p_to text, p_lines jsonb, p_notes text default null) returns public.stock_documents
language plpgsql security definer set search_path = public as $$
declare v_num text; v_doc public.stock_documents; l jsonb; m public.items; r_out jsonb; r_in jsonb; v_val numeric := 0; v_corr numeric := 0; s text; v_n int;
begin
  perform public._require_role('admin','ceo','finance','procurement');
  if p_from = p_to then raise exception 'Choose two different warehouses.'; end if;
  if not exists (select 1 from public.warehouses where code = p_to and active) then raise exception 'Warehouse % not found.', p_to; end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then raise exception 'Enter at least one line.'; end if;
  v_num := public.next_doc_number('STOCK_DOC');
  -- built in memory and inserted once at the end (posted stock documents never change)
  v_doc := jsonb_populate_record(null::public.stock_documents, jsonb_build_object('id', gen_random_uuid()::text, 'created_at', now(),
           'created_by_uid', auth.uid(), 'value_sar', 0, 'summary', '{}'::jsonb, 'lines', '[]'::jsonb, 'doc_number', v_num, 'doc_type', 'TRANSFER', 'warehouse', p_from, 'to_warehouse', p_to, 'doc_date', public._riyadh_today(), 'lines', p_lines, 'reason', coalesce(p_notes, 'Transfer'), 'posted_by', public._actor_name()));
  for l in select x from jsonb_array_elements(p_lines) x loop
    select * into m from public.items where id = l->>'itemId' and is_stocked_item;
    if m.id is null then raise exception 'Transfer: % is not a stocked item.', coalesce(l->>'itemId', '?'); end if;
    if public._num(l->'qty') <= 0 then raise exception 'Transfer: quantity for % must be above zero.', m.name_en; end if;
    if coalesce((select qty from public.item_stock where item_id = m.id and warehouse = p_from), 0) < public._num(l->'qty') then
      raise exception 'Transfer: not enough % in % to move %.', m.name_en, p_from, public._num(l->'qty');
    end if;
    r_out := public._stock_move(m.id, p_from, -public._num(l->'qty'), null, 'TRANSFER', 'STOCK_DOC', v_doc.id, v_num, v_doc.doc_date, null, 'To ' || p_to);
    r_in := public._stock_move(m.id, p_to, public._num(l->'qty'), (r_out->>'value')::numeric / public._num(l->'qty'), 'TRANSFER', 'STOCK_DOC', v_doc.id, v_num, v_doc.doc_date, null, 'From ' || p_from);
    v_val := v_val + (r_out->>'value')::numeric;
    -- rounding between the two sides, and any re-pricing at a negative destination, goes to COGS
    v_corr := v_corr + (r_in->>'correction')::numeric + ((r_out->>'value')::numeric - (r_in->>'value')::numeric);
    if m.is_serialized then
      v_n := 0;
      for s in select trim(x) from jsonb_array_elements_text(coalesce(l->'serials', '[]'::jsonb)) x where trim(x) <> '' loop
        v_n := v_n + 1;
        update public.item_serials set warehouse = p_to, updated_at = now() where item_id = m.id and serial = s and warehouse = p_from and status = 'in_stock';
        if not found then raise exception 'Serial % of % is not in stock in %.', s, m.name_en, p_from; end if;
      end loop;
      if v_n <> public._num(l->'qty') then raise exception '% is serialised: pick one serial per unit moved.', m.name_en; end if;
    end if;
  end loop;
  if v_corr <> 0 then
    perform public._gl_post(v_doc.doc_date, 'STOCK_TRANSFER', v_num, format('Stock transfer %s: cost correction', v_num), jsonb_build_array(
      jsonb_build_object('account_code', '5010', 'debit', greatest(v_corr, 0), 'credit', greatest(-v_corr, 0), 'memo', 'Transfer cost correction'),
      jsonb_build_object('account_code', '1200', 'debit', greatest(-v_corr, 0), 'credit', greatest(v_corr, 0), 'memo', 'Transfer cost correction')));
  end if;
  v_doc.value_sar := public._r2(v_val);
  insert into public.stock_documents select v_doc.* returning * into v_doc;
  return v_doc;
end $$;

-- ---------------------------------------------------------------------
-- 11. Reports
-- ---------------------------------------------------------------------
-- Stock per item and warehouse; cost and value only for roles that may see costs
create or replace view public.item_stock_v with (security_barrier = true) as
select s.item_id, i.item_code, i.name_en, i.name_ar, i.uom, i.category, s.warehouse, w.name_en as warehouse_name, s.qty,
       case when public.can_view_cost() then s.avg_cost end as avg_cost,
       case when public.can_view_cost() then s.value_sar end as value_sar,
       i.reorder_level, i.is_serialized, s.updated_at
from public.item_stock s join public.items i on i.id = s.item_id join public.warehouses w on w.code = s.warehouse
where public.has_any_role();

-- Items at or below their reorder level (all warehouses)
create or replace view public.low_stock_items with (security_barrier = true) as
select i.id as item_id, i.item_code, i.name_en, i.uom, i.reorder_level, coalesce(sum(s.qty), 0) as qty_on_hand
from public.items i left join public.item_stock s on s.item_id = i.id
where i.is_stocked_item and i.reorder_level > 0 and public.has_any_role()
group by i.id, i.item_code, i.name_en, i.uom, i.reorder_level
having coalesce(sum(s.qty), 0) <= i.reorder_level;

-- Valuation vs the ledger: the stock ledger must equal GL 1200
create or replace function public.inventory_reconciliation(p_as_of date default null)
returns table (stock_value_sar numeric, gl_1200_sar numeric, difference_sar numeric, negative_lines integer, grni_open_sar numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_role('admin','ceo','finance','manager','procurement');
  return query
  select public._r2(coalesce((select sum(m.value_sar - m.correction_sar) from public.stock_moves m where m.move_date <= coalesce(p_as_of, public._riyadh_today())), 0)),
         public._r2(coalesce((select sum(debit - credit) from public.gl_journal_lines where account_code = '1200' and entry_date <= coalesce(p_as_of, public._riyadh_today())), 0)),
         public._r2(coalesce((select sum(m.value_sar - m.correction_sar) from public.stock_moves m where m.move_date <= coalesce(p_as_of, public._riyadh_today())), 0)
                  - coalesce((select sum(debit - credit) from public.gl_journal_lines where account_code = '1200' and entry_date <= coalesce(p_as_of, public._riyadh_today())), 0)),
         (select count(*)::int from public.item_stock where qty < 0),
         public._r2(coalesce((select sum(credit - debit) from public.gl_journal_lines where account_code = '2150' and entry_date <= coalesce(p_as_of, public._riyadh_today())), 0));
end $$;

-- ---------------------------------------------------------------------
-- 12. Views that must pick up the new columns, RLS, audit, privileges
-- ---------------------------------------------------------------------
create or replace view public.delivery_notes_v with (security_barrier = true) as
select (jsonb_populate_record(null::public.delivery_notes,
          case when public.can_view_cost() then to_jsonb(t) else public.redact_costs(to_jsonb(t)) end)).*
from public.delivery_notes t
where public.has_role('admin','ceo','manager','finance','procurement') or (public.is_sales() and public.so_owned(t.so_id));

create or replace view public.items_v with (security_barrier = true) as
select (jsonb_populate_record(null::public.items,
          case when public.can_view_cost() then to_jsonb(t) else public.redact_costs(to_jsonb(t)) end)).*
from public.items t
where public.has_any_role();


alter table public.warehouses enable row level security;
alter table public.item_stock enable row level security;
alter table public.stock_moves enable row level security;
alter table public.item_serials enable row level security;
alter table public.stock_documents enable row level security;
drop policy if exists warehouses_read on public.warehouses;
create policy warehouses_read on public.warehouses for select to authenticated using (public.has_any_role());
drop policy if exists warehouses_write on public.warehouses;
create policy warehouses_write on public.warehouses for all to authenticated
  using (public.has_role('admin','ceo','finance','procurement')) with check (public.has_role('admin','ceo','finance','procurement'));
drop policy if exists item_stock_read on public.item_stock;
create policy item_stock_read on public.item_stock for select to authenticated using (public.can_view_cost());
drop policy if exists stock_moves_read on public.stock_moves;
create policy stock_moves_read on public.stock_moves for select to authenticated using (public.can_view_cost());
drop policy if exists item_serials_read on public.item_serials;
create policy item_serials_read on public.item_serials for select to authenticated using (public.has_any_role());
drop policy if exists stock_documents_read on public.stock_documents;
create policy stock_documents_read on public.stock_documents for select to authenticated using (public.can_view_cost());

revoke all on public.warehouses, public.item_stock, public.stock_moves, public.item_serials, public.stock_documents from anon, public;
grant select, insert, update on public.warehouses to authenticated;
grant select on public.item_stock, public.stock_moves, public.item_serials, public.stock_documents to authenticated;
revoke insert, update, delete on public.item_stock, public.stock_moves, public.item_serials, public.stock_documents from authenticated;
grant usage, select on sequence public.stock_moves_id_seq to service_role;

do $$
declare r record;
begin
  for r in select * from (values ('warehouses','code', null::text[]), ('item_serials','serial', array['updated_at']), ('stock_documents','id', null::text[])) as t(tbl, pk, noise) loop
    execute format('drop trigger if exists trg_audit_row on public.%I', r.tbl);
    execute format('create trigger trg_audit_row after insert or update or delete on public.%I for each row execute function public.audit_row(%s)',
                   r.tbl, array_to_string(array[quote_literal(r.pk)] || coalesce((select array_agg(quote_literal(n)) from unnest(r.noise) n), array[]::text[]), ','));
  end loop;
  execute 'drop trigger if exists trg_stamp_row_user on public.warehouses';
  execute 'create trigger trg_stamp_row_user before insert or update on public.warehouses for each row execute function public.stamp_row_user()';
  execute 'drop trigger if exists trg_guard_posted_row on public.stock_documents';
  execute 'create trigger trg_guard_posted_row before insert or update or delete on public.stock_documents for each row execute function public.guard_posted_row(''doc_date'', ''no_change'', ''doc_number'')';
end $$;
-- stock_moves is the ledger: never changed or deleted
create or replace function public._stock_moves_immutable() returns trigger language plpgsql as $$
begin raise exception 'Stock movements cannot be changed or deleted; post a stock adjustment instead.' using errcode = 'P0001'; end $$;
drop trigger if exists trg_stock_moves_immutable on public.stock_moves;
create trigger trg_stock_moves_immutable before update or delete on public.stock_moves for each row execute function public._stock_moves_immutable();

do $$
declare f text;
begin
  foreach f in array array['public._stock_move(text, text, numeric, numeric, text, text, text, text, date, text, text)',
                           'public._serials_in(text, text, jsonb, numeric, text, text)', 'public._serials_out(text, text, jsonb, numeric, text, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.post_goods_receipt(text, jsonb, text)', 'public.post_delivery_note(text, jsonb, text, jsonb, text)',
                           'public.post_supplier_bill(text)', 'public.post_purchase_order(jsonb)', 'public.post_invoice(text)', 'public.post_sales_order(text)',
                           'public.post_credit_note(text, jsonb, text, text)', 'public.post_opening_stock(text, jsonb, text)',
                           'public.post_stock_adjustment(text, jsonb, text)', 'public.post_stock_count(text, jsonb, text)',
                           'public.post_stock_transfer(text, text, jsonb, text)', 'public.inventory_reconciliation(date)', 'public._default_warehouse()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
grant select on public.item_stock_v, public.low_stock_items to authenticated;
revoke all on public.item_stock_v, public.low_stock_items from anon, public;

notify pgrst, 'reload schema';


-- Prompt 15 fix: grants on the re-created views
do $$
declare v text;
begin
  foreach v in array array['delivery_notes_v', 'items_v'] loop
    execute format('revoke all on public.%I from anon, public', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end $$;

commit;
