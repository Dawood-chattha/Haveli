/* =========================================================================
   api/admin/customers/summary.js
   -------------------------------------------------------------------------
   GET /api/admin/customers/summary

   The four tiles above the customer list: how many customers there are, how
   many joined in the last thirty days, what they spend on average, and how
   many are blocked.

   OVER EVERYONE, NOT OVER THE PAGE
   "3 blocked" means three in the shop. Computed from the twenty rows on
   screen it would be a different sentence with the same words, and it would
   change as somebody paged.

   AVERAGE SPEND IS PER CUSTOMER WHO HAS BOUGHT SOMETHING
   Not per account. Dividing the takings by everyone who ever registered
   answers "what is an account worth", which is a question about sign-ups;
   the tile sits above a list of customers and is read as "what a customer
   spends". Someone who registered and never ordered is not evidence about
   that, and including them drags the figure toward zero as the shop grows.
   ========================================================================= */

'use strict';

var respond = require('../../_lib/respond');
var auth = require('../../_lib/auth');
var db = require('../../_lib/supabase');
var Errors = require('../../_lib/errors');
var Cities = require('../../_lib/cities');
var log = require('../../_lib/log');

var MAX = 20000;
var DAY = 86400000;

module.exports = respond.handler(['GET'], async function (req) {
  await auth.requireAdmin(req);

  var client = db.asUser(req);

  var people = await client
    .from('profiles')
    .select('id, blocked, created_at')
    .eq('role', 'customer')
    .limit(MAX + 1);

  if (people.error) throw Errors.internal().causedBy(new Error(people.error.message));

  var rows = people.data || [];

  if (rows.length > MAX) {
    log.error('the customer summary has outgrown counting it here',
              new Error('more than ' + MAX + ' customers'));
    rows = rows.slice(0, MAX);
  }

  var counted = await client
    .from('customer_stats')
    .select('user_id, orders, spent');

  if (counted.error) throw Errors.internal().causedBy(new Error(counted.error.message));

  var stats = {};
  (counted.data || []).forEach(function (row) { stats[row.user_id] = row; });

  var cutoff = Date.now() - 30 * DAY;

  var blocked = 0;
  var joinedRecently = 0;
  var buyers = 0;
  var spent = 0;

  rows.forEach(function (row) {
    if (row.blocked) blocked++;
    if (new Date(row.created_at).getTime() >= cutoff) joinedRecently++;

    var counts = stats[row.id];
    if (counts && Number(counts.orders) > 0) {
      buyers++;
      spent += Number(counts.spent || 0);
    }
  });

  /* The city filter's options, from the same place the list's city column
     comes from — so the filter can never offer one the column never shows.
     See api/_lib/cities.js. */
  var cities = await Cities.latest(client, null);

  return {
    total: rows.length,
    joinedRecently: joinedRecently,
    blocked: blocked,

    cities: cities.all.map(function (name) { return { id: name, label: name }; }),

    /* Whole rupees, like every other amount. Rounded rather than truncated
       so a figure of 999.6 does not read as 999. */
    average: buyers ? Math.round(spent / buyers) : 0,

    buyers: buyers,
    spent: spent
  };
});
