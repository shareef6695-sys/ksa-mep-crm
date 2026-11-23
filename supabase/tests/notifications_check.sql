-- =====================================================================
-- notifications_check.sql — proves 0015. LOCAL TEST DATABASE ONLY.
-- Order: any full chain up to 0015 (run_sql_tests.sh runs it after projects_check). Prints "NOTIFICATIONS OK".
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

-- phone numbers
select pg_temp.expect(public._e164('0551234567') = '+966551234567' and public._e164('+966 55 123 4567') = '+966551234567'
                      and public._e164('551234567') = '+966551234567' and public._e164('12') is null, 'E.164 normalisation');

-- users cannot read the queue (customer contacts) or write the log
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
set role authenticated;
select pg_temp.expect_error($$select public.notification_queue()$$, 'permission denied', 'finance cannot call the queue directly');
reset role;
select pg_temp.as_user(null);

-- data: one invoice 7 days overdue, one 3 days overdue (not a reminder day), contacts on the customer
insert into public.customers (id, name_en, email, whatsapp) values ('cust-ntf', 'Reminder Test Co', 'ap@reminder.test', '0551234567') on conflict (id) do nothing;
insert into public.invoices (id, invoice_number, client_name, customer_id, grand_total_sar, paid_amount_sar, due_date, issued_at, items, salesman_id)
values ('inv-ntf-7', 'INV-NTF-7', 'Reminder Test Co', 'cust-ntf', 1150, 150, public._riyadh_today() - 7, now() - interval '37 days', '[]', '00000000-0000-0000-0000-0000000000c1'),
       ('inv-ntf-3', 'INV-NTF-3', 'Reminder Test Co', 'cust-ntf', 500, 0, public._riyadh_today() - 3, now() - interval '33 days', '[]', null);

select pg_temp.expect(jsonb_array_length(public.notification_queue()) = 0, 'nothing while notifications are disabled');
update public.app_settings set value = value || '{"enabled": true, "whatsapp": true}' where key = 'notification_settings';

create temp table q1 as select x from jsonb_array_elements(public.notification_queue()) x;
select pg_temp.expect((select count(*) from q1 where x->>'refId' = 'inv-ntf-7') = 2, 'day-7 reminder by email and WhatsApp');
select pg_temp.expect((select count(*) from q1 where x->>'refId' = 'inv-ntf-3') = 0, 'day 3 is not a reminder day');
select pg_temp.expect((select (x->>'openSar')::numeric from q1 where x->>'refId' = 'inv-ntf-7' and x->>'channel' = 'email') = 1000, 'open amount');
select pg_temp.expect((select x->>'to' from q1 where x->>'refId' = 'inv-ntf-7' and x->>'channel' = 'whatsapp') = '+966551234567', 'WhatsApp in E.164');
select pg_temp.expect((select x->>'cc' from q1 where x->>'refId' = 'inv-ntf-7' and x->>'channel' = 'email') = 'sales1@test', 'salesman copied');
-- repeat schedule: 30 + 14 = day 44
select pg_temp.expect(exists (select 1 from jsonb_array_elements(public.notification_queue(public._riyadh_today() + 37)) x where x->>'refId' = 'inv-ntf-7'), 'repeats every 14 days after the last reminder day');

-- logged messages are not sent again the same day (failed ones are retried)
select public.record_notification('{"kind":"overdue_invoice","channel":"email","to":"ap@reminder.test","refId":"inv-ntf-7","status":"sent","provider":"test"}');
select public.record_notification('{"kind":"overdue_invoice","channel":"whatsapp","to":"+966551234567","refId":"inv-ntf-7","status":"failed","error":"x"}');
select pg_temp.expect((select count(*) from jsonb_array_elements(public.notification_queue()) x where x->>'refId' = 'inv-ntf-7') = 1, 'sent email not repeated, failed WhatsApp retried');

-- approval digest: a PO waiting for manager approval reaches the manager
insert into public.purchase_orders (id, po_number, supplier_name, status, approval_level, items, total_landed_sar, input_vat_sar)
values ('po-ntf', 'PO-NTF-1', 'Digest Supplier', 'pending_approval', 'manager', '[]', 30000, 4500);
select pg_temp.expect(exists (
  select 1 from jsonb_array_elements(public.notification_queue()) x, jsonb_array_elements(x->'items') i
  where x->>'kind' = 'approval_digest' and x->>'to' = 'manager@test' and i->>'ref' = 'PO-NTF-1'), 'manager digest lists the PO');

update public.app_settings set value = value || '{"enabled": false, "whatsapp": false}' where key = 'notification_settings';
select 'NOTIFICATIONS OK';
