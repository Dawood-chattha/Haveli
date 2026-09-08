-- =============================================================================
-- db/schema.sql — the database
-- -----------------------------------------------------------------------------
-- Run this once, in the Supabase SQL Editor. It is written to be re-runnable:
-- every object is created with IF NOT EXISTS or dropped first, so running it a
-- second time repairs rather than fails.
--
-- IT CREATES NO POLICIES, AND THAT IS DELIBERATE
-- Row Level Security is switched ON for every table at the bottom of this file,
-- and not a single policy is written. In Postgres that combination means: no
-- one can read or write anything except the service role, which bypasses RLS.
--
-- That is the correct state to be in between now and Phase 3. The alternative —
-- creating tables and leaving RLS off until the policies are written — would
-- publish every order, every customer and every address to anyone holding the
-- publishable key, which is a key that is meant to be public. A window like
-- that is not theoretical: the project URL is visible in the browser the moment
-- the storefront makes its first request.
--
-- So the tables are born locked, and Phase 3 opens exactly the doors it means
-- to open.
--
-- MONEY IS AN INTEGER
-- Every amount in this file is `integer`, counting whole rupees. Money in a
-- floating point column is the bug that surfaces a month later as a one-rupee
-- discrepancy nobody can reproduce, because 0.1 + 0.2 is not 0.3 in binary
-- floating point. There is no fractional currency in use here, so whole rupees
-- are exact and comparisons are exact.
--
-- WHAT IS NOT STORED
-- No passwords: those live in auth.users, hashed by Supabase, and this schema
-- never touches them. No card numbers, no CVV, no expiry — Phase 11 will store
-- a provider's reference to a payment and nothing more. No computed customer
-- totals: `orders` and `spent` are counted from the orders table by a view, so
-- they cannot drift out of step the day an order is cancelled.
-- =============================================================================


-- =============================================================================
-- HELPERS
-- =============================================================================

-- Keeps updated_at honest without every query having to remember it.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- =============================================================================
-- PROFILES
-- -----------------------------------------------------------------------------
-- One row per account, keyed to Supabase's auth.users. Everything about a
-- person that is not authentication lives here.
--
-- `role` IS THE MOST SENSITIVE COLUMN IN THE DATABASE
-- It is what will decide, from Phase 3 onward, whether someone may reach the
-- admin panel's data. Three things protect it:
--
--   1. The signup trigger below always writes 'customer'. It ignores whatever
--      the signup request contained, so nobody can register as an admin.
--   2. Phase 3's policies will make it unwritable by the account holder.
--   3. requireAdmin() will read it from this table on every call rather than
--      from a token, so revoking admin takes effect immediately instead of
--      whenever an existing token happens to expire.
-- =============================================================================

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text        not null,
  name        text,
  phone       text,
  role        text        not null default 'customer'
                          check (role in ('customer', 'admin')),
  blocked     boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists profiles_role_idx  on public.profiles (role);
create index if not exists profiles_email_idx on public.profiles (lower(email));

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();


-- A profile is created the moment an account is, so there is never a signed-in
-- user without one. SECURITY DEFINER because the signing-up user has no rights
-- to this table yet.
--
-- Note what it does NOT do: it never reads a role out of raw_user_meta_data.
-- That field is written by whoever is signing up, so trusting it would mean
-- anyone could make themselves an administrator by adding one line to a signup
-- request. The role is hard-coded here, and the first admin is promoted by hand
-- in Phase 3.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data->>'name', '')), ''),
    'customer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- =============================================================================
-- CATEGORIES
-- -----------------------------------------------------------------------------
-- A tree, mirroring the menu drawer the storefront already has: a row with no
-- parent is a department (Men, Women, Kids); its children are categories; their
-- children are the leaves products actually belong to.
--
-- `dept` repeats the root's slug on every row. That is denormalisation on
-- purpose: nearly every storefront query starts by narrowing to a department,
-- and doing it with a recursive walk up the tree on each request would be slow
-- for a value that never changes once a row is placed.
-- =============================================================================

create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid        references public.categories(id) on delete cascade,
  dept        text        not null,
  slug        text        not null,
  label       text        not null,
  sort        integer     not null default 0,
  active      boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- A slug identifies a category within its department, which is how the
  -- storefront's URLs already work: /category/women/ready-to-wear.
  unique (dept, slug)
);

create index if not exists categories_parent_idx on public.categories (parent_id);
create index if not exists categories_dept_idx   on public.categories (dept, sort);

drop trigger if exists categories_touch on public.categories;
create trigger categories_touch
  before update on public.categories
  for each row execute function public.touch_updated_at();


-- =============================================================================
-- PRODUCTS
-- -----------------------------------------------------------------------------
-- The columns mirror what the storefront's generated catalogue already carries,
-- so connecting the UI in Phase 4 is a change of source and not a change of
-- shape.
--
-- `price` and `compare_at` are whole rupees. `compare_at` is the crossed-out
-- original and is null when the product is not reduced — a nullable column
-- rather than a `on_sale` boolean beside it, because two columns that must
-- agree eventually disagree.
--
-- `stock` is the single source of truth for availability. There is no
-- `in_stock` boolean: it is `stock > 0`, and storing it separately would give
-- the same disagreement.
-- =============================================================================

create table if not exists public.products (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid        not null references public.categories(id) on delete restrict,

  -- Maintained by the trigger below from the category. Never written by hand.
  dept         text        not null default '',

  title        text        not null,
  slug         text        not null unique,
  description  text,

  price        integer     not null check (price >= 0),
  compare_at   integer     check (compare_at is null or compare_at > price),

  sku          text unique,
  stock        integer     not null default 0 check (stock >= 0),

  colour       text,
  colour_hex   text,
  fabric       text,
  sizes        text[]      not null default '{}',

  badge        text,
  featured     boolean     not null default false,
  status       text        not null default 'active'
                           check (status in ('active', 'draft', 'archived')),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists products_category_idx on public.products (category_id);
create index if not exists products_dept_idx     on public.products (dept, status);
create index if not exists products_status_idx   on public.products (status);
create index if not exists products_featured_idx on public.products (featured) where featured;

-- The storefront's search is a substring match over the title. A plain b-tree
-- index cannot serve `ilike '%term%'`, so this is a trigram index, which can.
create extension if not exists pg_trgm;
create index if not exists products_title_trgm_idx
  on public.products using gin (title gin_trgm_ops);


-- Copy the department down from the category, so `dept` cannot be wrong.
-- Doing this in the API instead would work until the day a row is inserted by
-- some other route — a script, the SQL editor, a later import.
create or replace function public.products_set_dept()
returns trigger
language plpgsql
as $$
begin
  select c.dept into new.dept
  from public.categories c
  where c.id = new.category_id;

  if new.dept is null then
    raise exception 'category % does not exist', new.category_id;
  end if;

  return new;
end;
$$;

drop trigger if exists products_dept on public.products;
create trigger products_dept
  before insert or update of category_id on public.products
  for each row execute function public.products_set_dept();

drop trigger if exists products_touch on public.products;
create trigger products_touch
  before update on public.products
  for each row execute function public.touch_updated_at();


-- =============================================================================
-- PRODUCT IMAGES
-- -----------------------------------------------------------------------------
-- A separate table rather than an array column on products, because an image
-- has properties of its own — alt text and an order — and because Phase 5 will
-- need to delete one file from storage when one row goes.
--
-- `url` holds a location, never image data. Base64 in a database column makes
-- every query that touches the row drag megabytes along with it.
-- =============================================================================

create table if not exists public.product_images (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid        not null references public.products(id) on delete cascade,
  url         text        not null,
  alt         text,
  sort        integer     not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists product_images_product_idx
  on public.product_images (product_id, sort);


-- =============================================================================
-- ADDRESSES
-- =============================================================================

create table if not exists public.addresses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid        not null references public.profiles(id) on delete cascade,
  label       text,
  name        text        not null,
  phone       text        not null,
  line1       text        not null,
  line2       text,
  city        text        not null,
  postal_code text,
  is_default  boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists addresses_user_idx on public.addresses (user_id);

-- At most one default per person. A partial unique index states the rule in
-- the database rather than relying on every write path to remember it.
create unique index if not exists addresses_one_default_idx
  on public.addresses (user_id) where is_default;

drop trigger if exists addresses_touch on public.addresses;
create trigger addresses_touch
  before update on public.addresses
  for each row execute function public.touch_updated_at();


-- =============================================================================
-- CART
-- -----------------------------------------------------------------------------
-- One cart per account. The storefront's current cart lives in localStorage and
-- will keep doing so for signed-out visitors; this is what a signed-in cart
-- becomes, so it survives a different device.
--
-- A line stores product, size and quantity — and NO price. The price of a cart
-- line is whatever the product costs when the order is placed, read from the
-- products table at checkout. Storing it here would mean a price change never
-- reaches a cart that was filled before it.
-- =============================================================================

create table if not exists public.carts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid        not null unique references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists carts_touch on public.carts;
create trigger carts_touch
  before update on public.carts
  for each row execute function public.touch_updated_at();

create table if not exists public.cart_items (
  id          uuid primary key default gen_random_uuid(),
  cart_id     uuid        not null references public.carts(id) on delete cascade,
  product_id  uuid        not null references public.products(id) on delete cascade,
  size        text,
  qty         integer     not null check (qty > 0 and qty <= 99),
  created_at  timestamptz not null default now(),

  -- The same product in the same size is one line with a larger quantity,
  -- which is how the storefront's cart already behaves. Enforced here so a
  -- double-submitted request cannot produce two lines.
  unique (cart_id, product_id, size)
);

create index if not exists cart_items_cart_idx on public.cart_items (cart_id);


-- =============================================================================
-- WISHLIST
-- =============================================================================

create table if not exists public.wishlist_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid        not null references public.profiles(id) on delete cascade,
  product_id  uuid        not null references public.products(id) on delete cascade,
  created_at  timestamptz not null default now(),

  unique (user_id, product_id)
);

create index if not exists wishlist_user_idx on public.wishlist_items (user_id);


-- =============================================================================
-- COUPONS
-- -----------------------------------------------------------------------------
-- There is no `state` column, and the admin panel already agrees: Running,
-- Scheduled, Expired and Used up are derived from the dates and `used_count`,
-- never stored. A stored state is correct until a date passes, and then it is
-- silently wrong until something happens to recalculate it.
-- =============================================================================

create table if not exists public.coupons (
  id           uuid primary key default gen_random_uuid(),
  code         text        not null unique,
  type         text        not null check (type in ('percent', 'fixed')),

  -- Percent when type='percent' (1-100), whole rupees when type='fixed'.
  value        integer     not null check (value > 0),

  min_spend    integer     not null default 0 check (min_spend >= 0),
  starts_at    timestamptz,
  expires_at   timestamptz,
  usage_limit  integer     check (usage_limit is null or usage_limit > 0),
  used_count   integer     not null default 0 check (used_count >= 0),
  disabled     boolean     not null default false,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  check (type <> 'percent' or value <= 100),
  check (starts_at is null or expires_at is null or expires_at > starts_at)
);

-- Codes are matched case-insensitively: someone typing "eid20" must reach the
-- coupon created as "EID20".
create unique index if not exists coupons_code_lower_idx on public.coupons (lower(code));

drop trigger if exists coupons_touch on public.coupons;
create trigger coupons_touch
  before update on public.coupons
  for each row execute function public.touch_updated_at();


-- =============================================================================
-- ORDERS
-- -----------------------------------------------------------------------------
-- The statuses are exactly the five the admin panel already draws, and the
-- three payment states it already shows. Adding a sixth here would mean a value
-- the orders screen cannot render.
--
-- EVERY AMOUNT IS WRITTEN BY THE SERVER
-- subtotal, discount, shipping and total are calculated in the checkout
-- function from the products and coupons tables. Nothing a browser sends
-- reaches these columns. The check constraint at the bottom is the last line of
-- that defence: even a bug in the server cannot store a total that does not add
-- up.
--
-- `address` is a jsonb SNAPSHOT, not a reference. When a customer later edits
-- their address, or deletes it, the record of where this order was actually
-- sent must not change. The same reasoning governs order_items below.
-- =============================================================================

create table if not exists public.orders (
  id            uuid primary key default gen_random_uuid(),
  ref           text        not null unique,
  user_id       uuid        references public.profiles(id) on delete set null,

  status        text        not null default 'pending'
                            check (status in ('pending', 'processing', 'shipped',
                                              'delivered', 'cancelled')),
  payment_status text       not null default 'unpaid'
                            check (payment_status in ('paid', 'unpaid', 'refunded')),
  method        text        not null default 'cod'
                            check (method in ('cod', 'card', 'bank', 'wallet')),

  subtotal      integer     not null check (subtotal >= 0),
  discount      integer     not null default 0 check (discount >= 0),
  shipping      integer     not null default 0 check (shipping >= 0),
  total         integer     not null check (total >= 0),

  coupon_id     uuid        references public.coupons(id) on delete set null,
  coupon_code   text,

  address       jsonb       not null,
  note          text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- The arithmetic itself, stated as a constraint. A total that does not equal
  -- subtotal minus discount plus shipping is not a row this database will hold.
  constraint orders_total_adds_up
    check (total = subtotal - discount + shipping),

  -- A discount cannot exceed what is being discounted.
  constraint orders_discount_within_subtotal
    check (discount <= subtotal)
);

create index if not exists orders_user_idx    on public.orders (user_id, created_at desc);
create index if not exists orders_status_idx  on public.orders (status, created_at desc);
create index if not exists orders_created_idx on public.orders (created_at desc);
create index if not exists orders_payment_idx on public.orders (payment_status);

drop trigger if exists orders_touch on public.orders;
create trigger orders_touch
  before update on public.orders
  for each row execute function public.touch_updated_at();


-- Order lines carry their own copy of the title, image and price.
--
-- This is not accidental duplication. A receipt must say what was bought and
-- what it cost on the day it was bought. Reading those from the products table
-- would mean that renaming a product, replacing its photograph or raising its
-- price silently rewrites every past order — and a shop whose old receipts
-- change is a shop that cannot answer a dispute.
--
-- product_id is kept alongside so reporting can still group by product, but it
-- is nullable and set null on delete: the line survives the product.
create table if not exists public.order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid        not null references public.orders(id) on delete cascade,
  product_id  uuid        references public.products(id) on delete set null,

  title       text        not null,
  image       text,
  price       integer     not null check (price >= 0),
  qty         integer     not null check (qty > 0),
  size        text,

  created_at  timestamptz not null default now()
);

create index if not exists order_items_order_idx   on public.order_items (order_id);
create index if not exists order_items_product_idx on public.order_items (product_id);


-- =============================================================================
-- PAYMENTS
-- -----------------------------------------------------------------------------
-- A record that money moved, and nothing that could move it again.
--
-- No card number, no CVV, no expiry date, no cardholder name. Those never
-- arrive at this server: Phase 11's provider collects them on its own pages and
-- returns a reference, which is what `provider_ref` holds. Storing card data
-- would place this project under PCI-DSS obligations it has no reason to take
-- on, in exchange for nothing it needs.
-- =============================================================================

create table if not exists public.payments (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid        not null references public.orders(id) on delete cascade,
  provider      text        not null,
  provider_ref  text,
  amount        integer     not null check (amount >= 0),
  status        text        not null default 'pending'
                            check (status in ('pending', 'paid', 'failed', 'refunded')),

  -- The provider's own payload, kept for reconciliation and disputes. Never
  -- returned to a browser.
  raw           jsonb,

  created_at    timestamptz not null default now()
);

create index if not exists payments_order_idx on public.payments (order_id);
create unique index if not exists payments_provider_ref_idx
  on public.payments (provider, provider_ref) where provider_ref is not null;


-- =============================================================================
-- BANNERS
-- -----------------------------------------------------------------------------
-- The hero carousel the storefront already renders. `href` is a path within
-- this site; the admin panel offers a list of real destinations rather than a
-- free text field, and hero.js escapes every value on the way into the page.
-- =============================================================================

create table if not exists public.banners (
  id          uuid primary key default gen_random_uuid(),
  image       text        not null,
  alt         text        not null,
  eyebrow     text,
  headline    text,
  body        text,
  cta         text,
  href        text,
  proof       text,
  status      text        not null default 'active'
                          check (status in ('active', 'hidden')),
  sort        integer     not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists banners_sort_idx on public.banners (status, sort);

drop trigger if exists banners_touch on public.banners;
create trigger banners_touch
  before update on public.banners
  for each row execute function public.touch_updated_at();


-- =============================================================================
-- SETTINGS
-- -----------------------------------------------------------------------------
-- One row, forever. The single-row constraint is stated rather than assumed,
-- because "the settings row" being two rows is the kind of thing that only
-- shows up as an intermittent bug.
-- =============================================================================

create table if not exists public.settings (
  id             boolean primary key default true check (id),
  store          jsonb   not null default '{}'::jsonb,
  notifications  jsonb   not null default '{}'::jsonb,
  updated_at     timestamptz not null default now()
);

insert into public.settings (id) values (true) on conflict (id) do nothing;

drop trigger if exists settings_touch on public.settings;
create trigger settings_touch
  before update on public.settings
  for each row execute function public.touch_updated_at();


-- =============================================================================
-- CUSTOMER STATISTICS
-- -----------------------------------------------------------------------------
-- Counted, never carried. The admin panel already works this way and the reason
-- holds here: an `orders` or `total_spent` column on profiles is correct until
-- an order is cancelled and something forgets to decrement it, and from then on
-- it is quietly wrong in a way nobody notices until the numbers are questioned.
--
-- Cancelled orders are excluded from both the count and the total, which is
-- what the panel's customer list already shows.
-- =============================================================================

create or replace view public.customer_stats as
select
  p.id                                             as user_id,
  count(o.id)                                      as orders,
  coalesce(sum(o.total), 0)::bigint                as spent,
  max(o.created_at)                                as last_order_at
from public.profiles p
left join public.orders o
  on o.user_id = p.id
 and o.status <> 'cancelled'
group by p.id;


-- =============================================================================
-- ROW LEVEL SECURITY — ON EVERYWHERE, POLICIES NOWHERE
-- -----------------------------------------------------------------------------
-- Read the note at the top of this file. Enabling RLS with no policies denies
-- everything to everyone except the service role. Phase 3 writes the policies
-- that open specific doors:
--
--   products, categories, product_images, banners  ->  readable by anyone,
--                                                      writable by admins only
--   carts, cart_items, wishlist_items, addresses   ->  each person's own rows
--   orders, order_items                            ->  own rows; admins all
--   profiles                                       ->  own row, role not
--                                                      writable by its owner
--   coupons, payments, settings                    ->  admins only
--
-- Until then the storefront cannot read products either. That is expected: the
-- site still runs on its generated catalogue, and Phase 4 is what switches it
-- over — by which time the policies exist.
-- =============================================================================

alter table public.profiles       enable row level security;
alter table public.categories     enable row level security;
alter table public.products       enable row level security;
alter table public.product_images enable row level security;
alter table public.addresses      enable row level security;
alter table public.carts          enable row level security;
alter table public.cart_items     enable row level security;
alter table public.wishlist_items enable row level security;
alter table public.coupons        enable row level security;
alter table public.orders         enable row level security;
alter table public.order_items    enable row level security;
alter table public.payments       enable row level security;
alter table public.banners        enable row level security;
alter table public.settings       enable row level security;


-- =============================================================================
-- DONE
-- -----------------------------------------------------------------------------
-- Fourteen tables, one view. Next: db/seed.sql fills categories, products and
-- banners from the data the storefront already uses.
-- =============================================================================
