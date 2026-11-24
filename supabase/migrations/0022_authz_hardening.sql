-- =====================================================================
-- 0022_authz_hardening.sql — findings of the authorization / input audit (security check 4)
-- ---------------------------------------------------------------------
-- 1. Sign-out takes effect at once. Supabase access tokens stay valid until they expire (up to an hour) even after
--    sign-out. app_role() — behind every has_role / RLS check — now also requires the token's session to still exist
--    in auth.sessions, so a signed-out (or revoked) token is refused immediately. Tokens with no session_id (service
--    role, scheduled jobs, maintenance) are unaffected.
-- 2. Document numbers. next_doc_number() could be called by any signed-in user with any type: a salesman could burn
--    invoice numbers (gaps in the ZATCA sequence) or create junk number ranges. It is now server-only; the app uses
--    next_master_code() for the five codes it numbers itself (customer, vendor, goods, service, inquiry), each limited
--    to the roles that may create that record.
-- 3. credit_status() (IDOR): any user could read any customer's open AR, open orders and credit limit. Sales roles
--    now see only customers assigned to them or on their own quotes.
-- 4. Company logo (the only file the app stores): the database now accepts only PNG / JPEG / WebP / SVG images as a
--    data: URL of at most ~1 MB, whoever writes it.
-- 5. Function privileges: PostgreSQL lets PUBLIC (so also anon) execute new functions. Every security-definer
--    function in public loses PUBLIC / anon; signed-in users keep exactly the functions they could already call;
--    trigger functions are callable by nobody (triggers still fire). Browsers without a session can call none.
-- Idempotent.
-- =====================================================================
begin;

-- ---------------------------------------------------------------- 1. session must still exist
create or replace function public._session_live() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
  v_sid text;
begin
  if v_claims is null then return true; end if;
  v_sid := nullif(v_claims::jsonb->>'session_id', '');
  if v_sid is null then return true; end if;                 -- service role / cron / maintenance: no session
  return exists (select 1 from auth.sessions s
                 where s.id = v_sid::uuid and (s.not_after is null or s.not_after > now()));
exception
  when invalid_text_representation then return false;        -- a malformed session id is never live
end $$;

create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.user_roles where user_id = auth.uid() and active and public._session_live()
$$;

-- ---------------------------------------------------------------- 2. document numbers
create or replace function public.next_master_code(p_doc_type text) returns text
language plpgsql security definer set search_path = public as $$
declare v_type text := upper(trim(coalesce(p_doc_type, '')));
begin
  case v_type
    when 'CUSTOMER' then perform public._require_role('admin', 'ceo', 'manager', 'finance', 'sales_mep', 'sales_it');
    when 'INQUIRY' then perform public._require_role('admin', 'ceo', 'manager', 'sales_mep', 'sales_it');
    when 'VENDOR' then perform public._require_role('admin', 'ceo', 'finance', 'procurement');
    when 'ITEM_GOODS', 'ITEM_SERVICE' then perform public._require_role('admin', 'ceo', 'finance', 'manager', 'procurement');
    else raise exception 'Codes of type % are issued by the server only.', v_type using errcode = '42501';
  end case;
  return public.next_doc_number(v_type);
end $$;

-- ---------------------------------------------------------------- 3. credit_status: own customers only for sales
create or replace function public._may_see_customer(p_customer_id text, p_client_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select not public.is_sales()
      or exists (select 1 from public.customers c
                 where c.assigned_salesman_id = public.uid_text()
                   and (c.id = p_customer_id or (p_customer_id is null and lower(c.name_en) = lower(trim(p_client_name)))))
      or exists (select 1 from public.inquiries q
                 where q.data->>'salesmanId' = public.uid_text()
                   and ((p_customer_id is not null and q.data->>'customerId' = p_customer_id)
                        or (p_customer_id is null and lower(q.data->>'clientName') = lower(trim(p_client_name)))))
$$;

create or replace function public.credit_status(p_customer_id text, p_client_name text default null, p_new_amount numeric default 0)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e jsonb;
begin
  if not public.has_any_role() then raise exception 'Not allowed.'; end if;
  if not public._may_see_customer(nullif(p_customer_id, ''), p_client_name) then
    raise exception 'You can only check credit for your own customers.' using errcode = '42501';
  end if;
  e := public._customer_exposure(p_customer_id, p_client_name);
  return e || jsonb_build_object('available', case when public._num(e->'creditLimit') > 0 then public._r2(public._num(e->'creditLimit') - public._num(e->'openAr') - public._num(e->'openOrders')) end,
                                 'problems', to_jsonb(public._credit_problems(e, p_new_amount)));
end $$;

-- ---------------------------------------------------------------- 4. company logo
create or replace function public._check_company_profile() returns trigger
language plpgsql set search_path = public as $$
declare v_logo text;
begin
  if new.key = 'company_profile' and jsonb_typeof(new.value) = 'object' then
    v_logo := nullif(new.value->>'logoUrl', '');
    if v_logo is not null then
      if v_logo !~ '^data:image/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$' then
        raise exception 'The company logo must be a PNG, JPEG, WebP or SVG image.' using errcode = '22023';
      end if;
      if length(v_logo) > 1400000 then
        raise exception 'The company logo is too large (max 1 MB).' using errcode = '22023';
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_check_company_profile on public.app_settings;
create trigger trg_check_company_profile before insert or update on public.app_settings
  for each row execute function public._check_company_profile();

-- ---------------------------------------------------------------- 5. function privileges
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.prorettype = 'trigger'::regtype as is_trigger,
           has_function_privilege('authenticated', p.oid, 'execute') as auth_had
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.is_trigger then
      execute format('revoke execute on function %s from authenticated', f.sig);
    elsif f.auth_had then
      -- keep exactly what signed-in users could already call (it came through PUBLIC before)
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
-- server-only
revoke execute on function public.next_doc_number(text) from authenticated;
grant execute on function public.next_doc_number(text) to service_role;
revoke execute on function public._zatca_doc_set(text, text, text, jsonb) from authenticated;
-- the new trigger function is not security definer; keep it off the API too
revoke execute on function public._check_company_profile() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
