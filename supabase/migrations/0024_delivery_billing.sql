-- =====================================================================
-- 0024_delivery_billing.sql — sales order -> delivery -> invoice -> return, the gaps found in the flow review
-- ---------------------------------------------------------------------
-- 1. Combined invoices: post_invoice_combined(dn_ids) bills several un-invoiced delivery notes of the SAME sales
--    order on one ZATCA invoice (lines keep their delivery note). post_invoice(dn) is now that with one note.
--    Each delivery note records the invoice that billed it (delivery_notes.invoice_id; invoices.dn_ids lists all).
-- 2. Invoiced quantities: every order line keeps invoicedQty up to date (was always 0).
-- 3. Returns with a replacement: post_credit_note(..., p_replacement) reopens the returned quantity on the order
--    so the replacement can be delivered against it. Default stays "no replacement".
-- 4. reverse_delivery_note(dn, reason): undo a delivery note posted by mistake, before it is invoiced
--    (admin / CEO / manager). Stock back at the cost it left at, COGS reversed, serials back in stock, order reopened.
--    The note is kept and marked reversed.
-- 5. Credit is checked when the goods leave, not at invoice time: a delivery is refused while the customer has
--    invoices past the overdue limit, unless Finance grants a one-time 'DELIVERY' override for that order. Delivery
--    invoices are never held back (the goods are already with the customer). Other invoices are checked as before.
-- Negative stock on delivery stays allowed with a warning (owner's decision).
-- Idempotent.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- Columns and constraints
-- ---------------------------------------------------------------------
-- the row-type views are dropped while their tables change and re-created at the end (nothing depends on them)
drop view if exists public.delivery_notes_v;
drop view if exists public.invoices_v;
drop view if exists public.credit_notes_v;
alter table public.delivery_notes add column if not exists invoice_id text;
alter table public.delivery_notes add column if not exists reversed_at timestamptz;
alter table public.delivery_notes add column if not exists reversed_by text;
alter table public.delivery_notes add column if not exists reversal_reason text;
create index if not exists idx_dn_invoice_id on public.delivery_notes (invoice_id);
alter table public.invoices add column if not exists dn_ids text[] not null default '{}';
alter table public.credit_notes add column if not exists replacement boolean not null default false;

alter table public.stock_moves drop constraint if exists stock_moves_move_type_check;
alter table public.stock_moves add constraint stock_moves_move_type_check
  check (move_type = any (array['OPENING','GRN','DN','DN_REVERSAL','CN_RETURN','ADJUST','COUNT','TRANSFER']));
alter table public.credit_overrides drop constraint if exists credit_overrides_doc_type_check;
alter table public.credit_overrides add constraint credit_overrides_doc_type_check
  check (doc_type = any (array['SO','INVOICE','SO_AMEND','DELIVERY']));

-- ---------------------------------------------------------------------
-- Posting guard: an invoiced (also via a combined invoice) or reversed delivery note is frozen
-- ---------------------------------------------------------------------
create or replace function public.guard_posted_row() returns trigger
language plpgsql security definer set search_path = public as $function$
declare
  v_lock date := public.current_lock_date();
  v_col  text := tg_argv[0];
  v_rule text := tg_argv[1];
  v_old  jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new  jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old_d date;
  v_new_d date;
  v_changed text[];
  v_allowed text[] := array['updated_at','updated_by_uid','created_by_uid'];
  v_label text := initcap(replace(tg_table_name, '_', ' '));
  v_doc   text := coalesce(v_new, v_old)->>coalesce(nullif(tg_argv[2], ''), 'id');
begin
  if public.is_maintenance_session() then
    return coalesce(new, old);
  end if;

  -- period lock. On UPDATE it applies only when the document date itself changes (or to journals),
  -- so an old invoice can still be paid and an old expense voided by a reversal in an open period.
  if v_lock is not null and v_col <> ''
     and (tg_op <> 'UPDATE' or v_rule = 'gl' or v_new->v_col is distinct from v_old->v_col) then
    v_old_d := case when v_old ? v_col and v_old->>v_col is not null then public.riyadh_date((v_old->>v_col)::timestamptz) end;
    v_new_d := case when v_new ? v_col and v_new->>v_col is not null then public.riyadh_date((v_new->>v_col)::timestamptz)
                    when tg_op = 'INSERT' then (now() at time zone 'Asia/Riyadh')::date end;
    if (v_old_d is not null and v_old_d <= v_lock) or (v_new_d is not null and v_new_d <= v_lock) then
      raise exception 'The accounting period is locked up to %. % % is dated % and cannot be posted, changed or deleted. Ask Finance to change the period lock or use a later date.',
        to_char(v_lock, 'DD Mon YYYY'), v_label, coalesce(v_doc, ''), to_char(coalesce(v_new_d, v_old_d), 'DD Mon YYYY')
        using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  -- immutability
  if v_rule = 'no_change' then
    raise exception '% % is posted and cannot be %. Post a reversing document instead.', v_label, coalesce(v_doc, ''), lower(tg_op) || 'd'
      using errcode = 'P0001';
  end if;

  if v_rule = 'gl' then
    if coalesce(old.status::text, 'posted') = 'posted' then
      raise exception 'Journal % is posted and cannot be %. Post a reversing journal instead.', coalesce(v_old->>'voucher_number', v_doc), lower(tg_op) || 'd'
        using errcode = 'P0001';
    end if;
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if v_rule = 'delivery_note' and not exists (select 1 from public.invoices where dn_id = old.id) and v_old->>'invoice_id' is null and v_old->>'reversed_at' is null then
      return old;
    end if;
    raise exception '% % cannot be deleted.', v_label, coalesce(v_doc, '') using errcode = 'P0001';
  end if;

  select array_agg(k) into v_changed from jsonb_object_keys(v_new) k where v_new->k is distinct from v_old->k;
  if v_changed is null then
    return new;
  end if;

  if v_rule = 'invoice' then
    -- 0006: an issued invoice never changes; only collection / credit totals and status move
    v_allowed := v_allowed || array['paid_amount_sar','payment_status','credited_amount_sar','debited_amount_sar'];
  elsif v_rule = 'expense' then
    if not (v_changed <@ (v_allowed || array['status']) and v_old->>'status' = 'posted' and v_new->>'status' = 'void') then
      raise exception 'Expense voucher % is posted. The only allowed change is to void it (which posts a reversal).', coalesce(v_old->>'voucher_number', v_doc)
        using errcode = 'P0001';
    end if;
    return new;
  elsif v_rule = 'delivery_note' then
    if not exists (select 1 from public.invoices where dn_id = old.id) and v_old->>'invoice_id' is null and v_old->>'reversed_at' is null then
      return new;
    end if;
    v_allowed := v_allowed || array['notes','driver_name','delivery_address','dispatched_at'];
  end if;

  if not v_changed <@ v_allowed then
    raise exception '% % is posted; these fields cannot be changed: %', v_label, coalesce(v_doc, ''),
      array_to_string(array(select unnest(v_changed) except select unnest(v_allowed)), ', ')
      using errcode = 'P0001';
  end if;
  return new;
end $function$;

-- ---------------------------------------------------------------------
-- 5. Credit at delivery; delivery invoices no longer re-checked
-- ---------------------------------------------------------------------
create or replace function public.grant_credit_override(p_doc_type text, p_ref_id text, p_reason text) returns public.credit_overrides
language plpgsql security definer set search_path = public as $function$
declare o public.credit_overrides; v_client text;
begin
  perform public._require_role('admin','ceo','finance');
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for the credit override.'; end if;
  v_client := case p_doc_type when 'SO' then (select data->>'clientName' from public.inquiries where id = p_ref_id)
                              when 'INVOICE' then coalesce((select client_name from public.delivery_notes where id = p_ref_id),   -- 0014: project / contract invoices
                                                (select client_name from public.projects where id = p_ref_id),
                                                (select client_name from public.service_contracts where id = p_ref_id),
                                                (select client_name from public.service_tickets where id = p_ref_id))
                              when 'SO_AMEND' then (select client_name from public.sales_orders where id = p_ref_id)
                              when 'DELIVERY' then (select client_name from public.sales_orders where id = p_ref_id) end;   -- 0024
  if v_client is null then raise exception 'Document % not found.', p_ref_id; end if;
  insert into public.credit_overrides (doc_type, ref_id, client_name, reason, granted_by) values (p_doc_type, p_ref_id, v_client, trim(p_reason), public._actor_name())
  returning * into o;
  return o;
end $function$;

create or replace function public._invoice_before_insert() returns trigger
language plpgsql security definer set search_path = public as $function$
declare e jsonb; v_prob text[]; v_terms text; v_so_open numeric := 0;
begin
  v_terms := coalesce(nullif(new.payment_terms, ''), (select nullif(payment_terms, '') from public.sales_orders where id = new.so_id),
                      (select payment_terms from public.customers where id = new.customer_id), 'Net 30');
  new.payment_terms := v_terms;
  new.due_date := coalesce(new.due_date, public.riyadh_date(coalesce(new.issued_at, now())) + public._terms_days(v_terms));
  if public.is_maintenance_session() then return new; end if;
  -- 0024: delivery invoices are credit-checked at delivery; the goods have left, so the invoice is never held back
  if new.dn_id is not null then return new; end if;
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
end $function$;

create or replace function public.post_delivery_note(p_so_id text, p_qtys jsonb, p_notes text default '', p_serials jsonb default '{}'::jsonb, p_warehouse text default null)
returns public.delivery_notes
language plpgsql security definer set search_path = public as $function$
declare
  so public.sales_orders; v_items jsonb; v_lines jsonb; v_all boolean; v_dn public.delivery_notes;
  v_wh text := coalesce(nullif(p_warehouse, ''), public._default_warehouse()); v_id text := gen_random_uuid()::text; v_num text;
  v_l jsonb; v_o int; v_m public.items; v_r jsonb; v_out jsonb := '[]'::jsonb; v_cogs numeric := 0; v_warn text[] := '{}'; v_sw text;
  e jsonb; v_prob text[];
begin
  perform public._require_role('admin','ceo','procurement');
  select * into so from public.sales_orders where id = p_so_id for update;
  if so.id is null then raise exception 'Sales Order % not found.', p_so_id; end if;
  if so.status = 'cancelled' then raise exception 'Sales Order % is cancelled.', so.so_number; end if;   -- 0024
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

  -- 0024: credit is checked when the goods leave (not later at invoice time): no delivery while the customer
  -- has invoices past the overdue limit, unless Finance granted a one-time override for this order
  e := public._customer_exposure(so.customer_id, so.client_name, so.id);
  v_prob := public._credit_problems(e, 0, false);
  if cardinality(v_prob) > 0 and not public._use_credit_override('DELIVERY', so.id, so.so_number) then
    raise exception 'Credit check failed for %: %. Collect first, or ask Finance for a delivery credit override on %.', so.client_name,
      array_to_string(v_prob, '; '), so.so_number using errcode = 'P0001';
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
end $function$;

-- ---------------------------------------------------------------------
-- 1-2. Combined invoices, invoiced quantities
-- ---------------------------------------------------------------------
-- One ZATCA invoice for one or more un-invoiced delivery notes of the same sales order.
create or replace function public.post_invoice_combined(p_dn_ids text[]) returns public.invoices
language plpgsql security definer set search_path = public as $function$
declare
  v_ids text[]; dn public.delivery_notes; d public.delivery_notes; so public.sales_orders; c jsonb := public._company();
  v_items jsonb := '[]'::jsonb; v_sub numeric; v_cost numeric; v_cost_unposted numeric; v_vat numeric; v_grand numeric;
  v_num text; v_iso text := public._iso_now(); v_inv_id text := gen_random_uuid()::text; v_so_numbers text;
  v_inv public.invoices; v_profit numeric; v_pct numeric; v_elig numeric; v_it boolean;
  cust public.customers; v_seller jsonb; v_buyer jsonb; v_warn text[] := '{}'; v_type text; v_n int := 0;
begin
  perform public._require_role('admin','ceo','finance');
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_dn_ids, '{}')) x where coalesce(trim(x), '') <> '';
  if coalesce(cardinality(v_ids), 0) = 0 then raise exception 'Pick at least one delivery note to invoice.'; end if;
  if cardinality(v_ids) > 50 then raise exception 'At most 50 delivery notes on one invoice.'; end if;

  -- lock every delivery note, oldest first; all must be open and from the same sales order
  for d in select * from public.delivery_notes where id = any (v_ids) order by delivered_at, dn_number for update loop
    v_n := v_n + 1;
    if d.reversed_at is not null then raise exception 'Delivery note % was reversed and cannot be invoiced.', d.dn_number; end if;
    if d.invoice_id is not null or exists (select 1 from public.invoices where dn_id = d.id) then
      raise exception 'Delivery note % has already been invoiced.', d.dn_number;
    end if;
    if dn.id is null then dn := d;
    elsif d.so_id is distinct from dn.so_id then
      raise exception 'Delivery notes on one invoice must belong to the same sales order (% is on %, % is on %).',
        dn.dn_number, coalesce(dn.so_number, '?'), d.dn_number, coalesce(d.so_number, '?');
    end if;
    v_items := v_items || (select coalesce(jsonb_agg(it || jsonb_build_object('dnId', d.id, 'dnNumber', d.dn_number) order by o), '[]'::jsonb)
                             from jsonb_array_elements(coalesce(d.items, '[]'::jsonb)) with ordinality as t(it, o));
  end loop;
  if v_n <> cardinality(v_ids) then raise exception 'Delivery note not found.'; end if;

  select * into so from public.sales_orders where id = dn.so_id for update;
  -- 0014: orders of a project billed by progress claims are not invoiced per delivery
  if exists (select 1 from public.projects pr where pr.id = so.project_id and pr.billing_method <> 'delivery') then
    raise exception 'Sales Order % belongs to project % which is billed by progress claims, not per delivery.', so.so_number,
      (select project_code from public.projects where id = so.project_id);
  end if;
  perform public._project_ctx(so.project_id);

  select coalesce(sum(public._r2(public._num(it->'qty') * public._num(it->'unitSellSar'))), 0),
         coalesce(sum(public._num(it->'qty') * public._num(it->'unitCostSar')), 0)
    into v_sub, v_cost from jsonb_array_elements(v_items) it;
  -- lines from deliveries made before 0011 still relieve stock at invoice time
  select coalesce(sum(public._num(it->'qty') * public._num(it->'unitCostSar')), 0) into v_cost_unposted
    from public.delivery_notes x, jsonb_array_elements(coalesce(x.items, '[]'::jsonb)) it
   where x.id = any (v_ids) and not x.inventory_posted;
  v_vat := public._breakdown_vat(public._vat_breakdown(v_items));   -- 0010: ZATCA rounding
  v_grand := v_sub + v_vat;
  v_type := case when coalesce(so.client_vat, '') <> '' then 'standard' else 'simplified' end;

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

  -- link the delivery notes first (they are still open, so the posting guard allows it); rolled back if the invoice fails
  update public.delivery_notes set invoice_id = v_inv_id, updated_at = now() where id = any (v_ids);

  insert into public.invoices (id, invoice_number, division, invoice_type, so_id, so_number, dn_id, dn_ids, client_name, client_vat,
                               salesman_id, salesman_name, commission_pct, items, subtotal_sar, vat_sar, grand_total_sar,
                               landed_cost_sar, paid_amount_sar, payment_status, zatca_status, qr_base64, locked, issued_at,
                               customer_id, vat_breakdown, seller_address, buyer_address, zatca_warnings, project_id)
  values (v_inv_id, v_num, coalesce(dn.division, 'MEP'), v_type,
          dn.so_id, dn.so_number, dn.id, (select array_agg(id order by delivered_at, dn_number) from public.delivery_notes where id = any (v_ids)),
          dn.client_name, coalesce(so.client_vat, ''),
          so.salesman_id, coalesce(so.salesman_name, 'Unassigned'), coalesce(so.commission_pct, 0), v_items,
          public._r2(v_sub), public._r2(v_vat), public._r2(v_grand), public._r2(v_cost), 0, 'unpaid',
          'phase1_qr_ready',
          public._zatca_qr(c->>'nameEn', c->>'vatNumber', v_iso, v_grand, v_vat), true, v_iso::timestamptz,
          coalesce(so.customer_id, cust.id), public._vat_breakdown(v_items), v_seller, v_buyer, v_warn, so.project_id)
  returning * into v_inv;

  perform public._gl_post(public.riyadh_date(v_inv.issued_at), 'INVOICE', v_num,
    format('ZATCA Invoice %s - %s (%s)', v_num, dn.client_name, coalesce(dn.so_number, '')),
    jsonb_build_array(
      jsonb_build_object('account_code', '1100', 'debit', v_grand, 'memo', dn.client_name),
      jsonb_build_object('account_code', case when v_it then '4020' else '4010' end, 'credit', v_sub, 'memo', v_num),
      jsonb_build_object('account_code', '2100', 'credit', v_vat, 'memo', 'Output VAT'),
      -- 0011: COGS is posted by the delivery note; only deliveries from before 0011 still relieve stock here
      jsonb_build_object('account_code', '5010', 'debit', v_cost_unposted, 'memo', 'COGS ' || v_num),
      jsonb_build_object('account_code', '1200', 'credit', v_cost_unposted, 'memo', 'Stock relief ' || coalesce(dn.dn_number, ''))));

  -- 0024: the order shows how much of each line has been invoiced
  update public.sales_orders s
     set items = coalesce((select jsonb_agg(l || jsonb_build_object('invoicedQty', public._num(l->'invoicedQty')
                                     + coalesce((select sum(public._num(it->'qty')) from jsonb_array_elements(v_items) it where it->>'id' = l->>'id'), 0)) order by o)
                    from jsonb_array_elements(s.items) with ordinality as t(l, o)), s.items),
         updated_at = now()
   where s.id = so.id;

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
end $function$;

-- the single-delivery entry point the app already uses
create or replace function public.post_invoice(p_dn_id text) returns public.invoices
language sql security definer set search_path = public as $function$
  select * from public.post_invoice_combined(array[p_dn_id])
$function$;

-- ---------------------------------------------------------------------
-- 3. Returns with a replacement (the old 4-argument version is replaced)
-- ---------------------------------------------------------------------
drop function if exists public.post_credit_note(text, jsonb, text, text);
create or replace function public.post_credit_note(p_invoice_id text, p_return_qtys jsonb, p_reason text, p_reason_code text default 'RETURN',
                                         p_replacement boolean default false)
returns public.credit_notes
language plpgsql security definer set search_path = public as $function$
declare
  inv public.invoices; c jsonb := public._company(); v_done numeric[]; v_lines jsonb; v_sub numeric; v_cost numeric; v_vat numeric; v_grand numeric;
  v_num text; v_iso text := public._iso_now(); v_cn public.credit_notes; v_open numeric; v_to_ar numeric; v_excess numeric;
  comm public.commission_ledger; v_np numeric; v_elig numeric; v_over text;
  v_ret numeric := 0; l jsonb; m public.items; r jsonb;
  so public.sales_orders; v_back jsonb;
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
                                   applied_to_ar_sar, to_customer_credit_sar, qr_base64, issued_by, issued_at, vat_breakdown, replacement)
  values (v_num, inv.id, inv.invoice_number, inv.issued_at, inv.client_name, coalesce(inv.client_vat, ''),
          p_reason, p_reason_code, v_lines, public._r2(v_sub), public._r2(v_vat), v_grand, public._r2(v_cost),
          v_to_ar, v_excess, public._zatca_qr(c->>'nameEn', c->>'vatNumber', v_iso, v_grand, v_vat), public._actor_name(), v_iso::timestamptz,
          public._vat_breakdown(v_lines), coalesce(p_replacement, false))
  returning * into v_cn;

  -- 0024: "replacement to follow" reopens the returned quantity on the sales order so it can be delivered again
  if coalesce(p_replacement, false) then
    if inv.dn_id is null or inv.so_id is null then
      raise exception 'A replacement can only follow a return on an invoice made from a delivery.';
    end if;
    select * into so from public.sales_orders where id = inv.so_id for update;
    if so.id is null then raise exception 'Sales order of invoice % not found.', inv.invoice_number; end if;
    if so.status = 'cancelled' or so.cancelled_reason is not null then
      raise exception 'Sales order % was cancelled: raise a new sales order for the replacement.', so.so_number;
    end if;
    if exists (select 1 from jsonb_array_elements(coalesce(inv.items, '[]'::jsonb)) with ordinality as t(it, o)
                where public._num(p_return_qtys->((o - 1)::int)) > 0 and coalesce(it->>'id', '') = '') then
      raise exception 'Invoice % has lines that are not linked to sales-order lines; raise a new sales order for the replacement.', inv.invoice_number;
    end if;
    -- returned quantity per order line (invoice lines carry the order line id)
    select coalesce(jsonb_object_agg(k, q), '{}'::jsonb) into v_back from (
      select it->>'id' k, sum(public._num(p_return_qtys->((o - 1)::int))) q
        from jsonb_array_elements(coalesce(inv.items, '[]'::jsonb)) with ordinality as t(it, o)
       where public._num(p_return_qtys->((o - 1)::int)) > 0 group by 1) z;
    update public.sales_orders s
       set items = (select jsonb_agg(x.ln || jsonb_build_object(
                                 'deliveredQty', greatest(0, public._num(x.ln->'deliveredQty') - public._num(v_back->(x.ln->>'id'))),
                                 'invoicedQty', greatest(0, public._num(x.ln->'invoicedQty') - public._num(v_back->(x.ln->>'id')))) order by x.o)
                      from jsonb_array_elements(s.items) with ordinality as x(ln, o)),
           updated_at = now()
     where s.id = so.id returning * into so;
    update public.sales_orders s
       set status = case when not exists (select 1 from jsonb_array_elements(s.items) ln where public._num(ln->'deliveredQty') < public._num(ln->'orderedQty')) then 'delivered'
                         when exists (select 1 from jsonb_array_elements(s.items) ln where public._num(ln->'deliveredQty') > 0) then 'partially_delivered' else 'open' end
     where s.id = so.id;
  end if;

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
end $function$;

-- ---------------------------------------------------------------------
-- 4. Reverse a delivery note
-- ---------------------------------------------------------------------
-- Undo a delivery note posted by mistake, as long as it has not been invoiced.
-- Stock goes back at the cost it left at, COGS is reversed, serials return to stock, the order quantity reopens.
-- The delivery note is kept (marked reversed) so the audit trail and its number stay intact.
create or replace function public.reverse_delivery_note(p_dn_id text, p_reason text) returns public.delivery_notes
language plpgsql security definer set search_path = public as $function$
declare
  dn public.delivery_notes; so public.sales_orders; l jsonb; r jsonb; v_ret numeric := 0; v_back jsonb; v_items jsonb; t jsonb;
  v_cancelled boolean; v_any boolean;
begin
  perform public._require_role('admin','ceo','manager');
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for reversing the delivery note.'; end if;
  select * into dn from public.delivery_notes where id = p_dn_id for update;
  if dn.id is null then raise exception 'Delivery note % not found.', p_dn_id; end if;
  if dn.reversed_at is not null then raise exception 'Delivery note % is already reversed.', dn.dn_number; end if;
  if dn.invoice_id is not null or exists (select 1 from public.invoices where dn_id = dn.id or dn.id = any (dn_ids)) then
    raise exception 'Delivery note % has been invoiced: issue a credit note for the return instead.', dn.dn_number;
  end if;
  select * into so from public.sales_orders where id = dn.so_id for update;
  if so.id is null then raise exception 'Sales order of delivery note % not found.', dn.dn_number; end if;
  perform public._project_ctx(so.project_id);

  for l in select x from jsonb_array_elements(coalesce(dn.items, '[]'::jsonb)) x loop
    if coalesce((l->>'stockIssued')::boolean, false) and coalesce(l->>'itemId', '') <> '' and public._num(l->'qty') > 0 then
      r := public._stock_move(l->>'itemId', coalesce(nullif(l->>'warehouse', ''), dn.warehouse, public._default_warehouse()), public._num(l->'qty'),
                              public._num(l->'unitCostSar'), 'DN_REVERSAL', 'DN', dn.id, dn.dn_number, public._riyadh_today(), l->>'id',
                              'Reversal: ' || trim(p_reason));
      v_ret := v_ret + (r->>'value')::numeric - (r->>'correction')::numeric;
      update public.item_serials set status = 'in_stock', dn_id = null, dn_number = null, delivered_at = null, updated_at = now()
       where item_id = l->>'itemId' and dn_id = dn.id and status = 'delivered';
    end if;
  end loop;

  if v_ret <> 0 then
    perform public._gl_post(public._riyadh_today(), 'DELIVERY_NOTE', dn.dn_number || '-REV',
      format('Reversal of delivery %s (%s, %s): %s', dn.dn_number, dn.client_name, coalesce(dn.so_number, ''), trim(p_reason)),
      jsonb_build_array(
        jsonb_build_object('account_code', '1200', 'debit', greatest(v_ret, 0), 'credit', greatest(-v_ret, 0), 'memo', 'Stock back from ' || dn.dn_number),
        jsonb_build_object('account_code', '5010', 'debit', greatest(-v_ret, 0), 'credit', greatest(v_ret, 0), 'memo', 'COGS reversal ' || dn.dn_number)));
  end if;

  -- reopen the delivered quantity on the order; on a cancelled order the reversed quantity is cancelled too
  select coalesce(jsonb_object_agg(k, q), '{}'::jsonb) into v_back
    from (select x->>'id' k, sum(public._num(x->'qty')) q from jsonb_array_elements(coalesce(dn.items, '[]'::jsonb)) x
           where coalesce(x->>'id', '') <> '' group by 1) z;
  v_cancelled := so.cancelled_reason is not null;
  select jsonb_agg(case when v_back ? (x.l->>'id') then
                     x.l || jsonb_build_object('deliveredQty', greatest(0, public._num(x.l->'deliveredQty') - public._num(v_back->(x.l->>'id'))))
                         || case when v_cancelled then jsonb_build_object(
                                   'orderedQty', greatest(0, public._num(x.l->'orderedQty') - public._num(v_back->(x.l->>'id'))),
                                   'cancelledQty', public._num(x.l->'cancelledQty') + public._num(v_back->(x.l->>'id'))) else '{}'::jsonb end
                   else x.l end order by x.o)
    into v_items from jsonb_array_elements(so.items) with ordinality as x(l, o);
  v_items := coalesce(v_items, so.items);
  v_any := exists (select 1 from jsonb_array_elements(v_items) x where public._num(x->'deliveredQty') > 0);
  if v_cancelled then
    t := public._so_totals(v_items);
    update public.sales_orders
       set items = v_items, subtotal_sar = public._r2(public._num(t->'sub')), vat_sar = public._r2(public._num(t->'vat')),
           grand_total_sar = public._r2(public._num(t->'sub') + public._num(t->'vat')), total_cost_sar = public._r2(public._num(t->'cost')),
           status = case when v_any then 'delivered' else 'cancelled' end, updated_at = now()
     where id = so.id;
  else
    update public.sales_orders
       set items = v_items, updated_at = now(),
           status = case when not exists (select 1 from jsonb_array_elements(v_items) x where public._num(x->'deliveredQty') < public._num(x->'orderedQty')) then 'delivered'
                         when v_any then 'partially_delivered' else 'open' end
     where id = so.id;
  end if;

  update public.delivery_notes
     set reversed_at = now(), reversed_by = public._actor_name(), reversal_reason = trim(p_reason), updated_at = now()
   where id = dn.id returning * into dn;
  return dn;
end $function$;

-- ---------------------------------------------------------------------
-- Backfill (runs as the migration owner, so the posting guard lets it through)
-- ---------------------------------------------------------------------
update public.delivery_notes d set invoice_id = i.id
  from public.invoices i where i.dn_id = d.id and d.invoice_id is null;
update public.invoices set dn_ids = array[dn_id] where dn_id is not null and cardinality(dn_ids) = 0;
-- invoicedQty from the invoices already issued, less returns that reopened a line (none before this migration)
update public.sales_orders s
   set items = (select jsonb_agg(l || jsonb_build_object('invoicedQty',
                  coalesce((select sum(public._num(it->'qty')) from public.invoices i, jsonb_array_elements(coalesce(i.items, '[]'::jsonb)) it
                             where i.so_id = s.id and i.dn_id is not null and it->>'id' = l->>'id'), 0)) order by o)
                  from jsonb_array_elements(s.items) with ordinality as t(l, o))
 where jsonb_typeof(s.items) = 'array' and jsonb_array_length(s.items) > 0;

-- ---------------------------------------------------------------------
-- Views pick up the new columns (their column lists are fixed when created)
-- ---------------------------------------------------------------------
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

do $$
declare v text;
begin
  foreach v in array array['delivery_notes_v', 'invoices_v', 'credit_notes_v'] loop
    execute format('revoke all on public.%I from anon, public', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Privileges: callable by signed-in users only (each function checks the role itself)
-- ---------------------------------------------------------------------
revoke all on function public.post_invoice_combined(text[]) from public, anon;
grant execute on function public.post_invoice_combined(text[]) to authenticated;
revoke all on function public.post_invoice(text) from public, anon;
grant execute on function public.post_invoice(text) to authenticated;
revoke all on function public.post_credit_note(text, jsonb, text, text, boolean) from public, anon;
grant execute on function public.post_credit_note(text, jsonb, text, text, boolean) to authenticated;
revoke all on function public.reverse_delivery_note(text, text) from public, anon;
grant execute on function public.reverse_delivery_note(text, text) to authenticated;
revoke all on function public.post_delivery_note(text, jsonb, text, jsonb, text) from public, anon;
grant execute on function public.post_delivery_note(text, jsonb, text, jsonb, text) to authenticated;
revoke all on function public.grant_credit_override(text, text, text) from public, anon;
grant execute on function public.grant_credit_override(text, text, text) to authenticated;
revoke all on function public.guard_posted_row() from public, anon, authenticated;
revoke all on function public._invoice_before_insert() from public, anon, authenticated;

commit;
