-- =====================================================================
-- 0010_zatca_phase2.sql — ZATCA Phase 2 e-invoicing, debit notes, line-level VAT rounding
-- Gaps: Z1, Z2, Z3, Z4, Z8, Z9 (see the Gap Analysis doc)
--
-- 1. Rounding the way ZATCA validates it: line net = round(qty x price, 2); VAT per category =
--    round(sum of line nets x rate, 2). post_invoice / post_credit_note now compute totals like this, so the
--    signed XML, the invoice row and the GL always agree to the cent.
-- 2. Debit notes (post_debit_note) for price increases after invoicing: Dr 1100 / Cr 4010|4020 / Cr 2100.
--    They raise the invoice's receivable: open balance = grand + debited - paid - credited.
-- 3. EGS unit (zatca_egs): keys and CSIDs, stored encrypted by the `zatca` Edge Function. No grants to
--    anon / authenticated at all; only the service role (the Edge Function) reads it. zatca_egs_status is the
--    safe view for the onboarding screen.
-- 4. Hash chain: zatca_begin / zatca_commit / zatca_record_result / zatca_release, service role only.
--    ICV and PIH are taken under a lease on the active EGS row, so two documents can never share a link.
-- 5. Documents issued while an EGS is active start as zatca_status 'pending' (B2B: must be cleared before it is
--    printed or shared; B2C: reported within 24 h by the queue). The fake 'cleared' status is removed.
-- 6. vat_return reads each document's stored VAT breakdown (and debit notes) so it matches the GL exactly.
--
-- Run after 0009. Re-runnable.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------
alter table public.invoices     add column if not exists debited_amount_sar numeric(18,2) not null default 0;
alter table public.credit_notes add column if not exists zatca_status text;
do $$
declare t text;
begin
  foreach t in array array['invoices','credit_notes'] loop
    execute format('alter table public.%I add column if not exists zatca_uuid uuid', t);
    execute format('alter table public.%I add column if not exists zatca_icv bigint', t);
    execute format('alter table public.%I add column if not exists zatca_hash text', t);
    execute format('alter table public.%I add column if not exists zatca_qr text', t);
    execute format('alter table public.%I add column if not exists zatca_cleared_at timestamptz', t);
    execute format('alter table public.%I add column if not exists zatca_submission_id bigint', t);
    execute format('alter table public.%I add column if not exists zatca_messages jsonb not null default ''[]''::jsonb', t);
  end loop;
end $$;

create table if not exists public.debit_notes (
  id                       text primary key default gen_random_uuid()::text,
  debit_note_number        text unique,
  original_invoice_id      text not null references public.invoices(id),
  original_invoice_number  text,
  original_invoice_date    timestamptz,
  client_name              text,
  client_vat               text,
  customer_id              text,
  division                 text,
  reason                   text not null,
  items                    jsonb not null default '[]'::jsonb,
  subtotal_sar             numeric(18,2) not null default 0,
  vat_sar                  numeric(18,2) not null default 0,
  grand_total_sar          numeric(18,2) not null default 0,
  vat_breakdown            jsonb not null default '[]'::jsonb,
  qr_base64                text,
  issued_by                text,
  issued_at                timestamptz not null default now(),
  zatca_status             text,
  zatca_uuid               uuid,
  zatca_icv                bigint,
  zatca_hash               text,
  zatca_qr                 text,
  zatca_cleared_at         timestamptz,
  zatca_submission_id      bigint,
  zatca_messages           jsonb not null default '[]'::jsonb,
  created_at               timestamptz not null default now(),
  created_by_uid           uuid,
  updated_by_uid           uuid
);
create index if not exists debit_notes_invoice_idx on public.debit_notes (original_invoice_id);

insert into public.document_number_ranges (doc_type, label, prefix, include_year, padding, next_number, reset_annually)
values ('DEBIT_NOTE', 'ZATCA Debit Note', 'DBN', true, 5, 1, false)
on conflict (doc_type) do nothing;

-- ---------------------------------------------------------------------
-- 2. ZATCA rounding
-- ---------------------------------------------------------------------
-- [{category, rate, exemptionReason, net, vat}]: net = sum of rounded line nets, vat = round(net x rate)
create or replace function public._vat_breakdown(p_lines jsonb, p_qty_key text default 'qty') returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('category', cat, 'rate', rate, 'exemptionReason', reason,
                                               'net', net, 'vat', public._r2(net * rate)) order by cat, reason), '[]'::jsonb)
  from (
    select coalesce(l->>'vatCategory', 'S') as cat, public._line_rate(l) as rate,
           case when coalesce(l->>'vatCategory', 'S') = 'S' then null else nullif(l->>'exemptionReason', '') end as reason,
           sum(public._r2(public._num(l->p_qty_key) * public._num(l->'unitSellSar'))) as net
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l
    where public._num(l->p_qty_key) <> 0
    group by 1, 2, 3
  ) g
$$;

create or replace function public._breakdown_vat(p_breakdown jsonb) returns numeric
language sql immutable as $$
  select coalesce(sum((b->>'vat')::numeric), 0) from jsonb_array_elements(coalesce(p_breakdown, '[]'::jsonb)) b
$$;

-- a document's stored breakdown, or one computed from its lines (documents from before 0009)
create or replace function public._doc_breakdown(p_breakdown jsonb, p_items jsonb) returns jsonb
language sql stable as $$
  select case when jsonb_array_length(coalesce(p_breakdown, '[]'::jsonb)) > 0 then p_breakdown else public._vat_breakdown(p_items) end
$$;

-- ---------------------------------------------------------------------
-- 3. Invoice and credit note posting with ZATCA rounding (0009 versions; changes marked 0010)
--    Credit notes may credit up to grand + debited - credited.
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

-- ---------------------------------------------------------------------
-- 4. Open balance = grand + debited - paid - credited (0006 / 0007 / 0008 versions; only that formula changes)
-- ---------------------------------------------------------------------
create or replace view public.invoice_balances with (security_barrier = true) as
select i.id as invoice_id, i.invoice_number, i.client_name, i.salesman_id, i.division, i.issued_at,
       i.grand_total_sar, i.paid_amount_sar, i.credited_amount_sar,
       public._r2(i.grand_total_sar + coalesce(i.debited_amount_sar, 0) - coalesce(i.paid_amount_sar, 0) - coalesce(i.credited_amount_sar, 0)) as open_balance_sar,
       i.payment_status
from public.invoices i
where public.has_role('admin','ceo','finance','manager') or (public.is_sales() and i.salesman_id = public.uid_text());


create or replace function public._invoice_sync(p_invoice_id text) returns void
language plpgsql security definer set search_path = public as $$
declare inv public.invoices; v_net numeric; v_ratio numeric; v_status text;
begin
  select * into inv from public.invoices where id = p_invoice_id;
  v_net := inv.grand_total_sar + coalesce(inv.debited_amount_sar, 0) - coalesce(inv.credited_amount_sar, 0);
  v_status := case when inv.grand_total_sar + inv.debited_amount_sar - inv.paid_amount_sar - inv.credited_amount_sar <= 0.01 then 'paid'
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

create or replace function public.post_receipt(p_client_name text, p_amount numeric, p_method text, p_reference text default '',
                                               p_date date default null, p_allocations jsonb default '[]'::jsonb)
returns public.customer_receipts
language plpgsql security definer set search_path = public as $$
declare
  v_date date := coalesce(p_date, public._riyadh_today()); v_amt numeric := public._r2(p_amount);
  v_alloc_total numeric := 0; v_unapplied numeric; v_num text; v_rcp public.customer_receipts;
  v_cash text := case when p_method = 'Cash' then '1010' else '1020' end;
  a jsonb; inv public.invoices; v_open numeric; v_lines jsonb; v_ids text[] := '{}'; v_nums text[] := '{}';
begin
  perform public._require_role('admin','ceo','finance');
  if v_amt <= 0 then raise exception 'Receipt amount must be greater than zero.'; end if;
  if coalesce(trim(p_client_name), '') = '' then raise exception 'Customer is required.'; end if;

  -- validate allocations (lock the invoices)
  for a in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    if public._r2(public._num(a->'amount')) <= 0 then continue; end if;
    select * into inv from public.invoices where id = a->>'invoice_id' for update;
    if inv.id is null then raise exception 'Invoice % not found.', a->>'invoice_id'; end if;
    if public._norm_party(inv.client_name) <> public._norm_party(p_client_name) then
      raise exception 'Invoice % belongs to %, not %.', inv.invoice_number, inv.client_name, p_client_name;
    end if;
    v_open := public._r2(inv.grand_total_sar + inv.debited_amount_sar - inv.paid_amount_sar - inv.credited_amount_sar);
    if public._r2(public._num(a->'amount')) > v_open + 0.001 then
      raise exception 'SAR % is more than the open balance of invoice % (SAR %).', public._r2(public._num(a->'amount')), inv.invoice_number, v_open;
    end if;
    if inv.id = any(v_ids) then raise exception 'Invoice % is listed twice.', inv.invoice_number; end if;
    v_ids := v_ids || inv.id; v_nums := v_nums || inv.invoice_number;
    v_alloc_total := v_alloc_total + public._r2(public._num(a->'amount'));
  end loop;
  if v_alloc_total > v_amt + 0.001 then
    raise exception 'Allocations (SAR %) are more than the amount received (SAR %).', v_alloc_total, v_amt;
  end if;
  v_unapplied := public._r2(v_amt - v_alloc_total);

  v_num := public.next_doc_number('RECEIPT');
  insert into public.customer_receipts (receipt_number, invoice_id, invoice_number, client_name, amount_sar, unapplied_sar,
                                        payment_method, reference_no, recorded_by, received_at)
  values (v_num, case when cardinality(v_ids) = 1 then v_ids[1] end, array_to_string(v_nums, ', '), trim(p_client_name), v_amt, v_unapplied,
          p_method, coalesce(p_reference, ''), public._actor_name(),
          case when p_date is null then now() else (p_date + time '12:00') at time zone 'Asia/Riyadh' end)
  returning * into v_rcp;

  v_lines := jsonb_build_array(jsonb_build_object('account_code', v_cash, 'debit', v_amt,
                                                  'memo', trim(coalesce(p_method, '') || ' ' || coalesce(p_reference, ''))));
  if v_alloc_total > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '1100', 'credit', v_alloc_total,
                                                               'memo', trim(p_client_name) || ' ' || array_to_string(v_nums, ', ')));
  end if;
  if v_unapplied > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '2050', 'credit', v_unapplied, 'memo', 'On account - ' || trim(p_client_name)));
  end if;
  perform public._gl_post(v_date, 'RECEIPT', v_num,
    format('Customer Receipt %s - %s%s', v_num, trim(p_client_name),
           case when cardinality(v_nums) > 0 then ' vs ' || array_to_string(v_nums, ', ') else ' (on account)' end),
    v_lines);

  for a in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    if public._r2(public._num(a->'amount')) <= 0 then continue; end if;
    insert into public.receipt_allocations (receipt_id, invoice_id, amount_sar, source, source_doc, entry_date)
    values (v_rcp.id, a->>'invoice_id', public._r2(public._num(a->'amount')), 'receipt', v_num, v_date);
    update public.invoices set paid_amount_sar = public._r2(paid_amount_sar + public._num(a->'amount')) where id = a->>'invoice_id';
    perform public._invoice_sync(a->>'invoice_id');
  end loop;

  if v_unapplied > 0 then
    insert into public.customer_credit_ledger (client_name, kind, amount_sar, source_doc, entry_date, notes)
    values (trim(p_client_name), 'receipt_unapplied', v_unapplied, v_num, v_date, 'Received on account');
  end if;
  return v_rcp;
end $$;

create or replace function public.post_customer_receipt(p_invoice_id text, p_amount numeric, p_method text,
                                                        p_reference text default '', p_date date default null)
returns public.customer_receipts
language plpgsql security definer set search_path = public as $$
declare inv public.invoices; v_open numeric; v_apply numeric;
begin
  perform public._require_role('admin','ceo','finance');
  select * into inv from public.invoices where id = p_invoice_id;
  if inv.id is null then raise exception 'Invoice % not found.', p_invoice_id; end if;
  v_open := public._r2(inv.grand_total_sar + inv.debited_amount_sar - inv.paid_amount_sar - inv.credited_amount_sar);
  if v_open <= 0 then raise exception 'Invoice % is already fully collected.', inv.invoice_number; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Receipt amount must be greater than zero.'; end if;
  v_apply := least(public._r2(p_amount), v_open);
  return public.post_receipt(inv.client_name, v_apply, p_method, p_reference, p_date,
                             jsonb_build_array(jsonb_build_object('invoice_id', inv.id, 'amount', v_apply)));
end $$;

create or replace function public.apply_customer_credit(p_invoice_id text, p_amount numeric, p_date date default null) returns public.invoices
language plpgsql security definer set search_path = public as $$
declare inv public.invoices; v_amt numeric := public._r2(p_amount); v_open numeric; v_credit numeric; v_date date := coalesce(p_date, public._riyadh_today());
        v_doc text;
begin
  perform public._require_role('admin','ceo','finance');
  select * into inv from public.invoices where id = p_invoice_id for update;
  if inv.id is null then raise exception 'Invoice % not found.', p_invoice_id; end if;
  perform pg_advisory_xact_lock(hashtext('ccl:' || public._norm_party(inv.client_name)));
  v_open := public._r2(inv.grand_total_sar + inv.debited_amount_sar - inv.paid_amount_sar - inv.credited_amount_sar);
  v_credit := public._customer_credit(inv.client_name);
  if v_amt <= 0 then raise exception 'Amount must be greater than zero.'; end if;
  if v_amt > v_open + 0.001 then raise exception 'SAR % is more than the open balance of % (SAR %).', v_amt, inv.invoice_number, v_open; end if;
  if v_amt > v_credit + 0.001 then raise exception '% has only SAR % of credit available.', inv.client_name, public._r2(v_credit); end if;

  v_doc := 'CR-APPLY ' || inv.invoice_number;
  perform public._gl_post(v_date, 'CUSTOMER_CREDIT_APPLY', inv.invoice_number,
    format('Customer credit applied to %s - %s', inv.invoice_number, inv.client_name),
    jsonb_build_array(
      jsonb_build_object('account_code', '2050', 'debit', v_amt, 'memo', 'Credit used - ' || inv.client_name),
      jsonb_build_object('account_code', '1100', 'credit', v_amt, 'memo', inv.invoice_number)));
  insert into public.customer_credit_ledger (client_name, kind, amount_sar, source_doc, invoice_id, entry_date, notes)
  values (inv.client_name, 'applied_to_invoice', -v_amt, inv.invoice_number, inv.id, v_date, 'Applied to invoice');
  insert into public.receipt_allocations (receipt_id, invoice_id, amount_sar, source, source_doc, entry_date)
  values (null, inv.id, v_amt, 'customer_credit', v_doc, v_date);
  update public.invoices set paid_amount_sar = public._r2(paid_amount_sar + v_amt) where id = inv.id;
  perform public._invoice_sync(inv.id);
  select * into inv from public.invoices where id = p_invoice_id;
  return inv;
end $$;

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
         i.grand_total_sar, public._r2(i.paid_amount_sar + coalesce(i.credited_amount_sar, 0) - i.debited_amount_sar),
         public._r2(i.grand_total_sar + i.debited_amount_sar - i.paid_amount_sar - coalesce(i.credited_amount_sar, 0))
  from public.invoices i
  where public.riyadh_date(i.issued_at) <= coalesce(p_as_of, public._riyadh_today())
    and i.grand_total_sar + i.debited_amount_sar - i.paid_amount_sar - coalesce(i.credited_amount_sar, 0) > 0.009
  order by d desc, i.invoice_number;
end $$;

-- ---------------------------------------------------------------------
-- 5. Posted-document guard: an invoice's debited total may move (0006 version + debited_amount_sar).
--    ZATCA fields are written only by the service role (the zatca Edge Function), which the guard lets through
--    as a maintenance session (and the audit log records).
-- ---------------------------------------------------------------------
create or replace function public.guard_posted_row() returns trigger
language plpgsql security definer set search_path = public as $$
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
    if v_rule = 'delivery_note' and not exists (select 1 from public.invoices where dn_id = old.id) then
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
    if not exists (select 1 from public.invoices where dn_id = old.id) then
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
end $$;

-- ---------------------------------------------------------------------
-- 6. Debit notes
--    p_lines: [{desc, qty, unitSellSar, unit?, itemId?, vatCategory?, exemptionReason?}] — the extra amount charged
-- ---------------------------------------------------------------------
create or replace function public.post_debit_note(p_invoice_id text, p_lines jsonb, p_reason text) returns public.debit_notes
language plpgsql security definer set search_path = public as $$
declare
  inv public.invoices; c jsonb := public._company(); v_lines jsonb; v_bd jsonb; v_sub numeric; v_vat numeric; v_grand numeric;
  v_num text; v_iso text := public._iso_now(); v_dbn public.debit_notes; v_bad text;
begin
  perform public._require_role('admin','ceo','finance');
  if coalesce(trim(p_reason), '') = '' then raise exception 'A debit note needs a reason (ZATCA KSA-10).'; end if;
  select * into inv from public.invoices where id = p_invoice_id for update;
  if inv.id is null then raise exception 'Invoice % not found.', p_invoice_id; end if;

  select coalesce(jsonb_agg(jsonb_build_object('desc', coalesce(nullif(trim(l->>'desc'), ''), 'Price adjustment'),
                                               'qty', public._num(l->'qty'), 'unit', coalesce(nullif(l->>'unit', ''), 'PCS'),
                                               'unitSellSar', public._num(l->'unitSellSar'))
                             || public._line_vat_fields(l) || jsonb_strip_nulls(jsonb_build_object('itemId', l->'itemId')) order by o), '[]'::jsonb)
    into v_lines
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality as x(l, o)
  where public._num(l->'qty') <> 0 or public._num(l->'unitSellSar') <> 0;
  if jsonb_array_length(v_lines) = 0 then raise exception 'Enter at least one debit note line.'; end if;
  select string_agg(format('line %s', o), ', ') into v_bad
  from jsonb_array_elements(v_lines) with ordinality as x(l, o)
  where public._num(l->'qty') <= 0 or public._num(l->'unitSellSar') <= 0
     or (l->>'vatCategory' <> 'S' and coalesce(l->>'exemptionReason', '') = '');
  if v_bad is not null then
    raise exception 'Debit note lines need a positive quantity and price, and a ZATCA exemption reason when not standard rated (%).', v_bad;
  end if;

  v_bd := public._vat_breakdown(v_lines);
  select coalesce(sum(public._r2(public._num(l->'qty') * public._num(l->'unitSellSar'))), 0) into v_sub from jsonb_array_elements(v_lines) l;
  v_vat := public._breakdown_vat(v_bd);
  v_grand := public._r2(v_sub + v_vat);
  v_num := public.next_doc_number('DEBIT_NOTE');

  insert into public.debit_notes (debit_note_number, original_invoice_id, original_invoice_number, original_invoice_date, client_name, client_vat,
                                  customer_id, division, reason, items, subtotal_sar, vat_sar, grand_total_sar, vat_breakdown, qr_base64,
                                  issued_by, issued_at)
  values (v_num, inv.id, inv.invoice_number, inv.issued_at, inv.client_name, coalesce(inv.client_vat, ''), inv.customer_id, inv.division,
          trim(p_reason), v_lines, public._r2(v_sub), public._r2(v_vat), v_grand, v_bd,
          public._zatca_qr(c->>'nameEn', c->>'vatNumber', v_iso, v_grand, v_vat), public._actor_name(), v_iso::timestamptz)
  returning * into v_dbn;

  perform public._gl_post(public.riyadh_date(v_dbn.issued_at), 'DEBIT_NOTE', v_num,
    format('ZATCA Debit Note %s vs %s (%s)', v_num, inv.invoice_number, inv.client_name),
    jsonb_build_array(
      jsonb_build_object('account_code', '1100', 'debit', v_grand, 'memo', inv.client_name),
      jsonb_build_object('account_code', case when coalesce(inv.division, 'MEP') = 'IT & ELV' then '4020' else '4010' end, 'credit', public._r2(v_sub), 'memo', trim(p_reason)),
      jsonb_build_object('account_code', '2100', 'credit', public._r2(v_vat), 'memo', 'Output VAT')));

  update public.invoices set debited_amount_sar = public._r2(debited_amount_sar + v_grand) where id = inv.id;
  perform public._invoice_sync(inv.id);
  return v_dbn;
end $$;

create or replace view public.debit_notes_v with (security_barrier = true) as
select t.* from public.debit_notes t
where public.has_role('admin','ceo','finance','manager') or (public.is_sales() and public.invoice_owned(t.original_invoice_id));

alter table public.debit_notes enable row level security;
drop policy if exists debit_notes_read on public.debit_notes;
create policy debit_notes_read on public.debit_notes for select to authenticated
  using (public.has_role('admin','ceo','finance','manager') or (public.is_sales() and public.invoice_owned(original_invoice_id)));
revoke all on public.debit_notes from anon, public;
revoke insert, update, delete on public.debit_notes from authenticated;
grant select on public.debit_notes to authenticated;
revoke all on public.debit_notes_v from anon, public;
grant select on public.debit_notes_v to authenticated;

drop trigger if exists trg_stamp_row_user on public.debit_notes;
create trigger trg_stamp_row_user before insert or update on public.debit_notes for each row execute function public.stamp_row_user();
drop trigger if exists trg_audit_row on public.debit_notes;
create trigger trg_audit_row after insert or update or delete on public.debit_notes for each row execute function public.audit_row('id');
drop trigger if exists trg_guard_posted_row on public.debit_notes;
create trigger trg_guard_posted_row before insert or update or delete on public.debit_notes
  for each row execute function public.guard_posted_row('issued_at', 'no_change', 'debit_note_number');

-- ---------------------------------------------------------------------
-- 7. EGS unit, submissions, hash chain
-- ---------------------------------------------------------------------
create table if not exists public.zatca_egs (
  id                      uuid primary key default gen_random_uuid(),
  environment             text not null check (environment in ('sandbox','simulation','production')),
  status                  text not null default 'new' check (status in ('new','compliance','compliance_passed','active','retired')),
  csr_input               jsonb not null default '{}'::jsonb,
  csr_pem                 text,
  private_key_enc         text,      -- AES-GCM, key in the Edge Function secret ZATCA_ENC_KEY
  ccsid_token_enc         text,
  ccsid_secret_enc        text,
  ccsid_request_id        text,
  pcsid_token_enc         text,
  pcsid_secret_enc        text,
  pcsid_request_id        text,
  certificate_expires_at  timestamptz,
  compliance_results      jsonb not null default '[]'::jsonb,
  last_icv                bigint not null default 0,
  last_hash               text not null default 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==',
  lease_token             uuid,
  lease_until             timestamptz,
  is_active               boolean not null default false,
  last_error              text,
  created_by              uuid default auth.uid(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  activated_at            timestamptz
);
create unique index if not exists zatca_egs_one_active on public.zatca_egs ((true)) where is_active;
alter table public.zatca_egs enable row level security;
revoke all on public.zatca_egs from public, anon, authenticated;

create table if not exists public.zatca_submissions (
  id               bigserial primary key,
  egs_id           uuid not null references public.zatca_egs(id),
  doc_type         text not null check (doc_type in ('invoice','credit_note','debit_note')),
  doc_id           text not null,
  doc_number       text,
  profile          text not null check (profile in ('standard','simplified')),
  api              text not null check (api in ('clearance','reporting')),
  icv              bigint not null,
  uuid             uuid not null,
  pih              text not null,
  invoice_hash     text not null,
  signed_xml       text not null,
  qr               text,
  status           text not null default 'signed' check (status in ('signed','cleared','reported','rejected','retry')),
  http_status      integer,
  attempts         integer not null default 0,
  next_attempt_at  timestamptz not null default now(),
  response         jsonb,
  cleared_xml      text,
  warnings         jsonb not null default '[]'::jsonb,
  errors           jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now(),
  submitted_at     timestamptz,
  finished_at      timestamptz,
  unique (egs_id, icv)
);
create unique index if not exists zatca_submissions_one_live on public.zatca_submissions (doc_type, doc_id) where status <> 'rejected';
create index if not exists zatca_submissions_retry_idx on public.zatca_submissions (status, next_attempt_at);
alter table public.zatca_submissions enable row level security;
drop policy if exists zatca_submissions_read on public.zatca_submissions;
create policy zatca_submissions_read on public.zatca_submissions for select to authenticated using (public.has_role('admin','ceo','finance'));
revoke all on public.zatca_submissions from public, anon, authenticated;
grant select on public.zatca_submissions to authenticated;
-- Audit without the secrets: records that a key / CSID changed, never its (encrypted) value; chain and lease moves are not logged
create or replace function public._zatca_egs_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_secret text[] := array['private_key_enc','ccsid_token_enc','ccsid_secret_enc','pcsid_token_enc','pcsid_secret_enc'];
  v_noise text[] := array['updated_at','lease_token','lease_until','last_icv','last_hash'];
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_changed text[]; k text;
begin
  if tg_op = 'UPDATE' then
    select array_agg(x order by x) into v_changed from jsonb_object_keys(v_new) x where v_new->x is distinct from v_old->x;
    if v_changed is null or v_changed <@ v_noise then return null; end if;
  end if;
  foreach k in array v_secret loop
    if v_old ? k then v_old := jsonb_set(v_old, array[k], case when v_old->>k is null then 'null'::jsonb else '"(set)"'::jsonb end); end if;
    if v_new ? k then v_new := jsonb_set(v_new, array[k], case when v_new->>k is null then 'null'::jsonb else '"(set)"'::jsonb end); end if;
  end loop;
  insert into public.audit_log (table_name, row_id, action, user_id, user_role, changed, old_row, new_row)
  values (tg_table_name, coalesce(v_new, v_old)->>'id', tg_op, auth.uid(), public.app_role(), v_changed, v_old, v_new);
  return null;
end $$;
drop trigger if exists trg_audit_row on public.zatca_egs;
create trigger trg_audit_row after insert or update or delete on public.zatca_egs for each row execute function public._zatca_egs_audit();

-- What the onboarding screen may see (never the keys or secrets)
create or replace view public.zatca_egs_status with (security_barrier = true) as
select id, environment, status, csr_input, certificate_expires_at, compliance_results, last_icv, is_active, last_error,
       created_at, updated_at, activated_at, ccsid_token_enc is not null as has_compliance_csid, pcsid_token_enc is not null as has_production_csid
from public.zatca_egs
where public.has_role('admin','ceo','finance');
revoke all on public.zatca_egs_status from anon, public;
grant select on public.zatca_egs_status to authenticated;

create or replace function public.zatca_phase2_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.zatca_egs where is_active)
$$;

-- New documents: own UUID; 'pending' while an EGS is active (else Phase 1 only)
create or replace function public._zatca_on_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.zatca_uuid := coalesce(new.zatca_uuid, gen_random_uuid());
  new.zatca_status := case when public.zatca_phase2_active() then 'pending' else 'phase1_qr_ready' end;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['invoices','credit_notes','debit_notes'] loop
    execute format('drop trigger if exists trg_a_zatca_on_insert on public.%I', t);
    execute format('create trigger trg_a_zatca_on_insert before insert on public.%I for each row execute function public._zatca_on_insert()', t);
  end loop;
end $$;

-- The 'zatcaPhase2Connected' switch only stamped invoices 'cleared' without calling ZATCA. Undo that.
do $$
declare n int;
begin
  perform set_config('request.jwt.claims', '', true);
  update public.invoices set zatca_status = 'phase1_qr_ready' where zatca_status = 'cleared' and zatca_submission_id is null;
  get diagnostics n = row_count;
  if n > 0 then raise notice '0010: % invoice(s) were marked cleared without a ZATCA submission; reset to phase1_qr_ready.', n; end if;
  update public.app_settings set value = value - 'zatcaPhase2Connected'
   where key = 'company_profile' and jsonb_typeof(value) = 'object' and value ? 'zatcaPhase2Connected';
exception when undefined_column or undefined_table then null;
end $$;

-- Everything the Edge Function needs to build the XML for one document
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
    'subtotal', (d->>'subtotal_sar')::numeric, 'vat', (d->>'vat_sar')::numeric, 'grand', (d->>'grand_total_sar')::numeric);
end $$;

create or replace function public._zatca_doc_set(p_doc_type text, p_doc_id text, p_status text, p_extra jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_tbl text := case p_doc_type when 'invoice' then 'invoices' when 'credit_note' then 'credit_notes' when 'debit_note' then 'debit_notes' end;
begin
  if v_tbl is null then raise exception 'Unknown document type %.', p_doc_type; end if;
  perform set_config('request.jwt.claims', '', true);   -- service-side write (audited as maintenance)
  execute format($q$update public.%I set
      zatca_status = $1,
      zatca_uuid = coalesce(($2->>'uuid')::uuid, zatca_uuid),
      zatca_icv = coalesce(($2->>'icv')::bigint, zatca_icv),
      zatca_hash = coalesce($2->>'hash', zatca_hash),
      zatca_qr = coalesce($2->>'qr', zatca_qr),
      zatca_submission_id = coalesce(($2->>'submission_id')::bigint, zatca_submission_id),
      zatca_cleared_at = coalesce(($2->>'cleared_at')::timestamptz, zatca_cleared_at),
      zatca_messages = coalesce($2->'messages', zatca_messages)
    where id = $3$q$, v_tbl) using p_status, coalesce(p_extra, '{}'::jsonb), p_doc_id;
end $$;

-- Start signing a document. Returns {mode:'sign', lease, icv, pih, uuid, payload} or, when the document already
-- has a live submission, {mode:'resend'|'done', submission}. The lease stops two documents taking the same ICV.
create or replace function public.zatca_begin(p_doc_type text, p_doc_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.zatca_egs; s public.zatca_submissions; v_lease uuid := gen_random_uuid(); v_payload jsonb; v_uuid uuid;
begin
  select * into e from public.zatca_egs where is_active for update;
  if e.id is null then raise exception 'ZATCA Phase 2 is not set up: no active EGS unit. Finish onboarding first.'; end if;
  select * into s from public.zatca_submissions where doc_type = p_doc_type and doc_id = p_doc_id and status <> 'rejected' order by id desc limit 1;
  if s.id is not null then
    return jsonb_build_object('mode', case when s.status in ('signed','retry') then 'resend' else 'done' end,
                              'submission', to_jsonb(s) - 'cleared_xml', 'environment', e.environment);
  end if;
  v_payload := public.zatca_doc_payload(p_doc_type, p_doc_id);
  if coalesce(v_payload->>'zatcaStatus', '') = 'phase1_qr_ready' then
    raise exception '% was issued before Phase 2 was switched on; it stays a Phase 1 document.', v_payload->>'number';
  end if;
  if e.lease_until is not null and e.lease_until > now() then
    raise exception 'ZATCA signing is busy with another document. Try again in a few seconds.' using errcode = '55P03';
  end if;
  -- a document ZATCA rejected is re-issued with a new UUID
  v_uuid := case when exists (select 1 from public.zatca_submissions where doc_type = p_doc_type and doc_id = p_doc_id)
                 then gen_random_uuid() else coalesce((v_payload->>'zatcaUuid')::uuid, gen_random_uuid()) end;
  update public.zatca_egs set lease_token = v_lease, lease_until = now() + interval '90 seconds' where id = e.id;
  return jsonb_build_object('mode', 'sign', 'lease', v_lease, 'egs_id', e.id, 'environment', e.environment,
                            'icv', e.last_icv + 1, 'pih', e.last_hash, 'uuid', v_uuid, 'payload', v_payload);
end $$;

create or replace function public.zatca_release(p_lease uuid) returns void
language sql security definer set search_path = public as $$
  update public.zatca_egs set lease_token = null, lease_until = null where lease_token = p_lease
$$;

-- Record a signed document and move the chain forward (before it is sent: the chain counts every signed document)
create or replace function public.zatca_commit(p_lease uuid, p_doc_type text, p_doc_id text, p_doc_number text, p_profile text,
                                               p_icv bigint, p_uuid uuid, p_pih text, p_hash text, p_xml text, p_qr text) returns bigint
language plpgsql security definer set search_path = public as $$
declare e public.zatca_egs; v_id bigint;
begin
  select * into e from public.zatca_egs where is_active and lease_token = p_lease for update;
  if e.id is null then raise exception 'The signing lease was lost (another document took the chain). Submit this document again.'; end if;
  if p_icv <> e.last_icv + 1 or p_pih <> e.last_hash then raise exception 'ZATCA chain moved while signing; submit again.'; end if;
  insert into public.zatca_submissions (egs_id, doc_type, doc_id, doc_number, profile, api, icv, uuid, pih, invoice_hash, signed_xml, qr)
  values (e.id, p_doc_type, p_doc_id, p_doc_number, p_profile, case when p_profile = 'standard' then 'clearance' else 'reporting' end,
          p_icv, p_uuid, p_pih, p_hash, p_xml, p_qr)
  returning id into v_id;
  update public.zatca_egs set last_icv = p_icv, last_hash = p_hash, lease_token = null, lease_until = null, updated_at = now() where id = e.id;
  perform public._zatca_doc_set(p_doc_type, p_doc_id, 'submitting',
    jsonb_strip_nulls(jsonb_build_object('uuid', p_uuid, 'icv', p_icv, 'hash', p_hash, 'qr', p_qr, 'submission_id', v_id)));
  return v_id;
end $$;

-- Store ZATCA's answer. 200/202 + CLEARED/REPORTED = done; 400 = rejected (fix and resubmit: new UUID, next ICV);
-- 409 = ZATCA already has it; anything else (401, 429, 5xx, timeouts = 0) is retried with back-off.
create or replace function public.zatca_record_result(p_submission_id bigint, p_http_status integer, p_response jsonb,
                                                      p_cleared_xml text default null, p_cleared_qr text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.zatca_submissions; v_state text; v_status text; v_doc_status text;
  v_vr jsonb := coalesce(p_response->'validationResults', '{}'::jsonb);
  v_warn jsonb := coalesce(v_vr->'warningMessages', '[]'::jsonb);
  v_err jsonb := coalesce(v_vr->'errorMessages', '[]'::jsonb);
begin
  select * into s from public.zatca_submissions where id = p_submission_id for update;
  if s.id is null then raise exception 'Submission % not found.', p_submission_id; end if;
  v_state := upper(coalesce(p_response->>'clearanceStatus', p_response->>'reportingStatus', ''));
  v_status := case
    when p_http_status in (200, 202) and v_state in ('CLEARED', 'REPORTED') then lower(v_state)
    when p_http_status = 409 then case when s.api = 'clearance' then 'cleared' else 'reported' end
    when p_http_status = 400 or v_state in ('NOT_CLEARED', 'NOT_REPORTED') then 'rejected'
    else 'retry' end;
  if p_http_status = 409 then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', '409', 'message', 'ZATCA already had this document (duplicate submission).'));
  end if;
  if v_status = 'retry' and jsonb_array_length(v_err) = 0 then
    v_err := jsonb_build_array(jsonb_build_object('code', coalesce(p_http_status, 0)::text,
               'message', coalesce(p_response->>'message', p_response->>'error', 'ZATCA could not be reached; will retry.')));
  end if;
  update public.zatca_submissions
     set status = v_status, http_status = p_http_status, response = p_response, attempts = attempts + 1,
         submitted_at = coalesce(submitted_at, now()), cleared_xml = coalesce(p_cleared_xml, cleared_xml),
         warnings = v_warn, errors = v_err,
         finished_at = case when v_status = 'retry' then null else now() end,
         next_attempt_at = case when v_status = 'retry' then now() + least(interval '6 hours', interval '2 minutes' * power(2, least(attempts, 10))) else next_attempt_at end
   where id = s.id;
  v_doc_status := case v_status when 'retry' then 'retrying' else v_status end;
  perform public._zatca_doc_set(s.doc_type, s.doc_id, v_doc_status,
    jsonb_strip_nulls(jsonb_build_object('qr', p_cleared_qr, 'messages', v_warn || v_err,
                                         'cleared_at', case when v_status in ('cleared', 'reported') then now() end)));
  return jsonb_build_object('submission_id', s.id, 'status', v_status, 'doc_status', v_doc_status, 'warnings', v_warn, 'errors', v_err);
end $$;

-- Documents waiting for ZATCA: never submitted, retry due, or stuck mid-send for 10+ minutes
create or replace function public.zatca_queue(p_limit integer default 25)
returns table (doc_type text, doc_id text, doc_number text, profile text, issued_at timestamptz)
language sql stable security definer set search_path = public as $$
  with docs as (
    select 'invoice'::text as doc_type, i.id as doc_id, i.invoice_number as doc_number, i.invoice_type as inv_type, i.issued_at, i.zatca_status, i.zatca_submission_id
      from public.invoices i where i.zatca_status in ('pending','retrying','submitting')
    union all
    select 'credit_note', c.id, c.credit_note_number, (select invoice_type from public.invoices where id = c.original_invoice_id), c.issued_at, c.zatca_status, c.zatca_submission_id
      from public.credit_notes c where c.zatca_status in ('pending','retrying','submitting')
    union all
    select 'debit_note', d.id, d.debit_note_number, (select invoice_type from public.invoices where id = d.original_invoice_id), d.issued_at, d.zatca_status, d.zatca_submission_id
      from public.debit_notes d where d.zatca_status in ('pending','retrying','submitting')
  )
  select d.doc_type, d.doc_id, d.doc_number, case when d.inv_type = 'standard' then 'standard' else 'simplified' end, d.issued_at
  from docs d left join public.zatca_submissions s on s.id = d.zatca_submission_id
  where d.zatca_status = 'pending'
     or (d.zatca_status = 'retrying' and coalesce(s.next_attempt_at, now()) <= now())
     or (d.zatca_status = 'submitting' and coalesce(s.created_at, now()) < now() - interval '10 minutes')
  order by d.issued_at
  limit greatest(1, least(coalesce(p_limit, 25), 200))
$$;

-- Simplified (B2C) documents still not reported 24 hours after issue — ZATCA's deadline
create or replace view public.zatca_overdue_reporting with (security_barrier = true) as
select doc_type, doc_id, doc_number, issued_at from public.zatca_queue(200) q
where q.profile = 'simplified' and q.issued_at < now() - interval '24 hours' and public.has_role('admin','ceo','finance');
revoke all on public.zatca_overdue_reporting from anon, public;
grant select on public.zatca_overdue_reporting to authenticated;

-- ---------------------------------------------------------------------
-- 7b. invoices_v / credit_notes_v pick up the new columns (views fix their column list when created)
-- ---------------------------------------------------------------------
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


-- ---------------------------------------------------------------------
-- 8. VAT return on each document's stored breakdown (0009 version; changes marked 0010)
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
-- 9. Privileges
-- ---------------------------------------------------------------------
do $$
declare f text;
begin
  -- service role only (the zatca Edge Function)
  foreach f in array array['public.zatca_doc_payload(text, text)', 'public._zatca_doc_set(text, text, text, jsonb)',
                           'public.zatca_begin(text, text)', 'public.zatca_release(uuid)',
                           'public.zatca_commit(uuid, text, text, text, text, bigint, uuid, text, text, text, text)',
                           'public.zatca_record_result(bigint, integer, jsonb, text, text)', 'public.zatca_queue(integer)',
                           'public._zatca_on_insert()', 'public._zatca_egs_audit()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['public._vat_breakdown(jsonb, text)', 'public._breakdown_vat(jsonb)', 'public._doc_breakdown(jsonb, jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.post_debit_note(text, jsonb, text)', 'public.zatca_phase2_active()', 'public.vat_return(date, date)',
                           'public.post_invoice(text)', 'public.post_credit_note(text, jsonb, text, text)', 'public.ar_aging(date)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
