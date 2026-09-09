/* =========================================================================
   pages/products.js — the product list
   -------------------------------------------------------------------------
   Search, filter, sort and paging over everything the store sells, with the
   controls to add, edit and delete.

   STATE LIVES IN THE URL
   Search, filters, sort and page are held in the query string and written
   with replaceState, the same way the storefront's collection filters work.
   Refreshing keeps the view, and a filtered list can be handed to someone
   else as a link. The trade-off is deliberate and worth naming: because it
   replaces rather than pushes, Back leaves the page instead of undoing the
   last filter. Pushing instead would bury the way out of the section under
   a dozen history entries.

   Applied from the UI guidance consulted for this screen:
     - Deleting asks first, in a dialog that names the product, and the
       confirmation offers an undo (#35, high).
     - An empty result is never a blank panel: no matches offers a way to
       clear the filters, and a genuinely empty catalogue offers the way to
       add the first product (#79, #90).
     - Refreshing holds the previous rows at reduced opacity rather than
       collapsing the table, so nothing below it jumps (#19, #78).
     - Every write says so afterwards (#83).
     - Filter chips wrap; they are never clipped into one row (#115).
   ========================================================================= */

window.ZB = window.ZB || {};
window.ZB.adminPages = window.ZB.adminPages || {};

(function (ZB) {
  'use strict';

  var ui = ZB.adminUI;
  var PER_PAGE = 12;

  var state = { q: '', dept: '', category: '', status: '', sort: 'newest', page: 1 };
  var facets = null;
  var lastResult = null;

  /* -----------------------------------------------------------------------
     URL state
     ----------------------------------------------------------------------- */

  function readState(params) {
    var query = (params && params.query) || {};
    state = {
      q: query.q || '',
      dept: query.dept || '',
      /* Arrives by link from the category list rather than from a control
         here. There is no category select: the catalogue has over a hundred
         of them, and a select that long is a worse way in than the screen
         that already lists them with their counts. It still gets a chip, so
         it is visible and removable like every other filter. */
      category: query.category || '',
      status: query.status || '',
      sort: query.sort || 'newest',
      page: Math.max(1, parseInt(query.page, 10) || 1)
    };
  }

  function writeState() {
    var parts = [];
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.dept) parts.push('dept=' + encodeURIComponent(state.dept));
    if (state.category) parts.push('category=' + encodeURIComponent(state.category));
    if (state.status) parts.push('status=' + encodeURIComponent(state.status));
    if (state.sort && state.sort !== 'newest') parts.push('sort=' + state.sort);
    if (state.page > 1) parts.push('page=' + state.page);

    var url = '/admin/products' + (parts.length ? '?' + parts.join('&') : '');
    if (window.history.replaceState) window.history.replaceState({}, '', url);
  }

  function hasFilters() {
    return !!(state.q || state.dept || state.category || state.status);
  }

  /* -----------------------------------------------------------------------
     Page
     ----------------------------------------------------------------------- */

  ZB.adminPages.products = {

    title: 'Products',
    crumbs: [{ label: 'Products' }],

    render: function () {
      return '' +
        ui.pageHead({
          title: 'Products',
          sub: 'Everything listed in the store.',
          actions:
            '<a class="a-btn a-btn--primary" href="' + ui.href('/admin/products/new') + '">' +
              ui.icon('box') + 'Add product' +
            '</a>'
        }) +

        '<div class="a-card">' +

          '<div class="a-toolbar">' +
            '<div class="a-search">' +
              '<label class="visually-hidden" for="a-prod-search">Search products</label>' +
              '<span class="a-search__icon" aria-hidden="true">' + ui.icon('search') + '</span>' +
              '<input class="a-search__input" id="a-prod-search" type="search"' +
                    ' placeholder="Search by name, SKU or category" autocomplete="off">' +
            '</div>' +

            '<div class="a-toolbar__selects" id="a-prod-selects">' +
              /* Filled from the data once the facets arrive, so the options
                 can never name a department the catalogue does not have. */
            '</div>' +
          '</div>' +

          '<div class="a-chips" id="a-prod-chips" hidden></div>' +

          '<div class="a-resultbar">' +
            '<p class="a-resultbar__count" id="a-prod-count" role="status"></p>' +
            '<p class="a-resultbar__note" id="a-prod-note" hidden></p>' +
          '</div>' +

          '<div class="a-card__body a-card__body--flush" id="a-prod-body" aria-busy="true">' +
            '<div class="a-skeleton" aria-hidden="true">' +
              new Array(7).join('|').split('|').map(function () {
                return '<div class="a-skeleton__row"></div>';
              }).join('') +
            '</div>' +
          '</div>' +

          '<div class="a-pager" id="a-prod-pager" hidden></div>' +

        '</div>';
    },

    mount: function (params) {
      var body = document.getElementById('a-prod-body');
      if (!body) return;

      readState(params);
      lastResult = null;

      var search = document.getElementById('a-prod-search');
      search.value = state.q;

      /* Waiting for a pause in typing rather than querying every keystroke. */
      search.addEventListener('input', ZB.util.debounce(function () {
        state.q = search.value.trim();
        state.page = 1;
        writeState();
        load();
      }, 250));

      document.addEventListener('click', onClick);
      document.addEventListener('change', onChange);

      ZB.repo.products.facets().then(function (result) {
        if (!document.body.contains(body)) return;
        facets = result;
        paintSelects();
        /* The chips are drawn by load(), which may well have finished
           first — and without the facets it can only label a filter with
           its raw slug ("summer-pret"). Repainting them here is what turns
           that into the name the reader chose. */
        paintChips();
      });

      load();

      /* The listeners outlive this page unless they retire themselves. The
         router fires zb:navigated at the end of the render that mounted
         this page, so unsubscribing on that event would cancel immediately;
         checking that the markup is still in the document is what works. */
      function gone() {
        if (document.body.contains(body)) return false;
        document.removeEventListener('click', onClick);
        document.removeEventListener('change', onChange);
        return true;
      }

      function onChange(e) {
        if (gone()) return;
        var select = e.target.closest('[data-filter]');
        if (!select) return;

        state[select.getAttribute('data-filter')] = select.value;
        state.page = 1;
        writeState();
        load();
      }

      function onClick(e) {
        if (gone()) return;

        var chip = e.target.closest('[data-chip-clear]');
        if (chip) {
          state[chip.getAttribute('data-chip-clear')] = '';
          if (chip.getAttribute('data-chip-clear') === 'q') search.value = '';
          state.page = 1;
          writeState();
          load();
          return;
        }

        if (e.target.closest('[data-clear-all]')) {
          state.q = ''; state.dept = ''; state.category = '';
          state.status = ''; state.page = 1;
          search.value = '';
          writeState();
          load();
          return;
        }

        var pageButton = e.target.closest('[data-page]');
        if (pageButton) {
          state.page = Number(pageButton.getAttribute('data-page'));
          writeState();
          load();
          /* A new page starts at its top, not halfway down the old one. */
          window.scrollTo({ top: 0, behavior: ZB.reduceMotion ? 'auto' : 'smooth' });
          return;
        }

        var del = e.target.closest('[data-delete]');
        if (del) {
          confirmDelete(del.getAttribute('data-delete'), del.getAttribute('data-title'));
        }
      }
    }
  };

  /* -----------------------------------------------------------------------
     Loading
     ----------------------------------------------------------------------- */

  function load() {
    var body = document.getElementById('a-prod-body');
    if (!body) return;

    body.setAttribute('aria-busy', 'true');
    /* Hold what is already there instead of tearing it down, so the page
       below the table does not jump while the next page arrives. */
    if (lastResult) body.classList.add('is-refreshing');

    ZB.repo.products.list({
      search: state.q,
      dept: state.dept,
      category: state.category,
      status: state.status,
      sort: state.sort,
      page: state.page,
      perPage: PER_PAGE
    }).then(function (result) {
      if (!document.body.contains(body)) return;

      lastResult = result;
      paintChips();
      paintCount(result);
      paintTable(result);
      paintPager(result);

      body.classList.remove('is-refreshing');
      body.setAttribute('aria-busy', 'false');
    });
  }

  /* -----------------------------------------------------------------------
     Painting
     ----------------------------------------------------------------------- */

  function select(o) {
    var options = [{ id: '', label: o.anyLabel }].concat(o.options).map(function (item) {
      return '<option value="' + ui.esc(item.id) + '"' +
             (item.id === o.value ? ' selected' : '') + '>' +
             ui.esc(item.label) + '</option>';
    }).join('');

    return '' +
      '<span class="a-select">' +
        '<label class="visually-hidden" for="' + o.id + '">' + ui.esc(o.label) + '</label>' +
        '<select class="a-select__input" id="' + o.id + '" data-filter="' + o.name + '">' +
          options +
        '</select>' +
        '<span class="a-select__arrow" aria-hidden="true">' + ui.icon('chevron') + '</span>' +
      '</span>';
  }

  function paintSelects() {
    var host = document.getElementById('a-prod-selects');
    if (!host || !facets) return;

    host.innerHTML =
      select({
        id: 'a-prod-dept', name: 'dept', label: 'Department',
        anyLabel: 'All departments', options: facets.departments, value: state.dept
      }) +
      select({
        id: 'a-prod-status', name: 'status', label: 'Status',
        anyLabel: 'All statuses', options: facets.statuses, value: state.status
      }) +
      select({
        id: 'a-prod-sort', name: 'sort', label: 'Sort by',
        anyLabel: 'Newest first',
        options: ZB.repo.products.sorts.filter(function (s) { return s.id !== 'newest'; }),
        value: state.sort === 'newest' ? '' : state.sort
      });
  }

  function labelFor(list, id) {
    var hit = (list || []).filter(function (item) { return item.id === id; })[0];
    return hit ? hit.label : id;
  }

  function paintChips() {
    var host = document.getElementById('a-prod-chips');
    if (!host) return;

    var chips = [];

    if (state.q) {
      chips.push({ key: 'q', label: 'Search: ' + state.q });
    }
    if (state.dept) {
      chips.push({ key: 'dept', label: labelFor(facets && facets.departments, state.dept) });
    }
    if (state.category) {
      chips.push({
        key: 'category',
        label: 'In ' + labelFor(facets && facets.categories, state.category)
      });
    }
    if (state.status) {
      chips.push({ key: 'status', label: labelFor(facets && facets.statuses, state.status) });
    }

    if (!chips.length) {
      host.hidden = true;
      host.innerHTML = '';
      return;
    }

    host.hidden = false;
    host.innerHTML = chips.map(function (chip) {
      return '<button class="a-chip" type="button" data-chip-clear="' + chip.key + '">' +
               '<span class="a-chip__label">' + ui.esc(chip.label) + '</span>' +
               '<span class="a-chip__x" aria-hidden="true">' +
                 '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>' +
               '</span>' +
               '<span class="visually-hidden"> — remove this filter</span>' +
             '</button>';
    }).join('') +
    '<button class="a-chip a-chip--clear" type="button" data-clear-all>Clear all</button>';
  }

  function paintCount(result) {
    var count = document.getElementById('a-prod-count');
    var note = document.getElementById('a-prod-note');
    if (!count) return;

    var from = (result.page - 1) * result.perPage + 1;
    var to = Math.min(result.page * result.perPage, result.total);

    count.textContent = result.total
      ? 'Showing ' + from + '–' + to + ' of ' + result.total + ' products'
      : 'No products found';

    /* Says plainly that edits are not going anywhere. */
    if (note) {
      var dirty = ZB.repo.products.hasUnsavedEdits();
      note.hidden = !dirty;
      note.textContent = dirty
        ? 'Some changes have not been saved.'
        : '';
    }
  }

  function paintTable(result) {
    var body = document.getElementById('a-prod-body');
    if (!body) return;

    if (!result.total) {
      body.innerHTML = hasFilters() ? noMatches() : noProducts();
      return;
    }

    var rows = result.items.map(function (row) {
      /* "Running low" is decided in the repo, not here. The inventory
         screen filters on the same idea and the pill and the filter have
         to mean the same number — a threshold that is ten in one place and
         five in another is a bug nobody notices until something sells out
         under a badge that said it was fine. */
      var level = ZB.repo.inventory.levelOf(row);
      var stockClass = level === 'out' ? 'out-of-stock' : (level === 'low' ? 'low' : 'neutral');
      var stockLabel = level === 'out' ? 'Out of stock'
                     : level === 'low' ? row.stock + ' left' : String(row.stock);

      return '' +
        '<tr>' +
          '<td class="a-cell--media">' +
            (row.image
              ? '<img class="a-thumb" src="' + ui.esc(row.image) + '" alt=""' +
                    ' width="40" height="52" loading="lazy" decoding="async">'
              : '<span class="a-thumb a-thumb--empty" aria-hidden="true"></span>') +
          '</td>' +
          '<th scope="row" class="a-cell--name">' +
            '<a href="' + ui.href('/admin/products/' + encodeURIComponent(row.id) + '/edit') + '">' +
              ui.esc(row.title) +
            '</a>' +
            '<span class="a-cell__meta">' + ui.esc(row.sku) + '</span>' +
          '</th>' +
          '<td>' + ui.esc(row.categoryLabel) + '</td>' +
          '<td class="a-num">' + ui.esc(ZB.adminChart.full(row.price)) +
            (row.compareAt
              ? '<span class="a-cell__was">' + ui.esc(ZB.adminChart.full(row.compareAt)) + '</span>'
              : '') +
          '</td>' +
          '<td class="a-num">' + ui.statusPill(stockClass, stockLabel) + '</td>' +
          '<td>' + ui.statusPill(row.status, statusLabel(row.status)) + '</td>' +
          '<td class="a-cell--actions">' +
            '<div class="a-rowactions">' +
              (row.storefrontPath
                ? '<a class="a-iconbtn" href="' + ui.esc(row.storefrontPath) + '" data-full-load' +
                     ' target="_blank" rel="noopener" title="View in store"' +
                     ' aria-label="View ' + ui.esc(row.title) + ' in the store">' +
                    ui.icon('store') +
                  '</a>'
                : '') +
              '<a class="a-iconbtn" href="' +
                 ui.href('/admin/products/' + encodeURIComponent(row.id) + '/edit') + '"' +
                 ' title="Edit" aria-label="Edit ' + ui.esc(row.title) + '">' +
                ui.icon('sliders') +
              '</a>' +
              '<button class="a-iconbtn a-iconbtn--danger" type="button"' +
                     ' data-delete="' + ui.esc(row.id) + '"' +
                     ' data-title="' + ui.esc(row.title) + '"' +
                     ' title="Delete" aria-label="Delete ' + ui.esc(row.title) + '">' +
                '<svg class="a-icon" viewBox="0 0 24 24" aria-hidden="true">' +
                  '<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/>' +
                  '<path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>' +
                '</svg>' +
              '</button>' +
            '</div>' +
          '</td>' +
        '</tr>';
    }).join('');

    body.innerHTML =
      '<table class="a-table a-table--products">' +
        '<thead><tr>' +
          '<th scope="col"><span class="visually-hidden">Image</span></th>' +
          '<th scope="col">Product</th>' +
          '<th scope="col">Category</th>' +
          '<th scope="col" class="a-num">Price</th>' +
          '<th scope="col" class="a-num">Stock</th>' +
          '<th scope="col">Status</th>' +
          '<th scope="col"><span class="visually-hidden">Actions</span></th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>';
  }

  function statusLabel(status) {
    if (status === 'active') return 'Active';
    if (status === 'draft') return 'Draft';
    return 'Out of stock';
  }

  /** Nothing matched the filters — offer the way back, not a blank panel. */
  function noMatches() {
    return '' +
      '<div class="a-blank">' +
        '<p class="a-blank__title">No products match those filters</p>' +
        '<p class="a-blank__body">' +
          'Try a shorter search, or a different department.' +
        '</p>' +
        '<button class="a-btn a-btn--ghost" type="button" data-clear-all>Clear all filters</button>' +
      '</div>';
  }

  /** Genuinely empty — offer the first step. */
  function noProducts() {
    return '' +
      '<div class="a-blank">' +
        '<p class="a-blank__title">No products yet</p>' +
        '<p class="a-blank__body">Add the first one and it appears here.</p>' +
        '<a class="a-btn a-btn--primary" href="' + ui.href('/admin/products/new') + '">' +
          'Add product' +
        '</a>' +
      '</div>';
  }

  function paintPager(result) {
    var pager = document.getElementById('a-prod-pager');
    if (!pager) return;

    if (result.pages <= 1) {
      pager.hidden = true;
      pager.innerHTML = '';
      return;
    }

    /* A window around the current page, so a long catalogue does not draw
       forty buttons. */
    var numbers = [];
    var from = Math.max(1, result.page - 2);
    var to = Math.min(result.pages, from + 4);
    from = Math.max(1, to - 4);

    for (var i = from; i <= to; i++) {
      numbers.push(
        '<button class="a-pager__no" type="button" data-page="' + i + '"' +
               (i === result.page ? ' aria-current="page"' : '') + '>' + i + '</button>'
      );
    }

    pager.hidden = false;
    pager.innerHTML =
      '<button class="a-pager__step" type="button" data-page="' + (result.page - 1) + '"' +
             (result.page === 1 ? ' disabled' : '') + '>Previous</button>' +
      '<div class="a-pager__numbers">' + numbers.join('') + '</div>' +
      '<button class="a-pager__step" type="button" data-page="' + (result.page + 1) + '"' +
             (result.page === result.pages ? ' disabled' : '') + '>Next</button>';
  }

  /* -----------------------------------------------------------------------
     Delete
     ----------------------------------------------------------------------- */

  function confirmDelete(id, title) {
    ZB.adminModal.confirm({
      title: 'Delete this product?',
      /* Names the thing, so the dialog answers the question by itself. */
      body: '“' + title + '” will be removed from the list. This build has no ' +
            'database, so the change lasts until the page is reloaded.',
      confirmLabel: 'Delete product',
      cancelLabel: 'Keep it',
      tone: 'danger'
    }).then(function (yes) {
      if (!yes) return;

      ZB.repo.products.remove(id).then(function (undo) {
        load();
        ZB.adminToast.success('“' + title + '” deleted.', {
          label: 'Undo',
          onClick: function () {
            ZB.repo.products.restore(undo).then(function () {
              load();
              ZB.adminToast.info('“' + title + '” restored.');
            });
          }
        });
      });
    });
  }

}(window.ZB));
