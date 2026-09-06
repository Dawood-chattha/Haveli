/* =========================================================================
   pages/cart.js — cart page
   -------------------------------------------------------------------------
   Reads and writes ZB.store, which keeps the cart in localStorage. Nothing
   is submitted anywhere: checkout is a UI flow only.
   ========================================================================= */

window.ZB = window.ZB || {};
window.ZB.pages = window.ZB.pages || {};

(function (ZB) {
  'use strict';

  ZB.pages.cart = {

    title: 'Cart',

    render: function () {
      var ui = ZB.ui;
      var lines = ZB.store.state.cart;

      var body = lines.length
        ? this.renderLines(lines)
        : ui.emptyState({
            title: 'Your cart is empty',
            body: 'Once you add something, it will wait for you here.',
            ctaLabel: 'Continue shopping',
            ctaHref: '/'
          });

      return '' +
        '<div class="route-page container">' +
          ui.breadcrumbs([{ label: 'Home', path: '/' }, { label: 'Cart' }]) +
          ui.pageHead({ eyebrow: 'Cart', title: 'Your cart' }) +
          body +
        '</div>';
    },

    renderLines: function (lines) {
      var ui = ZB.ui;

      var rows = lines.map(function (l) {
        var size = l.size ? '<span class="cart-line__size">Size ' + ui.esc(l.size) + '</span>' : '';

        return '' +
          '<li class="cart-line" data-id="' + ui.esc(l.id) + '" data-size="' + ui.esc(l.size || '') + '">' +
            /* Decorative duplicate of the title link beside it, so it is
               kept out of the tab order rather than read as a nameless
               second link to the same product. */
            '<a class="cart-line__media" href="' + ui.href(l.href || '/') + '"' +
               ' tabindex="-1" aria-hidden="true">' +
              '<img src="' + ui.esc(l.image || '') + '" alt="">' +
            '</a>' +
            '<div class="cart-line__info">' +
              '<a class="cart-line__title" href="' + ui.href(l.href || '/') + '">' + ui.esc(l.title) + '</a>' +
              size +
              '<span class="cart-line__price">' + ui.money(l.price) + '</span>' +
            '</div>' +
            '<div class="cart-line__qty">' +
              '<button type="button" data-qty="-1" aria-label="Decrease quantity">&minus;</button>' +
              '<span>' + l.qty + '</span>' +
              '<button type="button" data-qty="1" aria-label="Increase quantity">+</button>' +
            '</div>' +
            '<button class="cart-line__remove" type="button" data-remove aria-label="Remove item">' +
              '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
            '</button>' +
          '</li>';
      }).join('');

      return '' +
        '<div class="cart">' +
          '<ul class="cart__list">' + rows + '</ul>' +
          '<aside class="cart__summary">' +
            '<div class="cart__row"><span>Subtotal</span><strong>' + ui.money(ZB.store.cartTotal()) + '</strong></div>' +
            '<p class="cart__note">Shipping and taxes are calculated at checkout.</p>' +
            '<button class="btn btn--primary btn--block" type="button" data-checkout>Checkout</button>' +
            '<p class="cart__note">This is a front-end demonstration — no order is placed.</p>' +
          '</aside>' +
        '</div>';
    },

    mount: function () {
      var page = this;
      var root = document.querySelector('.cart');
      if (!root) return;

      root.addEventListener('click', function (e) {
        var line = e.target.closest('.cart-line');

        if (e.target.closest('[data-checkout]')) {
          window.alert('Checkout is a UI flow only in this build.');
          return;
        }
        if (!line) return;

        var id = line.getAttribute('data-id');
        var size = line.getAttribute('data-size') || null;

        if (e.target.closest('[data-remove]')) {
          ZB.store.removeFromCart(id, size);
          page.repaint();
          return;
        }

        var step = e.target.closest('[data-qty]');
        if (step) {
          var current = ZB.store.state.cart.filter(function (l) {
            return l.id === id && l.size === size;
          })[0];
          if (current) {
            ZB.store.setQty(id, size, current.qty + Number(step.getAttribute('data-qty')));
            page.repaint();
          }
        }
      });
    },

    /** Re-render in place after a cart change. */
    repaint: function () {
      var outlet = document.getElementById('app');
      if (!outlet) return;
      outlet.innerHTML = this.render();
      this.mount();
    }
  };

}(window.ZB));
