/* =========================================================================
   api/account/orders.js
   -------------------------------------------------------------------------
   GET /api/account/orders        the caller's own orders
   GET /api/account/orders?ref=…  one of them, by its reference

   THE POLICY IS NOT THE FILTER HERE, AND ASSUMING IT WAS WAS A BUG
   The first version of this file had no `where user_id = …`, on the
   reasoning that the "orders: read own" policy already supplies one and a
   second copy could only drift from it.

   That reasoning was wrong, because it is not the only policy on the table.
   "orders: admins read all" sits beside it, and policies are ORed — so the
   shop's owner, opening their own account page, was shown every order in
   the shop as though they had placed them all. Nothing leaked: an
   administrator may read those orders, and does, on the screen built for
   it. But this is the customer's page, and it answered a different
   question than the one it asks.

   So the filter is here, explicitly. The policy is still what makes a
   mistake in this file harmless — it can return fewer orders than the
   caller owns, never more — and the filter is what makes the page mean
   what it says.
   ========================================================================= */

'use strict';

var respond = require('../_lib/respond');
var validate = require('../_lib/validate');
var shape = require('../_lib/shape');
var auth = require('../_lib/auth');
var db = require('../_lib/supabase');
var Errors = require('../_lib/errors');

/* An account page shows a history, not an archive. Someone with more orders
   than this has an older one they can still find by reference. */
var MAX = 100;

module.exports = respond.handler(['GET'], async function (req) {
  var user = await auth.requireUser(req);

  var v = validate.query(req);
  var ref = v.str('ref', { optional: true, max: 40 });
  v.done();

  var client = db.asUser(req);

  var query = client
    .from('orders')
    .select(shape.ORDER_SELECT)
    /* The caller's own, said out loud. See the note above: an
       administrator satisfies a wider policy, and this page is not about
       what they are allowed to see. */
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (ref) query = query.eq('ref', ref);
  else query = query.limit(MAX);

  var result = await query;
  if (result.error) throw Errors.internal().causedBy(new Error(result.error.message));

  var rows = result.data || [];

  if (ref) {
    /* Nothing came back either because there is no such order or because it
       is not this person's. The answer is the same for both: telling a
       stranger that HAV-2609-01042 exists is telling them something. */
    if (!rows.length) throw Errors.notFound('No order with that reference.');
    return { order: shape.customerOrder(rows[0]) };
  }

  return {
    orders: rows.map(shape.customerOrder),
    total: rows.length
  };
});
