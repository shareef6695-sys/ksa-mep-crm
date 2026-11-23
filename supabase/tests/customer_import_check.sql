-- =====================================================================
-- customer_import_check.sql — proves 0018. LOCAL TEST DATABASE ONLY.
-- Order: any full chain up to 0018 (run_sql_tests.sh runs it after billing_check). Prints "CUSTOMER IMPORT OK".
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

select pg_temp.as_user(null);
reset role;
insert into public.customers (id, customer_code, name_en, customer_type, vat_number)
values ('cust-imp-existing', 'CUST-IMP-0', 'Existing Trading Co.', 'B2B', '300777777700003') on conflict (id) do nothing;
set role authenticated;

-- sales cannot bulk import
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.expect_error($$select public.import_customers('[{"name_en":"X"}]')$$, 'Only Admin', 'sales blocked');

-- finance can
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
create temp table imp_rows as select $j$[
  {"row": 2, "name_en": "Sample Contracting Co", "vat_number": "300000000000013", "city": "Jeddah", "payment_terms": "Net 30", "email": "A@SAMPLE.TEST "},
  {"row": 3, "name_en": "Cash", "customer_type": "B2C", "payment_terms": "Advance / Cash"},
  {"row": 4, "name_en": "  ", "vat_number": ""},
  {"row": 5, "name_en": "Bad VAT Co", "vat_number": "12345"},
  {"row": 6, "name_en": "existing trading co", "vat_number": ""},
  {"row": 7, "name_en": "Other Name Same VAT", "vat_number": "300777777700003"},
  {"row": 8, "name_en": "Sample Contracting Co.", "vat_number": ""},
  {"row": 9, "name_en": "Example Trading Qatar", "country": "qa", "city": "Doha", "credit_limit_sar": "-5"}
]$j$::jsonb as j;
grant select on imp_rows to authenticated;

-- dry run inserts nothing
select pg_temp.expect((select (public.import_customers(j, true)->>'inserted')::int = 0 from imp_rows), 'dry run inserts nothing');
select pg_temp.expect((select count(*) from public.customers where name_en = 'Sample Contracting Co') = 0, 'still none after dry run');

create temp table imp_res as select public.import_customers(j) as r from imp_rows;
grant select on imp_res to authenticated;
select pg_temp.expect((select (r->>'inserted')::int = 3 and (r->>'skipped')::int = 3 and (r->>'rejected')::int = 2 from imp_res),
  'inserted 3 (Sample, Cash, Example), skipped 3 (existing name, existing VAT, duplicate in file), rejected 2 (no name, bad VAT)');
select pg_temp.expect((select x->>'reason' from imp_res, jsonb_array_elements(r->'results') x where (x->>'row')::int = 8) ilike '%earlier in this file%',
  '"Sample Contracting Co." is the same name as row 2');
select pg_temp.expect((select x->>'reason' from imp_res, jsonb_array_elements(r->'results') x where (x->>'row')::int = 7) ilike '%VAT 300777777700003 already exists in the ERP%',
  'same VAT as an existing customer');

reset role;
select pg_temp.expect((select customer_code like 'CUST-%' and email = 'a@sample.test' and customer_type = 'B2B' and assigned_salesman_id is null
                       and payment_terms = 'Net 30' from public.customers where name_en = 'Sample Contracting Co'), 'Sample Contracting Co saved with a CUST code, cleaned email');
select pg_temp.expect((select customer_type = 'B2C' and vat_number is null from public.customers where name_en = 'Cash'), 'Cash is B2C without VAT');
select pg_temp.expect((select country = 'QA' and credit_limit_sar = 0 from public.customers where name_en = 'Example Trading Qatar'), 'country upper-cased, negative credit limit -> 0');
select pg_temp.expect((select count(distinct customer_code) = 3 from public.customers where name_en in ('Sample Contracting Co', 'Cash', 'Example Trading Qatar')), 'distinct codes');
set role authenticated;

-- importing the same file again adds nothing
select pg_temp.expect((select (public.import_customers(j)->>'inserted')::int = 0 from imp_rows), 're-import is a no-op');

select pg_temp.as_user(null);
reset role;
select 'CUSTOMER IMPORT OK';
