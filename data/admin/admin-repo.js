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
   Coupons, banners and the settings record arrive in their own phases. They
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
      /* Derived from the id so they never change between renders, the same
         way the catalogue derives everything else. */
      sku: skuFor(product),
      stock: stockFor(product),
      status: product.inStock ? 'active' : 'out-of-stock',
      description: product.description || '',
      featured: false,
      storefrontPath: product.path
    };
  }

  /**
   * A stock quantity for a product the catalogue only knows as in or out of
   * stock. Out of stock is zero; everything else gets a stable number from
   * its own id, with a slice of the range low enough that the inventory
   * page has genuine "running out" rows to warn about.
   */
  function stockFor(product) {
    if (!product.inStock) return 0;

    var n = 0;
    var id = String(product.id);
    for (var i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) >>> 0;

    /* One in six sits under ten; the rest spread up to about ninety. */
    return (n % 6 === 0) ? 1 + (n % 9) : 10 + (n % 80);
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

  /* -----------------------------------------------------------------------
     EDITS LIVE IN MEMORY

     There is nothing to save to. Rather than refuse to edit at all — which
     would leave the product form untestable — a write is applied to an
     overlay on top of the generated catalogue and kept for as long as the
     tab is open. A reload loses it, and the UI says so where it matters.

     The overlay is also the seam: when a backend arrives, these three
     objects go, and create/update/remove become calls that return the
     server's answer. Nothing else changes, because no page reaches past
     these methods.
     ----------------------------------------------------------------------- */

  var edited = {};     /* id -> the fields that were changed */
  var removed = {};    /* id -> true */
  var added = [];      /* rows created in this session, newest first */
  var nextId = 1;

  /** The catalogue as the admin currently sees it. */
  function currentRows() {
    var rows = added.concat(ZB.catalogue.all().map(toRow));

    return rows
      .filter(function (row) { return !removed[row.id]; })
      .map(function (row) {
        if (!edited[row.id]) return row;

        /* A shallow merge is enough: the form writes whole fields. */
        var merged = {};
        Object.keys(row).forEach(function (key) { merged[key] = row[key]; });
        Object.keys(edited[row.id]).forEach(function (key) {
          merged[key] = edited[row.id][key];
        });
        return merged;
      });
  }

  /* `newest` is deliberately absent: it means "leave the natural order
     alone". currentRows() puts anything created in this session in front of
     the catalogue, so that order already is newest-first. Sorting by id
     instead looked right and was not — ids are not chronological, so a
     product created a moment ago landed in the middle of the first page
     under a heading that promised otherwise. */
  var SORTS = {
    'name-asc':  function (a, b) { return a.title.localeCompare(b.title); },
    'name-desc': function (a, b) { return b.title.localeCompare(a.title); },
    'price-asc': function (a, b) { return a.price - b.price; },
    'price-desc': function (a, b) { return b.price - a.price; },
    'stock-asc': function (a, b) { return (a.stock || 0) - (b.stock || 0); }
  };

  Repo.products = {

    sorts: [
      { id: 'newest', label: 'Newest first' },
      { id: 'name-asc', label: 'Name A–Z' },
      { id: 'name-desc', label: 'Name Z–A' },
      { id: 'price-asc', label: 'Price, low to high' },
      { id: 'price-desc', label: 'Price, high to low' },
      { id: 'stock-asc', label: 'Stock, low to high' }
    ],

    /** The values the filter controls offer, taken from the data itself. */
    facets: function () {
      var rows = currentRows();
      var depts = {};
      var categories = {};

      rows.forEach(function (row) {
        depts[row.dept] = row.deptLabel;
        categories[row.category] = row.categoryLabel;
      });

      var toList = function (map) {
        return Object.keys(map).sort(function (a, b) {
          return map[a].localeCompare(map[b]);
        }).map(function (id) { return { id: id, label: map[id] }; });
      };

      return Repo.defer({
        departments: toList(depts),
        categories: toList(categories),
        statuses: [
          { id: 'active', label: 'Active' },
          { id: 'draft', label: 'Draft' },
          { id: 'out-of-stock', label: 'Out of stock' }
        ]
      });
    },

    /**
     * A page of products.
     *
     * options: { search, dept, category, status, sort, page, perPage }
     * resolves: { items, total, page, pages, perPage }
     *
     * Paging is done here rather than in the page so that swapping in a
     * server query — which pages on the server — does not change what the
     * caller receives.
     */
    list: function (options) {
      options = options || {};

      var rows = currentRows();

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

      /* Sorting before paging, or page two would be sorted on its own.
         An unknown sort, and 'newest', both leave the natural order. */
      var compare = SORTS[options.sort];
      if (compare) rows = rows.slice().sort(compare);

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
      var hit = currentRows().filter(function (row) { return row.id === id; })[0];
      return Repo.defer(hit || null);
    },

    /** Total count, without dragging a page of rows along with it. */
    count: function () {
      return Repo.defer(currentRows().length);
    },

    /* -- writes. See the note above: these live in memory only. -- */

    create: function (data) {
      var id = 'new-' + (nextId++);

      var row = {
        id: id,
        title: data.title,
        image: (data.images && data.images[0]) || null,
        dept: data.dept,
        deptLabel: data.deptLabel || data.dept,
        category: data.category,
        categoryLabel: data.categoryLabel || data.category,
        price: data.price,
        compareAt: data.compareAt || null,
        colour: data.colour || null,
        sizes: data.sizes || [],
        stock: data.stock || 0,
        inStock: (data.stock || 0) > 0,
        sku: data.sku || ('HAV-NEW-' + id.toUpperCase()),
        status: data.status || 'draft',
        featured: !!data.featured,
        description: data.description || '',
        storefrontPath: null
      };

      added.unshift(row);
      return Repo.defer(row);
    },

    update: function (id, data) {
      var exists = currentRows().some(function (row) { return row.id === id; });
      if (!exists) {
        return Promise.reject({ message: 'That product no longer exists.' });
      }

      /* A row created this session is edited in place; a generated one gets
         an overlay entry, because the catalogue itself is not writable. */
      var own = added.filter(function (row) { return row.id === id; })[0];

      if (own) {
        Object.keys(data).forEach(function (key) { own[key] = data[key]; });
      } else {
        edited[id] = edited[id] || {};
        Object.keys(data).forEach(function (key) { edited[id][key] = data[key]; });
      }

      return Repo.products.get(id);
    },

    /**
     * Removing a generated product only hides it, which is what makes
     * restore() possible. A row created in this session has nowhere to be
     * hidden from, so it is handed back for restore() to put again.
     */
    remove: function (id) {
      var own = added.filter(function (row) { return row.id === id; })[0];

      if (own) {
        added = added.filter(function (row) { return row.id !== id; });
      } else {
        removed[id] = true;
      }

      var undo = { id: id, row: own || null, edits: edited[id] || null };
      delete edited[id];

      return Repo.defer(undo);
    },

    /** Put back what remove() took, from the token it returned. */
    restore: function (undo) {
      if (!undo) return Repo.defer(false);

      if (undo.row) added.unshift(undo.row);
      else delete removed[undo.id];

      if (undo.edits) edited[undo.id] = undo.edits;
      return Repo.defer(true);
    },

    /**
     * Whether anything has been changed in this session.
     * The list uses it to say plainly that the changes are not saved.
     */
    hasUnsavedEdits: function () {
      return added.length > 0 || Object.keys(edited).length > 0 ||
             Object.keys(removed).length > 0;
    }
  };
  /* -----------------------------------------------------------------------
     Orders

     STATUS CHANGES LIVE IN MEMORY, LIKE EVERY OTHER WRITE
     Marking an order shipped is the one thing an owner does on this screen
     every day, so the panel has to be able to do it — but there is nothing
     to save to. The change goes into the overlay below and is gone on
     reload, and the screen says so.

     The overlay is also where the seam is. With a backend, `orderEdits`
     goes and updateStatus() becomes the call that writes it; the pages do
     not change, because none of them reaches past these methods.

     WHAT THE STATUS FLOW ALLOWS, AND WHY IT IS HERE AND NOT IN THE PAGE
     An order moves forward: pending, processing, shipped, delivered. It can
     be cancelled while it has not yet shipped. Delivered and cancelled are
     final. Putting that rule in the page would mean writing it again on
     every screen that offers the action — the list and the detail view
     already both do — and two copies of a rule is one copy too many.
     ----------------------------------------------------------------------- */

  var orderEdits = {};   /* id -> { status, statusLabel, payment, ... } */

  /**
   * What an order may become next.
   *
   * Returns [] for a finished order, which is how both screens know to
   * offer nothing rather than to offer something that will be refused.
   */
  var NEXT_STATUS = {
    pending:    ['processing', 'cancelled'],
    processing: ['shipped', 'cancelled'],
    shipped:    ['delivered'],
    delivered:  [],
    cancelled:  []
  };

  /* The order the stages happen in, for the progress strip. Cancelled is
     not a stage — it is a way of leaving the sequence — so it is absent
     here and drawn separately. */
  var STATUS_FLOW = ['pending', 'processing', 'shipped', 'delivered'];

  function orderLabel(id) {
    var hit = ZB.adminSeed.statuses.filter(function (s) { return s.id === id; })[0];
    return hit ? hit.label : id;
  }

  function paymentLabel(id) {
    var hit = ZB.adminSeed.payments.filter(function (p) { return p.id === id; })[0];
    return hit ? hit.label : id;
  }

  /** One order with any changes made this session applied on top. */
  function withEdits(order) {
    if (!orderEdits[order.id]) return order;

    var merged = {};
    Object.keys(order).forEach(function (key) { merged[key] = order[key]; });
    Object.keys(orderEdits[order.id]).forEach(function (key) {
      merged[key] = orderEdits[order.id][key];
    });
    return merged;
  }

  function currentOrders() {
    return ZB.adminMock.orders().map(withEdits);
  }

  var ORDER_SORTS = {
    oldest:      function (a, b) { return b.daysAgo - a.daysAgo; },
    'total-desc': function (a, b) { return b.total - a.total; },
    'total-asc':  function (a, b) { return a.total - b.total; },
    'items-desc': function (a, b) { return b.itemCount - a.itemCount; }
  };

  Repo.orders = {

    /* 'newest' is absent for the same reason 'newest' is absent from the
       product sorts: it means "leave the natural order alone", and the mock
       already emits orders newest first. */
    sorts: [
      { id: 'newest', label: 'Newest first' },
      { id: 'oldest', label: 'Oldest first' },
      { id: 'total-desc', label: 'Highest value' },
      { id: 'total-asc', label: 'Lowest value' },
      { id: 'items-desc', label: 'Most items' }
    ],

    /** The windows the date filter offers. `days` of 0 means everything. */
    ranges: [
      { id: '7', label: 'Last 7 days', days: 7 },
      { id: '30', label: 'Last 30 days', days: 30 },
      { id: '90', label: 'Last 90 days', days: 90 }
    ],

    statusFlow: STATUS_FLOW,

    /** What this order may be moved to, as [{ id, label }]. */
    nextStatuses: function (status) {
      return (NEXT_STATUS[status] || []).map(function (id) {
        return { id: id, label: orderLabel(id) };
      });
    },

    facets: function () {
      var rows = currentOrders();

      var statuses = {};
      var payments = {};
      rows.forEach(function (order) {
        statuses[order.status] = orderLabel(order.status);
        payments[order.payment] = paymentLabel(order.payment);
      });

      /* Kept in the seed's own order rather than alphabetised: Pending,
         Processing, Shipped, Delivered is a sequence, and sorting it by
         name would scramble it into something nobody can scan. */
      var inSeedOrder = function (seedList, present) {
        return seedList.filter(function (item) { return present[item.id]; })
                       .map(function (item) {
                         return { id: item.id, label: item.label };
                       });
      };

      var statusList = inSeedOrder(ZB.adminSeed.statuses, statuses);

      /* "Needs action" is not a status an order has — it is the question an
         owner opens this screen with, and the answer spans two of them.
         Offering it here rather than making the reader select Pending, read
         the list, then select Processing and read it again is the whole
         point of a filter. It sits first because it is what the screen is
         most often opened for. */
      if (statuses.pending || statuses.processing) {
        statusList.unshift({ id: 'waiting', label: 'Needs action' });
      }

      return Repo.defer({
        statuses: statusList,
        payments: inSeedOrder(ZB.adminSeed.payments, payments),
        ranges: Repo.orders.ranges
      });
    },

    /** options: { search, status, payment, range, sort, page, perPage } */
    list: function (options) {
      options = options || {};
      var rows = currentOrders();

      if (options.search) {
        var needle = String(options.search).toLowerCase();
        rows = rows.filter(function (order) {
          return order.ref.toLowerCase().indexOf(needle) > -1 ||
                 order.customerName.toLowerCase().indexOf(needle) > -1 ||
                 order.customerEmail.toLowerCase().indexOf(needle) > -1 ||
                 order.city.toLowerCase().indexOf(needle) > -1;
        });
      }

      if (options.status === 'waiting') {
        /* The pseudo-status from facets(). Kept here rather than in the
           page so the tile, the select and any future link all mean the
           same thing by it. */
        rows = rows.filter(function (o) {
          return o.status === 'pending' || o.status === 'processing';
        });
      } else if (options.status) {
        rows = rows.filter(function (o) { return o.status === options.status; });
      }

      if (options.payment) {
        rows = rows.filter(function (o) { return o.payment === options.payment; });
      }

      if (options.range) {
        var days = parseInt(options.range, 10);
        if (days > 0) {
          rows = rows.filter(function (o) { return o.daysAgo < days; });
        }
      }

      var compare = ORDER_SORTS[options.sort];
      if (compare) rows = rows.slice().sort(compare);

      var total = rows.length;
      var perPage = options.perPage || 20;
      var pages = Math.max(1, Math.ceil(total / perPage));
      var page = Math.min(Math.max(1, options.page || 1), pages);
      var start = (page - 1) * perPage;

      /* Revenue for the filtered set, not just for the page on screen —
         "of 214 orders" above a table is only half an answer when the
         question is how much they came to. Cancelled orders are excluded,
         the same rule the dashboard uses. */
      var revenue = rows.reduce(function (sum, order) {
        return ZB.adminMock.isRevenue(order) ? sum + order.total : sum;
      }, 0);

      return Repo.defer({
        items: rows.slice(start, start + perPage),
        total: total, page: page, pages: pages, perPage: perPage,
        revenue: revenue
      });
    },

    get: function (id) {
      var hit = currentOrders().filter(function (o) { return o.id === id; })[0];
      return Repo.defer(hit || null);
    },

    /** The newest few, for the dashboard. Already sorted newest first. */
    recent: function (limit) {
      return Repo.defer(currentOrders().slice(0, limit || 6));
    },

    /** The counts behind the status filter, for the strip above the list. */
    summary: function () {
      var rows = currentOrders();
      var counts = {};

      rows.forEach(function (order) {
        counts[order.status] = (counts[order.status] || 0) + 1;
      });

      return Repo.defer({
        total: rows.length,
        counts: counts,
        /* The two an owner opens this screen to act on. */
        waiting: (counts.pending || 0) + (counts.processing || 0),
        unpaid: rows.filter(function (o) { return o.payment === 'unpaid'; }).length,
        revenue: rows.reduce(function (sum, o) {
          return ZB.adminMock.isRevenue(o) ? sum + o.total : sum;
        }, 0)
      });
    },

    /* -- writes. In memory only. -- */

    /**
     * Move an order to a new status.
     *
     * Rejects a move the flow does not allow rather than quietly applying
     * it: a UI bug that offers the wrong button should surface here, not
     * become a delivered order that was never shipped.
     */
    updateStatus: function (id, status) {
      var order = currentOrders().filter(function (o) { return o.id === id; })[0];
      if (!order) return Promise.reject({ message: 'That order no longer exists.' });

      var allowed = (NEXT_STATUS[order.status] || []).indexOf(status) > -1;
      if (!allowed) {
        return Promise.reject({
          message: 'An order that is ' + orderLabel(order.status).toLowerCase() +
                   ' cannot be moved to ' + orderLabel(status).toLowerCase() + '.'
        });
      }

      var change = { status: status, statusLabel: orderLabel(status) };

      /* Cancelling settles the money too. Leaving payment on "Paid" beside
         a cancelled order states something the shop would have to answer
         for, and the mock's own revenue rule already treats a cancelled
         order as no longer earned. */
      if (status === 'cancelled' && order.payment === 'paid') {
        change.payment = 'refunded';
        change.paymentLabel = paymentLabel('refunded');
      }

      orderEdits[id] = orderEdits[id] || {};
      Object.keys(change).forEach(function (key) {
        orderEdits[id][key] = change[key];
      });

      return Repo.orders.get(id);
    },

    /** Mark an unpaid order paid — the other thing that happens by hand. */
    markPaid: function (id) {
      var order = currentOrders().filter(function (o) { return o.id === id; })[0];
      if (!order) return Promise.reject({ message: 'That order no longer exists.' });

      if (order.payment === 'paid') return Repo.defer(order);

      orderEdits[id] = orderEdits[id] || {};
      orderEdits[id].payment = 'paid';
      orderEdits[id].paymentLabel = paymentLabel('paid');

      return Repo.orders.get(id);
    },

    /** Undo support: put an order back exactly as it was. */
    restore: function (id, previous) {
      if (!previous) return Repo.defer(false);

      orderEdits[id] = orderEdits[id] || {};
      Object.keys(previous).forEach(function (key) {
        orderEdits[id][key] = previous[key];
      });

      return Repo.defer(true);
    },

    hasUnsavedEdits: function () {
      return Object.keys(orderEdits).length > 0;
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

  /* -----------------------------------------------------------------------
     Categories

     WHERE A CATEGORY COMES FROM
     Not from a table of its own. The storefront's menu is ZB.navigation,
     and that tree already *is* the category structure — three departments,
     each holding categories, some of which hold sub-categories. Inventing a
     second list here would let the panel and the shop disagree about what
     the store sells, which is the one thing this screen must never do.

     So this reads the same tree, flattens it into rows, and counts the
     products behind each one through ZB.catalogue — the same call the
     storefront's own category page makes. A count shown here is therefore
     the count a shopper would actually land on.

     WHAT AN EDIT CAN AND CANNOT DO, HONESTLY
     A rename or a hide is held in the overlay below, exactly like a product
     edit, and is gone on reload. It also does not reach the storefront:
     the two are separate documents, and ZB.navigation is a file, not a
     database. The UI says so rather than implying otherwise — and the
     category's storefront URL is deliberately built from its original
     `slug`, never from the edited name, so a renamed category still links
     to the page that actually exists.

     Adding a backend replaces the body of these methods. The navigation
     tree becomes the seed for the first import and nothing above this line
     changes.
     ----------------------------------------------------------------------- */

  var catEdited = {};   /* id -> changed fields */
  var catRemoved = {};  /* id -> true */
  var catAdded = [];    /* created this session, newest first */
  var catNextId = 1;

  /** Flatten ZB.navigation into rows, parents immediately before children. */
  function navigationRows() {
    var slug = ZB.ui.slug;
    var rows = [];

    (ZB.navigation || []).forEach(function (dept) {
      dept.items.forEach(function (item) {
        var itemSlug = slug(item.label);
        var parentId = dept.id + '/' + itemSlug;
        var children = item.children || [];

        rows.push({
          id: parentId,
          label: item.label,
          slug: itemSlug,
          dept: dept.id,
          deptLabel: dept.label,
          parentId: null,
          parentLabel: null,
          level: 1,
          childCount: children.length,
          status: 'active',
          source: 'navigation'
        });

        children.forEach(function (child) {
          var childSlug = slug(child.label);
          rows.push({
            id: parentId + '/' + childSlug,
            label: child.label,
            slug: childSlug,
            dept: dept.id,
            deptLabel: dept.label,
            parentId: parentId,
            parentLabel: item.label,
            level: 2,
            childCount: 0,
            status: 'active',
            source: 'navigation'
          });
        });
      });
    });

    return rows;
  }

  /**
   * How many products sit behind a category.
   *
   * ZB.catalogue.byCategory already answers this for both shapes: a leaf
   * returns its own products, and a category with children returns
   * everything underneath it. Counting the children by hand here would be a
   * second implementation of the same rule, free to drift from the one the
   * shop uses.
   */
  function productCountFor(row) {
    if (row.source !== 'navigation') return 0;
    return ZB.catalogue.byCategory(row.dept, row.slug).length;
  }

  /**
   * Where a newly added category goes in menu order.
   *
   * Not the front of the list, which is where the product overlay puts a
   * new row and is right there — a product list has no natural order to
   * violate. A category list does. Prepending put a brand-new sub-category
   * one row ABOVE the parent it belongs to, indented, with the hairline
   * that says "these belong together" pointing at the wrong row. The tree
   * has to stay a tree, so an added row is spliced in where it actually
   * belongs: after its parent's existing children, or at the end of its
   * department for a top-level one.
   *
   * The page makes the new row findable by flashing it instead.
   */
  function spliceIntoTree(rows, row) {
    var at = -1;

    if (row.parentId) {
      var parentAt = -1;
      rows.forEach(function (other, i) {
        if (other.id === row.parentId) parentAt = i;
      });

      if (parentAt > -1) {
        at = parentAt + 1;
        while (at < rows.length && rows[at].parentId === row.parentId) at++;
      }
    } else {
      /* After everything already in this department. */
      rows.forEach(function (other, i) {
        if (other.dept === row.dept) at = i + 1;
      });
    }

    if (at < 0) rows.push(row);
    else rows.splice(at, 0, row);
  }

  /** The category tree as the admin currently sees it. */
  function currentCategories() {
    var rows = navigationRows();

    /* Oldest first, so a category added under one added a moment earlier
       finds its parent already in place. */
    catAdded.slice().reverse().forEach(function (row) {
      spliceIntoTree(rows, row);
    });

    var live = rows
      .filter(function (row) { return !catRemoved[row.id]; })
      .map(function (row) {
        var merged = {};
        Object.keys(row).forEach(function (key) { merged[key] = row[key]; });

        if (catEdited[row.id]) {
          Object.keys(catEdited[row.id]).forEach(function (key) {
            merged[key] = catEdited[row.id][key];
          });
        }

        merged.productCount = productCountFor(row);
        /* Built from `slug`, not from the edited label — see the note
           above. A row added in this session has no storefront page at
           all, so it gets no link rather than a broken one. */
        merged.storefrontPath = row.source === 'navigation'
          ? '/category/' + row.dept + '/' + row.slug
          : null;

        return merged;
      });

    /* Recounted from what actually survives rather than carried over from
       the navigation tree: deleting a sub-category has to change the
       "3 sub-categories" line on its parent in the same breath, or the row
       above contradicts the rows below it. */
    var kids = {};
    live.forEach(function (row) {
      if (row.parentId) kids[row.parentId] = (kids[row.parentId] || 0) + 1;
    });
    live.forEach(function (row) { row.childCount = kids[row.id] || 0; });

    return live;
  }

  /* 'tree' is the natural order — navigationRows() already emits parents
     immediately before their own children, which is the order the menu
     itself reads in. Every other sort breaks that adjacency, so the page
     stops indenting when one is chosen rather than indenting rows whose
     parent is now forty lines away. */
  var CATEGORY_SORTS = {
    'name-asc':      function (a, b) { return a.label.localeCompare(b.label); },
    'name-desc':     function (a, b) { return b.label.localeCompare(a.label); },
    'products-desc': function (a, b) { return b.productCount - a.productCount; },
    'products-asc':  function (a, b) { return a.productCount - b.productCount; }
  };

  Repo.categories = {

    sorts: [
      { id: 'tree', label: 'Menu order' },
      { id: 'name-asc', label: 'Name A–Z' },
      { id: 'name-desc', label: 'Name Z–A' },
      { id: 'products-desc', label: 'Most products' },
      { id: 'products-asc', label: 'Fewest products' }
    ],

    /**
     * The filter options, taken from the data itself so a control can never
     * offer a value that would return nothing — the same rule the
     * storefront's facets follow.
     */
    facets: function () {
      var rows = currentCategories();

      var depts = {};
      var statuses = {};
      var levels = {};

      rows.forEach(function (row) {
        depts[row.dept] = row.deptLabel;
        statuses[row.status] = row.status === 'active' ? 'Visible' : 'Hidden';
        levels[row.level] = row.level === 1 ? 'Top level' : 'Sub-category';
      });

      var toList = function (map, sortByLabel) {
        var keys = Object.keys(map);
        keys.sort(sortByLabel
          ? function (a, b) { return map[a].localeCompare(map[b]); }
          : function (a, b) { return Number(a) - Number(b); });
        return keys.map(function (id) { return { id: id, label: map[id] }; });
      };

      return Repo.defer({
        departments: toList(depts, true),
        statuses: toList(statuses, true),
        levels: toList(levels, false),
        /* Every category that is allowed to be a parent, for the add form.
           Only top-level rows qualify: the storefront menu is two deep and
           a third level would have nowhere to render. */
        parents: rows.filter(function (row) { return row.level === 1; })
                     .map(function (row) {
                       return { id: row.id, label: row.deptLabel + ' → ' + row.label,
                                dept: row.dept };
                     })
      });
    },

    /**
     * A page of categories.
     * options: { search, dept, level, status, sort, page, perPage }
     * resolves: { items, total, page, pages, perPage, tree }
     *
     * `tree` tells the page whether the rows are still in menu order and
     * can therefore be indented.
     */
    list: function (options) {
      options = options || {};
      var rows = currentCategories();

      if (options.search) {
        var needle = String(options.search).toLowerCase();
        rows = rows.filter(function (row) {
          return row.label.toLowerCase().indexOf(needle) > -1 ||
                 (row.parentLabel || '').toLowerCase().indexOf(needle) > -1 ||
                 row.deptLabel.toLowerCase().indexOf(needle) > -1;
        });
      }

      if (options.dept) {
        rows = rows.filter(function (row) { return row.dept === options.dept; });
      }

      if (options.level) {
        rows = rows.filter(function (row) {
          return String(row.level) === String(options.level);
        });
      }

      if (options.status) {
        rows = rows.filter(function (row) { return row.status === options.status; });
      }

      var compare = CATEGORY_SORTS[options.sort];
      if (compare) rows = rows.slice().sort(compare);

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
        perPage: perPage,
        tree: !compare
      });
    },

    get: function (id) {
      var hit = currentCategories().filter(function (row) { return row.id === id; })[0];
      return Repo.defer(hit || null);
    },

    /** Every category, unpaged — for the summary tiles above the list. */
    summary: function () {
      var rows = currentCategories();
      var empty = rows.filter(function (row) { return row.productCount === 0; });

      return Repo.defer({
        total: rows.length,
        topLevel: rows.filter(function (row) { return row.level === 1; }).length,
        hidden: rows.filter(function (row) { return row.status !== 'active'; }).length,
        empty: empty.length
      });
    },

    /* -- writes. In memory only, exactly like products. -- */

    create: function (data) {
      var id = 'new-cat-' + (catNextId++);
      var parent = data.parentId
        ? currentCategories().filter(function (row) { return row.id === data.parentId; })[0]
        : null;

      var dept = parent ? parent.dept : data.dept;
      var deptRow = (ZB.navigation || []).filter(function (d) { return d.id === dept; })[0];

      var row = {
        id: id,
        label: data.label,
        slug: ZB.ui.slug(data.label),
        dept: dept,
        deptLabel: deptRow ? deptRow.label : dept,
        parentId: parent ? parent.id : null,
        parentLabel: parent ? parent.label : null,
        level: parent ? 2 : 1,
        childCount: 0,
        status: data.status || 'active',
        source: 'new'
      };

      catAdded.unshift(row);
      return Repo.defer(row);
    },

    update: function (id, data) {
      var exists = currentCategories().some(function (row) { return row.id === id; });
      if (!exists) {
        return Promise.reject({ message: 'That category no longer exists.' });
      }

      var own = catAdded.filter(function (row) { return row.id === id; })[0];

      if (own) {
        Object.keys(data).forEach(function (key) { own[key] = data[key]; });
        if (data.label) own.slug = ZB.ui.slug(data.label);
      } else {
        catEdited[id] = catEdited[id] || {};
        Object.keys(data).forEach(function (key) { catEdited[id][key] = data[key]; });
      }

      return Repo.categories.get(id);
    },

    /**
     * Remove a category, and with it anything filed underneath it.
     *
     * Leaving the children behind would put rows in the list whose parent
     * is gone — orphans the reader cannot get back to and cannot explain.
     * The count of what will go is shown in the dialog before this runs.
     *
     * Products are never touched. A category is a label on the menu; the
     * products it held still exist and still belong to the department.
     */
    remove: function (id) {
      var all = currentCategories();
      var doomed = all.filter(function (row) {
        return row.id === id || row.parentId === id;
      });

      var undo = { rows: [], removed: [], edits: {} };

      doomed.forEach(function (row) {
        var own = catAdded.filter(function (added) { return added.id === row.id; })[0];

        if (own) {
          undo.rows.push(own);
          catAdded = catAdded.filter(function (added) { return added.id !== row.id; });
        } else {
          undo.removed.push(row.id);
          catRemoved[row.id] = true;
        }

        if (catEdited[row.id]) {
          undo.edits[row.id] = catEdited[row.id];
          delete catEdited[row.id];
        }
      });

      undo.count = doomed.length;
      return Repo.defer(undo);
    },

    restore: function (undo) {
      if (!undo) return Repo.defer(false);

      (undo.rows || []).forEach(function (row) { catAdded.unshift(row); });
      (undo.removed || []).forEach(function (id) { delete catRemoved[id]; });
      Object.keys(undo.edits || {}).forEach(function (id) {
        catEdited[id] = undo.edits[id];
      });

      return Repo.defer(true);
    },

    /** How many sub-categories a row would take with it. */
    childrenOf: function (id) {
      return currentCategories().filter(function (row) { return row.parentId === id; });
    },

    hasUnsavedEdits: function () {
      return catAdded.length > 0 || Object.keys(catEdited).length > 0 ||
             Object.keys(catRemoved).length > 0;
    }
  };

  ZB.repo = Repo;

}(window.ZB));
