-- Optional: send the reminders every morning at 09:00 Riyadh (06:00 UTC) — Prompt 15.
-- Needs pg_cron + pg_net (Database -> Extensions), the notify function deployed, and the NOTIFY_CRON_SECRET secret.
-- The cron secret is read from Supabase Vault at run time, so it never appears in the job definition. Once, in the
-- SQL Editor (paste the SAME value you set as the NOTIFY_CRON_SECRET function secret, then clear the editor):
--   select vault.create_secret('<NOTIFY_CRON_SECRET>', 'notify_cron_secret');
-- Replace <PROJECT_REF> and <ANON_KEY> (the public anon key, needed to pass the gateway) below.
-- Turn reminders on in Settings -> Notifications.
select cron.schedule('erp-reminders', '0 6 * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', '<ANON_KEY>',
                                  'Authorization', 'Bearer <ANON_KEY>',
                                  'x-notify-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'notify_cron_secret')),
    body := '{}'::jsonb)
$$);
-- To stop:  select cron.unschedule('erp-reminders');
