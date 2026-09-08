-- =============================================================================
-- db/policies.sql — who may read and write what
-- -----------------------------------------------------------------------------
-- Run this once, in the Supabase SQL Editor, after db/schema.sql. Like the
-- schema it is re-runnable: every policy is dropped before it is created.
--
-- THIS FILE IS THE SECURITY OF THIS PROJECT.
--
-- Not the admin route guard, which only decides what the panel draws. Not the
-- checks in api/_lib/auth.js, which are a second opinion. Those both run in
-- code that could have a bug, and one of them runs in a browser the visitor
-- controls entirely.
--
-- What is written here runs inside Postgres, on every single read and write,
-- no matter who asks or how. A crafted request, a forgotten filter, a mistake
-- in an endpoint, someone typing into the browser console — all of them are
-- judged by these rules. If a policy does not permit a row, no amount of code
-- above can produce it.
--
-- THE SHAPE OF THE ANSWER
--
--   catalogue        anyone may read what is published; only admins write
--   personal data    each person reaches their own rows and no one else's
--   orders           yours to read, nobody's to alter but an admin's
--   money and config admins only
--
-- WHY ORDERS HAVE NO INSERT POLICY
-- A customer never writes an order row. Checkout runs on the server, which
-- calculates the total from the products and coupons tables and inserts with
-- the service role. If customers could insert orders directly, they could
-- insert one with any total they liked, and every check in the API above would
-- be beside the point. The absence of that policy is the enforcement.
-- =============================================================================


-- =============================================================================
-- IS THE CALLER AN ADMIN?
-- -----------------------------------------------------------------------------
-- Read from the profiles table on every call, never from the token.
--
-- A role copied into a JWT is a snapshot: revoke someone's access and their
-- existing token keeps saying "admin" until it happens to expire, which may be
-- an hour. Reading the row means access ends the moment it is withdrawn.
--
-- SECURITY DEFINER is required, and not merely convenient. Without it, a policy
-- on `profiles` that calls this function would itself query `profiles`, which
-- would evaluate the policy again, forever. Running as the definer skips RLS
-- inside the function and breaks the loop.
--
-- The function is therefore narrow on purpose: it reads one boolean about the
-- current caller and can return nothing else. It takes no arguments, so it
-- cannot be pointed at another user's row.
--
-- `blocked` is checked here too. A blocked administrator is not an
-- administrator, and putting that in one function means no policy can forget
-- it.
-- =============================================================================

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and not blocked
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, anon, service_role;


-- Is the caller a usable account at all? A blocked customer keeps their rows
-- but may not act with them.
create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and not blocked
  );
$$;

revoke all on function public.is_active_user() from public;
grant execute on function public.is_active_user() to authenticated, anon, service_role;


-- =============================================================================
-- PROFILES
-- -----------------------------------------------------------------------------
-- Everyone reaches their own row. Admins reach all of them, because the
-- customers screen is a list of exactly this.
--
-- THE ROLE COLUMN NEEDS MORE THAN A POLICY
-- Postgres row level security decides which ROWS may be updated, not which
-- COLUMNS. A policy that lets someone update their own row therefore lets them
-- update every field in it — including `role`. Anyone could make themselves an
-- administrator with one request, and the whole scheme would be decorative.
--
-- The trigger below is what closes that. It compares the old and new values of
-- the two fields that grant power and refuses the change unless an admin is
-- making it.
-- =============================================================================

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own"
  on public.profiles for select
  using (id = auth.uid());

drop policy if exists "profiles: admins read all" on public.profiles;
create policy "profiles: admins read all"
  on public.profiles for select
  using (public.is_admin());

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "profiles: admins update any" on public.profiles;
create policy "profiles: admins update any"
  on public.profiles for update
  using (public.is_admin())
  with check (public.is_admin());

-- No insert policy: rows are created by the handle_new_user trigger when an
-- account is created, and by nothing else. No delete policy: deleting the
-- auth.users row cascades, and there is no reason for any other route.


create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.role is distinct from old.role
      or new.blocked is distinct from old.blocked)
     and auth.uid() is not null
     and not public.is_admin()
  then
    raise exception 'role and blocked may only be changed by an administrator'
      using errcode = 'insufficient_privilege';
  end if;

  -- The link to auth.users is the identity itself and is never re-pointed.
  if new.id is distinct from old.id then
    raise exception 'a profile cannot change which account it belongs to'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- `auth.uid() is not null` above is what lets the service role through, and it
-- is safe because there is no other caller it admits: anon has no update policy
-- on this table at all, so an anonymous request never reaches this trigger.
-- Promoting the first administrator has to happen from outside the system --
-- see scripts/make-admin.mjs -- because at that moment there is no admin to
-- authorise it.

drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect
  before update on public.profiles
  for each row execute function public.protect_profile_privileges();


-- =============================================================================
-- THE CATALOGUE — categories, products, images, banners
-- -----------------------------------------------------------------------------
-- Readable by anyone, including visitors who have not signed in. That is what a
-- shop is: the storefront must show its products to a stranger.
--
-- READ POLICIES FILTER ON STATUS, WHICH IS THE POINT
-- A draft product and a hidden banner are not merely absent from a list the UI
-- builds -- they are unreachable. Someone reading the API directly, guessing a
-- product id, or watching network requests cannot see a product that has not
-- been published. Hiding it in the query would not have achieved that.
--
-- Admins bypass the status filter through the second policy on each table,
-- because the products screen has to show drafts in order to edit them.
-- =============================================================================

-- ---- categories -------------------------------------------------------------

drop policy if exists "categories: public read" on public.categories;
create policy "categories: public read"
  on public.categories for select
  using (active);

drop policy if exists "categories: admins read all" on public.categories;
create policy "categories: admins read all"
  on public.categories for select
  using (public.is_admin());

drop policy if exists "categories: admins write" on public.categories;
create policy "categories: admins write"
  on public.categories for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---- products ---------------------------------------------------------------

drop policy if exists "products: public read" on public.products;
create policy "products: public read"
  on public.products for select
  using (status = 'active');

drop policy if exists "products: admins read all" on public.products;
create policy "products: admins read all"
  on public.products for select
  using (public.is_admin());

drop policy if exists "products: admins write" on public.products;
create policy "products: admins write"
  on public.products for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---- product images ---------------------------------------------------------
-- An image is visible exactly when its product is. Repeating the status rule
-- here rather than trusting the join means a direct request for the images
-- table cannot enumerate the photographs of unpublished products.

drop policy if exists "product_images: public read" on public.product_images;
create policy "product_images: public read"
  on public.product_images for select
  using (exists (
    select 1 from public.products p
    where p.id = product_id and p.status = 'active'
  ));

drop policy if exists "product_images: admins read all" on public.product_images;
create policy "product_images: admins read all"
  on public.product_images for select
  using (public.is_admin());

drop policy if exists "product_images: admins write" on public.product_images;
create policy "product_images: admins write"
  on public.product_images for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---- banners ----------------------------------------------------------------

drop policy if exists "banners: public read" on public.banners;
create policy "banners: public read"
  on public.banners for select
  using (status = 'active');

drop policy if exists "banners: admins read all" on public.banners;
create policy "banners: admins read all"
  on public.banners for select
  using (public.is_admin());

drop policy if exists "banners: admins write" on public.banners;
create policy "banners: admins write"
  on public.banners for all
  using (public.is_admin())
  with check (public.is_admin());


-- =============================================================================
-- PERSONAL DATA — addresses, cart, wishlist
-- -----------------------------------------------------------------------------
-- Each person reaches their own rows and nobody else's. Admins are deliberately
-- NOT given access here.
--
-- The admin panel has no screen that shows a customer's saved addresses or
-- what is sitting in their cart, and it should not gain one by accident. An
-- address that matters -- the one an order shipped to -- is snapshotted onto
-- the order itself, so nothing an admin legitimately needs is behind these
-- rules.
--
-- USING vs WITH CHECK, since both appear below:
--   using       which existing rows this statement may touch
--   with check  what a row is allowed to look like after the write
-- Both are needed on a write. `using` alone would let someone update their own
-- row into someone else's.
-- =============================================================================

drop policy if exists "addresses: own" on public.addresses;
create policy "addresses: own"
  on public.addresses for all
  using (user_id = auth.uid() and public.is_active_user())
  with check (user_id = auth.uid() and public.is_active_user());

drop policy if exists "carts: own" on public.carts;
create policy "carts: own"
  on public.carts for all
  using (user_id = auth.uid() and public.is_active_user())
  with check (user_id = auth.uid() and public.is_active_user());

-- A cart line is reached through its cart, so ownership is one hop away. The
-- subquery is what makes "your line" mean "a line in your cart" rather than
-- "a line you claim is yours".
drop policy if exists "cart_items: own" on public.cart_items;
create policy "cart_items: own"
  on public.cart_items for all
  using (cart_id in (select id from public.carts where user_id = auth.uid()))
  with check (cart_id in (select id from public.carts where user_id = auth.uid()));

drop policy if exists "wishlist_items: own" on public.wishlist_items;
create policy "wishlist_items: own"
  on public.wishlist_items for all
  using (user_id = auth.uid() and public.is_active_user())
  with check (user_id = auth.uid() and public.is_active_user());


-- =============================================================================
-- ORDERS
-- -----------------------------------------------------------------------------
-- Read your own. Admins read all, and admins alone may change a status.
--
-- THERE IS NO INSERT POLICY, AND THERE WILL NOT BE ONE
-- Placing an order goes through the checkout function on the server, which
-- reads every price from the products table, applies a coupon it validates
-- itself, computes the total, and inserts with the service role. A customer who
-- could insert directly could insert an order for ten thousand rupees of goods
-- with a total of one rupee -- and the schema's arithmetic constraint would
-- happily accept it, because one rupee of subtotal, zero discount and zero
-- shipping does add up to one rupee. The constraint checks that the sum is
-- consistent, not that the prices are real. Only reading them from the database
-- does that.
--
-- THERE IS NO UPDATE POLICY FOR CUSTOMERS EITHER
-- A customer cancelling an order is a request, not an edit. When that screen is
-- built it will call an endpoint that checks the order is still cancellable;
-- letting the browser write `status` would let anyone mark an unpaid order
-- delivered.
-- =============================================================================

drop policy if exists "orders: read own" on public.orders;
create policy "orders: read own"
  on public.orders for select
  using (user_id = auth.uid());

drop policy if exists "orders: admins read all" on public.orders;
create policy "orders: admins read all"
  on public.orders for select
  using (public.is_admin());

drop policy if exists "orders: admins update" on public.orders;
create policy "orders: admins update"
  on public.orders for update
  using (public.is_admin())
  with check (public.is_admin());

-- Order lines follow their order.
drop policy if exists "order_items: read own" on public.order_items;
create policy "order_items: read own"
  on public.order_items for select
  using (order_id in (select id from public.orders where user_id = auth.uid()));

drop policy if exists "order_items: admins read all" on public.order_items;
create policy "order_items: admins read all"
  on public.order_items for select
  using (public.is_admin());


-- =============================================================================
-- MONEY AND CONFIGURATION — coupons, payments, settings
-- -----------------------------------------------------------------------------
-- Admins only, and customers deliberately cannot read coupons at all.
--
-- A customer needs to know whether the code they typed works, which is a
-- question the server answers. They do not need the list. Publishing it would
-- hand every visitor every unused discount code in the shop, including ones
-- meant for a single customer or not yet announced.
-- =============================================================================

drop policy if exists "coupons: admins only" on public.coupons;
create policy "coupons: admins only"
  on public.coupons for all
  using (public.is_admin())
  with check (public.is_admin());

-- Payments are written by the webhook with the service role and read by the
-- panel. A customer sees the payment_status on their own order, which is what
-- they actually need, and never the provider's payload.
drop policy if exists "payments: admins only" on public.payments;
create policy "payments: admins only"
  on public.payments for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "settings: admins only" on public.settings;
create policy "settings: admins only"
  on public.settings for all
  using (public.is_admin())
  with check (public.is_admin());


-- =============================================================================
-- THE VIEW
-- -----------------------------------------------------------------------------
-- customer_stats aggregates profiles and orders. A view runs with its owner's
-- rights by default, which would let it hand out totals the caller may not see,
-- so it is marked to run as the invoker instead: the policies above apply
-- inside it, and a customer querying it sees only their own line.
-- =============================================================================

alter view public.customer_stats set (security_invoker = on);


-- =============================================================================
-- DONE
-- -----------------------------------------------------------------------------
-- Next: scripts/make-admin.mjs promotes the first administrator, because until
-- one exists there is nobody who can authorise promoting one.
-- =============================================================================
