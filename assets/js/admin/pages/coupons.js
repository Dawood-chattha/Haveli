/* =========================================================================
   pages/coupons.js — the discount codes
   -------------------------------------------------------------------------
   Every code the shop would honour, what it takes off, and — the part a
   list of codes usually gets wrong — whether it is actually working right
   now.

   WHY THE STATE IS SHOWN AND NOT SET
   A coupon's state follows from its dates and its usage. Nobody types
   "expired"; a date passes. So the pill on each row is computed at the
   moment of asking (in admin-repo.js, once, for every screen), and the one
   thing a person decides — switched off or not — is the one thing the form
   offers. A dropdown containing "Expired" would eventually let somebody
   mark a live coupon expired while it went on being accepted, or the
   reverse, and this screen would then be lying about the till.

   WHY EVERY ROW SAYS WHY, NOT JUST WHAT
   "Expired" alone sends the reader to open the row and look at the dates.
   The row carries the reason beside the pill instead — ended 22 days ago,
   starts in three weeks, 500 of 500 used — because that is the sentence
   they were going to reconstruct anyway.

   HONESTY
   Nothing here reaches a checkout. There is no discount field in the cart
   and no server to validate a code against, so these rows describe what
   the shop WOULD honour once a backend exists. The page says so where it
   cannot be missed rather than letting a code that does nothing look like
   a code that works.

   Applied from the UI guidance consulted for this panel:
     - Deleting asks first and the confirmation offers undo (#35).
     - Switching a code off is one press with an undo, because it is
       reversible and routine (#35, #83).
     - An empty result is never a blank panel (#79, #90).
     - Refreshing holds the previous rows rather than collapsing them (#19).
     - Filter chips wrap; they are never clipped into one row (#115).
   ========================================================================= */

window.ZB = window.ZB || {};
window.ZB.adminPages = window.ZB.adminPages || {};

(function (ZB) {
  'use strict';

  var ui = ZB.adminUI;

  var PER_PAGE = 20;

  var state = { q: '', state: '', type: '', sort: 'ending-soon', page: 1 };
  var facets = null;
  var lastResult = null;
  var highlightId = null;

  /* -----------------------------------------------------------------------
     URL state — the same contract every other list in the panel uses.
     ----------------------------------------------------------------------- */

  function readState(params) {
    var query = (params && params.query) || {};
    state = {
      q: query.q || '',
      state: query.state || '',
      type: query.type || '',
      sort: query.sort || 'ending-soon',
      page: Math.max(1, parseInt(query.page, 10) || 1)
    };
  }

  function writeState() {
    var parts = [];
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.state) parts.push('state=' + encodeURIComponent(state.state));
    if (state.type) parts.push('type=' + encodeURIComponent(state.type));
    if (state.sort && state.sort !== 'ending-soon') parts.push('sort=' + state.sort);
    if (state.page > 1) parts.push('page=' + state.page);

    var url = '/admin/coupons' + (parts.length ? '?' + parts.join('&') : '');
    if (window.history.replaceState) window.history.replaceState({}, '', url);
  }

  function hasFilters() {
    return !!(state.q || state.state || state.type);
  }

  /* -----------------------------------------------------------------------
     Page
     ----------------------------------------------------------------------- */

  ZB.adminPages.coupons = {

    title: 'Coupons',
    crumbs: [{ label: 'Coupons' }],

    render: function () {
      return '' +
        ui.pageHead({
          title: 'Coupons',
          sub: 'Discount codes, and whether they are working today.',
          actions:
            '<button class="a-btn a-btn--primary" type="button" data-cp-add>' +
              ui.icon('plus') + 'Add coupon' +
            '</button>'
        }) +

        /* Said once, at the top, where it cannot be scrolled past: these
           codes are a plan, not a working discount. Anywhere quieter and
           somebody would hand a customer a code that does nothing. */
        '<div class="a-notice" role="note">' +
          ui.icon('warn') +
          '<p>' +
            '<strong>Codes are not accepted at the checkout yet.</strong> ' +
            'The cart has no discount field and there is no server to check a ' +
            'code against, so these rows describe what the shop would honour ' +
            'once a backend is connected.' +
          '</p>' +
        '</div>' +

        '<div class="a-metrics" id="a-cp-metrics" aria-busy="true">' +
          metricTile('live', 'Running now') +
          metricTile('soon', 'Ending within a week') +
          metricTile('scheduled', 'Scheduled') +
          metricTile('redemptions', 'Times redeemed') +
        '</div>' +

        '<div class="a-card">' +

          '<div class="a-toolbar">' +
            '<div class="a-search">' +
              '<label class="visually-hidden" for="a-cp-search">Search coupons</label>' +
              '<span class="a-search__icon" aria-hidden="true">' + ui.icon('search') + '</span>' +
              '<input class="a-search__input" id="a-cp-search" type="search"' +
                    ' placeholder="Search by code or description" autocomplete="off">' +
            '</div>' +

            '<div class="a-toolbar__selects" id="a-cp-selects"></div>' +
          '</div>' +

          '<div class="a-chips" id="a-cp-chips" hidden></div>' +

          '<div class="a-resultbar">' +
            '<p class="a-resultbar__count" id="a-cp-count" role="status"></p>' +
            '<p class="a-resultbar__note" id="a-cp-note" hidden></p>' +
          '</div>' +

          '<div class="a-card__body a-card__body--flush" id="a-cp-body" aria-busy="true">' +
            '<div class="a-skeleton" aria-hidden="true">' +
              new Array(8).join('|').split('|').map(function () {
                return '<div class="a-skeleton__row"></div>';
              }).join('') +
            '</div>' +
          '</div>' +

          '<div class="a-pager" id="a-cp-pager" hidden></div>' +

        '</div>';
    },

    mount: function (params) {
      var body = document.getElementById('a-cp-body');
      if (!body) return;

      readState(params);
      lastResult = null;

      var search = document.getElementById('a-cp-search');
      search.value = state.q;

      search.addEventListener('input', ZB.util.debounce(function () {
        state.q = search.value.trim();
        state.page = 1;
        writeState();
        load();
      }, 250));

      document.addEventListener('click', onClick);
      document.addEventListener('change', onChange);

      loadFacets();
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

        if (e.target.closest('[data-cp-add]')) { openAdd(); return; }

        var edit = e.target.closest('[data-cp-edit]');
        if (edit) { openEdit(edit.getAttribute('data-cp-edit')); return; }

        var toggle = e.target.closest('[data-cp-toggle]');
        if (toggle) {
          switchIt(toggle.getAttribute('data-cp-toggle'),
                   toggle.getAttribute('data-cp-to') === 'off');
          return;
        }

        var del = e.target.closest('[data-cp-delete]');
        if (del) { confirmDelete(del.getAttribute('data-cp-delete')); return; }

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
          state.q = ''; state.state = ''; state.type = '';
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

  /* -----------------------------------------------------------------------
     Loading
     ----------------------------------------------------------------------- */

  function loadFacets() {
    var body = document.getElementById('a-cp-body');

    return ZB.repo.coupons.facets().then(function (result) {
      if (!document.body.contains(body)) return null;
      facets = result;
      paintSelects();
      paintChips();
      return result;
    });
  }

  function load() {
    var body = document.getElementById('a-cp-body');
    if (!body) return;

    body.setAttribute('aria-busy', 'true');
    if (lastResult) body.classList.add('is-refreshing');

    ZB.repo.coupons.list({
      search: state.q,
      state: state.state,
      type: state.type,
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
    var host = document.getElementById('a-cp-metrics');
    if (!host) return;

    ZB.repo.coupons.summary().then(function (sum) {
      if (!document.body.contains(host)) return;

      setMetric('live', sum.live);
      setMetric('soon', sum.soon);
      setMetric('scheduled', sum.scheduled);
      setMetric('redemptions', sum.redemptions.toLocaleString('en-US'));
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
        '<p class="a-stat__value" id="a-cp-m-' + key + '">—</p>' +
      '</div>';
  }

  function setMetric(key, value) {
    var el = document.getElementById('a-cp-m-' + key);
    if (el) el.textContent = String(value);
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
    var host = document.getElementById('a-cp-selects');
    if (!host || !facets) return;

    host.innerHTML =
      select({
        id: 'a-cp-state', name: 'state', label: 'State',
        anyLabel: 'Any state', options: facets.states, value: state.state
      }) +
      (facets.types.length > 1
        ? select({
            id: 'a-cp-type', name: 'type', label: 'Discount type',
            anyLabel: 'Any discount', options: facets.types, value: state.type
          })
        : '') +
      select({
        id: 'a-cp-sort', name: 'sort', label: 'Sort by',
        anyLabel: 'Ending soonest',
        options: ZB.repo.coupons.sorts.filter(function (s) {
          return s.id !== 'ending-soon';
        }),
        value: state.sort === 'ending-soon' ? '' : state.sort
      });
  }

  function labelFor(list, id) {
    var hit = (list || []).filter(function (item) {
      return String(item.id) === String(id);
    })[0];
    return hit ? hit.label : id;
  }

  function paintChips() {
    var host = document.getElementById('a-cp-chips');
    if (!host) return;

    var chips = [];
    if (state.q) chips.push({ key: 'q', label: 'Search: ' + state.q });
    if (state.state) {
      chips.push({ key: 'state', label: labelFor(facets && facets.states, state.state) });
    }
    if (state.type) {
      chips.push({ key: 'type', label: labelFor(facets && facets.types, state.type) });
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
    var count = document.getElementById('a-cp-count');
    var note = document.getElementById('a-cp-note');
    if (!count) return;

    var from = (result.page - 1) * result.perPage + 1;
    var to = Math.min(result.page * result.perPage, result.total);

    count.textContent = result.total
      ? 'Showing ' + from + '–' + to + ' of ' + result.total + ' coupons'
      : 'No coupons found';

    if (note) {
      var dirty = ZB.repo.coupons.hasUnsavedEdits();
      note.hidden = !dirty;
      note.textContent = dirty
        ? 'Changes are held in this tab only — there is no database yet.'
        : '';
    }
  }

  /**
   * Why a coupon is in the state it is in, in words.
   *
   * The pill answers "what"; this answers "why", which is the question
   * that actually gets asked next. Written from the numbers the row
   * already carries, so it can never disagree with the pill beside it.
   */
  function reasonFor(row) {
    if (row.state === 'off') return 'Switched off by hand.';

    if (row.state === 'scheduled') {
      return 'Starts ' + relative(row.startsInDays) + ' — ' + ui.date(row.startsAt) + '.';
    }

    if (row.state === 'expired') {
      return 'Ended ' + relative(row.endsInDays) + ' — ' + ui.date(row.expiresAt) + '.';
    }

    if (row.state === 'used-up') {
      return 'All ' + row.usageLimit.toLocaleString('en-US') + ' uses have gone.';
    }

    return 'Runs until ' + ui.date(row.expiresAt) + ' — ' + relative(row.endsInDays) + '.';
  }

  /**
   * "in 3 days" / "12 days ago" / "today", from a signed day count.
   *
   * Written here rather than by stripping " ago" off ui.ago(), which looks
   * tempting and gets "in yesterday" and "in today" for its trouble —
   * the near words are irregular in both directions and have to be named.
   */
  function relative(days) {
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    if (days === -1) return 'yesterday';

    var n = Math.abs(days);
    var span = n < 14 ? n + ' days'
             : n < 60 ? Math.round(n / 7) + ' weeks'
             : Math.round(n / 30) + ' months';

    return days > 0 ? 'in ' + span : span + ' ago';
  }

  function paintTable(result) {
    var body = document.getElementById('a-cp-body');
    if (!body) return;

    if (!result.total) {
      body.innerHTML = hasFilters() ? noMatches() : noCoupons();
      return;
    }

    var rows = result.items.map(function (row) {
      var flash = row.id === highlightId;

      /* Composed rather than concatenated: two class attributes on one tag
         means the second is thrown away, and the one thrown away is
         whichever the browser happens to see second. */
      var classes = (row.live ? '' : 'a-quiet') + (flash ? ' is-new' : '');

      return '' +
        '<tr' + (classes ? ' class="' + classes.trim() + '"' : '') +
               (flash ? ' data-highlight' : '') + '>' +

          '<th scope="row" class="a-cell--code">' +
            '<span class="a-code">' + ui.esc(row.code) + '</span>' +
            (row.note ? '<span class="a-cell__meta">' + ui.esc(row.note) + '</span>' : '') +
          '</th>' +

          '<td>' +
            '<span class="a-cell__strong">' + ui.esc(row.discountLabel) + '</span>' +
            '<span class="a-cell__meta">' +
              (row.minSpend
                ? 'Over ' + ui.money(row.minSpend)
                : 'No minimum') +
            '</span>' +
          '</td>' +

          '<td>' +
            ui.statusPill(row.state, labelFor(ZB.repo.coupons.states, row.state)) +
            '<span class="a-cell__meta">' + ui.esc(reasonFor(row)) + '</span>' +
          '</td>' +

          '<td class="a-num a-cell--usage">' + usageCell(row) + '</td>' +

          '<td class="a-cell--actions">' +
            '<div class="a-rowactions">' +
              switchButton(row) +
              '<button class="a-iconbtn" type="button" data-cp-edit="' + ui.esc(row.id) + '"' +
                     ' title="Edit" aria-label="Edit ' + ui.esc(row.code) + '">' +
                ui.icon('sliders') +
              '</button>' +
              '<button class="a-iconbtn a-iconbtn--danger" type="button"' +
                     ' data-cp-delete="' + ui.esc(row.id) + '"' +
                     ' title="Delete" aria-label="Delete ' + ui.esc(row.code) + '">' +
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
      '<table class="a-table a-table--coupons">' +
        '<thead><tr>' +
          '<th scope="col">Code</th>' +
          '<th scope="col">Discount</th>' +
          '<th scope="col">State</th>' +
          '<th scope="col" class="a-num">Used</th>' +
          '<th scope="col"><span class="visually-hidden">Actions</span></th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>';

    var flash = body.querySelector('[data-highlight]');
    if (flash) {
      highlightId = null;
      var box = flash.getBoundingClientRect();
      if (box.top < 0 || box.bottom > window.innerHeight) {
        flash.scrollIntoView({
          block: 'center',
          behavior: ZB.reduceMotion ? 'auto' : 'smooth'
        });
      }
    }
  }

  /**
   * How much of the coupon is left.
   *
   * A bar only where there is a limit to be a proportion OF. An unlimited
   * code gets its count and the word "unlimited" instead — drawing an
   * empty track under a number that can never fill it would suggest a
   * ceiling that does not exist.
   */
  function usageCell(row) {
    if (!row.usageLimit) {
      return '' +
        '<span class="a-cell__strong">' + row.used.toLocaleString('en-US') + '</span>' +
        '<span class="a-cell__meta">No limit</span>';
    }

    return '' +
      '<span class="a-cell__strong">' +
        row.used.toLocaleString('en-US') +
        ' <span class="a-usage__of">of ' + row.usageLimit.toLocaleString('en-US') + '</span>' +
      '</span>' +
      '<span class="a-usage" aria-hidden="true">' +
        '<span class="a-usage__fill' + (row.limitReached ? ' is-full' : '') + '"' +
              ' style="width:' + row.usedShare + '%"></span>' +
      '</span>' +
      '<span class="visually-hidden">' + row.usedShare + '% of the limit used</span>';
  }

  /**
   * On/off in one press.
   *
   * Reversible, routine, and the same press puts it back — so it gets an
   * undo toast rather than a dialog. Only the delete gets a dialog, which
   * is what keeps that dialog worth reading.
   *
   * It is not offered on an expired coupon: switching on something the
   * calendar has already closed would change the pill from "Switched off"
   * to "Expired" and nothing else, which looks like a control that failed.
   */
  function switchButton(row) {
    if (row.state === 'expired') {
      return '<span class="a-iconbtn a-iconbtn--void" aria-hidden="true"></span>';
    }

    var off = row.disabled;

    return '' +
      '<button class="a-iconbtn' + (off ? '' : ' a-iconbtn--on') + '" type="button"' +
             ' data-cp-toggle="' + ui.esc(row.id) + '"' +
             ' data-cp-to="' + (off ? 'on' : 'off') + '"' +
             ' title="' + (off ? 'Switch on' : 'Switch off') + '"' +
             ' aria-label="' + (off ? 'Switch on ' : 'Switch off ') + ui.esc(row.code) + '">' +
        ui.icon(off ? 'check' : 'close') +
      '</button>';
  }

  function noMatches() {
    return '' +
      '<div class="a-blank">' +
        '<p class="a-blank__title">No coupons match those filters</p>' +
        '<p class="a-blank__body">Try a shorter search, or a different state.</p>' +
        '<button class="a-btn a-btn--ghost" type="button" data-clear-all>' +
          'Clear all filters' +
        '</button>' +
      '</div>';
  }

  function noCoupons() {
    return '' +
      '<div class="a-blank">' +
        '<p class="a-blank__title">No coupons yet</p>' +
        '<p class="a-blank__body">Add the first code and it appears here.</p>' +
        '<button class="a-btn a-btn--primary" type="button" data-cp-add>Add coupon</button>' +
      '</div>';
  }

  function paintPager(result) {
    var pager = document.getElementById('a-cp-pager');
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
     Add and edit
     ----------------------------------------------------------------------- */

  var fields = ZB.adminFields.make('cp');

  /**
   * The fields.
   *
   * `used` is not among them on either path. A redemption count is a
   * record of what customers did; typing one would be inventing sales that
   * did not happen, and every figure derived from it downstream would
   * inherit the invention.
   */
  function formBody(row) {
    row = row || {};
    var toDate = ZB.repo.coupons.toDateInput;

    var today = new Date();
    var inAMonth = new Date();
    inAMonth.setMonth(inAMonth.getMonth() + 1);

    return '' +
      fields.text({
        name: 'code', label: 'Code', value: row.code || '',
        help: 'What a customer types. Capitals, no spaces — it is stored in ' +
              'capitals whichever way it is typed.'
      }) +

      fields.text({
        name: 'note', label: 'Description', value: row.note || '',
        help: 'For your own list. Customers never see it.'
      }) +

      fields.select({
        name: 'type', label: 'Discount', value: row.type || 'percent',
        options: ZB.repo.coupons.types
      }) +

      fields.text({
        name: 'value', label: 'Amount', type: 'number', min: 0, step: '1',
        value: row.value === undefined ? '' : row.value,
        help: 'A percentage for “percentage off”, rupees for “fixed amount ' +
              'off”. Free delivery ignores it.'
      }) +

      fields.text({
        name: 'minSpend', label: 'Minimum spend', type: 'number', min: 0, step: '1',
        prefix: 'PKR',
        value: row.minSpend === undefined ? 0 : row.minSpend,
        help: '0 for no minimum.'
      }) +

      fields.text({
        name: 'startsAt', label: 'Starts', type: 'date',
        value: row.startsAt ? toDate(row.startsAt) : toDate(today)
      }) +

      fields.text({
        name: 'expiresAt', label: 'Ends', type: 'date',
        value: row.expiresAt ? toDate(row.expiresAt) : toDate(inAMonth),
        help: 'The coupon works all day on this date and stops after it.'
      }) +

      fields.text({
        name: 'usageLimit', label: 'Usage limit', type: 'number', min: 0, step: '1',
        value: row.usageLimit === undefined ? 0 : row.usageLimit,
        help: '0 for unlimited.'
      }) +

      fields.toggle({
        name: 'disabled', label: 'Switched off', value: !!row.disabled,
        help: 'Stops the code being accepted without changing its dates.'
      });
  }

  var FIELD_ORDER = ['code', 'note', 'type', 'value', 'minSpend',
                     'startsAt', 'expiresAt', 'usageLimit', 'disabled'];

  function readValues(form) {
    var fromDate = ZB.repo.coupons.fromDateInput;

    return {
      code: fields.valueOf(form, 'code'),
      note: fields.valueOf(form, 'note'),
      type: fields.valueOf(form, 'type'),
      value: fields.valueOf(form, 'value'),
      minSpend: fields.valueOf(form, 'minSpend'),
      startsRaw: fields.valueOf(form, 'startsAt'),
      endsRaw: fields.valueOf(form, 'expiresAt'),
      startsAt: fromDate(fields.valueOf(form, 'startsAt')),
      expiresAt: fromDate(fields.valueOf(form, 'expiresAt')),
      usageLimit: fields.valueOf(form, 'usageLimit'),
      disabled: fields.valueOf(form, 'disabled')
    };
  }

  /**
   * Returns { field: message } — empty when everything is fine.
   *
   * `used` is passed in on an edit so the usage limit cannot be set below
   * a number of redemptions that have already happened. Allowing it would
   * put the coupon into "used up" by rewriting history rather than by
   * anything a customer did, and 500 of 300 is not a sentence.
   */
  function validate(values, ignoreId, used) {
    var problems = {};

    if (!values.code) {
      problems.code = 'Give the coupon a code.';
    } else if (!/^[A-Za-z0-9-]+$/.test(values.code)) {
      problems.code = 'Letters, numbers and hyphens only — a space or a symbol ' +
                      'is impossible to read out over a phone.';
    } else if (values.code.length < 3) {
      problems.code = 'That code is too short.';
    } else if (values.code.length > 24) {
      problems.code = 'Keep the code under 24 characters.';
    } else if (ZB.repo.coupons.codeTaken(values.code, ignoreId)) {
      problems.code = 'There is already a coupon with that code.';
    }

    var amount = Number(values.value);

    if (values.type === 'percent') {
      if (!amount || amount < 1) problems.value = 'A percentage of at least 1.';
      else if (amount > 90) {
        problems.value = 'Over 90% off is almost certainly a typo. ' +
                         'Use a fixed amount if you mean it.';
      }
    } else if (values.type === 'fixed') {
      if (!amount || amount < 1) problems.value = 'An amount of at least PKR 1.';
      else if (values.minSpend && amount >= Number(values.minSpend)) {
        problems.value = 'The discount is not less than the minimum spend — ' +
                         'that order would come to nothing or less.';
      }
    }

    if (isNaN(values.startsAt)) problems.startsAt = 'Pick a start date.';
    if (isNaN(values.expiresAt)) problems.expiresAt = 'Pick an end date.';

    if (!isNaN(values.startsAt) && !isNaN(values.expiresAt) &&
        values.expiresAt < values.startsAt) {
      problems.expiresAt = 'The end date is before the start date.';
    }

    var limit = Number(values.usageLimit);
    if (limit < 0) problems.usageLimit = 'A limit cannot be negative.';
    else if (used && limit && limit < used) {
      problems.usageLimit = 'It has already been used ' + used + ' times — ' +
                            'a lower limit would rewrite what customers did.';
    }

    return problems;
  }

  function openAdd() {
    ZB.adminModal.form({
      title: 'Add a coupon',
      intro: 'It appears in this list straight away. Being accepted at a ' +
             'checkout needs a backend, which this build does not have yet.',
      submitLabel: 'Add coupon',
      body: formBody(null),

      onSubmit: function (form, done) {
        var values = readValues(form);
        var problems = validate(values, null, 0);

        if (Object.keys(problems).length) {
          fields.showErrors(form, problems, FIELD_ORDER);
          return;
        }

        ZB.repo.coupons.create(values).then(function (row) {
          done(true);
          highlightId = row.id;
          loadFacets();
          load();
          loadMetrics();

          /* Said in terms of what the coupon is doing, not of what was
             saved: a code created with a start date next month is not
             running, and the confirmation is the moment to say so rather
             than leaving it to be discovered in the pill. */
          ZB.adminToast.success('“' + row.code + '” added — ' +
            (row.live ? 'running now.' : reasonFor(row).toLowerCase()));
        });
      }
    });
  }

  function openEdit(id) {
    ZB.repo.coupons.get(id).then(function (row) {
      if (!row) {
        ZB.adminToast.error('That coupon no longer exists.');
        load();
        return;
      }

      ZB.adminModal.form({
        title: 'Edit coupon',
        intro: row.used
          ? 'Used ' + row.used.toLocaleString('en-US') + ' times so far. ' +
            'That count is a record of what customers did and is not editable.'
          : 'Never used yet.',
        submitLabel: 'Save changes',
        body: formBody(row),

        onSubmit: function (form, done) {
          var values = readValues(form);
          var problems = validate(values, id, row.used);

          if (Object.keys(problems).length) {
            fields.showErrors(form, problems, FIELD_ORDER);
            return;
          }

          ZB.repo.coupons.update(id, {
            code: values.code,
            note: values.note,
            type: values.type,
            value: Number(values.value) || 0,
            minSpend: Number(values.minSpend) || 0,
            startsAt: values.startsAt,
            expiresAt: values.expiresAt,
            usageLimit: Number(values.usageLimit) || 0,
            disabled: !!values.disabled
          })
            .then(function (saved) {
              done(true);
              highlightId = id;
              loadFacets();
              load();
              loadMetrics();
              ZB.adminToast.success('“' + saved.code + '” updated.');
            })
            .catch(function (failure) {
              done(true);
              ZB.adminToast.error(failure.message || 'That could not be saved.');
              load();
            });
        }
      });
    });
  }

  /* -----------------------------------------------------------------------
     Switch on and off
     ----------------------------------------------------------------------- */

  function switchIt(id, off) {
    ZB.repo.coupons.update(id, { disabled: off }).then(function (row) {
      loadFacets();
      load();
      loadMetrics();

      /* What it means now, not what field changed. Switching a scheduled
         coupon on does not make it run, and saying "switched on" alone
         would imply it did. */
      var text = off
        ? '“' + row.code + '” switched off.'
        : '“' + row.code + '” switched on — ' +
          (row.live ? 'running now.' : reasonFor(row).toLowerCase());

      ZB.adminToast.success(text, {
        label: 'Undo',
        onClick: function () {
          ZB.repo.coupons.update(id, { disabled: !off }).then(function () {
            loadFacets();
            load();
            loadMetrics();
          });
        }
      });
    });
  }

  /* -----------------------------------------------------------------------
     Delete
     ----------------------------------------------------------------------- */

  function confirmDelete(id) {
    ZB.repo.coupons.get(id).then(function (row) {
      if (!row) { load(); return; }

      var body = '“' + row.code + '” will be removed from the list.';

      /* A used coupon is a record as well as a rule. Deleting it in a real
         shop takes the discount off a report that has already been read,
         so the dialog says which one this is before the button is pressed. */
      if (row.used) {
        body += ' It has been redeemed ' + row.used.toLocaleString('en-US') +
                ' times; once there is a backend, deleting a code that has ' +
                'been used would take those redemptions out of your reports.';
      }

      if (row.live) {
        body += ' It is running right now, so anybody holding the code loses it.';
      }

      body += ' This build has no database, so the change lasts until reload.';

      ZB.adminModal.confirm({
        title: 'Delete this coupon?',
        body: body,
        confirmLabel: 'Delete coupon',
        cancelLabel: 'Keep it',
        tone: 'danger'
      }).then(function (yes) {
        if (!yes) return;

        ZB.repo.coupons.remove(id).then(function (undo) {
          loadFacets();
          load();
          loadMetrics();

          ZB.adminToast.success('“' + row.code + '” deleted.', {
            label: 'Undo',
            onClick: function () {
              ZB.repo.coupons.restore(undo).then(function () {
                highlightId = id;
                loadFacets();
                load();
                loadMetrics();
                ZB.adminToast.info('“' + row.code + '” restored.');
              });
            }
          });
        });
      });
    });
  }

}(window.ZB));
