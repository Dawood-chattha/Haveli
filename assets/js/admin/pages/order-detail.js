/* =========================================================================
   pages/order-detail.js — one order, in full
   -------------------------------------------------------------------------
   The list answers "what is happening"; this answers "what is this one, and
   what do I do with it". Everything an owner needs before acting is on the
   screen at once — what was bought, who by, where it is going, whether it
   is paid — because the decision to ship is made from all of it together.

   THE PROGRESS STRIP CLAIMS NOTHING IT CANNOT SHOW
   It marks which stages an order has passed and which it has not, and it
   carries a date on one stage only: the day it was placed, which is the one
   date the record actually holds. Drawing a plausible timestamp against
   "Shipped" would be inventing shop history, and an owner would reasonably
   read it as fact. Where there is no data, there is no line.

   A cancelled order does not get a half-drawn strip either. Cancelling is
   leaving the sequence, not a stage within it, so it is stated plainly
   instead.

   Applied from the UI guidance consulted for this panel:
     - Cancelling asks first, names the order, and says what it does to the
       payment (#35, high).
     - Every write says so afterwards, and the reversible ones offer undo
       (#83).
     - Loading holds the layout rather than collapsing it (#19).
     - A bad id gets a real page with a way back, not an empty screen (#90).
   ========================================================================= */

window.ZB = window.ZB || {};
window.ZB.adminPages = window.ZB.adminPages || {};

(function (ZB) {
  'use strict';

  var ui = ZB.adminUI;

  var order = null;      /* the order on screen */

  /* -----------------------------------------------------------------------
     Page
     ----------------------------------------------------------------------- */

  ZB.adminPages.orderDetail = {

    title: 'Order',

    /* THE ADDRESS IS THE ORDER'S ID, WHICH IS NOT WHAT IT IS CALLED
     *
     * These both used to print params.id, because the generated orders used
     * their reference as their id and the two were the same string. In the
     * database they are not: the id is a uuid and the reference is
     * HAV-2609-01020, which is the one a person reads out over the phone.
     * So the heading waits for the order and paintHead fills it in. */
    crumbs: function () {
      return [
        { label: 'Orders', path: '/admin/orders' },
        { label: 'Order' }
      ];
    },

    render: function () {
      return '' +
        ui.pageHead({
          title: 'Order',
          sub: 'Loading…',
          actions:
            '<a class="a-btn a-btn--ghost" href="' + ui.href('/admin/orders') + '">' +
              ui.icon('back') + 'All orders' +
            '</a>'
        }) +
        '<div class="a-order" id="a-ord-detail" aria-busy="true">' +
          '<div class="a-blank a-blank--loading">' +
            '<p class="a-blank__title">Loading the order…</p>' +
          '</div>' +
        '</div>';
    },

    mount: function (params) {
      var host = document.getElementById('a-ord-detail');
      if (!host) return;

      document.addEventListener('click', onClick);

      loadOrder(params.id);

      function gone() {
        if (document.body.contains(host)) return false;
        document.removeEventListener('click', onClick);
        return true;
      }

      function onClick(e) {
        if (gone() || !order) return;

        var advance = e.target.closest('[data-advance]');
        if (advance) { moveTo(advance.getAttribute('data-advance')); return; }

        if (e.target.closest('[data-cancel-order]')) { confirmCancel(); return; }
        if (e.target.closest('[data-mark-paid]')) { markPaid(); }
      }
    }
  };

  function loadOrder(id) {
    var host = document.getElementById('a-ord-detail');

    ZB.repo.orders.get(id).then(function (row) {
      if (!document.body.contains(host)) return;

      order = row;
      host.setAttribute('aria-busy', 'false');

      if (!row) {
        /* The head was rendered with "Loading…" under it. Leaving that
           there beneath a "not found" panel is the page contradicting
           itself, so it is cleared along with the actions that no longer
           apply to anything. */
        var sub = document.querySelector('.a-page-head__sub');
        if (sub) sub.textContent = 'No such order.';

        var actions = document.querySelector('.a-page-head__actions');
        if (actions) {
          actions.innerHTML =
            '<a class="a-btn a-btn--ghost" href="' + ui.href('/admin/orders') + '">' +
              ui.icon('back') + 'All orders' +
            '</a>';
        }

        host.innerHTML = notFound(id);
        return;
      }

      host.innerHTML = body(row);
      paintHead(row);
    });
  }

  /** Re-read and re-draw after a write, so the screen shows the record. */
  function refresh() {
    if (order) loadOrder(order.id);
  }

  function paintHead(row) {
    /* The reference, now that there is one to show. */
    var title = document.querySelector('.a-page-head__title');
    if (title) title.textContent = 'Order ' + row.ref;

    var crumb = document.querySelector('#admin-crumbs .a-crumbs__item:last-child [aria-current]');
    if (crumb) crumb.textContent = row.ref;

    var sub = document.querySelector('.a-page-head__sub');
    if (sub) {
      sub.textContent = 'Placed ' + ui.date(row.date) + ' · ' + ui.ago(row.daysAgo);
    }

    var actions = document.querySelector('.a-page-head__actions');
    if (!actions) return;

    var next = ZB.repo.orders.nextStatuses(row.status);
    var forward = next.filter(function (s) { return s.id !== 'cancelled'; })[0];
    var cancellable = next.some(function (s) { return s.id === 'cancelled'; });

    actions.innerHTML =
      '<a class="a-btn a-btn--ghost" href="' + ui.href('/admin/orders') + '">' +
        ui.icon('back') + 'All orders' +
      '</a>' +
      (cancellable
        ? '<button class="a-btn a-btn--danger-ghost" type="button" data-cancel-order>' +
            'Cancel order' +
          '</button>'
        : '') +
      (forward
        ? '<button class="a-btn a-btn--primary" type="button"' +
                 ' data-advance="' + ui.esc(forward.id) + '">' +
            ui.icon(forward.id === 'shipped' ? 'truck' : 'check') +
            ui.esc(actionLabel(forward.id)) +
          '</button>'
        : '');
  }

  /* -----------------------------------------------------------------------
     The body
     ----------------------------------------------------------------------- */

  function body(row) {
    return '' +
      progress(row) +
      '<div class="a-order__grid">' +
        itemsCard(row) +
        '<div class="a-order__side">' +
          summaryCard(row) +
          customerCard(row) +
          deliveryCard(row) +
        '</div>' +
      '</div>';
  }

  /**
   * The stages, with the current one marked.
   *
   * aria-current="step" rather than colour alone: the strip is the answer
   * to "where is this order", and that answer has to survive being read
   * out as well as looked at.
   */
  function progress(row) {
    if (row.status === 'cancelled') {
      return '' +
        '<div class="a-order__banner a-order__banner--cancelled" role="status">' +
          '<span class="a-order__banner-icon" aria-hidden="true">' + ui.icon('close') + '</span>' +
          '<span>' +
            '<strong>This order was cancelled.</strong> ' +
            'Its payment is marked ' + ui.esc(row.paymentLabel.toLowerCase()) + ', and it ' +
            'is not counted in sales.' +
          '</span>' +
        '</div>';
    }

    var flow = ZB.repo.orders.statusFlow;
    var at = flow.indexOf(row.status);

    var steps = flow.map(function (id, i) {
      var done = i < at;
      var here = i === at;
      var label = stageLabel(id);

      return '' +
        '<li class="a-steps__step' + (done ? ' is-done' : '') + (here ? ' is-here' : '') + '"' +
            (here ? ' aria-current="step"' : '') + '>' +
          '<span class="a-steps__dot" aria-hidden="true">' +
            (done ? ui.icon('check') : '') +
          '</span>' +
          '<span class="a-steps__label">' + ui.esc(label) + '</span>' +
          /* One date, on the one stage that has one. */
          (i === 0
            ? '<span class="a-steps__meta">' + ui.esc(ui.date(row.date)) + '</span>'
            : '<span class="a-steps__meta">' +
                (done ? 'Done' : here ? 'Now' : 'Not yet') +
              '</span>') +
        '</li>';
    }).join('');

    return '<ol class="a-steps" aria-label="Order progress">' + steps + '</ol>';
  }

  function stageLabel(id) {
    if (id === 'pending') return 'Placed';
    if (id === 'processing') return 'Processing';
    if (id === 'shipped') return 'Shipped';
    return 'Delivered';
  }

  function itemsCard(row) {
    var lines = row.items.map(function (line) {
      return '' +
        '<tr>' +
          '<td class="a-cell--media">' +
            (line.image
              ? '<img class="a-thumb" src="' + ui.esc(line.image) + '" alt=""' +
                    ' width="40" height="52" loading="lazy" decoding="async">'
              : '<span class="a-thumb a-thumb--empty" aria-hidden="true"></span>') +
          '</td>' +
          '<th scope="row" class="a-cell--name">' +
            '<a href="' + ui.href('/admin/products/' + encodeURIComponent(line.id) + '/edit') + '">' +
              ui.esc(line.title) +
            '</a>' +
            '<span class="a-cell__meta">' + ui.esc(ZB.adminChart.full(line.price)) + ' each</span>' +
          '</th>' +
          '<td class="a-num">×' + line.qty + '</td>' +
          '<td class="a-num">' + ui.esc(ZB.adminChart.full(line.price * line.qty)) + '</td>' +
        '</tr>';
    }).join('');

    return '' +
      '<section class="a-card a-order__items">' +
        '<header class="a-card__head">' +
          '<h2 class="a-card__title">Items</h2>' +
          '<div class="a-card__aside">' + row.itemCount +
            (row.itemCount === 1 ? ' item' : ' items') + '</div>' +
        '</header>' +
        '<div class="a-card__body a-card__body--flush">' +
          '<table class="a-table a-table--lines">' +
            '<thead><tr>' +
              '<th scope="col"><span class="visually-hidden">Image</span></th>' +
              '<th scope="col">Product</th>' +
              '<th scope="col" class="a-num">Qty</th>' +
              '<th scope="col" class="a-num">Line total</th>' +
            '</tr></thead>' +
            '<tbody>' + lines + '</tbody>' +
          '</table>' +
        '</div>' +
      '</section>';
  }

  function summaryCard(row) {
    /* Delivery is stated as included rather than given an invented figure.
       The order total in this build is the sum of its lines, and adding a
       shipping charge here would make this card disagree with the list,
       the dashboard and the customer's own total. */
    return ui.card({
      title: 'Summary',
      modifier: 'a-order__sum',
      body:
        '<dl class="a-deflist">' +
          defRow('Items', ui.money(row.total)) +
          defRow('Delivery', 'Included') +
          '<div class="a-deflist__row a-deflist__row--total">' +
            '<dt>Total</dt>' +
            '<dd>' + ui.esc(ui.money(row.total)) + '</dd>' +
          '</div>' +
        '</dl>' +
        '<div class="a-order__pay">' +
          ui.statusPill(paymentTone(row.payment), row.paymentLabel) +
          '<span class="a-order__pay-method">' + ui.esc(row.method) + '</span>' +
        '</div>' +
        (row.payment === 'unpaid'
          ? '<button class="a-btn a-btn--ghost a-btn--block" type="button" data-mark-paid>' +
              ui.icon('card') + 'Mark as paid' +
            '</button>'
          : '')
    });
  }

  function customerCard(row) {
    return ui.card({
      title: 'Customer',
      body:
        '<p class="a-order__who">' + ui.esc(row.customerName) + '</p>' +
        '<dl class="a-deflist">' +
          defRow('Email', row.customerEmail) +
          defRow('City', row.city) +
        '</dl>' +
        /* The customer's own record: their whole history, what they spend
           and what they buy. It links by id rather than by searching the
           order list for their email, so two people who share a name still
           land on the right one. */
        '<a class="a-btn a-btn--ghost a-btn--block" href="' +
           ui.href('/admin/customers/' + encodeURIComponent(row.customerId)) + '">' +
          ui.icon('users') + 'Customer record' +
        '</a>'
    });
  }

  function deliveryCard(row) {
    return ui.card({
      title: 'Delivery',
      body:
        '<dl class="a-deflist">' +
          defRow('Status', row.statusLabel) +
          defRow('Destination', row.city) +
          defRow('Placed', ui.date(row.date)) +
        '</dl>' +
        '<p class="a-order__note">' +
          'A status change here is saved to the database and is what the ' +
          'customer sees on their account.' +
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

  function paymentTone(payment) {
    if (payment === 'paid') return 'active';
    if (payment === 'unpaid') return 'pending';
    return 'neutral';
  }

  function actionLabel(status) {
    if (status === 'processing') return 'Start processing';
    if (status === 'shipped') return 'Mark shipped';
    if (status === 'delivered') return 'Mark delivered';
    return 'Move on';
  }

  function notFound(id) {
    return '' +
      '<div class="a-blank">' +
        '<p class="a-blank__title">That order was not found</p>' +
        '<p class="a-blank__body">' +
          'No order matches “' + ui.esc(id) + '”. It may have been opened from ' +
          'an old link.' +
        '</p>' +
        '<a class="a-btn a-btn--primary" href="' + ui.href('/admin/orders') + '">' +
          'Back to orders' +
        '</a>' +
      '</div>';
  }

  /* -----------------------------------------------------------------------
     Writes
     ----------------------------------------------------------------------- */

  function snapshot(row) {
    return {
      status: row.status, statusLabel: row.statusLabel,
      payment: row.payment, paymentLabel: row.paymentLabel
    };
  }

  function moveTo(status) {
    var id = order.id;
    var ref = order.ref;
    var previous = snapshot(order);

    ZB.repo.orders.updateStatus(id, status).then(function (after) {
      refresh();
      ZB.adminToast.success(ref + ' is now ' + after.statusLabel.toLowerCase() + '.', {
        label: 'Undo',
        onClick: function () {
          ZB.repo.orders.restore(id, previous).then(function () {
            refresh();
            ZB.adminToast.info(ref + ' is back to ' + previous.statusLabel.toLowerCase() + '.');
          });
        }
      });
    }).catch(function (failure) {
      ZB.adminToast.error(failure.message || 'That change was not applied.');
      refresh();
    });
  }

  function markPaid() {
    var id = order.id;
    var ref = order.ref;
    var previous = snapshot(order);

    ZB.repo.orders.markPaid(id).then(function () {
      refresh();
      ZB.adminToast.success(ref + ' is marked paid.', {
        label: 'Undo',
        onClick: function () {
          ZB.repo.orders.restore(id, previous).then(function () {
            refresh();
            ZB.adminToast.info(ref + ' is unpaid again.');
          });
        }
      });
    });
  }

  function confirmCancel() {
    var id = order.id;
    var ref = order.ref;
    var previous = snapshot(order);

    /* Says what else changes. Cancelling a paid order also settles the
       money, and an owner should learn that from the dialog rather than
       from the payment pill afterwards. */
    var body = 'Order ' + ref + ' will be marked cancelled and will stop ' +
               'counting towards sales.';
    if (order.payment === 'paid') {
      body += ' Its payment is marked refunded at the same time.';
    }
    /* The stock is the part an owner will not have thought about, and it is
       the part that matters: a cancelled order whose items never came back
       is stock the shop cannot sell and cannot explain. */
    body += ' Everything in it goes back into stock.';

    ZB.adminModal.confirm({
      title: 'Cancel this order?',
      body: body,
      confirmLabel: 'Cancel the order',
      cancelLabel: 'Keep it',
      tone: 'danger'
    }).then(function (yes) {
      if (!yes) return;

      ZB.repo.orders.updateStatus(id, 'cancelled').then(function () {
        refresh();
        ZB.adminToast.success(ref + ' was cancelled.', {
          label: 'Undo',
          onClick: function () {
            ZB.repo.orders.restore(id, previous).then(function () {
              refresh();
              ZB.adminToast.info(ref + ' is back to ' + previous.statusLabel.toLowerCase() + '.');
            });
          }
        });
      }).catch(function (failure) {
        ZB.adminToast.error(failure.message || 'That order could not be cancelled.');
      });
    });
  }

}(window.ZB));
