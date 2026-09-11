/* =========================================================================
   api/admin/customers/index.js
   -------------------------------------------------------------------------
   GET /api/admin/customers   a page of customers, filtered and sorted

   THERE IS NO POST, AND NO DELETE
   A customer is somebody who signed up. The panel does not create accounts
   — that is what the shop's own sign-up is for, and an account the owner
   invented would have no password anybody knows. Nor does it delete them:
   an order points at its customer, and deleting the account would leave the
   order's history unreadable. Blocking is what "this person is no longer
   welcome" means, and it is reversible.

   WHY THIS LOADS EVERYONE AND PAGES IN MEMORY
   The list sorts by total spent and by order count, and both live in the
   customer_stats view rather than on the row. PostgREST cannot order a
   table by a column of a view it has no declared relationship with, so
   sorting by either in the database is not available — and sorting a page
   after fetching it would sort twenty rows out of two thousand and call it
   "top spenders".

   So both sets are read whole, joined here, and paged here. That is fine
   for a shop's customer list and not fine forever: MAX below is where it
   stops being fine, and the fix when it arrives is a materialised view with
   a foreign key, not a bigger number.
   ========================================================================= */

'use strict';

var respond = require('../../../_lib/respond');
var validate = require('../../../_lib/validate');
var shape = require('../../../_lib/shape');
var auth = require('../../../_lib/auth');
var db = require('../../../_lib/supabase');
var Errors = require('../../../_lib/errors');
var Cities = require('../../../_lib/cities');
var log = require('../../../_lib/log');

var MAX = 5000;

var SORTS = {
  recent: function (a, b) { return a.joinedDaysAgo - b.joinedDaysAgo; },
  oldest: function (a, b) { return b.joinedDaysAgo - a.joinedDaysAgo; },
  'name-asc': function (a, b) { return a.name.localeCompare(b.name); },
  'name-desc': function (a, b) { return b.name.localeCompare(a.name); },
  'spent-desc': function (a, b) { return b.spent - a.spent; },
  'spent-asc': function (a, b) { return a.spent - b.spent; },
  'orders-desc': function (a, b) { return b.orders - a.orders; }
};

module.exports = respond.handler(['GET'], async function (req) {
  await auth.requireAdmin(req);

  var v = validate.query(req);

  var search = v.str('search', { optional: true, max: 120 });
  var status = v.str('status', { optional: true, max: 20 });
  var city = v.str('city', { optional: true, max: 80 });
  var sort = v.str('sort', { optional: true, max: 20 });
  var page = v.int('page', { optional: true, fallback: 1, min: 1, max: 10000 });
  var perPage = v.int('perPage', { optional: true, fallback: 20, min: 1, max: 100 });
  v.done();

  var client = db.asUser(req);

  var people = await client
    .from('profiles')
    .select(shape.CUSTOMER_SELECT)
    .eq('role', 'customer')
    .order('created_at', { ascending: false })
    .limit(MAX + 1);

  if (people.error) throw Errors.internal().causedBy(new Error(people.error.message));

  var found = people.data || [];

  if (found.length > MAX) {
    /* Not an error to the person looking at the screen — they get the list
       they always got. It is a message to whoever reads the logs, at the
       point where the note at the top of this file stops being theoretical. */
    log.error('the customer list has outgrown loading it whole',
              new Error('more than ' + MAX + ' customers'));
    found = found.slice(0, MAX);
  }

  var counted = await client
    .from('customer_stats')
    .select('user_id, orders, spent, last_order_at');

  if (counted.error) throw Errors.internal().causedBy(new Error(counted.error.message));

  var stats = {};
  (counted.data || []).forEach(function (row) { stats[row.user_id] = row; });

  /* Everyone's city, not the page's, because the list can be filtered by it
     — and a filter applied after paging would filter twenty rows out of two
     thousand. See api/_lib/cities.js. */
  var cities = await Cities.latest(client, null);

  var rows = found.map(function (row) {
    return shape.adminCustomer(row, stats[row.id], cities.byCustomer[row.id]);
  });

  /* ---- filters ---- */

  if (search) {
    var needle = String(search).toLowerCase();
    rows = rows.filter(function (row) {
      return row.name.toLowerCase().indexOf(needle) > -1 ||
             (row.email || '').toLowerCase().indexOf(needle) > -1 ||
             (row.phone || '').indexOf(needle) > -1;
    });
  }

  if (status === 'active' || status === 'blocked') {
    rows = rows.filter(function (row) { return row.status === status; });
  }

  if (city) {
    var wanted = city.toLowerCase();
    rows = rows.filter(function (row) {
      return (row.city || '').toLowerCase() === wanted;
    });
  }

  var compare = SORTS[sort] || SORTS.recent;
  rows = rows.slice().sort(compare);

  /* ---- the page ---- */

  var total = rows.length;
  var pages = Math.max(1, Math.ceil(total / perPage));
  var current = Math.min(Math.max(1, page), pages);
  var start = (current - 1) * perPage;
  return {
    items: rows.slice(start, start + perPage),
    total: total,
    page: current,
    pages: pages,
    perPage: perPage
  };
});
