/* =========================================================================
   api/admin/coupons/[id].js
   -------------------------------------------------------------------------
   GET    /api/admin/coupons/:id
   PATCH  /api/admin/coupons/:id
   DELETE /api/admin/coupons/:id

   DELETING A COUPON THAT HAS BEEN USED IS REFUSED
   An order records which coupon it used, and `coupon_id` is a foreign key
   with `on delete set null` — so deleting the row would leave past orders
   holding a discount from a code that no longer exists. The order keeps
   `coupon_code` as text and would still read correctly, but the link is
   gone and nothing can answer "how much did EID20 cost us".

   Switching it off does what deleting was meant to do — the code stops
   working immediately, and nobody loses a record. That is offered instead,
   and the message says so.
   ========================================================================= */

'use strict';

var respond = require('../../../_lib/respond');
var validate = require('../../../_lib/validate');
var shape = require('../../../_lib/shape');
var rows = require('../../../_lib/rows');
var auth = require('../../../_lib/auth');
var db = require('../../../_lib/supabase');
var Errors = require('../../../_lib/errors');

var couponInput = require('../../../_lib/coupon-input');

function couponId(req) {
  var v = validate.query(req);
  var id = v.uuid('id');
  v.done();
  return id;
}

async function load(client, id) {
  var result = await client
    .from('coupons')
    .select(shape.COUPON_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (result.error) throw Errors.internal().causedBy(new Error(result.error.message));
  if (!result.data) throw Errors.notFound('That coupon no longer exists.');

  return result.data;
}

/* ------------------------------------------------------------------------- */

module.exports = respond.handler(['GET', 'PATCH', 'DELETE'], async function (req) {
  await auth.requireAdmin(req);

  var client = db.asUser(req);
  var id = couponId(req);

  if (req.method === 'GET') {
    return { coupon: shape.adminCoupon(await load(client, id)) };
  }

  /* --- PATCH --------------------------------------------------------- */

  if (req.method === 'PATCH') {
    /* Existence first, so a bad id is a 404 rather than a validation error
       about fields on a coupon that is not there. */
    await load(client, id);

    var patch = couponInput.readCoupon(req, false);

    if (!Object.keys(patch).length) {
      throw Errors.badRequest('There was nothing to change.');
    }

    /* A type change to free delivery clears the amount, the same rule the
       create path applies. */
    if (patch.type === 'shipping') patch.value = 0;

    /* Changing a coupon that people have already used changes what it will
       do next time, not what it did — the orders keep the amounts they
       were charged. Worth allowing: a code that turned out to be too
       generous should be fixable without a second code. */
    var saved = await rows.mustAffect('coupon', client
      .from('coupons')
      .update(patch)
      .eq('id', id)
      .select(shape.COUPON_SELECT));

    return { coupon: shape.adminCoupon(saved[0]) };
  }

  /* --- DELETE -------------------------------------------------------- */

  var coupon = await load(client, id);

  var used = await client
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('coupon_id', id);

  if (used.error) throw Errors.internal().causedBy(new Error(used.error.message));

  if (used.count) {
    throw Errors.conflict('“' + coupon.code + '” has been used on ' + used.count +
      (used.count === 1 ? ' order' : ' orders') + ', so deleting it would break ' +
      'their record. Switch it off instead — the code stops working straight away.');
  }

  await rows.mustAffect('coupon', client
    .from('coupons')
    .delete()
    .eq('id', id)
    .select('id'));

  return { deleted: true };
});
