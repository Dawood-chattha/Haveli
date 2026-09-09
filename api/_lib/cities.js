/* =========================================================================
   api/_lib/cities.js
   -------------------------------------------------------------------------
   Which city each customer last had something delivered to.

   WHY THIS IS NOT A COLUMN
   An address belongs to a delivery, not to a person. People move, and an
   order that went to Lahore in March still went to Lahore after they move
   to Karachi in June — so the order carries its own address snapshot and
   nobody carries a city. The customer list still wants one, because "who
   is buying, and from where" is a reasonable question, and the honest
   answer is the most recent place they had something sent.

   WHY IT IS A FILE RATHER THAN A FUNCTION IN EACH ENDPOINT
   Two screens ask: the customer list, which shows it in a column and
   filters by it, and the summary above that list, which offers the filter's
   options. Written twice they would eventually disagree — the filter would
   offer a city the column never shows — and the way that surfaces is a
   filter that returns nothing.
   ========================================================================= */

'use strict';

var Errors = require('./errors');

/* Enough orders to determine everyone's latest city. Two small columns per
   order; well past this a shop should be answering the question in SQL. */
var MAX = 20000;

/**
 * @param client  a Supabase client — the caller's, so policies still apply
 * @param ids     restrict to these customers, or null for everyone
 * @returns { byCustomer: { <uuid>: 'Karachi' }, all: ['Karachi', 'Lahore'] }
 */
async function latest(client, ids) {
  var query = client
    .from('orders')
    .select('user_id, address, created_at')
    .order('created_at', { ascending: false })
    .limit(MAX);

  if (ids && ids.length) query = query.in('user_id', ids);

  var result = await query;
  if (result.error) throw Errors.internal().causedBy(new Error(result.error.message));

  var byCustomer = {};
  var seen = {};

  /* Newest first, so the first row seen for a person is their latest. */
  (result.data || []).forEach(function (row) {
    var city = row.address && row.address.city;
    if (!city) return;

    city = String(city).trim();
    if (!city) return;

    if (row.user_id && !byCustomer[row.user_id]) byCustomer[row.user_id] = city;

    /* The filter's options are every city the shop has ever delivered to,
       not only the ones that happen to be somebody's latest. A city that
       was somebody's only order last year is still a city worth filtering
       by, and the row for it will match on that order. */
    seen[city.toLowerCase()] = city;
  });

  var all = Object.keys(seen)
    .map(function (key) { return seen[key]; })
    .sort(function (a, b) { return a.localeCompare(b); });

  return { byCustomer: byCustomer, all: all };
}

module.exports = { latest: latest };
