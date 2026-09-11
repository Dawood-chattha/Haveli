-- =============================================================================
-- db/sales.sql — how much of each product has actually sold
-- -----------------------------------------------------------------------------
-- Run this once, after db/schema.sql and db/policies.sql, in the Supabase SQL
-- editor. It is safe to run again.
--
-- WHAT THIS IS FOR
-- The storefront's sort menu has offered "Best selling" since the day it was
-- built, and it has never done anything. Every product's popularity was zero,
-- so the sort returned the catalogue in its own order and looked like a sort
-- that had run.
--
-- Before this, the honest answer WAS zero: the generated catalogue made a
-- number up from each product's id, which gave a stable and completely
-- meaningless ranking, and api/_lib/shape.js replaced it with a real zero
-- rather than a plausible lie. Now there are orders to count.
--
-- COUNTED, NEVER CARRIED
-- No `units_sold` column on products. The same reasoning as customer_stats in
-- db/schema.sql: a stored total is correct until an order is cancelled and
-- something forgets to decrement it, and from then on it is quietly wrong in a
-- way nobody notices until the numbers are questioned. A view cannot drift
-- from the rows it reads.
--
-- CANCELLED ORDERS DO NOT COUNT
-- The same rule the dashboard, the reports screen and customer_stats already
-- apply: an order that was cancelled is not a sale. A product that was ordered
-- forty times and cancelled forty times is not the shop's best seller.
--
-- A DELETED PRODUCT'S LINES SURVIVE, AND ARE SKIPPED
-- order_items.product_id is `on delete set null`, so an order keeps its
-- history when a product is removed. Those lines have no product to credit
-- and are left out rather than grouped under null.
--
-- THIS VIEW IS NOT REACHABLE FROM A BROWSER, BY DESIGN
-- The grants at the bottom take it away from `anon` and `authenticated`
-- entirely, so no request carrying a browser's key can read it whatever the
-- policies underneath say. api/catalogue.js reads it as the server, because
-- how much of a product has sold is a fact about the shop rather than about
-- anybody's account — the same decision GET /api/checkout makes about the
-- delivery rate.
--
-- That is a stronger guarantee than marking the view security_invoker and
-- leaning on the policies inside it, and it does not depend on which
-- Postgres version this project is running.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- THE VIEW
-- -----------------------------------------------------------------------------

drop view if exists public.product_sales;

create view public.product_sales as
select
  oi.product_id                        as product_id,
  coalesce(sum(oi.qty), 0)::bigint     as units,
  count(distinct oi.order_id)::bigint  as orders,
  max(o.created_at)                    as last_sold_at
from public.order_items oi
join public.orders o
  on o.id = oi.order_id
 and o.status <> 'cancelled'
where oi.product_id is not null
group by oi.product_id;


-- -----------------------------------------------------------------------------
-- WHO MAY READ IT
--
-- Nobody with a browser's key. Revoked from both roles a browser can present,
-- so a direct request to /rest/v1/product_sales is refused before any policy
-- is consulted. The service role bypasses grants and is what the server uses.
-- -----------------------------------------------------------------------------

revoke all on public.product_sales from anon;
revoke all on public.product_sales from authenticated;


-- =============================================================================
-- DONE
-- -----------------------------------------------------------------------------
-- Nothing is stored. Place an order and the number moves; cancel it and the
-- number moves back.
-- =============================================================================
