/* =========================================================================
   api/admin/coupons/index.js
   -------------------------------------------------------------------------
   GET  /api/admin/coupons    every coupon
   POST /api/admin/coupons    create one

   THESE ARE THE CODES place_order ALREADY CHECKS
   The checkout has been reading this table since Phase 5 — the dates, the
   minimum spend, the usage limit, whether it is switched off — and there
   was no way to put a row in it. This is that way. Nothing about how a
   coupon is *applied* lives here; that is in db/checkout.sql, in SQL, at
   the moment of ordering, which is the only moment the answer is true.

   NOT PAGED
   A shop runs a handful of promotions, and the screen sorts by "ending
   soonest" and by "most used" — both of which need all of them. The cap
   below is where that stops being reasonable, and it is generous.

   `used_count` IS NOT ACCEPTED FROM ANYWHERE
   It is how many times the code has been redeemed. Typing it would be
   inventing sales, and the form has never offered it. place_order raises
   it; cancelling an order lowers it.
   ========================================================================= */

'use strict';

var respond = require('../../_lib/respond');
var validate = require('../../_lib/validate');
var shape = require('../../_lib/shape');
var rows = require('../../_lib/rows');
var auth = require('../../_lib/auth');
var db = require('../../_lib/supabase');
var Errors = require('../../_lib/errors');
var log = require('../../_lib/log');
var couponInput = require('../../_lib/coupon-input');

var MAX = 2000;

/* ------------------------------------------------------------------------- */

module.exports = respond.handler(['GET', 'POST'], async function (req) {
  await auth.requireAdmin(req);

  var client = db.asUser(req);

  if (req.method === 'GET') {
    var result = await client
      .from('coupons')
      .select(shape.COUPON_SELECT)
      .order('created_at', { ascending: false })
      .limit(MAX + 1);

    if (result.error) throw Errors.internal().causedBy(new Error(result.error.message));

    var found = result.data || [];

    if (found.length > MAX) {
      log.error('the coupon list has outgrown loading it whole',
                new Error('more than ' + MAX + ' coupons'));
      found = found.slice(0, MAX);
    }

    return { items: found.map(shape.adminCoupon), total: found.length };
  }

  var coupon = couponInput.readCoupon(req, true);

  /* Free delivery has no amount. The form sends whatever was last in the
     box, and storing it would put a number on a coupon that does not use
     one. */
  if (coupon.type === 'shipping') coupon.value = 0;

  var created = await rows.mustInsert('coupon', client
    .from('coupons')
    .insert(coupon)
    .select(shape.COUPON_SELECT));

  return { coupon: shape.adminCoupon(created[0]) };
});
