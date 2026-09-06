/* =========================================================================
   admin-mock.js — builds the mock orders and customers
   -------------------------------------------------------------------------
   Expands ZB.adminSeed into records, the same way assets/js/catalogue.js
   expands the product seed. Nothing here talks to a server.

   The expansion is deterministic: every value comes from a hash of the
   record's own id, so an order costs the same on the dashboard as it does
   on the orders page, on every render and after a reload. Only the dates
   move, because they are anchored to today.

   Line items are real catalogue products, so "top products" on the
   dashboard names things the storefront actually sells, and a customer's
   total is the sum of prices the shop would really have charged.

   Customer totals are derived from the orders rather than invented
   alongside them. Two numbers that are supposed to agree should be one
   number, or they will drift.

   NOTE ON THE HASH
   The technique is the same as the catalogue's, and the six lines are
   deliberately repeated rather than reached for across the boundary. The
   storefront's catalogue module is the shop's, and the admin mock should
   not depend on its internals — a change to how products are generated
   must not silently reshape the order history.
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  var orders = null;        /* built on first use */
  var customers = null;
  var byCustomer = {};

  /**
   * djb2 with a bit-mixing finalizer, so neighbouring ids differ widely.
   *
   * Returns an unsigned 32-bit value, and every derivation from it below
   * must shift with `>>>`, never `>>`. `>>` is signed: on a hash above
   * 2^31 it yields a negative number, JavaScript's `%` keeps that sign, and
   * a negative index reads past the front of an array and returns
   * undefined. That is exactly what happened here first time round — the
   * dashboard died on `product.id` because `products[-5]` is nothing.
   */
  function hash(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
    h ^= h >>> 16; h = Math.imul(h, 2246822507);
    h ^= h >>> 13; h = Math.imul(h, 3266489909); h ^= h >>> 16;
    return h >>> 0;
  }

  function pick(list, n) {
    return list[n % list.length];
  }

  /** Choose from a list of { weight } entries, deterministically. */
  function weighted(list, n) {
    var total = list.reduce(function (sum, item) { return sum + item.weight; }, 0);
    var point = n % total;
    for (var i = 0; i < list.length; i++) {
      point -= list[i].weight;
      if (point < 0) return list[i];
    }
    return list[list.length - 1];
  }

  /** Midnight today, so a day's orders all share one boundary. */
  function startOfToday() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /**
   * A status that makes sense for the order's age.
   *
   * A queue drains: today's orders are waiting, last month's have arrived.
   * Drawing a status at random would put a Pending order from eleven weeks
   * ago on the dashboard, which reads as a bug in the shop rather than as
   * sample data.
   */
  function statusFor(daysAgo, n) {
    /* A small, age-independent share never completes. */
    if (n % 23 === 0) return 'cancelled';

    if (daysAgo <= 1) return (n % 3 === 0) ? 'processing' : 'pending';
    if (daysAgo <= 4) return (n % 3 === 0) ? 'shipped' : 'processing';
    if (daysAgo <= 9) return (n % 4 === 0) ? 'processing' : 'shipped';
    if (daysAgo <= 16) return (n % 3 === 0) ? 'shipped' : 'delivered';
    return 'delivered';
  }

  function labelOf(list, id) {
    var hit = list.filter(function (item) { return item.id === id; })[0];
    return hit ? hit.label : id;
  }

  /* -----------------------------------------------------------------------
     Customers
     ----------------------------------------------------------------------- */

  function buildCustomers(seed) {
    var out = [];

    for (var i = 0; i < seed.customers; i++) {
      var id = 'cus-' + (1000 + i);
      var n = hash(id);

      var first = pick(seed.firstNames, n);
      var last = pick(seed.lastNames, n >>> 5);
      var name = first + ' ' + last;

      out.push({
        id: id,
        name: name,
        /* Built from the name so the address always matches the person. */
        email: (first + '.' + last).toLowerCase() + '@' + seed.mailDomain,
        city: pick(seed.cities, n >>> 9),
        joinedDaysAgo: (n >>> 13) % 400,
        /* Roughly one in fourteen is suspended, which is enough for the
           filter on the customers page to have something to find. */
        status: (n % 14 === 0) ? 'blocked' : 'active',
        orders: 0,      /* filled from the orders below */
        spent: 0
      });
    }

    return out;
  }

  /* -----------------------------------------------------------------------
     Orders
     ----------------------------------------------------------------------- */

  function buildOrders(seed, people) {
    var out = [];
    var products = ZB.catalogue.all();
    var today = startOfToday();
    var ref = 10000;

    for (var day = seed.days - 1; day >= 0; day--) {
      var dayHash = hash('day-' + day);
      /* Between about half and one and a half times the average, so the
         sales line has a shape rather than a flat run. */
      var count = Math.max(1, Math.round(seed.ordersPerDay * (0.5 + (dayHash % 100) / 100)));

      for (var k = 0; k < count; k++) {
        ref += 1;
        var id = 'HAV-' + ref;
        var n = hash(id);

        var customer = people[n % people.length];

        /* One to three lines, each one or two of the same product. */
        var lines = [];
        var lineCount = 1 + (n % 3);
        var total = 0;

        for (var L = 0; L < lineCount; L++) {
          var product = products[(n >>> (L * 3)) % products.length];
          var qty = 1 + ((n >>> (L + 2)) % 2);
          lines.push({
            id: product.id,
            title: product.title,
            image: product.images && product.images[0],
            price: product.price,
            qty: qty
          });
          total += product.price * qty;
        }

        var date = new Date(today.getTime());
        date.setDate(date.getDate() - day);

        var status = statusFor(day, n);
        var payment = (status === 'cancelled')
          ? 'refunded'
          : weighted(seed.payments, n >>> 7).id;

        out.push({
          id: id,
          ref: id,
          date: date,
          daysAgo: day,
          customerId: customer.id,
          customerName: customer.name,
          customerEmail: customer.email,
          city: customer.city,
          items: lines,
          itemCount: lines.reduce(function (sum, l) { return sum + l.qty; }, 0),
          total: total,
          status: status,
          statusLabel: labelOf(seed.statuses, status),
          payment: payment,
          paymentLabel: labelOf(seed.payments, payment),
          method: pick(seed.methods, n >>> 11)
        });
      }
    }

    /* Newest first — the order every screen wants to show them in. */
    out.sort(function (a, b) { return a.daysAgo - b.daysAgo; });
    return out;
  }

  /* -----------------------------------------------------------------------
     Build
     ----------------------------------------------------------------------- */

  function build() {
    if (orders) return;

    var seed = ZB.adminSeed;
    customers = buildCustomers(seed);
    orders = buildOrders(seed, customers);

    customers.forEach(function (person) { byCustomer[person.id] = person; });

    /* Roll the orders up into their customers, so the two always agree.
       A cancelled order is not revenue and must not be counted as spend. */
    orders.forEach(function (order) {
      var person = byCustomer[order.customerId];
      if (!person) return;
      person.orders += 1;
      if (order.status !== 'cancelled') person.spent += order.total;
    });
  }

  ZB.adminMock = {
    orders: function () { build(); return orders; },
    customers: function () { build(); return customers; },
    customer: function (id) { build(); return byCustomer[id] || null; },

    /** Revenue only: cancelled orders never count towards sales. */
    isRevenue: function (order) { return order.status !== 'cancelled'; }
  };

}(window.ZB));
