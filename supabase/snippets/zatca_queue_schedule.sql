-- =====================================================================
-- Optional: send waiting ZATCA documents every 15 minutes (B2C must be reported within 24 hours).
-- Not a migration: it holds a secret. Run it once in the Supabase SQL Editor AFTER
--   1. enabling the pg_cron and pg_net extensions (Database -> Extensions),
--   2. deploying the `zatca` Edge Function and setting its ZATCA_CRON_SECRET secret,
--   3. replacing <PROJECT_REF>, <ANON_KEY> (the public anon key, needed to pass the gateway) and <ZATCA_CRON_SECRET> below.
-- The function also runs right after each invoice / credit note / debit note is posted, and
-- Finance can press "Send queued documents now" on the ZATCA Phase 2 screen.
-- =====================================================================
select cron.unschedule('zatca-queue') where exists (select 1 from cron.job where jobname = 'zatca-queue');
select cron.schedule('zatca-queue', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/zatca',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <ANON_KEY>', 'x-zatca-cron', '<ZATCA_CRON_SECRET>'),
    body := jsonb_build_object('action', 'process_queue', 'limit', 50),
    timeout_milliseconds := 120000
  );
$$);
-- check:  select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'zatca-queue') order by start_time desc limit 5;
