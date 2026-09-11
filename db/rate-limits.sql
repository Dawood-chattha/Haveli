-- =============================================================================
-- db/rate-limits.sql — a counter that survives the server being replaced
-- -----------------------------------------------------------------------------
-- Run this once, after db/schema.sql and db/policies.sql, in the Supabase SQL
-- editor. It is safe to run again.
--
-- WHY THIS IS IN THE DATABASE AND NOT IN THE SERVER'S MEMORY
-- The obvious way to write a rate limiter is a Map in a module, counting
-- requests per address. On this project that would be theatre. The API is a
-- set of serverless functions: the platform starts an instance when there is
-- traffic, stops it when there is not, and runs several side by side when
-- there is more. A counter in one instance's memory is not seen by the others
-- and is gone the moment that instance is recycled — so an attacker spreading
-- requests over a few seconds would be counted by nobody.
--
-- A check that looks like a limit and is not is worse than no check, because
-- it stops anyone from noticing the limit is missing. The counter therefore
-- lives in the one place every instance can see and nothing restarts: here.
--
-- THE COUNT IS ONE STATEMENT, SO TWO REQUESTS CANNOT BOTH SLIP THROUGH
-- Read-then-write would let two simultaneous attempts read the same number
-- and both decide they were under the limit. The insert below does the read,
-- the increment and the window roll in a single INSERT ... ON CONFLICT, which
-- Postgres applies atomically per row, and returns the resulting count. There
-- is no gap between deciding and recording.
--
-- NOBODY'S ADDRESS IS STORED HERE, AND NOR IS ANYONE'S EMAIL
-- `bucket` is a hash, computed by api/_lib/rate-limit.js before the value ever
-- leaves the server. The table only ever compares buckets for equality, so it
-- has no use for the original text — and a table of "every email address that
-- has tried to sign in", or every IP that has visited, is a customer list
-- assembled by accident. The hash means this table cannot become one.
--
-- IT IS NOT REACHABLE FROM A BROWSER
-- Row Level Security is on with no policy at all, and both browser roles have
-- their grants revoked, so `anon` and `authenticated` can neither read the
-- counters nor reset them. The function is revoked from them too: a limiter
-- anybody could call is a limiter anybody could exhaust on somebody else's
-- behalf, which turns a defence into a way of locking a customer out.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- THE TABLE
--
-- One row per bucket — per hashed address, per hashed email, per named limit.
-- `window_start` is when the current window opened, not when the row was made:
-- rolling the window is what turns a fixed count into a repeating allowance.
-- -----------------------------------------------------------------------------

create table if not exists public.rate_limits (
  bucket        text primary key,
  hits          integer not null default 0,
  window_start  timestamptz not null default now()
);

-- For the sweep at the bottom of the function, which would otherwise scan the
-- whole table on the rare occasions it runs.
create index if not exists rate_limits_window_idx
  on public.rate_limits (window_start);

alter table public.rate_limits enable row level security;

-- No policy is declared, deliberately. With RLS on and nothing allowed, every
-- request that is not the service role is refused — which is the whole of what
-- this table needs, and is stated by the absence rather than by a policy that
-- somebody could later widen.

revoke all on public.rate_limits from anon;
revoke all on public.rate_limits from authenticated;


-- -----------------------------------------------------------------------------
-- THE COUNT
--
--   select * from public.rate_limit_hit('some-hash', 10, 900);
--
--   allowed      whether this attempt is within the allowance
--   hits         how many have been counted in the current window
--   retry_after  seconds until the window rolls, for the Retry-After header
--
-- Calling it IS the attempt: the count goes up whether or not the answer is
-- `allowed`, so hammering a limit that has already been reached does not reset
-- it and does not go unrecorded.
-- -----------------------------------------------------------------------------

create or replace function public.rate_limit_hit(
  p_bucket text,
  p_limit  integer,
  p_window integer
)
returns table (allowed boolean, hits integer, retry_after integer)
language plpgsql
security definer
-- Pinned, so the function cannot be made to resolve `rate_limits` to somebody
-- else's table by a crafted search_path. Every SECURITY DEFINER function in
-- this project does this.
set search_path = public
as $$
declare
  v_hits  integer;
  v_start timestamptz;
  v_cut   timestamptz := now() - make_interval(secs => p_window);
begin
  insert into public.rate_limits as r (bucket, hits, window_start)
  values (p_bucket, 1, now())
  on conflict (bucket) do update
     set hits = case when r.window_start <= v_cut then 1 else r.hits + 1 end,
         window_start = case when r.window_start <= v_cut then now()
                             else r.window_start end
  returning r.hits, r.window_start
  into v_hits, v_start;

  -- HOUSEKEEPING, PAID FOR BY ONE REQUEST IN FIFTY
  --
  -- Without this the table grows by a row for every address that ever signs
  -- in and keeps them for ever. Doing it on every call would put a delete in
  -- front of every sign-in for no reason, and a scheduled job is another
  -- moving part to set up and forget. A rare sweep costs almost nothing and
  -- cannot fall behind: the more traffic there is, the more often it runs.
  if random() < 0.02 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;

  return query
  select
    v_hits <= p_limit,
    v_hits,
    greatest(
      0,
      ceil(extract(epoch from
        (v_start + make_interval(secs => p_window)) - now()))::integer
    );
end;
$$;

-- `from public` is what takes away the EXECUTE that every function is created
-- with. The two role lines after it are belt and braces, and say plainly which
-- roles are meant to be refused.
revoke all on function public.rate_limit_hit(text, integer, integer) from public;
revoke all on function public.rate_limit_hit(text, integer, integer) from anon;
revoke all on function public.rate_limit_hit(text, integer, integer) from authenticated;


-- =============================================================================
-- DONE
-- -----------------------------------------------------------------------------
-- Nothing calls this yet except api/_lib/rate-limit.js, and nothing else
-- should: the limits themselves — how many, over how long, for which endpoint
-- — are decided in that one file, so they can be read in one place rather than
-- being discovered one endpoint at a time.
-- =============================================================================
