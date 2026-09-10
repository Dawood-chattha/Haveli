-- =============================================================================
-- db/storage.sql — somewhere for the shop's pictures to live
-- -----------------------------------------------------------------------------
-- Run this in the Supabase SQL editor after db/schema.sql, db/policies.sql and
-- db/checkout.sql. Running it twice is safe.
--
--
-- WHAT THIS FIXES
--
-- The product form read a chosen photograph in the browser and put the result
-- straight into the form's draft — a `data:image/jpeg;base64,…` string two
-- million characters long. That was harmless while nothing was saved. Once
-- products began saving, the API stored it in a text column capped at a
-- thousand characters, so the owner attached a photograph, saved, and got a
-- broken image with no warning anywhere.
--
-- A picture belongs in object storage with a URL pointing at it, and this is
-- the bucket that holds them.
--
--
-- PUBLIC TO READ, ADMINISTRATORS TO WRITE
--
-- Read is public because these are the shop's own product photographs: they
-- appear on every page, to everybody, including people who have never signed
-- in. There is nothing to protect.
--
-- Write is not. The anon key is in the browser and always will be — it is
-- printed in assets/js/auth.js's requests for anyone who opens the network
-- tab — so "only our own upload form writes here" is not a rule the database
-- can be told. The policy below is what actually stops a stranger filling the
-- shop's storage with their own files, and it asks the same question every
-- other policy in this project asks: public.is_admin().
--
-- The upload endpoint goes through the caller's own token for exactly that
-- reason, so this policy is enforced rather than bypassed. See
-- api/admin/uploads.js.
--
--
-- FOUR MEGABYTES
--
-- Not a guess at what a photograph should weigh: a serverless function on
-- Vercel refuses a request body over about four and a half megabytes, so an
-- upload larger than this cannot reach the server at all and would fail in a
-- way nothing here could explain. The endpoint refuses it first, with a
-- sentence, and the bucket refuses it again.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shop-images', 'shop-images', true, 4194304,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- -----------------------------------------------------------------------------
-- Who may do what
--
-- Storage keeps its files as rows in storage.objects, so these are ordinary
-- row level security policies on an ordinary table. Each one names the bucket:
-- a policy without that clause would be a policy about every bucket this
-- project ever adds.
-- -----------------------------------------------------------------------------

drop policy if exists "shop images: anyone may look" on storage.objects;
create policy "shop images: anyone may look"
  on storage.objects for select
  using (bucket_id = 'shop-images');

drop policy if exists "shop images: admins may add" on storage.objects;
create policy "shop images: admins may add"
  on storage.objects for insert
  with check (bucket_id = 'shop-images' and public.is_admin());

drop policy if exists "shop images: admins may replace" on storage.objects;
create policy "shop images: admins may replace"
  on storage.objects for update
  using (bucket_id = 'shop-images' and public.is_admin())
  with check (bucket_id = 'shop-images' and public.is_admin());

drop policy if exists "shop images: admins may remove" on storage.objects;
create policy "shop images: admins may remove"
  on storage.objects for delete
  using (bucket_id = 'shop-images' and public.is_admin());
