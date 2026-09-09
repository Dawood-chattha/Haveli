/* =========================================================================
   api/admin/orders/[id].js
   -------------------------------------------------------------------------
   GET   /api/admin/orders/:id
   PATCH /api/admin/orders/:id     { status } and/or { payment }

   THERE IS NO DELETE, AND THERE WILL NOT BE
   An order is a record of something that happened, and a shop that can
   erase those is a shop whose books cannot be checked. Cancelling is what
   "this order is not going ahead" means: the order stays, its stock goes
   back, and the reports stop counting it as revenue.

   THE STATUS AND THE PAYMENT ARE CHANGED BY DIFFERENT MEANS, ON PURPOSE
   Marking an order paid is one column. Changing its status can move stock —
   cancelling gives every line back to the shelf, reopening takes it again —
   so that goes through public.set_order_status, which does the whole thing
   in one transaction. See db/checkout.sql.
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

var STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
var PAYMENTS = ['paid', 'unpaid', 'refunded'];

/* What set_order_status raises. HV006 is "no such order, or not yours to
   change", which is a 404 rather than a 403 for the usual reason: the two
   are told apart only by someone who already knows the order exists. */
var RAISED = {
  HV001: 'conflict',
  HV004: 'badRequest',
  HV006: 'notFound'
};

function orderId(req) {
  var v = validate.query(req);
  var id = v.uuid('id');
  v.done();
  return id;
}

async function load(client, id) {
  var result = await client
    .from('orders')
    .select(shape.ORDER_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (result.error) throw Errors.internal().causedBy(new Error(result.error.message));
  if (!result.data) throw Errors.notFound('That order no longer exists.');

  return result.data;
}

/* -------------------------------------------------------------------------
   GET
   ------------------------------------------------------------------------- */

async function read(req, client) {
  return { order: shape.adminOrder(await load(client, orderId(req))) };
}

/* -------------------------------------------------------------------------
   PATCH
   ------------------------------------------------------------------------- */

async function update(req, client) {
  var id = orderId(req);

  var v = validate.body(req);
  var body = v.source;
  var has = function (key) { return Object.prototype.hasOwnProperty.call(body, key); };

  var status = has('status') ? v.oneOf('status', STATUSES) : null;
  var payment = has('payment') ? v.oneOf('payment', PAYMENTS) : null;
  v.done();

  if (!status && !payment) {
    throw Errors.badRequest('There was nothing to change.');
  }

  /* The order is read first so a bad id is a 404 rather than whatever the
     function would have said about it. */
  await load(client, id);

  if (status) {
    var moved = await client.rpc('set_order_status', {
      p_order: id,
      p_status: status
    });

    if (moved.error) {
      var kind = RAISED[moved.error.code];
      if (kind) throw Errors[kind](moved.error.message);

      if (moved.error.code === '42883' || moved.error.code === 'PGRST202') {
        log.error('set_order_status is missing — db/checkout.sql has not been run',
                  new Error(moved.error.message));
        throw Errors.unavailable('That cannot be changed just now.');
      }

      throw Errors.internal().causedBy(new Error(moved.error.message));
    }
  }

  if (payment) {
    /* A plain update, permitted by "orders: admins update". mustAffect is
       what turns a policy quietly refusing this into a 404 rather than a
       success that changed nothing — see api/_lib/rows.js. */
    await rows.mustAffect('order', client
      .from('orders')
      .update({ payment_status: payment })
      .eq('id', id)
      .select('id'));
  }

  return { order: shape.adminOrder(await load(client, id)) };
}

/* ------------------------------------------------------------------------- */

module.exports = respond.handler(['GET', 'PATCH'], async function (req) {
  await auth.requireAdmin(req);

  var client = db.asUser(req);

  if (req.method === 'GET') return read(req, client);
  return update(req, client);
});
