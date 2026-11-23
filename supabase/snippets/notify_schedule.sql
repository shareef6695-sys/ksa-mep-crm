-- Optional: send the reminders every morning at 09:00 Riyadh (06:00 UTC) — Prompt 15.
-- Needs pg_cron + pg_net (Database -> Extensions), the notify function deployed, and the NOTIFY_CRON_SECRET secret.
-- Replace <PROJECT_REF>, <ANON_KEY> and <NOTIFY_CRON_SECRET> before running. Turn reminders on in Settings -> Notifications.
select cron.schedule('erp-reminders', '0 6 * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', '<ANON_KEY>',
                                  'Authorization', 'Bearer <ANON_KEY>', 'x-notify-cron', '<NOTIFY_CRON_SECRET>'),
    body := '{}'::jsonb)
$$);
-- To stop:  select cron.unschedule('erp-reminders');
