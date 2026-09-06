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
     Metrics
     ----------------------------------------------------------------------- */

  Repo.metrics = {

    /**
     * The small counters on the sidebar.
     *
     * Only the ones that can be answered honestly today are returned.
     * `orders` is absent until orders exist as data in their own phase —
     * an absent badge draws nothing, which is better than a number that
     * stands for nothing.
     */
    navBadges: function () {
      var outOfStock = ZB.catalogue.all().filter(function (p) {
        return !p.inStock;
      }).length;

      return Repo.defer({ inventory: outOfStock });
    }
  };

  ZB.repo = Repo;

}(window.ZB));
