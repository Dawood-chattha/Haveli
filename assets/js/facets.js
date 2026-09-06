/* =========================================================================
   facets.js — the filter and sort toolbar above a product listing
   -------------------------------------------------------------------------
   Used by both the category pages and the search results page.

     ZB.facets.init({ root, gridRoot, products })

   The chosen filters live in the URL's query string, so a filtered listing
   survives a refresh and can be pasted to someone else:

     /category/men/polo?size=m,l&colour=navy&sort=price-asc

   The URL is updated with replaceState rather than pushState. Filters are
   adjusted a tick at a time, and pushing an entry per checkbox would mean
   pressing Back five times to leave a listing. The trade is deliberate:
   refresh and sharing work, Back leaves the page rather than rewinding the
   filters one by one.

   Changing a filter repaints only the grid, the count and the chips, so a
   panel stays open while several boxes are ticked. Arriving at the page
   fresh (or through Back/Forward) goes through the router, which re-mounts
   the page and reads the query again.

   The same markup serves both layouts: on desktop each facet is a popover
   under its trigger, and below 750px the whole group becomes a drawer.
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  /* Facets that are simple value lists. Price is handled separately. */
  var LISTS = [
    { key: 'size',   label: 'Size' },
    { key: 'colour', label: 'Colors' },
    { key: 'fabric', label: 'Fabric' },
    { key: 'stock',  label: 'Availability' }
  ];

  /* -----------------------------------------------------------------------
     URL <-> state
     ----------------------------------------------------------------------- */

  function readState() {
    var params = new URLSearchParams(window.location.search);
    var list = function (key) {
      var raw = params.get(key);
      return raw ? raw.split(',').filter(Boolean) : [];
    };
    var num = function (key) {
      var raw = params.get(key);
      return raw === null || raw === '' ? null : Number(raw);
    };

    return {
      criteria: {
        size: list('size'),
        colour: list('colour'),
        fabric: list('fabric'),
        stock: list('stock'),
        min: num('min'),
        max: num('max')
      },
      sort: params.get('sort') || 'featured'
    };
  }

  /** Rewrite the query string, preserving anything we do not own (like q=). */
  function writeState(state) {
    var params = new URLSearchParams(window.location.search);

    LISTS.forEach(function (f) {
      var values = state.criteria[f.key];
      if (values && values.length) params.set(f.key, values.join(','));
      else params.delete(f.key);
    });

    ['min', 'max'].forEach(function (key) {
      var v = state.criteria[key];
      if (v == null || v === '') params.delete(key);
      else params.set(key, v);
    });

    if (state.sort && state.sort !== 'featured') params.set('sort', state.sort);
    else params.delete('sort');

    var qs = params.toString();
    var url = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
    window.history.replaceState(window.history.state, '', url);
  }

  function activeCount(criteria) {
    var n = LISTS.reduce(function (sum, f) {
      return sum + (criteria[f.key] ? criteria[f.key].length : 0);
    }, 0);
    if (criteria.min != null) n++;
    if (criteria.max != null) n++;
    return n;
  }

  /* -----------------------------------------------------------------------
     Markup
     ----------------------------------------------------------------------- */

  var icons = {
    chevron: '<svg class="facet__chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };

  function optionRows(facetKey, options, chosen) {
    var esc = ZB.ui.esc;

    return options.map(function (o) {
      var on = chosen.indexOf(o.value) > -1;
      return '' +
        '<label class="facet__option">' +
          '<input type="checkbox" data-facet-input="' + facetKey + '"' +
                 ' value="' + esc(o.value) + '"' + (on ? ' checked' : '') + '>' +
          '<span class="facet__option-label">' + esc(o.label) + '</span>' +
          '<span class="facet__option-count">' + o.count + '</span>' +
        '</label>';
    }).join('');
  }

  function priceFields(facets, criteria) {
    var money = function (n) { return Number(n || 0).toLocaleString('en-PK'); };

    return '' +
      '<div class="facet__price">' +
        '<label class="facet__price-field">' +
          '<span class="facet__price-prefix">PKR</span>' +
          '<input type="number" inputmode="numeric" data-facet-price="min"' +
                 ' placeholder="' + facets.price.min + '" min="0"' +
                 ' value="' + (criteria.min == null ? '' : criteria.min) + '">' +
        '</label>' +
        '<span class="facet__price-to">to</span>' +
        '<label class="facet__price-field">' +
          '<span class="facet__price-prefix">PKR</span>' +
          '<input type="number" inputmode="numeric" data-facet-price="max"' +
                 ' placeholder="' + facets.price.max + '" min="0"' +
                 ' value="' + (criteria.max == null ? '' : criteria.max) + '">' +
        '</label>' +
      '</div>' +
      '<p class="facet__hint">The highest price is PKR ' + money(facets.price.max) + '</p>';
  }

  function facetBlock(key, label, body, chosenCount) {
    return '' +
      '<div class="facet" data-facet="' + key + '">' +
        '<button class="facet__trigger" type="button"' +
                ' aria-expanded="false" aria-controls="facet-panel-' + key + '">' +
          ZB.ui.esc(label) +
          (chosenCount ? '<span class="facet__badge">' + chosenCount + '</span>' : '') +
          icons.chevron +
        '</button>' +
        '<div class="facet__panel" id="facet-panel-' + key + '" hidden>' +
          '<div class="facet__body">' + body + '</div>' +
          '<div class="facet__foot">' +
            '<button class="facet__clear" type="button" data-facet-clear="' + key + '">Clear</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function sortBlock(sort) {
    var esc = ZB.ui.esc;
    var current = ZB.catalogue.sorts.filter(function (s) { return s.value === sort; })[0]
                  || ZB.catalogue.sorts[0];

    var rows = ZB.catalogue.sorts.map(function (s) {
      return '' +
        '<label class="facet__option">' +
          '<input type="radio" name="zb-sort" data-facet-sort value="' + s.value + '"' +
                 (s.value === sort ? ' checked' : '') + '>' +
          '<span class="facet__option-label">' + esc(s.label) + '</span>' +
        '</label>';
    }).join('');

    return '' +
      '<div class="facet facet--sort" data-facet="sort">' +
        '<button class="facet__trigger" type="button"' +
                ' aria-expanded="false" aria-controls="facet-panel-sort">' +
          'Sort<span class="facet__current">' + esc(current.label) + '</span>' +
          icons.chevron +
        '</button>' +
        '<div class="facet__panel facet__panel--right" id="facet-panel-sort" hidden>' +
          '<div class="facet__body">' + rows + '</div>' +
        '</div>' +
      '</div>';
  }

  function chipsBlock(state, facets) {
    var esc = ZB.ui.esc;
    var chips = [];

    LISTS.forEach(function (f) {
      (state.criteria[f.key] || []).forEach(function (value) {
        var option = (facets[f.key] || []).filter(function (o) { return o.value === value; })[0];
        chips.push(
          '<button class="chip chip--active" type="button"' +
                  ' data-facet-remove="' + f.key + '" data-value="' + esc(value) + '">' +
            esc(option ? option.label : value) + icons.close +
          '</button>'
        );
      });
    });

    if (state.criteria.min != null || state.criteria.max != null) {
      var from = state.criteria.min == null ? facets.price.min : state.criteria.min;
      var to = state.criteria.max == null ? facets.price.max : state.criteria.max;
      chips.push(
        '<button class="chip chip--active" type="button" data-facet-remove="price">' +
          'PKR ' + Number(from).toLocaleString('en-PK') +
          ' – ' + Number(to).toLocaleString('en-PK') + icons.close +
        '</button>'
      );
    }

    if (!chips.length) return '';

    return '' +
      '<div class="facets__chips">' +
        chips.join('') +
        '<button class="facets__clear-all" type="button" data-facet-clear-all>Clear all</button>' +
      '</div>';
  }

  /* -----------------------------------------------------------------------
     Component
     ----------------------------------------------------------------------- */

  var Facets = {

    init: function (options) {
      var root = options.root;
      var gridRoot = options.gridRoot;
      var all = options.products || [];

      if (!root || !gridRoot) return;

      var state = readState();

      /* Counts come from the unfiltered list, so an option never vanishes
         just because another facet is currently narrowing the results. */
      var facets = ZB.catalogue.facetsFor(all);

      var results = function () {
        return ZB.catalogue.applySort(
          ZB.catalogue.applyFilters(all, state.criteria),
          state.sort
        );
      };

      /* ---- painting ---- */

      var paintGrid = function () {
        var list = results();

        ZB.productCard.mount(gridRoot, list, {
          empty: ZB.ui.emptyState({
            title: 'Nothing matches those filters',
            body: 'Try removing one of them, or clear them all.',
            ctaLabel: 'Clear all filters',
            ctaHref: window.location.pathname
          })
        });

        var count = root.querySelector('.facets__count');
        if (count) {
          count.textContent = list.length + ' item' + (list.length === 1 ? '' : 's');
        }
      };

      var paintChips = function () {
        var existing = root.querySelector('.facets__chips');
        var markup = chipsBlock(state, facets);

        if (existing) existing.remove();
        if (markup) root.insertAdjacentHTML('beforeend', markup);
      };

      /** Trigger labels and the little count badge on each facet. */
      var paintTriggers = function () {
        LISTS.concat([{ key: 'price' }]).forEach(function (f) {
          var block = root.querySelector('[data-facet="' + f.key + '"]');
          if (!block) return;

          var chosen = f.key === 'price'
            ? (state.criteria.min != null || state.criteria.max != null ? 1 : 0)
            : (state.criteria[f.key] || []).length;

          var badge = block.querySelector('.facet__badge');
          if (chosen && !badge) {
            block.querySelector('.facet__trigger')
                 .insertAdjacentHTML('afterbegin', '<span class="facet__badge">' + chosen + '</span>');
          } else if (chosen && badge) {
            badge.textContent = chosen;
          } else if (!chosen && badge) {
            badge.remove();
          }

          block.classList.toggle('is-filtered', !!chosen);
        });

        var current = root.querySelector('.facet--sort .facet__current');
        if (current) {
          var s = ZB.catalogue.sorts.filter(function (o) { return o.value === state.sort; })[0];
          current.textContent = s ? s.label : 'Featured';
        }
      };

      var apply = function () {
        writeState(state);
        paintGrid();
        paintChips();
        paintTriggers();
      };

      /* ---- first render ---- */

      var listBlocks = LISTS.map(function (f) {
        var options = facets[f.key] || [];
        if (!options.length) return '';
        return facetBlock(
          f.key, f.label,
          optionRows(f.key, options, state.criteria[f.key] || []),
          (state.criteria[f.key] || []).length
        );
      }).join('');

      var priceBlock = facets.price.max > facets.price.min
        ? facetBlock('price', 'Price', priceFields(facets, state.criteria),
                     (state.criteria.min != null || state.criteria.max != null) ? 1 : 0)
        : '';

      root.className = 'facets';
      root.innerHTML =
        '<div class="facets__bar">' +
          '<button class="facets__toggle" type="button" aria-expanded="false">' +
            'Filter' +
          '</button>' +

          '<div class="facets__groups" id="facet-groups">' +
            '<div class="facets__groups-head">' +
              '<span>Filter</span>' +
              '<button class="facets__groups-close" type="button" aria-label="Close filters">' +
                icons.close +
              '</button>' +
            '</div>' +
            priceBlock + listBlocks +
          '</div>' +

          '<p class="facets__count" role="status">' + all.length + ' items</p>' +
          sortBlock(state.sort) +
        '</div>';

      paintGrid();
      paintChips();

      /* ---- behaviour ---- */

      var closePanels = function (except) {
        ZB.util.all('.facet', root).forEach(function (block) {
          if (block === except) return;
          var panel = block.querySelector('.facet__panel');
          var trigger = block.querySelector('.facet__trigger');
          if (panel) panel.hidden = true;
          if (trigger) trigger.setAttribute('aria-expanded', 'false');
        });
      };

      var drawer = root.querySelector('.facets__groups');

      var setDrawer = function (open) {
        root.classList.toggle('is-drawer-open', open);
        var toggle = root.querySelector('.facets__toggle');
        if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        ZB.util.lockScroll(open);

        var overlay = document.getElementById('overlay');
        if (overlay) overlay.classList.toggle('is-open', open);

        if (open && drawer) {
          var first = drawer.querySelector('button, input');
          if (first) requestAnimationFrame(function () { first.focus(); });
        }
      };

      root.addEventListener('click', function (e) {
        var target = e.target;

        if (target.closest('.facets__toggle')) { setDrawer(true); return; }
        if (target.closest('.facets__groups-close')) { setDrawer(false); return; }

        var trigger = target.closest('.facet__trigger');
        if (trigger) {
          var block = trigger.closest('.facet');
          var panel = block.querySelector('.facet__panel');
          var open = panel.hidden;
          closePanels(block);
          panel.hidden = !open;
          trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
          return;
        }

        var clear = target.closest('[data-facet-clear]');
        if (clear) {
          var key = clear.getAttribute('data-facet-clear');
          if (key === 'price') { state.criteria.min = null; state.criteria.max = null; }
          else state.criteria[key] = [];

          ZB.util.all('[data-facet-input="' + key + '"]', root)
            .forEach(function (i) { i.checked = false; });
          ZB.util.all('[data-facet-price]', root)
            .forEach(function (i) { if (key === 'price') i.value = ''; });

          apply();
          return;
        }

        var remove = target.closest('[data-facet-remove]');
        if (remove) {
          var rkey = remove.getAttribute('data-facet-remove');
          if (rkey === 'price') {
            state.criteria.min = null;
            state.criteria.max = null;
            ZB.util.all('[data-facet-price]', root).forEach(function (i) { i.value = ''; });
          } else {
            var value = remove.getAttribute('data-value');
            state.criteria[rkey] = state.criteria[rkey].filter(function (v) { return v !== value; });
            var box = root.querySelector('[data-facet-input="' + rkey + '"][value="' + value + '"]');
            if (box) box.checked = false;
          }
          apply();
          return;
        }

        if (target.closest('[data-facet-clear-all]')) {
          LISTS.forEach(function (f) { state.criteria[f.key] = []; });
          state.criteria.min = null;
          state.criteria.max = null;
          ZB.util.all('input[type="checkbox"]', root).forEach(function (i) { i.checked = false; });
          ZB.util.all('[data-facet-price]', root).forEach(function (i) { i.value = ''; });
          apply();
          return;
        }

        /* A click anywhere else inside a panel must not close it. */
        if (!target.closest('.facet__panel')) closePanels(null);
      });

      root.addEventListener('change', function (e) {
        var box = e.target.closest('[data-facet-input]');
        if (box) {
          var key = box.getAttribute('data-facet-input');
          var values = state.criteria[key].slice();
          if (box.checked) values.push(box.value);
          else values = values.filter(function (v) { return v !== box.value; });
          state.criteria[key] = values;
          apply();
          return;
        }

        var sort = e.target.closest('[data-facet-sort]');
        if (sort) {
          state.sort = sort.value;
          closePanels(null);
          apply();
          return;
        }

        var price = e.target.closest('[data-facet-price]');
        if (price) {
          var raw = price.value.trim();
          state.criteria[price.getAttribute('data-facet-price')] =
            raw === '' ? null : Number(raw);
          apply();
        }
      });

      /* Outside click and Escape both put the popovers away. */
      var onDocClick = function (e) {
        if (!root.contains(e.target)) closePanels(null);
      };
      var onKey = function (e) {
        if (e.key !== 'Escape') return;
        if (root.classList.contains('is-drawer-open')) setDrawer(false);
        closePanels(null);
      };

      document.addEventListener('click', onDocClick);
      document.addEventListener('keydown', onKey);

      var overlay = document.getElementById('overlay');
      var onOverlay = function () {
        if (root.classList.contains('is-drawer-open')) setDrawer(false);
      };
      if (overlay) overlay.addEventListener('click', onOverlay);

      /* The listeners above live on document, so they outlast the markup
         they serve. Drop them the moment the route swaps this page out. */
      var release = function () {
        if (document.body.contains(root)) return;
        document.removeEventListener('click', onDocClick);
        document.removeEventListener('keydown', onKey);
        if (overlay) overlay.removeEventListener('click', onOverlay);
        document.removeEventListener('zb:navigated', release);
        ZB.util.lockScroll(false);
      };
      document.addEventListener('zb:navigated', release);
    }
  };

  ZB.facets = Facets;

}(window.ZB));
