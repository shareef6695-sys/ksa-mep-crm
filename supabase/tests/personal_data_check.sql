-- =====================================================================
-- personal_data_check.sql — proves 0020. LOCAL TEST DATABASE ONLY. Invented data.
-- Order: a full chain up to 0020 with the rls_check seed users. Prints "PERSONAL DATA OK".
-- =====================================================================
create or replace function pg_temp.as_user(p_uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid)::text end, false); end $$;
create or replace function pg_temp.expect(cond boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'CHECK FAILED: %', msg; end if; end $$;
create or replace function pg_temp.expect_error(p_sql text, p_like text, msg text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'CHECK FAILED (no error): %', msg;
exception when others then
  if sqlerrm like 'CHECK FAILED%' then raise; end if;
  if sqlerrm not ilike '%' || p_like || '%' then raise exception 'CHECK FAILED (wrong error "%"): %', sqlerrm, msg; end if;
end $$;
grant execute on all functions in schema pg_temp to authenticated;

-- invented people
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e9', 'leaver@test') on conflict do nothing;
insert into public.team_profiles (id, email, full_name, phone, role_key, division, is_salesman, commission_pct, active)
values ('00000000-0000-0000-0000-0000000000e9', 'leaver@test', 'Leah Leaver', '0500000009', 'sales_mep', 'MEP', true, 7, true)
on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, phone = excluded.phone, active = true;
insert into public.user_roles (user_id, role, division, active) values ('00000000-0000-0000-0000-0000000000e9', 'sales_mep', 'MEP', true)
on conflict (user_id) do update set active = true;
insert into public.customers (id, name_en, vat_number, contact_person, phone, whatsapp, email, address, assigned_salesman_id)
values ('cust-pd', 'Privacy Test Trading', '300999999900003', 'Omar Example', '0501111111', '0501111111', 'omar@example.test',
        '1 Example St, Jeddah', '00000000-0000-0000-0000-0000000000c1')
on conflict (id) do nothing;
update public.customers set phone = '0502222222' where id = 'cust-pd';  -- makes an audit entry holding the phone
insert into public.sales_orders (id, so_number, salesman_id, client_name, customer_id, contact_person, phone, email, items, subtotal_sar, total_cost_sar)
values ('so-pd', 'SO-PD', '00000000-0000-0000-0000-0000000000c1', 'Privacy Test Trading', 'cust-pd', 'Omar Example', '0502222222',
        'omar@example.test', '[]', 0, 0) on conflict (id) do nothing;
insert into public.inquiries (id, data) values ('INQ-PD', '{"id":"INQ-PD","clientName":"Privacy Test Trading","customerId":"cust-pd",
  "contactPerson":"Omar Example","phone":"0502222222","email":"omar@example.test","salesmanId":"00000000-0000-0000-0000-0000000000c1","boqItems":[]}')
on conflict (id) do nothing;
insert into public.vendors (id, name_en, contact_person, phone, email, iban)
values ('vend-pd', 'Privacy Supplies', 'Vera Vendor', '0503333333', 'vera@example.test', 'SA0380000000608010167519')
on conflict (id) do nothing;

set role authenticated;

-- 1. team directory: a salesman sees names, not colleagues' contacts or commission
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.expect((select count(*) from public.team_profiles) = 1, 'sales reads only their own team_profiles row');
select pg_temp.expect((select email from public.team_profiles_v where id = '00000000-0000-0000-0000-0000000000c1') = 'sales1@test',
  'sales sees their own email');
select pg_temp.expect((select email is null and phone is null and commission_pct is null and full_name = 'Leah Leaver'
  from public.team_profiles_v where id = '00000000-0000-0000-0000-0000000000e9'), 'sales sees a colleague''s name only');
select pg_temp.expect((select count(*) from public.team_profiles_v) >= 7, 'sales still sees the whole directory');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select pg_temp.expect((select email = 'leaver@test' and commission_pct = 7 from public.team_profiles_v
  where id = '00000000-0000-0000-0000-0000000000e9'), 'finance sees contacts and commission');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select pg_temp.expect((select count(*) from public.team_profiles_v) = 0, 'a login with no role sees nobody');

-- 2. only an admin may erase
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select pg_temp.expect_error($$select public.erase_personal_data('customer', 'cust-pd', 'test')$$, 'Only a System Administrator', 'finance cannot erase');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_error($$select public.erase_personal_data('customer', 'nope', 'test')$$, 'not found', 'unknown customer');
select pg_temp.expect_error($$select public.erase_personal_data('team_member', '00000000-0000-0000-0000-0000000000a1', 'x')$$, 'own account', 'cannot erase yourself');

-- 3. customer
create temp table r_cust as select public.erase_personal_data('customer', 'cust-pd', 'Data subject request (test)') r;
grant select on r_cust to authenticated;
reset role;
select pg_temp.expect((select contact_person is null and phone is null and whatsapp is null and email is null
  and name_en = 'Privacy Test Trading' and vat_number = '300999999900003' and address is not null and personal_data_erased_at is not null
  from public.customers where id = 'cust-pd'), 'customer contacts erased; legal name, VAT and address kept');
select pg_temp.expect((select contact_person is null and phone is null and email is null from public.sales_orders where id = 'so-pd'),
  'sales order contact erased');
select pg_temp.expect((select data->>'contactPerson' = '' and data->>'email' = '' and data->>'clientName' = 'Privacy Test Trading'
  from public.inquiries where id = 'INQ-PD'), 'quote contact erased, client name kept');
select pg_temp.expect(not exists (select 1 from public.audit_log where table_name in ('customers', 'sales_orders', 'inquiries')
  and (coalesce(old_row::text, '') || coalesce(new_row::text, '')) ~ '(0501111111|0502222222|omar@example\.test|Omar Example)'),
  'no audit entry still holds the customer''s contact details');
select pg_temp.expect((select count(*) from public.data_erasures where kind = 'customer' and subject_id = 'cust-pd') = 1, 'erasure recorded');
select pg_temp.expect(not exists (select 1 from public.data_erasures where (reason || counts::text) ~ '(Omar|0501111111|omar@)'),
  'the erasure record holds no personal data');

-- 4. vendor
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.erase_personal_data('vendor', 'vend-pd', 'test');
reset role;
select pg_temp.expect((select contact_person is null and phone is null and email is null and iban is not null
  from public.vendors where id = 'vend-pd'), 'vendor contacts erased, IBAN kept for payables');
select pg_temp.expect(not exists (select 1 from public.audit_log where table_name = 'vendors' and row_id = 'vend-pd'
  and (coalesce(old_row::text, '') || coalesce(new_row::text, '')) ~ '(Vera Vendor|0503333333|vera@example)'), 'vendor audit redacted');

-- 5. team member (the login's email is changed by the admin-users function)
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.erase_personal_data('team_member', '00000000-0000-0000-0000-0000000000e9', 'left the company');
reset role;
select pg_temp.expect((select full_name like 'Former user %' and email is null and phone is null and not active
  from public.team_profiles where id = '00000000-0000-0000-0000-0000000000e9'), 'team member anonymised and deactivated');
select pg_temp.expect((select not active from public.user_roles where user_id = '00000000-0000-0000-0000-0000000000e9'), 'role deactivated');
select pg_temp.expect(not exists (select 1 from public.audit_log where table_name = 'team_profiles'
  and row_id = '00000000-0000-0000-0000-0000000000e9'
  and (coalesce(old_row::text, '') || coalesce(new_row::text, '')) ~ '(Leah Leaver|leaver@test|0500000009)'), 'team audit redacted');

-- 6. anon gets nothing
set role anon;
select pg_temp.expect_error($$select * from public.team_profiles_v$$, 'permission denied', 'anon cannot read the directory');
select pg_temp.expect_error($$select public.erase_personal_data('customer', 'cust-pd')$$, 'permission denied', 'anon cannot erase');
reset role;

select 'PERSONAL DATA OK' as result;
