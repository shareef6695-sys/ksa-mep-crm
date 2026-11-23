-- =====================================================================
-- 0006_credit_receipts.sql — credit notes, customer credit, multi-invoice receipts.
-- Closes gaps A4, A5, A6, A10 (and Z8 data: reason code + original invoice reference).
-- ---------------------------------------------------------------------
-- Run AFTER 0004 (and 0005 if applied). Idempotent; one transaction.
--
-- 1. Invoices are never changed by a credit note again. Open balance =
--      grand_total_sar - paid_amount_sar - credited_amount_sar
--    (view public.invoice_balances). Invoices that older credit notes had
--    reduced are restored to their issued total.
-- 2. A credit note can only return what is still un-credited on each invoice line.
-- 3. When a credit note (or a receipt) leaves the customer with money in hand,
--    the excess goes to 2050 Customer advances / refunds due and to
--    public.customer_credit_ledger. Finance can apply that credit to another
--    invoice (apply_customer_credit) or refund it (post_customer_refund).
-- 4. One receipt can pay several invoices of the same customer (post_receipt +
--    public.receipt_allocations); anything not allocated is held on account.
-- 5. Credit notes record a reason code and the original invoice number and date.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Chart of accounts
-- ---------------------------------------------------------------------
insert into public.gl_accounts (account_code, account_name_en, account_name_ar, account_type, normal_balance, is_system)
values ('2050', 'Customer Advances & Refunds Due', 'دفعات مقدمة من العملاء ومبالغ مستحقة الرد', 'Liability', 'Credit', true)
on conflict (account_code) do nothing;

-- ---------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------
alter table public.invoices          add column if not exists credited_amount_sar numeric(18,2) not null default 0;
alter table public.credit_notes      add column if not exists reason_code text;
alter table public.credit_notes      add column if not exists original_invoice_date timestamptz;
alter table public.credit_notes      add column if not exists applied_to_ar_sar numeric(18,2);
alter table public.credit_notes      add column if not exists to_customer_credit_sar numeric(18,2) default 0;
alter table public.customer_receipts add column if not exists unapplied_sar numeric(18,2) not null default 0;

-- ---------------------------------------------------------------------
-- 2. Invoices: immutability rule now excludes grand_total_sar (re-issued guard)
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
    v_allowed := v_allowed || array['paid_amount_sar','payment_status','credited_amount_sar'];
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

-- Restore invoices that older credit notes had reduced (maintenance session: bypasses the guard, still audited)
do $$
begin
  perform set_config('request.jwt.claims', '', true);
  update public.invoices i
     set grand_total_sar = public._r2(i.grand_total_sar + c.cn_total),
         credited_amount_sar = c.cn_total
    from (select original_invoice_id, sum(grand_total_sar) as cn_total from public.credit_notes group by original_invoice_id) c
   where c.original_invoice_id = i.id
     and coalesce(i.credited_amount_sar, 0) = 0
     and c.cn_total > 0;
  update public.credit_notes cn
     set original_invoice_date = i.issued_at
    from public.invoices i
   where i.id = cn.original_invoice_id and cn.original_invoice_date is null;
end $$;

-- ---------------------------------------------------------------------
-- 3. Receipt allocations and customer credit ledger (read-only to the browser)
-- ---------------------------------------------------------------------
create table if not exists public.receipt_allocations (
  id           bigserial primary key,
  receipt_id   text references public.customer_receipts(id),
  invoice_id   text not null references public.invoices(id),
  amount_sar   numeric(18,2) not null check (amount_sar <> 0),
  -- receipt / customer_credit: money applied to the invoice (+)
  -- credit_note_release: a credit note on a paid invoice moves that much back to customer credit (-)
  source       text not null default 'receipt' check (source in ('receipt','customer_credit','credit_note_release')),
  source_doc   text,
  entry_date   date not null default (now() at time zone 'Asia/Riyadh')::date,
  created_by_uid uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists idx_receipt_alloc_invoice on public.receipt_allocations (invoice_id);
create index if not exists idx_receipt_alloc_receipt on public.receipt_allocations (receipt_id);

-- + amount = customer credit created; - amount = credit used (applied to an invoice or refunded)
create table if not exists public.customer_credit_ledger (
  id           bigserial primary key,
  client_name  text not null,
  kind         text not null check (kind in ('receipt_unapplied','credit_note_excess','applied_to_invoice','refunded','opening')),
  amount_sar   numeric(18,2) not null check (amount_sar <> 0),
  source_doc   text,
  invoice_id   text references public.invoices(id),
  entry_date   date not null default (now() at time zone 'Asia/Riyadh')::date,
  notes        text,
  created_by_uid uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists idx_ccl_client on public.customer_credit_ledger (lower(trim(client_name)));

do $$
declare t text;
begin
  foreach t in array array['receipt_allocations','customer_credit_ledger'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.has_role(''admin'',''ceo'',''finance'',''manager''))', t || '_read', t);
    execute format('drop trigger if exists trg_audit_row on public.%I', t);
    execute format('create trigger trg_audit_row after insert or update or delete on public.%I for each row execute function public.audit_row(''id'')', t);
    execute format('drop trigger if exists trg_guard_posted_row on public.%I', t);
    execute format('create trigger trg_guard_posted_row before insert or update or delete on public.%I for each row execute function public.guard_posted_row(''entry_date'', ''no_change'', ''id'')', t);
  end loop;
end $$;

-- Backfill: each existing receipt pays its own invoice
insert into public.receipt_allocations (receipt_id, invoice_id, amount_sar, source, source_doc, entry_date)
select r.id, r.invoice_id, r.amount_sar, 'receipt', r.receipt_number, (r.received_at at time zone 'Asia/Riyadh')::date
from public.customer_receipts r
where r.invoice_id is not null and r.amount_sar > 0
  and exists (select 1 from public.invoices i where i.id = r.invoice_id)
  and not exists (select 1 from public.receipt_allocations a where a.receipt_id = r.id);

-- ---------------------------------------------------------------------
-- 4. Views
-- ---------------------------------------------------------------------
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

create or replace view public.invoice_balances with (security_barrier = true) as
select i.id as invoice_id, i.invoice_number, i.client_name, i.salesman_id, i.division, i.issued_at,
       i.grand_total_sar, i.paid_amount_sar, i.credited_amount_sar,
       public._r2(i.grand_total_sar - coalesce(i.paid_amount_sar, 0) - coalesce(i.credited_amount_sar, 0)) as open_balance_sar,
       i.payment_status
from public.invoices i
where public.has_role('admin','ceo','finance','manager') or (public.is_sales() and i.salesman_id = public.uid_text());

create or replace view public.customer_credit_balances with (security_barrier = true) as
select min(client_name) as client_name, public._r2(sum(amount_sar)) as credit_balance_sar, max(entry_date) as last_movement
from public.customer_credit_ledger
where public.has_role('admin','ceo','finance','manager')
group by lower(trim(client_name))
having sum(amount_sar) <> 0;

-- Invoices where earlier (pre-0006) credit notes left the customer overpaid; their GL shows the excess as
-- a credit balance in 1100. Finance can reclass it with a manual journal (Dr 1100 / Cr 2050) and record it via
-- apply/refund once it is in the customer-credit ledger.
create or replace view public.legacy_overpaid_invoices with (security_barrier = true) as
select i.id as invoice_id, i.invoice_number, i.client_name, i.grand_total_sar, i.paid_amount_sar, i.credited_amount_sar,
       public._r2(i.paid_amount_sar + i.credited_amount_sar - i.grand_total_sar) as overpaid_sar
from public.invoices i
where public.has_role('admin','ceo','finance')
  and i.paid_amount_sar + i.credited_amount_sar > i.grand_total_sar + 0.01;

-- Invoices whose paid amount (kept by the old app) doesn't match their receipts. Fix before relying on aging.
create or replace view public.invoice_payment_mismatches with (security_barrier = true) as
select i.id as invoice_id, i.invoice_number, i.client_name, i.paid_amount_sar,
       coalesce(a.allocated, 0) as receipts_allocated_sar, public._r2(i.paid_amount_sar - coalesce(a.allocated, 0)) as difference_sar
from public.invoices i
left join (select invoice_id, sum(amount_sar) as allocated from public.receipt_allocations group by invoice_id) a on a.invoice_id = i.id
where public.has_role('admin','ceo','finance')
  and i.paid_amount_sar <> coalesce(a.allocated, 0);

do $$
declare v text;
begin
  foreach v in array array['invoices_v','credit_notes_v','invoice_balances','customer_credit_balances','legacy_overpaid_invoices','invoice_payment_mismatches'] loop
    execute format('revoke all on public.%I from anon, public', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5. Helpers
-- ---------------------------------------------------------------------
create or replace function public._norm_party(p text) returns text language sql immutable as $$ select lower(trim(coalesce(p, ''))) $$;

create or replace function public._customer_credit(p_client text) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount_sar), 0) from public.customer_credit_ledger where public._norm_party(client_name) = public._norm_party(p_client)
$$;

-- Payment status + commission unlock after any change to paid / credited amounts
create or replace function public._invoice_sync(p_invoice_id text) returns void
language plpgsql security definer set search_path = public as $$
declare inv public.invoices; v_net numeric; v_ratio numeric;
begin
  select * into inv from public.invoices where id = p_invoice_id;
  v_net := inv.grand_total_sar - coalesce(inv.credited_amount_sar, 0);       -- what the customer owes in total after credits
  update public.invoices
     set payment_status = case when inv.grand_total_sar - inv.paid_amount_sar - inv.credited_amount_sar <= 0.01 then 'paid'
                               when inv.paid_amount_sar > 0 then 'partial' else 'unpaid' end
   where id = inv.id and payment_status is distinct from
         (case when inv.grand_total_sar - inv.paid_amount_sar - inv.credited_amount_sar <= 0.01 then 'paid'
               when inv.paid_amount_sar > 0 then 'partial' else 'unpaid' end);
  v_ratio := case when v_net > 0.01 then least(1, coalesce(inv.paid_amount_sar, 0) / v_net) else 1 end;
  update public.commission_ledger
     set unlocked_commission_sar = public._r2(total_eligible_commission_sar * v_ratio),
         status = case when status = 'reversed_by_credit_note' or total_eligible_commission_sar <= 0 then 'reversed_by_credit_note'
                       when v_ratio >= 0.999 then 'ready_for_payout'
                       when v_ratio > 0 then 'partially_unlocked' else 'awaiting_collection' end,
         updated_at = now()
   where invoice_id = inv.id;
end $$;

-- Quantity already credited per invoice line (index-aligned with invoices.items)
create or replace function public._invoice_credited_qty(p_invoice_id text) returns numeric[]
language plpgsql stable security definer set search_path = public as $$
declare
  inv public.invoices; v_out numeric[]; cn record; ln jsonb; idx int; n int;
begin
  select * into inv from public.invoices where id = p_invoice_id;
  n := coalesce(jsonb_array_length(inv.items), 0);
  v_out := array_fill(0::numeric, array[greatest(n, 1)]);
  for cn in select items from public.credit_notes where original_invoice_id = p_invoice_id loop
    for ln in select * from jsonb_array_elements(coalesce(cn.items, '[]'::jsonb)) loop
      idx := null;
      if ln ? 'invoiceLine' then
        idx := (ln->>'invoiceLine')::int + 1;
      else  -- credit notes from before 0006: match the line by description and price
        select o::int into idx
        from jsonb_array_elements(inv.items) with ordinality x(it, o)
        where it->>'desc' is not distinct from ln->>'desc'
          and public._num(it->'unitSellSar') = public._num(ln->'unitSellSar')
        order by o limit 1;
      end if;
      if idx between 1 and n then v_out[idx] := v_out[idx] + public._num(ln->'qty'); end if;
    end loop;
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------------------------------
-- 6. Receipts: one receipt, many invoices, remainder on account
--    p_allocations: [{invoice_id, amount}]  (all for the same customer)
-- ---------------------------------------------------------------------
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
    v_open := public._r2(inv.grand_total_sar - inv.paid_amount_sar - inv.credited_amount_sar);
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

-- The one-invoice receipt the app already uses: now a thin wrapper (capped at the open balance, as before)
create or replace function public.post_customer_receipt(p_invoice_id text, p_amount numeric, p_method text,
                                                        p_reference text default '', p_date date default null)
returns public.customer_receipts
language plpgsql security definer set search_path = public as $$
declare inv public.invoices; v_open numeric; v_apply numeric;
begin
  perform public._require_role('admin','ceo','finance');
  select * into inv from public.invoices where id = p_invoice_id;
  if inv.id is null then raise exception 'Invoice % not found.', p_invoice_id; end if;
  v_open := public._r2(inv.grand_total_sar - inv.paid_amount_sar - inv.credited_amount_sar);
  if v_open <= 0 then raise exception 'Invoice % is already fully collected.', inv.invoice_number; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Receipt amount must be greater than zero.'; end if;
  v_apply := least(public._r2(p_amount), v_open);
  return public.post_receipt(inv.client_name, v_apply, p_method, p_reference, p_date,
                             jsonb_build_array(jsonb_build_object('invoice_id', inv.id, 'amount', v_apply)));
end $$;

-- Use a customer's credit (advance / credit-note excess) to settle an invoice
create or replace function public.apply_customer_credit(p_invoice_id text, p_amount numeric, p_date date default null) returns public.invoices
language plpgsql security definer set search_path = public as $$
declare inv public.invoices; v_amt numeric := public._r2(p_amount); v_open numeric; v_credit numeric; v_date date := coalesce(p_date, public._riyadh_today());
        v_doc text;
begin
  perform public._require_role('admin','ceo','finance');
  select * into inv from public.invoices where id = p_invoice_id for update;
  if inv.id is null then raise exception 'Invoice % not found.', p_invoice_id; end if;
  perform pg_advisory_xact_lock(hashtext('ccl:' || public._norm_party(inv.client_name)));
  v_open := public._r2(inv.grand_total_sar - inv.paid_amount_sar - inv.credited_amount_sar);
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

-- Pay a customer's credit back
create or replace function public.post_customer_refund(p_client_name text, p_amount numeric, p_bank_account text default '1020',
                                                       p_method text default 'Bank Transfer', p_reference text default '',
                                                       p_date date default null) returns public.gl_journal_entries
language plpgsql security definer set search_path = public as $$
declare v_amt numeric := public._r2(p_amount); v_credit numeric; v_num text; v_date date := coalesce(p_date, public._riyadh_today()); v_jv public.gl_journal_entries;
begin
  perform public._require_role('admin','ceo','finance');
  perform pg_advisory_xact_lock(hashtext('ccl:' || public._norm_party(p_client_name)));
  v_credit := public._customer_credit(p_client_name);
  if v_amt <= 0 then raise exception 'Refund amount must be greater than zero.'; end if;
  if v_amt > v_credit + 0.001 then raise exception '% has only SAR % of credit available.', p_client_name, public._r2(v_credit); end if;
  if not exists (select 1 from public.gl_accounts where account_code = p_bank_account and account_type = 'Asset'
                  and account_code like '10%' and coalesce(is_active, true)) then
    raise exception 'Refund from a cash or bank account (10xx). % is not one.', p_bank_account;
  end if;
  v_num := public.next_doc_number('REFUND');
  v_jv := public._gl_post(v_date, 'CUSTOMER_REFUND', v_num, format('Customer Refund %s - %s', v_num, trim(p_client_name)),
    jsonb_build_array(
      jsonb_build_object('account_code', '2050', 'debit', v_amt, 'memo', 'Refund - ' || trim(p_client_name)),
      jsonb_build_object('account_code', p_bank_account, 'credit', v_amt, 'memo', trim(coalesce(p_method, '') || ' ' || coalesce(p_reference, '')))));
  insert into public.customer_credit_ledger (client_name, kind, amount_sar, source_doc, entry_date, notes)
  values (trim(p_client_name), 'refunded', -v_amt, v_num, v_date, trim(coalesce(p_method, '') || ' ' || coalesce(p_reference, '')));
  return v_jv;
end $$;

-- ---------------------------------------------------------------------
-- 7. Credit note (replaces the 0004 version)
--    p_return_qtys: [qty for invoice line 0, 1, ...]; p_reason_code: RETURN | DAMAGED | PRICE_ADJUSTMENT | CANCELLATION | OTHER
-- ---------------------------------------------------------------------
drop function if exists public.post_credit_note(text, jsonb, text);
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
                                               'unitSellSar', public._num(it->'unitSellSar'), 'unitCostSar', public._num(it->'unitCostSar')) order by o)
                  filter (where q > 0), '[]'::jsonb),
         coalesce(sum(q * public._num(it->'unitSellSar')), 0), coalesce(sum(q * public._num(it->'unitCostSar')), 0)
    into v_lines, v_sub, v_cost from x;
  if jsonb_array_length(v_lines) = 0 or v_sub <= 0 then raise exception 'Enter a return quantity on at least one line.'; end if;

  v_vat := v_sub * 0.15; v_grand := public._r2(v_sub + v_vat);
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
                                   applied_to_ar_sar, to_customer_credit_sar, qr_base64, issued_by, issued_at)
  values (v_num, inv.id, inv.invoice_number, inv.issued_at, inv.client_name, coalesce(inv.client_vat, ''),
          p_reason, p_reason_code, v_lines, public._r2(v_sub), public._r2(v_vat), v_grand, public._r2(v_cost),
          v_to_ar, v_excess, public._zatca_qr(c->>'nameEn', c->>'vatNumber', v_iso, v_grand, v_vat), public._actor_name(), v_iso::timestamptz)
  returning * into v_cn;

  perform public._gl_post(public.riyadh_date(v_cn.issued_at), 'CREDIT_NOTE', v_num,
    format('ZATCA Credit Note %s vs %s (%s)', v_num, inv.invoice_number, inv.client_name),
    jsonb_build_array(
      jsonb_build_object('account_code', '4090', 'debit', v_sub, 'memo', coalesce(p_reason, p_reason_code)),
      jsonb_build_object('account_code', '2100', 'debit', v_vat, 'memo', 'VAT Reversal 15%'),
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
-- 8. Privileges
-- ---------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['public._invoice_sync(text)', 'public._invoice_credited_qty(text)', 'public._customer_credit(text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.post_receipt(text, numeric, text, text, date, jsonb)', 'public.post_customer_receipt(text, numeric, text, text, date)',
    'public.apply_customer_credit(text, numeric, date)', 'public.post_customer_refund(text, numeric, text, text, text, date)',
    'public.post_credit_note(text, jsonb, text, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- The app reads already-credited quantities to cap the credit note form
create or replace function public.invoice_credited_qty(p_invoice_id text) returns numeric[]
language sql stable security definer set search_path = public as $$
  select case when public.has_role('admin','ceo','finance','manager') or public.invoice_owned(p_invoice_id)
              then public._invoice_credited_qty(p_invoice_id) end
$$;
revoke all on function public.invoice_credited_qty(text) from public, anon;
grant execute on function public.invoice_credited_qty(text) to authenticated;

notify pgrst, 'reload schema';

commit;
