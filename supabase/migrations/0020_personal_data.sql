-- =====================================================================
-- 0020_personal_data.sql — personal data: least-privilege team directory + right-to-erasure
-- ---------------------------------------------------------------------
-- 1. team_profiles: every signed-in user could read every colleague's email, phone and commission rate.
--    Now the table is readable by admin / ceo / finance / manager, and by each user for their own row. Everyone
--    with a role reads public.team_profiles_v instead: names, roles, divisions and salesman flags for all,
--    email / phone / commission only for those four roles or for their own row.
-- 2. erase_personal_data(p_kind, p_id, p_reason, p_by) -> jsonb   (admin only; service role allowed for admin-users)
--    p_kind 'customer' | 'vendor' | 'team_member'. Removes the personal contact details (person names, phone,
--    WhatsApp, email) from the master record and from the open copies that repeat them (sales orders, quotes /
--    quote revisions, service tickets, purchase orders, reminder log), and redacts the same fields in the audit
--    trail. Kept on purpose, because Saudi VAT / ZATCA rules require invoices and accounting records to be kept:
--    legal / trade names, VAT and CR numbers, business addresses, document amounts, and names already printed on
--    posted documents. A team member is also deactivated; the admin-users function removes the login's email.
--    Every erasure is recorded in public.data_erasures (who, when, what kind, counts; no personal data).
-- has_role is called as has_role(variadic array[...]::text[]): bare literals do not resolve on every Postgres / SQL editor.
-- Idempotent.
-- =====================================================================
begin;

-- ---------------------------------------------------------------- 1. team directory
alter table public.team_profiles add column if not exists personal_data_erased_at timestamptz;
alter table public.customers     add column if not exists personal_data_erased_at timestamptz;
alter table public.vendors       add column if not exists personal_data_erased_at timestamptz;

create or replace function public.can_see_team_contacts() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role(variadic array['admin', 'ceo', 'finance', 'manager']::text[])
$$;

drop policy if exists team_profiles_read on public.team_profiles;
create policy team_profiles_read on public.team_profiles for select to authenticated
  using (public.can_see_team_contacts() or id = auth.uid());

create or replace view public.team_profiles_v with (security_barrier = true) as
  select t.id, t.full_name, t.role_key, t.role_label, t.division, t.is_salesman, t.active, t.created_at,
         t.personal_data_erased_at,
         case when public.can_see_team_contacts() or t.id = auth.uid() then t.email end          as email,
         case when public.can_see_team_contacts() or t.id = auth.uid() then t.phone end          as phone,
         case when public.can_see_team_contacts() or t.id = auth.uid() then t.commission_pct end as commission_pct
  from public.team_profiles t
  where public.has_any_role();
revoke all on public.team_profiles_v from anon, public;
grant select on public.team_profiles_v to authenticated;

-- ---------------------------------------------------------------- 2. erasure
create table if not exists public.data_erasures (
  id          bigserial primary key,
  kind        text not null check (kind in ('customer', 'vendor', 'team_member')),
  subject_id  text not null,
  reason      text,
  counts      jsonb not null default '{}'::jsonb,
  erased_by   uuid default auth.uid(),
  erased_at   timestamptz not null default now()
);
alter table public.data_erasures enable row level security;
revoke all on public.data_erasures from anon, authenticated;
grant select on public.data_erasures to authenticated;
drop policy if exists data_erasures_read on public.data_erasures;
create policy data_erasures_read on public.data_erasures for select to authenticated using (public.has_role(variadic array['admin', 'ceo']::text[]));

-- jsonb with the given keys set to '[REDACTED]' where they hold a value
create or replace function public._redact_keys(j jsonb, keys text[]) returns jsonb
language sql immutable set search_path = public as $$
  select case when j is null or jsonb_typeof(j) <> 'object' then j else
    j || coalesce((select jsonb_object_agg(k, '[REDACTED]') from unnest(keys) k
                   where j ? k and j->>k is not null and j->>k <> ''), '{}'::jsonb) end
$$;

-- same, also inside a nested "data" object (inquiries / quote_revisions keep the document in a data column)
create or replace function public._redact_row(j jsonb, keys text[]) returns jsonb
language sql immutable set search_path = public as $$
  select case when j is null or jsonb_typeof(j) <> 'object' then j
              when jsonb_typeof(j->'data') = 'object' then public._redact_keys(j, keys) || jsonb_build_object('data', public._redact_keys(j->'data', keys))
              else public._redact_keys(j, keys) end
$$;

drop function if exists public.erase_personal_data(text, text, text);
create or replace function public.erase_personal_data(p_kind text, p_id text, p_reason text default null, p_by uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  n int;
  c jsonb := '{}'::jsonb;
  v_inq text[];
  v_contact text[] := array['contact_person', 'phone', 'whatsapp', 'email', 'contact_name', 'contact_phone',
                            'supplier_email', 'supplier_phone', 'contactPerson', 'contactPhone', 'contactEmail'];
begin
  -- admin in the app; auth.uid() is null only for the service role (admin-users function) or a maintenance session
  if auth.uid() is not null and not public.has_role(variadic array['admin']::text[]) then
    raise exception 'Only a System Administrator can erase personal data.';
  end if;
  if p_kind not in ('customer', 'vendor', 'team_member') then raise exception 'Unknown kind "%".', p_kind; end if;
  if coalesce(trim(p_id), '') = '' then raise exception 'Choose the record to erase.'; end if;

  if p_kind = 'customer' then
    update customers set contact_person = null, phone = null, whatsapp = null, email = null,
                         personal_data_erased_at = now() where id = p_id;
    get diagnostics n = row_count;
    if n = 0 then raise exception 'Customer % not found.', p_id; end if;
    update sales_orders set contact_person = null, phone = null, email = null where customer_id = p_id;
    get diagnostics n = row_count; c := c || jsonb_build_object('sales_orders', n);
    select coalesce(array_agg(id), '{}') into v_inq from inquiries where data->>'customerId' = p_id;
    update inquiries set data = data || jsonb_build_object('contactPerson', '', 'phone', '', 'email', '')
      where id = any(v_inq);
    get diagnostics n = row_count; c := c || jsonb_build_object('quotes', n);
    update quote_revisions set data = data || jsonb_build_object('contactPerson', '', 'phone', '', 'email', '')
      where inquiry_id = any(v_inq) and jsonb_typeof(data) = 'object';
    update service_tickets set contact_name = null, contact_phone = null where customer_id = p_id;
    get diagnostics n = row_count; c := c || jsonb_build_object('service_tickets', n);
    update notification_log set recipient = '[REDACTED]', body = '[REDACTED]'
      where ref_id in (select id from invoices where customer_id = p_id);
    get diagnostics n = row_count; c := c || jsonb_build_object('reminders', n);
    update audit_log set old_row = _redact_row(old_row, v_contact), new_row = _redact_row(new_row, v_contact)
      where (table_name = 'customers' and row_id = p_id)
         or (table_name = 'sales_orders' and row_id in (select id::text from sales_orders where customer_id = p_id))
         or (table_name = 'service_tickets' and row_id in (select id::text from service_tickets where customer_id = p_id))
         or (table_name in ('inquiries', 'quote_revisions') and (row_id = any(v_inq) or new_row->>'inquiry_id' = any(v_inq) or old_row->>'inquiry_id' = any(v_inq)));
    get diagnostics n = row_count; c := c || jsonb_build_object('audit_entries', n);

  elsif p_kind = 'vendor' then
    update vendors set contact_person = null, phone = null, whatsapp = null, email = null,
                       personal_data_erased_at = now() where id = p_id;
    get diagnostics n = row_count;
    if n = 0 then raise exception 'Vendor % not found.', p_id; end if;
    update purchase_orders set supplier_email = null, supplier_phone = null where vendor_id = p_id;
    get diagnostics n = row_count; c := c || jsonb_build_object('purchase_orders', n);
    update audit_log set old_row = _redact_row(old_row, v_contact), new_row = _redact_row(new_row, v_contact)
      where (table_name = 'vendors' and row_id = p_id)
         or (table_name = 'purchase_orders' and row_id in (select id::text from purchase_orders where vendor_id = p_id));
    get diagnostics n = row_count; c := c || jsonb_build_object('audit_entries', n);

  else -- team_member
    if p_id = coalesce(auth.uid(), p_by)::text then raise exception 'You cannot erase your own account.'; end if;
    update team_profiles set full_name = 'Former user ' || left(p_id, 8), email = null, phone = null,
                             active = false, personal_data_erased_at = now()
      where id::text = p_id;
    get diagnostics n = row_count;
    if n = 0 then raise exception 'Team member % not found.', p_id; end if;
    update user_roles set active = false where user_id::text = p_id;
    update audit_log set old_row = _redact_row(old_row, array['email', 'phone', 'full_name']),
                         new_row = _redact_row(new_row, array['email', 'phone', 'full_name'])
      where table_name in ('team_profiles', 'user_roles') and row_id = p_id;
    get diagnostics n = row_count; c := c || jsonb_build_object('audit_entries', n);
  end if;

  -- p_by: the admin who asked, passed by admin-users (service role); a signed-in caller is always recorded as themselves
  insert into data_erasures (kind, subject_id, reason, counts, erased_by)
  values (p_kind, p_id, left(p_reason, 500), c, coalesce(auth.uid(), p_by));
  return jsonb_build_object('ok', true, 'kind', p_kind, 'id', p_id) || c;
end $$;

revoke all on function public.erase_personal_data(text, text, text, uuid) from public, anon;
grant execute on function public.erase_personal_data(text, text, text, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
