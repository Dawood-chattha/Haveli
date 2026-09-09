/* =========================================================================
   api/admin/metrics.js
   -------------------------------------------------------------------------
   GET /api/admin/metrics?days=30

   Everything the dashboard draws, in one answer: the headline tiles, the
   sales line, the best sellers, the activity strip and the sidebar badges.

   ONE ENDPOINT RATHER THAN FIVE
   They are five questions about the same rows. Asked separately, each would
   fetch the same orders again, and the five answers could be computed from
   five slightly different windows — a dashboard whose chart and whose
   headline disagree about the same fortnight. Asked together, they are
   counted once, from one read, and cannot drift.

   COUNTED HERE, NOT IN THE BROWSER
   The panel used to do this arithmetic over generated orders it already
   had. Sending every order of the last two months to a browser so it can
   add up four numbers is not the same thing.

   CANCELLED ORDERS ARE NEVER REVENUE
   Stated once, applied everywhere below, and it is the same rule the
   customer_stats view and the orders summary use — so a customer's spend,
   the orders screen's total and this dashboard agree.
   ========================================================================= */

'use strict';

var respond = require('../_lib/respond');
var validate = require('../_lib/validate');
var auth = require('../_lib/auth');
var db = require('../_lib/supabase');
var Errors = require('../_lib/errors');
var log = require('../_lib/log');

var DAY = 86400000;

/* Two windows of orders are read: the one being shown and the one before
   it, so every tile can say what changed. This is the ceiling on the pair. */
var MAX = 20000;

function isRevenue(order) { return order.status !== 'cancelled'; }

/**
 * Percentage change against the previous equal-length period.
 *
 * Null when there is nothing to compare against, so a tile omits the
 * figure rather than printing a meaningless 0% or an infinity. A shop's
 * first month has no previous month, and saying so is better than
 * implying it grew infinitely.
 */
function changePct(current, previous) {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

function daysSince(iso) {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY));
}

module.exports = respond.handler(['GET'], async function (req) {
  await auth.requireAdmin(req);

  var v = validate.query(req);
  var days = v.int('days', { optional: true, fallback: 30, min: 1, max: 365 });
  v.done();

  var client = db.asUser(req);

  /* ---- the orders, both windows at once ---------------------------------
     One read covering twice the window, split here. Two reads would be two
     round trips for rows that overlap in nothing but their cost. */

  var since = new Date(Date.now() - days * 2 * DAY).toISOString();

  var orders = await client
    .from('orders')
    .select('id, ref, status, payment_status, total, created_at, address,' +
            ' profiles:user_id ( name ),' +
            ' order_items ( product_id, title, image, price, qty )')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(MAX + 1);

  if (orders.error) throw Errors.internal().causedBy(new Error(orders.error.message));

  var rows = orders.data || [];

  if (rows.length > MAX) {
    log.error('the dashboard window has outgrown counting it here',
              new Error('more than ' + MAX + ' orders in ' + (days * 2) + ' days'));
    rows = rows.slice(0, MAX);
  }

  rows.forEach(function (row) { row.daysAgo = daysSince(row.created_at); });

  var current = rows.filter(function (row) { return row.daysAgo < days; });
  var previous = rows.filter(function (row) {
    return row.daysAgo >= days && row.daysAgo < days * 2;
  });

  var sum = function (list) {
    return list.reduce(function (total, row) {
      return isRevenue(row) ? total + row.total : total;
    }, 0);
  };

  /* ---- products ---------------------------------------------------------
     Counted with head requests: the dashboard wants two numbers, not the
     catalogue. Archived products are not in the shop and are not counted
     as part of it. */

  var productCount = await client
    .from('products')
    .select('id', { count: 'exact', head: true })
    .neq('status', 'archived');

  if (productCount.error) {
    throw Errors.internal().causedBy(new Error(productCount.error.message));
  }

  var outOfStock = await client
    .from('products')
    .select('id', { count: 'exact', head: true })
    .neq('status', 'archived')
    .eq('stock', 0);

  if (outOfStock.error) throw Errors.internal().causedBy(new Error(outOfStock.error.message));

  /* ---- customers -------------------------------------------------------- */

  var customerCount = await client
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'customer');

  if (customerCount.error) {
    throw Errors.internal().causedBy(new Error(customerCount.error.message));
  }

  var joined = await client
    .from('profiles')
    .select('created_at')
    .eq('role', 'customer')
    .gte('created_at', since)
    .limit(MAX);

  if (joined.error) throw Errors.internal().causedBy(new Error(joined.error.message));

  var newPeople = 0;
  var olderPeople = 0;

  (joined.data || []).forEach(function (row) {
    var age = daysSince(row.created_at);
    if (age < days) newPeople++;
    else if (age < days * 2) olderPeople++;
  });

  /* ---- everything still waiting, regardless of window --------------------
     "Orders needing action" is not a question about the last thirty days.
     An order left pending for six weeks is exactly the one worth showing. */

  var waiting = await client
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .in('status', ['pending', 'processing']);

  if (waiting.error) throw Errors.internal().causedBy(new Error(waiting.error.message));

  /* ---- the daily line ---------------------------------------------------
     Every day in the window is present, including the quiet ones, so the
     line's shape is the real shape rather than a compressed one. */

  var buckets = [];
  var byDay = {};

  for (var d = days - 1; d >= 0; d--) {
    var bucket = { daysAgo: d, value: 0, orders: 0 };
    byDay[d] = bucket;
    buckets.push(bucket);
  }

  current.forEach(function (row) {
    var bucket = byDay[row.daysAgo];
    if (!bucket) return;

    bucket.orders += 1;
    if (isRevenue(row)) bucket.value += row.total;
  });

  /* ---- best sellers ----------------------------------------------------- */

  var totals = {};

  current.forEach(function (row) {
    if (!isRevenue(row)) return;

    (row.order_items || []).forEach(function (line) {
      /* Keyed by product, falling back to the title for a product that has
         since been deleted — its lines still sold, and dropping them would
         understate the period they sold in. */
      var key = line.product_id || ('gone:' + line.title);

      var entry = totals[key] || (totals[key] = {
        id: line.product_id || null,
        title: line.title,
        image: line.image,
        units: 0,
        revenue: 0
      });

      entry.units += line.qty;
      entry.revenue += line.price * line.qty;
    });
  });

  var top = Object.keys(totals).map(function (key) { return totals[key]; });
  top.sort(function (a, b) { return b.revenue - a.revenue; });

  /* ---- the activity strip -----------------------------------------------
     Built from records that exist rather than from invented sentences, so
     every line refers to something another screen can show. */

  var activity = rows.slice(0, 12).map(function (row) {
    var who = (row.profiles && row.profiles.name) ||
              (row.address && row.address.name) || 'a customer';

    if (row.status === 'shipped') {
      return {
        kind: 'shipped', icon: 'box', daysAgo: row.daysAgo,
        text: 'Order ' + row.ref + ' was marked shipped'
      };
    }

    if (row.status === 'cancelled') {
      return {
        kind: 'cancelled', icon: 'receipt', daysAgo: row.daysAgo,
        text: 'Order ' + row.ref + ' was cancelled'
      };
    }

    return {
      kind: 'order', icon: 'receipt', daysAgo: row.daysAgo,
      text: 'New order ' + row.ref + ' from ' + who
    };
  });

  var empty = await client
    .from('products')
    .select('title')
    .neq('status', 'archived')
    .eq('stock', 0)
    .limit(2);

  if (empty.error) throw Errors.internal().causedBy(new Error(empty.error.message));

  (empty.data || []).forEach(function (row) {
    activity.push({
      kind: 'stock', icon: 'archive', daysAgo: 0,
      text: row.title + ' is out of stock'
    });
  });

  activity.sort(function (a, b) { return a.daysAgo - b.daysAgo; });

  /* ---- the answer ------------------------------------------------------- */

  var currentRevenue = sum(current);

  return {
    days: days,

    summary: {
      days: days,

      sales: {
        value: currentRevenue,
        change: changePct(currentRevenue, sum(previous))
      },
      orders: {
        value: current.length,
        change: changePct(current.length, previous.length)
      },
      products: {
        value: productCount.count || 0,

        /* There is no history of how many products the shop had, so there
           is no honest change to report. A number invented for the sake of
           an arrow beside it would be the only figure on this screen that
           came from nowhere. */
        change: null
      },
      customers: {
        value: customerCount.count || 0,
        change: changePct(newPeople, olderPeople)
      },

      pendingOrders: waiting.count || 0,

      /* Out of stock, not running low. The tile that reads this says
         "Products out of stock" and means it; the running-low threshold is
         the inventory screen's question. */
      outOfStock: outOfStock.count || 0
    },

    series: buckets,
    topProducts: top.slice(0, 5),
    activity: activity.slice(0, 6),

    badges: {
      inventory: outOfStock.count || 0,
      orders: waiting.count || 0
    }
  };
});
