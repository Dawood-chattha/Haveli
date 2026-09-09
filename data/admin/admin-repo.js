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

   EVERY SECTION THE PANEL HAS IS HERE
   Products, inventory, orders, customers, metrics, categories, banners,
   coupons, reports and settings. Nothing is stubbed out in advance, so a
   method that exists here always works.

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
     THE OVERLAY, AND WHAT IS LEFT OF IT

     Every write on this page used to land here: an edit was held in memory
     on top of the generated catalogue and lost on reload, because there was
     nothing to save to. Products and categories now save to the database,
     and this remains for the one section that has not been connected yet.

     Inventory reads currentRows(), which is built from ZB.catalogue — the
     storefront's own list, keyed by slug rather than by the database id the
     product endpoints take. Connecting it is a step of its own, and until
     then its stock changes are held here exactly as they were, with the
     page still saying so.
     ----------------------------------------------------------------------- */

  var edited = {};     /* id -> the fields that were changed */

  /** The catalogue as the admin currently sees it. */
  function currentRows() {
    /* ALWAYS A COPY, EVEN WHEN THERE IS NOTHING TO MERGE
       The obvious shortcut is to return `row` untouched when it has no
       overlay entry. It is wrong: handing out the object means a caller
       holds a live reference into the repo's own state. Two things then go
       wrong. A page can change the store by accident, without going through
       a write method. And a value read a moment ago silently changes under
       whoever is still holding it — which is not how a value fetched from a
       server behaves.

       A shallow copy is enough: writes replace whole fields. */
    return ZB.catalogue.all().map(toRow).map(function (row) {
      var merged = {};
      Object.keys(row).forEach(function (key) { merged[key] = row[key]; });

      if (edited[row.id]) {
        Object.keys(edited[row.id]).forEach(function (key) {
          merged[key] = edited[row.id][key];
        });
      }

      return merged;
    });
  }

  /* -----------------------------------------------------------------------
     Talking to the API

     Everything below this line that concerns products or categories is a
     real request to a real server. The rest of this file is still the
     in-memory mock described above, and each remaining section says so.

     WHAT THIS DOES NOT SEND
     No key, no token, no identity of any kind. The browser is signed in
     with an HttpOnly cookie that JavaScript cannot read, which is the point
     of it: `credentials: 'same-origin'` tells fetch to attach the cookie,
     and nothing here ever holds the value. Whether the caller is allowed to
     do what they asked is decided by api/_lib/auth.js and then again by the
     policies in db/policies.sql. This module only draws the answer.
     ----------------------------------------------------------------------- */

  var Api = {

    /**
     * A request that resolves with `data` or rejects with an Error.
     *
     * The rejection carries the server's own message, because the server is
     * the only party that knows what went wrong — "the original price must
     * be higher than the sale price" is worth showing, and this file could
     * not have written it. `fields` comes along when the server named the
     * fields at fault, so a form can mark them.
     */
    send: function (method, path, body) {
      var options = {
        method: method,
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      };

      if (body !== undefined) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
      }

      return fetch(path, options).then(function (res) {
        return res.json().catch(function () {
          /* A response that is not JSON at all — a proxy error page, or the
             storefront's index.html served because the route was missed. */
          throw new Error('The server did not answer properly (' + res.status + ').');
        }).then(function (payload) {
          if (res.ok && payload && payload.ok) return payload.data;

          var error = new Error(
            (payload && payload.error && payload.error.message) ||
            'That could not be completed.');

          error.status = res.status;
          error.code = payload && payload.error && payload.error.code;
          error.fields = payload && payload.error && payload.error.fields;

          throw error;
        });
      });
    },

    get: function (path) { return Api.send('GET', path); },

    /** A path with a query string, skipping anything empty. */
    query: function (path, params) {
      var parts = [];

      Object.keys(params || {}).forEach(function (key) {
        var value = params[key];
        if (value === null || value === undefined || value === '') return;
        parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
      });

      return parts.length ? path + '?' + parts.join('&') : path;
    }
  };

  Repo.api = Api;

  /* -----------------------------------------------------------------------
     Products

     PAGED BY THE SERVER, UNLIKE THE STOREFRONT
     The shop downloads its whole catalogue and filters it in the browser,
     which is what makes its facets instant. The panel does not: it asks for
     one page at a time, with the search and the filters in the query
     string, because a shop with ten thousand products still has to open its
     product list in a moment. The pages here already expected
     { items, total, page, pages } and drew a pager from it, so nothing
     above this file changed.

     WHAT A WRITE IS TRUSTED FOR
     Nothing. The slug, the SKU and the department are all derived on the
     server; the price is checked against the schema; whether this browser
     may write at all is decided from the database on every request. A field
     sent from here is a request, not an instruction.
     ----------------------------------------------------------------------- */

  Repo.products = {

    sorts: [
      { id: 'newest', label: 'Newest first' },
      { id: 'name-asc', label: 'Name A–Z' },
      { id: 'name-desc', label: 'Name Z–A' },
      { id: 'price-asc', label: 'Price, low to high' },
      { id: 'price-desc', label: 'Price, high to low' },
      { id: 'stock-asc', label: 'Stock, low to high' }
    ],

    /**
     * The values the filter controls offer.
     *
     * Taken from the category tree rather than from a page of products,
     * which is the difference between "the departments this page happens to
     * show" and "the departments the shop has". There is no endpoint of its
     * own for this: the categories the panel already loads answer it.
     */
    facets: function () {
      return Categories.load().then(function (tree) {
        var categories = {};

        tree.items.forEach(function (row) {
          /* Keyed by slug, because that is what the product list filters
             by. Two departments may legitimately use the same category
             name, and the option merges them — the same behaviour the
             filter itself has. */
          categories[row.slug] = row.label;
        });

        return {
          departments: tree.departments.map(function (dept) {
            return { id: dept.slug, label: dept.label };
          }),
          categories: Object.keys(categories).sort(function (a, b) {
            return categories[a].localeCompare(categories[b]);
          }).map(function (slug) {
            return { id: slug, label: categories[slug] };
          }),
          statuses: [
            { id: 'active', label: 'Active' },
            { id: 'draft', label: 'Draft' },
            { id: 'out-of-stock', label: 'Out of stock' }
          ]
        };
      });
    },

    /**
     * A page of products.
     *
     * options: { search, dept, category, status, sort, page, perPage }
     * resolves: { items, total, page, pages, perPage }
     */
    list: function (options) {
      options = options || {};

      return Api.get(Api.query('/api/admin/products', {
        search: options.search,
        dept: options.dept,
        category: options.category,
        status: options.status,
        sort: options.sort,
        page: options.page,
        perPage: options.perPage
      }));
    },

    /** One product, or null. Never throws for a bad id. */
    get: function (id) {
      return Api.get('/api/admin/products/' + encodeURIComponent(id))
        .then(function (data) { return data.product; })
        .catch(function (err) {
          if (err.status === 404) return null;
          throw err;
        });
    },

    /** Total count, without dragging a page of rows along with it. */
    count: function () {
      return Repo.products.list({ perPage: 1 }).then(function (result) {
        return result.total;
      });
    },

    /* -- writes -- */

    create: function (data) {
      return toServerProduct(data).then(function (body) {
        return Api.send('POST', '/api/admin/products', body);
      }).then(function (result) { return result.product; });
    },

    update: function (id, data) {
      return toServerProduct(data).then(function (body) {
        return Api.send('PATCH', '/api/admin/products/' + encodeURIComponent(id), body);
      }).then(function (result) { return result.product; });
    },

    /**
     * Remove a product, which archives it.
     *
     * It leaves the shop immediately and the row stays, because past orders
     * point at it. The token returned is the status it had, which is what
     * restore() puts back — not 'active', because archiving a draft and
     * then undoing it must not publish it.
     */
    remove: function (id) {
      return Api.send('DELETE', '/api/admin/products/' + encodeURIComponent(id))
        .then(function (result) {
          return { id: id, previousStatus: result.previousStatus };
        });
    },

    /** Put back what remove() took, from the token it returned. */
    restore: function (undo) {
      if (!undo || !undo.id) return Promise.resolve(false);

      return Api.send('PATCH', '/api/admin/products/' + encodeURIComponent(undo.id),
                      { status: undo.previousStatus || 'draft' })
        .then(function () { return true; });
    },

    /**
     * Whether anything has been changed but not saved.
     *
     * Always false now, and the honest answer: every write above reaches
     * the database before its promise resolves. The list still asks, and
     * still has the banner for it, because the sections that have not been
     * connected yet answer this question differently.
     */
    hasUnsavedEdits: function () {
      return false;
    }
  };

  /**
   * Write a change into the in-memory overlay currentRows() reads.
   *
   * What Repo.products.update used to be, and all that is left of it. Only
   * inventory uses it now, for the reason given at its setStock; the
   * product list and the product form both write to the database.
   */
  function overlayEdit(id, data) {
    var exists = currentRows().some(function (row) { return row.id === id; });
    if (!exists) {
      return Promise.reject(new Error('That product no longer exists.'));
    }

    edited[id] = edited[id] || {};
    Object.keys(data).forEach(function (key) { edited[id][key] = data[key]; });

    return Repo.defer(currentRows().filter(function (row) { return row.id === id; })[0]);
  }

  /**
   * Turn what the product form collected into what the API accepts.
   *
   * The form has always worked in `dept` + `category` slugs, because that
   * is what the storefront's URLs are made of. The database files a product
   * under one category id and copies the department down from it with a
   * trigger, so the department in the form is not sent at all — it is
   * already implied by the category, and sending both would create a way
   * for them to disagree.
   *
   * Only keys the caller actually supplied are forwarded, so an edit that
   * touched the price does not resend — and risk overwriting — everything
   * else on the product.
   */
  function toServerProduct(data) {
    var body = {};
    var has = function (key) {
      return Object.prototype.hasOwnProperty.call(data, key) && data[key] !== undefined;
    };

    ['title', 'description', 'price', 'compareAt', 'stock', 'status',
     'colour', 'colourHex', 'fabric', 'badge', 'featured', 'sizes', 'images'
    ].forEach(function (key) {
      if (has(key)) body[key] = data[key];
    });

    if (!has('category')) return Promise.resolve(body);

    return Categories.idFor(data.dept, data.category).then(function (id) {
      if (!id) {
        var err = new Error('There is no “' + (data.categoryLabel || data.category) +
                            '” category to put this in. Add it under Categories first.');
        err.fields = { category: 'No such category.' };
        throw err;
      }

      body.categoryId = id;
      return body;
    });
  }

  /* -----------------------------------------------------------------------
     Inventory

     NOT A SECOND LIST OF PRODUCTS
     Inventory reads currentRows() — the same products, through the same
     overlay, as the product list. It is a different question asked of the
     same records: the product screen asks "what do we sell", this one asks
     "what is about to run out". Two lists would be two places for a stock
     number to live, and they would disagree the first time one was edited.

     A stock change made here therefore shows on the product list, and the
     other way round, without either screen knowing the other exists.
     ----------------------------------------------------------------------- */

  /**
   * Below this, a product is "low" rather than merely in stock.
   *
   * Kept here rather than in the pages because two screens draw that
   * distinction — the product list's stock pill and this section's filter
   * and tile — and a threshold that means ten in one place and five in
   * another is a bug nobody notices until a product sells out under a badge
   * that said it was fine.
   *
   * The dashboard is not one of them. Its alert counts products at zero,
   * which is a different question with a different answer.
   *
   * The number itself is a setting rather than a constant, so the owner can
   * move it — but it is still decided in exactly one place. lowStockAt()
   * lives with the settings section further down and reads the record;
   * everything that needs the threshold comes through here.
   */
  function stockLevelOf(row) {
    if (!row.stock) return 'out';
    return row.stock < lowStockAt() ? 'low' : 'in';
  }

  Repo.inventory = {

    /* A function now, not a number: it can change while the panel is open.
       A value read once at load would leave a screen filtering on the old
       threshold until it was navigated away from and back. */
    lowStockAt: lowStockAt,

    /** 'out' | 'low' | 'in' for one row, so pages never re-derive it. */
    levelOf: stockLevelOf,

    /* Lowest stock first by default, and that is the whole screen: an
       inventory list sorted by name is a catalogue with a number on it.
       The rows that need attention are the ones at the top. */
    sorts: [
      { id: 'stock-asc', label: 'Lowest stock first' },
      { id: 'stock-desc', label: 'Highest stock first' },
      { id: 'value-desc', label: 'Most stock value' },
      { id: 'name-asc', label: 'Name A–Z' },
      { id: 'name-desc', label: 'Name Z–A' }
    ],

    levels: [
      { id: 'out', label: 'Out of stock' },
      { id: 'low', label: 'Running low' },
      { id: 'in', label: 'In stock' }
    ],

    facets: function () {
      var rows = currentRows();
      var depts = {};
      rows.forEach(function (row) { depts[row.dept] = row.deptLabel; });

      var present = {};
      rows.forEach(function (row) { present[stockLevelOf(row)] = true; });

      return Repo.defer({
        departments: Object.keys(depts).sort(function (a, b) {
          return depts[a].localeCompare(depts[b]);
        }).map(function (id) { return { id: id, label: depts[id] }; }),

        levels: Repo.inventory.levels.filter(function (level) {
          return present[level.id];
        })
      });
    },

    /** options: { search, dept, level, sort, page, perPage } */
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

      if (options.level) {
        rows = rows.filter(function (row) {
          return stockLevelOf(row) === options.level;
        });
      }

      var compare = {
        'stock-asc':  function (a, b) { return a.stock - b.stock; },
        'stock-desc': function (a, b) { return b.stock - a.stock; },
        'value-desc': function (a, b) {
          return (b.stock * b.price) - (a.stock * a.price);
        },
        'name-asc':   function (a, b) { return a.title.localeCompare(b.title); },
        'name-desc':  function (a, b) { return b.title.localeCompare(a.title); }
      }[options.sort] || function (a, b) { return a.stock - b.stock; };

      rows = rows.slice().sort(compare);

      var total = rows.length;
      var perPage = options.perPage || 20;
      var pages = Math.max(1, Math.ceil(total / perPage));
      var page = Math.min(Math.max(1, options.page || 1), pages);
      var start = (page - 1) * perPage;

      return Repo.defer({
        items: rows.slice(start, start + perPage).map(function (row) {
          var out = {};
          Object.keys(row).forEach(function (key) { out[key] = row[key]; });
          out.level = stockLevelOf(row);
          out.value = row.stock * row.price;
          return out;
        }),
        total: total, page: page, pages: pages, perPage: perPage,
        /* Units and value for the whole filtered set, not just this page:
           "48 products running low" is only half an answer without "worth
           replacing them costs this much". */
        units: rows.reduce(function (sum, row) { return sum + row.stock; }, 0),
        value: rows.reduce(function (sum, row) {
          return sum + (row.stock * row.price);
        }, 0)
      });
    },

    summary: function () {
      var rows = currentRows();
      var counts = { out: 0, low: 0, in: 0 };

      rows.forEach(function (row) { counts[stockLevelOf(row)] += 1; });

      return Repo.defer({
        products: rows.length,
        out: counts.out,
        low: counts.low,
        units: rows.reduce(function (sum, row) { return sum + row.stock; }, 0),
        /* Retail value of what is on the shelf. Priced at what it sells
           for, not at cost — there is no cost price in this build, and
           inventing one would put a number on this screen that no other
           screen could corroborate. */
        value: rows.reduce(function (sum, row) {
          return sum + (row.stock * row.price);
        }, 0)
      });
    },

    /* -- writes. Straight through to the product overlay. -- */

    /**
     * Set one product's stock.
     *
     * Also settles the two fields that have to move with it. A product on
     * the shelf that says "Out of stock", or a sold-out one still marked
     * active, is a row that contradicts itself — and the storefront reads
     * `inStock` to decide whether the buy button works.
     *
     * A draft stays a draft: it is hidden from the shop for a reason that
     * has nothing to do with stock, and restocking it must not publish it.
     */
    setStock: function (id, stock) {
      var quantity = Math.max(0, Math.round(Number(stock)));
      if (!isFinite(quantity)) {
        return Promise.reject({ message: 'That is not a quantity.' });
      }

      var row = currentRows().filter(function (r) { return r.id === id; })[0];
      if (!row) return Promise.reject({ message: 'That product no longer exists.' });

      var change = { stock: quantity, inStock: quantity > 0 };

      if (row.status !== 'draft') {
        change.status = quantity > 0 ? 'active' : 'out-of-stock';
      }

      /* STILL THE IN-MEMORY OVERLAY, DELIBERATELY
       *
       * Inventory reads currentRows(), which is built from ZB.catalogue —
       * so its rows are keyed by the storefront slug, not by the database
       * id the product endpoints take. Sending a slug to
       * /api/admin/products/:id would be a 400 on every save.
       *
       * Connecting inventory properly is its own step: it needs the rows
       * to come from /api/admin/products so that drafts and out-of-stock
       * items are in the list at all, which changes what the page counts
       * and what its filters mean. Until then this keeps working the way
       * it worked yesterday, and the page still says the change is not
       * saved. What it must not do is silently fail. */
      return overlayEdit(id, change);
    },

    /** Add to or take from what is there. Never goes below zero. */
    adjustStock: function (id, delta) {
      var row = currentRows().filter(function (r) { return r.id === id; })[0];
      if (!row) return Promise.reject({ message: 'That product no longer exists.' });

      return Repo.inventory.setStock(id, row.stock + delta);
    },

    hasUnsavedEdits: function () {
      /* Its own overlay, not the product endpoints' — see setStock. */
      return Object.keys(edited).length > 0;
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

  /**
   * One order with any changes made this session applied on top.
   *
   * Always a copy, for the reason spelled out over currentRows(): handing
   * back the mock's own object lets a caller change the store without
   * going through a write method, and makes a value read a moment ago
   * change under whoever is holding it.
   */
  function withEdits(order) {
    var merged = {};
    Object.keys(order).forEach(function (key) { merged[key] = order[key]; });

    if (orderEdits[order.id]) {
      Object.keys(orderEdits[order.id]).forEach(function (key) {
        merged[key] = orderEdits[order.id][key];
      });
    }

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

     EVERY NUMBER HERE IS COUNTED FROM THE ORDERS
     A customer's order count and lifetime spend are not stored beside them
     and are never invented: admin-mock rolls them up from the same order
     list the orders page shows, and everything derived below — average
     order, when they last bought — is counted here from the same source.
     Two numbers that are supposed to agree should be one number, or they
     will drift, and a customer profile that disagrees with their own order
     history is worse than no profile.

     The consequence worth naming: cancelling an order in this session
     changes what this section reports about that customer, because the
     rollup is read through the order overlay rather than frozen at build
     time. That is the correct behaviour and it is also the behaviour a
     real backend would have.

     BLOCKING IS A UI STATE HERE AND MUST NOT BE MISTAKEN FOR SECURITY
     Marking an account blocked writes to the overlay below and changes
     what this panel draws. It does not stop anyone doing anything: there
     is no account system, no session, and no server to refuse a request.
     When one exists, blocking has to be enforced there — a frontend flag
     only ever decides what to render.
     ----------------------------------------------------------------------- */

  var customerEdits = {};   /* id -> { status } */

  /** Orders belonging to one customer, newest first, with edits applied. */
  function ordersOf(customerId) {
    return currentOrders().filter(function (order) {
      return order.customerId === customerId;
    });
  }

  /**
   * One customer, with the figures recounted from their orders.
   *
   * admin-mock already rolls up `orders` and `spent` at build time, but
   * that rollup cannot see this session's status changes — a cancelled
   * order has to stop counting as spend the moment it is cancelled, on
   * every screen at once. So the totals are counted here instead, and the
   * build-time ones are left alone rather than being trusted twice.
   */
  function shapeCustomer(person) {
    if (!person) return null;

    var theirs = ordersOf(person.id);
    var earned = theirs.filter(ZB.adminMock.isRevenue);

    var spent = earned.reduce(function (sum, o) { return sum + o.total; }, 0);

    var out = {};
    Object.keys(person).forEach(function (key) { out[key] = person[key]; });

    out.orders = theirs.length;
    out.spent = spent;
    /* Averaged over the orders that were actually earned. Dividing by every
       order including the cancelled ones would quietly understate what this
       customer is worth. */
    out.average = earned.length ? Math.round(spent / earned.length) : 0;
    out.cancelled = theirs.length - earned.length;

    /* `daysAgo` counts back from today, so the smallest is the most
        recent. Null when they have never ordered — which the UI says in
        words rather than printing a misleading zero. */
    out.lastOrderDaysAgo = theirs.length
      ? theirs.reduce(function (min, o) { return Math.min(min, o.daysAgo); }, Infinity)
      : null;

    if (customerEdits[person.id]) {
      Object.keys(customerEdits[person.id]).forEach(function (key) {
        out[key] = customerEdits[person.id][key];
      });
    }

    return out;
  }

  function currentCustomers() {
    return ZB.adminMock.customers().map(shapeCustomer);
  }

  /* There is no meaningful natural order — the mock builds customers in id
     order, and an id is not a join date. So unlike products and orders,
     this section has a real default sort rather than a "leave it alone"
     one: newest members first, which is the order a customer list is
     normally read in. */
  var CUSTOMER_SORTS = {
    recent:        function (a, b) { return a.joinedDaysAgo - b.joinedDaysAgo; },
    oldest:        function (a, b) { return b.joinedDaysAgo - a.joinedDaysAgo; },
    'name-asc':    function (a, b) { return a.name.localeCompare(b.name); },
    'name-desc':   function (a, b) { return b.name.localeCompare(a.name); },
    'spent-desc':  function (a, b) { return b.spent - a.spent; },
    'spent-asc':   function (a, b) { return a.spent - b.spent; },
    'orders-desc': function (a, b) { return b.orders - a.orders; }
  };

  Repo.customers = {

    sorts: [
      { id: 'recent', label: 'Newest members' },
      { id: 'oldest', label: 'Longest standing' },
      { id: 'name-asc', label: 'Name A–Z' },
      { id: 'name-desc', label: 'Name Z–A' },
      { id: 'spent-desc', label: 'Highest spend' },
      { id: 'spent-asc', label: 'Lowest spend' },
      { id: 'orders-desc', label: 'Most orders' }
    ],

    facets: function () {
      var rows = currentCustomers();

      var statuses = {};
      var cities = {};
      rows.forEach(function (person) {
        statuses[person.status] = person.status === 'active' ? 'Active' : 'Blocked';
        cities[person.city] = person.city;
      });

      var toList = function (map) {
        return Object.keys(map).sort(function (a, b) {
          return map[a].localeCompare(map[b]);
        }).map(function (id) { return { id: id, label: map[id] }; });
      };

      return Repo.defer({
        statuses: toList(statuses),
        cities: toList(cities)
      });
    },

    /** options: { search, status, city, sort, page, perPage } */
    list: function (options) {
      options = options || {};
      var rows = currentCustomers();

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

      if (options.city) {
        rows = rows.filter(function (c) { return c.city === options.city; });
      }

      var compare = CUSTOMER_SORTS[options.sort] || CUSTOMER_SORTS.recent;
      rows = rows.slice().sort(compare);

      var total = rows.length;
      var perPage = options.perPage || 20;
      var pages = Math.max(1, Math.ceil(total / perPage));
      var page = Math.min(Math.max(1, options.page || 1), pages);
      var start = (page - 1) * perPage;

      return Repo.defer({
        items: rows.slice(start, start + perPage),
        total: total, page: page, pages: pages, perPage: perPage,
        spent: rows.reduce(function (sum, c) { return sum + c.spent; }, 0)
      });
    },

    get: function (id) {
      return Repo.defer(shapeCustomer(ZB.adminMock.customer(id)));
    },

    /** One customer's order history, newest first. */
    orders: function (id) {
      return Repo.defer(ordersOf(id));
    },

    summary: function () {
      var rows = currentCustomers();
      var spent = rows.reduce(function (sum, c) { return sum + c.spent; }, 0);

      return Repo.defer({
        total: rows.length,
        blocked: rows.filter(function (c) { return c.status !== 'active'; }).length,
        /* Joined inside the last thirty days — the number an owner reads as
           "is the shop still growing". */
        joinedRecently: rows.filter(function (c) { return c.joinedDaysAgo < 30; }).length,
        spent: spent,
        /* Averaged across everyone, including those who have not bought,
           because that is what "average customer value" means. */
        average: rows.length ? Math.round(spent / rows.length) : 0
      });
    },

    /* -- writes. In memory only, and not a security control. -- */

    setStatus: function (id, status) {
      var person = shapeCustomer(ZB.adminMock.customer(id));
      if (!person) return Promise.reject({ message: 'That customer no longer exists.' });

      if (status !== 'active' && status !== 'blocked') {
        return Promise.reject({ message: 'Unknown account status.' });
      }

      customerEdits[id] = customerEdits[id] || {};
      customerEdits[id].status = status;

      return Repo.customers.get(id);
    },

    hasUnsavedEdits: function () {
      return Object.keys(customerEdits).length > 0;
    }
  };

  /* -----------------------------------------------------------------------
     Metrics

     Every figure below is counted from the same order list the orders page
     shows, so a total on the dashboard and a row on another screen can
     never disagree. Cancelled orders are never revenue.
     ----------------------------------------------------------------------- */

  /**
   * Orders inside the last `days` days, newest first.
   *
   * Through currentOrders(), never the raw mock. Reading the mock directly
   * would leave the dashboard describing orders as they were generated
   * rather than as they now stand: cancel an order on the orders screen
   * and the customer's spend would drop while the dashboard's revenue did
   * not, which is two screens disagreeing about the same afternoon.
   */
  function ordersWithin(days) {
    return currentOrders().filter(function (o) { return o.daysAgo < days; });
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

      var all = currentOrders();
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

        /* Out of stock, not running low. The dashboard tile that reads this
           says "Products out of stock" and means it; the running-low
           threshold is a different question and belongs to the inventory
           screen, which asks it. A field called lowStock holding a count of
           products at zero is the sort of name that eventually gets used
           for what it says rather than what it is. */
        outOfStock: products.filter(function (p) { return !p.inStock; }).length
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
      var recent = currentOrders().slice(0, 12);

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

      var waiting = currentOrders().filter(function (o) {
        return o.status === 'pending' || o.status === 'processing';
      }).length;

      return Repo.defer({ inventory: outOfStock, orders: waiting });
    }
  };

  /* -----------------------------------------------------------------------
     Categories

     THE MENU IS NOW A TABLE, NOT A FILE
     This section used to flatten ZB.navigation — data/navigation.js, a file
     — into rows, and an edit lived in an overlay until the next reload. The
     categories table has replaced it, and the storefront reads the same
     rows: a category added here appears in the shop's drawer, and one
     hidden here leaves it.

     THE WHOLE TREE ARRIVES AT ONCE, AND IS FILTERED HERE
     The products endpoint pages in the database; this one does not, and the
     reason is that almost every question the page asks needs the whole tree
     anyway. Whether a row is a sub-category depends on its parent, the
     indenting depends on the rows around it, the "place it under" dropdown
     is a list of all of them, and childrenOf() is called from the page
     synchronously, in the middle of building a sentence. A menu is bounded
     by how many things a person will put in one; ninety rows is already a
     large shop's worth.

     MENU ORDER IS REBUILT HERE
     The API returns the rows in their own sort order, flat. The list draws
     a tree, so they are re-ordered into department, then category, then its
     children — the order the drawer itself reads in, which is what makes
     the indenting mean anything.
     ----------------------------------------------------------------------- */

  var Categories = {

    /* The whole tree, kept between calls. Every method below reads it, and
       every write clears it — a stale menu is how a category that was just
       renamed keeps its old name in the dropdown next to it. */
    cache: null,

    load: function (force) {
      if (force) Categories.cache = null;

      if (!Categories.cache) {
        Categories.cache = Api.get('/api/admin/categories').catch(function (err) {
          /* A failed load must not be remembered as the answer. */
          Categories.cache = null;
          throw err;
        });
      }

      return Categories.cache;
    },

    forget: function () { Categories.cache = null; },

    /**
     * The category id behind a department and a category slug.
     *
     * What the product form works in and what the API needs are two
     * different things — see toServerProduct(). Resolves null when there is
     * no such category, which the caller turns into a message naming it.
     */
    idFor: function (dept, slug) {
      return Categories.load().then(function (tree) {
        var hit = tree.items.filter(function (row) {
          return row.slug === slug && (!dept || row.dept === dept);
        })[0];

        return hit ? hit.id : null;
      });
    }
  };

  /**
   * The rows in menu order: department, its categories, each one's children.
   *
   * The list indents a child under its parent, which only reads correctly
   * while the parent is the row above it. The API's own order is by the
   * `sort` column across the whole table, so this regroups.
   */
  function inMenuOrder(items, departments) {
    var order = {};
    departments.forEach(function (dept, i) { order[dept.slug] = i; });

    var bySort = function (a, b) {
      if (a.sort !== b.sort) return a.sort - b.sort;
      return a.label.localeCompare(b.label);
    };

    var children = {};
    items.forEach(function (row) {
      if (row.parentId) (children[row.parentId] = children[row.parentId] || []).push(row);
    });

    var tops = items.filter(function (row) { return !row.parentId; });

    tops.sort(function (a, b) {
      var da = order[a.dept] === undefined ? 99 : order[a.dept];
      var db = order[b.dept] === undefined ? 99 : order[b.dept];
      if (da !== db) return da - db;
      return bySort(a, b);
    });

    var out = [];
    tops.forEach(function (row) {
      out.push(row);
      (children[row.id] || []).sort(bySort).forEach(function (child) {
        out.push(child);
      });
    });

    /* Anything whose parent was filtered out or is missing still has to
       appear — a row the page cannot show is a row nobody can fix. */
    if (out.length !== items.length) {
      var seen = {};
      out.forEach(function (row) { seen[row.id] = true; });
      items.forEach(function (row) { if (!seen[row.id]) out.push(row); });
    }

    return out;
  }

  /** Every category, in menu order, with the storefront link filled in. */
  function categoryRows() {
    return Categories.load().then(function (tree) {
      return inMenuOrder(tree.items, tree.departments).map(function (row) {
        var out = {};
        Object.keys(row).forEach(function (key) { out[key] = row[key]; });

        /* Built from the slug, never from the label. A rename leaves the
           address alone on purpose — see api/admin/categories/[id].js. */
        out.storefrontPath = '/category/' + row.dept + '/' + row.slug;
        return out;
      });
    });
  }

  /* 'tree' is the natural order, which is what inMenuOrder produces. Every
     other sort breaks the adjacency between a parent and its children, so
     the page stops indenting when one is chosen rather than indenting rows
     whose parent is now forty lines away. */
  var CATEGORY_SORTS = {
    'name-asc':      function (a, b) { return a.label.localeCompare(b.label); },
    'name-desc':     function (a, b) { return b.label.localeCompare(a.label); },
    'products-desc': function (a, b) { return b.productCount - a.productCount; },
    'products-asc':  function (a, b) { return a.productCount - b.productCount; }
  };

  /* childrenOf() is called synchronously by the page, in the middle of
     composing the delete dialog's sentence. It reads this, which the list
     that drew the row filled in a moment earlier. */
  var lastRows = [];

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
     * offer a value that would return nothing.
     */
    facets: function () {
      return Categories.load().then(function (tree) {
        var rows = tree.items;

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

        return {
          departments: toList(depts, true),
          statuses: toList(statuses, true),
          levels: toList(levels, false),

          /* Every category that may be a parent, for the add form. Only
             top-level rows qualify: the storefront menu is two deep and a
             third level would have nowhere to render. The server refuses
             one anyway. */
          parents: rows.filter(function (row) { return row.level === 1; })
                       .map(function (row) {
                         return { id: row.id, label: row.deptLabel + ' → ' + row.label,
                                  dept: row.dept };
                       })
        };
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

      return categoryRows().then(function (all) {
        lastRows = all;

        var rows = all;

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

        return {
          items: rows.slice(start, start + perPage),
          total: total,
          page: page,
          pages: pages,
          perPage: perPage,
          tree: !compare
        };
      });
    },

    get: function (id) {
      return categoryRows().then(function (rows) {
        return rows.filter(function (row) { return row.id === id; })[0] || null;
      });
    },

    /** Every category, unpaged — for the summary tiles above the list. */
    summary: function () {
      return categoryRows().then(function (rows) {
        return {
          total: rows.length,
          topLevel: rows.filter(function (row) { return row.level === 1; }).length,
          hidden: rows.filter(function (row) { return row.status !== 'active'; }).length,
          empty: rows.filter(function (row) { return row.productCount === 0; }).length
        };
      });
    },

    /* -- writes -- */

    create: function (data) {
      return Api.send('POST', '/api/admin/categories', {
        label: data.label,
        parentId: data.parentId || undefined,
        dept: data.dept || undefined,
        active: data.status ? data.status === 'active' : true
      }).then(function (result) {
        Categories.forget();
        return result.category;
      });
    },

    update: function (id, data) {
      var body = {};

      if (Object.prototype.hasOwnProperty.call(data, 'label')) body.label = data.label;
      if (Object.prototype.hasOwnProperty.call(data, 'status')) {
        body.active = data.status === 'active';
      }
      if (Object.prototype.hasOwnProperty.call(data, 'sort')) body.sort = data.sort;

      return Api.send('PATCH', '/api/admin/categories/' + encodeURIComponent(id), body)
        .then(function (result) {
          Categories.forget();
          return result.category;
        });
    },

    /**
     * Delete a category, which the server refuses while anything is in it.
     *
     * This used to take the sub-categories with it and hand back a token to
     * put them all again. Neither is true now, and the difference is not a
     * limitation — a cascade would delete a department's worth of the shop
     * from one click, with an undo that cannot restore products once their
     * images and order lines are gone. A category that must go is emptied
     * first, deliberately. Hiding one takes it out of the shop immediately
     * and is reversible, which is what "remove this" usually means.
     *
     * The rejection carries the server's count of what is in the way.
     */
    remove: function (id) {
      return Api.send('DELETE', '/api/admin/categories/' + encodeURIComponent(id))
        .then(function () {
          Categories.forget();
          return { id: id };
        });
    },

    /**
     * There is nothing to restore.
     *
     * A deleted category was empty — the server would not have deleted it
     * otherwise — so nothing was lost with it, and adding it again is the
     * same three fields it took the first time. Kept as a method because
     * the page's undo path still calls it, and answering false is how it
     * learns there is nothing to offer.
     */
    restore: function () {
      return Promise.resolve(false);
    },

    /** How many sub-categories a row holds, from the last list drawn. */
    childrenOf: function (id) {
      return lastRows.filter(function (row) { return row.parentId === id; });
    },

    /** Always false: every write above reaches the database. */
    hasUnsavedEdits: function () {
      return false;
    }
  };

  /* -----------------------------------------------------------------------
     Banners

     WHERE A BANNER COMES FROM
     The same place the shop's homepage gets it: ZB.heroSlides. Exactly the
     reasoning the category section uses — the storefront already holds this
     list, and a second one kept here would let the panel and the shop
     disagree about what the homepage is currently showing.

     WHY ORDER IS A FIRST-CLASS OPERATION AND NOT A SORT
     A carousel is an ordered thing. Slide one is what almost everybody
     sees, slide seven is what almost nobody does, and that difference is
     most of the reason an owner opens this screen. So there is no sort
     control — there is a way to move a slide up and down, and the list is
     always in the order the shop plays them.

     THE LINK CHECK
     Every slide carries a call to action, and a call to action that lands
     on "page not found" is the most expensive broken thing a storefront
     can have: it is on the homepage, above the fold, and it is the button
     the campaign was bought to make people press. So the destination is
     checked against the routes the storefront actually serves rather than
     merely stored, and a slide pointing nowhere is marked as such. The
     check reads the same catalogue and navigation the shop's own pages
     resolve against, so it cannot go out of step with them.
     ----------------------------------------------------------------------- */

  var bnEdited = {};     /* id -> changed fields */
  var bnRemoved = {};    /* id -> true */
  var bnAdded = [];      /* created this session */
  var bnSequence = null; /* explicit order, once anything has been moved */
  var bnNextId = 1;

  /* The storefront routes that take no parameters, from assets/js/routes.js.
     Kept beside the ones that do, below, so the whole answer to "does this
     link work" is in one place. */
  var FLAT_ROUTES = [
    '/', '/search', '/cart', '/wishlist', '/account', '/stores', '/tracking',
    '/careers', '/faqs', '/how-to-buy', '/payment', '/shipping', '/returns',
    '/about', '/contact', '/terms', '/privacy'
  ];

  /**
   * Does this path resolve to a real storefront page?
   *
   * Returns { ok, reason } rather than a bare boolean: the screen has to
   * tell the reader WHICH part is wrong, and "Men has no category called
   * kurtaa" is a fixable message where "invalid" is not.
   */
  function checkLink(href) {
    var path = String(href || '').trim();

    if (!path) return { ok: false, reason: 'No link set.' };
    if (path.charAt(0) !== '/') {
      return {
        ok: false,
        reason: 'Links must start with / — an outside address leaves the shop.'
      };
    }

    /* The query and the hash are not part of the route. */
    path = path.split('#')[0].split('?')[0];
    if (path.length > 1 && path.charAt(path.length - 1) === '/') {
      path = path.slice(0, -1);
    }

    if (FLAT_ROUTES.indexOf(path) > -1) return { ok: true, reason: '' };

    var parts = path.split('/').filter(function (bit) { return bit; });

    if (parts[0] === 'product') {
      if (!parts[1]) return { ok: false, reason: 'A product link needs a product id.' };
      return ZB.catalogue.byId(parts[1])
        ? { ok: true, reason: '' }
        : { ok: false, reason: 'No product has the id “' + parts[1] + '”.' };
    }

    if (parts[0] === 'category') {
      var dept = (ZB.navigation || []).filter(function (row) {
        return row.id === parts[1];
      })[0];

      if (!dept) {
        return {
          ok: false,
          reason: 'There is no department called “' + (parts[1] || '') + '”.'
        };
      }
      if (!parts[2]) return { ok: true, reason: '' };

      /* Matched against the same flattened tree the categories screen
         shows, so a sub-category counts as a destination too. */
      var found = navigationRows().some(function (row) {
        return row.dept === dept.id && row.slug === parts[2];
      });

      return found
        ? { ok: true, reason: '' }
        : { ok: false, reason: dept.label + ' has no category called “' + parts[2] + '”.' };
    }

    return { ok: false, reason: 'Nothing in the shop answers that address.' };
  }

  /** ZB.heroSlides, flattened into rows with an id. */
  function heroRows() {
    return (ZB.heroSlides || []).map(function (slide, i) {
      return {
        id: 'hero-' + (i + 1),
        image: slide.image,
        alt: slide.alt,
        eyebrow: slide.eyebrow,
        headline: slide.headline,
        body: slide.body,
        cta: slide.cta,
        href: slide.href,
        proof: slide.proof,
        status: 'active',
        source: 'hero'
      };
    });
  }

  /** The carousel as the admin currently sees it, in playing order. */
  function currentBanners() {
    var rows = heroRows().concat(bnAdded);

    rows = rows
      .filter(function (row) { return !bnRemoved[row.id]; })
      .map(function (row) {
        var merged = {};
        Object.keys(row).forEach(function (key) { merged[key] = row[key]; });

        if (bnEdited[row.id]) {
          Object.keys(bnEdited[row.id]).forEach(function (key) {
            merged[key] = bnEdited[row.id][key];
          });
        }

        var link = checkLink(merged.href);
        merged.linkOk = link.ok;
        merged.linkReason = link.reason;
        return merged;
      });

    /* An explicit sequence only exists once something has been moved.
       Until then the file's own order is the answer, and an id the
       sequence has never heard of — one added since — goes to the end
       rather than disappearing. */
    if (bnSequence) {
      var at = {};
      bnSequence.forEach(function (id, i) { at[id] = i; });
      rows.sort(function (a, b) {
        var ai = at[a.id] === undefined ? 9999 : at[a.id];
        var bi = at[b.id] === undefined ? 9999 : at[b.id];
        return ai - bi;
      });
    }

    /* Position is what a shopper experiences, so it counts only the slides
       that actually play. A hidden slide keeps its place in the list — it
       is easier to bring back where it was — but is not given a number in
       a run it is not part of. */
    var seen = 0;
    rows.forEach(function (row, i) {
      row.index = i;
      row.position = row.status === 'active' ? ++seen : 0;
    });

    return rows;
  }

  function bannerIds() {
    return currentBanners().map(function (row) { return row.id; });
  }

  Repo.banners = {

    /**
     * The whole carousel, in order.
     * options: { view } — 'active', 'hidden', 'broken', or nothing for all.
     * resolves: { items, total, active, hidden, broken }
     *
     * Never paged. Seven slides is the whole of it, and paging a list this
     * short would hide the one thing the screen is for: seeing the run of
     * slides in the order they play.
     */
    list: function (options) {
      options = options || {};
      var all = currentBanners();

      var rows = all.filter(function (row) {
        if (options.view === 'active') return row.status === 'active';
        if (options.view === 'hidden') return row.status !== 'active';
        if (options.view === 'broken') return !row.linkOk;
        return true;
      });

      return Repo.defer({
        items: rows,
        total: rows.length,
        active: all.filter(function (row) { return row.status === 'active'; }).length,
        hidden: all.filter(function (row) { return row.status !== 'active'; }).length,
        broken: all.filter(function (row) { return !row.linkOk; }).length
      });
    },

    get: function (id) {
      var hit = currentBanners().filter(function (row) { return row.id === id; })[0];
      return Repo.defer(hit || null);
    },

    summary: function () {
      var rows = currentBanners();
      var live = rows.filter(function (row) { return row.status === 'active'; });

      return Repo.defer({
        total: rows.length,
        active: live.length,
        hidden: rows.length - live.length,
        /* Counted across every slide, not only the live ones: a broken
           link on a hidden slide is a trap set for whoever turns it on. */
        broken: rows.filter(function (row) { return !row.linkOk; }).length
      });
    },

    /** Exposed so the form can check a link before it is saved. */
    checkLink: function (href) { return checkLink(href); },

    /**
     * Where a slide is allowed to point, as a list.
     *
     * Offered instead of a free-text box because every destination this
     * shop has is knowable, and typing a path by hand is how the broken
     * ones got there in the first place. A current value that is not in
     * the list is added to it, so opening a slide that already points
     * somewhere odd does not silently rewrite where it goes.
     */
    linkOptions: function (current) {
      var options = [{ id: '/', label: 'Homepage' }];

      navigationRows().forEach(function (row) {
        options.push({
          id: '/category/' + row.dept + '/' + row.slug,
          label: row.deptLabel + ' → ' + row.label +
                 (row.level === 1 ? ' (all)' : '')
        });
      });

      [['/search', 'Search'], ['/stores', 'Store finder'],
       ['/tracking', 'Order tracking'], ['/about', 'About us'],
       ['/contact', 'Contact']].forEach(function (pair) {
        options.push({ id: pair[0], label: pair[1] });
      });

      var known = options.some(function (item) { return item.id === current; });
      if (current && !known) {
        options.unshift({ id: current, label: current + ' — as it is set now' });
      }

      return options;
    },

    /* -- writes. In memory only, exactly like products and categories. -- */

    create: function (data) {
      var row = {
        id: 'new-banner-' + (bnNextId++),
        image: data.image || '',
        alt: data.alt || '',
        eyebrow: data.eyebrow || '',
        headline: data.headline || '',
        body: data.body || '',
        cta: data.cta || '',
        href: data.href || '/',
        proof: data.proof || '',
        status: data.status || 'active',
        source: 'new'
      };

      bnAdded.push(row);
      /* A new slide goes at the end of the run. Said in both places so the
         two orderings cannot disagree about where it landed. */
      if (bnSequence) bnSequence.push(row.id);

      return Repo.defer(row);
    },

    update: function (id, data) {
      var exists = currentBanners().some(function (row) { return row.id === id; });
      if (!exists) {
        return Promise.reject({ message: 'That banner no longer exists.' });
      }

      var own = bnAdded.filter(function (row) { return row.id === id; })[0];

      if (own) {
        Object.keys(data).forEach(function (key) { own[key] = data[key]; });
      } else {
        bnEdited[id] = bnEdited[id] || {};
        Object.keys(data).forEach(function (key) { bnEdited[id][key] = data[key]; });
      }

      return Repo.banners.get(id);
    },

    /**
     * Move a slide by one place.
     *
     * By one, and never by drag: a drag needs a pointer, a steady hand and
     * a list that fits on screen, and it has no keyboard at all. Two
     * buttons work with a thumb, with a keyboard and with a screen reader
     * — and for a run of seven slides, one place at a time is not slow.
     *
     * `delta` is -1 or +1. Moving past either end does nothing rather than
     * wrapping, because a slide jumping from first to last is not what
     * anybody pressing "up" meant.
     */
    move: function (id, delta) {
      var order = bannerIds();
      var from = order.indexOf(id);
      var to = from + (delta < 0 ? -1 : 1);

      if (from < 0 || to < 0 || to >= order.length) {
        return Repo.defer({ moved: false, order: order });
      }

      order.splice(to, 0, order.splice(from, 1)[0]);
      bnSequence = order;

      return Repo.defer({ moved: true, from: from, to: to, order: order });
    },

    /** Put the whole run back the way it was. Used by undo. */
    setOrder: function (order) {
      bnSequence = order ? order.slice() : null;
      return Repo.defer(true);
    },

    remove: function (id) {
      var row = currentBanners().filter(function (item) { return item.id === id; })[0];
      if (!row) return Repo.defer(null);

      /* The order is captured too. Deleting slide three and undoing it has
         to put it back at three, not at the end of the run. */
      var undo = {
        id: id,
        order: bannerIds(),
        row: null,
        wasRemoved: false,
        edits: bnEdited[id] || null
      };

      var own = bnAdded.filter(function (item) { return item.id === id; })[0];
      if (own) {
        undo.row = own;
        bnAdded = bnAdded.filter(function (item) { return item.id !== id; });
      } else {
        undo.wasRemoved = true;
        bnRemoved[id] = true;
      }

      if (bnEdited[id]) delete bnEdited[id];

      return Repo.defer(undo);
    },

    restore: function (undo) {
      if (!undo) return Repo.defer(false);

      if (undo.row) bnAdded.push(undo.row);
      if (undo.wasRemoved) delete bnRemoved[undo.id];
      if (undo.edits) bnEdited[undo.id] = undo.edits;
      if (undo.order) bnSequence = undo.order.slice();

      return Repo.defer(true);
    },

    hasUnsavedEdits: function () {
      return bnAdded.length > 0 || bnSequence !== null ||
             Object.keys(bnEdited).length > 0 ||
             Object.keys(bnRemoved).length > 0;
    }
  };

  /* -----------------------------------------------------------------------
     Coupons

     WHY THE STATE IS DERIVED AND NEVER STORED
     A coupon's state is a fact about its dates and its usage, not a field
     somebody sets. If "expired" were a value in a dropdown, this list would
     eventually show a coupon marked Running whose end date was last March
     — and the owner would believe it. So there is exactly one thing a
     person decides, "switched off or not", and everything else is worked
     out at the moment of asking:

       switched off       -> Switched off
       starts in future   -> Scheduled
       end date has gone  -> Expired
       usage limit hit    -> Used up
       otherwise          -> Running

     WHAT THIS BUILD HONESTLY CANNOT DO
     None of these is accepted at a checkout. There is no discount field in
     the cart and no server to validate a code against, so these rows
     describe what the shop WOULD honour once a backend exists. The screen
     says so in words rather than letting a code that does nothing look
     like a code that works.

     Dates arrive from admin-seed.js as day offsets and become real dates
     here, so that file cannot go stale — see the note beside them.
     ----------------------------------------------------------------------- */

  var cpEdited = {};
  var cpRemoved = {};
  var cpAdded = [];
  var cpNextId = 1;

  /** Midnight today, so a coupon ending "today" lasts the whole day. */
  function startOfToday() {
    var now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function dayOffset(days) {
    var day = startOfToday();
    day.setDate(day.getDate() + days);
    return day;
  }

  /** Whole days from today. Negative is in the past. */
  function daysFromToday(value) {
    var day = new Date(value);
    if (isNaN(day.getTime())) return 0;
    var flat = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    return Math.round((flat - startOfToday()) / 86400000);
  }

  /** 2026-09-07 — the value an <input type="date"> reads and writes. */
  function toDateInput(value) {
    var day = new Date(value);
    if (isNaN(day.getTime())) return '';

    var month = String(day.getMonth() + 1);
    var date = String(day.getDate());

    return day.getFullYear() + '-' +
           (month.length < 2 ? '0' + month : month) + '-' +
           (date.length < 2 ? '0' + date : date);
  }

  /** A date input's value, as a timestamp at local midnight. */
  function fromDateInput(value) {
    var bits = String(value || '').split('-');
    if (bits.length !== 3) return NaN;

    var day = new Date(Number(bits[0]), Number(bits[1]) - 1, Number(bits[2]));
    return isNaN(day.getTime()) ? NaN : day.getTime();
  }

  var COUPON_TYPES = [
    { id: 'percent',  label: 'Percentage off' },
    { id: 'fixed',    label: 'Fixed amount off' },
    { id: 'shipping', label: 'Free delivery' }
  ];

  var COUPON_STATES = [
    { id: 'running',   label: 'Running' },
    { id: 'scheduled', label: 'Scheduled' },
    { id: 'used-up',   label: 'Used up' },
    { id: 'expired',   label: 'Expired' },
    { id: 'off',       label: 'Switched off' }
  ];

  /**
   * Everything about a coupon that follows from its own fields.
   *
   * Kept in one function so the list, the tiles and the dialog can never
   * describe the same coupon differently — the failure where a row says
   * Running and the dialog it opens says Expired.
   */
  function shapeCoupon(row) {
    var out = {};
    Object.keys(row).forEach(function (key) { out[key] = row[key]; });

    var today = startOfToday().getTime();

    out.startsInDays = daysFromToday(out.startsAt);
    out.endsInDays = daysFromToday(out.expiresAt);
    out.limitReached = !!out.usageLimit && out.used >= out.usageLimit;

    if (out.disabled)                    out.state = 'off';
    else if (out.startsAt > today)       out.state = 'scheduled';
    else if (out.expiresAt < today)      out.state = 'expired';
    else if (out.limitReached)           out.state = 'used-up';
    else                                 out.state = 'running';

    /* "Live" is the question that matters at a glance: would a shopper
       typing this code right now have it accepted. Four of the five states
       answer no, for four different reasons, and the reason is what the
       row shows beside the answer. */
    out.live = out.state === 'running';

    out.discountLabel =
      out.type === 'percent'  ? out.value + '% off' :
      out.type === 'shipping' ? 'Free delivery' :
                                ZB.ui.money(out.value) + ' off';

    out.usedShare = out.usageLimit
      ? Math.min(100, Math.round((out.used / out.usageLimit) * 100))
      : 0;

    return out;
  }

  /** The seed rows, with their day offsets turned into real dates. */
  function seedCoupons() {
    return ((ZB.adminSeed && ZB.adminSeed.coupons) || []).map(function (seed, i) {
      return {
        id: 'coupon-' + (i + 1),
        code: seed.code,
        note: seed.note,
        type: seed.type,
        value: seed.value,
        minSpend: seed.minSpend,
        startsAt: dayOffset(seed.startsIn).getTime(),
        expiresAt: dayOffset(seed.endsIn).getTime(),
        usageLimit: seed.limit,
        used: seed.used,
        disabled: seed.disabled,
        source: 'seed'
      };
    });
  }

  function currentCoupons() {
    var rows = cpAdded.concat(seedCoupons());

    return rows
      .filter(function (row) { return !cpRemoved[row.id]; })
      .map(function (row) {
        var merged = {};
        Object.keys(row).forEach(function (key) { merged[key] = row[key]; });

        if (cpEdited[row.id]) {
          Object.keys(cpEdited[row.id]).forEach(function (key) {
            merged[key] = cpEdited[row.id][key];
          });
        }

        return shapeCoupon(merged);
      });
  }

  var COUPON_SORTS = {
    'ending-soon': function (a, b) {
      /* Coupons that are not running go last whichever way the others
         fall — "ending soonest" is a question about live ones, and an
         expired code at the top of that list answers nothing. */
      if (a.live !== b.live) return a.live ? -1 : 1;
      return a.expiresAt - b.expiresAt;
    },
    'code-asc':   function (a, b) { return a.code.localeCompare(b.code); },
    'used-desc':  function (a, b) { return b.used - a.used; },
    'value-desc': function (a, b) { return b.value - a.value; },
    'newest':     function (a, b) { return b.startsAt - a.startsAt; }
  };

  Repo.coupons = {

    types: COUPON_TYPES,
    states: COUPON_STATES,

    sorts: [
      { id: 'ending-soon', label: 'Ending soonest' },
      { id: 'newest', label: 'Newest' },
      { id: 'code-asc', label: 'Code A–Z' },
      { id: 'used-desc', label: 'Most used' },
      { id: 'value-desc', label: 'Largest discount' }
    ],

    /* Only the states and types the data actually holds, so a control can
       never offer a filter that returns nothing. */
    facets: function () {
      var rows = currentCoupons();

      return Repo.defer({
        states: COUPON_STATES.filter(function (state) {
          return rows.some(function (row) { return row.state === state.id; });
        }),
        types: COUPON_TYPES.filter(function (type) {
          return rows.some(function (row) { return row.type === type.id; });
        })
      });
    },

    /**
     * A page of coupons.
     * options: { search, state, type, sort, page, perPage }
     */
    list: function (options) {
      options = options || {};
      var rows = currentCoupons();

      if (options.search) {
        var needle = String(options.search).toLowerCase();
        rows = rows.filter(function (row) {
          return row.code.toLowerCase().indexOf(needle) > -1 ||
                 (row.note || '').toLowerCase().indexOf(needle) > -1;
        });
      }

      if (options.state) {
        rows = rows.filter(function (row) { return row.state === options.state; });
      }

      if (options.type) {
        rows = rows.filter(function (row) { return row.type === options.type; });
      }

      var compare = COUPON_SORTS[options.sort] || COUPON_SORTS['ending-soon'];
      rows = rows.slice().sort(compare);

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

    get: function (id) {
      var hit = currentCoupons().filter(function (row) { return row.id === id; })[0];
      return Repo.defer(hit || null);
    },

    summary: function () {
      var rows = currentCoupons();
      var live = rows.filter(function (row) { return row.live; });

      /* "Ending this week" rather than a second grand total: a coupon
         expiring on Friday is the only thing on this screen with a
         deadline, and it is the reason to open it on a Monday. */
      var soon = live.filter(function (row) {
        return row.endsInDays >= 0 && row.endsInDays <= 7;
      });

      return Repo.defer({
        total: rows.length,
        live: live.length,
        soon: soon.length,
        scheduled: rows.filter(function (row) { return row.state === 'scheduled'; }).length,
        redemptions: rows.reduce(function (sum, row) { return sum + row.used; }, 0)
      });
    },

    /** Is this code already taken? Case-insensitive, as a shopper types it. */
    codeTaken: function (code, ignoreId) {
      var wanted = String(code || '').trim().toUpperCase();
      return currentCoupons().some(function (row) {
        return row.id !== ignoreId && row.code.toUpperCase() === wanted;
      });
    },

    /* Date helpers, kept here so the page never does calendar maths of its
       own. Two implementations of "what day is that" is how a list and the
       dialog above it end up disagreeing by one. */
    toDateInput: function (value) { return toDateInput(value); },
    fromDateInput: function (value) { return fromDateInput(value); },
    daysFromToday: function (value) { return daysFromToday(value); },

    /* -- writes. In memory only. -- */

    create: function (data) {
      var row = {
        id: 'new-coupon-' + (cpNextId++),
        code: String(data.code || '').trim().toUpperCase(),
        note: data.note || '',
        type: data.type || 'percent',
        value: Number(data.value) || 0,
        minSpend: Number(data.minSpend) || 0,
        startsAt: data.startsAt,
        expiresAt: data.expiresAt,
        usageLimit: Number(data.usageLimit) || 0,
        /* A coupon created here has never been redeemed, and that is not a
           field on the form: typing a redemption count would be inventing
           a sale that did not happen. */
        used: 0,
        disabled: !!data.disabled,
        source: 'new'
      };

      cpAdded.unshift(row);
      return Repo.defer(shapeCoupon(row));
    },

    update: function (id, data) {
      var exists = currentCoupons().some(function (row) { return row.id === id; });
      if (!exists) {
        return Promise.reject({ message: 'That coupon no longer exists.' });
      }

      var own = cpAdded.filter(function (row) { return row.id === id; })[0];

      var patch = {};
      Object.keys(data).forEach(function (key) { patch[key] = data[key]; });
      if (patch.code !== undefined) patch.code = String(patch.code).trim().toUpperCase();

      if (own) {
        Object.keys(patch).forEach(function (key) { own[key] = patch[key]; });
      } else {
        cpEdited[id] = cpEdited[id] || {};
        Object.keys(patch).forEach(function (key) { cpEdited[id][key] = patch[key]; });
      }

      return Repo.coupons.get(id);
    },

    remove: function (id) {
      var undo = { id: id, row: null, wasRemoved: false, edits: cpEdited[id] || null };

      var own = cpAdded.filter(function (row) { return row.id === id; })[0];
      if (own) {
        undo.row = own;
        cpAdded = cpAdded.filter(function (row) { return row.id !== id; });
      } else {
        undo.wasRemoved = true;
        cpRemoved[id] = true;
      }

      if (cpEdited[id]) delete cpEdited[id];

      return Repo.defer(undo);
    },

    restore: function (undo) {
      if (!undo) return Repo.defer(false);

      if (undo.row) cpAdded.unshift(undo.row);
      if (undo.wasRemoved) delete cpRemoved[undo.id];
      if (undo.edits) cpEdited[undo.id] = undo.edits;

      return Repo.defer(true);
    },

    hasUnsavedEdits: function () {
      return cpAdded.length > 0 || Object.keys(cpEdited).length > 0 ||
             Object.keys(cpRemoved).length > 0;
    }
  };

  /* -----------------------------------------------------------------------
     Reports

     WHAT THIS IS FOR THAT THE DASHBOARD IS NOT
     The dashboard answers "how are we doing right now" — a glance, a fixed
     recent window, and a way out to the screen where something gets done.
     A report answers "what happened over a period, and what does it break
     down into". The difference is composition and comparison: shares,
     splits, the same figure against the period before it, and the numbers
     an owner would take to a meeting rather than act on in the next five
     minutes. Nothing here is a second copy of a dashboard tile.

     EVERY FIGURE IS COUNTED FROM THE ORDERS THE PANEL ALREADY SHOWS
     Through currentOrders(), which is the order list with this session's
     status changes applied. That matters more here than anywhere else: a
     report is exactly where somebody would notice that cancelling an order
     on one screen did not change the total on another.

     THE HISTORY HAS AN EDGE AND THE REPORT SAYS SO
     There are ninety days of orders and no more. A period that reaches
     past that is clamped, and the clamp is reported rather than hidden —
     a report showing "this year" against ninety days of data, without
     saying so, is worse than one that refuses the question.
     ----------------------------------------------------------------------- */

  function historyDays() {
    return (ZB.adminSeed && ZB.adminSeed.days) || 90;
  }

  function midnightToday() {
    var now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  /** Whole days between a date and today. Today is 0, yesterday is 1. */
  function daysAgoOf(value) {
    var day = new Date(value);
    if (isNaN(day.getTime())) return NaN;
    var flat = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    return Math.round((midnightToday() - flat) / 86400000);
  }

  function dateFromDaysAgo(days) {
    var day = midnightToday();
    day.setDate(day.getDate() - days);
    return day;
  }

  /* A window is held as two day offsets rather than two dates, because
     every order carries `daysAgo` and nothing else has to be parsed to
     compare against it. `oldest` is the larger number. */
  function windowOf(oldest, newest) {
    return { oldest: oldest, newest: newest, days: oldest - newest + 1 };
  }

  function ordersIn(range) {
    return currentOrders().filter(function (order) {
      return order.daysAgo <= range.oldest && order.daysAgo >= range.newest;
    });
  }

  var REPORT_PRESETS = [
    { id: '7',          label: 'Last 7 days' },
    { id: '30',         label: 'Last 30 days' },
    { id: '90',         label: 'Last 90 days' },
    { id: 'this-month', label: 'This month' },
    { id: 'last-month', label: 'Last month' }
  ];

  /**
   * Turn whatever the page has into one window, plus the window before it.
   *
   * options: { preset } or { from, to } as YYYY-MM-DD.
   *
   * The comparison window is the same length immediately before. It is
   * marked `complete` only when the whole of it is inside the history; an
   * incomplete one is compared against nothing, because "sales are down
   * 60%" against a period that is half missing is not a fact, it is an
   * artefact of where the data stops.
   */
  function resolveRange(options) {
    options = options || {};
    var limit = historyDays() - 1;   /* the oldest daysAgo that has orders */

    var oldest;
    var newest;
    var label;
    var custom = false;

    if (options.from || options.to) {
      custom = true;
      var fromDays = daysAgoOf(options.from);
      var toDays = daysAgoOf(options.to);

      /* Either end may be missing or unreadable; the other end still
         describes a usable window, so one bad date does not throw the
         whole report away. */
      if (isNaN(fromDays)) fromDays = limit;
      if (isNaN(toDays)) toDays = 0;

      oldest = Math.max(fromDays, toDays);
      newest = Math.min(fromDays, toDays);
    } else if (options.preset === 'this-month') {
      var now = midnightToday();
      oldest = daysAgoOf(new Date(now.getFullYear(), now.getMonth(), 1));
      newest = 0;
      label = 'This month';
    } else if (options.preset === 'last-month') {
      var today = midnightToday();
      var firstOfThis = new Date(today.getFullYear(), today.getMonth(), 1);
      var firstOfLast = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      var lastOfLast = new Date(today.getFullYear(), today.getMonth(), 0);
      oldest = daysAgoOf(firstOfLast);
      newest = daysAgoOf(lastOfLast);
      label = 'Last month';
      /* Referenced so the intent of firstOfThis is not lost to a reader:
         last month ends the day before this month starts. */
      if (newest < 0) newest = daysAgoOf(firstOfThis) + 1;
    } else {
      var days = parseInt(options.preset, 10);
      if (!days || days < 1) days = 30;
      oldest = days - 1;
      newest = 0;
      label = 'Last ' + days + ' days';
    }

    /* Clamped at both ends: nothing before the history begins, and nothing
       after today, because there are no orders in the future either. */
    var wantedOldest = oldest;
    var wantedNewest = newest;

    if (newest < 0) newest = 0;
    if (oldest > limit) oldest = limit;
    if (oldest < newest) oldest = newest;

    var range = windowOf(oldest, newest);

    range.preset = custom ? '' : (options.preset || '30');
    range.custom = custom;
    range.fromDate = dateFromDaysAgo(oldest);
    range.toDate = dateFromDaysAgo(newest);
    range.label = label || 'Custom period';
    range.clampedStart = wantedOldest > limit;
    range.clampedEnd = wantedNewest < 0;
    range.historyDays = historyDays();

    var previousOldest = oldest + range.days;
    range.previous = windowOf(previousOldest, oldest + 1);
    range.previous.complete = previousOldest <= limit;

    return range;
  }

  function revenueIn(list) {
    return list.reduce(function (sum, order) {
      return order.status === 'cancelled' ? sum : sum + order.total;
    }, 0);
  }

  function unitsIn(list) {
    return list.reduce(function (sum, order) {
      return order.status === 'cancelled' ? sum : sum + order.itemCount;
    }, 0);
  }

  /** The figures for one window, with nothing compared to anything. */
  function figuresFor(range) {
    var all = ordersIn(range);
    var live = all.filter(function (order) { return order.status !== 'cancelled'; });
    var cancelled = all.filter(function (order) { return order.status === 'cancelled'; });

    var revenue = revenueIn(all);
    var units = unitsIn(all);

    var people = ZB.adminMock.customers().filter(function (person) {
      return person.joinedDaysAgo <= range.oldest &&
             person.joinedDaysAgo >= range.newest;
    });

    return {
      orders: all.length,
      paidOrders: live.length,
      revenue: revenue,
      units: units,
      /* Averages over the orders that produced the revenue. Dividing by
         every order, cancellations included, would report an average order
         value no order ever had. */
      average: live.length ? revenue / live.length : 0,
      itemsPerOrder: live.length ? units / live.length : 0,
      cancelled: cancelled.length,
      cancelledValue: cancelled.reduce(function (sum, o) { return sum + o.total; }, 0),
      cancelRate: all.length ? (cancelled.length / all.length) * 100 : 0,
      refunded: all.filter(function (o) { return o.payment === 'refunded'; })
                   .reduce(function (sum, o) { return sum + o.total; }, 0),
      unpaid: all.filter(function (o) { return o.payment === 'unpaid'; })
                 .reduce(function (sum, o) { return sum + o.total; }, 0),
      newCustomers: people.length
    };
  }

  /** Percentage change, or null when there is nothing honest to compare. */
  function shift(now, before) {
    if (before === null || before === undefined || !before) return null;
    return ((now - before) / before) * 100;
  }

  function shareOf(part, whole) {
    return whole ? (part / whole) * 100 : 0;
  }

  /** Sort by revenue, biggest first, and hand back the share of the total. */
  function ranked(map, total, key) {
    var rows = Object.keys(map).map(function (id) { return map[id]; });
    rows.sort(function (a, b) { return b[key] - a[key]; });
    rows.forEach(function (row) { row.share = shareOf(row[key], total); });
    return rows;
  }

  Repo.reports = {

    presets: REPORT_PRESETS,

    /** Exposed so the page can render the period control without guessing. */
    resolve: function (options) { return resolveRange(options); },

    /** The dates an <input type="date"> needs for the custom controls. */
    toDateInput: function (value) { return toDateInput(value); },

    /**
     * The headline figures, each against the same window before it.
     * resolves: { range, now, before, change: { ... } }
     */
    overview: function (options) {
      var range = resolveRange(options);
      var now = figuresFor(range);
      var before = range.previous.complete ? figuresFor(range.previous) : null;

      var change = {};
      ['revenue', 'orders', 'units', 'average', 'newCustomers'].forEach(function (key) {
        change[key] = before ? shift(now[key], before[key]) : null;
      });

      return Repo.defer({
        range: range,
        now: now,
        before: before,
        change: change
      });
    },

    /**
     * Daily revenue across the window, oldest first.
     *
     * Every day appears, including the ones with no orders, so the line's
     * shape is the real shape rather than a compressed one that hides the
     * quiet days by leaving them out.
     */
    series: function (options) {
      var range = resolveRange(options);
      var buckets = [];
      var byDay = {};

      for (var d = range.oldest; d >= range.newest; d--) {
        var bucket = {
          date: dateFromDaysAgo(d),
          daysAgo: d,
          value: 0,
          orders: 0
        };
        byDay[d] = bucket;
        buckets.push(bucket);
      }

      ordersIn(range).forEach(function (order) {
        var bucket = byDay[order.daysAgo];
        if (!bucket) return;
        bucket.orders += 1;
        if (order.status !== 'cancelled') bucket.value += order.total;
      });

      return Repo.defer(buckets);
    },

    /**
     * How the period splits.
     *
     * Three breakdowns, all shares of the same total, so the figures on
     * one can be read against the figures on another.
     */
    breakdown: function (options) {
      var range = resolveRange(options);
      var all = ordersIn(range);
      var total = revenueIn(all);

      var statuses = {};
      var payments = {};
      var departments = {};

      all.forEach(function (order) {
        var live = order.status !== 'cancelled';

        var status = statuses[order.status] || (statuses[order.status] = {
          id: order.status, label: order.statusLabel, orders: 0, value: 0
        });
        status.orders += 1;
        if (live) status.value += order.total;

        var payment = payments[order.payment] || (payments[order.payment] = {
          id: order.payment, label: order.paymentLabel, orders: 0, value: 0
        });
        payment.orders += 1;
        if (live) payment.value += order.total;

        if (!live) return;

        order.items.forEach(function (line) {
          var product = ZB.catalogue.byId(line.id);
          if (!product) return;

          var dept = departments[product.dept] || (departments[product.dept] = {
            id: product.dept, label: product.deptLabel, units: 0, revenue: 0
          });
          dept.units += line.qty;
          dept.revenue += line.price * line.qty;
        });
      });

      /* Status is not ranked by value. It is a sequence — pending,
         processing, shipped, delivered, cancelled — and reordering it by
         size would turn a queue into a league table, which is not what
         anybody reads a status split for. */
      var statusOrder = STATUS_FLOW.concat(['cancelled']);
      var statusRows = statusOrder
        .filter(function (id) { return statuses[id]; })
        .map(function (id) {
          statuses[id].share = shareOf(statuses[id].orders, all.length);
          return statuses[id];
        });

      return Repo.defer({
        range: range,
        totalOrders: all.length,
        totalRevenue: total,
        statuses: statusRows,
        payments: ranked(payments, total, 'value'),
        departments: ranked(departments, total, 'revenue')
      });
    },

    /**
     * Which products actually sold.
     *
     * The best sellers, and — the half a top-five list always leaves out —
     * how much of the catalogue sold nothing at all. A shop with 560
     * products and 190 that moved in a quarter has a problem no ranking of
     * the top five will ever show it.
     */
    products: function (options, limit) {
      var range = resolveRange(options);
      var totals = {};
      var total = 0;

      ordersIn(range).forEach(function (order) {
        if (order.status === 'cancelled') return;

        order.items.forEach(function (line) {
          var row = totals[line.id] || (totals[line.id] = {
            id: line.id,
            title: line.title,
            image: line.image,
            units: 0,
            revenue: 0,
            orders: 0,
            seen: {}
          });
          row.units += line.qty;
          row.revenue += line.price * line.qty;
          /* Distinct orders, not lines. One order carrying the same
             product on two lines is one order, and a column headed
             "Orders" that counts lines is quietly reporting something
             else under the right name. */
          if (!row.seen[order.id]) {
            row.seen[order.id] = true;
            row.orders += 1;
          }
          total += line.price * line.qty;
        });
      });

      var rows = ranked(totals, total, 'revenue');
      /* The bookkeeping set is not part of the answer. */
      rows.forEach(function (row) { delete row.seen; });

      var catalogue = ZB.catalogue.all().length;

      return Repo.defer({
        range: range,
        items: rows.slice(0, limit || 10),
        sold: rows.length,
        catalogue: catalogue,
        unsold: Math.max(0, catalogue - rows.length),
        soldShare: shareOf(rows.length, catalogue),
        revenue: total
      });
    },

    /**
     * Who bought, and whether they had bought before.
     *
     * "Returning" means the customer had at least one order before this
     * window opened — not that they ordered twice inside it. A shop that
     * counted only repeat orders within the period would report a loyal
     * customer who buys once a quarter as a brand-new one every time.
     */
    customers: function (options, limit) {
      var range = resolveRange(options);
      var inRange = ordersIn(range);

      var earlier = {};
      currentOrders().forEach(function (order) {
        if (order.daysAgo > range.oldest) earlier[order.customerId] = true;
      });

      var buyers = {};
      inRange.forEach(function (order) {
        var row = buyers[order.customerId] || (buyers[order.customerId] = {
          id: order.customerId,
          name: order.customerName,
          city: order.city,
          orders: 0,
          spent: 0,
          returning: !!earlier[order.customerId]
        });
        row.orders += 1;
        if (order.status !== 'cancelled') row.spent += order.total;
      });

      var rows = Object.keys(buyers).map(function (id) { return buyers[id]; });
      var returning = rows.filter(function (row) { return row.returning; });
      var revenue = rows.reduce(function (sum, row) { return sum + row.spent; }, 0);

      rows.sort(function (a, b) { return b.spent - a.spent; });
      rows.forEach(function (row) { row.share = shareOf(row.spent, revenue); });

      var people = ZB.adminMock.customers();
      var joined = people.filter(function (person) {
        return person.joinedDaysAgo <= range.oldest &&
               person.joinedDaysAgo >= range.newest;
      });

      return Repo.defer({
        range: range,
        buyers: rows.length,
        returning: returning.length,
        first: rows.length - returning.length,
        returningShare: shareOf(returning.length, rows.length),
        returningRevenue: returning.reduce(function (sum, row) {
          return sum + row.spent;
        }, 0),
        revenue: revenue,
        joined: joined.length,
        registered: people.length,
        /* How many of the people on the books actually bought in the
           window. A customer list is a mailing list until this number
           says otherwise. */
        activeShare: shareOf(rows.length, people.length),
        top: rows.slice(0, limit || 8)
      });
    }
  };

  /* -----------------------------------------------------------------------
     Settings

     WHAT A SETTING IS FOR, AND WHY THAT IS NOT ONE RECORD
     "Settings" is the screen most likely to become a drawer everything gets
     dropped into, so this section keeps four groups apart and never merges
     them: the shop's own details, the person signed in, what is worth being
     told about, and how the panel is drawn. They are saved separately
     because they fail separately — mistyping the support address and
     preferring a denser table are not one change, and a screen that saves
     them together makes the second ship with the first.

     SOME OF THESE ARE ALREADY IN FORCE AND SOME ARE ONLY RECORDED
     Only part of a settings screen can do anything in a build with no
     server, and which part is not obvious from looking at it:

       store.lowStockAt   in force  — two screens read it below
       profile.name       in force  — the sidebar redraws from it
       appearance.*       in force  — but owned by the shell, not by this
                                      module; see the next note
       everything else    recorded  — kept, shown, and waiting for a backend

     That difference is not hidden. The page marks each group, because a
     switch that looks like it turns email on and does not is worse than no
     switch at all.

     WHY APPEARANCE IS NOT A SECTION OF THIS RECORD
     Store details, the profile and the notification choices describe the
     business: they are the same for whoever signs in and they are what a
     database will eventually hold. Appearance is a preference about one
     browser on one desk, of exactly the kind the sidebar's collapse state
     already is — so it lives in admin-shell.js beside it rather than being
     smuggled through a data layer that is on its way to a server. The
     option lists below stay here because they are vocabulary the page and
     the shell must agree on; the values do not.

     WHERE THE PROFILE COMES FROM
     Not from data/admin/admin-settings.js. The signed-in identity already
     lives in ZB.adminUser and the sidebar draws it from there; a second
     copy would give the panel two answers to "who is signed in" and the
     first edit would make them disagree. This section reads and writes that
     object, in the same way the banners section manages the storefront's
     own ZB.heroSlides.

     WHAT THIS SECTION MUST NEVER HOLD
     No password, no token, no API key, and no role that means anything.
     `role` is returned so the page can show it and is refused on write:
     whatever a frontend writes into a field called "role" is a label on a
     screen, never a permission. Permission is decided where the data lives,
     by a service that checks who is asking on every read and write. If this
     module ever appears to grant one, it is lying.
     ----------------------------------------------------------------------- */

  /* Changed values, by section. Same seam as every other section here: the
     defaults are never mutated, so `reset` has something to go back to. */
  var stEdited = { store: {}, notifications: {} };

  /* The profile is written straight back to ZB.adminUser — see above — so
     the only thing tracked here is whether it has been touched at all. */
  var stProfileEdited = false;

  function stDefaults() {
    return (ZB.adminSettings) || {};
  }

  /** Defaults with this session's changes applied, for one section. */
  function stSection(name) {
    var base = stDefaults()[name] || {};
    var out = {};
    Object.keys(base).forEach(function (key) { out[key] = base[key]; });
    Object.keys(stEdited[name] || {}).forEach(function (key) {
      out[key] = stEdited[name][key];
    });
    return out;
  }

  /**
   * How low is low.
   *
   * A function rather than the constant this used to be, so the threshold
   * has exactly one home and the settings screen can move it. The product
   * list's stock pill, the inventory filter and the dashboard's alert all
   * arrive here, which is the point: a threshold that means ten in one
   * place and five in another is a bug nobody notices until something sells
   * out under a badge that said it was fine.
   *
   * A missing or nonsensical value falls back to ten rather than throwing.
   * A settings file somebody mistyped should cost a wrong threshold, not a
   * dead inventory screen.
   */
  function lowStockAt() {
    var value = Number(stSection('store').lowStockAt);
    return value > 0 ? value : 10;
  }

  /* The appearance choices, as the page has to offer them. Kept here rather
     than in the page so that the value written into the record and the
     option that produced it cannot drift apart. */
  var DENSITIES = [
    { id: 'comfortable', label: 'Comfortable',
      note: 'The default spacing. Easier to scan, fewer rows on screen.' },
    { id: 'compact', label: 'Compact',
      note: 'Tighter rows and padding, for long lists on a large screen.' }
  ];

  var SIDEBAR_MODES = [
    { id: 'expanded', label: 'Expanded', note: 'Icons and labels.' },
    { id: 'collapsed', label: 'Collapsed', note: 'Icons only, with the label as a tooltip.' }
  ];

  var MOTIONS = [
    { id: 'system', label: 'Follow my system setting',
      note: 'Animations run unless this device asks for reduced motion.' },
    { id: 'reduced', label: 'Reduce motion',
      note: 'Transitions and animations are switched off in the panel.' }
  ];

  /* The four groups, in the order the page draws them, with what each one
     can actually do today. `effect` is what the page marks them with. */
  var SETTING_SECTIONS = [
    { id: 'store', label: 'Store', effect: 'part',
      blurb: 'The shop’s own details, and the stock level that counts as low.' },
    { id: 'profile', label: 'Profile', effect: 'part',
      blurb: 'The account signed in to this panel.' },
    { id: 'notifications', label: 'Notifications', effect: 'recorded',
      blurb: 'What is worth being told about.' },
    { id: 'appearance', label: 'Appearance', effect: 'live',
      blurb: 'How this panel is drawn on this device. Kept on this device only.' }
  ];

  /**
   * Notification events, as data.
   *
   * The page renders one switch per entry, so adding an event is a line
   * here rather than a block of markup — and the label and the key it
   * writes cannot come apart.
   */
  var NOTICE_EVENTS = [
    { id: 'newOrder', label: 'A new order arrives',
      help: 'The one most shops want. Quiet only if somebody is already watching the queue.' },
    { id: 'orderCancelled', label: 'An order is cancelled',
      help: 'Worth knowing because the stock goes back and the money does not arrive.' },
    { id: 'lowStock', label: 'A product runs low',
      help: 'Uses the stock level set under Store.' },
    { id: 'newCustomer', label: 'Somebody creates an account',
      help: 'Off by default — on a busy shop this is the one that becomes noise.' },
    { id: 'weeklySummary', label: 'A weekly summary',
      help: 'Monday morning: the week’s revenue, orders and anything that ran out.' }
  ];

  Repo.settings = {

    sections: SETTING_SECTIONS,
    densities: DENSITIES,
    sidebarModes: SIDEBAR_MODES,
    motions: MOTIONS,
    events: NOTICE_EVENTS,

    /** The fixed currency, and why it is fixed. Read only, deliberately. */
    currency: function () {
      var c = stDefaults().currency || {};
      return {
        code: c.code || 'PKR',
        label: c.label || '',
        symbol: c.symbol || ''
      };
    },

    /** The whole record, as a copy. Nothing internal is ever handed out. */
    get: function () {
      var user = ZB.adminUser || {};

      return Repo.defer({
        store: stSection('store'),
        profile: {
          name: user.name || '',
          email: user.email || '',
          role: user.role || '',
          initials: user.initials || ''
        },
        notifications: stSection('notifications')
      });
    },

    /**
     * Save one section. Resolves with that section as it now stands.
     *
     * Unknown keys are dropped rather than stored: a section is a fixed set
     * of fields, and quietly accepting a misspelled one would save
     * something the page then reads back as missing.
     */
    update: function (name, values) {
      if (name === 'profile') return Repo.settings.updateProfile(values);

      var base = stDefaults()[name];
      if (!base) return Promise.reject({ message: 'There is no such settings group.' });

      Object.keys(values || {}).forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(base, key)) {
          stEdited[name][key] = values[key];
        }
      });

      return Repo.defer(stSection(name));
    },

    /**
     * Save the profile, which means writing to ZB.adminUser.
     *
     * `role` is read from the incoming values and thrown away. It is shown
     * on the screen so the owner knows what the account is, and it is not
     * editable here, because a role a frontend can set is not a permission
     * — it is a word on a page. See the note above this section.
     */
    updateProfile: function (values) {
      var user = ZB.adminUser || (ZB.adminUser = {});
      var name = String((values && values.name) || '').trim();
      var email = String((values && values.email) || '').trim();

      if (name) {
        user.name = name;
        /* Derived rather than typed. Two fields for one fact drift, and
           the initials are the half nobody remembers to update. */
        user.initials = name.split(/\s+/).slice(0, 2).map(function (part) {
          return part.charAt(0).toUpperCase();
        }).join('') || user.initials;
      }
      if (email) user.email = email;

      stProfileEdited = true;

      return Repo.defer({
        name: user.name, email: user.email,
        role: user.role, initials: user.initials
      });
    },

    /** Put one section back to what the panel opened with. */
    reset: function (name) {
      if (name === 'profile') {
        return Promise.reject({
          message: 'The profile has no defaults to return to — it is the signed-in account.'
        });
      }
      if (!stEdited[name]) {
        return Promise.reject({ message: 'There is no such settings group.' });
      }

      stEdited[name] = {};
      return Repo.defer(stSection(name));
    },

    /** Whether a single section differs from the defaults. */
    isEdited: function (name) {
      if (name === 'profile') return stProfileEdited;
      return Object.keys(stEdited[name] || {}).length > 0;
    },

    hasUnsavedEdits: function () {
      return stProfileEdited || ['store', 'notifications']
        .some(function (name) { return Repo.settings.isEdited(name); });
    }
  };

  ZB.repo = Repo;

}(window.ZB));
