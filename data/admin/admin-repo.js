/* =========================================================================
   admin-repo.js — the data access layer
   -------------------------------------------------------------------------
   THE ONE FILE THAT CHANGES WHEN A BACKEND ARRIVES.

   No admin page ever touches mock data directly. Every page asks this
   module instead:

     ZB.repo.products.list({ search: 'polo', page: 1 })
       .then(function (result) { ... });

   Today those calls read ZB.catalogue, the same generated catalogue the
   storefront reads, so both sides of the site already agree on what a
   product is. Later the bodies here are replaced with real queries and
   nothing else in the admin panel has to change.

   NO BACKEND HAS BEEN CHOSEN, AND NONE NEEDS TO BE
   This module is deliberately not written against any particular database.
   It exposes plain methods that resolve with plain objects, which is a
   shape every option can satisfy — a hosted service such as Firebase or
   Supabase, or an API of your own in front of MySQL, Postgres or MongoDB.
   Picking one later changes the bodies of these methods and nothing else,
   so the decision can wait until the UI is built and the real requirements
   are visible.

   WHY EVERY METHOD RETURNS A PROMISE
   Mock data could answer instantly. A database cannot — whichever one is
   chosen, the answer arrives later than the question. If these methods
   returned values directly, every page would be built around an answer that
   is already there, and connecting a backend would then mean reworking each
   one to wait. Returning a promise from the start — with a small deliberate
   delay, so loading states are real and get tested — confines that swap to
   this file.

   WHAT IS NOT HERE YET
   Orders, customers, coupons and banners arrive in their own phases. They
   will be added as siblings of `products`, in the same shape. Nothing is
   stubbed out in advance, so a method that exists here always works.

   SECURITY
   Nothing in this file is a credential and nothing may become one. Whatever
   backend is chosen: any private key or service-account credential stays on
   the server and NEVER comes near this code, and read/write permission is
   decided there too — never by this module and never by the admin UI. A
   frontend check only decides what to draw.
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  var Repo = {

    /* How long a mock call takes to answer, in milliseconds. Keeping this
       above zero is the point: it keeps skeletons and spinners on the real
       path rather than in code nobody ever sees run. Set to 0 while
       debugging if the wait gets in the way. */
    latency: 140,

    /** A promise that settles the way a network call would. */
    defer: function (value) {
      return new Promise(function (done) {
        window.setTimeout(function () { done(value); }, Repo.latency);
      });
    }
  };

  /* -----------------------------------------------------------------------
     Shaping

     The storefront's catalogue product is built for a shop: it knows about
     badges, related items and popularity. An admin row wants different
     things — status, SKU, whether it is featured. This is where one becomes
     the other, so the pages downstream see a stable shape no matter what is
     underneath.
     ----------------------------------------------------------------------- */

  function toRow(product) {
    return {
      id: product.id,
      title: product.title,
      image: product.images && product.images[0],
      dept: product.dept,
      deptLabel: product.deptLabel,
      category: product.category,
      categoryLabel: product.categoryLabel,
      price: product.price,
      compareAt: product.compareAt,
      colour: product.colour,
      sizes: product.sizes,
      inStock: product.inStock,
      /* Derived from the id so it never changes between renders, the same
         way the catalogue derives everything else. */
      sku: skuFor(product),
      status: product.inStock ? 'active' : 'out-of-stock',
      storefrontPath: product.path
    };
  }

  /** 'HAV-M-POLO-0031' — readable, stable, and unique per product. */
  function skuFor(product) {
    var dept = String(product.dept || '').slice(0, 1).toUpperCase();
    var cat = String(product.category || 'gen').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    var tail = String(product.id).replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase();
    return 'HAV-' + dept + '-' + cat + '-' + tail;
  }

  /* -----------------------------------------------------------------------
     Products
     ----------------------------------------------------------------------- */

  Repo.products = {

    /**
     * A page of products.
     *
     * options: { search, dept, category, status, sort, page, perPage }
     * resolves: { items, total, page, pages, perPage }
     *
     * Paging is done here rather than in the page so that swapping in a
     * Firestore query — which pages on the server — does not change what
     * the caller receives.
     */
    list: function (options) {
      options = options || {};

      var rows = ZB.catalogue.all().map(toRow);

      if (options.search) {
        var needle = String(options.search).toLowerCase();
        rows = rows.filter(function (row) {
          return row.title.toLowerCase().indexOf(needle) > -1 ||
                 row.sku.toLowerCase().indexOf(needle) > -1 ||
                 row.categoryLabel.toLowerCase().indexOf(needle) > -1;
        });
      }

      if (options.dept) {
        rows = rows.filter(function (row) { return row.dept === options.dept; });
      }

      if (options.category) {
        rows = rows.filter(function (row) { return row.category === options.category; });
      }

      if (options.status) {
        rows = rows.filter(function (row) { return row.status === options.status; });
      }

      var total = rows.length;
      var perPage = options.perPage || 20;
      var pages = Math.max(1, Math.ceil(total / perPage));
      var page = Math.min(Math.max(1, options.page || 1), pages);
      var start = (page - 1) * perPage;

      return Repo.defer({
        items: rows.slice(start, start + perPage),
        total: total,
        page: page,
        pages: pages,
        perPage: perPage
      });
    },

    /** One product, or null. Never throws for a bad id. */
    get: function (id) {
      var product = ZB.catalogue.byId(id);
      return Repo.defer(product ? toRow(product) : null);
    },

    /** Total count, without dragging a page of rows along with it. */
    count: function () {
      return Repo.defer(ZB.catalogue.all().length);
    }
  };

  /* -----------------------------------------------------------------------
     Orders
     ----------------------------------------------------------------------- */

  Repo.orders = {

    /** options: { search, status, payment, page, perPage } */
    list: function (options) {
      options = options || {};
      var rows = ZB.adminMock.orders();

      if (options.search) {
        var needle = String(options.search).toLowerCase();
        rows = rows.filter(function (order) {
          return order.ref.toLowerCase().indexOf(needle) > -1 ||
                 order.customerName.toLowerCase().indexOf(needle) > -1 ||
                 order.customerEmail.toLowerCase().indexOf(needle) > -1;
        });
      }

      if (options.status) {
        rows = rows.filter(function (o) { return o.status === options.status; });
      }

      if (options.payment) {
        rows = rows.filter(function (o) { return o.payment === options.payment; });
      }

      var total = rows.length;
      var perPage = options.perPage || 20;
      var pages = Math.max(1, Math.ceil(total / perPage));
      var page = Math.min(Math.max(1, options.page || 1), pages);
      var start = (page - 1) * perPage;

      return Repo.defer({
        items: rows.slice(start, start + perPage),
        total: total, page: page, pages: pages, perPage: perPage
      });
    },

    get: function (id) {
      var hit = ZB.adminMock.orders().filter(function (o) { return o.id === id; })[0];
      return Repo.defer(hit || null);
    },

    /** The newest few, for the dashboard. Already sorted newest first. */
    recent: function (limit) {
      return Repo.defer(ZB.adminMock.orders().slice(0, limit || 6));
    }
  };

  /* -----------------------------------------------------------------------
     Customers
     ----------------------------------------------------------------------- */

  Repo.customers = {

    /** options: { search, status, page, perPage } */
    list: function (options) {
      options = options || {};
      var rows = ZB.adminMock.customers();

      if (options.search) {
        var needle = String(options.search).toLowerCase();
        rows = rows.filter(function (person) {
          return person.name.toLowerCase().indexOf(needle) > -1 ||
                 person.email.toLowerCase().indexOf(needle) > -1 ||
                 person.city.toLowerCase().indexOf(needle) > -1;
        });
      }

      if (options.status) {
        rows = rows.filter(function (c) { return c.status === options.status; });
      }

      var total = rows.length;
      var perPage = options.perPage || 20;
      var pages = Math.max(1, Math.ceil(total / perPage));
      var page = Math.min(Math.max(1, options.page || 1), pages);
      var start = (page - 1) * perPage;

      return Repo.defer({
        items: rows.slice(start, start + perPage),
        total: total, page: page, pages: pages, perPage: perPage
      });
    },

    get: function (id) {
      return Repo.defer(ZB.adminMock.customer(id));
    }
  };

  /* -----------------------------------------------------------------------
     Metrics

     Every figure below is counted from the same order list the orders page
     shows, so a total on the dashboard and a row on another screen can
     never disagree. Cancelled orders are never revenue.
     ----------------------------------------------------------------------- */

  /** Orders inside the last `days` days, newest first. */
  function ordersWithin(days) {
    return ZB.adminMock.orders().filter(function (o) { return o.daysAgo < days; });
  }

  function revenueOf(list) {
    return list.reduce(function (sum, o) {
      return ZB.adminMock.isRevenue(o) ? sum + o.total : sum;
    }, 0);
  }

  /**
   * Percentage change from the previous equal-length period.
   * Returns null when there is nothing to compare against, so the tile can
   * omit the delta rather than print a meaningless 0% or an infinity.
   */
  function changePct(current, previous) {
    if (!previous) return null;
    return ((current - previous) / previous) * 100;
  }

  Repo.metrics = {

    /**
     * The headline numbers, each with its change against the period before.
     * `days` is the window the dashboard is currently showing.
     */
    summary: function (days) {
      days = days || 30;

      var all = ZB.adminMock.orders();
      var current = ordersWithin(days);
      var previous = all.filter(function (o) {
        return o.daysAgo >= days && o.daysAgo < days * 2;
      });

      var currentRevenue = revenueOf(current);
      var previousRevenue = revenueOf(previous);

      var people = ZB.adminMock.customers();
      var newPeople = people.filter(function (p) { return p.joinedDaysAgo < days; }).length;
      var previousPeople = people.filter(function (p) {
        return p.joinedDaysAgo >= days && p.joinedDaysAgo < days * 2;
      }).length;

      var products = ZB.catalogue.all();

      return Repo.defer({
        days: days,

        sales: {
          value: currentRevenue,
          change: changePct(currentRevenue, previousRevenue)
        },
        orders: {
          value: current.length,
          change: changePct(current.length, previous.length)
        },
        products: {
          value: products.length,
          /* The catalogue is fixed in this build, so there is no honest
             change to report against it. */
          change: null
        },
        customers: {
          value: people.length,
          change: changePct(newPeople, previousPeople)
        },

        pendingOrders: all.filter(function (o) {
          return o.status === 'pending' || o.status === 'processing';
        }).length,

        lowStock: products.filter(function (p) { return !p.inStock; }).length
      });
    },

    /**
     * Daily revenue, oldest first — the sales overview line.
     * Every day in the window appears, including the quiet ones, so the
     * line's shape is the real shape and not a compressed one.
     */
    salesSeries: function (days) {
      days = days || 30;

      var buckets = [];
      var byDay = {};
      var today = new Date();
      today.setHours(0, 0, 0, 0);

      for (var d = days - 1; d >= 0; d--) {
        var date = new Date(today.getTime());
        date.setDate(date.getDate() - d);
        var bucket = { date: date, daysAgo: d, value: 0, orders: 0 };
        byDay[d] = bucket;
        buckets.push(bucket);
      }

      ordersWithin(days).forEach(function (order) {
        var bucket = byDay[order.daysAgo];
        if (!bucket) return;
        bucket.orders += 1;
        if (ZB.adminMock.isRevenue(order)) bucket.value += order.total;
      });

      return Repo.defer(buckets);
    },

    /** Best sellers by revenue within the window. */
    topProducts: function (days, limit) {
      var totals = {};

      ordersWithin(days || 30).forEach(function (order) {
        if (!ZB.adminMock.isRevenue(order)) return;
        order.items.forEach(function (line) {
          var row = totals[line.id] || (totals[line.id] = {
            id: line.id, title: line.title, image: line.image,
            units: 0, revenue: 0
          });
          row.units += line.qty;
          row.revenue += line.price * line.qty;
        });
      });

      var rows = Object.keys(totals).map(function (id) { return totals[id]; });
      rows.sort(function (a, b) { return b.revenue - a.revenue; });

      return Repo.defer(rows.slice(0, limit || 5));
    },

    /**
     * The activity strip.
     *
     * Built from records that exist rather than from invented sentences,
     * so every line refers to something another screen can show.
     */
    activity: function (limit) {
      var out = [];
      var recent = ZB.adminMock.orders().slice(0, 12);

      recent.forEach(function (order) {
        if (order.status === 'shipped') {
          out.push({
            kind: 'shipped', icon: 'box', daysAgo: order.daysAgo,
            text: 'Order ' + order.ref + ' was marked shipped'
          });
        } else {
          out.push({
            kind: 'order', icon: 'receipt', daysAgo: order.daysAgo,
            text: 'New order ' + order.ref + ' from ' + order.customerName
          });
        }
      });

      ZB.catalogue.all().filter(function (p) { return !p.inStock; })
        .slice(0, 2)
        .forEach(function (product) {
          out.push({
            kind: 'stock', icon: 'archive', daysAgo: 0,
            text: product.title + ' is out of stock'
          });
        });

      out.sort(function (a, b) { return a.daysAgo - b.daysAgo; });
      return Repo.defer(out.slice(0, limit || 6));
    },

    /** The small counters beside the sidebar items. */
    navBadges: function () {
      var outOfStock = ZB.catalogue.all().filter(function (p) {
        return !p.inStock;
      }).length;

      var waiting = ZB.adminMock.orders().filter(function (o) {
        return o.status === 'pending' || o.status === 'processing';
      }).length;

      return Repo.defer({ inventory: outOfStock, orders: waiting });
    }
  };

  ZB.repo = Repo;

}(window.ZB));
