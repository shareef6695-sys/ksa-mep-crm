-- =====================================================================
-- authz_check.sql — proves 0022. LOCAL TEST DATABASE ONLY. Invented data. Prints "AUTHZ OK".
-- Order: full chain up to 0022 with the rls_check seed users (sales1 = c1, sales2 = c2).
-- =====================================================================
create or replace function pg_temp.as_user(p_uid text, p_session text default null) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', case when p_uid is null then '' else
  json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', p_session)::text end, false); end $$;
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
grant execute on all functions in schema pg_temp to authenticated, anon;

insert into auth.sessions (id, user_id) values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000c1')
on conflict (id) do nothing;
insert into public.customers (id, name_en, assigned_salesman_id) values ('cust-az1', 'Authz One Trading', '00000000-0000-0000-0000-0000000000c1')
on conflict (id) do nothing;

set role authenticated;

-- 1. a signed-out session is refused at once; a live one works; tokens without a session id are unaffected
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111');
select pg_temp.expect(public.app_role() = 'sales_mep', 'live session keeps its role');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1', '22222222-2222-2222-2222-222222222222');
select pg_temp.expect(public.app_role() is null, 'signed-out session has no role');
select pg_temp.expect(not public.has_any_role(), 'signed-out session fails every role check');
select pg_temp.expect((select count(*) from public.customers) = 0, 'signed-out session reads nothing');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1', 'not-a-uuid');
select pg_temp.expect(public.app_role() is null, 'malformed session id has no role');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.expect(public.app_role() = 'sales_mep', 'token without a session id (service / tests) unaffected');

-- 2. document numbers: server only; master codes by role
select pg_temp.expect_error($$select public.next_doc_number('INVOICE')$$, 'permission denied', 'browser cannot draw invoice numbers');
select pg_temp.expect(public.next_master_code('customer') like 'CUST-%', 'sales can number a new customer');
select pg_temp.expect(public.next_master_code('INQUIRY') is not null, 'sales can number a new inquiry');
select pg_temp.expect_error($$select public.next_master_code('VENDOR')$$, 'cannot do this', 'sales cannot number vendors');
select pg_temp.expect_error($$select public.next_master_code('INVOICE')$$, 'server only', 'invoice numbers are server-only');
select pg_temp.expect_error($$select public.next_master_code('ZZZ_JUNK')$$, 'server only', 'no junk number ranges');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select pg_temp.expect(public.next_master_code('VENDOR') like 'VEND-%', 'procurement numbers vendors');

-- 3. credit_status: a salesman sees only own customers / customers on own quotes
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.expect(public.credit_status('cust-az1', null, 0) ? 'openAr', 'own customer: allowed');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select pg_temp.expect_error($$select public.credit_status('cust-az1', null, 0)$$, 'own customers', 'other salesman''s customer: refused');
select pg_temp.expect_error($$select public.credit_status(null, 'Authz One Trading', 0)$$, 'own customers', 'by name: refused too');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select pg_temp.expect(public.credit_status('cust-az1', null, 0) ? 'openAr', 'finance sees every customer');

-- 4. company logo: images only, 1 MB max (checked in the database, whoever writes)
reset role;
select pg_temp.expect_error($$insert into public.app_settings (key, value) values ('company_profile', '{"logoUrl":"data:text/html;base64,PHNjcmlwdD4="}')
  on conflict (key) do update set value = excluded.value$$, 'must be a PNG', 'HTML file refused');
select pg_temp.expect_error($$insert into public.app_settings (key, value) values ('company_profile', '{"logoUrl":"javascript:alert(1)"}')
  on conflict (key) do update set value = excluded.value$$, 'must be a PNG', 'javascript: refused');
select pg_temp.expect_error(format($$insert into public.app_settings (key, value) values ('company_profile', jsonb_build_object('logoUrl', 'data:image/png;base64,' || %L))
  on conflict (key) do update set value = excluded.value$$, repeat('A', 1500000)), 'too large', 'over 1 MB refused');
insert into public.app_settings (key, value) values ('company_profile', '{"companyName":"Test","logoUrl":"data:image/png;base64,iVBORw0KGgo="}')
  on conflict (key) do update set value = excluded.value;
select pg_temp.expect((select value->>'logoUrl' from public.app_settings where key = 'company_profile') like 'data:image/png%', 'a PNG is accepted');

-- 5. privileges: anon can call no definer function; trigger functions are callable by nobody
select pg_temp.expect(not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
  and has_function_privilege('anon', p.oid, 'execute')), 'anon executes no security-definer function');
select pg_temp.expect(not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
  and p.prorettype = 'trigger'::regtype and has_function_privilege('authenticated', p.oid, 'execute')), 'no trigger function on the API');
select pg_temp.expect(has_function_privilege('authenticated', 'public.post_invoice(text)', 'execute'), 'signed-in users keep their functions');
select pg_temp.expect(not has_function_privilege('authenticated', 'public.hit_rate_limit(text,integer,integer)', 'execute'), 'rate limiter stays server-only');

select 'AUTHZ OK' as result;
