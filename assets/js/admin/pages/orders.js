/* =========================================================================
   pages/orders.js — what customers have bought
   -------------------------------------------------------------------------
   The one screen in the panel that is a working queue rather than a
   reference list. Everything here is arranged around that.

   THE SUMMARY STRIP IS FILTERS, NOT DECORATION
   "23 waiting" is only useful if it is also the way to see those 23. Each
   tile in the strip applies its own filter, is a real button, and shows
   aria-pressed when it is the one in force. A number an owner cannot act
   on is a number they have to act on somewhere else.

   ONE-CLICK ADVANCE, WITH UNDO — AND WHY THAT IS NOT A MISSING CONFIRM
   Moving an order forward is the action of the day, and it is reversible,
   forward-only, and never destructive. Putting a dialog in front of it
   would train the reader to dismiss dialogs, which is exactly what must
   not happen to the one dialog that matters here — cancelling an order.
   So: advance is one click plus an Undo toast; cancelling asks first, and
   lives in the detail view where the whole order is visible.

   Applied from the UI guidance consulted for this panel:
     - The destructive action asks first and names what it affects (#35).
     - Every write says so afterwards, and an undoable one offers it (#83).
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

  var state = { q: '', status: '', payment: '', range: '', sort: 'newest', page: 1 };
  var facets = null;
  var lastResult = null;

  /* -----------------------------------------------------------------------
     URL state
     ----------------------------------------------------------------------- */

  function readState(params) {
    var query = (params && params.query) || {};
    state = {
      q: query.q || '',
      status: query.status || '',
      payment: query.payment || '',
      range: query.range || '',
      sort: query.sort || 'newest',
      page: Math.max(1, parseInt(query.page, 10) || 1)
    };
  }

  function writeState() {
    var parts = [];
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.status) parts.push('status=' + encodeURIComponent(state.status));
    if (state.payment) parts.push('payment=' + encodeURIComponent(state.payment));
    if (state.range) parts.push('range=' + encodeURIComponent(state.range));
    if (state.sort && state.sort !== 'newest') parts.push('sort=' + state.sort);
    if (state.page > 1) parts.push('page=' + state.page);

    var url = '/admin/orders' + (parts.length ? '?' + parts.join('&') : '');
    if (window.history.replaceState) window.history.replaceState({}, '', url);
  }

  function hasFilters() {
    return !!(state.q || state.status || state.payment || state.range);
  }

  /* -----------------------------------------------------------------------
     Page
     ----------------------------------------------------------------------- */

  ZB.adminPages.orders = {

    title: 'Orders',
    crumbs: [{ label: 'Orders' }],

    render: function () {
      return '' +
        ui.pageHead({
          title: 'Orders',
          sub: 'What customers have bought.'
        }) +

        '<div class="a-metrics a-metrics--filters" id="a-ord-metrics" aria-busy="true">' +
          filterTile('all', 'All orders', '') +
          filterTile('waiting', 'Needs action', 'status=waiting') +
          filterTile('unpaid', 'Unpaid', 'payment=unpaid') +
          filterTile('revenue', 'Revenue', null) +
        '</div>' +

        '<div class="a-card">' +

          '<div class="a-toolbar">' +
            '<div class="a-search">' +
              '<label class="visually-hidden" for="a-ord-search">Search orders</label>' +
              '<span class="a-search__icon" aria-hidden="true">' + ui.icon('search') + '</span>' +
              '<input class="a-search__input" id="a-ord-search" type="search"' +
                    ' placeholder="Search by order number, customer or city" autocomplete="off">' +
            '</div>' +

            '<div class="a-toolbar__selects" id="a-ord-selects"></div>' +
          '</div>' +

          '<div class="a-chips" id="a-ord-chips" hidden></div>' +

          '<div class="a-resultbar">' +
            '<p class="a-resultbar__count" id="a-ord-count" role="status"></p>' +
            '<p class="a-resultbar__note" id="a-ord-note" hidden></p>' +
          '</div>' +

          '<div class="a-card__body a-card__body--flush" id="a-ord-body" aria-busy="true">' +
            '<div class="a-skeleton" aria-hidden="true">' +
              new Array(8).join('|').split('|').map(function () {
                return '<div class="a-skeleton__row"></div>';
              }).join('') +
            '</div>' +
          '</div>' +

          '<div class="a-pager" id="a-ord-pager" hidden></div>' +

        '</div>';
    },

    mount: function (params) {
      var body = document.getElementById('a-ord-body');
      if (!body) return;

      readState(params);
      lastResult = null;

      var search = document.getElementById('a-ord-search');
      search.value = state.q;

      search.addEventListener('input', ZB.util.debounce(function () {
        state.q = search.value.trim();
        state.page = 1;
        writeState();
        load();
      }, 250));

      document.addEventListener('click', onClick);
      document.addEventListener('change', onChange);

      ZB.repo.orders.facets().then(function (result) {
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

        /* A summary tile is a filter. Clicking the one already in force
           clears it, so the strip is a toggle rather than a trap. */
        var tile = e.target.closest('[data-tile-filter]');
        if (tile) {
          applyTile(tile.getAttribute('data-tile-filter'));
          if (search) search.value = state.q;
          return;
        }

        var advance = e.target.closest('[data-advance]');
        if (advance) {
          moveTo(advance.getAttribute('data-advance'),
                 advance.getAttribute('data-to'),
                 advance.getAttribute('data-ref'));
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
          state.q = ''; state.status = ''; state.payment = ''; state.range = '';
          state.page = 1;
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

  /**
   * Apply (or clear) the filter a summary tile stands for.
   * `spec` is a query fragment such as 'status=pending', or '' for "all".
   */
  function applyTile(spec) {
    var wanted = { status: '', payment: '' };

    spec.split('&').filter(Boolean).forEach(function (pair) {
      var bits = pair.split('=');
      wanted[bits[0]] = bits[1];
    });

    var alreadyOn = state.status === wanted.status && state.payment === wanted.payment;

    state.status = alreadyOn ? '' : wanted.status;
    state.payment = alreadyOn ? '' : wanted.payment;
    state.q = '';
    state.page = 1;

    writeState();
    load();
    paintSelects();
  }

  /* -----------------------------------------------------------------------
     Loading
     ----------------------------------------------------------------------- */

  function load() {
    var body = document.getElementById('a-ord-body');
    if (!body) return;

    body.setAttribute('aria-busy', 'true');
    if (lastResult) body.classList.add('is-refreshing');

    ZB.repo.orders.list({
      search: state.q,
      status: state.status,
      payment: state.payment,
      range: state.range,
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
    var host = document.getElementById('a-ord-metrics');
    if (!host) return;

    ZB.repo.orders.summary().then(function (sum) {
      if (!document.body.contains(host)) return;

      setTile('all', String(sum.total));
      setTile('waiting', String(sum.waiting));
      setTile('unpaid', String(sum.unpaid));
      setTile('revenue', ZB.adminChart.compact(sum.revenue));

      host.setAttribute('aria-busy', 'false');
      paintTilePressed();
    });
  }

  /* -----------------------------------------------------------------------
     Painting
     ----------------------------------------------------------------------- */

  function filterTile(key, label, spec) {
    /* Revenue has no filter behind it — it is a total, not a subset — so
       it is a plain tile rather than a button that would do nothing. */
    if (spec === null) {
      return '' +
        '<div class="a-stat a-metric">' +
          '<p class="a-stat__label">' + ui.esc(label) + '</p>' +
          '<p class="a-stat__value" id="a-ord-t-' + key + '">—</p>' +
        '</div>';
    }

    return '' +
      '<button class="a-stat a-metric a-metric--button" type="button"' +
             ' data-tile-filter="' + ui.esc(spec) + '" data-tile-key="' + key + '"' +
             ' aria-pressed="false">' +
        '<span class="a-stat__label">' + ui.esc(label) + '</span>' +
        '<span class="a-stat__value" id="a-ord-t-' + key + '">—</span>' +
      '</button>';
  }

  function setTile(key, value) {
    var el = document.getElementById('a-ord-t-' + key);
    if (el) el.textContent = value;
  }

  /** Light the tile whose filter is currently in force. */
  function paintTilePressed() {
    ZB.util.all('[data-tile-filter]').forEach(function (tile) {
      var wanted = { status: '', payment: '' };
      tile.getAttribute('data-tile-filter').split('&').filter(Boolean)
        .forEach(function (pair) {
          var bits = pair.split('=');
          wanted[bits[0]] = bits[1];
        });

      var on = state.status === wanted.status && state.payment === wanted.payment;
      tile.setAttribute('aria-pressed', on ? 'true' : 'false');
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
    var host = document.getElementById('a-ord-selects');
    if (!host || !facets) return;

    host.innerHTML =
      select({
        id: 'a-ord-range', name: 'range', label: 'Period',
        anyLabel: 'All time', options: facets.ranges, value: state.range
      }) +
      select({
        id: 'a-ord-status', name: 'status', label: 'Order status',
        anyLabel: 'All statuses', options: facets.statuses, value: state.status
      }) +
      select({
        id: 'a-ord-payment', name: 'payment', label: 'Payment',
        anyLabel: 'Any payment', options: facets.payments, value: state.payment
      }) +
      select({
        id: 'a-ord-sort', name: 'sort', label: 'Sort by',
        anyLabel: 'Newest first',
        options: ZB.repo.orders.sorts.filter(function (s) { return s.id !== 'newest'; }),
        value: state.sort === 'newest' ? '' : state.sort
      });
  }

  function labelFor(list, id) {
    var hit = (list || []).filter(function (item) {
      return String(item.id) === String(id);
    })[0];
    return hit ? hit.label : id;
  }

  function paintChips() {
    var host = document.getElementById('a-ord-chips');
    if (!host) return;

    var chips = [];
    if (state.q) chips.push({ key: 'q', label: 'Search: ' + state.q });
    if (state.range) {
      chips.push({ key: 'range', label: labelFor(facets && facets.ranges, state.range) });
    }
    if (state.status) {
      chips.push({ key: 'status', label: labelFor(facets && facets.statuses, state.status) });
    }
    if (state.payment) {
      chips.push({
        key: 'payment',
        label: labelFor(facets && facets.payments, state.payment) + ' orders'
      });
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
    var count = document.getElementById('a-ord-count');
    var note = document.getElementById('a-ord-note');
    if (!count) return;

    var from = (result.page - 1) * result.perPage + 1;
    var to = Math.min(result.page * result.perPage, result.total);

    /* The value of the filtered set, not just its size: "how many" and
       "how much" are the same question on this screen. */
    count.textContent = result.total
      ? 'Showing ' + from + '–' + to + ' of ' + result.total + ' orders · ' +
        ui.money(result.revenue) + ' in sales'
      : 'No orders found';

    if (note) {
      var dirty = ZB.repo.orders.hasUnsavedEdits();
      note.hidden = !dirty;
      note.textContent = dirty
        ? 'Status changes are held in this tab only and are lost on reload — ' +
          'there is no database yet.'
        : '';
    }
  }

  function paintTable(result) {
    var body = document.getElementById('a-ord-body');
    if (!body) return;

    if (!result.total) {
      body.innerHTML = hasFilters() ? noMatches() : noOrders();
      return;
    }

    var rows = result.items.map(function (order) {
      var next = ZB.repo.orders.nextStatuses(order.status);
      /* The first allowed move only. Offering "cancel" here too would put
         a destructive button in a row of routine ones, a hand's width from
         the one pressed every day. */
      var forward = next.filter(function (s) { return s.id !== 'cancelled'; })[0];

      return '' +
        '<tr>' +
          '<th scope="row" class="a-cell--name">' +
            '<a href="' + ui.href('/admin/orders/' + encodeURIComponent(order.id)) + '">' +
              ui.esc(order.ref) +
            '</a>' +
            '<span class="a-cell__meta">' + order.itemCount +
              (order.itemCount === 1 ? ' item' : ' items') + '</span>' +
          '</th>' +
          '<td>' +
            '<span class="a-cell__strong">' + ui.esc(order.customerName) + '</span>' +
            '<span class="a-cell__meta">' + ui.esc(order.city) + '</span>' +
          '</td>' +
          '<td class="a-cell--date">' +
            ui.esc(ui.date(order.date)) +
            '<span class="a-cell__meta">' + ui.esc(ui.ago(order.daysAgo)) + '</span>' +
          '</td>' +
          '<td class="a-num">' + ui.esc(ZB.adminChart.full(order.total)) + '</td>' +
          '<td>' + ui.statusPill(paymentTone(order.payment), order.paymentLabel) + '</td>' +
          '<td>' + ui.statusPill(order.status, order.statusLabel) + '</td>' +
          '<td class="a-cell--actions">' +
            '<div class="a-rowactions">' +
              (forward
                ? '<button class="a-iconbtn a-iconbtn--go" type="button"' +
                         ' data-advance="' + ui.esc(order.id) + '"' +
                         ' data-to="' + ui.esc(forward.id) + '"' +
                         ' data-ref="' + ui.esc(order.ref) + '"' +
                         ' title="' + ui.esc(actionLabel(forward.id)) + '"' +
                         ' aria-label="' + ui.esc(actionLabel(forward.id) +
                                                  ' — order ' + order.ref) + '">' +
                    ui.icon(forward.id === 'shipped' ? 'truck' : 'check') +
                  '</button>'
                : '') +
              '<a class="a-iconbtn" href="' +
                 ui.href('/admin/orders/' + encodeURIComponent(order.id)) + '"' +
                 ' title="Open" aria-label="Open order ' + ui.esc(order.ref) + '">' +
                ui.icon('chevron') +
              '</a>' +
            '</div>' +
          '</td>' +
        '</tr>';
    }).join('');

    body.innerHTML =
      '<table class="a-table a-table--orders">' +
        '<thead><tr>' +
          '<th scope="col">Order</th>' +
          '<th scope="col">Customer</th>' +
          '<th scope="col">Date</th>' +
          '<th scope="col" class="a-num">Total</th>' +
          '<th scope="col">Payment</th>' +
          '<th scope="col">Status</th>' +
          '<th scope="col"><span class="visually-hidden">Actions</span></th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>';
  }

  /** Payment states reuse the pill tones that already mean the same thing. */
  function paymentTone(payment) {
    if (payment === 'paid') return 'active';
    if (payment === 'unpaid') return 'pending';
    return 'neutral';
  }

  function actionLabel(status) {
    if (status === 'processing') return 'Start processing';
    if (status === 'shipped') return 'Mark shipped';
    if (status === 'delivered') return 'Mark delivered';
    return 'Move to ' + status;
  }

  function noMatches() {
    return '' +
      '<div class="a-blank">' +
        '<p class="a-blank__title">No orders match those filters</p>' +
        '<p class="a-blank__body">' +
          'Try a wider period, or a different status.' +
        '</p>' +
        '<button class="a-btn a-btn--ghost" type="button" data-clear-all>Clear all filters</button>' +
      '</div>';
  }

  function noOrders() {
    return '' +
      '<div class="a-blank">' +
        '<p class="a-blank__title">No orders yet</p>' +
        '<p class="a-blank__body">' +
          'Orders placed in the store appear here as they come in.' +
        '</p>' +
      '</div>';
  }

  function paintPager(result) {
    var pager = document.getElementById('a-ord-pager');
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
     Advancing an order
     ----------------------------------------------------------------------- */

  function moveTo(id, status, ref) {
    ZB.repo.orders.get(id).then(function (before) {
      if (!before) return;

      /* Exactly what to put back, captured before the write rather than
         reconstructed after it. */
      var previous = {
        status: before.status, statusLabel: before.statusLabel,
        payment: before.payment, paymentLabel: before.paymentLabel
      };

      ZB.repo.orders.updateStatus(id, status).then(function (after) {
        load();
        loadMetrics();

        ZB.adminToast.success(ref + ' is now ' + after.statusLabel.toLowerCase() + '.', {
          label: 'Undo',
          onClick: function () {
            ZB.repo.orders.restore(id, previous).then(function () {
              load();
              loadMetrics();
              ZB.adminToast.info(ref + ' is back to ' + previous.statusLabel.toLowerCase() + '.');
            });
          }
        });
      }).catch(function (failure) {
        ZB.adminToast.error(failure.message || 'That change was not applied.');
        load();
      });
    });
  }

}(window.ZB));
