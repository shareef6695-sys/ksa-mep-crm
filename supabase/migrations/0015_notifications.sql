-- =====================================================================
-- 0015_notifications.sql — email / WhatsApp reminders (Prompt 15)
--
--  * app_settings.notification_settings: enabled, channels, overdue reminder days, repeat, approval digest.
--  * notification_queue(): what should go out today — payment reminders for overdue invoices (to the customer,
--    optionally copied to the salesman) and one daily digest per approver of what is waiting for them
--    (quote approvals, PO approvals, contract billing drafts, contract renewals). Never repeats a message on the same day.
--  * record_notification(): the Edge Function `notify` logs every message (sent / failed / dry_run) in notification_log.
--  Both are for the service role only: the Edge Function runs them; nobody reads customers' contacts through them.
--
-- Run after 0014 (and before 0005 when 0005 is used). Re-runnable.
-- =====================================================================
begin;

insert into public.app_settings (key, value)
values ('notification_settings', '{"enabled": false, "email": true, "whatsapp": false, "overdueDays": [1, 7, 14, 30], "repeatEveryDays": 14,
                                   "copySalesman": true, "approvalDigest": true}')
on conflict (key) do nothing;

create or replace function public._notification_settings() returns jsonb
language sql stable security definer set search_path = public as $$
  select '{"enabled": false, "email": true, "whatsapp": false, "overdueDays": [1, 7, 14, 30], "repeatEveryDays": 14,
           "copySalesman": true, "approvalDigest": true}'::jsonb
         || coalesce((select value from public.app_settings where key = 'notification_settings' and jsonb_typeof(value) = 'object'), '{}'::jsonb)
$$;

create table if not exists public.notification_log (
  id           bigserial primary key,
  kind         text not null check (kind in ('overdue_invoice','approval_digest')),
  channel      text not null check (channel in ('email','whatsapp')),
  recipient    text not null,
  ref_id       text not null,             -- invoice id, or the approver's user id for digests
  subject      text not null default '',
  body         text not null default '',
  status       text not null check (status in ('sent','failed','dry_run','skipped')),
  provider     text,
  provider_id  text,
  error        text,
  sent_on      date not null default ((now() at time zone 'Asia/Riyadh')::date),
  created_at   timestamptz not null default now()
);
create index if not exists notification_log_ref_idx on public.notification_log (kind, ref_id, channel, sent_on);

-- KSA mobile numbers to E.164 (+9665XXXXXXXX); anything else is returned as digits with a leading +, or null
create or replace function public._e164(p text) returns text
language sql immutable as $$
  select case
    when d ~ '^9665\d{8}$' then '+' || d
    when d ~ '^05\d{8}$' then '+966' || substr(d, 2)
    when d ~ '^5\d{8}$' then '+966' || d
    when d ~ '^00\d{8,15}$' then '+' || substr(d, 3)
    when d ~ '^\d{10,15}$' then '+' || d
  end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

create or replace function public.notification_queue(p_today date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s jsonb := public._notification_settings(); v_today date := coalesce(p_today, public._riyadh_today()); v_out jsonb := '[]'::jsonb;
  v_days int[]; v_max int; v_rep int; c jsonb := public._company(); r record; a record; v_items jsonb;
begin
  if not public.is_maintenance_session() then
    raise exception 'notification_queue is for the notify Edge Function (service role) only.' using errcode = '42501';
  end if;
  if not coalesce((s->>'enabled')::boolean, false) then return v_out; end if;
  select coalesce(array_agg(x::int order by x::int), '{}') into v_days from jsonb_array_elements_text(coalesce(s->'overdueDays', '[]')) x;
  v_max := coalesce(v_days[array_upper(v_days, 1)], 0);
  v_rep := greatest(coalesce((s->>'repeatEveryDays')::int, 0), 0);

  -- 1. overdue invoices
  for r in
    select i.id, i.invoice_number, i.client_name, i.due_date, (v_today - i.due_date) as days_over,
           i.grand_total_sar + coalesce(i.debited_amount_sar, 0) - coalesce(i.paid_amount_sar, 0) - coalesce(i.credited_amount_sar, 0) as open_sar,
           cu.email as c_email, coalesce(nullif(cu.whatsapp, ''), cu.phone) as c_phone, tp.email as s_email
    from public.invoices i
    left join public.customers cu on cu.id = i.customer_id or (i.customer_id is null and lower(trim(cu.name_en)) = lower(trim(i.client_name)))
    left join public.team_profiles tp on tp.id::text = i.salesman_id
    where i.due_date is not null and i.due_date < v_today
      and i.grand_total_sar + coalesce(i.debited_amount_sar, 0) - coalesce(i.paid_amount_sar, 0) - coalesce(i.credited_amount_sar, 0) > 0.009
  loop
    continue when not (r.days_over = any (v_days) or (v_rep > 0 and r.days_over > v_max and (r.days_over - v_max) % v_rep = 0));
    v_items := jsonb_build_object('kind', 'overdue_invoice', 'refId', r.id, 'invoiceNumber', r.invoice_number, 'client', r.client_name,
                 'dueDate', r.due_date, 'daysOverdue', r.days_over, 'openSar', round(r.open_sar, 2), 'company', c->>'nameEn',
                 'companyAr', c->>'nameAr', 'bankIban', c->>'iban');
    if coalesce((s->>'email')::boolean, true) and coalesce(r.c_email, '') like '%@%'
       and not exists (select 1 from public.notification_log l where l.kind = 'overdue_invoice' and l.ref_id = r.id and l.channel = 'email' and l.sent_on = v_today and l.status <> 'failed') then
      v_out := v_out || jsonb_build_array(v_items || jsonb_build_object('channel', 'email', 'to', trim(r.c_email),
                 'cc', case when coalesce((s->>'copySalesman')::boolean, false) and coalesce(r.s_email, '') like '%@%' then r.s_email end));
    end if;
    if coalesce((s->>'whatsapp')::boolean, false) and public._e164(r.c_phone) is not null
       and not exists (select 1 from public.notification_log l where l.kind = 'overdue_invoice' and l.ref_id = r.id and l.channel = 'whatsapp' and l.sent_on = v_today and l.status <> 'failed') then
      v_out := v_out || jsonb_build_array(v_items || jsonb_build_object('channel', 'whatsapp', 'to', public._e164(r.c_phone)));
    end if;
  end loop;

  -- 2. one digest per approver of what is waiting for them
  if coalesce((s->>'approvalDigest')::boolean, true) then
    for a in
      select tp.id::text as uid, tp.full_name, tp.email, tp.phone, ur.role
      from public.user_roles ur join public.team_profiles tp on tp.id = ur.user_id
      where ur.active and ur.role in ('admin','ceo','manager','finance','sales_mep','sales_it')
    loop
      select coalesce(jsonb_agg(x), '[]'::jsonb) into v_items from (
        -- quotes waiting for a pricing approval (not the approver's own quote unless admin / ceo)
        select jsonb_build_object('type', 'quote_approval', 'ref', coalesce(q.data->>'refNo', q.id), 'text', coalesce(q.data->>'clientName', '')) as x
        from public.inquiries q
        where a.role in ('admin','ceo','manager') and coalesce(q.data->>'stage', '') not in ('won','lost')
          and not exists (select 1 from public.sales_orders so where so.inquiry_id = q.id)
          and (public._quote_approval(q.data)->>'needed')::boolean and not (public._quote_approval(q.data)->>'approved')::boolean
          and (a.role in ('admin','ceo') or coalesce(q.data->>'salesmanId', '') <> a.uid)
        union all
        select jsonb_build_object('type', 'po_approval', 'ref', po.po_number, 'text', po.supplier_name || ' SAR ' || to_char(po.total_landed_sar + po.input_vat_sar, 'FM999,999,990.00'))
        from public.purchase_orders po
        where po.status = 'pending_approval' and (a.role in ('admin','ceo') or (a.role = 'manager' and coalesce(po.approval_level, 'manager') = 'manager'))
        union all
        select jsonb_build_object('type', 'contract_draft', 'ref', k.contract_number, 'text', k.client_name || ' period ' || d.period_no || ' SAR ' || to_char(d.amount_sar, 'FM999,999,990.00'))
        from public.contract_billing_periods d join public.service_contracts k on k.id = d.contract_id
        where d.status = 'draft' and a.role in ('admin','ceo','finance')
        union all
        select jsonb_build_object('type', 'contract_renewal', 'ref', k.contract_number, 'text', k.client_name || ' ends ' || k.end_date)
        from public.service_contracts k
        where k.status = 'active' and k.renewed_to is null and k.end_date - v_today <= k.renewal_notice_days
          and (a.role in ('admin','ceo','manager') or (a.role in ('sales_mep','sales_it') and k.salesman_id = a.uid))
      ) t;
      continue when jsonb_array_length(v_items) = 0;
      if coalesce((s->>'email')::boolean, true) and coalesce(a.email, '') like '%@%'
         and not exists (select 1 from public.notification_log l where l.kind = 'approval_digest' and l.ref_id = a.uid and l.channel = 'email' and l.sent_on = v_today and l.status <> 'failed') then
        v_out := v_out || jsonb_build_array(jsonb_build_object('kind', 'approval_digest', 'refId', a.uid, 'channel', 'email', 'to', a.email,
                   'name', a.full_name, 'role', a.role, 'items', v_items, 'company', c->>'nameEn'));
      end if;
      if coalesce((s->>'whatsapp')::boolean, false) and public._e164(a.phone) is not null
         and not exists (select 1 from public.notification_log l where l.kind = 'approval_digest' and l.ref_id = a.uid and l.channel = 'whatsapp' and l.sent_on = v_today and l.status <> 'failed') then
        v_out := v_out || jsonb_build_array(jsonb_build_object('kind', 'approval_digest', 'refId', a.uid, 'channel', 'whatsapp', 'to', public._e164(a.phone),
                   'name', a.full_name, 'role', a.role, 'items', v_items, 'company', c->>'nameEn'));
      end if;
    end loop;
  end if;
  return v_out;
end $$;

-- p: {kind, channel, to, refId, subject, body, status, provider, providerId, error}
create or replace function public.record_notification(p jsonb) returns public.notification_log
language plpgsql security definer set search_path = public as $$
declare r public.notification_log;
begin
  if not public.is_maintenance_session() then
    raise exception 'record_notification is for the notify Edge Function (service role) only.' using errcode = '42501';
  end if;
  insert into public.notification_log (kind, channel, recipient, ref_id, subject, body, status, provider, provider_id, error)
  values (p->>'kind', p->>'channel', coalesce(p->>'to', ''), p->>'refId', coalesce(p->>'subject', ''), left(coalesce(p->>'body', ''), 4000),
          p->>'status', p->>'provider', p->>'providerId', left(p->>'error', 2000))
  returning * into r;
  return r;
end $$;

alter table public.notification_log enable row level security;
drop policy if exists notification_log_read on public.notification_log;
create policy notification_log_read on public.notification_log for select to authenticated using (public.has_role('admin','ceo','finance'));
revoke all on public.notification_log from anon, public;
grant select on public.notification_log to authenticated;
revoke insert, update, delete on public.notification_log from authenticated;

do $$
declare f text;
begin
  foreach f in array array['public._notification_settings()', 'public._e164(text)', 'public.notification_queue(date)', 'public.record_notification(jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
grant execute on function public.notification_queue(date) to service_role;
grant execute on function public.record_notification(jsonb) to service_role;

notify pgrst, 'reload schema';

commit;
