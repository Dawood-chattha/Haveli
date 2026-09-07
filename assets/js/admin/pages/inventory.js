/* =========================================================================
   pages/inventory.js — what is left on the shelf
   -------------------------------------------------------------------------
   The same products the product list shows, asked a different question.
   That screen asks "what do we sell"; this one asks "what is about to run
   out", and everything here follows from that.

   IT OPENS ON THE PROBLEMS, NOT ON THE CATALOGUE
   The default sort is lowest stock first, so the rows that need a decision
   are the ones on screen when the page loads. An inventory list sorted by
   name is a catalogue with a number beside it — the owner still has to go
   looking for the trouble, which is the one thing the screen was supposed
   to do for them.

   STOCK IS EDITED HERE, IN THE ROW
   Sending someone to the product form to change one number, past thirty
   fields they did not come to edit, is how a stock count stops being kept
   up to date. So the quantity is a real input in the row with −/+ beside
   it, it saves on blur or Enter, and it says so.

   The write goes through ZB.repo.inventory.setStock, which also settles
   `inStock` and the product status — a product on the shelf still labelled
   out of stock is a row contradicting itself, and the storefront reads
   that same flag to decide whether its buy button works.

   Applied from the UI guidance consulted for this panel:
     - Every write says so afterwards, and offers undo (#83).
     - The input has a real label, and its state is announced (#54, #55).
     - Refreshing holds the previous rows rather than collapsing (#19, #78).
     - No empty result is a blank panel (#79, #90).
     - Filter chips wrap; they are never clipped into one row (#115).
   ========================================================================= */

window.ZB = window.ZB || {};
window.ZB.adminPages = window.ZB.adminPages || {};

(function (ZB) {
  'use strict';

  var ui = ZB.adminUI;
  var PER_PAGE = 12;

  var state = { q: '', dept: '', level: '', sort: 'stock-asc', page: 1 };
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
      level: query.level || '',
      sort: query.sort || 'stock-asc',
      page: Math.max(1, parseInt(query.page, 10) || 1)
    };
  }

  function writeState() {
    var parts = [];
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.dept) parts.push('dept=' + encodeURIComponent(state.dept));
    if (state.level) parts.push('level=' + encodeURIComponent(state.level));
    if (state.sort && state.sort !== 'stock-asc') parts.push('sort=' + state.sort);
    if (state.page > 1) parts.push('page=' + state.page);

    var url = '/admin/inventory' + (parts.length ? '?' + parts.join('&') : '');
    if (window.history.replaceState) window.history.replaceState({}, '', url);
  }

  function hasFilters() {
    return !!(state.q || state.dept || state.level);
  }

  /* -----------------------------------------------------------------------
     Page
     ----------------------------------------------------------------------- */

  ZB.adminPages.inventory = {

    title: 'Inventory',
    crumbs: [{ label: 'Inventory' }],

    render: function () {
      return '' +
        ui.pageHead({
          title: 'Inventory',
          sub: 'What is left on the shelf.'
        }) +

        '<div class="a-metrics a-metrics--filters" id="a-inv-metrics" aria-busy="true">' +
          filterTile('out', 'Out of stock', 'out') +
          filterTile('low', 'Running low', 'low') +
          plainTile('units', 'Units in stock') +
          plainTile('value', 'Stock value') +
        '</div>' +

        '<div class="a-card">' +

          '<div class="a-toolbar">' +
            '<div class="a-search">' +
              '<label class="visually-hidden" for="a-inv-search">Search stock</label>' +
              '<span class="a-search__icon" aria-hidden="true">' + ui.icon('search') + '</span>' +
              '<input class="a-search__input" id="a-inv-search" type="search"' +
                    ' placeholder="Search by name, SKU or category" autocomplete="off">' +
            '</div>' +

            '<div class="a-toolbar__selects" id="a-inv-selects"></div>' +
          '</div>' +

          '<div class="a-chips" id="a-inv-chips" hidden></div>' +

          '<div class="a-resultbar">' +
            '<p class="a-resultbar__count" id="a-inv-count" role="status"></p>' +
            '<p class="a-resultbar__note" id="a-inv-note" hidden></p>' +
          '</div>' +

          '<div class="a-card__body a-card__body--flush" id="a-inv-body" aria-busy="true">' +
            '<div class="a-skeleton" aria-hidden="true">' +
              new Array(8).join('|').split('|').map(function () {
                return '<div class="a-skeleton__row"></div>';
              }).join('') +
            '</div>' +
          '</div>' +

          '<div class="a-pager" id="a-inv-pager" hidden></div>' +

        '</div>';
    },

    mount: function (params) {
      var body = document.getElementById('a-inv-body');
      if (!body) return;

      readState(params);
      lastResult = null;

      var search = document.getElementById('a-inv-search');
      search.value = state.q;

      search.addEventListener('input', ZB.util.debounce(function () {
        state.q = search.value.trim();
        state.page = 1;
        writeState();
        load();
      }, 250));

      document.addEventListener('click', onClick);
      document.addEventListener('change', onChange);
      document.addEventListener('keydown', onKey);

      ZB.repo.inventory.facets().then(function (result) {
        if (!document.body.contains(body)) return;
        facets = result;
        paintSelects();
        paintChips();
      });

      load();
      loadMetrics();

      function gone() {
        if (document.body.contains(body)) return false;
        document.removeEventListener('click', onClick);
        document.removeEventListener('change', onChange);
        document.removeEventListener('keydown', onKey);
        return true;
      }

      /* Enter saves without leaving the field, which is what a hand
         working down a column of counts expects. Blur saves too, so
         tabbing straight to the next row does not lose the number. */
      function onKey(e) {
        if (gone()) return;
        if (e.key !== 'Enter') return;

        var input = e.target.closest('[data-stock-input]');
        if (!input) return;

        e.preventDefault();
        commit(input);
      }

      function onChange(e) {
        if (gone()) return;

        var input = e.target.closest('[data-stock-input]');
        if (input) { commit(input); return; }

        var select = e.target.closest('[data-filter]');
        if (!select) return;

        state[select.getAttribute('data-filter')] = select.value;
        state.page = 1;
        writeState();
        load();
      }

      function onClick(e) {
        if (gone()) return;

        var tile = e.target.closest('[data-tile-filter]');
        if (tile) {
          var wanted = tile.getAttribute('data-tile-filter');
          state.level = state.level === wanted ? '' : wanted;
          state.page = 1;
          writeState();
          load();
          paintSelects();
          return;
        }

        var step = e.target.closest('[data-step]');
        if (step) {
          adjust(step.getAttribute('data-id'),
                 Number(step.getAttribute('data-step')),
                 step.getAttribute('data-title'));
          return;
        }

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
          state.q = ''; state.dept = ''; state.level = ''; state.page = 1;
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
          window.scrollTo({ top: 0, behavior: ZB.reduceMotion ? 'auto' : 'smooth' });
        }
      }
    }
  };

  /* -----------------------------------------------------------------------
     Loading
     ----------------------------------------------------------------------- */

  function load() {
    var body = document.getElementById('a-inv-body');
    if (!body) return;

    body.setAttribute('aria-busy', 'true');
    if (lastResult) body.classList.add('is-refreshing');

    ZB.repo.inventory.list({
      search: state.q,
      dept: state.dept,
      level: state.level,
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
      paintTilePressed();

      body.classList.remove('is-refreshing');
      body.setAttribute('aria-busy', 'false');
    });
  }

  function loadMetrics() {
    var host = document.getElementById('a-inv-metrics');
    if (!host) return;

    ZB.repo.inventory.summary().then(function (sum) {
      if (!document.body.contains(host)) return;

      setTile('out', String(sum.out));
      setTile('low', String(sum.low));
      setTile('units', ZB.adminChart.full(sum.units));
      setTile('value', ZB.adminChart.compact(sum.value));

      host.setAttribute('aria-busy', 'false');
      paintTilePressed();
    });
  }

  /* -----------------------------------------------------------------------
     Painting
     ----------------------------------------------------------------------- */

  function filterTile(key, label, level) {
    return '' +
      '<button class="a-stat a-metric a-metric--button a-metric--' + key + '" type="button"' +
             ' data-tile-filter="' + level + '" aria-pressed="false">' +
        '<span class="a-stat__label">' + ui.esc(label) + '</span>' +
        '<span class="a-stat__value" id="a-inv-t-' + key + '">—</span>' +
      '</button>';
  }

  function plainTile(key, label) {
    return '' +
      '<div class="a-stat a-metric">' +
        '<p class="a-stat__label">' + ui.esc(label) + '</p>' +
        '<p class="a-stat__value" id="a-inv-t-' + key + '">—</p>' +
      '</div>';
  }

  function setTile(key, value) {
    var el = document.getElementById('a-inv-t-' + key);
    if (el) el.textContent = value;
  }

  function paintTilePressed() {
    ZB.util.all('[data-tile-filter]').forEach(function (tile) {
      tile.setAttribute('aria-pressed',
        state.level === tile.getAttribute('data-tile-filter') ? 'true' : 'false');
    });
  }

  function select(o) {
    var options = [{ id: '', label: o.anyLabel }].concat(o.options).map(function (item) {
      return '<option value="' + ui.esc(item.id) + '"' +
             (String(item.id) === String(o.value) ? ' selected' : '') + '>' +
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
    var host = document.getElementById('a-inv-selects');
    if (!host || !facets) return;

    host.innerHTML =
      select({
        id: 'a-inv-dept', name: 'dept', label: 'Department',
        anyLabel: 'All departments', options: facets.departments, value: state.dept
      }) +
      select({
        id: 'a-inv-level', name: 'level', label: 'Stock level',
        anyLabel: 'Any stock level', options: facets.levels, value: state.level
      }) +
      select({
        id: 'a-inv-sort', name: 'sort', label: 'Sort by',
        anyLabel: 'Lowest stock first',
        options: ZB.repo.inventory.sorts.filter(function (s) {
          return s.id !== 'stock-asc';
        }),
        value: state.sort === 'stock-asc' ? '' : state.sort
      });
  }

  function labelFor(list, id) {
    var hit = (list || []).filter(function (item) {
      return String(item.id) === String(id);
    })[0];
    return hit ? hit.label : id;
  }

  function paintChips() {
    var host = document.getElementById('a-inv-chips');
    if (!host) return;

    var chips = [];
    if (state.q) chips.push({ key: 'q', label: 'Search: ' + state.q });
    if (state.dept) {
      chips.push({ key: 'dept', label: labelFor(facets && facets.departments, state.dept) });
    }
    if (state.level) {
      chips.push({ key: 'level', label: labelFor(facets && facets.levels, state.level) });
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
    var count = document.getElementById('a-inv-count');
    var note = document.getElementById('a-inv-note');
    if (!count) return;

    var from = (result.page - 1) * result.perPage + 1;
    var to = Math.min(result.page * result.perPage, result.total);

    /* Units and value for the whole filtered set. "48 products running
       low" is half an answer without what restocking them is worth. */
    count.textContent = result.total
      ? 'Showing ' + from + '–' + to + ' of ' + result.total + ' products · ' +
        ZB.adminChart.full(result.units) + ' units worth ' + ui.money(result.value)
      : 'No products found';

    if (note) {
      var dirty = ZB.repo.inventory.hasUnsavedEdits();
      note.hidden = !dirty;
      note.textContent = dirty
        ? 'Stock changes are held in this tab only and are lost on reload — ' +
          'there is no database yet.'
        : '';
    }
  }

  function paintTable(result) {
    var body = document.getElementById('a-inv-body');
    if (!body) return;

    if (!result.total) {
      body.innerHTML = hasFilters() ? noMatches() : noProducts();
      return;
    }

    var rows = result.items.map(function (row) {
      var id = 'a-inv-q-' + row.id.replace(/[^a-zA-Z0-9_-]/g, '');

      return '' +
        '<tr class="a-inv-row a-inv-row--' + row.level + '">' +
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
          '<td class="a-cell--stepper">' + stepper(id, row) + '</td>' +
          '<td>' + levelPill(row) + '</td>' +
          '<td class="a-num">' + ui.esc(ZB.adminChart.full(row.value)) + '</td>' +
        '</tr>';
    }).join('');

    body.innerHTML =
      '<table class="a-table a-table--inventory">' +
        '<thead><tr>' +
          '<th scope="col"><span class="visually-hidden">Image</span></th>' +
          '<th scope="col">Product</th>' +
          '<th scope="col">Category</th>' +
          '<th scope="col">In stock</th>' +
          '<th scope="col">Level</th>' +
          '<th scope="col" class="a-num">Stock value</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>';
  }

  /**
   * The quantity control.
   *
   * A real number input with a visible-to-assistive-tech label naming the
   * product, because "12" on its own tells a screen reader nothing about
   * which of twelve rows it is in. The −/+ are buttons around it rather
   * than the input's own spinners: those are tiny, differ per browser, and
   * on a touch screen are close to unusable.
   */
  function stepper(id, row) {
    return '' +
      '<div class="a-stepper">' +
        '<button class="a-stepper__btn" type="button" data-step="-1"' +
               ' data-id="' + ui.esc(row.id) + '" data-title="' + ui.esc(row.title) + '"' +
               (row.stock <= 0 ? ' disabled' : '') +
               ' aria-label="One fewer ' + ui.esc(row.title) + '">−</button>' +
        '<label class="visually-hidden" for="' + id + '">' +
          'Stock for ' + ui.esc(row.title) +
        '</label>' +
        '<input class="a-stepper__input" id="' + id + '" type="number" min="0" step="1"' +
              ' inputmode="numeric" data-stock-input data-id="' + ui.esc(row.id) + '"' +
              ' data-title="' + ui.esc(row.title) + '"' +
              ' value="' + row.stock + '">' +
        '<button class="a-stepper__btn" type="button" data-step="1"' +
               ' data-id="' + ui.esc(row.id) + '" data-title="' + ui.esc(row.title) + '"' +
               ' aria-label="One more ' + ui.esc(row.title) + '">+</button>' +
      '</div>';
  }

  function levelPill(row) {
    if (row.level === 'out') return ui.statusPill('out-of-stock', 'Out of stock');
    if (row.level === 'low') {
      return ui.statusPill('low', 'Low — ' + row.stock + ' left');
    }
    return ui.statusPill('active', 'In stock');
  }

  function noMatches() {
    return '' +
      '<div class="a-blank">' +
        '<p class="a-blank__title">Nothing matches those filters</p>' +
        '<p class="a-blank__body">' +
          'Try a different department, or a wider stock level.' +
        '</p>' +
        '<button class="a-btn a-btn--ghost" type="button" data-clear-all>Clear all filters</button>' +
      '</div>';
  }

  function noProducts() {
    return '' +
      '<div class="a-blank">' +
        '<p class="a-blank__title">No products to count</p>' +
        '<p class="a-blank__body">Add a product and its stock appears here.</p>' +
        '<a class="a-btn a-btn--primary" href="' + ui.href('/admin/products/new') + '">' +
          'Add product' +
        '</a>' +
      '</div>';
  }

  function paintPager(result) {
    var pager = document.getElementById('a-inv-pager');
    if (!pager) return;

    if (result.pages <= 1) {
      pager.hidden = true;
      pager.innerHTML = '';
      return;
    }

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
     Writing stock

     Both paths — the input and the −/+ — end in the same save, so there is
     one place that decides what a save means and one message afterwards.
     ----------------------------------------------------------------------- */

  function commit(input) {
    var id = input.getAttribute('data-id');
    var title = input.getAttribute('data-title');
    var wanted = Math.max(0, Math.round(Number(input.value)));

    if (!isFinite(wanted)) {
      /* Put back what was there rather than saving a number nobody typed. */
      load();
      ZB.adminToast.error('That is not a quantity.');
      return;
    }

    save(id, wanted, title);
  }

  function adjust(id, delta, title) {
    /* Read from the input rather than from lastResult, so two quick clicks
       both count — the second would otherwise re-read a stale row and undo
       the first. */
    var input = document.querySelector('[data-stock-input][data-id="' + cssEscape(id) + '"]');
    if (!input) return;

    var next = Math.max(0, Math.round(Number(input.value)) + delta);
    input.value = next;
    save(id, next, title);
  }

  /** Minimal attribute-selector escaping — ids here contain only safe
      characters, but a quote in one would break the selector silently. */
  function cssEscape(value) {
    return String(value).replace(/["\\]/g, '\\$&');
  }

  var saveTimer = null;
  var savedFrom = {};   /* id -> the value before this run of edits */

  /**
   * THE TABLE IS NOT REDRAWN AFTER A STOCK CHANGE, AND THAT IS DELIBERATE
   *
   * The obvious ending to a save is load(). Here it is the wrong one twice
   * over. It replaces the input the hand is still in — the caret, the
   * selection and the focus all go — and because the default sort is
   * lowest stock first, the row being edited jumps somewhere else the
   * moment its number changes. Working down a column of counts becomes
   * impossible: every entry moves the next one.
   *
   * So the save patches the row where it stands. The list keeps the order
   * it was drawn in until something actually asks for a new one — a
   * filter, a sort, a page — which is the behaviour of every stock sheet
   * ever kept on paper.
   */
  function patchRow(id, row) {
    var input = document.querySelector('[data-stock-input][data-id="' + cssEscape(id) + '"]');
    if (!input) return;

    var tr = input.closest('tr');
    if (!tr) return;

    input.value = row.stock;
    /* The attribute, not just the property. save() reads it to know where
       a run of edits started, so it has to move to the saved value or a
       second run would offer to undo back past the first. */
    input.setAttribute('value', row.stock);

    tr.className = 'a-inv-row a-inv-row--' + row.level;

    var minus = tr.querySelector('[data-step="-1"]');
    if (minus) minus.disabled = row.stock <= 0;

    var cells = tr.cells;
    /* Level pill, then stock value — the two cells the number governs. */
    cells[4].innerHTML = levelPill(row);
    cells[5].textContent = ZB.adminChart.full(row.value);
  }

  /** The shape list() returns, for one row, so patchRow gets the same. */
  function shape(row) {
    var out = {};
    Object.keys(row).forEach(function (key) { out[key] = row[key]; });
    out.level = ZB.repo.inventory.levelOf(row);
    out.value = row.stock * row.price;
    return out;
  }

  function save(id, quantity, title) {
    /* A run of + clicks is one save, not eight, and the undo offered at
       the end of it goes back to where the run started rather than to the
       click before last. */
    if (!(id in savedFrom)) {
      var current = document.querySelector('[data-stock-input][data-id="' + cssEscape(id) + '"]');
      savedFrom[id] = current ? Number(current.getAttribute('value')) : quantity;
    }

    if (saveTimer) window.clearTimeout(saveTimer);

    saveTimer = window.setTimeout(function () {
      var previous = savedFrom[id];
      delete savedFrom[id];

      ZB.repo.inventory.setStock(id, quantity).then(function (after) {
        patchRow(id, shape(after));
        paintCountFromRepo();
        loadMetrics();

        ZB.adminToast.success(
          title + ': ' + after.stock + ' in stock.',
          {
            label: 'Undo',
            onClick: function () {
              ZB.repo.inventory.setStock(id, previous).then(function (back) {
                patchRow(id, shape(back));
                paintCountFromRepo();
                loadMetrics();
                ZB.adminToast.info(title + ' is back to ' + previous + '.');
              });
            }
          }
        );
      }).catch(function (failure) {
        ZB.adminToast.error(failure.message || 'That stock change was not saved.');
        load();
      });
    }, 400);
  }

  /**
   * Re-read the totals line without redrawing the table.
   *
   * The units and value in it are for the whole filtered set, so they move
   * when any row does — but fetching them must not disturb the rows, which
   * is why this asks for page 1 of nothing rather than calling load().
   */
  function paintCountFromRepo() {
    ZB.repo.inventory.list({
      search: state.q, dept: state.dept, level: state.level,
      sort: state.sort, page: state.page, perPage: PER_PAGE
    }).then(function (result) {
      if (!document.getElementById('a-inv-count')) return;
      /* lastResult is kept in step so the pager still describes the truth. */
      lastResult = result;
      paintCount(result);
    });
  }

}(window.ZB));
