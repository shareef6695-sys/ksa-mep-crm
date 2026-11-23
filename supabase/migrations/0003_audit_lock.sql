-- =====================================================================
-- 0003_audit_lock.sql — audit trail, immutable posted documents,
-- period lock enforced in the database. Closes gaps S7, S8, A3.
-- ---------------------------------------------------------------------
-- Run AFTER 0002_roles_rls.sql. Idempotent; one transaction.
--
-- 1. AUDIT: every insert / update / delete on business tables is written to
--    public.audit_log (who, role, when, old row, new row, changed fields).
--    Rows also get created_by_uid / updated_by_uid (auth user ids).
--    Readable by admin, ceo, finance. Nobody can edit or delete it.
-- 2. IMMUTABLE POSTED DOCUMENTS (corrections = reversing documents):
--    * gl_journal_entries       posted entries: no update, no delete
--    * customer_receipts, supplier_payments, credit_notes: no update, no delete
--    * invoices: no delete; only paid_amount_sar / payment_status may change
--      (and grand_total_sar may go DOWN, for credit notes, until Prompt 6
--      stops credit notes from rewriting the invoice)
--    * expense_vouchers: no delete; the only allowed change is status posted -> void
--    * delivery_notes: no delete once invoiced
-- 3. PERIOD LOCK: public.gl_period_locks keeps the history of lock dates;
--    the newest row is the lock in force. Nothing dated on or before it can be
--    posted, changed or deleted, from any screen or the API:
--    gl_journal_entries.entry_date, invoices.issued_at, credit_notes.issued_at,
--    customer_receipts.received_at, supplier_payments.payment_date,
--    expense_vouchers.expense_date (dates taken in Asia/Riyadh time).
--    The app keeps writing app_settings 'gl_period_lock'; a trigger records each
--    change in gl_period_locks, and set_period_lock() does both.
--
-- Maintenance escape hatch: statements run with no signed-in user
-- (SQL Editor, service role) bypass rules 2 and 3 but are still audited.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Helpers
-- ---------------------------------------------------------------------
create or replace function public.is_maintenance_session() returns boolean
language sql stable as $$ select auth.uid() is null $$;

create or replace function public.riyadh_date(ts timestamptz) returns date
language sql immutable as $$ select (ts at time zone 'Asia/Riyadh')::date $$;

-- ---------------------------------------------------------------------
-- 1. Audit log
-- ---------------------------------------------------------------------
create table if not exists public.audit_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  table_name  text not null,
  row_id      text,
  action      text not null check (action in ('INSERT','UPDATE','DELETE')),
  user_id     uuid,
  user_role   text,
  changed     text[],          -- columns that changed (UPDATE)
  old_row     jsonb,
  new_row     jsonb
);
create index if not exists idx_audit_log_at      on public.audit_log (at desc);
create index if not exists idx_audit_log_table   on public.audit_log (table_name, row_id);
create index if not exists idx_audit_log_user    on public.audit_log (user_id, at desc);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log for select to authenticated using (public.has_role('admin','ceo','finance'));
-- no insert/update/delete policies: only the trigger (security definer) writes

-- TG_ARGV[0] = primary-key column; TG_ARGV[1..] = columns whose changes alone are not worth logging
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_changed text[];
  v_noise text[] := array['updated_at','updated_by_uid'] || coalesce(tg_argv[1:], array[]::text[]);
begin
  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into v_changed
    from jsonb_object_keys(v_new) k
    where v_new->k is distinct from v_old->k;
    if v_changed is null or v_changed <@ v_noise then
      return null;  -- nothing meaningful changed
    end if;
  end if;
  insert into public.audit_log (table_name, row_id, action, user_id, user_role, changed, old_row, new_row)
  values (tg_table_name, coalesce(v_new, v_old)->>tg_argv[0], tg_op, auth.uid(), public.app_role(), v_changed, v_old, v_new);
  return null;
end $$;

-- who created / last changed a row
create or replace function public.stamp_row_user() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_by_uid := coalesce(new.created_by_uid, auth.uid());
  else
    new.created_by_uid := old.created_by_uid;  -- can't be rewritten
  end if;
  new.updated_by_uid := auth.uid();
  return new;
end $$;

do $$
declare
  r record;
begin
  for r in select * from (values
      ('inquiries','id', null), ('app_settings','key', null), ('team_profiles','id', null), ('user_roles','user_id', null),
      ('customers','id', null), ('vendors','id', null), ('custom_uoms','code', null), ('items','id', null),
      ('sales_orders','id', null), ('delivery_notes','id', null), ('invoices','id', null),
      ('customer_receipts','id', null), ('credit_notes','id', null), ('commission_ledger','id', null),
      ('purchase_orders','id', null), ('supplier_payments','id', null), ('gl_accounts','account_code', null),
      ('gl_journal_entries','id', null), ('document_number_ranges','doc_type', array['next_number','last_reset_year']),
      ('expense_vouchers','id', null), ('fixed_assets','id', null), ('gl_budgets','id', null),
      ('bank_reconciliations','id', null)
    ) as t(tbl, pk, noise)
  loop
    execute format('alter table public.%I add column if not exists created_by_uid uuid', r.tbl);
    execute format('alter table public.%I add column if not exists updated_by_uid uuid', r.tbl);
    execute format('drop trigger if exists trg_stamp_row_user on public.%I', r.tbl);
    execute format('create trigger trg_stamp_row_user before insert or update on public.%I for each row execute function public.stamp_row_user()', r.tbl);
    execute format('drop trigger if exists trg_audit_row on public.%I', r.tbl);
    execute format('create trigger trg_audit_row after insert or update or delete on public.%I for each row execute function public.audit_row(%s)',
                   r.tbl, array_to_string(array[quote_literal(r.pk)] || coalesce((select array_agg(quote_literal(n)) from unnest(r.noise) n), array[]::text[]), ','));
  end loop;
end $$;

-- 0002's team_profiles guard must ignore the audit stamp columns added above
create or replace function public.team_profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_free text[] := array['full_name','phone','updated_at','updated_by_uid','created_by_uid'];
begin
  if public.has_role('admin') or auth.uid() is null then
    return new;  -- admin, or a migration / service-role call
  end if;
  if (to_jsonb(new) - v_free) is distinct from (to_jsonb(old) - v_free) then
    raise exception 'Only an administrator can change roles, division, commission or status.';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2. Period locks
-- ---------------------------------------------------------------------
create table if not exists public.gl_period_locks (
  id         bigserial primary key,
  lock_date  date,                         -- null = no lock (all periods open)
  reason     text,
  set_by     uuid default auth.uid(),
  set_at     timestamptz not null default now()
);
alter table public.gl_period_locks enable row level security;
revoke all on public.gl_period_locks from anon, authenticated;
grant select on public.gl_period_locks to authenticated;
drop policy if exists gl_period_locks_read on public.gl_period_locks;
create policy gl_period_locks_read on public.gl_period_locks for select to authenticated using (public.has_any_role());
drop trigger if exists trg_audit_row on public.gl_period_locks;
create trigger trg_audit_row after insert or update or delete on public.gl_period_locks
  for each row execute function public.audit_row('id');

-- seed from the current app setting (once)
insert into public.gl_period_locks (lock_date, reason, set_by)
select nullif(value->>'lockDate','')::date, 'Imported from app_settings by 0003', null
from public.app_settings
where key = 'gl_period_lock'
  and not exists (select 1 from public.gl_period_locks);

create or replace function public.current_lock_date() returns date
language sql stable security definer set search_path = public as $$
  select lock_date from public.gl_period_locks order by id desc limit 1
$$;
grant execute on function public.current_lock_date() to authenticated;

-- Change the lock (finance / admin / ceo). Also mirrors into app_settings for the app.
create or replace function public.set_period_lock(p_lock_date date, p_reason text default null) returns date
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('admin','ceo','finance') then
    raise exception 'Only Finance, CEO or Admin can change the period lock.';
  end if;
  insert into public.gl_period_locks (lock_date, reason) values (p_lock_date, p_reason);
  perform set_config('app.lock_sync', 'on', true);
  insert into public.app_settings (key, value, updated_at)
  values ('gl_period_lock', jsonb_build_object('lockDate', coalesce(p_lock_date::text, '')), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return p_lock_date;
end $$;
revoke all on function public.set_period_lock(date, text) from public, anon;
grant execute on function public.set_period_lock(date, text) to authenticated;

-- The app writes app_settings 'gl_period_lock' directly: record each change as a lock row
create or replace function public.app_settings_lock_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.key = 'gl_period_lock'
     and coalesce(current_setting('app.lock_sync', true), '') <> 'on'
     and (tg_op = 'INSERT' or new.value is distinct from old.value) then
    insert into public.gl_period_locks (lock_date, reason)
    values (nullif(new.value->>'lockDate','')::date, 'Set from Period Lock screen');
  end if;
  return new;
end $$;
drop trigger if exists trg_app_settings_lock_sync on public.app_settings;
create trigger trg_app_settings_lock_sync after insert or update on public.app_settings
  for each row execute function public.app_settings_lock_sync();

-- ---------------------------------------------------------------------
-- 3. Guards: period lock + immutability
--    TG_ARGV[0] = date column (or ''), TG_ARGV[1] = rule set
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
    v_allowed := v_allowed || array['paid_amount_sar','payment_status','grand_total_sar'];
    if (v_new->>'grand_total_sar')::numeric > (v_old->>'grand_total_sar')::numeric then
      raise exception 'Invoice % total cannot be increased after issue. Issue a debit note instead.', v_doc using errcode = 'P0001';
    end if;
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

do $$
declare r record;
begin
  for r in select * from (values
      ('gl_journal_entries', 'entry_date',   'gl',            'voucher_number'),
      ('invoices',           'issued_at',    'invoice',       'invoice_number'),
      ('credit_notes',       'issued_at',    'no_change',     'credit_note_number'),
      ('customer_receipts',  'received_at',  'no_change',     'receipt_number'),
      ('supplier_payments',  'payment_date', 'no_change',     'voucher_number'),
      ('expense_vouchers',   'expense_date', 'expense',       'voucher_number'),
      ('delivery_notes',     '',             'delivery_note', 'dn_number')
    ) as t(tbl, datecol, rule, label_col)
  loop
    execute format('drop trigger if exists trg_guard_posted_row on public.%I', r.tbl);
    execute format('create trigger trg_guard_posted_row before insert or update or delete on public.%I for each row execute function public.guard_posted_row(%L, %L, %L)',
                   r.tbl, r.datecol, r.rule, r.label_col);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
