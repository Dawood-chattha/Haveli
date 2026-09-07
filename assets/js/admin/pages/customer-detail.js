/* =========================================================================
   pages/customer-detail.js — one customer, and everything they have bought
   -------------------------------------------------------------------------
   The list ranks people; this explains one of them. The order history is
   the substance of the page, not an appendix to it — a customer IS their
   orders here, and every figure above the table is counted from the rows
   below it rather than stored separately.

   THAT IS WHY THE FIGURES ARE COUNTED, NOT CARRIED
   Cancel one of this customer's orders and their spend, their average and
   their order count all change on the next render, because the repo counts
   them from the same list. A stored total would have been right at build
   time and wrong from the first cancellation, and the page would then be
   quietly contradicting the table directly beneath it.

   WHAT "NEVER ORDERED" MEANS AND WHY IT IS NOT ZERO
   A customer with no orders gets said so in words. Printing "0" and
   "PKR 0" and "—" for a last order is technically true and reads as
   missing data; an owner should be able to tell "we have no record" from
   "they have not bought" at a glance.
   ========================================================================= */

window.ZB = window.ZB || {};
window.ZB.adminPages = window.ZB.adminPages || {};

(function (ZB) {
  'use strict';

  var ui = ZB.adminUI;

  var person = null;
  var history = null;

  /* -----------------------------------------------------------------------
     Page
     ----------------------------------------------------------------------- */

  ZB.adminPages.customerDetail = {

    title: 'Customer',

    crumbs: function () {
      return [
        { label: 'Customers', path: '/admin/customers' },
        { label: (person && person.name) || 'Customer' }
      ];
    },

    render: function () {
      return '' +
        ui.pageHead({
          title: 'Customer',
          sub: 'Loading…',
          actions:
            '<a class="a-btn a-btn--ghost" href="' + ui.href('/admin/customers') + '">' +
              ui.icon('back') + 'All customers' +
            '</a>'
        }) +
        '<div class="a-person" id="a-cus-detail" aria-busy="true">' +
          '<div class="a-blank a-blank--loading">' +
            '<p class="a-blank__title">Loading the customer…</p>' +
          '</div>' +
        '</div>';
    },

    mount: function (params) {
      var host = document.getElementById('a-cus-detail');
      if (!host) return;

      person = null;
      history = null;

      document.addEventListener('click', onClick);
      loadPerson(params.id);

      function gone() {
        if (document.body.contains(host)) return false;
        document.removeEventListener('click', onClick);
        return true;
      }

      function onClick(e) {
        if (gone() || !person) return;

        var toggle = e.target.closest('[data-block]');
        if (!toggle) return;

        /* The same dialog the list uses, so both screens ask the question
           in the same words. */
        ZB.adminPages.customersAsk(
          person.id,
          toggle.getAttribute('data-to'),
          person.name,
          function () { loadPerson(person.id); }
        );
      }
    }
  };

  function loadPerson(id) {
    var host = document.getElementById('a-cus-detail');

    /* Both at once: the profile figures and the orders they are counted
       from arrive together, so the page never shows a total above a table
       that has not been drawn yet. */
    Promise.all([
      ZB.repo.customers.get(id),
      ZB.repo.customers.orders(id)
    ]).then(function (results) {
      if (!document.body.contains(host)) return;

      person = results[0];
      history = results[1];
      host.setAttribute('aria-busy', 'false');

      if (!person) {
        var sub = document.querySelector('.a-page-head__sub');
        if (sub) sub.textContent = 'No such customer.';
        host.innerHTML = notFound(id);
        return;
      }

      host.innerHTML = body(person, history);
      paintHead(person);

      /* Redrawn now that the name is known. The trail was built at
         navigation time, when all this page had was an id — and "cus-1042"
         in a breadcrumb tells the reader nothing about where they are. */
      ZB.adminShell.setCrumbs(window.location.pathname, { id: id });
    });
  }

  function paintHead(row) {
    var title = document.querySelector('.a-page-head__title');
    if (title) title.textContent = row.name;

    var sub = document.querySelector('.a-page-head__sub');
    if (sub) {
      sub.textContent = row.email + ' · joined ' + ui.ago(row.joinedDaysAgo);
    }

    var actions = document.querySelector('.a-page-head__actions');
    if (!actions) return;

    var blocked = row.status !== 'active';

    actions.innerHTML =
      '<a class="a-btn a-btn--ghost" href="' + ui.href('/admin/customers') + '">' +
        ui.icon('back') + 'All customers' +
      '</a>' +
      '<button class="a-btn ' + (blocked ? 'a-btn--default' : 'a-btn--danger-ghost') + '"' +
             ' type="button" data-block="' + ui.esc(row.id) + '"' +
             ' data-to="' + (blocked ? 'active' : 'blocked') + '">' +
        ui.icon(blocked ? 'check' : 'close') +
        (blocked ? 'Unblock account' : 'Block account') +
      '</button>';
  }

  /* -----------------------------------------------------------------------
     The body
     ----------------------------------------------------------------------- */

  function body(row, orders) {
    return '' +
      (row.status !== 'active' ? blockedBanner(row) : '') +
      statsStrip(row) +
      '<div class="a-person__grid">' +
        ordersCard(row, orders) +
        '<div class="a-person__side">' +
          profileCard(row) +
          favouritesCard(orders) +
        '</div>' +
      '</div>';
  }

  function blockedBanner(row) {
    return '' +
      '<div class="a-order__banner a-order__banner--cancelled" role="status">' +
        '<span class="a-order__banner-icon" aria-hidden="true">' + ui.icon('close') + '</span>' +
        '<span>' +
          '<strong>This account is marked blocked.</strong> ' +
          'That is a note in this panel only — there is no account system ' +
          'behind it yet, so nothing is actually prevented.' +
        '</span>' +
      '</div>';
  }

  function statsStrip(row) {
    var never = row.lastOrderDaysAgo === null;

    return '' +
      '<div class="a-metrics">' +
        stat('Orders', never ? 'None' : String(row.orders)) +
        stat('Total spent', never ? '—' : ui.money(row.spent)) +
        stat('Average order', never ? '—' : ui.money(row.average)) +
        stat('Last order', never ? 'Never' : ui.ago(row.lastOrderDaysAgo)) +
      '</div>';
  }

  function stat(label, value) {
    return '' +
      '<div class="a-stat a-metric">' +
        '<p class="a-stat__label">' + ui.esc(label) + '</p>' +
        '<p class="a-stat__value a-stat__value--sm">' + ui.esc(value) + '</p>' +
      '</div>';
  }

  function ordersCard(row, orders) {
    if (!orders.length) {
      return '' +
        '<section class="a-card a-person__orders">' +
          '<header class="a-card__head">' +
            '<h2 class="a-card__title">Order history</h2>' +
          '</header>' +
          '<div class="a-card__body">' +
            '<div class="a-blank">' +
              '<p class="a-blank__title">' + ui.esc(row.name) + ' has not ordered yet</p>' +
              '<p class="a-blank__body">' +
                'They have an account but nothing has been bought on it.' +
              '</p>' +
            '</div>' +
          '</div>' +
        '</section>';
    }

    var lines = orders.map(function (order) {
      return '' +
        '<tr>' +
          '<th scope="row" class="a-cell--name">' +
            '<a href="' + ui.href('/admin/orders/' + encodeURIComponent(order.id)) + '">' +
              ui.esc(order.ref) +
            '</a>' +
            '<span class="a-cell__meta">' + order.itemCount +
              (order.itemCount === 1 ? ' item' : ' items') + '</span>' +
          '</th>' +
          '<td class="a-cell--date">' +
            ui.esc(ui.date(order.date)) +
            '<span class="a-cell__meta">' + ui.esc(ui.ago(order.daysAgo)) + '</span>' +
          '</td>' +
          '<td class="a-num">' + ui.esc(ZB.adminChart.full(order.total)) + '</td>' +
          '<td>' + ui.statusPill(order.status, order.statusLabel) + '</td>' +
        '</tr>';
    }).join('');

    return '' +
      '<section class="a-card a-person__orders">' +
        '<header class="a-card__head">' +
          '<h2 class="a-card__title">Order history</h2>' +
          '<div class="a-card__aside">' +
            '<a class="a-card__link" href="' +
               ui.href('/admin/orders?q=' + encodeURIComponent(row.email)) + '">' +
              'Open in Orders' +
            '</a>' +
          '</div>' +
        '</header>' +
        '<div class="a-card__body a-card__body--flush">' +
          '<table class="a-table a-table--history">' +
            '<thead><tr>' +
              '<th scope="col">Order</th>' +
              '<th scope="col">Date</th>' +
              '<th scope="col" class="a-num">Total</th>' +
              '<th scope="col">Status</th>' +
            '</tr></thead>' +
            '<tbody>' + lines + '</tbody>' +
          '</table>' +
        '</div>' +
      '</section>';
  }

  function profileCard(row) {
    return ui.card({
      title: 'Profile',
      body:
        '<dl class="a-deflist">' +
          defRow('Email', row.email) +
          defRow('City', row.city) +
          defRow('Joined', ui.ago(row.joinedDaysAgo)) +
          defRow('Account', row.status === 'active' ? 'Active' : 'Blocked') +
          (row.cancelled
            ? defRow('Cancelled orders', String(row.cancelled))
            : '') +
        '</dl>' +
        '<p class="a-order__note">' +
          'These details are invented sample data. There is no account ' +
          'system in this build, and nothing here reaches a real mailbox.' +
        '</p>'
    });
  }

  /**
   * What they buy, counted from their own order lines.
   *
   * Departments rather than individual products: with three orders a
   * product ranking is one item repeated, which tells an owner nothing.
   * "Mostly Women, some Kids" is a fact about the customer.
   */
  function favouritesCard(orders) {
    var tally = {};
    var total = 0;

    orders.filter(ZB.adminMock.isRevenue).forEach(function (order) {
      order.items.forEach(function (line) {
        var product = ZB.catalogue.byId(line.id);
        if (!product) return;
        tally[product.deptLabel] = (tally[product.deptLabel] || 0) + line.qty;
        total += line.qty;
      });
    });

    var rows = Object.keys(tally)
      .sort(function (a, b) { return tally[b] - tally[a]; })
      .map(function (label) {
        var share = Math.round((tally[label] / total) * 100);
        return '' +
          '<li class="a-share">' +
            '<span class="a-share__label">' + ui.esc(label) + '</span>' +
            '<span class="a-share__bar" aria-hidden="true">' +
              '<span class="a-share__fill" style="width:' + share + '%"></span>' +
            '</span>' +
            '<span class="a-share__value">' + share + '%</span>' +
          '</li>';
      });

    if (!rows.length) {
      return ui.card({
        title: 'What they buy',
        body: '<p class="a-order__note">Nothing bought yet.</p>'
      });
    }

    return ui.card({
      title: 'What they buy',
      body: '<ul class="a-shares">' + rows.join('') + '</ul>' +
            '<p class="a-order__note">' +
              'Share of the ' + total + ' items they have bought, by department. ' +
              'Cancelled orders are not counted.' +
            '</p>'
    });
  }

  function defRow(term, value) {
    return '' +
      '<div class="a-deflist__row">' +
        '<dt>' + ui.esc(term) + '</dt>' +
        '<dd>' + ui.esc(value) + '</dd>' +
      '</div>';
  }

  function notFound(id) {
    return '' +
      '<div class="a-blank">' +
        '<p class="a-blank__title">That customer was not found</p>' +
        '<p class="a-blank__body">' +
          'No customer matches “' + ui.esc(id) + '”. It may have been opened ' +
          'from an old link.' +
        '</p>' +
        '<a class="a-btn a-btn--primary" href="' + ui.href('/admin/customers') + '">' +
          'Back to customers' +
        '</a>' +
      '</div>';
  }

}(window.ZB));
