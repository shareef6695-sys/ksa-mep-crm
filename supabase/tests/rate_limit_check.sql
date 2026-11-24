-- =====================================================================
-- rate_limit_check.sql — proves 0021. LOCAL TEST DATABASE ONLY. Prints "RATE LIMIT OK".
-- =====================================================================
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

delete from public.rate_limit_events where bucket like 'test:%';

-- 3 per hour: the 4th is refused and not counted; another bucket is independent
select pg_temp.expect(public.hit_rate_limit('test:reset:a', 3, 3600), 'attempt 1');
select pg_temp.expect(public.hit_rate_limit('test:reset:a', 3, 3600), 'attempt 2');
select pg_temp.expect(public.hit_rate_limit('test:reset:a', 3, 3600), 'attempt 3');
select pg_temp.expect(not public.hit_rate_limit('test:reset:a', 3, 3600), 'attempt 4 refused');
select pg_temp.expect((select count(*) from public.rate_limit_events where bucket = 'test:reset:a') = 3, 'refused attempt not counted');
select pg_temp.expect(public.hit_rate_limit('test:reset:b', 3, 3600), 'another account has its own limit');

-- attempts older than the window no longer count
update public.rate_limit_events set at = now() - interval '2 hours' where bucket = 'test:reset:a';
select pg_temp.expect(public.hit_rate_limit('test:reset:a', 3, 3600), 'window passed: allowed again');

select pg_temp.expect_error($$select public.hit_rate_limit('', 3, 60)$$, 'required', 'empty bucket rejected');

-- browsers cannot call it or read the events
set role authenticated;
select pg_temp.expect_error($$select public.hit_rate_limit('test:x', 3, 60)$$, 'permission denied', 'authenticated cannot call');
select pg_temp.expect_error($$select count(*) from public.rate_limit_events$$, 'permission denied', 'authenticated cannot read');
reset role;
set role anon;
select pg_temp.expect_error($$select public.hit_rate_limit('test:x', 3, 60)$$, 'permission denied', 'anon cannot call');
reset role;

delete from public.rate_limit_events where bucket like 'test:%';
select 'RATE LIMIT OK' as result;
