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

  /**
   * Send one picture, and get back the URL it now lives at.
   *
   * The file itself is the request body. A multipart form is what a browser
   * sends by default and reading one needs a parser — a dependency this
   * project does not have, or a hundred lines of boundary-splitting written
   * by hand. `body: file` needs neither, and fetch sets the Content-Type
   * from the file.
   *
   * Nothing about the file is trusted on the far side: api/admin/uploads.js
   * reads the first bytes to see what it actually is, checks the size, and
   * decides the name itself.
   */
  Repo.uploadImage = function (file, kind) {
    if (!file) return Promise.reject(new Error('No file was chosen.'));

    return fetch(Api.query('/api/admin/uploads', { for: kind || 'products' }), {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': file.type || 'application/octet-stream'
      },
      body: file
    }).then(function (res) {
      return res.json().catch(function () {
        throw new Error('The server did not answer properly (' + res.status + ').');
      }).then(function (payload) {
        if (res.ok && payload && payload.ok) return payload.data;

        var error = new Error((payload && payload.error && payload.error.message) ||
                              'That picture could not be saved.');
        error.status = res.status;
        throw error;
      });
    });
  };

  /**
   * Every page of a paged endpoint, up to a limit, as one array.
   *
   * Used where a screen's own question needs the whole set rather than a
   * page of it — an inventory total, a report's period, a sort by something
   * the database cannot order by. Each of those says why at its own call.
   */
  function loadAll(path, cap) {
    var out = [];

    var next = function (page) {
      return Api.get(Api.query(path, { page: page, perPage: 100 }))
        .then(function (result) {
          out = out.concat(result.items || []);

          if (out.length >= cap) return out.slice(0, cap);
          if (page >= result.pages) return out;

          return next(page + 1);
        });
    };

    return next(1);
  }

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
     The same rows the product screen shows, from the same endpoint, asked a
     different question: that screen asks "what do we sell", this one asks
     "what is about to run out". Two lists would be two places for a stock
     number to live, and they would disagree the first time one was edited.

     IT USED TO READ THE STOREFRONT'S CATALOGUE, WHICH WAS WRONG
     currentRows() was built from ZB.catalogue — the shop's own list, which
     holds only active products. So the one screen whose job is finding what
     has run out could not see a draft, and its rows were keyed by the
     storefront slug rather than by the id the product endpoints take, which
     is why its stock changes were still being held in memory.

     It reads /api/admin/products now, whole, because every figure the screen
     shows is over all of them: how many are out, how many are low, what the
     shelf is worth. A page of twenty cannot answer any of those.
     ----------------------------------------------------------------------- */

  /* Where loading the catalogue whole stops being reasonable. The screen
     would still work past this; the totals above it would quietly be totals
     of the first five thousand. */
  var STOCK_MAX = 5000;

  var stockCache = null;
  var stockLoad = null;

  function loadStock() {
    if (!stockLoad) {
      stockLoad = loadAll('/api/admin/products', STOCK_MAX)
        .then(function (rows) { stockCache = rows; })
        .catch(function (err) {
          /* A failure must not be remembered as the answer. */
          stockLoad = null;
          throw err;
        });
    }

    return stockLoad;
  }

  /** Throw the snapshot away — after a stock change, or a product edit. */
  function forgetStock() {
    stockCache = null;
    stockLoad = null;
  }

  function currentRows() { return stockCache || []; }

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

    /* -- writes -- */

    /**
     * Set one product's stock.
     *
     * Also settles the status that has to move with it. A product on the
     * shelf that says "Out of stock", or a sold-out one still offered, is a
     * row that contradicts itself — and the storefront reads stock to decide
     * whether the buy button works.
     *
     * A draft stays a draft: it is hidden from the shop for a reason that
     * has nothing to do with stock, and restocking it must not publish it.
     * So is an archived product, which was deliberately taken out of the
     * shop and does not come back because somebody counted it.
     */
    setStock: function (id, stock) {
      var quantity = Math.round(Number(stock));

      if (!isFinite(quantity) || quantity < 0) {
        return Promise.reject(new Error('That is not a quantity.'));
      }

      return loadStock().then(function () {
        var row = currentRows().filter(function (r) { return r.id === id; })[0];
        if (!row) throw new Error('That product no longer exists.');

        var change = { stock: quantity };

        /* 'out-of-stock' is not a status the database has and never was —
           it is stock being zero, which the line above has just set. Writing
           one would be a second copy of the same fact, free to disagree with
           the first. */
        if (row.status === 'draft' || row.status === 'archived') {
          /* left alone, deliberately — see above */
        } else {
          change.status = 'active';
        }

        return Api.send('PATCH', '/api/admin/products/' + encodeURIComponent(id), change);
      }).then(function (result) {
        forgetStock();
        if (Repo.metrics) Repo.metrics.forget();
        return result.product;
      });
    },

    /** Add to or take from what is there. Never goes below zero. */
    adjustStock: function (id, delta) {
      return loadStock().then(function () {
        var row = currentRows().filter(function (r) { return r.id === id; })[0];
        if (!row) throw new Error('That product no longer exists.');

        return Repo.inventory.setStock(id, Math.max(0, row.stock + delta));
      });
    },

    /** Always false: every change above reaches the database. */
    hasUnsavedEdits: function () {
      return false;
    }
  };

  /* Everything above that reads rows waits for them first. The filtering,
     the sorting and the tiles were written against an array that was simply
     there; they did not need to change for it to arrive over the network,
     they needed to happen afterwards.

     THE SETTINGS ARE WAITED FOR TOO, AND FOR THE SAME REASON
     Every row on this screen is labelled 'out', 'low' or 'in', and where
     'low' begins is now a number in the database rather than one in a file
     the browser already had. Drawing before it arrives would label the
     whole list against the fallback of ten and never correct itself — the
     rows are painted once. Both requests go out together, so waiting for
     the second costs nothing. */
  ['facets', 'list', 'summary'].forEach(function (name) {
    var counted = Repo.inventory[name];

    Repo.inventory[name] = function () {
      var args = arguments;

      return Promise.all([loadStock(), loadSettings()]).then(function () {
        return counted.apply(Repo.inventory, args);
      });
    };
  });

  /* -----------------------------------------------------------------------
     Orders

     THE ONE SECTION THAT NEVER WRITES A NEW ROW
     There is no create() here and no endpoint behind one. An order records
     something that happened — a customer chose things and asked for them —
     and a panel that could invent one could invent revenue, which the
     reports screen would then report. Orders arrive from the checkout, and
     from nowhere else.

     STATUS CHANGES CAN MOVE STOCK
     Cancelling an order gives every line back to the shelf and gives the
     coupon back its use; reopening one takes them again, and fails if the
     stock has since gone. That is several writes that have to agree, so it
     happens inside public.set_order_status in one transaction rather than
     as a field update from here. See db/checkout.sql.
     ----------------------------------------------------------------------- */

  var STATUS_LABELS = {
    pending: 'Pending', processing: 'Processing', shipped: 'Shipped',
    delivered: 'Delivered', cancelled: 'Cancelled'
  };

  var PAYMENT_LABELS = { paid: 'Paid', unpaid: 'Unpaid', refunded: 'Refunded' };

  function orderLabel(id) { return STATUS_LABELS[id] || id; }

  /* Which statuses an order may be moved to from the one it is in.
   *
   * The flow forward, plus cancelling from anywhere it has not already
   * shipped. Delivered is the end: an order that arrived cannot become
   * pending again, and offering that would be offering to rewrite what
   * happened. Cancelled is reopened by choosing a status again, which the
   * database allows and which puts the stock back where it was. */
  var NEXT_STATUS = {
    pending: ['processing', 'cancelled'],
    processing: ['shipped', 'cancelled'],
    shipped: ['delivered'],
    delivered: [],
    cancelled: ['pending']
  };

  var STATUS_FLOW = ['pending', 'processing', 'shipped', 'delivered'];

  Repo.orders = {

    sorts: [
      { id: 'newest', label: 'Newest first' },
      { id: 'oldest', label: 'Oldest first' },
      { id: 'total-desc', label: 'Highest value' },
      { id: 'total-asc', label: 'Lowest value' }
    ],

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

    /**
     * The filter options.
     *
     * Fixed lists rather than whatever the current orders happen to use.
     * The old version derived them from the rows, which was right when the
     * rows were generated and every status was represented; against a real
     * shop it means a filter disappears the moment nothing is in that state
     * — so "Cancelled" would vanish exactly when somebody wanted to check
     * whether anything had been cancelled.
     */
    facets: function () {
      var list = function (map, order) {
        return order.map(function (id) { return { id: id, label: map[id] }; });
      };

      return Promise.resolve({
        statuses: [{ id: 'waiting', label: 'Needs action' }].concat(
          list(STATUS_LABELS, ['pending', 'processing', 'shipped',
                               'delivered', 'cancelled'])),
        payments: list(PAYMENT_LABELS, ['paid', 'unpaid', 'refunded']),
        ranges: Repo.orders.ranges
      });
    },

    /** options: { search, status, payment, range, sort, page, perPage } */
    list: function (options) {
      options = options || {};

      return Api.get(Api.query('/api/admin/orders', {
        search: options.search,
        status: options.status,
        payment: options.payment,
        range: options.range,
        sort: options.sort,
        page: options.page,
        perPage: options.perPage
      }));
    },

    get: function (id) {
      return Api.get('/api/admin/orders/' + encodeURIComponent(id))
        .then(function (data) { return data.order; })
        .catch(function (err) {
          if (err.status === 404) return null;
          throw err;
        });
    },

    /** The newest few, for the dashboard. */
    recent: function (limit) {
      return Repo.orders.list({ perPage: limit || 6, sort: 'newest' })
        .then(function (result) { return result.items; });
    },

    /** The counts behind the status filter, for the strip above the list. */
    summary: function () {
      return Api.get('/api/admin/orders/summary');
    },

    /* -- writes -- */

    /**
     * Move an order to a new status.
     *
     * The flow is checked here before the request goes, so a UI bug that
     * offers the wrong button surfaces as a refusal rather than as a
     * delivered order that was never shipped. The database does not enforce
     * the flow — it enforces the five statuses — so this is the only place
     * that rule lives, and it is a rule about how this shop works rather
     * than about what the data may be.
     */
    updateStatus: function (id, status) {
      return Repo.orders.get(id).then(function (order) {
        if (!order) throw new Error('That order no longer exists.');

        if ((NEXT_STATUS[order.status] || []).indexOf(status) === -1) {
          throw new Error('An order that is ' + orderLabel(order.status).toLowerCase() +
                          ' cannot be moved to ' + orderLabel(status).toLowerCase() + '.');
        }

        var body = { status: status };

        /* Cancelling settles the money too. Leaving payment on "Paid"
           beside a cancelled order states something the shop would have to
           answer for, and every revenue figure already treats a cancelled
           order as not earned. */
        if (status === 'cancelled' && order.payment === 'paid') body.payment = 'refunded';

        return Api.send('PATCH', '/api/admin/orders/' + encodeURIComponent(id), body);
      }).then(function (result) { return result.order; });
    },

    /** Mark an unpaid order paid — the other thing that happens by hand. */
    markPaid: function (id) {
      return Api.send('PATCH', '/api/admin/orders/' + encodeURIComponent(id),
                      { payment: 'paid' })
        .then(function (result) { return result.order; });
    },

    /**
     * Undo: put an order back as it was.
     *
     * `previous` is what the screen captured before the change — the same
     * token it always passed. Only the two fields that can be changed are
     * put back, because they are the only two that moved.
     */
    restore: function (id, previous) {
      if (!previous) return Promise.resolve(false);

      var body = {};
      if (previous.status) body.status = previous.status;
      if (previous.payment) body.payment = previous.payment;

      if (!Object.keys(body).length) return Promise.resolve(false);

      return Api.send('PATCH', '/api/admin/orders/' + encodeURIComponent(id), body)
        .then(function () { return true; });
    },

    /**
     * Whether an order counts as money the shop took.
     *
     * One line, in one place, because it is the rule that decides every
     * revenue figure on every screen — the dashboard's, the orders
     * screen's, a customer's lifetime spend, the reports. It also has to
     * agree with public.customer_stats in db/schema.sql, which excludes
     * cancelled orders in SQL for the same reason.
     */
    isRevenue: function (order) {
      return !!order && order.status !== 'cancelled';
    },

    /** Always false: every change above reaches the database. */
    hasUnsavedEdits: function () {
      return false;
    }
  };

  /* -----------------------------------------------------------------------
     Customers

     COUNTED, NEVER CARRIED
     A customer's order count and lifetime spend are not columns on their
     row. They are counted from the orders by the customer_stats view, and
     db/schema.sql explains why at length: a total stored beside somebody is
     correct until an order is cancelled and something forgets to adjust it,
     and from then on it is quietly wrong.

     BLOCKING IS THE ONLY WRITE
     Not the name, not the email, not the role. A customer's own details are
     theirs to correct; making somebody an administrator is not customer
     management and is not offered here at all.
     ----------------------------------------------------------------------- */

  /* The page asks for the tiles and for the filter options, and both are
     answered by the same endpoint — so it is fetched once and shared. The
     cache lasts until something is written, which is what forget() is for. */
  var customerSummary = null;

  function summaryOfCustomers() {
    if (!customerSummary) {
      customerSummary = Api.get('/api/admin/customers/summary').catch(function (err) {
        customerSummary = null;
        throw err;
      });
    }

    return customerSummary;
  }

  Repo.customers = {

    sorts: [
      { id: 'recent', label: 'Newest first' },
      { id: 'oldest', label: 'Oldest first' },
      { id: 'name-asc', label: 'Name A–Z' },
      { id: 'name-desc', label: 'Name Z–A' },
      { id: 'spent-desc', label: 'Highest spend' },
      { id: 'spent-asc', label: 'Lowest spend' },
      { id: 'orders-desc', label: 'Most orders' }
    ],

    /**
     * The filter options.
     *
     * The two account states are fixed, for the same reason the order
     * statuses are: a filter that disappears when nothing matches it is a
     * filter nobody can use to check that nothing matches it.
     *
     * The cities are not fixed — they are wherever this shop has actually
     * delivered — and they come from the summary endpoint, which is where
     * the same list is derived for the column beside them.
     */
    facets: function () {
      return summaryOfCustomers().then(function (data) {
        return {
          statuses: [
            { id: 'active', label: 'Active' },
            { id: 'blocked', label: 'Blocked' }
          ],
          cities: data.cities || []
        };
      });
    },

    /** options: { search, status, city, sort, page, perPage } */
    list: function (options) {
      options = options || {};

      return Api.get(Api.query('/api/admin/customers', {
        search: options.search,
        status: options.status,
        city: options.city,
        sort: options.sort,
        page: options.page,
        perPage: options.perPage
      }));
    },

    get: function (id) {
      return Api.get('/api/admin/customers/' + encodeURIComponent(id))
        .then(function (data) { return data.customer; })
        .catch(function (err) {
          if (err.status === 404) return null;
          throw err;
        });
    },

    /** The orders this person has placed, newest first. */
    orders: function (id) {
      return Api.get('/api/admin/customers/' + encodeURIComponent(id))
        .then(function (data) { return data.orders; })
        .catch(function (err) {
          if (err.status === 404) return [];
          throw err;
        });
    },

    /**
     * The four tiles above the list, counted over everyone rather than over
     * the page on screen. See api/admin/customers/summary.js.
     */
    summary: function () {
      return summaryOfCustomers();
    },

    setStatus: function (id, status) {
      return Api.send('PATCH', '/api/admin/customers/' + encodeURIComponent(id),
                      { status: status })
        .then(function (result) {
          /* The blocked count above the list has just changed. */
          customerSummary = null;
          return result.customer;
        });
    },

    /** Always false: every change above reaches the database. */
    hasUnsavedEdits: function () {
      return false;
    }
  };

  /* -----------------------------------------------------------------------
     Metrics

     ONE REQUEST, FIVE ANSWERS
     The dashboard asks five questions about the same orders. Asked
     separately they would fetch the same rows five times and could each be
     computed from a slightly different window — a chart and a headline
     disagreeing about the same fortnight. /api/admin/metrics counts them
     once, next to the data, and this caches the answer per window so
     opening the dashboard is one round trip.
     ----------------------------------------------------------------------- */

  var metricsCache = {};

  function metricsFor(days) {
    days = days || 30;

    if (!metricsCache[days]) {
      metricsCache[days] = Api.get(Api.query('/api/admin/metrics', { days: days }))
        .catch(function (err) {
          /* A failure must not be remembered as the answer. */
          delete metricsCache[days];
          throw err;
        });
    }

    return metricsCache[days];
  }

  Repo.metrics = {

    /** Throw away what is cached — after a status change, say. */
    forget: function () { metricsCache = {}; },

    summary: function (days) {
      return metricsFor(days).then(function (data) { return data.summary; });
    },

    /**
     * Daily revenue, oldest first — the sales overview line.
     *
     * The server sends how many days ago each bucket is; the date is worked
     * out here, in the reader's own timezone, because that is whose "today"
     * the labels are about.
     */
    salesSeries: function (days) {
      return metricsFor(days).then(function (data) {
        var today = new Date();
        today.setHours(0, 0, 0, 0);

        return data.series.map(function (bucket) {
          var date = new Date(today.getTime());
          date.setDate(date.getDate() - bucket.daysAgo);

          return {
            date: date,
            daysAgo: bucket.daysAgo,
            value: bucket.value,
            orders: bucket.orders
          };
        });
      });
    },

    topProducts: function (days, limit) {
      return metricsFor(days).then(function (data) {
        return data.topProducts.slice(0, limit || 5);
      });
    },

    activity: function (limit) {
      return metricsFor(30).then(function (data) {
        return data.activity.slice(0, limit || 6);
      });
    },

    /** The small counters beside the sidebar items. */
    navBadges: function () {
      return metricsFor(30).then(function (data) { return data.badges; });
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
     The banners table, through /api/admin/banners. It used to be
     ZB.heroSlides — the file the storefront's homepage read — with an
     overlay on top, so an edit made here never reached the shop at all.

     WHY ORDER IS A FIRST-CLASS OPERATION AND NOT A SORT
     A carousel is an ordered thing. Slide one is what almost everybody
     sees, slide seven is what almost nobody does, and that difference is
     most of the reason an owner opens this screen. So there is no sort
     control — there is a way to move a slide up and down, and the list is
     always in the order the shop plays them.

     THE LINK CHECK STAYS IN THE BROWSER
     Every slide carries a call to action, and one that lands on "page not
     found" is the most expensive broken thing a storefront can have: it is
     on the homepage, above the fold, and it is the button the campaign was
     bought to make people press. So the destination is checked against the
     routes the storefront actually serves rather than merely stored.

     That check reads ZB.navigation and ZB.catalogue — the same lists the
     shop's own pages resolve against, in the same browser. A server
     answering it would be keeping a second copy of the shop's routes, going
     stale on its own schedule.
     ----------------------------------------------------------------------- */

  /**
   * The category tree flattened into rows, for the link picker.
   *
   * This used to be a function shared with the categories section, and that
   * section stopped needing it when it moved to the API — so it went, and
   * took the banner link picker with it. Nothing said so: checkLink and
   * linkOptions were left calling a function that no longer existed, which
   * is a ReferenceError the moment somebody opens a slide.
   *
   * It reads ZB.navigation, which is the menu as the shop is actually
   * serving it — so a category the owner added a moment ago is somewhere a
   * slide can point.
   */
  function navigationRows() {
    var slug = ZB.ui.slug;
    var rows = [];

    (ZB.navigation || []).forEach(function (dept) {
      (dept.items || []).forEach(function (item) {
        rows.push({
          dept: dept.id, deptLabel: dept.label,
          slug: slug(item.label), label: item.label, level: 1
        });

        (item.children || []).forEach(function (child) {
          rows.push({
            dept: dept.id, deptLabel: dept.label,
            slug: slug(child.label), label: child.label, level: 2
          });
        });
      });
    });

    return rows;
  }

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

  /* The whole run is fetched at once and cached until something writes: a
     carousel is a handful of slides, and every question this screen asks —
     how many are hidden, which one is third — is about all of them. */

  var bannerCache = null;
  var bannerLoad = null;

  function loadBanners() {
    if (!bannerLoad) {
      bannerLoad = Api.get('/api/admin/banners').then(function (data) {
        bannerCache = data;
      }).catch(function (err) {
        bannerLoad = null;
        throw err;
      });
    }

    return bannerLoad;
  }

  function forgetBanners() {
    bannerCache = null;
    bannerLoad = null;
  }

  /** The slides, each told where it plays and whether its link goes anywhere. */
  function currentBanners() {
    var rows = ((bannerCache && bannerCache.items) || []).map(function (row) {
      var out = {};
      Object.keys(row).forEach(function (key) { out[key] = row[key]; });

      var link = checkLink(out.href);
      out.linkOk = link.ok;
      out.linkReason = link.reason;

      return out;
    });

    /* Position is what a shopper experiences, so it counts only the slides
       that actually play. A hidden slide keeps its place in the list — it is
       easier to bring back where it was — but is not given a number in a run
       it is not part of. */
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

      return loadBanners().then(function () {
        var all = currentBanners();

        var rows = all.filter(function (row) {
          if (options.view === 'active') return row.status === 'active';
          if (options.view === 'hidden') return row.status !== 'active';
          if (options.view === 'broken') return !row.linkOk;
          return true;
        });

        return {
          items: rows,
          total: rows.length,
          active: all.filter(function (row) { return row.status === 'active'; }).length,
          hidden: all.filter(function (row) { return row.status !== 'active'; }).length,
          broken: all.filter(function (row) { return !row.linkOk; }).length
        };
      });
    },

    get: function (id) {
      return loadBanners().then(function () {
        return currentBanners().filter(function (row) { return row.id === id; })[0] || null;
      });
    },

    summary: function () {
      return loadBanners().then(function () {
        var rows = currentBanners();
        var live = rows.filter(function (row) { return row.status === 'active'; });

        return {
          total: rows.length,
          active: live.length,
          hidden: rows.length - live.length,
          /* Counted across every slide, not only the live ones: a broken
             link on a hidden slide is a trap set for whoever turns it on. */
          broken: rows.filter(function (row) { return !row.linkOk; }).length
        };
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
     * somewhere odd does not silently move it.
     */
    linkOptions: function (current) {
      var options = [{ id: '/', label: 'Homepage' }];

      navigationRows().forEach(function (row) {
        options.push({
          id: '/category/' + row.dept + '/' + row.slug,
          label: row.deptLabel + ' \u2192 ' + row.label +
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
        options.unshift({ id: current, label: current + ' \u2014 as it is set now' });
      }

      return options;
    },

    /** Upload a picture and get back the URL it now lives at. */
    upload: function (file) { return Repo.uploadImage(file, 'banners'); },

    /* -- writes -- */

    create: function (data) {
      return Api.send('POST', '/api/admin/banners', {
        /* Which of the home page's three slots this row is for. The server
           defaults it to 'hero' when it is absent, which is what a slide
           added before this field existed was. */
        placement: data.placement || 'hero',
        image: data.image,
        alt: data.alt,
        eyebrow: data.eyebrow || undefined,
        headline: data.headline || undefined,
        body: data.body || undefined,
        cta: data.cta || undefined,
        proof: data.proof || undefined,
        href: data.href || '/',
        status: data.status || 'active'
      }).then(function (result) {
        forgetBanners();
        return result.banner;
      });
    },

    update: function (id, data) {
      var patch = {};

      ['placement', 'image', 'alt', 'eyebrow', 'headline', 'body', 'cta', 'proof',
       'href', 'status']
        .forEach(function (key) {
          if (Object.prototype.hasOwnProperty.call(data, key)) patch[key] = data[key];
        });

      return Api.send('PATCH', '/api/admin/banners/' + encodeURIComponent(id), patch)
        .then(function (result) {
          forgetBanners();
          return result.banner;
        });
    },

    /**
     * Move a slide by one place.
     *
     * By one, and never by drag: a drag needs a pointer, a steady hand and
     * a list that fits on screen, and it has no keyboard at all. Two
     * buttons work with a thumb, with a keyboard and with a screen reader —
     * and for a run of seven slides, one place at a time is not slow.
     *
     * `delta` is -1 or +1. Moving past either end does nothing rather than
     * wrapping, because a slide jumping from first to last is not what
     * anybody pressing "up" meant.
     *
     * The whole running order is what gets sent, not the move. See
     * api/admin/banners/index.js for why.
     */
    move: function (id, delta) {
      return loadBanners().then(function () {
        var order = bannerIds();
        var from = order.indexOf(id);
        var to = from + (delta < 0 ? -1 : 1);

        if (from < 0 || to < 0 || to >= order.length) {
          return { moved: false, order: order };
        }

        order.splice(to, 0, order.splice(from, 1)[0]);

        return Repo.banners.setOrder(order).then(function () {
          return { moved: true, from: from, to: to, order: order };
        });
      });
    },

    /** Put the whole run in a given order. Used by move and by undo. */
    setOrder: function (order) {
      if (!order || !order.length) return Promise.resolve(false);

      return Api.send('PATCH', '/api/admin/banners', { order: order })
        .then(function () {
          forgetBanners();
          return true;
        });
    },

    /**
     * Remove a slide.
     *
     * The token carries the slide's own fields and the running order, which
     * is what restore() needs: putting slide three back at the end of the
     * run is not putting it back.
     */
    remove: function (id) {
      return loadBanners().then(function () {
        var row = currentBanners().filter(function (item) { return item.id === id; })[0];
        if (!row) return null;

        var undo = { id: id, row: row, order: bannerIds() };

        return Api.send('DELETE', '/api/admin/banners/' + encodeURIComponent(id))
          .then(function () {
            forgetBanners();
            return undo;
          });
      });
    },

    /**
     * Put back what remove() took.
     *
     * A deleted row is gone, so this creates it again from what was
     * captured — same picture, same words, same place in the run. It comes
     * back with a new id, which nothing outside this file can tell and
     * nothing inside it depends on.
     */
    restore: function (undo) {
      if (!undo || !undo.row) return Promise.resolve(false);

      return Repo.banners.create(undo.row).then(function (created) {
        if (!undo.order) return true;

        /* The old order, with the new id where the old one stood. */
        var order = undo.order.map(function (id) {
          return id === undo.id ? created.id : id;
        });

        return Repo.banners.setOrder(order).then(function () { return true; });
      });
    },

    /** Always false: every change above reaches the database. */
    hasUnsavedEdits: function () {
      return false;
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

  /** Midnight today, so a coupon ending "today" lasts the whole day. */
  function startOfToday() {
    var now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
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

    /* Null where there is no date, rather than the number of days since
       1970 — which is what `new Date(null)` quietly produces, and what a
       coupon with no end date would otherwise have said it ended. */
    out.startsInDays = out.startsAt == null ? null : daysFromToday(out.startsAt);
    out.endsInDays = out.expiresAt == null ? null : daysFromToday(out.expiresAt);
    out.limitReached = !!out.usageLimit && out.used >= out.usageLimit;

    /* NULL IS NOT A DATE IN THE PAST
       Both dates are optional in the database: a coupon with no start runs
       from the moment it exists, and one with no end does not stop. Compared
       directly, null becomes zero — so every open-ended coupon read as
       expired in 1970, which is the sort of wrong that looks deliberate. */
    var starts = out.startsAt === null || out.startsAt === undefined ? null : out.startsAt;
    var ends = out.expiresAt === null || out.expiresAt === undefined ? null : out.expiresAt;

    if (out.disabled)                        out.state = 'off';
    else if (starts !== null && starts > today) out.state = 'scheduled';
    else if (ends !== null && ends < today)     out.state = 'expired';
    else if (out.limitReached)               out.state = 'used-up';
    else                                     out.state = 'running';

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

  /* -----------------------------------------------------------------------
     WHERE A COUPON COMES FROM

     The coupons table, through /api/admin/coupons. It used to be a seed
     file with an overlay, which meant the panel could describe a discount
     the checkout had never heard of.

     The checkout has been reading this table since Phase 5 — the dates, the
     minimum spend, the usage limit, whether it is switched off — and there
     was no way to put a row in it. Now there is, and the two are the same
     rows.

     THE STATE IS DECIDED HERE, THE REFUSAL IS NOT
     Whether a coupon reads as running, scheduled, expired, used up or
     switched off follows from its dates against *today*, and today is the
     reader's. What a shopper's code actually does is decided in SQL, inside
     place_order, at the moment of ordering. This is a description; that is
     the decision. They agree because they read the same columns.
     ----------------------------------------------------------------------- */

  var couponCache = null;
  var couponLoad = null;

  function loadCoupons() {
    if (!couponLoad) {
      couponLoad = Api.get('/api/admin/coupons').then(function (data) {
        couponCache = data.items || [];
      }).catch(function (err) {
        couponLoad = null;
        throw err;
      });
    }

    return couponLoad;
  }

  function forgetCoupons() {
    couponCache = null;
    couponLoad = null;
  }

  function currentCoupons() {
    return (couponCache || []).map(shapeCoupon);
  }

  var COUPON_SORTS = {
    'ending-soon': function (a, b) {
      /* Coupons that are not running go last whichever way the others
         fall — "ending soonest" is a question about live ones, and an
         expired code at the top of that list answers nothing. */
      if (a.live !== b.live) return a.live ? -1 : 1;

      /* A coupon with no end date never ends, so it sorts last among the
         live ones rather than first — which is where a null would have put
         it, ahead of everything with an actual deadline. */
      var ends = function (row) { return row.expiresAt == null ? Infinity : row.expiresAt; };
      return ends(a) - ends(b);
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
        return row.endsInDays !== null && row.endsInDays >= 0 && row.endsInDays <= 7;
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

    /* -- writes -- */

    /**
     * What the form sends, in the field names the API takes.
     *
     * The panel has always worked in minSpend, usageLimit and milliseconds;
     * the table is min_spend, usage_limit and timestamps. One translation,
     * here, so neither side has to learn the other's vocabulary.
     */
    create: function (data) {
      return Api.send('POST', '/api/admin/coupons', couponBody(data))
        .then(function (result) {
          forgetCoupons();
          return shapeCoupon(result.coupon);
        });
    },

    update: function (id, data) {
      return Api.send('PATCH', '/api/admin/coupons/' + encodeURIComponent(id),
                      couponBody(data))
        .then(function (result) {
          forgetCoupons();
          return shapeCoupon(result.coupon);
        });
    },

    /**
     * Delete a coupon.
     *
     * Refused by the server if any order used it — an order records which
     * coupon it took, and deleting the row would leave that record pointing
     * at nothing. The message says to switch it off instead, which stops
     * the code working immediately and loses nobody's history.
     */
    remove: function (id) {
      return loadCoupons().then(function () {
        var row = currentCoupons().filter(function (item) { return item.id === id; })[0];

        return Api.send('DELETE', '/api/admin/coupons/' + encodeURIComponent(id))
          .then(function () {
            forgetCoupons();
            return { id: id, row: row || null };
          });
      });
    },

    /**
     * Put back what remove() took.
     *
     * A deleted coupon is gone, so this creates it again from what the
     * screen captured — same code, same terms. It cannot have been redeemed
     * (the server refuses to delete one that has been), so nothing about its
     * history is lost in the round trip.
     */
    restore: function (undo) {
      if (!undo || !undo.row) return Promise.resolve(false);

      return Repo.coupons.create(undo.row).then(function () { return true; });
    },

    /** Always false: every change above reaches the database. */
    hasUnsavedEdits: function () {
      return false;
    }
  };

  /** The panel's field names, translated to the API's. */
  function couponBody(data) {
    var body = {};
    var has = function (key) {
      return Object.prototype.hasOwnProperty.call(data, key) && data[key] !== undefined;
    };

    if (has('code')) body.code = data.code;
    if (has('type')) body.type = data.type;
    if (has('note')) body.note = data.note;
    if (has('value')) body.value = Number(data.value) || 0;
    if (has('minSpend')) body.minSpend = Number(data.minSpend) || 0;
    if (has('usageLimit')) body.usageLimit = Number(data.usageLimit) || 0;
    if (has('disabled')) body.disabled = !!data.disabled;
    if (has('startsAt')) body.startsAt = data.startsAt;
    if (has('expiresAt')) body.expiresAt = data.expiresAt;

    return body;
  }

  /* The list, the tiles and the filters all count over every coupon, so they
     wait for the whole set. codeTaken is deliberately not among them: the
     form calls it while somebody is typing, and it reads what the list on
     the same screen has already loaded. */
  ['facets', 'list', 'get', 'summary'].forEach(function (name) {
    var counted = Repo.coupons[name];

    Repo.coupons[name] = function () {
      var args = arguments;

      return loadCoupons().then(function () {
        return counted.apply(Repo.coupons, args);
      });
    };
  });

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
     From the same endpoint the orders screen reads, so a report is counted
     from exactly the rows that screen shows. That matters more here than
     anywhere else: a report is where somebody would notice that cancelling
     an order on one screen had not changed the total on another.

     THE HISTORY HAS AN EDGE AND THE REPORT SAYS SO
     There are ninety days of orders and no more. A period that reaches
     past that is clamped, and the clamp is reported rather than hidden —
     a report showing "this year" against ninety days of data, without
     saying so, is worse than one that refuses the question.
     ----------------------------------------------------------------------- */

  /* -----------------------------------------------------------------------
     WHERE A REPORT'S ORDERS COME FROM

     A report is composition and comparison over a period: shares, splits,
     the same figure against the period before it. Every one of those needs
     the whole period at once, which is why this loads a snapshot rather
     than paging — there is no first page of a percentage.

     The snapshot is taken once and reused for every figure on the screen,
     so the total at the top and the breakdown beneath it are counted from
     the same rows. Repo.reports.forget() throws it away.
     ----------------------------------------------------------------------- */

  var reportOrderCache = null;
  var reportCustomerCache = null;
  var reportLoad = null;

  /* Where a report stops being something to read and becomes an export.
     Reached only by a shop with a great many orders, and the answer then is
     to count in the database, not to raise this. */
  var REPORT_MAX = 5000;


  function loadReportData() {
    if (!reportLoad) {
      reportLoad = Promise.all([
        loadAll('/api/admin/orders', REPORT_MAX),
        loadAll('/api/admin/customers', REPORT_MAX)
      ]).then(function (both) {
        reportOrderCache = both[0];
        reportCustomerCache = both[1];
      }).catch(function (err) {
        /* Not remembered as the answer: the next attempt is a fresh one. */
        reportLoad = null;
        throw err;
      });
    }

    return reportLoad;
  }

  function reportOrders() { return reportOrderCache || []; }
  function reportCustomers() { return reportCustomerCache || []; }

  /**
   * How far back the orders actually go.
   *
   * A report asking for "this year" against three weeks of trading is
   * clamped to three weeks, and the screen says so. The old version read a
   * fixed ninety from the generator's own settings, which was true of
   * generated orders and is not true of a real shop's.
   */
  function historyDays() {
    var oldest = 0;

    reportOrders().forEach(function (order) {
      if (order.daysAgo > oldest) oldest = order.daysAgo;
    });

    return oldest + 1;
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
    return reportOrders().filter(function (order) {
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

    var people = reportCustomers().filter(function (person) {
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
      reportOrders().forEach(function (order) {
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

      var people = reportCustomers();
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
     EVERY REPORT WAITS FOR ITS DATA

     The five methods above were written against an array that was simply
     there — the generated orders, in memory, from the moment the page
     loaded. They are now counted from a snapshot that arrives over the
     network, and the arithmetic inside them did not need to change for
     that: it needed to happen later.

     So each one is wrapped once, here, rather than each having a `.then`
     threaded through it. Which methods are wrapped is listed rather than
     inferred: `presets`, `resolve` and `toDateInput` answer from the
     calendar rather than from the orders, the page calls them while
     building its controls, and turning them into promises would have
     broken that for no reason.
     ----------------------------------------------------------------------- */

  ['overview', 'series', 'breakdown', 'products', 'customers'].forEach(function (name) {
    var counted = Repo.reports[name];

    Repo.reports[name] = function () {
      var args = arguments;

      return loadReportData().then(function () {
        return counted.apply(Repo.reports, args);
      });
    };
  });

  /** Throw the snapshot away — after a status change on another screen. */
  Repo.reports.forget = function () {
    reportOrderCache = null;
    reportCustomerCache = null;
    reportLoad = null;
  };

  /* -----------------------------------------------------------------------
     Pages

     The twelve written pages the storefront links to from its footer:
     FAQs, How To Buy, Payment, Shipping, Returns, Order tracking, About,
     Contact, Stores, Careers, Terms and Privacy.

     THEY USED TO SAY NOTHING AT ALL
     Every one of them rendered the same sentence about being a placeholder,
     including Terms and Privacy, which a shop should not open without. The
     words are rows in the pages table now, written here.

     NEITHER CREATED NOR DELETED, AND THAT IS NOT A MISSING FEATURE
     Each page has a route in assets/js/routes.js and a link in
     data/footer.js. A thirteenth row would be words no visitor can reach; a
     deleted one would be a footer link leading nowhere. Adding a page is a
     change to the site's shape, made in those files together — not on a
     screen about wording.
     ----------------------------------------------------------------------- */

  var pageCache = null;
  var pageLoad = null;

  function loadPages() {
    if (!pageLoad) {
      pageLoad = Api.get('/api/admin/pages').then(function (data) {
        pageCache = data;
      }).catch(function (err) {
        pageLoad = null;
        throw err;
      });
    }

    return pageLoad;
  }

  function forgetPages() {
    pageCache = null;
    pageLoad = null;
  }

  function currentPages() {
    return (pageCache && pageCache.items) || [];
  }

  Repo.pages = {

    /**
     * Every page, in the order the footer lists them.
     * options: { view } — 'empty', 'draft', 'published', or nothing for all.
     * resolves: { items, total, published, empty }
     *
     * Never paged. Twelve rows, and the question the screen is opened with
     * is how many are still blank — which a page of six answers wrongly.
     */
    list: function (options) {
      options = options || {};

      return loadPages().then(function () {
        var all = currentPages();

        var rows = all.filter(function (row) {
          if (options.view === 'empty') return !row.written;
          if (options.view === 'draft') return row.status !== 'published';
          if (options.view === 'published') return row.status === 'published';
          return true;
        });

        return {
          items: rows,
          total: rows.length,
          published: all.filter(function (r) { return r.status === 'published'; }).length,
          empty: all.filter(function (r) { return !r.written; }).length
        };
      });
    },

    get: function (slug) {
      return loadPages().then(function () {
        return currentPages().filter(function (row) { return row.slug === slug; })[0] || null;
      });
    },

    summary: function () {
      return loadPages().then(function () {
        var rows = currentPages();

        return {
          total: rows.length,
          published: rows.filter(function (r) { return r.status === 'published'; }).length,
          empty: rows.filter(function (r) { return !r.written; }).length,

          /* Published but with nothing in it: a live footer link to a
             heading and white space. Counted separately because it is the
             one state that looks finished and is not. */
          hollow: rows.filter(function (r) {
            return r.status === 'published' && !r.written;
          }).length
        };
      });
    },

    /**
     * Save one page's words.
     *
     * The slug is not among the fields: it is the route, and a route the
     * panel could change is a footer link the panel could break.
     */
    update: function (slug, data) {
      var body = {};
      var has = function (key) {
        return Object.prototype.hasOwnProperty.call(data, key) && data[key] !== undefined;
      };

      ['title', 'eyebrow', 'lead', 'body', 'status'].forEach(function (key) {
        if (has(key)) body[key] = data[key];
      });

      return Api.send('PATCH', '/api/admin/pages/' + encodeURIComponent(slug), body)
        .then(function (result) {
          forgetPages();
          return result.page;
        });
    },

    /** Always false: every change above reaches the database. */
    hasUnsavedEdits: function () {
      return false;
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
     Which part does something is still not obvious from looking at it, and
     the page still marks each group, because a switch that looks like it
     turns email on and does not is worse than no switch at all:

       store.shipping     in force  — public.place_order prices every order
                                      from it, and the checkout page quotes
                                      it before anybody orders
       store.lowStockAt   in force  — the product list and the inventory
                                      screen read it through lowStockAt()
       profile.name       in force  — the sidebar redraws from it
       appearance.*       in force  — but owned by the shell, not by this
                                      module; see the next note
       everything else    recorded  — saved, shown, and read by nothing yet

     WHAT CHANGED IN PHASE 7
     "Recorded" used to mean a variable in this file that a reload emptied.
     It now means a row in the settings table, through
     /api/admin/settings. Nothing else about the distinction moved: no mail
     is sent, no shop page shows the support address yet, and the screen
     must not start claiming otherwise.

     The delivery charge is the one that matters. It decides money, in SQL,
     inside place_order — and until Phase 7 the shop's owner had no way to
     set it. The seed wrote 250 and 5,000 and there it stayed.

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

  /* -----------------------------------------------------------------------
     WHERE A SETTING COMES FROM

     The settings table, through /api/admin/settings. It used to be
     data/admin/admin-settings.js with an in-memory overlay on top, which
     meant every change was forgotten on reload and none of it was ever
     the same record the checkout reads.

     THE DEFAULTS FILE IS STILL HERE, AND IS NOT A FALLBACK FOR SHOP DATA
     ZB.adminSettings keeps the currency description and the appearance
     starting values — vocabulary the page and the shell have to agree on.
     It no longer supplies the shop's name, address or support mailbox.
     Those were placeholder text invented to build the screen against, and
     showing them in a form the owner is about to save would put a shop
     address nobody chose into the database.

     An empty box the owner fills in once is the honest version.
     ----------------------------------------------------------------------- */

  var stCache = null;
  var stLoad = null;

  function loadSettings() {
    if (!stLoad) {
      stLoad = Api.get('/api/admin/settings').then(function (data) {
        stCache = data.settings;
      }).catch(function (err) {
        /* Not remembered as the answer: the next read is a fresh attempt. */
        stLoad = null;
        throw err;
      });
    }

    return stLoad;
  }

  function forgetSettings() {
    stCache = null;
    stLoad = null;
  }

  /** The profile is ZB.adminUser — see above — so only the flag lives here. */
  var stProfileEdited = false;

  function stDefaults() {
    return (ZB.adminSettings) || {};
  }

  /** One section of what the server last said, as a copy. */
  function stSection(name) {
    var base = (stCache && stCache[name]) || {};
    var out = {};
    Object.keys(base).forEach(function (key) { out[key] = base[key]; });
    return out;
  }

  /**
   * How low is low.
   *
   * A function rather than the constant this used to be, so the threshold
   * has exactly one home and the settings screen can move it. The product
   * list's stock pill and the inventory filter both arrive here, which is
   * the point: a threshold that means ten in one place and five in another
   * is a bug nobody notices until something sells out under a badge that
   * said it was fine.
   *
   * READ FROM THE CACHE, NOT AWAITED
   * Every caller is inside a render, which cannot wait — so this reads what
   * loadSettings() last fetched and falls back to ten when it has fetched
   * nothing. The screens that draw a stock level wait for the settings
   * before they draw, which is arranged at the bottom of the inventory
   * section; the fallback is for the case where that request failed, and
   * costs a wrong threshold rather than a dead screen.
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
      return loadSettings().then(function () {
        var user = ZB.adminUser || {};

        return {
          store: stSection('store'),
          profile: {
            name: user.name || '',
            email: user.email || '',
            role: user.role || '',
            initials: user.initials || ''
          },
          notifications: stSection('notifications')
        };
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

      if (name !== 'store' && name !== 'notifications') {
        return Promise.reject({ message: 'There is no such settings group.' });
      }

      var body = {};
      body[name] = name === 'store' ? storeBody(values) : values || {};

      return Api.send('PATCH', '/api/admin/settings', body).then(function (result) {
        stCache = result.settings;
        stLoad = Promise.resolve();

        /* The threshold may have moved, and the screens that draw a stock
           level read it from the copy above. Nothing else caches it. */
        return stSection(name);
      });
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

    /**
     * Read one section again from the database.
     *
     * It used to mean "throw away this session's unsaved changes", which
     * was possible when the changes lived in this file. There is nothing
     * unsaved now — a save reaches the settings table or it fails — so what
     * is useful here is a fresh read, for a screen that has been open long
     * enough to be stale.
     */
    reset: function (name) {
      if (name === 'profile') {
        return Promise.reject({
          message: 'The profile is the signed-in account, not a saved setting.'
        });
      }
      if (name !== 'store' && name !== 'notifications') {
        return Promise.reject({ message: 'There is no such settings group.' });
      }

      forgetSettings();
      return loadSettings().then(function () { return stSection(name); });
    },

    /** Always false: every change above reaches the database. */
    isEdited: function () {
      return false;
    },

    hasUnsavedEdits: function () {
      return false;
    }
  };

  /**
   * The store form's field names, translated to the API's.
   *
   * The screen collects one flat set of boxes, because that is one card on
   * one form. The record keeps the two delivery numbers together under
   * `shipping`, because they are one rule and place_order reads them as
   * one. This is where the two shapes meet, so neither side has to learn
   * the other's.
   *
   * Only what the form sent is passed on. A caller changing the delivery
   * charge alone must not clear the shop's phone number, and the endpoint
   * merges on the same principle.
   */
  function storeBody(values) {
    var data = values || {};
    var has = function (key) {
      return Object.prototype.hasOwnProperty.call(data, key) && data[key] !== undefined;
    };

    var body = {};

    ['name', 'tagline', 'supportEmail', 'phone', 'address', 'city'].forEach(function (key) {
      if (has(key)) body[key] = data[key];
    });

    if (has('lowStockAt')) body.lowStockAt = Number(data.lowStockAt);

    var shipping = {};
    if (has('shippingFlat')) shipping.flat = Number(data.shippingFlat);
    if (has('shippingFreeOver')) shipping.freeOver = Number(data.shippingFreeOver);

    if (Object.keys(shipping).length) body.shipping = shipping;

    return body;
  }

  ZB.repo = Repo;

}(window.ZB));
