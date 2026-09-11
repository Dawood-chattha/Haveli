/* =========================================================================
   api/admin/orders/summary.js
   -------------------------------------------------------------------------
   GET /api/admin/orders/summary

   The strip of counts above the order list, and the same figures the
   dashboard leads with: how many orders there are, how many are in each
   status, how many are waiting to be dealt with, how many are unpaid, and
   what the paid-for ones came to.

   A FILE OF ITS OWN RATHER THAN A FLAG ON THE LIST
   /api/admin/orders?view=summary would have worked and would have meant one
   endpoint answering two unrelated questions, with half its parameters
   ignored depending on which. It resolves before [id].js because a file
   that names a route beats a bracket that matches anything — and if that
   order ever changed, [id].js validates its parameter as a uuid, so
   "summary" would be a clear 400 rather than something strange.

   THE WHOLE TABLE, NOT A PAGE OF IT
   These are counts of everything, so everything has to be counted. Two
   columns per order, which is small; the cap below is where it stops being
   small, and the answer then is a database function rather than a larger
   cap.
   ========================================================================= */

'use strict';

var respond = require('../../../_lib/respond');
var auth = require('../../../_lib/auth');
var db = require('../../../_lib/supabase');
var Errors = require('../../../_lib/errors');
var log = require('../../../_lib/log');

var MAX = 20000;

module.exports = respond.handler(['GET'], async function (req) {
  await auth.requireAdmin(req);

  var client = db.asUser(req);

  var result = await client
    .from('orders')
    .select('status, payment_status, total')
    .limit(MAX + 1);

  if (result.error) throw Errors.internal().causedBy(new Error(result.error.message));

  var rows = result.data || [];

  if (rows.length > MAX) {
    log.error('the order summary has outgrown counting it here',
              new Error('more than ' + MAX + ' orders'));
    rows = rows.slice(0, MAX);
  }

  var counts = {};
  var unpaid = 0;
  var revenue = 0;

  rows.forEach(function (row) {
    counts[row.status] = (counts[row.status] || 0) + 1;

    if (row.payment_status === 'unpaid') unpaid++;

    /* Cancelled orders are not revenue. The same rule the customer_stats
       view uses, so a customer's "spent" and this figure agree. */
    if (row.status !== 'cancelled') revenue += row.total;
  });

  return {
    total: rows.length,
    counts: counts,

    /* The two an owner opens this screen to act on. */
    waiting: (counts.pending || 0) + (counts.processing || 0),
    unpaid: unpaid,
    revenue: revenue
  };
});
