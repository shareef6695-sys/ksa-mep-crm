-- =====================================================================
-- 0021_rate_limits.sql — rate limiting for server-side actions
-- ---------------------------------------------------------------------
-- Sign-in and sign-up are limited by Supabase Auth itself (Authentication -> Rate Limits). The actions the app runs
-- through its own Edge Functions are limited here, e.g. admin-users: 3 password resets per account per hour.
--
-- hit_rate_limit(p_bucket, p_max, p_window_seconds) -> boolean
--   Counts one attempt in the bucket and returns true while the bucket holds at most p_max attempts in the last
--   p_window_seconds; false (and nothing counted) once the limit is used up. Atomic per bucket (advisory lock).
--   Service role only: the Edge Functions call it; browsers cannot.
-- Idempotent.
-- =====================================================================
begin;

create table if not exists public.rate_limit_events (
  id      bigserial primary key,
  bucket  text not null,
  at      timestamptz not null default now()
);
create index if not exists rate_limit_events_bucket_at on public.rate_limit_events (bucket, at);
create index if not exists rate_limit_events_at on public.rate_limit_events (at);
alter table public.rate_limit_events enable row level security;
revoke all on public.rate_limit_events from public, anon, authenticated;

create or replace function public.hit_rate_limit(p_bucket text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  if coalesce(p_bucket, '') = '' or p_max is null or p_max < 1 or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'hit_rate_limit: bucket, max >= 1 and window >= 1 second are required.';
  end if;
  perform pg_advisory_xact_lock(hashtext('rate:' || p_bucket));
  delete from rate_limit_events where at < now() - interval '1 day';  -- housekeeping, cheap with the index on at
  select count(*) into n from rate_limit_events
    where bucket = p_bucket and at > now() - make_interval(secs => p_window_seconds);
  if n >= p_max then
    return false;
  end if;
  insert into rate_limit_events (bucket) values (p_bucket);
  return true;
end $$;

revoke all on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;

notify pgrst, 'reload schema';
commit;
