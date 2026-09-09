/* =========================================================================
   pages/checkout.js — placing an order, and reading one back
   -------------------------------------------------------------------------
   Two pages, because they are two halves of one thing:

     /checkout      the delivery details, and the button that places it
     /order/:ref    the order afterwards, by its reference

   WHAT THIS PAGE SENDS
   Product ids, sizes and quantities, and where to deliver. No prices. Not
   the subtotal, not the shipping, not the total — api/checkout.js has
   nowhere to put them, and public.place_order works them out from the
   products and coupons tables at the moment of ordering.

   WHICH IS WHY THE SUMMARY HERE SAYS "ESTIMATE"
   It is arithmetic done in a browser for the reader's benefit. The figures
   that count are the ones that come back with the order, and those are the
   ones the confirmation shows. If the two ever disagree — a price changed
   while the page was open — the order is right and this was stale.

   THE DISCOUNT IS NOT PREVIEWED HERE, ON PURPOSE
   Checking a coupon in the browser would mean a second implementation of
   every rule the real one applies: the dates, the usage limit, the minimum
   spend, whether it has been disabled since. Two implementations of a rule
   about money is one more than is safe. The code is sent with the order and
   the server's answer is the only one.
   ========================================================================= */

window.ZB = window.ZB || {};
window.ZB.pages = window.ZB.pages || {};

(function (ZB) {
  'use strict';

  /* Filled by the GET, so the estimate uses the shop's real rule rather
     than numbers written here. The fallbacks match db/checkout.sql, and
     verify-api.mjs asserts that they still do. */
  var rule = { flat: 250, freeOver: 5000 };

  function esc(v) { return ZB.ui.esc(v); }
  function money(n) { return ZB.ui.money(n); }

  /* -----------------------------------------------------------------------
     The cart, as the checkout needs it
     ----------------------------------------------------------------------- */

  /**
   * Cart lines paired with the catalogue product each one names.
   *
   * A cart is a list of slugs kept in localStorage, and it can outlive the
   * products in it — something bought last month may since have been
   * archived. Those lines are separated out rather than silently dropped,
   * because a total that quietly shrinks is worse than being told why.
   */
  function resolve() {
    var live = [];
    var gone = [];

    ZB.store.state.cart.forEach(function (line) {
      var product = ZB.catalogue.byId(line.id);

      if (product && product.productId) live.push({ line: line, product: product });
      else gone.push(line);
    });

    return { live: live, gone: gone };
  }

  function estimate(live) {
    var subtotal = live.reduce(function (sum, pair) {
      /* The catalogue's price, not the cart line's. A line remembers what
         a product cost when it was added, which is the wrong number to
         show days later — and is not the number that will be charged. */
      return sum + (pair.product.price * pair.line.qty);
    }, 0);

    var shipping = (rule.freeOver > 0 && subtotal >= rule.freeOver) ? 0 : rule.flat;

    return { subtotal: subtotal, shipping: shipping, total: subtotal + shipping };
  }

  /* -----------------------------------------------------------------------
     Rendering
     ----------------------------------------------------------------------- */

  function summaryOf(live, sums) {
    var rows = live.map(function (pair) {
      var p = pair.product;
      var l = pair.line;

      return '' +
        '<li class="checkout__line">' +
          '<img class="checkout__thumb" src="' + esc(ZB.ui.productImage(p, 0)) + '" alt="">' +
          '<div class="checkout__line-info">' +
            '<span class="checkout__line-title">' + esc(p.title) + '</span>' +
            (l.size ? '<span class="checkout__line-meta">Size ' + esc(l.size) + '</span>' : '') +
            '<span class="checkout__line-meta">Quantity ' + l.qty + '</span>' +
          '</div>' +
          '<span class="checkout__line-price">' + money(p.price * l.qty) + '</span>' +
        '</li>';
    }).join('');

    return '' +
      '<aside class="checkout__summary">' +
        '<h2 class="checkout__summary-title">Your order</h2>' +
        '<ul class="checkout__lines">' + rows + '</ul>' +
        '<div class="checkout__row"><span>Subtotal</span><strong>' + money(sums.subtotal) + '</strong></div>' +
        '<div class="checkout__row"><span>Delivery</span><strong>' +
          (sums.shipping ? money(sums.shipping) : 'Free') +
        '</strong></div>' +
        '<div class="checkout__row checkout__row--total"><span>Estimated total</span>' +
          '<strong>' + money(sums.total) + '</strong></div>' +
        '<p class="checkout__note">' +
          'The final amount is worked out when the order is placed, from the ' +
          'prices in the shop at that moment. Any discount code is applied then.' +
        '</p>' +
      '</aside>';
  }

  function formOf(user) {
    return '' +
      '<form class="checkout__form" id="checkout-form" novalidate>' +
        '<h2 class="checkout__form-title">Delivery</h2>' +

        '<label class="field-label">Full name' +
          '<input class="field" type="text" name="name" autocomplete="name" required' +
                ' value="' + esc(user && user.name ? user.name : '') + '">' +
        '</label>' +

        '<label class="field-label">Phone' +
          '<input class="field" type="tel" name="phone" autocomplete="tel" required' +
                ' inputmode="tel" placeholder="03xx xxxxxxx">' +
        '</label>' +

        '<label class="field-label">Address' +
          '<input class="field" type="text" name="line1" autocomplete="address-line1" required' +
                ' placeholder="House and street">' +
        '</label>' +

        '<label class="field-label">Area <span class="field-label__hint">optional</span>' +
          '<input class="field" type="text" name="line2" autocomplete="address-line2">' +
        '</label>' +

        '<div class="checkout__pair">' +
          '<label class="field-label">City' +
            '<input class="field" type="text" name="city" autocomplete="address-level2" required>' +
          '</label>' +
          '<label class="field-label">Postcode <span class="field-label__hint">optional</span>' +
            '<input class="field" type="text" name="postcode" autocomplete="postal-code">' +
          '</label>' +
        '</div>' +

        '<label class="field-label">Note for the courier <span class="field-label__hint">optional</span>' +
          '<textarea class="field field--area" name="note" rows="2"></textarea>' +
        '</label>' +

        '<h2 class="checkout__form-title">Payment</h2>' +
        '<p class="checkout__method">' +
          '<strong>Cash on delivery</strong>' +
          '<span>Pay the courier when the parcel arrives.</span>' +
        '</p>' +

        '<label class="field-label">Discount code <span class="field-label__hint">optional</span>' +
          '<input class="field" type="text" name="coupon" autocomplete="off">' +
        '</label>' +

        '<button class="btn btn--primary btn--block" type="submit" data-place>Place order</button>' +
        '<p class="checkout__error" role="alert" data-error hidden></p>' +
      '</form>';
  }

  /* -----------------------------------------------------------------------
     /checkout
     ----------------------------------------------------------------------- */

  ZB.pages.checkout = {

    title: 'Checkout',

    render: function () {
      var ui = ZB.ui;

      return '' +
        '<div class="route-page container">' +
          ui.breadcrumbs([{ label: 'Home', path: '/' },
                          { label: 'Cart', path: '/cart' },
                          { label: 'Checkout' }]) +
          ui.pageHead({ eyebrow: 'Checkout', title: 'Delivery and payment' }) +
          '<div id="checkout-root">' + ui.pending('the checkout') + '</div>' +
        '</div>';
    },

    mount: function () {
      var root = document.getElementById('checkout-root');
      if (!root) return;

      var page = this;

      /* Both answers are needed before anything sensible can be drawn: who
         is signed in, and what delivery costs. */
      Promise.all([
        ZB.auth.loaded ? Promise.resolve(ZB.auth.user) : ZB.auth.load(),
        fetch('/api/checkout', {
          headers: { Accept: 'application/json' },
          credentials: 'same-origin'
        }).then(function (res) { return res.ok ? res.json() : null; })
         .catch(function () { return null; })
      ]).then(function (answers) {
        if (!document.body.contains(root)) return;

        var user = answers[0];
        var options = answers[1];

        if (options && options.ok && options.data && options.data.shipping) {
          rule = options.data.shipping;
        }

        page.paint(root, user);
      });
    },

    paint: function (root, user) {
      var ui = ZB.ui;

      /* --- signed out --------------------------------------------------- */

      if (!user) {
        root.innerHTML = ui.emptyState({
          title: 'Sign in to place your order',
          body: 'Orders are kept against your account, so you can see what you ' +
                'ordered and where it is. Your cart is waiting.',
          ctaLabel: 'Sign in or register',
          ctaHref: '/account'
        });
        return;
      }

      var cart = resolve();

      /* --- nothing to order --------------------------------------------- */

      if (!cart.live.length) {
        root.innerHTML = ui.emptyState({
          title: 'There is nothing to order',
          body: cart.gone.length
            ? 'The items that were in your cart are no longer sold here.'
            : 'Your cart is empty.',
          ctaLabel: 'Continue shopping',
          ctaHref: '/'
        });
        return;
      }

      var sums = estimate(cart.live);

      var warning = cart.gone.length
        ? '<p class="checkout__warning" role="status">' +
            cart.gone.length + ' ' +
            (cart.gone.length === 1 ? 'item is' : 'items are') +
            ' no longer sold here and ' +
            (cart.gone.length === 1 ? 'has' : 'have') +
            ' been left out of this order.' +
          '</p>'
        : '';

      root.innerHTML = '<div class="checkout">' + warning +
                       formOf(user) + summaryOf(cart.live, sums) + '</div>';

      this.bind(root, cart);
    },

    bind: function (root, cart) {
      var page = this;
      var form = document.getElementById('checkout-form');
      if (!form) return;

      var button = form.querySelector('[data-place]');
      var problem = form.querySelector('[data-error]');

      var say = function (message) {
        problem.textContent = message || '';
        problem.hidden = !message;
      };

      var busy = function (on) {
        button.disabled = on;
        button.textContent = on ? 'Placing your order' : 'Place order';
      };

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        say('');

        var value = function (name) {
          var el = form.querySelector('[name="' + name + '"]');
          return el ? el.value.trim() : '';
        };

        /* The browser's own required-field check, used rather than
           reimplemented. The server checks all of it again. */
        if (!form.checkValidity()) {
          form.reportValidity();
          return;
        }

        busy(true);

        var body = {
          items: cart.live.map(function (pair) {
            return {
              productId: pair.product.productId,
              qty: pair.line.qty,
              size: pair.line.size || null
            };
          }),
          name: value('name'),
          phone: value('phone'),
          line1: value('line1'),
          line2: value('line2') || undefined,
          city: value('city'),
          postcode: value('postcode') || undefined,
          note: value('note') || undefined,
          coupon: value('coupon') || undefined,
          method: 'cod'
        };

        fetch('/api/checkout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          credentials: 'same-origin',
          body: JSON.stringify(body)
        }).then(function (res) {
          return res.json().then(function (payload) {
            return { ok: res.ok, payload: payload };
          });
        }).then(function (answer) {
          if (!answer.ok || !answer.payload.ok) {
            busy(false);
            say((answer.payload && answer.payload.error && answer.payload.error.message) ||
                'The order could not be placed. Please try again.');
            return;
          }

          var order = answer.payload.data.order;

          /* The cart is emptied only now, after the order exists. Clearing
             it before would lose somebody's shopping to a failed request. */
          ZB.store.clearCart();

          /* Its own address, so a refresh or a back button lands on the
             order rather than on an empty checkout. */
          ZB.router.navigate('/order/' + encodeURIComponent(order.ref));
        }).catch(function () {
          busy(false);
          say('The order could not be placed. Check your connection and try again.');
        });
      });

      /* Nothing else on the page needs page, but keeping the reference makes
         the intent clear if a step is added between these two. */
      return page;
    }
  };

  /* -----------------------------------------------------------------------
     /order/:ref
     ----------------------------------------------------------------------- */

  ZB.pages.order = {

    title: function (params) { return 'Order ' + (params.ref || ''); },

    render: function () {
      var ui = ZB.ui;

      return '' +
        '<div class="route-page container">' +
          ui.breadcrumbs([{ label: 'Home', path: '/' },
                          { label: 'Account', path: '/account' },
                          { label: 'Order' }]) +
          '<div id="order-root">' + ui.pending('your order') + '</div>' +
        '</div>';
    },

    mount: function (params) {
      var root = document.getElementById('order-root');
      if (!root) return;

      var ui = ZB.ui;

      fetch('/api/account/orders?ref=' + encodeURIComponent(params.ref), {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin'
      }).then(function (res) {
        return res.json().then(function (payload) {
          return { status: res.status, payload: payload };
        });
      }).then(function (answer) {
        if (!document.body.contains(root)) return;

        if (answer.status === 401) {
          root.innerHTML = ui.emptyState({
            title: 'Sign in to see this order',
            body: 'Orders are only shown to the account that placed them.',
            ctaLabel: 'Sign in',
            ctaHref: '/account'
          });
          return;
        }

        if (!answer.payload || !answer.payload.ok) {
          root.innerHTML = ui.emptyState({
            title: 'That order was not found',
            body: 'Check the reference, or look through the orders on your account.',
            ctaLabel: 'Your account',
            ctaHref: '/account'
          });
          return;
        }

        root.innerHTML = renderOrder(answer.payload.data.order);
      }).catch(function () {
        if (!document.body.contains(root)) return;

        root.innerHTML = ui.emptyState({
          title: 'That could not be loaded',
          body: 'Check your connection and try again.',
          ctaLabel: 'Your account',
          ctaHref: '/account'
        });
      });
    }
  };

  /**
   * One order, whole.
   *
   * Every figure here came back from the server with the order. None of it
   * is worked out in this file — an order's arithmetic was settled when it
   * was placed and re-deriving it in a browser could only ever disagree.
   */
  function renderOrder(order) {
    var lines = order.items.map(function (line) {
      return '' +
        '<li class="checkout__line">' +
          '<img class="checkout__thumb" src="' +
               esc(line.image || 'assets/img/placeholder.svg') + '" alt="">' +
          '<div class="checkout__line-info">' +
            '<span class="checkout__line-title">' + esc(line.title) + '</span>' +
            (line.size ? '<span class="checkout__line-meta">Size ' + esc(line.size) + '</span>' : '') +
            '<span class="checkout__line-meta">Quantity ' + line.qty + '</span>' +
          '</div>' +
          '<span class="checkout__line-price">' + money(line.price * line.qty) + '</span>' +
        '</li>';
    }).join('');

    var address = order.address || {};

    var where = [address.name, address.phone, address.line1, address.line2,
                 address.city, address.postcode]
      .filter(Boolean)
      .map(function (part) { return esc(part); })
      .join('<br>');

    return '' +
      '<div class="order">' +
        '<header class="order__head">' +
          '<p class="order__eyebrow">Order</p>' +
          '<h1 class="order__ref">' + esc(order.ref) + '</h1>' +
          '<p class="order__status">' +
            '<span class="order__pill">' + esc(order.statusLabel) + '</span>' +
            '<span class="order__pill">' + esc(order.paymentLabel) + '</span>' +
            '<span>' + esc(order.method) + '</span>' +
          '</p>' +
        '</header>' +

        '<div class="order__body">' +
          '<section class="order__items">' +
            '<h2 class="checkout__summary-title">Items</h2>' +
            '<ul class="checkout__lines">' + lines + '</ul>' +

            '<div class="checkout__row"><span>Subtotal</span>' +
              '<strong>' + money(order.subtotal) + '</strong></div>' +
            (order.discount
              ? '<div class="checkout__row"><span>Discount' +
                  (order.couponCode ? ' (' + esc(order.couponCode) + ')' : '') +
                '</span><strong>&minus;' + money(order.discount) + '</strong></div>'
              : '') +
            '<div class="checkout__row"><span>Delivery</span><strong>' +
              (order.shipping ? money(order.shipping) : 'Free') +
            '</strong></div>' +
            '<div class="checkout__row checkout__row--total"><span>Total</span>' +
              '<strong>' + money(order.total) + '</strong></div>' +
          '</section>' +

          '<aside class="order__aside">' +
            '<h2 class="checkout__summary-title">Delivering to</h2>' +
            '<p class="order__address">' + where + '</p>' +
            '<a class="btn btn--block" href="/account">Your account</a>' +
          '</aside>' +
        '</div>' +
      '</div>';
  }

}(window.ZB));
