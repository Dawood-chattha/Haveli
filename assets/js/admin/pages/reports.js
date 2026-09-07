/* =========================================================================
   pages/reports.js — what happened over a period
   -------------------------------------------------------------------------
   WHY THIS IS NOT A SECOND DASHBOARD
   The obvious way to build a reports screen is to draw the dashboard again
   with a wider date picker, and it is the wrong way: the reader already
   has the dashboard, and a screen that repeats it teaches them to skip
   one of the two. The dashboard answers "how are we doing right now" —
   a glance, a recent window, a way out to the screen where something gets
   done. This answers "what happened over a period, and what does it break
   down into". So the things that are only here are the things a glance
   cannot hold: composition (which departments, which payment methods,
   which customers), comparison against the period before, and the numbers
   that only mean something once a period is named — average order value,
   cancellation rate, how much of the catalogue sold at all.

   THE PERIOD CONTROL SCOPES EVERY SECTION
   One control row above everything, exactly as on the dashboard. Two
   figures on this screen always describe the same slice of time; a filter
   living inside one card would silently disagree with the card beside it.

   THE HISTORY HAS AN EDGE AND THIS SCREEN SAYS SO
   There are ninety days of orders. A period reaching past that is clamped
   and the clamp is stated, and a comparison whose previous window falls
   off the end is omitted rather than printed — "sales down 60%" against a
   window that is half missing is not a fact, it is an artefact of where
   the data stops.

   FORM DECISIONS
     - Revenue over time is the only line chart: it is the only trend.
     - Every split is a ranked list with a share bar, never a pie. Three
       or more slices in a pie cannot be compared by eye, and these splits
       routinely have five.
     - One axis everywhere. Orders and revenue are never plotted together
       on two scales.
     - Every chart and every bar list has the same numbers in a table
       beside it, reachable without a pointer.
     - Colour never carries a meaning on its own: each bar is labelled
       with its own figure and its share in words.
   ========================================================================= */

window.ZB = window.ZB || {};
window.ZB.adminPages = window.ZB.adminPages || {};

(function (ZB) {
  'use strict';

  var ui = ZB.adminUI;
  var chart = ZB.adminChart;

  /* The period, held across repaints and reset on a fresh mount. */
  var state = { preset: '30', from: '', to: '' };
  var liveChart = null;
  var lastRange = null;

  function money(n) { return 'PKR ' + chart.full(n); }

  /* -----------------------------------------------------------------------
     URL state
     ----------------------------------------------------------------------- */

  function readState(params) {
    var query = (params && params.query) || {};
    state = {
      preset: query.from || query.to ? '' : (query.preset || '30'),
      from: query.from || '',
      to: query.to || ''
    };
  }

  function writeState() {
    var parts = [];
    if (state.from) parts.push('from=' + encodeURIComponent(state.from));
    if (state.to) parts.push('to=' + encodeURIComponent(state.to));
    if (!state.from && !state.to && state.preset && state.preset !== '30') {
      parts.push('preset=' + encodeURIComponent(state.preset));
    }

    var url = '/admin/reports' + (parts.length ? '?' + parts.join('&') : '');
    if (window.history.replaceState) window.history.replaceState({}, '', url);
  }

  function options() {
    return state.from || state.to
      ? { from: state.from, to: state.to }
      : { preset: state.preset };
  }

  /* -----------------------------------------------------------------------
     Page
     ----------------------------------------------------------------------- */

  ZB.adminPages.reports = {

    title: 'Reports',
    crumbs: [{ label: 'Reports' }],

    render: function () {
      return '' +
        ui.pageHead({
          title: 'Reports',
          sub: 'What the store did over a period you choose.'
        }) +

        periodBar() +

        '<p class="a-report__scope" id="a-rp-scope" role="status"></p>' +

        '<div class="a-report" id="a-rp" aria-busy="true">' +

          '<section class="a-report__stats" id="a-rp-stats" aria-label="Headline figures">' +
            new Array(6).join('|').split('|').map(function () {
              return '<div class="a-stat a-stat--loading"></div>';
            }).join('') +
          '</section>' +

          card('revenue', 'Revenue over time',
               'The only trend on this page, so the only chart.',
               '<div class="a-chart" id="a-rp-revenue"></div>' +
               '<div class="a-chart__table" id="a-rp-revenue-table" hidden></div>',
               true) +

          '<div class="a-report__pair">' +
            card('status', 'Orders by stage',
                 'In the order the stages happen, never ranked by size. ' +
                 'The share is of orders.',
                 '<div id="a-rp-status"></div>') +
            card('payment', 'How they paid',
                 'Ranked by the money each method brought in. ' +
                 'The share is of revenue.',
                 '<div id="a-rp-payment"></div>') +
          '</div>' +

          card('dept', 'Where the money came from',
               'Revenue by department. The share is of revenue.',
               '<div id="a-rp-dept"></div>') +

          card('products', 'Product performance',
               'The best sellers, and how much of the catalogue moved at all.',
               '<div id="a-rp-products"></div>') +

          card('customers', 'Customers',
               'Who bought, and whether they had bought before.',
               '<div id="a-rp-customers"></div>') +

        '</div>';
    },

    mount: function (params) {
      var root = document.getElementById('a-rp');
      if (!root) return;

      readState(params);
      lastRange = null;
      syncControls();
      load(true);

      document.addEventListener('click', onClick);
      document.addEventListener('change', onChange);

      function gone() {
        if (document.body.contains(root)) return false;
        document.removeEventListener('click', onClick);
        document.removeEventListener('change', onChange);
        if (liveChart) { liveChart.destroy(); liveChart = null; }
        return true;
      }

      function onChange(e) {
        if (gone()) return;

        var date = e.target.closest('[data-rp-date]');
        if (!date) return;

        state[date.getAttribute('data-rp-date')] = date.value;
        state.preset = '';
        writeState();
        syncControls();
        load(false);
      }

      function onClick(e) {
        if (gone()) return;

        var preset = e.target.closest('[data-rp-preset]');
        if (preset) {
          var id = preset.getAttribute('data-rp-preset');
          if (id === state.preset) return;
          state.preset = id;
          state.from = '';
          state.to = '';
          writeState();
          syncControls();
          load(false);
          return;
        }

        var toggle = e.target.closest('[data-rp-toggle]');
        if (toggle) {
          var key = toggle.getAttribute('data-rp-toggle');
          var plot = document.getElementById('a-rp-' + key);
          var table = document.getElementById('a-rp-' + key + '-table');
          if (!plot || !table) return;

          var showTable = table.hidden;
          table.hidden = !showTable;
          plot.hidden = showTable;
          toggle.setAttribute('aria-expanded', String(showTable));
          toggle.textContent = showTable ? 'Chart' : 'Table';
          return;
        }

        var csv = e.target.closest('[data-rp-csv]');
        if (csv) download(csv.getAttribute('data-rp-csv'));
      }
    }
  };

  /* -----------------------------------------------------------------------
     Chrome
     ----------------------------------------------------------------------- */

  /**
   * A section card.
   *
   * `chartable` sections get a Table button, which is not a filter but a
   * second way to read the same numbers — a line cannot be read at all by
   * somebody using a screen reader, and a tooltip must never be the only
   * route to a value.
   */
  function card(key, title, sub, body, chartable) {
    return '' +
      '<section class="a-card a-report__card" aria-labelledby="a-rp-' + key + '-title">' +
        '<header class="a-card__head">' +
          '<div>' +
            '<h2 class="a-card__title" id="a-rp-' + key + '-title">' + ui.esc(title) + '</h2>' +
            '<p class="a-card__sub">' + ui.esc(sub) + '</p>' +
          '</div>' +
          '<div class="a-card__aside">' +
            (chartable
              ? '<button class="a-card__toggle" type="button" data-rp-toggle="' + key + '"' +
                       ' aria-expanded="false" aria-controls="a-rp-' + key + '-table">Table</button>'
              : '') +
            '<button class="a-card__toggle" type="button" data-rp-csv="' + key + '">' +
              'CSV' +
            '</button>' +
          '</div>' +
        '</header>' +
        '<div class="a-card__body">' + body + '</div>' +
      '</section>';
  }

  function periodBar() {
    var presets = ZB.repo.reports.presets.map(function (item) {
      return '<button class="a-range__option" type="button" data-rp-preset="' + item.id + '"' +
                    ' aria-pressed="false">' + ui.esc(item.label) + '</button>';
    }).join('');

    return '' +
      '<div class="a-period">' +
        '<div class="a-range" role="group" aria-label="Reporting period">' + presets + '</div>' +
        '<div class="a-period__custom">' +
          '<span class="a-period__word">or</span>' +
          '<span class="a-period__field">' +
            '<label for="a-rp-from">From</label>' +
            '<input class="a-input a-input--date" id="a-rp-from" type="date"' +
                  ' data-rp-date="from">' +
          '</span>' +
          '<span class="a-period__field">' +
            '<label for="a-rp-to">To</label>' +
            '<input class="a-input a-input--date" id="a-rp-to" type="date"' +
                  ' data-rp-date="to">' +
          '</span>' +
        '</div>' +
      '</div>';
  }

  function syncControls() {
    ZB.util.all('[data-rp-preset]').forEach(function (button) {
      button.setAttribute('aria-pressed',
        String(button.getAttribute('data-rp-preset') === state.preset));
    });

    var from = document.getElementById('a-rp-from');
    var to = document.getElementById('a-rp-to');
    if (from) from.value = state.from;
    if (to) to.value = state.to;
  }

  /* -----------------------------------------------------------------------
     Loading
     ----------------------------------------------------------------------- */

  function load(first) {
    var root = document.getElementById('a-rp');
    if (!root) return;

    /* Hold the previous render rather than tearing it down to skeletons.
       Nothing jumps, and the figure the reader was looking at stays on
       screen while the next one arrives. */
    if (!first) root.classList.add('is-refreshing');
    root.setAttribute('aria-busy', 'true');

    var query = options();

    Promise.all([
      ZB.repo.reports.overview(query),
      ZB.repo.reports.series(query),
      ZB.repo.reports.breakdown(query),
      ZB.repo.reports.products(query, 10),
      ZB.repo.reports.customers(query, 8)
    ]).then(function (results) {
      if (!document.body.contains(root)) return;

      lastRange = results[0].range;

      paintScope(results[0].range);
      paintStats(results[0]);
      paintChart(results[1], results[0].range);
      paintStatus(results[2]);
      paintPayment(results[2]);
      paintDepartments(results[2]);
      paintProducts(results[3]);
      paintCustomers(results[4]);

      /* The custom date inputs are filled from the resolved window, not
         from what was typed: a date outside the history is clamped, and
         leaving the field showing the unclamped value would have the
         control disagree with the report under it. */
      if (state.from || state.to) {
        state.from = ZB.repo.reports.toDateInput(results[0].range.fromDate);
        state.to = ZB.repo.reports.toDateInput(results[0].range.toDate);

        var from = document.getElementById('a-rp-from');
        var to = document.getElementById('a-rp-to');
        if (from) from.value = state.from;
        if (to) to.value = state.to;

        /* The address is rewritten to the clamped dates as well, so a link
           to this report cannot open showing a period different from the
           one its own URL names. */
        writeState();
      }

      root.classList.remove('is-refreshing');
      root.setAttribute('aria-busy', 'false');
    });
  }

  /* -----------------------------------------------------------------------
     Scope line

     What period is on screen, in words, above everything it describes —
     and any way in which it is not the period that was asked for.
     ----------------------------------------------------------------------- */

  function paintScope(range) {
    var host = document.getElementById('a-rp-scope');
    if (!host) return;

    var text = ui.date(range.fromDate) + ' to ' + ui.date(range.toDate) +
               ' — ' + range.days + (range.days === 1 ? ' day' : ' days');

    var notes = [];
    if (range.clampedStart) {
      notes.push('There are only ' + range.historyDays + ' days of orders, ' +
                 'so the period starts where the records do.');
    }
    if (range.clampedEnd) {
      notes.push('There are no orders after today, so the period ends there.');
    }
    if (!range.previous.complete) {
      notes.push('No comparison: the period before this one falls outside the records.');
    }

    host.innerHTML =
      '<span class="a-report__period">' + ui.esc(text) + '</span>' +
      (notes.length
        ? '<span class="a-report__caveat">' + ui.icon('warn') +
            ui.esc(notes.join(' ')) +
          '</span>'
        : '');
  }

  /* -----------------------------------------------------------------------
     Headline figures

     Six tiles, not six charts. A single value with a change against the
     period before is a tile; drawing each as a one-bar bar chart is the
     commonest way a report misses its own point.
     ----------------------------------------------------------------------- */

  function paintStats(result) {
    var host = document.getElementById('a-rp-stats');
    if (!host) return;

    var now = result.now;

    host.innerHTML =
      stat('Revenue', money(now.revenue), result.change.revenue, result.range) +
      stat('Orders', chart.full(now.orders), result.change.orders, result.range) +
      stat('Items sold', chart.full(now.units), result.change.units, result.range) +
      stat('Average order', money(Math.round(now.average)), result.change.average, result.range) +
      stat('New customers', chart.full(now.newCustomers),
           result.change.newCustomers, result.range) +
      /* Cancellation rate has no change line. It is a rate, and a
         percentage change of a percentage ("cancellations up 40%" when
         they went from 2.5% to 3.5%) is the sort of number that gets
         repeated in a meeting and understood by nobody. */
      stat('Cancelled', now.cancelRate.toFixed(1) + '%', undefined, result.range,
           now.cancelled + ' of ' + now.orders + ' orders, ' +
           money(now.cancelledValue) + ' not taken');
  }

  function stat(label, value, change, range, foot) {
    return '' +
      '<div class="a-stat">' +
        '<p class="a-stat__label">' + ui.esc(label) + '</p>' +
        '<p class="a-stat__value">' + ui.esc(value) + '</p>' +
        (foot
          ? '<p class="a-stat__delta a-stat__delta--none">' + ui.esc(foot) + '</p>'
          : delta(change, range)) +
      '</div>';
  }

  /**
   * The change line.
   *
   * Signed, named against the period it compares with, and carrying an
   * arrow and the word "up" or "down" as well as a colour — a reader who
   * cannot separate the green from the red still gets the direction.
   * `undefined` means the figure has no comparison by design; `null` means
   * there was no period to compare against, and the two say so
   * differently rather than both drawing nothing.
   */
  function delta(change, range) {
    if (change === undefined) return '';

    if (change === null || !isFinite(change)) {
      return '<p class="a-stat__delta a-stat__delta--none">' +
               (range && !range.previous.complete
                 ? 'No earlier period to compare with'
                 : 'Nothing to compare with') +
             '</p>';
    }

    var up = change >= 0;
    var arrow = up ? 'M7 3.5 3 8h8L7 3.5Z' : 'M7 10.5 3 6h8l-4 4.5Z';

    return '' +
      '<p class="a-stat__delta a-stat__delta--' + (up ? 'up' : 'down') + '">' +
        '<svg viewBox="0 0 14 14" aria-hidden="true" class="a-stat__arrow">' +
          '<path d="' + arrow + '"/>' +
        '</svg>' +
        '<span class="visually-hidden">' + (up ? 'up ' : 'down ') + '</span>' +
        Math.abs(change).toFixed(1) + '%' +
        '<span class="a-stat__vs"> vs the ' + range.days + ' days before</span>' +
      '</p>';
  }

  /* -----------------------------------------------------------------------
     The chart
     ----------------------------------------------------------------------- */

  function paintChart(series, range) {
    var plot = document.getElementById('a-rp-revenue');
    var table = document.getElementById('a-rp-revenue-table');
    if (!plot) return;

    if (liveChart) { liveChart.destroy(); liveChart = null; }

    liveChart = chart.area(plot, {
      series: series,
      height: 280,
      valueLabel: 'Sales'
    });

    if (table) table.innerHTML = chart.seriesTable(series);

    /* Referenced so a range with no orders at all is not a blank card. */
    if (!series.some(function (point) { return point.orders; })) {
      plot.innerHTML = '<p class="a-report__empty">No orders in this period.</p>';
    }
  }

  /* -----------------------------------------------------------------------
     Splits

     A ranked list with a bar, never a pie. Five slices in a pie cannot be
     compared by eye, and every split on this page routinely has five.
     Each row carries its own figure and its share in words, so the bar is
     a convenience and not the only way to read it.
     ----------------------------------------------------------------------- */

  function bars(rows, o) {
    if (!rows.length) {
      return '<p class="a-report__empty">Nothing in this period.</p>';
    }

    return '<ul class="a-bars">' + rows.map(function (row) {
      return '' +
        '<li class="a-bars__row' + (o.quiet && o.quiet(row) ? ' a-bars__row--quiet' : '') + '">' +
          '<span class="a-bars__label">' + ui.esc(o.label(row)) + '</span>' +
          '<span class="a-bars__value">' + ui.esc(o.value(row)) + '</span>' +
          '<span class="a-bars__track" aria-hidden="true">' +
            '<span class="a-bars__fill" style="width:' +
                  Math.max(row.share, row.share > 0 ? 1.5 : 0).toFixed(2) + '%"></span>' +
          '</span>' +
          '<span class="a-bars__share">' + row.share.toFixed(1) + '%</span>' +
          (o.meta ? '<span class="a-bars__meta">' + ui.esc(o.meta(row)) + '</span>' : '') +
        '</li>';
    }).join('') + '</ul>';
  }

  function paintStatus(result) {
    var host = document.getElementById('a-rp-status');
    if (!host) return;

    host.innerHTML = bars(result.statuses, {
      label: function (row) { return row.label; },
      value: function (row) {
        return row.orders + (row.orders === 1 ? ' order' : ' orders');
      },
      /* Cancelled orders sit in the sequence but carry no revenue, so the
         row says so instead of showing a money figure that is not money. */
      meta: function (row) {
        return row.id === 'cancelled' ? 'Not counted as revenue' : money(row.value);
      },
      quiet: function (row) { return row.id === 'cancelled'; }
    });
  }

  function paintPayment(result) {
    var host = document.getElementById('a-rp-payment');
    if (!host) return;

    host.innerHTML = bars(result.payments, {
      label: function (row) { return row.label; },
      value: function (row) { return money(row.value); },
      meta: function (row) {
        return row.orders + (row.orders === 1 ? ' order' : ' orders');
      }
    });
  }

  function paintDepartments(result) {
    var host = document.getElementById('a-rp-dept');
    if (!host) return;

    host.innerHTML = bars(result.departments, {
      label: function (row) { return row.label; },
      value: function (row) { return money(row.revenue); },
      meta: function (row) { return chart.full(row.units) + ' items'; }
    });
  }

  /* -----------------------------------------------------------------------
     Products

     The top ten, and the half a top-ten list always leaves out: how much
     of the catalogue sold nothing at all. A shop with 560 products and 190
     that moved in a quarter has a problem no ranking of the best sellers
     will ever show it.
     ----------------------------------------------------------------------- */

  function paintProducts(result) {
    var host = document.getElementById('a-rp-products');
    if (!host) return;

    if (!result.items.length) {
      host.innerHTML = '<p class="a-report__empty">Nothing sold in this period.</p>';
      return;
    }

    var rows = result.items.map(function (row, i) {
      return '' +
        '<tr>' +
          '<td class="a-num a-cell--rank">' + (i + 1) + '</td>' +
          '<th scope="row" class="a-cell--product">' +
            '<img class="a-thumb" src="' + ui.esc(row.image || '') + '" alt=""' +
                ' loading="lazy" width="40" height="52">' +
            '<a class="a-cell__strong" href="' +
               ui.href('/admin/products/' + encodeURIComponent(row.id) + '/edit') + '">' +
              ui.esc(row.title) +
            '</a>' +
          '</th>' +
          '<td class="a-num">' + chart.full(row.units) + '</td>' +
          '<td class="a-num">' + row.orders + '</td>' +
          '<td class="a-num a-cell__strong">' + ui.esc(money(row.revenue)) + '</td>' +
          '<td class="a-num">' + row.share.toFixed(1) + '%</td>' +
        '</tr>';
    }).join('');

    host.innerHTML =
      '<div class="a-report__scroll">' +
        '<table class="a-table a-table--compact a-table--top">' +
          '<caption class="visually-hidden">Best selling products in this period</caption>' +
          '<thead><tr>' +
            '<th scope="col" class="a-num">#</th>' +
            '<th scope="col">Product</th>' +
            '<th scope="col" class="a-num">Items</th>' +
            '<th scope="col" class="a-num">Orders</th>' +
            '<th scope="col" class="a-num">Revenue</th>' +
            '<th scope="col" class="a-num">Share</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>' +

      '<div class="a-coverage">' +
        '<p class="a-coverage__line">' +
          '<strong>' + chart.full(result.sold) + '</strong> of ' +
          chart.full(result.catalogue) + ' products sold at least once — ' +
          '<strong>' + chart.full(result.unsold) + '</strong> sold nothing.' +
        '</p>' +
        '<span class="a-bars__track a-coverage__track" aria-hidden="true">' +
          '<span class="a-bars__fill" style="width:' + result.soldShare.toFixed(2) + '%"></span>' +
        '</span>' +
        '<p class="a-coverage__note">' +
          result.soldShare.toFixed(1) + '% of the catalogue moved in this period. ' +
          'A short period will always show a low figure — it is worth reading ' +
          'against a quarter, not a week.' +
        '</p>' +
      '</div>';
  }

  /* -----------------------------------------------------------------------
     Customers
     ----------------------------------------------------------------------- */

  function paintCustomers(result) {
    var host = document.getElementById('a-rp-customers');
    if (!host) return;

    if (!result.buyers) {
      host.innerHTML = '<p class="a-report__empty">Nobody bought in this period.</p>';
      return;
    }

    var rows = result.top.map(function (row) {
      return '' +
        '<tr>' +
          '<th scope="row" class="a-cell--name">' +
            '<a class="a-cell__strong" href="' +
               ui.href('/admin/customers/' + encodeURIComponent(row.id)) + '">' +
              ui.esc(row.name) +
            '</a>' +
            '<span class="a-cell__meta">' + ui.esc(row.city) + '</span>' +
          '</th>' +
          '<td>' + ui.statusPill(row.returning ? 'active' : 'neutral',
                                 row.returning ? 'Returning' : 'First order') + '</td>' +
          '<td class="a-num">' + row.orders + '</td>' +
          '<td class="a-num a-cell__strong">' + ui.esc(money(row.spent)) + '</td>' +
          '<td class="a-num">' + row.share.toFixed(1) + '%</td>' +
        '</tr>';
    }).join('');

    host.innerHTML =
      '<div class="a-report__figures">' +
        figure('Bought in this period', chart.full(result.buyers),
               result.activeShare.toFixed(1) + '% of the ' +
               chart.full(result.registered) + ' on the books') +
        figure('Had bought before', chart.full(result.returning),
               result.returningShare.toFixed(0) + '% of buyers, ' +
               money(result.returningRevenue) + ' of the takings') +
        figure('First-time buyers', chart.full(result.first),
               'No order before this period opened') +
        figure('Signed up', chart.full(result.joined),
               'Accounts created inside the period') +
      '</div>' +

      '<div class="a-report__scroll">' +
        '<table class="a-table a-table--compact">' +
          '<caption class="visually-hidden">Biggest spenders in this period</caption>' +
          '<thead><tr>' +
            '<th scope="col">Customer</th>' +
            '<th scope="col">Type</th>' +
            '<th scope="col" class="a-num">Orders</th>' +
            '<th scope="col" class="a-num">Spent</th>' +
            '<th scope="col" class="a-num">Share</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>';
  }

  function figure(label, value, note) {
    return '' +
      '<div class="a-figure">' +
        '<p class="a-figure__label">' + ui.esc(label) + '</p>' +
        '<p class="a-figure__value">' + ui.esc(value) + '</p>' +
        '<p class="a-figure__note">' + ui.esc(note) + '</p>' +
      '</div>';
  }

  /* -----------------------------------------------------------------------
     CSV

     A report nobody can take anywhere is half a report: the next thing an
     owner does with these numbers is put them beside numbers that are not
     in this panel. Built from the same repo call the section on screen
     used, never from scraping the rendered table — a figure that is
     rounded for display must not become the figure in the file.
     ----------------------------------------------------------------------- */

  /** One CSV field. Quoted always: a product title may hold a comma. */
  function field(value) {
    return '"' + String(value === undefined || value === null ? '' : value)
                   .replace(/"/g, '""') + '"';
  }

  function toCsv(rows) {
    return rows.map(function (row) {
      return row.map(field).join(',');
    }).join('\r\n');
  }

  function fileName(key, range) {
    return 'haveli-' + key + '-' +
           ZB.repo.reports.toDateInput(range.fromDate) + '-to-' +
           ZB.repo.reports.toDateInput(range.toDate) + '.csv';
  }

  function save(key, rows) {
    var blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);

    var link = document.createElement('a');
    link.href = url;
    link.download = fileName(key, lastRange);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    /* Released on the next turn of the loop: revoking it in the same tick
       can beat the download the click just started. */
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  function download(key) {
    if (!lastRange) return;

    var query = options();

    var jobs = {
      revenue: function () {
        return ZB.repo.reports.series(query).then(function (series) {
          return [['Date', 'Revenue (PKR)', 'Orders']].concat(
            series.map(function (point) {
              return [ZB.repo.reports.toDateInput(point.date),
                      Math.round(point.value), point.orders];
            })
          );
        });
      },

      status: function () {
        return ZB.repo.reports.breakdown(query).then(function (result) {
          return [['Stage', 'Orders', 'Share (%)', 'Revenue (PKR)']].concat(
            result.statuses.map(function (row) {
              return [row.label, row.orders, row.share.toFixed(2),
                      row.id === 'cancelled' ? 0 : Math.round(row.value)];
            })
          );
        });
      },

      payment: function () {
        return ZB.repo.reports.breakdown(query).then(function (result) {
          return [['Method', 'Revenue (PKR)', 'Share (%)', 'Orders']].concat(
            result.payments.map(function (row) {
              return [row.label, Math.round(row.value), row.share.toFixed(2), row.orders];
            })
          );
        });
      },

      dept: function () {
        return ZB.repo.reports.breakdown(query).then(function (result) {
          return [['Department', 'Revenue (PKR)', 'Share (%)', 'Items']].concat(
            result.departments.map(function (row) {
              return [row.label, Math.round(row.revenue), row.share.toFixed(2), row.units];
            })
          );
        });
      },

      products: function () {
        /* The whole ranking, not the ten on screen. A file is not a
           glance, and truncating it to what happened to fit a card is a
           surprise nobody wants to find after they have built a chart
           on it. */
        return ZB.repo.reports.products(query, 100000).then(function (result) {
          return [['Rank', 'Product', 'Product id', 'Items', 'Orders',
                   'Revenue (PKR)', 'Share (%)']].concat(
            result.items.map(function (row, i) {
              return [i + 1, row.title, row.id, row.units, row.orders,
                      Math.round(row.revenue), row.share.toFixed(2)];
            })
          );
        });
      },

      customers: function () {
        return ZB.repo.reports.customers(query, 100000).then(function (result) {
          return [['Customer', 'Customer id', 'City', 'Type', 'Orders',
                   'Spent (PKR)', 'Share (%)']].concat(
            result.top.map(function (row) {
              return [row.name, row.id, row.city,
                      row.returning ? 'Returning' : 'First order',
                      row.orders, Math.round(row.spent), row.share.toFixed(2)];
            })
          );
        });
      }
    };

    var job = jobs[key];
    if (!job) return;

    job().then(function (rows) {
      save(key, rows);
      ZB.adminToast.success('Downloaded ' + (rows.length - 1) +
                            ' rows for ' + ui.date(lastRange.fromDate) +
                            ' to ' + ui.date(lastRange.toDate) + '.');
    });
  }

}(window.ZB));
