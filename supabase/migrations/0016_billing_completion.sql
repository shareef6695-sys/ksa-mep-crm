-- =====================================================================
-- 0016_billing_completion.sql — completes project / contract / service billing (follow-up to 0014)
--
--  * Commission on progress claims: the main sales order's salesman earns commission_pct on the claim's expected profit
--    = work done this claim x the project's expected margin (budget revenue vs budget cost; else the main SO's margin).
--    Advances and retention releases carry no commission (no new revenue). Unlocked as the claim is paid, like any invoice.
--  * Commission on contract invoices: service_contracts.commission_pct (set by a manager / finance with
--    set_contract_commission) on the invoice net. Credit notes claw it back as usual.
--  * Chargeable service tickets are invoiced with invoice_service_ticket (invoice kind 'service'):
--    Dr 1100 / Cr 4010|4020 / Cr 2100; the ticket keeps the invoice number.
--  * Retention VAT stays "charged when the retention is invoiced" (0014).
--
-- Run after 0015 (and before 0005 when 0005 is used). Re-runnable.
-- =====================================================================
begin;

alter table public.service_contracts add column if not exists commission_pct numeric(7,4) not null default 0;
alter table public.service_tickets add column if not exists invoice_id text references public.invoices(id);
alter table public.service_tickets add column if not exists invoice_number text;
alter table public.invoices drop constraint if exists invoices_invoice_kind_check;
alter table public.invoices add constraint invoices_invoice_kind_check check (invoice_kind in ('sale','advance','progress','retention','contract','service'));

-- expected margin of a project (0..1): budget first, else the main sales order
create or replace function public._project_margin(pr public.projects) returns numeric
language sql stable security definer set search_path = public as $$
  select greatest(0, least(1, coalesce(
    case when public._num(pr.budget->'revenue') > 0
              and public._num(pr.budget->'material') + public._num(pr.budget->'labour') + public._num(pr.budget->'subcontract') + public._num(pr.budget->'other') > 0
         then (public._num(pr.budget->'revenue') - (public._num(pr.budget->'material') + public._num(pr.budget->'labour')
               + public._num(pr.budget->'subcontract') + public._num(pr.budget->'other'))) / public._num(pr.budget->'revenue') end,
    (select case when so.subtotal_sar > 0 and coalesce(so.total_cost_sar, 0) > 0 then (so.subtotal_sar - so.total_cost_sar) / so.subtotal_sar end
       from public.sales_orders so where so.id = pr.main_so_id),
    0)))
$$;

create or replace function public._accrue_billing_commission(v_inv public.invoices, p_base numeric, p_pct numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_elig numeric := public._r2(greatest(0, p_base) * coalesce(p_pct, 0) / 100);
begin
  if coalesce(p_pct, 0) <= 0 or v_elig <= 0 or v_inv.salesman_id is null then return; end if;
  insert into public.commission_ledger (invoice_id, invoice_number, division, client_name, salesman_id, salesman_name, commission_pct,
                                        net_profit_sar, total_eligible_commission_sar, unlocked_commission_sar, paid_out_sar, status)
  values (v_inv.id, v_inv.invoice_number, coalesce(v_inv.division, 'MEP'), v_inv.client_name, v_inv.salesman_id, coalesce(v_inv.salesman_name, 'Salesman'),
          p_pct, public._r2(greatest(0, p_base)), v_elig, 0, 0, 'awaiting_collection');
end $$;

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
  -- 0016: commission on the claim's expected profit
  perform public._accrue_billing_commission(v_inv, public._r2(v_g * public._project_margin(pr)),
            (select commission_pct from public.sales_orders where id = pr.main_so_id));
  return v_inv;
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
  perform public._accrue_billing_commission(v_inv, v_sub, k.commission_pct);   -- 0016
  return v_inv;
end $$;


create or replace function public.set_contract_commission(p_id text, p_pct numeric) returns public.service_contracts
language plpgsql security definer set search_path = public as $$
declare k public.service_contracts;
begin
  perform public._require_role('admin','ceo','manager','finance');
  if p_pct is null or p_pct < 0 or p_pct > 50 then raise exception 'Commission must be between 0 and 50%%.'; end if;
  update public.service_contracts set commission_pct = p_pct, updated_at = now() where id = p_id returning * into k;
  if k.id is null then raise exception 'Contract % not found.', p_id; end if;
  return k;
end $$;

-- Invoice a resolved / closed chargeable service ticket (one invoice per ticket)
create or replace function public.invoice_service_ticket(p_ticket_id text) returns public.invoices
language plpgsql security definer set search_path = public as $$
declare t public.service_tickets; v_rate numeric := public._vat_rate('S'); v_items jsonb; v_vat numeric; v_inv public.invoices; cu public.customers;
begin
  perform public._require_role('admin','ceo','finance');
  select * into t from public.service_tickets where id = p_ticket_id for update;
  if t.id is null then raise exception 'Ticket % not found.', p_ticket_id; end if;
  if t.invoice_id is not null then raise exception 'Ticket % has already been invoiced (%).', t.ticket_number, t.invoice_number; end if;
  if t.coverage <> 'chargeable' then raise exception 'Ticket % is covered by %; it is not charged.', t.ticket_number, t.coverage; end if;
  if t.status not in ('resolved','closed') then raise exception 'Resolve ticket % before invoicing it.', t.ticket_number; end if;
  if t.chargeable_sar <= 0 then raise exception 'Enter the charge on ticket % first.', t.ticket_number; end if;
  select * into cu from public.customers where id = t.customer_id;
  v_vat := public._r2(t.chargeable_sar * v_rate);
  v_items := jsonb_build_array(jsonb_build_object('desc', trim(format('Service %s - %s%s', t.ticket_number, t.subject,
                 case when t.serial <> '' then ' (S/N ' || t.serial || ')' else '' end)),
               'qty', 1, 'unit', 'JOB', 'unitSellSar', t.chargeable_sar, 'vatCategory', 'S', 'vatRate', v_rate));
  v_inv := public._insert_billing_invoice(jsonb_build_object('kind', 'service', 'division', coalesce(t.division, 'IT & ELV'), 'client_name', t.client_name,
             'client_vat', coalesce(cu.vat_number, ''), 'customer_id', t.customer_id, 'source_id', t.id,
             'billing', jsonb_build_object('ticketNumber', t.ticket_number, 'labourHours', t.labour_hours)),
             v_items, public._rounded_breakdown(v_items), t.chargeable_sar, v_vat, t.chargeable_sar + v_vat);
  perform public._gl_post(public.riyadh_date(v_inv.issued_at), 'INVOICE', v_inv.invoice_number,
    format('Service invoice %s - %s (%s)', v_inv.invoice_number, t.client_name, t.ticket_number),
    jsonb_build_array(
      jsonb_build_object('account_code', '1100', 'debit', t.chargeable_sar + v_vat, 'memo', t.client_name),
      jsonb_build_object('account_code', case when coalesce(t.division, 'IT & ELV') = 'MEP' then '4010' else '4020' end, 'credit', t.chargeable_sar, 'memo', t.ticket_number),
      jsonb_build_object('account_code', '2100', 'credit', v_vat, 'memo', 'Output VAT')));
  update public.service_tickets set invoice_id = v_inv.id, invoice_number = v_inv.invoice_number, updated_at = now(),
         history = history || jsonb_build_array(jsonb_build_object('at', now(), 'by', public._actor_name(), 'status', status, 'note', 'Invoiced ' || v_inv.invoice_number))
   where id = t.id;
  return v_inv;
end $$;

-- credit overrides for service invoices reference the ticket
create or replace function public.grant_credit_override(p_doc_type text, p_ref_id text, p_reason text) returns public.credit_overrides
language plpgsql security definer set search_path = public as $$
declare o public.credit_overrides; v_client text;
begin
  perform public._require_role('admin','ceo','finance');
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for the credit override.'; end if;
  v_client := case p_doc_type when 'SO' then (select data->>'clientName' from public.inquiries where id = p_ref_id)
                              when 'INVOICE' then coalesce((select client_name from public.delivery_notes where id = p_ref_id),   -- 0014: project / contract invoices
                                                (select client_name from public.projects where id = p_ref_id),
                                                (select client_name from public.service_contracts where id = p_ref_id),
                                                (select client_name from public.service_tickets where id = p_ref_id))
                              when 'SO_AMEND' then (select client_name from public.sales_orders where id = p_ref_id) end;
  if v_client is null then raise exception 'Document % not found.', p_ref_id; end if;
  insert into public.credit_overrides (doc_type, ref_id, client_name, reason, granted_by) values (p_doc_type, p_ref_id, v_client, trim(p_reason), public._actor_name())
  returning * into o;
  return o;
end $$;


do $$
declare f text;
begin
  foreach f in array array['public._project_margin(public.projects)', 'public._accrue_billing_commission(public.invoices, numeric, numeric)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.set_contract_commission(text, numeric)', 'public.invoice_service_ticket(text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
