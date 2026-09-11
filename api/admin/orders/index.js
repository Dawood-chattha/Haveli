/* =========================================================================
   api/admin/orders/index.js
   -------------------------------------------------------------------------
   GET /api/admin/orders     a page of orders, filtered and sorted

   THERE IS NO POST HERE, AND THERE SHOULD NOT BE
   An order records something that happened: a customer chose things and
   asked for them. A panel that could invent one could invent revenue, and
   the reports screen would report it. Orders are created by
   public.place_order, from a checkout, by the person buying — and by
   nothing else.

   PAGED IN THE DATABASE
   A shop accumulates orders forever. The list asks for one page at a time
   with the filters in the query string, exactly as the product list does.

   THE SEARCH LOOKS AT THE REFERENCE AND THE CUSTOMER
   Which is what the box above it says it does. Searching order_items as
   well — "who bought the linen shirt" — is a different question and a
   different screen; answering it here would make every search slow for the
   sake of a question this page does not ask.
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

var SORTS = {
  newest: { column: 'created_at', ascending: false },
  oldest: { column: 'created_at', ascending: true },
  'total-desc': { column: 'total', ascending: false },
  'total-asc': { column: 'total', ascending: true }
};

/* The ranges the panel's date control offers, in days. Its "All time" is the
   absence of a filter rather than a very large number. */
var RANGES = { '7': 7, '30': 30, '90': 90, '365': 365 };

/* Where summing the filtered set stops being reasonable. Well beyond any
   single filtered view a person would sit and read; the note in revenueOf
   says what to do if a shop ever passes it. */
var SUM_MAX = 20000;

/**
 * Apply the screen's filters to a query.
 *
 * One function, used by the page and by the total underneath it, because
 * two copies of a filter eventually disagree — and the way that shows up
 * is a revenue figure that does not match the rows above it.
 */
function withFilters(query, o) {
  if (o.search) {
    var needle = o.search.replace(/[,()]/g, ' ').trim();

    if (needle) {
      /* The reference is on the order; the name is on the address snapshot,
         which is where it was at the time — the right place to search,
         because it is what the order actually says. */
      query = query.or('ref.ilike.*' + needle + '*,address->>name.ilike.*' + needle + '*');
    }
  }

  /* "Needs action" is not a status an order has — it is the question the
     screen is usually opened with, and the answer spans two of them. The
     panel's filter has always offered it; this is where it means
     something. */
  if (o.status === 'waiting') query = query.in('status', ['pending', 'processing']);
  else if (o.status && STATUSES.indexOf(o.status) > -1) query = query.eq('status', o.status);

  if (o.payment && PAYMENTS.indexOf(o.payment) > -1) {
    query = query.eq('payment_status', o.payment);
  }

  if (o.range && RANGES[o.range]) {
    var since = new Date(Date.now() - RANGES[o.range] * 86400000);
    query = query.gte('created_at', since.toISOString());
  }

  return query;
}

/**
 * What the filtered orders came to.
 *
 * Cancelled orders are left out, which is the same rule the dashboard and
 * the reports screen use and the same one the customer_stats view applies:
 * an order that was cancelled is not money the shop took.
 *
 * Two columns of every matching row, summed here. PostgREST can aggregate,
 * but only in ways that vary by version, and a revenue figure is not the
 * place to depend on that. If a shop ever files more than SUM_MAX orders
 * inside one filter, this becomes a database function — not a bigger
 * number.
 */
async function revenueOf(client, filters) {
  var query = withFilters(
    client.from('orders').select('total, status').limit(SUM_MAX + 1),
    filters);

  var result = await query;
  if (result.error) throw Errors.internal().causedBy(new Error(result.error.message));

  var rows = result.data || [];

  if (rows.length > SUM_MAX) {
    log.error('the revenue total has outgrown summing it here',
              new Error('more than ' + SUM_MAX + ' orders in one filter'));
    return null;
  }

  return rows.reduce(function (sum, row) {
    return row.status === 'cancelled' ? sum : sum + row.total;
  }, 0);
}

module.exports = respond.handler(['GET'], async function (req) {
  await auth.requireAdmin(req);

  var v = validate.query(req);

  var filters = {
    search: v.str('search', { optional: true, max: 120 }),
    status: v.str('status', { optional: true, max: 20 }),
    payment: v.str('payment', { optional: true, max: 20 }),
    range: v.str('range', { optional: true, max: 10 })
  };

  var sort = v.str('sort', { optional: true, max: 20 });
  var page = v.int('page', { optional: true, fallback: 1, min: 1, max: 10000 });
  var perPage = v.int('perPage', { optional: true, fallback: 20, min: 1, max: 100 });
  v.done();

  var client = db.asUser(req);

  /* A fresh query each call: rows.paged needs a second one with identical
     filters when the page asked for is past the end. */
  function filtered() {
    var query = withFilters(
      client.from('orders').select(shape.ORDER_SELECT, { count: 'exact' }),
      filters);

    var order = SORTS[sort] || SORTS.newest;
    query = query.order(order.column, { ascending: order.ascending });

    /* A total ordering, so paging cannot repeat a row or skip one. See the
       note in api/admin/products/index.js. */
    return query.order('id', { ascending: true });
  }

  var got = await rows.paged(filtered, page, perPage);

  var total = got.total;
  var pages = Math.max(1, Math.ceil(total / perPage));

  return {
    items: got.rows.map(shape.adminOrder),
    total: total,
    page: Math.min(page, pages),
    pages: pages,
    perPage: perPage,

    /* What the whole filtered set came to, not just the page on screen.
       "Showing 1–20 of 214 orders" above a table is half an answer when the
       question is how much they came to. */
    revenue: await revenueOf(client, filters)
  };
});
