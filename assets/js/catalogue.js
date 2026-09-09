/* =========================================================================
   catalogue.js — the shop's products, and the questions pages ask of them
   -------------------------------------------------------------------------
   This file used to invent the catalogue. It expanded ZB.catalogueSeed
   across every leaf in the menu and derived each product's price, colour,
   fabric and stock from a hash of its own id, so that a shop with no
   database still had something on every page. That worked, and none of it
   was real.

   It now loads the products from /api/catalogue, which reads them from the
   database as an anonymous visitor — so what arrives here is exactly what a
   stranger is allowed to see. Drafts and archived products are not in it,
   because the read policy in db/policies.sql does not return them, not
   because anything in the browser filtered them out.

   WHAT DELIBERATELY DID NOT CHANGE
   Everything below the Queries heading. Category pages, search, facets,
   sorting and the wishlist all speak to this file through the same names
   they always have, over products with the same field names they always
   had — api/_lib/shape.js does the translating from database columns once,
   on the server, so that twenty thousand lines of interface do not have to
   learn a new vocabulary.

   THE WHOLE CATALOGUE ARRIVES AT ONCE, AND THAT IS A CHOICE WITH A LIMIT
   Filtering, faceting and sorting all happen here, in the browser, over the
   full list. That is what makes the filters instant and what makes them
   correct — a facet count is honest because it was counted over everything.
   It also means the response grows with the shop: around a quarter of a
   megabyte for five hundred products. Somewhere in the low thousands that
   becomes a real download and the filtering has to move to the server, one
   page at a time. api/catalogue.js says the same thing from its own side
   and refuses to serve more than five thousand.

   Query API — unchanged:
     ZB.catalogue.all()
     ZB.catalogue.byId(id)
     ZB.catalogue.byDept(deptId)
     ZB.catalogue.byCategory(deptId, categorySlug)   parent -> all children
     ZB.catalogue.search(term)
     ZB.catalogue.byIds(ids)                          wishlist order preserved
     ZB.catalogue.related(product, limit)

   New, and the only asynchronous thing here:
     ZB.catalogue.load()      a promise for the first load
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  var products = null;      /* null until loaded, then an array */
  var byIdMap = {};
  var byCategoryMap = {};   /* 'men/polo' -> [product] */
  var byDeptMap = {};
  var pending = null;       /* the in-flight load, so two callers share one */

  /* -----------------------------------------------------------------------
     Indexing
     ----------------------------------------------------------------------- */

  /**
   * Build the three lookups every query below depends on.
   *
   * The category key is the product's own department and category slug
   * joined, which is the same key the old build() produced from the menu
   * tree — deliberately, because byCategory() falls back to walking
   * ZB.navigation and turning a child's label into a slug when it is asked
   * for a parent category. That fallback only lines up because the server
   * derives its slugs with the same rules ZB.ui.slug uses; api/_lib/rows.js
   * says so at the top of slugify().
   */
  function index(list) {
    products = list;
    byIdMap = {};
    byCategoryMap = {};
    byDeptMap = {};

    products.forEach(function (p) {
      byIdMap[p.id] = p;

      (byDeptMap[p.dept] = byDeptMap[p.dept] || []).push(p);

      var key = p.dept + '/' + p.category;
      (byCategoryMap[key] = byCategoryMap[key] || []).push(p);
    });
  }

  /* -----------------------------------------------------------------------
     Loading
     ----------------------------------------------------------------------- */

  /**
   * Fetch the catalogue once.
   *
   * Called by assets/js/bootstrap.js before the router starts, so that the
   * first page rendered has products on it rather than an empty state that
   * fills in a moment later. Repeat calls return the same promise instead of
   * a second request.
   *
   * A failure rejects rather than resolving to an empty catalogue, because
   * "the shop has nothing in it" and "the shop could not be reached" are
   * different things and the caller is the one placed to say which happened.
   */
  function load() {
    if (pending) return pending;

    pending = fetch('/api/catalogue', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin'
    }).then(function (res) {
      if (!res.ok) {
        throw new Error('The catalogue could not be loaded (' + res.status + ').');
      }
      return res.json();
    }).then(function (payload) {
      if (!payload || !payload.ok || !payload.data) {
        throw new Error('The catalogue came back in a shape this page did not expect.');
      }

      index(payload.data.products || []);
      return products;
    }).catch(function (err) {
      /* Clear the memo so a later attempt — a retry, a second page view in
         the same session — is a fresh request rather than the same failure
         handed out again. */
      pending = null;
      throw err;
    });

    return pending;
  }

  /**
   * The loaded products, or an empty list.
   *
   * Every query below calls this and none of them wait. The catalogue is
   * loaded before the router starts, so by the time a page asks, the answer
   * is there; and if the load failed, an empty catalogue is what the pages'
   * existing "nothing found" states are for.
   */
  function ready() {
    return products || [];
  }

  /* -----------------------------------------------------------------------
     Queries
     ----------------------------------------------------------------------- */

  var Catalogue = {

    all: function () {
      return ready().slice();
    },

    byId: function (id) {
      ready();
      return byIdMap[id] || null;
    },

    byDept: function (deptId) {
      ready();
      return (byDeptMap[deptId] || []).slice();
    },

    /**
     * Products for one category slug. A container category (one with
     * children in the navigation) returns everything beneath it.
     */
    byCategory: function (deptId, categorySlug) {
      ready();

      var direct = byCategoryMap[deptId + '/' + categorySlug];
      if (direct) return direct.slice();

      var dept = ZB.ui.findDept(deptId);
      if (!dept) return [];

      var parent = dept.items.filter(function (item) {
        return ZB.ui.slug(item.label) === categorySlug;
      })[0];

      if (!parent || !parent.children) return [];

      return parent.children.reduce(function (out, child) {
        return out.concat(byCategoryMap[deptId + '/' + ZB.ui.slug(child.label)] || []);
      }, []);
    },

    /** Word match across title, category, department and colour. */
    search: function (term) {
      var list = ready();

      var words = String(term || '').toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) return [];

      return list.filter(function (p) {
        var haystack = (
          p.title + ' ' + p.categoryLabel + ' ' + (p.parentLabel || '') + ' ' +
          p.deptLabel + ' ' + p.colour
        ).toLowerCase();

        return words.every(function (w) { return haystack.indexOf(w) > -1; });
      });
    },

    /** Resolve a list of ids, keeping the order they were saved in. */
    byIds: function (ids) {
      ready();
      return (ids || []).map(function (id) { return byIdMap[id]; })
                        .filter(Boolean);
    },

    /* -------------------------------------------------------------------
       Faceting and ordering
       Both take a list rather than a query, so a category page and the
       search results page filter and sort through exactly the same code.
       ------------------------------------------------------------------- */

    /**
     * The values a set of products actually offers, with a count each, so a
     * facet never lists an option that would return nothing.
     */
    facetsFor: function (products) {
      var slug = ZB.ui.slug;

      var tally = function (getValues) {
        var seen = {};
        products.forEach(function (p) {
          getValues(p).forEach(function (label) {
            /* COLOUR AND FABRIC ARE OPTIONAL, AND WERE NOT
               Every product in the generated catalogue had both, so a facet
               was always a real value. A product added through the panel
               may have neither, and the null went in as a facet option
               whose label could not be sorted. There is no "no colour"
               filter and there should not be — a facet lists the values on
               offer, and "none" is not one of them. */
            if (label === null || label === undefined || label === '') return;

            var key = slug(label);
            if (!seen[key]) seen[key] = { value: key, label: label, count: 0 };
            seen[key].count++;
          });
        });
        return Object.keys(seen)
          .map(function (k) { return seen[k]; })
          .sort(function (a, b) { return a.label.localeCompare(b.label); });
      };

      var prices = products.map(function (p) { return p.price; });

      return {
        size:   tally(function (p) { return p.sizes; }),
        colour: tally(function (p) { return [p.colour]; }),
        fabric: tally(function (p) { return [p.fabric]; }),
        stock: [
          { value: 'in',  label: 'In stock',     count: products.filter(function (p) { return p.inStock; }).length },
          { value: 'out', label: 'Out of stock', count: products.filter(function (p) { return !p.inStock; }).length }
        ].filter(function (o) { return o.count > 0; }),
        price: {
          min: prices.length ? Math.min.apply(null, prices) : 0,
          max: prices.length ? Math.max.apply(null, prices) : 0
        }
      };
    },

    /**
     * Narrow a list. Every criterion is optional; within one facet the
     * chosen values are an OR, and the facets are ANDed together — which is
     * how shoppers expect filters to behave.
     */
    applyFilters: function (products, criteria) {
      var slug = ZB.ui.slug;
      criteria = criteria || {};

      var has = function (list) { return list && list.length; };

      return products.filter(function (p) {
        if (has(criteria.size)) {
          var sizes = p.sizes.map(slug);
          if (!criteria.size.some(function (s) { return sizes.indexOf(s) > -1; })) return false;
        }

        if (has(criteria.colour) && criteria.colour.indexOf(slug(p.colour)) === -1) return false;
        if (has(criteria.fabric) && criteria.fabric.indexOf(slug(p.fabric)) === -1) return false;

        if (has(criteria.stock)) {
          var want = p.inStock ? 'in' : 'out';
          if (criteria.stock.indexOf(want) === -1) return false;
        }

        if (criteria.min != null && p.price < criteria.min) return false;
        if (criteria.max != null && p.price > criteria.max) return false;

        return true;
      });
    },

    /** Orderings offered in the sort menu, in the order they are listed. */
    sorts: [
      { value: 'featured',     label: 'Featured' },
      { value: 'best-selling', label: 'Best selling' },
      { value: 'a-z',          label: 'Alphabetically, A-Z' },
      { value: 'z-a',          label: 'Alphabetically, Z-A' },
      { value: 'price-asc',    label: 'Price, low to high' },
      { value: 'price-desc',   label: 'Price, high to low' },
      { value: 'date-old',     label: 'Date, old to new' },
      { value: 'date-new',     label: 'Date, new to old' }
    ],

    /** Never sorts in place — the caller's list keeps its own order. */
    applySort: function (products, key) {
      var out = products.slice();

      switch (key) {
        case 'best-selling':
          return out.sort(function (a, b) { return b.popularity - a.popularity; });
        case 'a-z':
          return out.sort(function (a, b) { return a.title.localeCompare(b.title); });
        case 'z-a':
          return out.sort(function (a, b) { return b.title.localeCompare(a.title); });
        case 'price-asc':
          return out.sort(function (a, b) { return a.price - b.price; });
        case 'price-desc':
          return out.sort(function (a, b) { return b.price - a.price; });
        case 'date-new':
          return out.sort(function (a, b) { return a.addedDaysAgo - b.addedDaysAgo; });
        case 'date-old':
          return out.sort(function (a, b) { return b.addedDaysAgo - a.addedDaysAgo; });
        default:
          return out;   /* 'featured' is the catalogue's own order */
      }
    },

    related: function (product, limit) {
      if (!product) return [];
      return Catalogue.byCategory(product.dept, product.category)
        .filter(function (p) { return p.id !== product.id; })
        .slice(0, limit || 4);
    },

    /**
     * Load the catalogue. The one asynchronous thing in this file, and the
     * only method a page should not call — assets/js/bootstrap.js awaits it
     * before the router starts so that no page has to.
     */
    load: load
  };

  ZB.catalogue = Catalogue;

}(window.ZB));
