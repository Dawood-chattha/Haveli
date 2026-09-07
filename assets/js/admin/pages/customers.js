/* =========================================================================
   pages/customers.js — who is buying
   -------------------------------------------------------------------------
   A customer list is only worth opening for what sits beside the name:
   how many orders, how much spent, how long since the last one. The name
   alone is a phone book.

   WHY "LAST ORDER" IS A COLUMN AND NOT A DETAIL
   Spend says who mattered; last order says who still does. A customer with
   nine orders whose last was five months ago is a different situation from
   one with nine orders last week, and nothing else on the row tells them
   apart. So both are on the row, and the quiet ones are marked rather than
   left for the reader to work out by subtraction.

   BLOCKING IS A UI STATE, NOT A SECURITY CONTROL
   The screen can mark an account blocked, and says plainly in the dialog
   that it changes what this panel shows and nothing else — there is no
   account system and no server to refuse anyone. Wording that implied
   otherwise would be the most dangerous kind of wrong: an owner would
   believe someone had been stopped.

   Applied from the UI guidance consulted for this panel:
     - The consequential action asks first and names who it affects (#35).
     - Every write says so afterwards, and offers undo (#83).
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

  var state = { q: '', status: '', city: '', sort: 'recent', page: 1 };
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
      city: query.city || '',
      sort: query.sort || 'recent',
      page: Math.max(1, parseInt(query.page, 10) || 1)
    };
  }

  function writeState() {
    var parts = [];
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.status) parts.push('status=' + encodeURIComponent(state.status));
    if (state.city) parts.push('city=' + encodeURIComponent(state.city));
    if (state.sort && state.sort !== 'recent') parts.push('sort=' + state.sort);
    if (state.page > 1) parts.push('page=' + state.page);

    var url = '/admin/customers' + (parts.length ? '?' + parts.join('&') : '');
    if (window.history.replaceState) window.history.replaceState({}, '', url);
  }

  function hasFilters() {
    return !!(state.q || state.status || state.city);
  }

  /* -----------------------------------------------------------------------
     Page
     ----------------------------------------------------------------------- */

  ZB.adminPages.customers = {

    title: 'Customers',
    crumbs: [{ label: 'Customers' }],

    render: function () {
      return '' +
        ui.pageHead({
          title: 'Customers',
          sub: 'Who is buying.'
        }) +

        '<div class="a-metrics" id="a-cus-metrics" aria-busy="true">' +
          metricTile('total', 'Customers') +
          metricTile('new', 'Joined in 30 days') +
          metricTile('average', 'Average spend') +
          metricTile('blocked', 'Blocked') +
        '</div>' +

        '<div class="a-card">' +

          '<div class="a-toolbar">' +
            '<div class="a-search">' +
              '<label class="visually-hidden" for="a-cus-search">Search customers</label>' +
              '<span class="a-search__icon" aria-hidden="true">' + ui.icon('search') + '</span>' +
              '<input class="a-search__input" id="a-cus-search" type="search"' +
                    ' placeholder="Search by name, email or city" autocomplete="off">' +
            '</div>' +

            '<div class="a-toolbar__selects" id="a-cus-selects"></div>' +
          '</div>' +

          '<div class="a-chips" id="a-cus-chips" hidden></div>' +

          '<div class="a-resultbar">' +
            '<p class="a-resultbar__count" id="a-cus-count" role="status"></p>' +
            '<p class="a-resultbar__note" id="a-cus-note" hidden></p>' +
          '</div>' +

          '<div class="a-card__body a-card__body--flush" id="a-cus-body" aria-busy="true">' +
            '<div class="a-skeleton" aria-hidden="true">' +
              new Array(8).join('|').split('|').map(function () {
                return '<div class="a-skeleton__row"></div>';
              }).join('') +
            '</div>' +
          '</div>' +

          '<div class="a-pager" id="a-cus-pager" hidden></div>' +

        '</div>';
    },

    mount: function (params) {
      var body = document.getElementById('a-cus-body');
      if (!body) return;

      readState(params);
      lastResult = null;

      var search = document.getElementById('a-cus-search');
      search.value = state.q;

      search.addEventListener('input', ZB.util.debounce(function () {
        state.q = search.value.trim();
        state.page = 1;
        writeState();
        load();
      }, 250));

      document.addEventListener('click', onClick);
      document.addEventListener('change', onChange);

      ZB.repo.customers.facets().then(function (result) {
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

        var toggle = e.target.closest('[data-block]');
        if (toggle) {
          confirmBlock(toggle.getAttribute('data-block'),
                       toggle.getAttribute('data-to'),
                       toggle.getAttribute('data-name'));
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
          state.q = ''; state.status = ''; state.city = ''; state.page = 1;
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
    var body = document.getElementById('a-cus-body');
    if (!body) return;

    body.setAttribute('aria-busy', 'true');
    if (lastResult) body.classList.add('is-refreshing');

    ZB.repo.customers.list({
      search: state.q,
      status: state.status,
      city: state.city,
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

  function loadMetrics() {
    var host = document.getElementById('a-cus-metrics');
    if (!host) return;

    ZB.repo.customers.summary().then(function (sum) {
      if (!document.body.contains(host)) return;

      setMetric('total', String(sum.total));
      setMetric('new', String(sum.joinedRecently));
      setMetric('average', ZB.adminChart.compact(sum.average));
      setMetric('blocked', String(sum.blocked));
      host.setAttribute('aria-busy', 'false');
    });
  }

  /* -----------------------------------------------------------------------
     Painting
     ----------------------------------------------------------------------- */

  function metricTile(key, label) {
    return '' +
      '<div class="a-stat a-metric">' +
        '<p class="a-stat__label">' + ui.esc(label) + '</p>' +
        '<p class="a-stat__value" id="a-cus-m-' + key + '">—</p>' +
      '</div>';
  }

  function setMetric(key, value) {
    var el = document.getElementById('a-cus-m-' + key);
    if (el) el.textContent = value;
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
    var host = document.getElementById('a-cus-selects');
    if (!host || !facets) return;

    /* Offered only when there is more than one value to choose between —
       the same rule the rest of the panel follows. Nobody is blocked until
       somebody blocks them. */
    var statusSelect = facets.statuses.length > 1
      ? select({
          id: 'a-cus-status', name: 'status', label: 'Account status',
          anyLabel: 'Any status', options: facets.statuses, value: state.status
        })
      : '';

    host.innerHTML =
      select({
        id: 'a-cus-city', name: 'city', label: 'City',
        anyLabel: 'All cities', options: facets.cities, value: state.city
      }) +
      statusSelect +
      select({
        id: 'a-cus-sort', name: 'sort', label: 'Sort by',
        anyLabel: 'Newest members',
        options: ZB.repo.customers.sorts.filter(function (s) { return s.id !== 'recent'; }),
        value: state.sort === 'recent' ? '' : state.sort
      });
  }

  function labelFor(list, id) {
    var hit = (list || []).filter(function (item) {
      return String(item.id) === String(id);
    })[0];
    return hit ? hit.label : id;
  }

  function paintChips() {
    var host = document.getElementById('a-cus-chips');
    if (!host) return;

    var chips = [];
    if (state.q) chips.push({ key: 'q', label: 'Search: ' + state.q });
    if (state.city) {
      chips.push({ key: 'city', label: labelFor(facets && facets.cities, state.city) });
    }
    if (state.status) {
      chips.push({
        key: 'status',
        label: labelFor(facets && facets.statuses, state.status) + ' accounts'
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
    var count = document.getElementById('a-cus-count');
    var note = document.getElementById('a-cus-note');
    if (!count) return;

    var from = (result.page - 1) * result.perPage + 1;
    var to = Math.min(result.page * result.perPage, result.total);

    count.textContent = result.total
      ? 'Showing ' + from + '–' + to + ' of ' + result.total + ' customers · ' +
        ui.money(result.spent) + ' spent between them'
      : 'No customers found';

    if (note) {
      var dirty = ZB.repo.customers.hasUnsavedEdits();
      note.hidden = !dirty;
      note.textContent = dirty
        ? 'Account changes are held in this tab only and are lost on reload — ' +
          'there is no database yet.'
        : '';
    }
  }

  function paintTable(result) {
    var body = document.getElementById('a-cus-body');
    if (!body) return;

    if (!result.total) {
      body.innerHTML = hasFilters() ? noMatches() : noCustomers();
      return;
    }

    var rows = result.items.map(function (person) {
      var blocked = person.status !== 'active';
      var href = ui.href('/admin/customers/' + encodeURIComponent(person.id));

      return '' +
        '<tr>' +
          '<th scope="row" class="a-cell--name">' +
            '<span class="a-who">' +
              '<span class="a-who__mark" aria-hidden="true">' +
                ui.esc(initialsOf(person.name)) +
              '</span>' +
              '<span class="a-who__body">' +
                '<a href="' + href + '">' + ui.esc(person.name) + '</a>' +
                '<span class="a-cell__meta">' + ui.esc(person.email) + '</span>' +
              '</span>' +
            '</span>' +
          '</th>' +
          '<td>' + ui.esc(person.city) + '</td>' +
          '<td class="a-num">' + person.orders + '</td>' +
          '<td class="a-num">' + ui.esc(ZB.adminChart.full(person.spent)) + '</td>' +
          '<td class="a-cell--date">' + lastOrderCell(person) + '</td>' +
          '<td>' + ui.statusPill(blocked ? 'cancelled' : 'active',
                                 blocked ? 'Blocked' : 'Active') + '</td>' +
          '<td class="a-cell--actions">' +
            '<div class="a-rowactions">' +
              '<button class="a-iconbtn' + (blocked ? '' : ' a-iconbtn--danger') + '"' +
                     ' type="button" data-block="' + ui.esc(person.id) + '"' +
                     ' data-to="' + (blocked ? 'active' : 'blocked') + '"' +
                     ' data-name="' + ui.esc(person.name) + '"' +
                     ' title="' + (blocked ? 'Unblock' : 'Block') + '"' +
                     ' aria-label="' + (blocked ? 'Unblock ' : 'Block ') +
                                       ui.esc(person.name) + '">' +
                ui.icon(blocked ? 'check' : 'close') +
              '</button>' +
              '<a class="a-iconbtn" href="' + href + '"' +
                 ' title="Open" aria-label="Open ' + ui.esc(person.name) + '">' +
                ui.icon('chevron') +
              '</a>' +
            '</div>' +
          '</td>' +
        '</tr>';
    }).join('');

    body.innerHTML =
      '<table class="a-table a-table--customers">' +
        '<thead><tr>' +
          '<th scope="col">Customer</th>' +
          '<th scope="col">City</th>' +
          '<th scope="col" class="a-num">Orders</th>' +
          '<th scope="col" class="a-num">Spent</th>' +
          '<th scope="col">Last order</th>' +
          '<th scope="col">Account</th>' +
          '<th scope="col"><span class="visually-hidden">Actions</span></th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>';
  }

  /**
   * When they last bought, and whether that is a problem.
   *
   * "Never" and "8 months ago" are both worth noticing, and neither is
   * obvious from a date alone — so the quiet ones are marked rather than
   * left to be worked out by subtraction from today.
   */
  function lastOrderCell(person) {
    if (person.lastOrderDaysAgo === null) {
      return '<span class="a-quiet">Never ordered</span>';
    }

    var quiet = person.lastOrderDaysAgo >= 60;
    return '<span' + (quiet ? ' class="a-quiet"' : '') + '>' +
             ui.esc(ui.ago(person.lastOrderDaysAgo)) +
           '</span>';
  }

  /** Two letters from the name, for the avatar stand-in. */
  function initialsOf(name) {
    var bits = String(name).trim().split(/\s+/);
    return ((bits[0] || '')[0] || '') + ((bits[1] || '')[0] || '');
  }

  function noMatches() {
    return '' +
      '<div class="a-blank">' +
        '<p class="a-blank__title">No customers match those filters</p>' +
        '<p class="a-blank__body">Try a shorter search, or a different city.</p>' +
        '<button class="a-btn a-btn--ghost" type="button" data-clear-all>Clear all filters</button>' +
      '</div>';
  }

  function noCustomers() {
    return '' +
      '<div class="a-blank">' +
        '<p class="a-blank__title">No customers yet</p>' +
        '<p class="a-blank__body">' +
          'Anyone who buys from the store appears here.' +
        '</p>' +
      '</div>';
  }

  function paintPager(result) {
    var pager = document.getElementById('a-cus-pager');
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
     Blocking

     Shared with the customer detail view through ZB.adminPages.customersAsk,
     so the two screens ask the same question in the same words. The wording
     is the point: it says what blocking does here, which is change what the
     panel draws.
     ----------------------------------------------------------------------- */

  function confirmBlock(id, to, name, onDone) {
    var blocking = to === 'blocked';

    ZB.adminModal.confirm({
      title: blocking ? 'Block this account?' : 'Unblock this account?',
      body: blocking
        ? name + ' will be shown as blocked throughout the panel. This build ' +
          'has no accounts and no server, so nothing is actually prevented — ' +
          'the flag is a note to you until a backend enforces it.'
        : name + '’s account will be shown as active again.',
      confirmLabel: blocking ? 'Block the account' : 'Unblock',
      cancelLabel: 'Leave it',
      tone: blocking ? 'danger' : 'default'
    }).then(function (yes) {
      if (!yes) return;

      var previous = blocking ? 'active' : 'blocked';

      ZB.repo.customers.setStatus(id, to).then(function () {
        if (onDone) onDone();
        else { load(); loadMetrics(); }

        ZB.adminToast.success(
          name + (blocking ? ' is marked blocked.' : ' is active again.'),
          {
            label: 'Undo',
            onClick: function () {
              ZB.repo.customers.setStatus(id, previous).then(function () {
                if (onDone) onDone();
                else { load(); loadMetrics(); }
                ZB.adminToast.info(name + ' is back to ' + previous + '.');
              });
            }
          }
        );
      }).catch(function (failure) {
        ZB.adminToast.error(failure.message || 'That change was not applied.');
      });
    });
  }

  /* The detail view runs the same dialog rather than writing a second one
     with slightly different words. */
  ZB.adminPages.customersAsk = confirmBlock;

}(window.ZB));
