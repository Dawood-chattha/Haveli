/* =========================================================================
   api/admin/customers/[id].js
   -------------------------------------------------------------------------
   GET   /api/admin/customers/:id          one customer, with their orders
   PATCH /api/admin/customers/:id          { status: 'active' | 'blocked' }

   BLOCKING IS THE ONLY THING THIS CHANGES
   Not the name, not the email, not the phone. Those are the customer's own
   to correct, from their account page, and a shop that edits them is a shop
   whose records no longer say what the customer said.

   THE ROLE IS NOT CHANGEABLE HERE EITHER
   Making somebody an administrator is not customer management. There is a
   trigger in db/policies.sql that refuses a role change from anyone who is
   not already an admin, and this endpoint does not offer one at all — the
   only way in is scripts/make-admin.mjs, run by whoever has the service
   key, which is the shop's owner.
   ========================================================================= */

'use strict';

var respond = require('../../_lib/respond');
var validate = require('../../_lib/validate');
var shape = require('../../_lib/shape');
var rows = require('../../_lib/rows');
var auth = require('../../_lib/auth');
var db = require('../../_lib/supabase');
var Errors = require('../../_lib/errors');

function customerId(req) {
  var v = validate.query(req);
  var id = v.uuid('id');
  v.done();
  return id;
}

/** The person, their totals, and the city of their latest order. */
async function load(client, id) {
  var person = await client
    .from('profiles')
    .select(shape.CUSTOMER_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (person.error) throw Errors.internal().causedBy(new Error(person.error.message));
  if (!person.data) throw Errors.notFound('That customer no longer exists.');

  var counted = await client
    .from('customer_stats')
    .select('user_id, orders, spent, last_order_at')
    .eq('user_id', id)
    .maybeSingle();

  if (counted.error) throw Errors.internal().causedBy(new Error(counted.error.message));

  var latest = await client
    .from('orders')
    .select('address')
    .eq('user_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest.error) throw Errors.internal().causedBy(new Error(latest.error.message));

  var city = latest.data && latest.data.address ? latest.data.address.city : null;

  return shape.adminCustomer(person.data, counted.data, city);
}

/* -------------------------------------------------------------------------
   GET
   ------------------------------------------------------------------------- */

async function read(req, client) {
  var id = customerId(req);
  var customer = await load(client, id);

  var orders = await client
    .from('orders')
    .select(shape.ORDER_SELECT)
    .eq('user_id', id)
    .order('created_at', { ascending: false })
    .limit(100);

  if (orders.error) throw Errors.internal().causedBy(new Error(orders.error.message));

  return {
    customer: customer,
    orders: (orders.data || []).map(shape.adminOrder)
  };
}

/* -------------------------------------------------------------------------
   PATCH
   ------------------------------------------------------------------------- */

async function update(req, client) {
  var id = customerId(req);

  var v = validate.body(req);
  var status = v.oneOf('status', ['active', 'blocked']);
  v.done();

  var person = await client
    .from('profiles')
    .select('id, role')
    .eq('id', id)
    .maybeSingle();

  if (person.error) throw Errors.internal().causedBy(new Error(person.error.message));
  if (!person.data) throw Errors.notFound('That customer no longer exists.');

  /* An administrator is not blocked from this screen. Blocking one takes
     the panel away from them, and doing it from the customer list — where
     the reader is looking at a row that says "customer" — is too easy a way
     to lock the shop's own staff out by accident. The database would allow
     it; this endpoint does not offer it. */
  if (person.data.role !== 'customer') {
    throw Errors.forbidden('That account is not a customer.');
  }

  await rows.mustAffect('customer', client
    .from('profiles')
    .update({ blocked: status === 'blocked' })
    .eq('id', id)
    .select('id'));

  return { customer: await load(client, id) };
}

/* ------------------------------------------------------------------------- */

module.exports = respond.handler(['GET', 'PATCH'], async function (req) {
  await auth.requireAdmin(req);

  var client = db.asUser(req);

  if (req.method === 'GET') return read(req, client);
  return update(req, client);
});
