/* =========================================================================
   api/account/cart.js
   -------------------------------------------------------------------------
   GET    /api/account/cart    the caller's saved cart
   PUT    /api/account/cart    replace it with what was sent
   DELETE /api/account/cart    empty it

   WHY THE WHOLE CART, NOT ONE LINE AT A TIME
   The storefront's cart is an array in the browser that every control edits
   in place — a quantity stepper, a remove button, a size chosen on a
   product page. Per-line endpoints would mean the browser and the server
   each keeping their own idea of the list and reconciling them, which is
   the part that goes wrong. Sending the list says what the cart now is,
   whatever it was.

   Last write wins, and for one person's own cart that is the right answer.

   NO PRICE IS ACCEPTED, AND NONE IS STORED
   db/schema.sql says it plainly: a cart line is a product, a size and a
   quantity. What it costs is whatever the product costs when the order is
   placed, read from the products table inside place_order. Storing a price
   here would mean a price change never reaching a cart filled last week —
   and accepting one from the browser would mean the shop being told what to
   charge, which is the thing the whole checkout is built to refuse.

   The prices this endpoint RETURNS are today's, read back from the
   products table, so the cart shows what it will cost. They are a display,
   not a quote.

   A LINE WHOSE PRODUCT IS GONE IS LEFT OUT
   Not an error and not a placeholder row. The product was withdrawn or
   archived between one visit and the next, and the cart page already knows
   how to say that about lines the catalogue no longer has.
   ========================================================================= */

'use strict';

var respond = require('../../_lib/respond');
var validate = require('../../_lib/validate');
var shape = require('../../_lib/shape');
var auth = require('../../_lib/auth');
var db = require('../../_lib/supabase');
var Errors = require('../../_lib/errors');

/* More lines than anybody shops with, and small enough that replacing the
   lot is a handful of rows rather than a migration. */
var MAX_LINES = 50;

/* The same ceiling the schema puts on a line and api/checkout.js puts on an
   order line. Three places agreeing beats one place deciding. */
var MAX_QTY = 99;

/* ------------------------------------------------------------------------- */

/** The caller's cart row, made if they have never had one. */
async function cartOf(client, user) {
  var found = await client
    .from('carts')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (found.error) throw Errors.internal().causedBy(new Error(found.error.message));
  if (found.data) return found.data.id;

  /* upsert rather than insert: two tabs signing in at once would otherwise
     race on the unique index and one of them would fail for no reason the
     shopper could act on. */
  var made = await client
    .from('carts')
    .upsert({ user_id: user.id }, { onConflict: 'user_id' })
    .select('id');

  if (made.error) throw Errors.internal().causedBy(new Error(made.error.message));
  if (!made.data || !made.data.length) {
    throw Errors.internal().causedBy(new Error('the cart could not be created'));
  }

  return made.data[0].id;
}

async function read(client, cartId) {
  var result = await client
    .from('cart_items')
    .select(shape.CART_SELECT)
    .eq('cart_id', cartId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  if (result.error) throw Errors.internal().causedBy(new Error(result.error.message));

  var lines = (result.data || [])
    .map(shape.cartLine)
    .filter(function (line) { return line; });

  return {
    items: lines,
    count: lines.reduce(function (n, l) { return n + l.qty; }, 0)
  };
}

/* ------------------------------------------------------------------------- */

async function replace(req, client, user) {
  var v = validate.body(req);
  var body = v.source;

  if (!Array.isArray(body.items)) {
    throw Errors.badRequest('A cart has to be sent as a list of items.');
  }

  if (body.items.length > MAX_LINES) {
    throw Errors.badRequest('That is more than ' + MAX_LINES + ' different items.');
  }

  var seen = {};
  var lines = [];

  body.items.forEach(function (item, i) {
    var at = 'items[' + i + ']';

    if (!item || typeof item !== 'object') {
      throw Errors.badRequest('Check the details and try again.', { items: 'A line at ' + at + ' is not an item.' });
    }

    var id = String(item.productId || '');

    if (!validate.UUID.test(id)) {
      throw Errors.badRequest('Check the details and try again.', {
        items: 'A line at ' + at + ' does not name a product.'
      });
    }

    var qty = Number(item.qty);

    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      throw Errors.badRequest('Check the details and try again.', {
        items: 'A line at ' + at + ' has a quantity of ' + item.qty + '.'
      });
    }

    var size = item.size === null || item.size === undefined || item.size === ''
      ? null
      : String(item.size).trim().slice(0, 40);

    /* The same product in the same size is one line, which is what the
       storefront's cart does and what the unique index insists on. Sending
       two is a bug in the caller rather than an intention, so they are
       added together rather than refused. */
    var key = id + '|' + (size === null ? '' : size);

    if (seen[key] !== undefined) {
      lines[seen[key]].qty = Math.min(MAX_QTY, lines[seen[key]].qty + qty);
      return;
    }

    seen[key] = lines.length;
    lines.push({ product_id: id, size: size, qty: qty });
  });

  var cartId = await cartOf(client, user);

  /* Emptied and refilled. There is no transaction across two PostgREST
     requests, so a failure between them leaves the cart empty rather than
     half-old — which is recoverable, because the browser still holds the
     list it just sent and pushes it again on the next change. Merging
     line-by-line instead would need to know which lines were removed, and
     that is the state this endpoint exists to avoid keeping. */
  var cleared = await client.from('cart_items').delete().eq('cart_id', cartId);
  if (cleared.error) throw Errors.internal().causedBy(new Error(cleared.error.message));

  if (lines.length) {
    /* THE ORDER THEY WERE SENT IN IS THE ORDER THEY COME BACK IN
       created_at defaults to now(), and now() is the transaction's clock —
       so every row of one insert shares a timestamp to the microsecond and
       the read falls back to breaking the tie by id. The cart then reads
       back shuffled on a device that has not seen it before, which is the
       one device this whole endpoint exists for.

       A millisecond apart each, oldest first, so the list keeps the shape
       the shopper built. The same problem as the paged product list in
       Phase 6, and the same lesson: a sort with ties is not a sort. */
    var base = Date.now() - lines.length;

    var rows = lines.map(function (line, i) {
      return {
        cart_id: cartId,
        product_id: line.product_id,
        size: line.size,
        qty: line.qty,
        created_at: new Date(base + i).toISOString()
      };
    });

    var wrote = await client.from('cart_items').insert(rows);

    if (wrote.error) {
      /* 23503 is a foreign key: a product that no longer exists. The
         browser's cart is older than the catalogue, which is ordinary. */
      if (wrote.error.code === '23503') {
        throw Errors.conflict('Something in your cart is no longer sold here. ' +
                              'Reload the page and try again.');
      }
      throw Errors.internal().causedBy(new Error(wrote.error.message));
    }
  }

  return read(client, cartId);
}

/* ------------------------------------------------------------------------- */

module.exports = respond.handler(['GET', 'PUT', 'DELETE'], async function (req) {
  var user = await auth.requireUser(req);
  var client = db.asUser(req);

  if (req.method === 'GET') {
    var found = await client
      .from('carts')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (found.error) throw Errors.internal().causedBy(new Error(found.error.message));

    /* No cart row is an empty cart, not a 404. Somebody who has never put
       anything in one has an empty cart, and saying so is the answer. */
    if (!found.data) return { items: [], count: 0 };

    return read(client, found.data.id);
  }

  if (req.method === 'PUT') return replace(req, client, user);

  var cartId = await cartOf(client, user);
  var cleared = await client.from('cart_items').delete().eq('cart_id', cartId);

  if (cleared.error) throw Errors.internal().causedBy(new Error(cleared.error.message));

  return { items: [], count: 0 };
});
