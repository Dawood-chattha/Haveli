/* =========================================================================
   api/admin/settings.js
   -------------------------------------------------------------------------
   GET   /api/admin/settings    the shop's own record
   PATCH /api/admin/settings    change part of it

   THE ONE SETTING THAT DECIDES MONEY
   `store.shipping` is not a preference. public.place_order reads it, in
   SQL, at the moment an order is priced — see the Shipping block in
   db/checkout.sql — and GET /api/checkout shows the same two numbers to a
   shopper before they order. Until this file existed there was no way to
   put them there: the row said 250 and 5000 because the seed wrote them,
   and the owner of the shop could not change what delivery costs.

   That is also why they are validated here as carefully as a price. A
   delivery charge is money a customer is asked for, and the difference
   between 250 and 250000 is a typo.

   WHAT IS RECORDED AND WHAT IS IN FORCE
   The screen has always drawn that distinction and it stays true:

     store.shipping.*    in force  — place_order and the checkout page
     store.lowStockAt    in force  — the product list and the inventory screen
     store.name, and the
       contact details    recorded  — saved, and nothing reads them yet
     notifications.*      recorded  — nothing can send a message in this build

   "Recorded" now means a row in the database rather than a variable in
   somebody's browser, which is the whole of what changed. It does not mean
   anything started sending email, and the page must not say it did.

   READ, MERGE, WRITE — AND WHY THAT IS ENOUGH HERE
   `store` and `notifications` are jsonb columns, so a write replaces the
   whole object. Sending only the changed keys therefore means reading the
   current value, merging over it, and writing it back — two statements,
   with no transaction between them. Two people saving the same section in
   the same second would leave one of them overwritten.

   That is accepted rather than overlooked: this is one shop's settings
   screen, the loser sees the winner's values the moment they reload, and
   nothing is lost that cannot be typed again. It is not the checkout, where
   the same reasoning would be wrong and where the arithmetic is in SQL for
   exactly that reason.

   NO PASSWORD, NO KEY, NO ROLE
   Nothing that grants access may be stored here, and `role` in particular
   is refused: whatever a frontend writes into a field called "role" is a
   label on a screen. Permission is decided by the database, on every read
   and write, from the token the request arrived with.
   ========================================================================= */

'use strict';

var respond = require('../../_lib/respond');
var validate = require('../../_lib/validate');
var auth = require('../../_lib/auth');
var db = require('../../_lib/supabase');
var Errors = require('../../_lib/errors');

/* What the shop opens with when the row has never been filled in. The same
   numbers db/checkout.sql falls back to, deliberately: a settings row that
   somehow lacks them still produces the delivery charge the shop has been
   quoting rather than a free delivery nobody agreed to. */
var DEFAULT_SHIPPING = { flat: 250, freeOver: 5000 };
var DEFAULT_LOW_STOCK = 10;

/* A hundred thousand rupees of delivery on one order. Not a technical
   limit — a limit on what can be a typo rather than an intention. */
var MAX_SHIPPING = 100000;

/* Ten million rupees before delivery is free, which is to say never. Wide
   enough for any real threshold and narrow enough to catch a slipped key. */
var MAX_FREE_OVER = 10000000;

var NOTICE_KEYS = ['newOrder', 'orderCancelled', 'lowStock', 'newCustomer',
                   'weeklySummary'];

/* -------------------------------------------------------------------------
   Reading
   ------------------------------------------------------------------------- */

async function current(client) {
  var result = await client
    .from('settings')
    .select('store, notifications, updated_at')
    .eq('id', true)
    .maybeSingle();

  if (result.error) throw Errors.internal().causedBy(new Error(result.error.message));

  /* db/schema.sql inserts the row and there is a check constraint keeping
     it the only one, so this is a database that has not been set up rather
     than a shop with no settings. Saying so plainly beats an empty screen. */
  if (!result.data) {
    throw Errors.internal().causedBy(new Error('the settings row is missing'));
  }

  return result.data;
}

/**
 * The record as the panel reads it, with the gaps filled in.
 *
 * The columns start as `{}` and are filled a section at a time, so almost
 * every read is of a partial object. The defaults are applied here rather
 * than in the panel so that the shipping numbers the checkout quotes and
 * the ones this screen shows come from one place.
 */
function shapeSettings(row) {
  var store = row.store || {};
  var shipping = store.shipping || {};
  var notices = row.notifications || {};

  var whole = function (value, fallback) {
    return Number.isInteger(value) && value >= 0 ? value : fallback;
  };

  var out = {
    store: {
      name: store.name || '',
      tagline: store.tagline || '',
      supportEmail: store.supportEmail || '',
      phone: store.phone || '',
      address: store.address || '',
      city: store.city || '',
      lowStockAt: whole(store.lowStockAt, DEFAULT_LOW_STOCK) || DEFAULT_LOW_STOCK,

      shipping: {
        flat: whole(shipping.flat, DEFAULT_SHIPPING.flat),
        freeOver: whole(shipping.freeOver, DEFAULT_SHIPPING.freeOver)
      }
    },

    notifications: {
      sendTo: notices.sendTo || ''
    },

    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null
  };

  NOTICE_KEYS.forEach(function (key) {
    out.notifications[key] = !!notices[key];
  });

  return out;
}

/* -------------------------------------------------------------------------
   Writing
   ------------------------------------------------------------------------- */

/**
 * The store section, out of a request body.
 *
 * Only what was sent is looked at, so saving the delivery charge does not
 * clear the shop's phone number, and clearing the tagline is possible while
 * forgetting to resend it is not the same thing.
 */
function readStore(source) {
  var v = new validate.Checker(source);
  var has = function (key) { return Object.prototype.hasOwnProperty.call(source, key); };

  var patch = {};

  if (has('name')) patch.name = v.str('name', { max: 80 });
  if (has('tagline')) patch.tagline = v.str('tagline', { optional: true, max: 160 });
  if (has('supportEmail')) patch.supportEmail = v.email('supportEmail', { optional: true });
  if (has('phone')) patch.phone = v.str('phone', { optional: true, max: 40 });
  if (has('address')) patch.address = v.str('address', { optional: true, max: 200 });
  if (has('city')) patch.city = v.str('city', { optional: true, max: 80 });

  /* At least one. At zero nothing would ever be flagged as running low,
     which is not a threshold — it is the feature switched off wearing a
     number. The screen says the same thing in the same words. */
  if (has('lowStockAt')) patch.lowStockAt = v.int('lowStockAt', { min: 1, max: 999 });

  if (has('shipping')) {
    var sent = source.shipping;

    if (!sent || typeof sent !== 'object' || Array.isArray(sent)) {
      throw Errors.badRequest('Check the details and try again.', {
        shipping: 'Delivery has to be sent as a charge and a threshold.'
      });
    }

    var s = new validate.Checker(sent);
    var shipping = {};

    /* Zero is a real answer here — a shop that delivers free always — so it
       is allowed, and it is the only one of the two that means what it
       looks like. */
    if (Object.prototype.hasOwnProperty.call(sent, 'flat')) {
      shipping.flat = s.int('flat', { min: 0, max: MAX_SHIPPING });
    }

    /* Zero here means the opposite of free: no order is ever large enough,
       so delivery is always charged. place_order reads it exactly that way
       (`if v_ship_free > 0 and ...`), and the screen has to say so, because
       "0" in a box labelled "free delivery over" reads as "always". */
    if (Object.prototype.hasOwnProperty.call(sent, 'freeOver')) {
      shipping.freeOver = s.int('freeOver', { min: 0, max: MAX_FREE_OVER });
    }

    s.done();

    if (Object.keys(shipping).length) patch.shipping = shipping;
  }

  v.done();
  return patch;
}

function readNotifications(source) {
  var v = new validate.Checker(source);
  var has = function (key) { return Object.prototype.hasOwnProperty.call(source, key); };

  var patch = {};

  NOTICE_KEYS.forEach(function (key) {
    if (has(key)) patch[key] = v.bool(key);
  });

  if (has('sendTo')) patch.sendTo = v.email('sendTo', { optional: true });

  v.done();
  return patch;
}

/**
 * One section, merged over what is there.
 *
 * Shipping is merged a level deeper than the rest: saving the flat charge
 * on its own must not erase the threshold beside it.
 */
function merge(existing, patch) {
  var out = {};

  Object.keys(existing || {}).forEach(function (key) { out[key] = existing[key]; });
  Object.keys(patch).forEach(function (key) { out[key] = patch[key]; });

  if (patch.shipping) {
    var was = (existing && existing.shipping) || {};
    out.shipping = {
      flat: patch.shipping.flat !== undefined ? patch.shipping.flat
          : Number.isInteger(was.flat) ? was.flat : DEFAULT_SHIPPING.flat,
      freeOver: patch.shipping.freeOver !== undefined ? patch.shipping.freeOver
              : Number.isInteger(was.freeOver) ? was.freeOver : DEFAULT_SHIPPING.freeOver
    };
  }

  return out;
}

async function save(req, client) {
  var v = validate.body(req);
  var body = v.source;
  var has = function (key) { return Object.prototype.hasOwnProperty.call(body, key); };

  /* Named here rather than accepted as whatever arrived. A body carrying
     `appearance` would otherwise be stored — and appearance is a preference
     about one browser on one desk, which belongs in that browser. */
  if (!has('store') && !has('notifications')) {
    throw Errors.badRequest('There was nothing to change.');
  }

  var changes = {};

  if (has('store')) {
    if (!body.store || typeof body.store !== 'object' || Array.isArray(body.store)) {
      throw Errors.badRequest('The store details must be sent as an object.');
    }
    changes.store = readStore(body.store);
  }

  if (has('notifications')) {
    if (!body.notifications || typeof body.notifications !== 'object' ||
        Array.isArray(body.notifications)) {
      throw Errors.badRequest('The notification settings must be sent as an object.');
    }
    changes.notifications = readNotifications(body.notifications);
  }

  var empty = Object.keys(changes).every(function (name) {
    return !Object.keys(changes[name]).length;
  });

  if (empty) throw Errors.badRequest('There was nothing to change.');

  var row = await current(client);

  var patch = {};

  if (changes.store) patch.store = merge(row.store, changes.store);
  if (changes.notifications) {
    patch.notifications = merge(row.notifications, changes.notifications);
  }

  var written = await client
    .from('settings')
    .update(patch)
    .eq('id', true)
    .select('store, notifications, updated_at');

  if (written.error) throw Errors.internal().causedBy(new Error(written.error.message));

  /* An update refused by row-level security comes back successful with no
     rows — see api/_lib/rows.js, where this cost an afternoon once. There
     is exactly one settings row, so no rows here means the policy said no,
     never that the row was not found. */
  if (!written.data || !written.data.length) {
    throw Errors.forbidden('You do not have access to this.');
  }

  return { settings: shapeSettings(written.data[0]) };
}

/* ------------------------------------------------------------------------- */

module.exports = respond.handler(['GET', 'PATCH'], async function (req) {
  await auth.requireAdmin(req);

  var client = db.asUser(req);

  if (req.method === 'GET') {
    return { settings: shapeSettings(await current(client)) };
  }

  return save(req, client);
});
