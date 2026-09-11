/* =========================================================================
   api/checkout.js
   -------------------------------------------------------------------------
   POST /api/checkout      place an order

   A RECEIPT GOES OUT AFTERWARDS, AND CANNOT LOSE THE ORDER
   The confirmation email is sent once the order is written, through
   api/_lib/email.js, which never throws. A mail service that is down means a
   customer with an order and no receipt; it does not and must not mean a
   refused order.
   GET  /api/checkout      what the checkout page needs to draw itself

   WHAT THE BROWSER IS TRUSTED FOR: WHICH PRODUCTS, WHICH SIZES, HOW MANY.
   Nothing else. There is no price in the request body, no subtotal, no
   shipping and no total — not because they are ignored, but because there
   is nowhere to put them. A field that does not exist cannot be forged.

   Everything about money is decided by public.place_order in
   db/checkout.sql: it reads each price from the products table under a row
   lock, checks the coupon against the coupons table at the moment of
   ordering, takes the shipping rate from settings, and writes the arithmetic
   into a table whose own constraint refuses a total that does not add up.

   WHY THE WORK IS IN THE DATABASE AND NOT HERE
   An order is five writes that must all happen or none of them: the order,
   its lines, the stock coming down, the coupon's count going up, and the
   totals. PostgREST issues one statement at a time with no transaction
   around them, so written here a process that died half way through would
   leave stock deducted for an order nobody has. Inside the function it is
   one transaction. This file's job is to check the shape of the request,
   call it, and turn what it raises into something a person can read.

   THE FUNCTION IS CALLED AS THE CUSTOMER, NOT AS THE SERVER
   place_order takes no customer parameter: it reads auth.uid(). So it has
   to run on a client carrying the caller's own token, and there is no way
   for this endpoint — or a bug in it — to place an order in someone else's
   name.
   ========================================================================= */

'use strict';

var respond = require('../_lib/respond');
var validate = require('../_lib/validate');
var shape = require('../_lib/shape');
var auth = require('../_lib/auth');
var orderEmail = require('../_lib/order-email');
var db = require('../_lib/supabase');
var Errors = require('../_lib/errors');
var log = require('../_lib/log');

/* The codes place_order raises, and what each one means to the person who
   is trying to buy something. Anything else is ours to explain, not
   theirs — see the fallback below. */
var RAISED = {
  HV001: { status: 'conflict' },    /* out of stock */
  HV002: { status: 'conflict' },    /* no longer for sale */
  HV003: { status: 'badRequest' },  /* the coupon */
  HV004: { status: 'badRequest' },  /* the cart or the address */
  HV005: { status: 'forbidden' }    /* the account */
};

/* -------------------------------------------------------------------------
   GET — the numbers the checkout page shows before anything is ordered
   ------------------------------------------------------------------------- */

/**
 * The shipping rule, so the checkout page can show what delivery will cost
 * before the order exists.
 *
 * The same values place_order reads, from the same row. The page is
 * showing a preview; the order's own shipping is worked out again at the
 * moment it is placed, from this same setting, and that one is the one
 * that counts.
 */
async function shippingRule(client) {
  var result = await client.from('settings').select('store').eq('id', true).maybeSingle();

  /* Settings are readable by admins only, so an ordinary customer's client
     gets nothing back here rather than an error. The defaults below match
     db/checkout.sql, and a mismatch would show one price and charge
     another — so they are stated once in each place and tested against
     each other. */
  var store = (result.data && result.data.store) || {};
  var shipping = store.shipping || {};

  return {
    flat: Number.isFinite(shipping.flat) ? shipping.flat : 250,
    freeOver: Number.isFinite(shipping.freeOver) ? shipping.freeOver : 5000
  };
}

async function options(req) {
  await auth.requireUser(req);

  /* Read as the server: the shipping rate is not a secret, and the settings
     row is admin-only for everything else it holds. Nothing from the row
     but these two numbers leaves this function. */
  var rule = await shippingRule(db.asAdmin());

  return {
    shipping: rule,
    methods: [
      { id: 'cod', label: 'Cash on delivery',
        help: 'Pay the courier when the parcel arrives.' }
    ]
  };
}

/* -------------------------------------------------------------------------
   POST — place it
   ------------------------------------------------------------------------- */

function readCart(req) {
  var v = validate.body(req);

  /* A line is a product, a quantity and possibly a size. The validator
     rejects anything else in it rather than passing it through — a body
     carrying `price` is a request that thinks it decides one, and it
     should fail loudly rather than be quietly ignored. */
  var items = v.list('items', function (line) {
    if (!line || typeof line !== 'object') return null;

    var id = line.productId || line.id;
    if (typeof id !== 'string') return null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return null;
    }

    var qty = Number(line.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) return null;

    var size = typeof line.size === 'string' && line.size.trim()
      ? line.size.trim().slice(0, 20)
      : null;

    return { productId: id, qty: qty, size: size };
  }, { max: 50 });

  var name = v.str('name', { min: 2, max: 120 });
  var phone = v.str('phone', { min: 6, max: 30 });
  var line1 = v.str('line1', { min: 4, max: 200 });
  var line2 = v.str('line2', { optional: true, max: 200 });
  var city = v.str('city', { min: 2, max: 80 });
  var postcode = v.str('postcode', { optional: true, max: 20 });
  var note = v.str('note', { optional: true, max: 500 });
  var coupon = v.str('coupon', { optional: true, max: 40 });
  var method = v.oneOf('method', ['cod'], { optional: true, fallback: 'cod' });
  v.done();

  if (!items || !items.length) {
    throw Errors.badRequest('There is nothing in the cart.');
  }

  return {
    items: items,
    address: {
      name: name, phone: phone, line1: line1, line2: line2,
      city: city, postcode: postcode
    },
    note: note,
    coupon: coupon,
    method: method
  };
}

async function place(req) {
  var user = await auth.requireUser(req);
  var cart = readCart(req);

  /* As the customer. place_order reads auth.uid() and there is no
     parameter for it — see the header. */
  var client = db.asUser(req);

  var result = await client.rpc('place_order', {
    p_items: cart.items,
    p_address: cart.address,
    p_note: cart.note,
    p_coupon: cart.coupon,
    p_method: cart.method
  });

  if (result.error) {
    var raised = RAISED[result.error.code];

    if (raised) {
      /* The function wrote this message for the customer — "Only 2 left of
         Linen Shirt" — and it is more use than anything this file could
         say from here. */
      throw Errors[raised.status](result.error.message);
    }

    /* A missing function is the one failure worth naming plainly, because
       it means db/checkout.sql has not been run and every order will fail
       the same way until it is. */
    if (result.error.code === '42883' || result.error.code === 'PGRST202') {
      log.error('place_order is missing — db/checkout.sql has not been run',
                new Error(result.error.message));
      throw Errors.unavailable('Orders cannot be taken just now.');
    }

    log.error('the order could not be placed', new Error(result.error.message),
              { userId: user.id, code: result.error.code });
    throw Errors.internal();
  }

  /* The function returns the order row. Read it back with its lines so the
     confirmation can show what was actually bought at what was actually
     charged — rather than echoing back the cart the browser sent, which is
     the one version of events that has not been verified. */
  var placed = result.data;
  var id = placed && (placed.id || (placed[0] && placed[0].id));

  if (!id) {
    log.error('place_order returned nothing recognisable',
              new Error(JSON.stringify(placed).slice(0, 200)));
    throw Errors.internal();
  }

  var full = await client
    .from('orders')
    .select(shape.ORDER_SELECT)
    .eq('id', id)
    .single();

  if (full.error) throw Errors.internal().causedBy(new Error(full.error.message));

  var order = shape.customerOrder(full.data);

  /* ---- tell them it happened ------------------------------------------ */

  /* AWAITED, BUT ITS FAILURE IS NOT THIS ORDER'S PROBLEM
     api/_lib/email.js never throws: it returns whether it managed to send.
     So the order is already written and paid-for-on-delivery by the time
     this runs, and the worst case is a customer with an order and no
     receipt — which is what happened on every order until now.

     Awaited rather than left running, because a serverless function is
     stopped the moment it answers. A promise nobody waited for is a message
     that may or may not have left, depending on how quickly the platform
     tears the instance down, which is a worse thing to own than a request
     that takes a fraction of a second longer.

     The shop's own name, so the message is signed by the shop rather than by
     a hard-coded word. Read as the server because settings are not public in
     full and this is one field of them. */
  var named = await db.asAdmin()
    .from('settings').select('store').eq('id', true).maybeSingle();

  var shopName = (named.data && named.data.store && named.data.store.name) || 'HAVELI';

  var posted = await orderEmail.send(order, user.email, order.address && order.address.name,
                                     shopName);

  if (!posted.sent) {
    /* Worth a line, because a shop whose receipts have quietly stopped going
       out looks exactly like a shop whose receipts are going out. */
    log.info('order placed but no receipt was sent',
             { ref: order.ref, reason: posted.reason });
  }

  return { order: order };
}

/* ------------------------------------------------------------------------- */

module.exports = respond.handler(['GET', 'POST'], async function (req) {
  if (req.method === 'GET') return options(req);
  return place(req);
});
