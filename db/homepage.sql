-- =============================================================================
-- db/homepage.sql — the homepage's own words become the owner's
-- -----------------------------------------------------------------------------
-- Run this once, after db/schema.sql and db/policies.sql, in the Supabase SQL
-- editor. It is safe to run again.
--
-- WHAT WAS WRONG
-- The banners table, the admin panel's Banners screen and the endpoints behind
-- it were all built in Phase 6, and the storefront never read any of them. The
-- hero carousel on the shop's front page came from data/hero.js — seven
-- invented slides in a file — so the owner could edit slides all afternoon and
-- the shop would not change. The wire was connected at one end.
--
-- The same was true of two more things beside it: the collection carousel
-- (data/collections.js) and the editorial band below the rails
-- (data/editorial.js). All three were written to build the interface against,
-- all three are marketing copy about a real shop, and none of them could be
-- reached by the person the shop belongs to.
--
-- WHY ONE COLUMN INSTEAD OF THREE TABLES
-- A hero slide, a collection tile and the editorial band are the same row with
-- different parts filled in: a picture, a short label, a headline, some words,
-- a link. They are not three kinds of thing, they are one kind of thing shown
-- in three places. So `placement` says where a row appears, and the existing
-- table, endpoints, policies and admin screen carry all three — which is both
-- less to build and less to keep in step afterwards.
--
--   hero        the full-width carousel at the top of the home page
--   collection  a tile in the ranked carousel below it
--   feature     the editorial band lower down; the first one is used
--
-- NOTHING IS BACKFILLED WITH INVENTED CONTENT
-- The column defaults to 'hero', which is correct for every row already in the
-- table, because until now hero was the only thing the table was for. It does
-- not put the old file's slides into the database: a shop shows the pictures
-- its owner chose, and an empty carousel that says so is better than a full one
-- that says something nobody meant.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- WHERE A BANNER APPEARS
-- -----------------------------------------------------------------------------

alter table public.banners
  add column if not exists placement text not null default 'hero';

-- Added separately so that re-running this file does not fail on a constraint
-- that is already there, and so the check is stated once where it can be read.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'banners_placement_check'
  ) then
    alter table public.banners
      add constraint banners_placement_check
      check (placement in ('hero', 'collection', 'feature'));
  end if;
end $$;


-- The storefront asks for one placement at a time, in sort order, and only for
-- what is showing. The existing banners_sort_idx does not lead with placement,
-- so it cannot answer that without a scan.
create index if not exists banners_placement_idx
  on public.banners (placement, status, sort);


-- =============================================================================
-- WHAT IS NOT CHANGED
-- -----------------------------------------------------------------------------
-- The policies. "banners: public read" already allows anyone to read rows whose
-- status is 'active', and a row's placement is not a secret — it is where the
-- row appears on a page anybody can look at. Adding a column does not widen
-- what that policy allows, and the admin write policy still requires is_admin().
-- =============================================================================
