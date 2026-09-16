/* =========================================================================
   scripts/demo-catalogue.js — the generator that makes the demo products
   -------------------------------------------------------------------------
   THIS IS NOT PART OF THE SHOP. It is loaded by scripts/seed.mjs and by
   nothing else, and .vercelignore keeps the whole of scripts/ off the
   deployment.

   WHERE IT CAME FROM, AND WHY IT MOVED HERE
   This was assets/js/catalogue.js until Phase 4. It expanded
   ZB.catalogueSeed across every leaf category in ZB.navigation and derived
   each product's price, colour, fabric, sizes and stock from a hash of its
   own id, so that a shop with no database still had something on every page.

   Phase 4 replaced the storefront's copy with one that loads the real
   products from /api/catalogue — correctly, because a shop should show its
   own stock rather than invent it. What nobody noticed was that seed.mjs was
   reading that same file to BUILD the demo catalogue. From that day
   `npm run seed:demo` generated zero products and said so in a line nobody
   read, and `npm run seed:demo:remove` deleted zero products while reporting
   success.

   So the generator lives here now, where demo content is made, and the
   storefront's file is free to be about the storefront. The two were only
   ever the same file by accident.

   NOTHING BELOW IS REAL
   Every value is derived from a hash of the product's own id. That makes the
   catalogue stable — the same product every run, so seed:demo:remove can
   recognise what seed:demo wrote — and it makes every price, colour and
   stock figure an invention. It is for filling a screen while the shop's
   owner has not yet entered their own stock, and for showing somebody what
   the interface does. It is removable in one command, on purpose.
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  var products = null;      /* built on first use */
  var byIdMap = {};
  var byCategoryMap = {};   /* 'men/polo' -> [product] */
  var byDeptMap = {};

  /* -----------------------------------------------------------------------
     Deterministic pseudo-randomness
     A product's every attribute is derived from its id, so the catalogue is
     stable without storing hundreds of literal objects.
     ----------------------------------------------------------------------- */

  /**
   * djb2 followed by a bit-mixing finalizer. The finalizer matters: ids in
   * one category differ only in their last character, and plain djb2 would
   * hand neighbouring products near-identical numbers — a row of products
   * all priced within ten rupees of each other.
   */
  function hash(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) {
      h = ((h << 5) + h) ^ str.charCodeAt(i);
    }

    h ^= h >>> 16;
    h = Math.imul(h, 2246822507);
    h ^= h >>> 13;
    h = Math.imul(h, 3266489909);
    h ^= h >>> 16;

    return h >>> 0;
  }

  /** A second, independent number from the same id. */
  function hashWith(str, salt) {
    return hash(salt + ':' + str);
  }

  function pick(list, n) {
    return list[n % list.length];
  }

  /**
   * The sizes one product is stocked in, chosen by the bits of its hash.
   *
   * This started out as a contiguous run, which looked more like real stock
   * but made the Size facet useless: every window through a five-size list
   * contains the middle size, so filtering by L returned the whole
   * catalogue. Picking by bit gives each size an independent chance to be
   * absent, which is what a filter needs to bite on.
   */
  function sizesFor(all, n) {
    var chosen = all.filter(function (size, i) { return (n >> i) & 1; });

    /* Never leave a product with nothing to buy. */
    if (chosen.length < 2) chosen = all.slice(0, 2 + (n % 2));

    return chosen;
  }

  /* -----------------------------------------------------------------------
     Building
     ----------------------------------------------------------------------- */

  /**
   * Flatten a department into the categories that actually hold products.
   * A category with children is a container: its own page shows everything
   * underneath it rather than a separate set of products.
   */
  function leavesOf(dept) {
    var leaves = [];

    dept.items.forEach(function (item) {
      if (item.children && item.children.length) {
        item.children.forEach(function (child) {
          leaves.push({ label: child.label, parent: item.label });
        });
      } else {
        leaves.push({ label: item.label, parent: null });
      }
    });

    return leaves;
  }

  function makeProduct(dept, config, leaf, index) {
    var ui = ZB.ui;
    var seed = ZB.catalogueSeed;

    var categorySlug = ui.slug(leaf.label);
    var id = dept.id + '-' + categorySlug + '-' + (index + 1);

    var n = hash(id);
    var n2 = hashWith(id, 'b');
    var n3 = hashWith(id, 'c');
    var n4 = hashWith(id, 'd');

    /* Price snapped to the nearest 10, the way retail pricing reads. */
    var span = config.price[1] - config.price[0];
    var price = Math.round((config.price[0] + (n % span)) / 10) * 10;

    var onSale = n2 % seed.saleEvery === 0;
    var compareAt = onSale ? Math.round((price * 1.4) / 10) * 10 : null;

    var badge = n3 % seed.badgeEvery === 0 ? pick(seed.badges, n) : null;

    /* Imagery comes from the category's own pool where it has one, then its
       parent's, and only then the department's garment photographs. Without
       this a perfume in Women's Fragrance was shown wearing a kaftan. */
    var poolName = seed.categoryPools[categorySlug] ||
                   (leaf.parent ? seed.categoryPools[ui.slug(leaf.parent)] : null);
    var pool = (poolName && seed.imagePools[poolName]) || config.images;

    var art = pick(pool, n2);

    return {
      id: id,
      title: pick(config.adjectives, n) + ' ' + leaf.label + ' - ' +
             config.code + (1000 + (n % 8999)),
      dept: dept.id,
      deptLabel: dept.label,
      category: categorySlug,
      categoryLabel: leaf.label,
      parentLabel: leaf.parent,
      price: price,
      compareAt: compareAt,
      badge: badge,
      colour: pick(config.colours, n3),
      colourHex: seed.colourHex[pick(config.colours, n3)] || '#cccccc',
      fabric: pick(config.fabrics, n4),
      sizes: sizesFor(config.sizes, n2),
      inStock: n4 % seed.outOfStockEvery !== 0,
      /* Stand-ins for the two orderings a real shop would take from its own
         records: how well a product sells, and when it was listed. */
      popularity: n3 % 1000,
      addedDaysAgo: n4 % 540,
      /* Two views, so the card can swap on hover the way the reference does. */
      images: [
        'assets/img/products/' + art + '-a.jpg',
        'assets/img/products/' + art + '-b.jpg'
      ],
      path: '/product/' + id
    };
  }

  function build() {
    products = [];
    byIdMap = {};
    byCategoryMap = {};
    byDeptMap = {};

    var seed = ZB.catalogueSeed;
    if (!seed || !ZB.navigation) return;

    ZB.navigation.forEach(function (dept) {
      var config = seed.departments[dept.id];
      if (!config) return;

      byDeptMap[dept.id] = [];

      leavesOf(dept).forEach(function (leaf) {
        var key = dept.id + '/' + ZB.ui.slug(leaf.label);
        var list = [];

        for (var i = 0; i < seed.perCategory; i++) {
          var product = makeProduct(dept, config, leaf, i);
          list.push(product);
          products.push(product);
          byIdMap[product.id] = product;
          byDeptMap[dept.id].push(product);
        }

        byCategoryMap[key] = list;
      });
    });
  }

  function ready() {
    if (!products) build();
    return products;
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
      ready();

      var words = String(term || '').toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) return [];

      return products.filter(function (p) {
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
    }
  };

  ZB.catalogue = Catalogue;

}(window.ZB));
