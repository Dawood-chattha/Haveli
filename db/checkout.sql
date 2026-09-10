-- =============================================================================
-- db/checkout.sql — placing an order, atomically, at prices the server decides
-- -----------------------------------------------------------------------------
-- Run this in the Supabase SQL editor after db/schema.sql and db/policies.sql.
-- Running it twice is safe: everything here is create-or-replace, and the
-- settings update only fills in a value that is missing.
--
--
-- WHY THIS IS A DATABASE FUNCTION AND NOT SERVER CODE
--
-- Placing an order is five writes that must all happen or none of them:
-- the order, its lines, the stock coming down, the coupon's use being counted,
-- and the order's total. PostgREST gives the API one statement at a time, with
-- no transaction around them. Written in JavaScript, a process that died
-- between the third and the fourth would leave stock deducted for an order
-- that does not exist — and nothing would ever notice.
--
-- Inside one function this is one transaction. It commits whole or not at all.
--
--
-- WHY IT IS SECURITY DEFINER, AND WHAT THAT OBLIGES
--
-- `orders` has no insert policy, deliberately: if customers could write orders
-- directly they could write their own totals. This function runs as its owner
-- and can therefore insert, which makes it the ONLY way an order is created —
-- and makes everything inside it security-critical.
--
-- So:
--   * the customer is `auth.uid()`, never a parameter. There is no way to
--     place an order as somebody else, because there is nowhere to say who.
--   * prices come from `products`, never from the caller. The caller sends
--     product ids and quantities; that is all it is trusted for.
--   * the discount comes from `coupons`, checked here — dates, limit, minimum
--     spend, disabled — not from anything the browser worked out.
--   * `search_path` is pinned, so a schema planted by a caller cannot make
--     `products` mean something else.
--   * execute is granted to `authenticated` only. A signed-out visitor cannot
--     reach it at all.
--
-- The check constraint on `orders` remains the last line of defence: even a
-- bug in this function cannot store a total that does not add up.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Order references
--
-- A sequence rather than random characters. A random reference has to be
-- checked for collisions and retried on failure, inside the same transaction
-- that is holding stock — a loop nobody wants there. A sequence cannot
-- collide, and the number is not a secret: it says how many orders the shop
-- has taken, which the shop's own owner already knows.
-- -----------------------------------------------------------------------------

create sequence if not exists public.order_ref_seq start with 1001;


-- -----------------------------------------------------------------------------
-- A THIRD KIND OF COUPON: FREE DELIVERY
--
-- The panel's coupon form has always offered three kinds — a percentage off,
-- an amount off, and free delivery — and the table accepted only the first
-- two. So an owner could choose "Free delivery", fill in the form, and be
-- refused by a constraint with a message written for a developer.
--
-- A free-delivery coupon does not discount the goods. It sets the delivery
-- charge to nothing, which is a different line on the order and a different
-- number in the arithmetic; place_order below treats it that way.
--
-- The old constraints are found rather than named. A check constraint written
-- inline on a column is named by Postgres, and guessing that name is how a
-- migration silently does nothing.
-- -----------------------------------------------------------------------------

do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.coupons'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%type%'
  loop
    execute format('alter table public.coupons drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.coupons
  add constraint coupons_type_allowed
  check (type in ('percent', 'fixed', 'shipping'));

alter table public.coupons
  add constraint coupons_percent_within_100
  check (type <> 'percent' or value <= 100);

-- A free-delivery coupon has no amount, so the "greater than zero" rule that
-- makes sense for the other two would refuse it.
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.coupons'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%value%'
       and pg_get_constraintdef(oid) not ilike '%type%'
  loop
    execute format('alter table public.coupons drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.coupons
  add constraint coupons_value_sensible
  check ((type = 'shipping' and value >= 0) or value > 0);


-- -----------------------------------------------------------------------------
-- Shipping, as a setting rather than a number in the code
--
-- Filled in only if it is absent, so re-running this never overwrites what the
-- owner has chosen. Whole rupees, like every other amount in this database.
-- -----------------------------------------------------------------------------

update public.settings
   set store = store || jsonb_build_object(
                 'shipping', jsonb_build_object('flat', 250, 'freeOver', 5000))
 where id = true
   and not (store ? 'shipping');


-- =============================================================================
-- place_order
-- -----------------------------------------------------------------------------
-- p_items    [{ "productId": uuid, "qty": int, "size": text or null }, ...]
-- p_address  the delivery address, stored as a snapshot on the order
-- p_note     the customer's note, or null
-- p_coupon   a code to try, or null
-- p_method   'cod' for now; the schema also allows card, bank and wallet
--
-- Returns the order row.
--
-- Raises, with a code the API turns into a message:
--   HV001  something in the cart is out of stock
--   HV002  something in the cart is no longer for sale
--   HV003  the coupon cannot be used
--   HV004  the cart itself is not valid
--   HV005  the account cannot place orders
-- =============================================================================

create or replace function public.place_order(
  p_items   jsonb,
  p_address jsonb,
  p_note    text default null,
  p_coupon  text default null,
  p_method  text default 'cod'
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user      uuid := auth.uid();
  v_blocked   boolean;
  v_item      jsonb;
  v_product   public.products%rowtype;
  v_qty       integer;
  v_size      text;
  v_count     integer := 0;

  v_subtotal  integer := 0;
  v_discount  integer := 0;
  v_shipping  integer := 0;
  v_total     integer;

  v_ship_flat integer;
  v_ship_free integer;

  v_coupon    public.coupons%rowtype;
  v_order     public.orders%rowtype;
begin
  -- ---------------------------------------------------------------------------
  -- Who is ordering
  -- ---------------------------------------------------------------------------

  if v_user is null then
    raise exception 'Sign in to place an order.' using errcode = 'HV005';
  end if;

  select blocked into v_blocked from public.profiles where id = v_user;

  if v_blocked is null then
    raise exception 'This account cannot place orders.' using errcode = 'HV005';
  end if;

  if v_blocked then
    raise exception 'This account has been suspended.' using errcode = 'HV005';
  end if;

  -- ---------------------------------------------------------------------------
  -- Is this a cart at all
  -- ---------------------------------------------------------------------------

  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'There is nothing in the cart.' using errcode = 'HV004';
  end if;

  if jsonb_array_length(p_items) > 50 then
    raise exception 'That is too many different items for one order.'
      using errcode = 'HV004';
  end if;

  if p_address is null or jsonb_typeof(p_address) <> 'object'
     or coalesce(p_address->>'name', '') = ''
     or coalesce(p_address->>'phone', '') = ''
     or coalesce(p_address->>'line1', '') = ''
     or coalesce(p_address->>'city', '') = '' then
    raise exception 'The delivery address is incomplete.' using errcode = 'HV004';
  end if;

  if p_method not in ('cod', 'card', 'bank', 'wallet') then
    raise exception 'That payment method is not offered.' using errcode = 'HV004';
  end if;

  -- ---------------------------------------------------------------------------
  -- The order, before it has any lines or any amounts
  --
  -- Written first so the lines have something to point at. Its totals are zero
  -- for the moment and are set at the end, once they are known — which is safe
  -- because nothing outside this transaction can see the row until it commits.
  -- ---------------------------------------------------------------------------

  insert into public.orders (ref, user_id, status, payment_status, method,
                             subtotal, discount, shipping, total, address, note)
  values ('HAV-' || to_char(now() at time zone 'utc', 'YYMM') || '-' ||
                    lpad(nextval('public.order_ref_seq')::text, 5, '0'),
          v_user, 'pending', 'unpaid', p_method,
          0, 0, 0, 0, p_address, nullif(btrim(coalesce(p_note, '')), ''))
  returning * into v_order;

  -- ---------------------------------------------------------------------------
  -- The lines
  --
  -- FOR UPDATE on each product is what makes two people buying the last item
  -- safe. The second transaction waits at this line until the first has
  -- committed, and then reads the stock the first one left behind — rather
  -- than both reading "1 in stock" and both succeeding.
  -- ---------------------------------------------------------------------------

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_count := v_count + 1;

    if (v_item->>'productId') is null then
      raise exception 'One of the items is not a product.' using errcode = 'HV004';
    end if;

    v_qty := coalesce((v_item->>'qty')::integer, 0);

    if v_qty < 1 or v_qty > 20 then
      raise exception 'A quantity must be between 1 and 20.' using errcode = 'HV004';
    end if;

    v_size := nullif(btrim(coalesce(v_item->>'size', '')), '');

    select * into v_product
      from public.products
     where id = (v_item->>'productId')::uuid
       for update;

    if not found then
      raise exception 'Something in the cart is no longer sold here.'
        using errcode = 'HV002';
    end if;

    if v_product.status <> 'active' then
      raise exception '"%" is no longer for sale.', v_product.title
        using errcode = 'HV002';
    end if;

    -- A size that is not one of the product's own is a cart built against an
    -- older version of the product, or by hand.
    if v_size is not null
       and coalesce(array_length(v_product.sizes, 1), 0) > 0
       and not (v_size = any (v_product.sizes)) then
      raise exception '"%" does not come in size %.', v_product.title, v_size
        using errcode = 'HV004';
    end if;

    if v_product.stock < v_qty then
      if v_product.stock = 0 then
        raise exception '"%" has just sold out.', v_product.title
          using errcode = 'HV001';
      end if;

      raise exception 'Only % left of "%".', v_product.stock, v_product.title
        using errcode = 'HV001';
    end if;

    update public.products
       set stock = stock - v_qty
     where id = v_product.id;

    -- THE PRICE COMES FROM HERE, from the row just read under lock. Nothing
    -- the caller sent about money is looked at anywhere in this function.
    insert into public.order_items (order_id, product_id, title, image,
                                    price, qty, size)
    values (v_order.id, v_product.id, v_product.title,
            (select url from public.product_images
              where product_id = v_product.id
              order by sort asc, created_at asc
              limit 1),
            v_product.price, v_qty, v_size);

    v_subtotal := v_subtotal + (v_product.price * v_qty);
  end loop;

  -- ---------------------------------------------------------------------------
  -- The coupon
  --
  -- Every condition is checked here, against the coupons table, at the moment
  -- of ordering. A coupon that expired while the checkout page was open is
  -- refused, which is the whole reason this is not decided in a browser.
  -- ---------------------------------------------------------------------------

  if nullif(btrim(coalesce(p_coupon, '')), '') is not null then
    select * into v_coupon
      from public.coupons
     where lower(code) = lower(btrim(p_coupon))
       for update;

    if not found then
      raise exception 'That code is not one of ours.' using errcode = 'HV003';
    end if;

    if v_coupon.disabled then
      raise exception 'That code is no longer active.' using errcode = 'HV003';
    end if;

    if v_coupon.starts_at is not null and v_coupon.starts_at > now() then
      raise exception 'That code cannot be used yet.' using errcode = 'HV003';
    end if;

    if v_coupon.expires_at is not null and v_coupon.expires_at <= now() then
      raise exception 'That code has expired.' using errcode = 'HV003';
    end if;

    if v_coupon.usage_limit is not null
       and v_coupon.used_count >= v_coupon.usage_limit then
      raise exception 'That code has been used as many times as it can be.'
        using errcode = 'HV003';
    end if;

    if v_subtotal < v_coupon.min_spend then
      raise exception 'That code needs an order of at least %.',
                      v_coupon.min_spend using errcode = 'HV003';
    end if;

    if v_coupon.type = 'percent' then
      v_discount := (v_subtotal * v_coupon.value) / 100;
    elsif v_coupon.type = 'shipping' then
      -- It discounts the delivery, not the goods. The shipping section below
      -- is where it takes effect.
      v_discount := 0;
    else
      v_discount := v_coupon.value;
    end if;

    -- A fixed discount larger than the order does not make the shop pay the
    -- customer. The schema refuses it too; this makes it a sensible number
    -- rather than a constraint error.
    if v_discount > v_subtotal then
      v_discount := v_subtotal;
    end if;

    update public.coupons
       set used_count = used_count + 1
     where id = v_coupon.id;
  end if;

  -- ---------------------------------------------------------------------------
  -- Shipping
  --
  -- From settings, with the same defaults this file writes there, so a
  -- settings row that somehow lacks them still produces a sane order rather
  -- than a free delivery nobody agreed to.
  -- ---------------------------------------------------------------------------

  select coalesce((store->'shipping'->>'flat')::integer, 250),
         coalesce((store->'shipping'->>'freeOver')::integer, 5000)
    into v_ship_flat, v_ship_free
    from public.settings
   where id = true;

  v_ship_flat := coalesce(v_ship_flat, 250);
  v_ship_free := coalesce(v_ship_free, 5000);

  -- Measured on what is actually being paid for the goods. Charging delivery
  -- on the pre-discount figure would make a coupon quietly worth less than it
  -- says.
  if v_ship_free > 0 and (v_subtotal - v_discount) >= v_ship_free then
    v_shipping := 0;
  else
    v_shipping := v_ship_flat;
  end if;

  -- A free-delivery coupon, which is the whole of what it does. Applied after
  -- the rule above rather than instead of it, so an order that was already
  -- over the free threshold is not charged for using one.
  if v_coupon.type = 'shipping' then
    v_shipping := 0;
  end if;

  -- ---------------------------------------------------------------------------
  -- The amounts
  -- ---------------------------------------------------------------------------

  v_total := v_subtotal - v_discount + v_shipping;

  update public.orders
     set subtotal    = v_subtotal,
         discount    = v_discount,
         shipping    = v_shipping,
         total       = v_total,
         coupon_id   = v_coupon.id,
         coupon_code = case when v_coupon.id is null then null else v_coupon.code end
   where id = v_order.id
  returning * into v_order;

  return v_order;
end;
$$;


-- -----------------------------------------------------------------------------
-- Who may call it
--
-- Not the public. A signed-out visitor reaching this function would get as far
-- as its first line and be refused, but the grant is where that is decided
-- rather than left to the code.
-- -----------------------------------------------------------------------------

revoke all on function public.place_order(jsonb, jsonb, text, text, text) from public;
revoke all on function public.place_order(jsonb, jsonb, text, text, text) from anon;
grant execute on function public.place_order(jsonb, jsonb, text, text, text) to authenticated;
grant execute on function public.place_order(jsonb, jsonb, text, text, text) to service_role;

-- The sequence is used inside a SECURITY DEFINER function, which runs as its
-- owner, so nobody else needs rights to it.
revoke all on sequence public.order_ref_seq from public;
revoke all on sequence public.order_ref_seq from anon;
revoke all on sequence public.order_ref_seq from authenticated;


-- =============================================================================
-- set_order_status
-- -----------------------------------------------------------------------------
-- Moving an order between statuses, and putting the stock back when one is
-- cancelled.
--
-- WHY THIS IS NOT A PLAIN UPDATE
--
-- "orders: admins update" would let the panel change the status directly, and
-- for four of the five statuses that would be right — pending to processing to
-- shipped to delivered changes nothing but a word.
--
-- Cancelling is different. The stock came down when the order was placed. If
-- cancelling only changed the word, those items would stay reserved for an
-- order that will never ship, and the shop would quietly stop being able to
-- sell things it has on the shelf. Nobody would connect the two.
--
-- So cancelling returns the stock and gives the coupon back its use, and
-- un-cancelling takes them again — refusing if the stock is no longer there,
-- which is the honest answer rather than a negative quantity.
--
-- Both directions are several writes that must agree, so both are one
-- transaction, for the same reason place_order is.
--
-- Raises:
--   HV001  the stock to un-cancel with is no longer there
--   HV004  not a status this database has
--   HV006  the order does not exist, or you may not change it
-- =============================================================================

create or replace function public.set_order_status(
  p_order  uuid,
  p_status text
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_line  public.order_items%rowtype;
  v_stock integer;
begin
  -- The one authorization check, and it is the same function every policy in
  -- db/policies.sql uses. SECURITY DEFINER means the policies do not apply
  -- inside here, so this is not a second opinion — it is the only one.
  if not public.is_admin() then
    raise exception 'You do not have access to this.' using errcode = 'HV006';
  end if;

  if p_status not in ('pending', 'processing', 'shipped', 'delivered', 'cancelled') then
    raise exception 'That is not a status an order can have.' using errcode = 'HV004';
  end if;

  select * into v_order from public.orders where id = p_order for update;

  if not found then
    raise exception 'That order no longer exists.' using errcode = 'HV006';
  end if;

  -- Nothing to do, and nothing to undo. Returning early rather than moving
  -- stock twice for a button pressed twice.
  if v_order.status = p_status then
    return v_order;
  end if;

  -- ---------------------------------------------------------------------------
  -- Cancelling: everything the order took, it gives back
  -- ---------------------------------------------------------------------------

  if p_status = 'cancelled' then
    for v_line in
      select * from public.order_items where order_id = v_order.id
    loop
      -- product_id is null when the product was deleted outright. The line
      -- keeps its title and price so the order still reads correctly; there
      -- is simply no shelf left to put it back on.
      if v_line.product_id is not null then
        update public.products
           set stock = stock + v_line.qty
         where id = v_line.product_id;
      end if;
    end loop;

    if v_order.coupon_id is not null then
      update public.coupons
         set used_count = greatest(used_count - 1, 0)
       where id = v_order.coupon_id;
    end if;

  -- ---------------------------------------------------------------------------
  -- Un-cancelling: it has to take the stock again, and may not be able to
  -- ---------------------------------------------------------------------------

  elsif v_order.status = 'cancelled' then
    for v_line in
      select * from public.order_items where order_id = v_order.id
    loop
      if v_line.product_id is not null then
        select stock into v_stock
          from public.products
         where id = v_line.product_id
           for update;

        if v_stock is null or v_stock < v_line.qty then
          raise exception 'There is no longer enough stock of "%" to reopen this order.',
                          v_line.title using errcode = 'HV001';
        end if;

        update public.products
           set stock = stock - v_line.qty
         where id = v_line.product_id;
      end if;
    end loop;

    if v_order.coupon_id is not null then
      update public.coupons
         set used_count = used_count + 1
       where id = v_order.coupon_id;
    end if;
  end if;

  update public.orders
     set status = p_status
   where id = v_order.id
  returning * into v_order;

  return v_order;
end;
$$;

revoke all on function public.set_order_status(uuid, text) from public;
revoke all on function public.set_order_status(uuid, text) from anon;
grant execute on function public.set_order_status(uuid, text) to authenticated;
grant execute on function public.set_order_status(uuid, text) to service_role;
