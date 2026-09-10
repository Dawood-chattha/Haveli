-- =============================================================================
-- db/pages.sql — the storefront's own written pages
-- -----------------------------------------------------------------------------
-- Run this once, after db/schema.sql and db/policies.sql, in the Supabase SQL
-- editor. It is safe to run again: every statement is written to be repeatable.
--
-- WHAT THIS IS FOR
-- Nine routes on the storefront lead to pages that say nothing: the footer's
-- Help and Company columns, plus Stores in the menu drawer. Terms and Privacy
-- are among them, which a shop should not open without. This is where their
-- words live, so the owner writes them in the admin panel rather than in a
-- source file.
--
-- THE ROWS ARE STRUCTURE, THE WORDS ARE NOT
-- The nine rows below carry a slug, a title and an eyebrow — the shop's
-- genuine shape, the same distinction db/schema.sql draws for the category
-- tree. The body of every one is empty, because nobody has written it yet.
-- Inventing a returns policy and storing it as though the shop had agreed to
-- it would be worse than a blank page: a customer would read it and act on it.
--
-- NO PAGE IS CREATED OR DELETED FROM THE PANEL, AND THAT IS DELIBERATE
-- Each of these nine has a route in assets/js/routes.js and a link in the
-- footer or the drawer. A tenth row would be a page nothing leads to, and
-- deleting one would leave a link pointing at a page that no longer exists.
-- The panel edits these nine. Adding or removing a route is a change to the
-- site, made in those files and here together — as the three removed at the
-- bottom of this file were.
--
-- THE BODY IS TEXT, NOT MARKUP
-- Nothing here is rendered as HTML. assets/js/pages/static.js escapes every
-- character and then applies three rules of its own — a blank line starts a
-- paragraph, a line beginning "## " is a subheading, a line beginning "- " is
-- a list item. Storing markup would mean injecting markup, and a content field
-- that reaches innerHTML unescaped is a cross-site scripting hole with a
-- friendly name on it.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- THE TABLE
-- -----------------------------------------------------------------------------

create table if not exists public.pages (
  -- The route's own path segment, and the only name this table needs. An id
  -- column would be a second identity for a fixed set of nine rows that the
  -- storefront already asks for by name.
  slug        text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),

  title       text        not null check (length(btrim(title)) > 0),

  -- The small line above the title. Part of the page's shape rather than its
  -- content, which is why the seed fills it in.
  eyebrow     text        not null default '',

  -- The sentence under the title. Written by the owner like the body.
  lead        text        not null default '',

  -- The page itself, as plain text. Empty until somebody writes it.
  body        text        not null default '',

  -- 'draft' hides the words, not the route. The page still answers — a link in
  -- the footer must never lead nowhere — it simply has nothing to show yet.
  status      text        not null default 'draft'
                          check (status in ('draft', 'published')),

  -- What the footer and the panel list order by. Not a display order the owner
  -- can change: the footer's grouping is in data/footer.js, which is the
  -- shop's structure.
  sort        integer     not null default 0,

  updated_at  timestamptz not null default now()
);

drop trigger if exists pages_touch on public.pages;
create trigger pages_touch
  before update on public.pages
  for each row execute function public.touch_updated_at();


-- -----------------------------------------------------------------------------
-- WHO MAY READ AND WRITE
--
-- Read is open to everyone, including a signed-out visitor, because these are
-- the shop's own public pages — a Privacy Policy nobody can read is not one.
-- Write is public.is_admin(), the same function every other management table
-- uses.
--
-- A draft is readable too, and that is not a leak: the endpoint decides what a
-- draft shows, and the words in one are the shop's own unfinished copy rather
-- than anybody's data. Hiding drafts in the policy would mean the panel could
-- not load the page it is editing.
-- -----------------------------------------------------------------------------

alter table public.pages enable row level security;

drop policy if exists "pages: anyone may read" on public.pages;
create policy "pages: anyone may read"
  on public.pages for select
  using (true);

drop policy if exists "pages: admins may write" on public.pages;
create policy "pages: admins may write"
  on public.pages for all
  using (public.is_admin())
  with check (public.is_admin());


-- -----------------------------------------------------------------------------
-- THE NINE
--
-- Slug, title and eyebrow only. `on conflict do nothing` so that running this
-- file again never overwrites something the owner has since written.
-- -----------------------------------------------------------------------------

insert into public.pages (slug, title, eyebrow, sort) values
  ('faqs',        'FAQs',                   'Help',         10),
  ('how-to-buy',  'How To Buy',             'Help',         20),
  ('shipping',    'Shipping & Deliveries',  'Help',         40),
  ('returns',     'Exchange & Returns',     'Help',         50),
  ('about',       'About Us',               'Our story',    70),
  ('contact',     'Contact Us',             'Get in touch', 80),
  ('stores',      'Stores',                 'Visit us',     90),
  ('terms',       'Terms and Conditions',   'Legal',        110),
  ('privacy',     'Privacy Policy',         'Legal',        120)
on conflict (slug) do nothing;

-- Payment, Order tracking and Careers were seeded by an earlier version of
-- this file and have since been taken off the site — no route, no footer
-- link, no drawer tile. A row with nothing leading to it is a page somebody
-- still has to write, so it goes too. Harmless if they were never created.
delete from public.pages where slug in ('payment', 'tracking', 'careers');


-- =============================================================================
-- DONE
-- -----------------------------------------------------------------------------
-- Nine rows, every body empty. The panel's Pages screen is where they get
-- filled in, and it says how many are still waiting.
-- =============================================================================
