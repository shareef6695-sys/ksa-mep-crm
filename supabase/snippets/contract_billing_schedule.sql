-- Optional: make contract billing drafts every morning (06:00 Riyadh = 03:00 UTC) — migration 0014.
-- Run once in the SQL editor after enabling the pg_cron extension (Database -> Extensions).
-- The job runs as the database owner, so generate_contract_drafts() needs no user role. It only makes DRAFTS:
-- Finance still reviews and posts each invoice from Service Contracts -> Billing drafts.
select cron.schedule('contract-billing-drafts', '0 3 * * *', $$select public.generate_contract_drafts()$$);

-- Optional, if Finance wants deferred revenue recognised automatically on the 1st of each month for the month before
-- (otherwise use the "Deferred revenue" tab):
-- select cron.schedule('deferred-revenue-recognition', '30 3 1 * *',
--   $$select public.recognize_deferred_revenue((date_trunc('month', now() at time zone 'Asia/Riyadh') - interval '1 day')::date)$$);

-- To stop:  select cron.unschedule('contract-billing-drafts');
