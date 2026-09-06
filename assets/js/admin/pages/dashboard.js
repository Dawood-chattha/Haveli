/* =========================================================================
   pages/dashboard.js — the admin dashboard
   -------------------------------------------------------------------------
   Everything on this page comes from ZB.repo, so the day a backend is
   connected the figures become live without this file changing.

   FORM DECISIONS
   The six headline figures are stat tiles, not charts: a single current
   value with a change against last period is a tile, and drawing it as a
   one-bar bar chart six times over is the commonest way a dashboard misses
   its own point. Only the sales history is a chart, because only it is a
   trend — one series, so it needs no legend; the card's title says what is
   plotted.

   THE PERIOD CONTROL SCOPES THE WHOLE PAGE
   It sits in one row above everything, not inside the chart card. Tiles,
   chart, top products and their comparisons all move together, so two
   numbers on screen always describe the same slice of time. A filter that
   lived in the chart card would silently disagree with the tiles above it.

   REFRESHING WITHOUT FLASHING
   Changing the period holds the previous render at reduced opacity instead
   of tearing it down to skeletons. There is no layout jump, and nothing
   the reader was looking at disappears. Skeletons are used once, on first
   load, when there is nothing to hold.
   ========================================================================= */

window.ZB = window.ZB || {};
window.ZB.adminPages = window.ZB.adminPages || {};

(function (ZB) {
  'use strict';

  var ui = ZB.adminUI;
  var chart = ZB.adminChart;

  var RANGES = [
    { days: 7, label: '7 days' },
    { days: 30, label: '30 days' },
    { days: 90, label: '90 days' }
  ];

  var current = 30;        /* survives a repaint, resets on a fresh mount */
  var liveChart = null;

  /* -----------------------------------------------------------------------
     Small helpers
     ----------------------------------------------------------------------- */

  function money(n) {
    return 'PKR ' + chart.full(n);
  }

  function moneyShort(n) {
    return 'PKR ' + chart.compact(n);
  }

  function ago(days) {
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return days + ' days ago';
  }

  /**
   * The change line under a stat value.
   *
   * Signed, named against the period it is compared with, and carrying an
   * arrow and the word "up" or "down" as well as a colour — a reader who
   * cannot separate the two greens from the two reds still gets the
   * direction. A null change draws nothing rather than a meaningless 0%.
   */
  function delta(change, days) {
    if (change === null || change === undefined || !isFinite(change)) {
      return '<p class="a-stat__delta a-stat__delta--none">No comparison for this period</p>';
    }

    var up = change >= 0;
    var arrow = up ? 'M7 3.5 3 8h8L7 3.5Z' : 'M7 10.5 3 6h8l-4 4.5Z';

    return '' +
      '<p class="a-stat__delta ' + (up ? 'is-up' : 'is-down') + '">' +
        '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="' + arrow + '"/></svg>' +
        '<span class="visually-hidden">' + (up ? 'Up' : 'Down') + ' </span>' +
        Math.abs(change).toFixed(1) + '%' +
        '<span class="a-stat__delta-vs"> vs previous ' + days + ' days</span>' +
      '</p>';
  }

  function statTile(o) {
    return '' +
      '<article class="a-stat">' +
        '<p class="a-stat__label">' + ui.esc(o.label) + '</p>' +
        '<p class="a-stat__value">' + ui.esc(o.value) + '</p>' +
        (o.delta || '') +
        (o.spark ? '<div class="a-stat__spark">' + o.spark + '</div>' : '') +
      '</article>';
  }

  /**
   * A tile for something that needs attention. It is a link, because a
   * count nobody can act on is just decoration.
   */
  function alertTile(o) {
    return '' +
      '<a class="a-alert a-alert--' + o.tone + '" href="' + ui.href(o.path) + '">' +
        '<span class="a-alert__icon">' + ui.icon(o.icon) + '</span>' +
        '<span class="a-alert__body">' +
          '<span class="a-alert__value">' + ui.esc(o.value) + '</span>' +
          '<span class="a-alert__label">' + ui.esc(o.label) + '</span>' +
        '</span>' +
        '<span class="a-alert__go" aria-hidden="true">' + ui.icon('chevron') + '</span>' +
      '</a>';
  }

  /* -----------------------------------------------------------------------
     Page
     ----------------------------------------------------------------------- */

  ZB.adminPages.dashboard = {

    title: 'Dashboard',
    crumbs: [],

    render: function () {
      var ranges = RANGES.map(function (range) {
        return '<button class="a-range__option" type="button" data-range="' + range.days + '"' +
                      ' aria-pressed="' + (range.days === current) + '">' +
                 ui.esc(range.label) +
               '</button>';
      }).join('');

      return '' +
        ui.pageHead({
          title: 'Dashboard',
          sub: 'An overview of the store.',
          /* One control row, above everything it scopes. */
          actions:
            '<div class="a-range" role="group" aria-label="Reporting period">' +
              ranges +
            '</div>'
        }) +

        '<div class="a-dash" id="a-dash" aria-busy="true">' +

          '<section class="a-dash__stats" id="a-dash-stats" aria-label="Headline figures">' +
            /* Four skeletons, so the row has its final height from the
               first paint and nothing below it jumps when data lands. */
            new Array(4).join('|').split('|').map(function () {
              return '<div class="a-stat a-stat--loading"></div>';
            }).join('') +
          '</section>' +

          '<section class="a-dash__alerts" id="a-dash-alerts" aria-label="Needs attention"></section>' +

          '<section class="a-card a-dash__chart" aria-labelledby="a-dash-chart-title">' +
            '<header class="a-card__head">' +
              '<div>' +
                '<h2 class="a-card__title" id="a-dash-chart-title">Sales overview</h2>' +
                '<p class="a-card__sub" id="a-dash-chart-sub"></p>' +
              '</div>' +
              /* Not a filter — a second way to read the same numbers. */
              '<button class="a-card__toggle" type="button" data-table-toggle' +
                     ' aria-expanded="false" aria-controls="a-dash-table">Table</button>' +
            '</header>' +
            '<div class="a-card__body">' +
              '<div class="a-chart" id="a-dash-chart"></div>' +
              '<div class="a-chart__table" id="a-dash-table" hidden></div>' +
            '</div>' +
          '</section>' +

          /* Order matters: the grid places these by DOM order, and the
             pairing it produces is chart+activity, then orders+top. See
             admin-dashboard.css. */
          '<section class="a-card a-dash__activity" aria-labelledby="a-dash-activity-title">' +
            '<header class="a-card__head">' +
              '<h2 class="a-card__title" id="a-dash-activity-title">Activity</h2>' +
            '</header>' +
            '<div class="a-card__body a-card__body--flush" id="a-dash-activity"></div>' +
          '</section>' +

          '<section class="a-card a-dash__orders" aria-labelledby="a-dash-orders-title">' +
            '<header class="a-card__head">' +
              '<h2 class="a-card__title" id="a-dash-orders-title">Recent orders</h2>' +
              '<a class="a-card__link" href="' + ui.href('/admin/orders') + '">View all</a>' +
            '</header>' +
            '<div class="a-card__body a-card__body--flush" id="a-dash-orders"></div>' +
          '</section>' +

          '<section class="a-card a-dash__top" aria-labelledby="a-dash-top-title">' +
            '<header class="a-card__head">' +
              '<h2 class="a-card__title" id="a-dash-top-title">Top products</h2>' +
              '<a class="a-card__link" href="' + ui.href('/admin/products') + '">View all</a>' +
            '</header>' +
            '<div class="a-card__body a-card__body--flush" id="a-dash-top"></div>' +
          '</section>' +

          '<section class="a-card a-dash__actions" aria-labelledby="a-dash-actions-title">' +
            '<header class="a-card__head">' +
              '<h2 class="a-card__title" id="a-dash-actions-title">Quick actions</h2>' +
            '</header>' +
            '<div class="a-card__body">' +
              '<div class="a-quick">' +
                quickAction('Add product', 'box', '/admin/products/new') +
                quickAction('View orders', 'receipt', '/admin/orders') +
                quickAction('Edit banners', 'image', '/admin/banners') +
                quickAction('New coupon', 'ticket', '/admin/coupons') +
              '</div>' +
            '</div>' +
          '</section>' +

        '</div>';
    },

    mount: function () {
      var root = document.getElementById('a-dash');
      if (!root) return;

      current = 30;
      load(current, root, true);

      /* One delegated listener; the regions inside are repainted often. */
      document.addEventListener('click', onClick);

      /* The listener outlives this page unless it retires itself. The
         router fires zb:navigated at the end of the render that mounted
         this page, so a subscription cancelled on that event would cancel
         itself immediately — checking the element instead is what works. */
      function onClick(e) {
        if (!document.body.contains(root)) {
          document.removeEventListener('click', onClick);
          if (liveChart) { liveChart.destroy(); liveChart = null; }
          return;
        }

        var option = e.target.closest('[data-range]');
        if (option) {
          var days = Number(option.getAttribute('data-range'));
          if (days === current) return;
          current = days;

          Array.prototype.forEach.call(
            document.querySelectorAll('[data-range]'),
            function (button) {
              button.setAttribute('aria-pressed',
                String(Number(button.getAttribute('data-range')) === days));
            }
          );

          load(days, root, false);
          return;
        }

        var toggle = e.target.closest('[data-table-toggle]');
        if (toggle) {
          var table = document.getElementById('a-dash-table');
          var plot = document.getElementById('a-dash-chart');
          var showTable = table.hidden;

          table.hidden = !showTable;
          plot.hidden = showTable;
          toggle.setAttribute('aria-expanded', String(showTable));
          toggle.textContent = showTable ? 'Chart' : 'Table';
        }
      }
    }
  };

  function quickAction(label, icon, path) {
    return '' +
      '<a class="a-quick__item" href="' + ui.href(path) + '">' +
        '<span class="a-quick__icon">' + ui.icon(icon) + '</span>' +
        '<span>' + ui.esc(label) + '</span>' +
      '</a>';
  }

  /* -----------------------------------------------------------------------
     Loading and painting
     ----------------------------------------------------------------------- */

  function load(days, root, first) {
    /* Hold the previous render rather than replacing it with skeletons.
       Nothing moves, and the reader keeps whatever they were reading. */
    if (!first) root.classList.add('is-refreshing');
    root.setAttribute('aria-busy', 'true');

    Promise.all([
      ZB.repo.metrics.summary(days),
      ZB.repo.metrics.salesSeries(days),
      ZB.repo.orders.recent(6),
      ZB.repo.metrics.topProducts(days, 5),
      ZB.repo.metrics.activity(6)
    ]).then(function (results) {
      /* The route may have changed while this was in flight. */
      if (!document.body.contains(root)) return;

      paintStats(results[0], results[1], days);
      paintAlerts(results[0]);
      paintChart(results[1], results[0], days);
      paintOrders(results[2]);
      paintTop(results[3]);
      paintActivity(results[4]);

      root.classList.remove('is-refreshing');
      root.setAttribute('aria-busy', 'false');
    });
  }

  function paintStats(summary, series, days) {
    var host = document.getElementById('a-dash-stats');
    if (!host) return;

    /* Twelve buckets across the window, so every period gets the same
       twelve-point sparkline rather than 7 points here and 90 there. */
    var revenue = bucket(series.map(function (p) { return p.value; }), 12);
    var counts = bucket(series.map(function (p) { return p.orders; }), 12);

    host.innerHTML =
      statTile({
        label: 'Total sales',
        value: moneyShort(summary.sales.value),
        delta: delta(summary.sales.change, days),
        spark: chart.sparkline(revenue)
      }) +
      statTile({
        label: 'Orders',
        value: chart.full(summary.orders.value),
        delta: delta(summary.orders.change, days),
        spark: chart.sparkline(counts)
      }) +
      statTile({
        label: 'Products',
        value: chart.full(summary.products.value),
        delta: delta(summary.products.change, days)
      }) +
      statTile({
        label: 'Customers',
        value: chart.full(summary.customers.value),
        delta: delta(summary.customers.change, days)
      });
  }

  /** Average a series down to `count` points, keeping its shape. */
  function bucket(values, count) {
    if (values.length <= count) return values;
    var size = values.length / count;
    var out = [];

    for (var i = 0; i < count; i++) {
      var slice = values.slice(Math.floor(i * size), Math.floor((i + 1) * size));
      var sum = slice.reduce(function (a, b) { return a + b; }, 0);
      out.push(slice.length ? sum / slice.length : 0);
    }
    return out;
  }

  function paintAlerts(summary) {
    var host = document.getElementById('a-dash-alerts');
    if (!host) return;

    host.innerHTML =
      alertTile({
        tone: 'warning', icon: 'receipt', path: '/admin/orders',
        value: chart.full(summary.pendingOrders),
        label: 'Orders waiting to be processed'
      }) +
      alertTile({
        tone: 'danger', icon: 'archive', path: '/admin/inventory',
        value: chart.full(summary.lowStock),
        label: 'Products out of stock'
      });
  }

  function paintChart(series, summary, days) {
    var host = document.getElementById('a-dash-chart');
    var sub = document.getElementById('a-dash-chart-sub');
    var table = document.getElementById('a-dash-table');
    if (!host) return;

    if (sub) {
      sub.textContent = money(summary.sales.value) + ' over the last ' + days + ' days';
    }

    if (liveChart) liveChart.destroy();

    liveChart = chart.area(host, {
      series: series,
      height: 268,
      summary: 'Sales by day over the last ' + days + ' days, ' +
               'totalling ' + money(summary.sales.value) + '. ' +
               'Use the table view for the day-by-day figures.'
    });

    if (table) table.innerHTML = chart.seriesTable(series);
  }

  function paintOrders(orders) {
    var host = document.getElementById('a-dash-orders');
    if (!host) return;

    if (!orders.length) {
      host.innerHTML = '<p class="a-empty">No orders yet.</p>';
      return;
    }

    var rows = orders.map(function (order) {
      return '' +
        '<tr>' +
          '<th scope="row"><a href="' + ui.href('/admin/orders') + '">' +
            ui.esc(order.ref) + '</a></th>' +
          '<td>' +
            '<span class="a-cell__strong">' + ui.esc(order.customerName) + '</span>' +
            '<span class="a-cell__meta">' + ui.esc(order.city) + '</span>' +
          '</td>' +
          '<td class="a-num">' + ui.esc(money(order.total)) + '</td>' +
          '<td>' + ui.statusPill(order.status, order.statusLabel) + '</td>' +
        '</tr>';
    }).join('');

    host.innerHTML =
      '<table class="a-table">' +
        '<thead><tr>' +
          '<th scope="col">Order</th><th scope="col">Customer</th>' +
          '<th scope="col" class="a-num">Total</th><th scope="col">Status</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>';
  }

  function paintTop(products) {
    var host = document.getElementById('a-dash-top');
    if (!host) return;

    if (!products.length) {
      host.innerHTML = '<p class="a-empty">Nothing sold in this period.</p>';
      return;
    }

    var best = products[0].revenue || 1;

    host.innerHTML = '<ul class="a-rank">' + products.map(function (product, i) {
      /* The bar is a share of the best seller, so the list reads as a
         ranking at a glance without becoming a second chart. */
      var share = Math.max(4, (product.revenue / best) * 100);

      return '' +
        '<li class="a-rank__item">' +
          '<span class="a-rank__no">' + (i + 1) + '</span>' +
          '<img class="a-rank__img" src="' + ui.esc(product.image) + '" alt=""' +
              ' width="40" height="52" loading="lazy" decoding="async">' +
          '<span class="a-rank__body">' +
            '<span class="a-rank__title">' + ui.esc(product.title) + '</span>' +
            '<span class="a-rank__meta">' + product.units +
              (product.units === 1 ? ' unit' : ' units') + '</span>' +
            '<span class="a-rank__bar"><span style="width:' + share.toFixed(1) + '%"></span></span>' +
          '</span>' +
          '<span class="a-rank__value">' + ui.esc(moneyShort(product.revenue)) + '</span>' +
        '</li>';
    }).join('') + '</ul>';
  }

  function paintActivity(items) {
    var host = document.getElementById('a-dash-activity');
    if (!host) return;

    if (!items.length) {
      host.innerHTML = '<p class="a-empty">Nothing has happened yet.</p>';
      return;
    }

    host.innerHTML = '<ul class="a-feed">' + items.map(function (item) {
      return '' +
        '<li class="a-feed__item">' +
          '<span class="a-feed__icon">' + ui.icon(item.icon) + '</span>' +
          '<span class="a-feed__body">' +
            '<span class="a-feed__text">' + ui.esc(item.text) + '</span>' +
            '<span class="a-feed__time">' + ui.esc(ago(item.daysAgo)) + '</span>' +
          '</span>' +
        '</li>';
    }).join('') + '</ul>';
  }

}(window.ZB));
