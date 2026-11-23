-- =====================================================================
-- 0012_procurement.sql — full procurement cycle (gaps F3, F4, F5, F7)
--
--  * Multi-line purchase orders: item, description, qty, UoM, unit cost (PO currency), VAT category, stocked, SO line.
--  * Approval by amount (app_settings.procurement_settings): above managerApprovalAboveSar a Sales Manager / CEO approves,
--    above ceoApprovalAboveSar only the CEO. The person who raised the PO cannot approve it (admin excepted).
--  * Purchase requisitions from sales-order shortfalls (create_requisition_from_so), turned into POs.
--  * Goods receipts are documents (goods_receipts, GRN-...): per-line received qty, partial receipts, no over-receipt.
--  * Supplier bills are documents (supplier_bills, BILL-...): supplier invoice no. and date, due date from payment terms,
--    lines matched to PO and GRN (3-way match: billed qty <= received - billed), price-variance warnings above the
--    tolerance, actual landed cost allocated over the bill lines by value or quantity. Several bills per PO.
--  * PO status from its lines: pending_approval -> po_issued -> partially_received -> grn_completed (all received) ->
--    partially_billed -> billed -> paid; closed (short-closed) / cancelled. Names before 0012 are kept so old data reads the same.
--  * AP aging per bill by due date (payments on a PO are applied to its bills oldest first; payments ahead of bills show as advances).
--  * VAT return reads supplier_bills.
--
-- Existing POs are converted: line numbers and received / billed quantities are filled in, and every PO billed before 0012
-- gets one supplier_bills row with the amounts it posted (legacy = true). Run after 0011. Re-runnable.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. Settings, number ranges, columns
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value)
values ('procurement_settings', '{"managerApprovalAboveSar": 20000, "ceoApprovalAboveSar": 100000, "priceTolerancePct": 2, "qtyTolerancePct": 0}')
on conflict (key) do nothing;

create or replace function public._proc_settings() returns jsonb
language sql stable security definer set search_path = public as $$
  select '{"managerApprovalAboveSar": 20000, "ceoApprovalAboveSar": 100000, "priceTolerancePct": 2, "qtyTolerancePct": 0}'::jsonb
         || coalesce((select value from public.app_settings where key = 'procurement_settings' and jsonb_typeof(value) = 'object'), '{}'::jsonb)
$$;

insert into public.document_number_ranges (doc_type, label, prefix, include_year, padding, next_number, reset_annually)
values ('PR', 'Purchase Requisition', 'PR', true, 5, 1, true)
on conflict (doc_type) do nothing;

alter table public.purchase_orders add column if not exists approval_status text not null default 'not_required';
alter table public.purchase_orders add column if not exists approval_level text;
alter table public.purchase_orders add column if not exists approved_by_uid uuid;
alter table public.purchase_orders add column if not exists approved_by_name text;
alter table public.purchase_orders add column if not exists approved_at timestamptz;
alter table public.purchase_orders add column if not exists rejection_reason text;
alter table public.purchase_orders add column if not exists pr_id text;
alter table public.purchase_orders add column if not exists billed_total_sar numeric(18,2) not null default 0;
alter table public.purchase_orders add column if not exists billed_total_fx numeric(18,4) not null default 0;
alter table public.purchase_orders add column if not exists closed_reason text;
alter table public.purchase_orders add column if not exists raised_by_uid uuid;

-- ---------------------------------------------------------------------
-- 2. Documents
-- ---------------------------------------------------------------------
create table if not exists public.purchase_requisitions (
  id            text primary key default gen_random_uuid()::text,
  pr_number     text unique,
  so_id         text,
  so_number     text,
  status        text not null default 'open' check (status in ('open','ordered','cancelled')),
  lines         jsonb not null default '[]'::jsonb,   -- [{line, soLineId, itemId, desc, qty, uom, estUnitCostSar, stocked}]
  notes         text,
  po_ids        text[] not null default '{}',
  requested_by  text,
  created_by_uid uuid default auth.uid(),
  updated_by_uid uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.goods_receipts (
  id            text primary key default gen_random_uuid()::text,
  grn_number    text unique,
  po_id         text not null,
  po_number     text,
  supplier_name text,
  warehouse     text,
  receipt_date  date not null,
  lines         jsonb not null default '[]'::jsonb,   -- [{line, itemId, desc, qty, stocked, unitCostSar, valueSar, serials}]
  value_sar     numeric(18,2) not null default 0,
  notes         text,
  received_by   text,
  created_by_uid uuid default auth.uid(),
  updated_by_uid uuid,
  created_at    timestamptz not null default now()
);
create index if not exists goods_receipts_po_idx on public.goods_receipts (po_id);

create table if not exists public.supplier_bills (
  id                      text primary key default gen_random_uuid()::text,
  bill_number             text unique,
  po_id                   text not null,
  po_number               text,
  vendor_id               text,
  supplier_name           text,
  supplier_vat            text,
  supplier_invoice_no     text,
  supplier_invoice_date   date,
  bill_date               date not null,
  due_date                date,
  payment_terms           text,
  currency                text not null default 'SAR',
  fx_rate                 numeric(18,6) not null default 1,
  lines                   jsonb not null default '[]'::jsonb,   -- [{line, desc, qty, unitCostFx, poUnitCostFx, netSar, landedSar, grniSar, varianceSar, stocked}]
  goods_fx                numeric(18,4) not null default 0,
  goods_sar               numeric(18,2) not null default 0,
  landed_sar              numeric(18,2) not null default 0,
  landed_allocation       text not null default 'value' check (landed_allocation in ('value','qty')),
  supplier_vat_sar        numeric(18,2) not null default 0,
  reverse_charge_vat_sar  numeric(18,2) not null default 0,
  total_fx                numeric(18,4) not null default 0,
  total_sar               numeric(18,2) not null default 0,
  grni_cleared_sar        numeric(18,2) not null default 0,
  variance_sar            numeric(18,2) not null default 0,
  is_foreign_supplier     boolean not null default false,
  supply_type             text not null default 'goods',
  warnings                text[] not null default '{}',
  legacy                  boolean not null default false,
  notes                   text,
  posted_by               text,
  created_by_uid          uuid default auth.uid(),
  updated_by_uid          uuid,
  created_at              timestamptz not null default now()
);
create index if not exists supplier_bills_po_idx on public.supplier_bills (po_id, bill_date);
create unique index if not exists supplier_bills_invoice_uq on public.supplier_bills (lower(coalesce(vendor_id, supplier_name)), lower(supplier_invoice_no))
  where supplier_invoice_no is not null and supplier_invoice_no <> '';

-- ---------------------------------------------------------------------
-- 3. Convert existing POs (maintenance: runs as the migration owner)
-- ---------------------------------------------------------------------
do $$
declare po record; v_items jsonb; v_fx numeric; v_goods numeric; v_n int; v_received boolean; v_billed boolean;
begin
  perform set_config('request.jwt.claims', '', true);
  for po in select * from public.purchase_orders where not exists (
              select 1 from jsonb_array_elements(coalesce(items, '[]'::jsonb)) i where i ? 'line') loop
    v_fx := coalesce(nullif(po.fx_rate, 0), 1);
    select coalesce(sum(public._num(i->'qty') * public._num(i->'unitCostFx')), 0) * v_fx, count(*) into v_goods, v_n from jsonb_array_elements(coalesce(po.items, '[]'::jsonb)) i;
    v_received := po.status in ('grn_completed','billed','paid');
    v_billed := po.status in ('billed','paid') or coalesce(po.bill_status, '') in ('posted','paid');
    select coalesce(jsonb_agg(i || jsonb_build_object(
             'line', o, 'uom', coalesce(i->>'uom', 'PCS'),
             'vatCategory', coalesce(i->>'vatCategory', 'S'),
             'receivedQty', case when v_received then public._num(i->'qty') else 0 end,
             -- what the 0011 GRN / go-live put into GRNI for the line (0 for non-stock / old-rules receipts)
             'receivedValue', case when v_received and po.grn_value_sar is not null and coalesce((i->>'is_stocked_item')::boolean, false)
                                   then public._r2(public._num(i->'qty') * public._num(i->'unitCostFx') * v_fx
                                        + case when v_goods > 0 then coalesce(po.landed_cost_sar, 0) * public._num(i->'qty') * public._num(i->'unitCostFx') * v_fx / v_goods
                                               else coalesce(po.landed_cost_sar, 0) / greatest(v_n, 1) end)
                                   else 0 end,
             'billedQty', case when v_billed then public._num(i->'qty') else 0 end,
             'grniCleared', 0, 'billedSar', 0, 'closedQty', 0) order by o), '[]'::jsonb)
      into v_items
    from jsonb_array_elements(coalesce(po.items, '[]'::jsonb)) with ordinality as t(i, o);
    update public.purchase_orders
       set items = v_items,
           grn_source = case when v_received and grn_value_sar is null then 'legacy' else grn_source end,
           approval_status = 'not_required'
     where id = po.id;
  end loop;
  -- the bills those POs posted
  insert into public.supplier_bills (bill_number, po_id, po_number, vendor_id, supplier_name, supplier_vat, bill_date, due_date, payment_terms,
                                     currency, fx_rate, lines, goods_fx, goods_sar, landed_sar, supplier_vat_sar, reverse_charge_vat_sar,
                                     total_fx, total_sar, is_foreign_supplier, supply_type, legacy, notes, posted_by)
  select coalesce(nullif(p.bill_number, ''), 'BILL-' || p.po_number), p.id, p.po_number, p.vendor_id, p.supplier_name, p.supplier_vat,
         public.riyadh_date(coalesce(p.billed_at, p.updated_at, p.created_at)), public.riyadh_date(coalesce(p.billed_at, p.updated_at, p.created_at)),
         p.payment_terms, coalesce(p.currency, 'SAR'), coalesce(nullif(p.fx_rate, 0), 1), p.items,
         coalesce(p.goods_total_fx, 0), coalesce(p.goods_total_sar, 0), coalesce(p.landed_cost_sar, 0), coalesce(p.supplier_vat_sar, 0),
         coalesce(p.reverse_charge_vat_sar, 0), coalesce(p.total_amount_fx, 0),
         public._r2(coalesce(p.goods_total_sar, 0) + coalesce(p.landed_cost_sar, 0) + coalesce(p.supplier_vat_sar, 0)),
         coalesce(p.is_foreign_supplier, false), coalesce(p.supply_type, 'goods'), true, 'Billed before 0012', 'migration 0012'
  from public.purchase_orders p
  where (p.status in ('billed','paid') or coalesce(p.bill_status, '') in ('posted','paid'))
    and not exists (select 1 from public.supplier_bills b where b.po_id = p.id);
  update public.purchase_orders p
     set billed_total_sar = b.t_sar, billed_total_fx = b.t_fx
    from (select po_id, sum(total_sar) as t_sar, sum(total_fx) as t_fx from public.supplier_bills group by po_id) b
   where b.po_id = p.id and p.billed_total_sar = 0;
end $$;

-- ---------------------------------------------------------------------
-- 4. Helpers
-- ---------------------------------------------------------------------
-- 'Net 30' -> 30, 'Advance / Cash' -> 0
create or replace function public._terms_days(p_terms text) returns integer
language sql immutable as $$
  select coalesce(nullif(substring(coalesce(p_terms, '') from '(\d+)'), '')::int, case when p_terms ilike '%advance%' or p_terms ilike '%cash%' then 0 else 30 end)
$$;

-- PO status from its lines
create or replace function public._po_status(p_items jsonb, p_status text, p_paid_fx numeric, p_total_fx numeric) returns text
language sql immutable as $$
  with t as (
    select coalesce(sum(public._num(i->'qty') - public._num(i->'closedQty')), 0) as ord,
           coalesce(sum(public._num(i->'receivedQty')), 0) as rec,
           coalesce(sum(public._num(i->'billedQty')), 0) as bil
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
  )
  select case
    when p_status in ('pending_approval','cancelled') then p_status
    when t.bil > 0 and t.bil >= t.ord - 0.0001 then
      case when coalesce(p_paid_fx, 0) >= coalesce(p_total_fx, 0) - 0.01 and coalesce(p_total_fx, 0) > 0 then 'paid'
           when p_status = 'closed' then 'closed' else 'billed' end
    when t.bil > 0 then 'partially_billed'
    when p_status = 'closed' then 'closed'
    when t.rec >= t.ord - 0.0001 and t.ord > 0 then 'grn_completed'
    when t.rec > 0 then 'partially_received'
    else 'po_issued' end
  from t
$$;

-- unit landed cost of a PO line at the PO's estimated landed cost (shared by value)
create or replace function public._po_line_unit_cost(po public.purchase_orders, l jsonb) returns numeric
language sql stable as $$
  with g as (select coalesce(sum(public._num(i->'qty') * public._num(i->'unitCostFx')), 0) as fx, count(*) as n
             from jsonb_array_elements(coalesce(po.items, '[]'::jsonb)) i)
  select case when public._num(l->'qty') = 0 then 0 else
    (public._num(l->'qty') * public._num(l->'unitCostFx') * coalesce(nullif(po.fx_rate, 0), 1)
     + case when g.fx > 0 then coalesce(po.landed_cost_sar, 0) * public._num(l->'qty') * public._num(l->'unitCostFx') / g.fx
            else coalesce(po.landed_cost_sar, 0) / greatest(g.n, 1) end) / public._num(l->'qty') end
  from g
$$;

-- ---------------------------------------------------------------------
-- 5. Purchase orders: multi-line, VAT per line, approval by amount
--    p: {supplier_name, supplier_vat, vendor_id, currency, fx_rate, landed_cost_sar, supply_type, is_foreign_supplier,
--        payment_terms, so_id, pr_id, notes,
--        items: [{itemId?, desc, qty, uom, unitCostFx, vatCategory?, is_stocked_item?, soId?, soLineId?}]}
-- ---------------------------------------------------------------------
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
                                      vendor_id, supply_type, is_foreign_supplier, payment_terms, approval_status, approval_level, pr_id, raised_by_uid)
  values (public.next_doc_number('PO'), so.id, coalesce(so.so_number, ''), trim(p->>'supplier_name'), coalesce(p->>'supplier_vat', ''),
          coalesce(p->>'currency', 'SAR'), v_fx, case when v_level is null then 'po_issued' else 'pending_approval' end, v_items,
          public._r2(v_goods_fx), public._r2(v_goods), public._r2(v_landed), v_vat,
          public._r2(v_total / v_fx), public._r2(v_goods + v_landed), v_vat, v_vat > 0, 0, 0, 'unpaid', 'unbilled',
          vend.id, v_supply, v_foreign, coalesce(nullif(p->>'payment_terms', ''), vend.payment_terms, 'Net 30'),
          case when v_level is null then 'not_required' else 'pending' end, v_level, v_pr.id, auth.uid())
  returning * into v_po;
  if v_pr.id is not null then
    update public.purchase_requisitions set status = 'ordered', po_ids = array_append(po_ids, v_po.id), updated_at = now() where id = v_pr.id;
  end if;
  return v_po;
end $$;

create or replace function public.approve_purchase_order(p_po_id text) returns public.purchase_orders
language plpgsql security definer set search_path = public as $$
declare po public.purchase_orders;
begin
  select * into po from public.purchase_orders where id = p_po_id for update;
  if po.id is null or po.status <> 'pending_approval' then raise exception 'Purchase order % is not waiting for approval.', coalesce(po.po_number, p_po_id); end if;
  if po.approval_level = 'ceo' then perform public._require_role('admin','ceo');
  else perform public._require_role('admin','ceo','manager'); end if;
  if po.raised_by_uid = auth.uid() and public.app_role() <> 'admin' then
    raise exception 'You raised % yourself; another approver must approve it.', po.po_number;
  end if;
  update public.purchase_orders
     set status = 'po_issued', approval_status = 'approved', approved_by_uid = auth.uid(), approved_by_name = public._actor_name(),
         approved_at = now(), updated_at = now()
   where id = po.id returning * into po;
  return po;
end $$;

create or replace function public.reject_purchase_order(p_po_id text, p_reason text) returns public.purchase_orders
language plpgsql security definer set search_path = public as $$
declare po public.purchase_orders;
begin
  select * into po from public.purchase_orders where id = p_po_id for update;
  if po.id is null or po.status <> 'pending_approval' then raise exception 'Purchase order % is not waiting for approval.', coalesce(po.po_number, p_po_id); end if;
  if po.approval_level = 'ceo' then perform public._require_role('admin','ceo'); else perform public._require_role('admin','ceo','manager'); end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for rejecting.'; end if;
  update public.purchase_orders
     set status = 'cancelled', approval_status = 'rejected', approved_by_uid = auth.uid(), approved_by_name = public._actor_name(),
         approved_at = now(), rejection_reason = trim(p_reason), updated_at = now()
   where id = po.id returning * into po;
  if po.pr_id is not null then
    update public.purchase_requisitions set status = 'open', po_ids = array_remove(po_ids, po.id), updated_at = now() where id = po.pr_id;
  end if;
  return po;
end $$;

-- Cancel a PO nothing was received on, or short-close the quantities the supplier will not deliver
create or replace function public.close_purchase_order(p_po_id text, p_reason text) returns public.purchase_orders
language plpgsql security definer set search_path = public as $$
declare po public.purchase_orders; v_items jsonb; v_rec numeric;
begin
  perform public._require_role('admin','ceo','procurement');
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason.'; end if;
  select * into po from public.purchase_orders where id = p_po_id for update;
  if po.id is null or po.status in ('cancelled','closed','paid') then raise exception 'Purchase order % cannot be closed.', coalesce(po.po_number, p_po_id); end if;
  select coalesce(sum(public._num(i->'receivedQty')), 0) into v_rec from jsonb_array_elements(po.items) i;
  select jsonb_agg(i || jsonb_build_object('closedQty', public._num(i->'qty') - public._num(i->'receivedQty')) order by (i->>'line')::int)
    into v_items from jsonb_array_elements(po.items) i;
  update public.purchase_orders
     set items = v_items, closed_reason = trim(p_reason), updated_at = now(),
         status = case when v_rec = 0 and coalesce(paid_amount_fx, 0) = 0 then 'cancelled'
                       else public._po_status(v_items, 'closed', paid_amount_fx, total_amount_fx) end
   where id = po.id returning * into po;
  return po;
end $$;

-- ---------------------------------------------------------------------
-- 6. Requisitions from sales-order shortfalls
--    stocked item: open SO qty not covered by free stock (on hand + still on order);
--    other lines: open SO qty not yet on a PO or an open requisition for that SO line
-- ---------------------------------------------------------------------
create or replace function public.create_requisition_from_so(p_so_id text, p_notes text default null) returns public.purchase_requisitions
language plpgsql security definer set search_path = public as $$
declare
  so public.sales_orders; it jsonb; o int; m public.items; v_open numeric; v_free numeric; v_need numeric; v_lines jsonb := '[]'::jsonb;
  v_freeby jsonb := '{}'::jsonb; v_pr public.purchase_requisitions; v_n int := 0; v_covered numeric;
begin
  perform public._require_role('admin','ceo','manager','procurement');
  select * into so from public.sales_orders where id = p_so_id;
  if so.id is null then raise exception 'Sales order % not found.', p_so_id; end if;
  for it, o in select x, ord from jsonb_array_elements(coalesce(so.items, '[]'::jsonb)) with ordinality as t(x, ord) loop
    v_open := greatest(0, public._num(it->'orderedQty') - public._num(it->'deliveredQty'));
    if v_open = 0 then continue; end if;
    m := null;
    select * into m from public.items where id = it->>'itemId';
    if m.id is not null and m.is_stocked_item then
      if not v_freeby ? m.id then
        v_freeby := v_freeby || jsonb_build_object(m.id,
          coalesce((select sum(qty) from public.item_stock where item_id = m.id), 0)
          + coalesce((select sum(public._num(l->'qty') - public._num(l->'receivedQty') - public._num(l->'closedQty'))
                        from public.purchase_orders po cross join lateral jsonb_array_elements(po.items) l
                       where po.status not in ('cancelled','closed','paid') and l->>'itemId' = m.id), 0)
          + coalesce((select sum(public._num(l->'qty')) from public.purchase_requisitions r cross join lateral jsonb_array_elements(r.lines) l
                       where r.status = 'open' and l->>'itemId' = m.id), 0));
      end if;
      v_free := public._num(v_freeby->m.id);
      v_need := greatest(0, v_open - greatest(v_free, 0));
      v_freeby := jsonb_set(v_freeby, array[m.id], to_jsonb(v_free - v_open));
    else
      select coalesce(sum(public._num(l->'qty') - public._num(l->'closedQty')), 0) into v_covered
        from public.purchase_orders po cross join lateral jsonb_array_elements(po.items) l
       where po.status <> 'cancelled' and l->>'soId' = so.id and l->>'soLineId' = it->>'id';
      v_covered := v_covered + coalesce((select sum(public._num(l->'qty')) from public.purchase_requisitions r cross join lateral jsonb_array_elements(r.lines) l
                                          where r.status = 'open' and r.so_id = so.id and l->>'soLineId' = it->>'id'), 0);
      v_need := greatest(0, v_open - v_covered);
    end if;
    if v_need > 0 then
      v_n := v_n + 1;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('line', v_n, 'soLineId', it->>'id', 'desc', it->>'desc', 'qty', v_need,
        'uom', coalesce(it->>'unit', 'PCS'), 'estUnitCostSar', public._num(it->'unitCostSar'), 'stocked', coalesce(m.is_stocked_item, false))
        || jsonb_strip_nulls(jsonb_build_object('itemId', m.id)));
    end if;
  end loop;
  if v_n = 0 then raise exception 'Nothing to requisition for %: stock, open POs and open requisitions already cover it.', so.so_number; end if;
  insert into public.purchase_requisitions (pr_number, so_id, so_number, lines, notes, requested_by)
  values (public.next_doc_number('PR'), so.id, so.so_number, v_lines, p_notes, public._actor_name())
  returning * into v_pr;
  return v_pr;
end $$;

create or replace function public.cancel_requisition(p_pr_id text) returns public.purchase_requisitions
language plpgsql security definer set search_path = public as $$
declare v_pr public.purchase_requisitions;
begin
  perform public._require_role('admin','ceo','manager','procurement');
  update public.purchase_requisitions set status = 'cancelled', updated_at = now() where id = p_pr_id and status = 'open' returning * into v_pr;
  if v_pr.id is null then raise exception 'Requisition is not open.'; end if;
  return v_pr;
end $$;

-- ---------------------------------------------------------------------
-- 7. Goods receipt document: per-line quantities, partial receipts, no over-receipt
--    p_qtys: {"<line no>": qty} (null = everything still open); p_serials: {"<line no>": ["SN", ...]}
-- ---------------------------------------------------------------------
drop function if exists public.post_goods_receipt(text, jsonb, text);
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

-- ---------------------------------------------------------------------
-- 8. Supplier bill document: 3-way match, price variance warnings, landed cost allocation
--    p: {supplierInvoiceNo, supplierInvoiceDate, dueDate?, landedCostSar?, landedAllocation: 'value'|'qty', notes,
--        lines: [{line, qty, unitCostFx}]}   (null = bill everything received and not yet billed, at PO prices)
-- ---------------------------------------------------------------------
drop function if exists public.post_supplier_bill(text);
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
    jsonb_build_object('account_code', '5010', 'debit', greatest(v_var, 0), 'credit', greatest(-v_var, 0), 'memo', 'Non-stock lines / price and landed cost differences'),
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

-- ---------------------------------------------------------------------
-- 9. Supplier payments: a PO is 'paid' only when it is fully billed and paid (0004 version; changes marked 0012)
-- ---------------------------------------------------------------------
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
  if po.status in ('pending_approval','cancelled') then raise exception 'Purchase order % is % and cannot be paid.', po.po_number, replace(po.status, '_', ' '); end if;
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
         status = public._po_status(items, status, v_paid_fx, total_amount_fx),   -- 0012: 'paid' only once fully billed
         bill_status = case when public._po_status(items, status, v_paid_fx, total_amount_fx) = 'paid' then 'paid' else bill_status end,
         updated_at = now()
   where id = po.id;
  return v_pay;
end $$;

-- ---------------------------------------------------------------------
-- 10. AP aging per bill, by due date. Payments on a PO are applied to its bills oldest first;
--     anything paid ahead of the bills is shown as a supplier advance (negative).
-- ---------------------------------------------------------------------
drop function if exists public.ap_aging(date);
create or replace function public.ap_aging(p_as_of date default null)
returns table (bill_id text, bill_number text, po_id text, po_number text, supplier_name text, supplier_invoice_no text,
               bill_date date, due_date date, days_past_due integer, bucket text, total_sar numeric, paid_sar numeric, open_sar numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_d date := coalesce(p_as_of, public._riyadh_today());
begin
  perform public._require_role('admin','ceo','finance','manager');
  return query
  with pay as (
    select sp.po_id, sum(sp.amount_fx * coalesce(nullif(sp.booked_fx_rate, 0), 1)) as paid
    from public.supplier_payments sp where sp.payment_date <= v_d group by sp.po_id
  ), b as (
    select sb.*, coalesce(sum(sb.total_sar) over (partition by sb.po_id order by sb.bill_date, sb.bill_number rows between unbounded preceding and 1 preceding), 0) as before
    from public.supplier_bills sb where sb.bill_date <= v_d
  ), alloc as (
    select b.*, public._r2(least(b.total_sar, greatest(0, coalesce(pay.paid, 0) - b.before))) as applied
    from b left join pay on pay.po_id = b.po_id
  )
  select a.id, a.bill_number, a.po_id, a.po_number, a.supplier_name, a.supplier_invoice_no, a.bill_date, coalesce(a.due_date, a.bill_date),
         (v_d - coalesce(a.due_date, a.bill_date))::int,
         case when v_d - coalesce(a.due_date, a.bill_date) <= 0 then 'current'
              when v_d - coalesce(a.due_date, a.bill_date) <= 30 then '1-30'
              when v_d - coalesce(a.due_date, a.bill_date) <= 60 then '31-60'
              when v_d - coalesce(a.due_date, a.bill_date) <= 90 then '61-90' else '90+' end,
         a.total_sar, a.applied, public._r2(a.total_sar - a.applied)
  from alloc a where a.total_sar - a.applied > 0.009
  union all
  select null, null, po.id, po.po_number, po.supplier_name, null, null, null, null, 'advance', 0::numeric, public._r2(pay.paid - coalesce(bt.t, 0)),
         -public._r2(pay.paid - coalesce(bt.t, 0))
  from pay join public.purchase_orders po on po.id = pay.po_id
  left join (select po_id, sum(total_sar) as t from public.supplier_bills where bill_date <= v_d group by po_id) bt on bt.po_id = pay.po_id
  where pay.paid - coalesce(bt.t, 0) > 0.009
  order by 9 desc nulls last, 2;
end $$;

-- ---------------------------------------------------------------------
-- 11. VAT return reads supplier bills (0010 version; change marked 0012)
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
    select coalesce(b->>'category', 'S') as cat, b->>'exemptionReason' as reason, (b->>'net')::numeric as net, (b->>'vat')::numeric as vat
    from public.invoices i cross join lateral jsonb_array_elements(public._doc_breakdown(i.vat_breakdown, i.items)) b
    where public.riyadh_date(i.issued_at) between p_from and p_to
  ), cn_lines as (
    -- adjustments: credit notes reduce, debit notes increase (0010)
    select coalesce(b->>'category', 'S') as cat, b->>'exemptionReason' as reason, -(b->>'net')::numeric as net, -(b->>'vat')::numeric as vat
    from public.credit_notes c cross join lateral jsonb_array_elements(public._doc_breakdown(c.vat_breakdown, c.items)) b
    where public.riyadh_date(c.issued_at) between p_from and p_to
    union all
    select coalesce(b->>'category', 'S'), b->>'exemptionReason', (b->>'net')::numeric, (b->>'vat')::numeric
    from public.debit_notes d cross join lateral jsonb_array_elements(d.vat_breakdown) b
    where public.riyadh_date(d.issued_at) between p_from and p_to
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
                else '5' end, 0, 0, sum(net), sum(vat) from cn_lines group by 1
  ), bills as (
    -- 0012: supplier bill documents, by bill date
    select b.*, b.goods_sar + b.landed_sar as base
    from public.supplier_bills b
    where b.bill_date between p_from and p_to
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
-- 12. RLS, guards, audit, privileges
-- ---------------------------------------------------------------------
alter table public.purchase_requisitions enable row level security;
alter table public.goods_receipts enable row level security;
alter table public.supplier_bills enable row level security;
drop policy if exists purchase_requisitions_read on public.purchase_requisitions;
create policy purchase_requisitions_read on public.purchase_requisitions for select to authenticated using (public.has_role('admin','ceo','finance','manager','procurement'));
drop policy if exists goods_receipts_read on public.goods_receipts;
create policy goods_receipts_read on public.goods_receipts for select to authenticated using (public.has_role('admin','ceo','finance','manager','procurement'));
drop policy if exists supplier_bills_read on public.supplier_bills;
create policy supplier_bills_read on public.supplier_bills for select to authenticated using (public.has_role('admin','ceo','finance','manager','procurement'));
revoke all on public.purchase_requisitions, public.goods_receipts, public.supplier_bills from anon, public;
grant select on public.purchase_requisitions, public.goods_receipts, public.supplier_bills to authenticated;
revoke insert, update, delete on public.purchase_requisitions, public.goods_receipts, public.supplier_bills from authenticated;

do $$
declare r record;
begin
  for r in select * from (values ('purchase_requisitions','id'), ('goods_receipts','id'), ('supplier_bills','id')) as t(tbl, pk) loop
    execute format('drop trigger if exists trg_audit_row on public.%I', r.tbl);
    execute format('create trigger trg_audit_row after insert or update or delete on public.%I for each row execute function public.audit_row(%L)', r.tbl, r.pk);
    execute format('drop trigger if exists trg_stamp_row_user on public.%I', r.tbl);
    execute format('create trigger trg_stamp_row_user before insert or update on public.%I for each row execute function public.stamp_row_user()', r.tbl);
  end loop;
  execute 'drop trigger if exists trg_guard_posted_row on public.goods_receipts';
  execute 'create trigger trg_guard_posted_row before insert or update or delete on public.goods_receipts for each row execute function public.guard_posted_row(''receipt_date'', ''no_change'', ''grn_number'')';
  execute 'drop trigger if exists trg_guard_posted_row on public.supplier_bills';
  execute 'create trigger trg_guard_posted_row before insert or update or delete on public.supplier_bills for each row execute function public.guard_posted_row(''bill_date'', ''no_change'', ''bill_number'')';
end $$;

do $$
declare f text;
begin
  foreach f in array array['public._po_status(jsonb, text, numeric, numeric)', 'public._po_line_unit_cost(public.purchase_orders, jsonb)',
                           'public._proc_settings()', 'public._terms_days(text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.post_purchase_order(jsonb)', 'public.approve_purchase_order(text)', 'public.reject_purchase_order(text, text)',
                           'public.close_purchase_order(text, text)', 'public.create_requisition_from_so(text, text)', 'public.cancel_requisition(text)',
                           'public.post_goods_receipt(text, jsonb, text, jsonb, text)', 'public.post_supplier_bill(text, jsonb)',
                           'public.post_supplier_payment(text, numeric, numeric, text, text, date, text, text)', 'public.ap_aging(date)',
                           'public.vat_return(date, date)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
