-- =====================================================================
-- 0018_customer_import.sql — bulk customer import (Customers -> Import CSV)
-- ---------------------------------------------------------------------
-- import_customers(p_rows jsonb, p_dry_run boolean default false) -> jsonb
--   p_rows: array of customer objects using the customers column names
--           (name_en required; name_ar, customer_type B2B|B2C, vat_number, cr_number, contact_person, phone,
--            whatsapp, email, city, address_en, address_ar, building_no, street, district, postal_code,
--            additional_no, country, credit_limit_sar, payment_terms) plus an optional "row" number for the report.
--   Each row is inserted with the next CUSTOMER number (CUST-00001 ...), unassigned to a salesman.
--   Skipped (not an error for the batch): a row whose VAT number or name already exists in the ERP or earlier in
--   the same file. Rejected: missing name, VAT number not in KSA format (15 digits, 3...3).
--   p_dry_run = true checks everything and inserts nothing (the preview uses this).
--   Returns { inserted, skipped, rejected, results: [{row, name, status: inserted|skipped|rejected|ok, code?, reason?}] }
--   Who: admin, ceo, manager, finance. One transaction: all valid rows go in together.
-- Idempotent.
-- =====================================================================
begin;

create or replace function public._norm_customer_name(p text) returns text
language sql immutable as $$
  select regexp_replace(lower(coalesce(p, '')), '[^a-z0-9؀-ۿ]+', '', 'g')
$$;

create or replace function public.import_customers(p_rows jsonb, p_dry_run boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  i int := 0;
  v_row int;
  v_name text;
  v_vat text;
  v_type text;
  v_code text;
  v_seen_names text[] := '{}';
  v_seen_vats text[] := '{}';
  v_results jsonb := '[]'::jsonb;
  v_ins int := 0;
  v_skip int := 0;
  v_rej int := 0;
  v_reason text;
begin
  if not public.has_role('admin', 'ceo', 'manager', 'finance') then
    raise exception 'Only Admin, CEO, Manager or Finance can import customers.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'import_customers: p_rows must be a JSON array';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'import_customers: at most 5000 rows per import';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    i := i + 1;
    v_row := coalesce(nullif(r->>'row', '')::int, i);
    v_name := btrim(coalesce(r->>'name_en', ''));
    v_vat := nullif(regexp_replace(coalesce(r->>'vat_number', ''), '\s', '', 'g'), '');
    v_type := case when upper(coalesce(r->>'customer_type', '')) = 'B2C' then 'B2C' else 'B2B' end;
    v_reason := null;

    if v_name = '' then
      v_reason := 'Name is missing.';
    elsif v_vat is not null and not public.is_valid_ksa_vat(v_vat) then
      v_reason := format('VAT number %s is not a KSA VAT number (15 digits, starting and ending with 3).', v_vat);
    end if;
    if v_reason is not null then
      v_rej := v_rej + 1;
      v_results := v_results || jsonb_build_object('row', v_row, 'name', v_name, 'status', 'rejected', 'reason', v_reason);
      continue;
    end if;

    if v_vat is not null and (v_vat = any (v_seen_vats) or exists (select 1 from public.customers c where c.vat_number = v_vat)) then
      v_reason := format('A customer with VAT %s already exists%s.', v_vat, case when v_vat = any (v_seen_vats) then ' earlier in this file' else ' in the ERP' end);
    elsif public._norm_customer_name(v_name) = any (v_seen_names)
       or exists (select 1 from public.customers c where public._norm_customer_name(c.name_en) = public._norm_customer_name(v_name)) then
      v_reason := format('A customer named "%s" already exists%s.', v_name,
                         case when public._norm_customer_name(v_name) = any (v_seen_names) then ' earlier in this file' else ' in the ERP' end);
    end if;
    v_seen_names := v_seen_names || public._norm_customer_name(v_name);
    if v_vat is not null then v_seen_vats := v_seen_vats || v_vat; end if;
    if v_reason is not null then
      v_skip := v_skip + 1;
      v_results := v_results || jsonb_build_object('row', v_row, 'name', v_name, 'status', 'skipped', 'reason', v_reason);
      continue;
    end if;

    if p_dry_run then
      v_results := v_results || jsonb_build_object('row', v_row, 'name', v_name, 'status', 'ok');
      continue;
    end if;

    v_code := public.next_doc_number('CUSTOMER');
    insert into public.customers (id, customer_code, name_en, name_ar, customer_type, vat_number, cr_number, contact_person,
                                  phone, whatsapp, email, city, address, address_en, address_ar, building_no, street, district,
                                  postal_code, additional_no, country, credit_limit_sar, payment_terms, assigned_salesman_id)
    values ('cust-' || replace(gen_random_uuid()::text, '-', ''), v_code, v_name,
            nullif(btrim(r->>'name_ar'), ''), v_type, v_vat,
            nullif(btrim(r->>'cr_number'), ''), nullif(btrim(r->>'contact_person'), ''),
            nullif(btrim(r->>'phone'), ''), nullif(btrim(r->>'whatsapp'), ''), nullif(lower(btrim(r->>'email')), ''),
            nullif(btrim(r->>'city'), ''), nullif(btrim(r->>'address_en'), ''), nullif(btrim(r->>'address_en'), ''),
            nullif(btrim(r->>'address_ar'), ''), nullif(btrim(r->>'building_no'), ''), nullif(btrim(r->>'street'), ''),
            nullif(btrim(r->>'district'), ''), nullif(btrim(r->>'postal_code'), ''), nullif(btrim(r->>'additional_no'), ''),
            coalesce(nullif(upper(btrim(r->>'country')), ''), 'SA'),
            greatest(coalesce(nullif(r->>'credit_limit_sar', '')::numeric, 0), 0),
            coalesce(nullif(btrim(r->>'payment_terms'), ''), 'Net 30'),
            null);
    v_ins := v_ins + 1;
    v_results := v_results || jsonb_build_object('row', v_row, 'name', v_name, 'status', 'inserted', 'code', v_code);
  end loop;

  return jsonb_build_object('dryRun', p_dry_run, 'inserted', v_ins, 'skipped', v_skip, 'rejected', v_rej, 'results', v_results);
end $$;

revoke all on function public.import_customers(jsonb, boolean) from public, anon;
grant execute on function public.import_customers(jsonb, boolean) to authenticated;
revoke all on function public._norm_customer_name(text) from public, anon;

notify pgrst, 'reload schema';
commit;
