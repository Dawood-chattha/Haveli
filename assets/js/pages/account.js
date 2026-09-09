/* =========================================================================
   pages/account.js — account interface
   -------------------------------------------------------------------------
   The sign-in and register forms are the same two forms this page has always
   had: the same markup, the same tabs, the same classes, the same browser
   validation. What changed in Phase 3 is that submitting one now does
   something — it posts to /api/auth/login or /api/auth/signup — and that the
   page has a third state for when somebody is signed in.

   NO PASSWORD IS STORED HERE, AND NO TOKEN EITHER
   The value of the password field goes straight into one request and is never
   written anywhere. What comes back is a session in an HttpOnly cookie, which
   this page cannot read; ZB.auth asks the server who the visitor is rather
   than remembering it.

   THIS PAGE CANNOT MAKE ANYONE AN ADMINISTRATOR
   The register form sends a name, an address and a password. There is no role
   field, and adding one would achieve nothing: /api/auth/signup does not read
   one, and the database trigger that creates the profile writes 'customer'
   unconditionally without looking at the request. The owner's own account is
   promoted from outside the application entirely — see scripts/make-admin.mjs.

   There is no link to the owner panel on this page, or anywhere else on the
   storefront. That is not what protects the panel — the panel is protected by
   the role check on every request — but a shop has no reason to advertise its
   back office to its customers.
   ========================================================================= */

window.ZB = window.ZB || {};
window.ZB.pages = window.ZB.pages || {};

(function (ZB) {
  'use strict';

  ZB.pages.account = {

    title: 'Account',

    render: function () {
      var ui = ZB.ui;

      return '' +
        '<div class="route-page container">' +
          ui.breadcrumbs([{ label: 'Home', path: '/' }, { label: 'Account' }]) +
          ui.pageHead({ eyebrow: 'Account', title: 'Sign in' }) +

          '<div class="account" id="account-root">' +
            '<div class="account__tabs" role="tablist">' +
              '<button class="account__tab is-active" type="button" role="tab" aria-selected="true" data-tab="signin">Sign in</button>' +
              '<button class="account__tab" type="button" role="tab" aria-selected="false" data-tab="register">Register</button>' +
            '</div>' +

            '<form class="account__form" data-form="signin" novalidate>' +
              '<label class="field-label">Email' +
                '<input class="field" type="email" name="email" autocomplete="email" required>' +
              '</label>' +
              '<label class="field-label">Password' +
                '<input class="field" type="password" name="password" autocomplete="current-password" required>' +
              '</label>' +
              '<button class="btn btn--primary btn--block" type="submit">Sign in</button>' +
              '<p class="account__note" role="status"></p>' +
            '</form>' +

            '<form class="account__form" data-form="register" hidden novalidate>' +
              '<label class="field-label">Name' +
                '<input class="field" type="text" name="name" autocomplete="name" required>' +
              '</label>' +
              '<label class="field-label">Email' +
                '<input class="field" type="email" name="email" autocomplete="email" required>' +
              '</label>' +
              '<label class="field-label">Password' +
                '<input class="field" type="password" name="password" autocomplete="new-password" required minlength="8">' +
              '</label>' +
              '<button class="btn btn--primary btn--block" type="submit">Create account</button>' +
              '<p class="account__note" role="status">At least 8 characters. Length is what makes a password hard to guess — there is no required symbol or capital.</p>' +
            '</form>' +
          '</div>' +
        '</div>';
    },

    mount: function () {
      var root = document.getElementById('account-root');
      if (!root) return;

      var ui = ZB.ui;
      var tabs = root.querySelectorAll('.account__tab');
      var forms = root.querySelectorAll('.account__form');

      /* -------------------------------------------------------------------
         Signed in
         -------------------------------------------------------------------
         Replaces the two forms rather than sitting above them, because a
         sign-in form shown to somebody already signed in is a question they
         have answered.
         ------------------------------------------------------------------- */

      /**
       * The orders this account has placed.
       *
       * Fetched rather than rendered from anything held here, and fetched
       * as the caller: /api/account/orders has no user parameter, because
       * the policy in db/policies.sql supplies the condition. There is no
       * way for this page to ask for somebody else's.
       */
      function showOrders(host) {
        fetch('/api/account/orders', {
          headers: { Accept: 'application/json' },
          credentials: 'same-origin'
        }).then(function (res) {
          return res.ok ? res.json() : null;
        }).then(function (payload) {
          if (!document.body.contains(host)) return;

          var orders = payload && payload.ok && payload.data
            ? payload.data.orders
            : null;

          if (!orders) {
            host.innerHTML = '<p class="account__note">Your orders could not be loaded.</p>';
            return;
          }

          if (!orders.length) {
            host.innerHTML = '<p class="account__note">You have not ordered anything yet.</p>';
            return;
          }

          host.innerHTML =
            '<ul class="account__orders">' +
              orders.map(function (order) {
                return '' +
                  '<li class="account__order">' +
                    '<a class="account__order-ref" href="' +
                       ui.href('/order/' + encodeURIComponent(order.ref)) + '">' +
                      ui.esc(order.ref) +
                    '</a>' +
                    '<span class="account__order-meta">' +
                      order.itemCount + (order.itemCount === 1 ? ' item' : ' items') +
                      ' · ' + ui.esc(order.statusLabel) +
                    '</span>' +
                    '<span class="account__order-total">' + ui.money(order.total) + '</span>' +
                  '</li>';
              }).join('') +
            '</ul>';
        }).catch(function () {
          if (!document.body.contains(host)) return;
          host.innerHTML = '<p class="account__note">Your orders could not be loaded.</p>';
        });
      }

      function showSignedIn(user) {
        root.innerHTML = '' +
          '<div class="account__form">' +
            '<p class="account__note" role="status">' +
              'Signed in as <strong>' + ui.esc(user.email) + '</strong>' +
              (user.name ? ' — ' + ui.esc(user.name) : '') +
            '</p>' +

            '<h2 class="account__heading">Your orders</h2>' +
            '<div id="account-orders">' + ui.pending('your orders') + '</div>' +

            '<a class="btn btn--primary btn--block" href="/wishlist">Your wishlist</a>' +
            '<button class="btn btn--block" type="button" data-signout>Sign out</button>' +
          '</div>';

        showOrders(document.getElementById('account-orders'));

        root.querySelector('[data-signout]').addEventListener('click', function (e) {
          var button = e.currentTarget;
          button.disabled = true;
          button.textContent = 'Signing out';

          ZB.auth.signOut().then(function () {
            /* Re-render through the router so the page rebuilds from its own
               markup rather than being patched back together here. */
            ZB.router.render();
          });
        });
      }

      /* Already known, or answered a moment later — either way the same
         branch. `loaded` distinguishes "signed out" from "not asked yet", so
         the forms are not flashed at somebody who turns out to be signed in. */
      if (ZB.auth.user) { showSignedIn(ZB.auth.user); return; }

      if (!ZB.auth.loaded) {
        ZB.auth.load().then(function (user) {
          if (user && document.getElementById('account-root') === root) showSignedIn(user);
        });
      }

      /* -------------------------------------------------------------------
         Tabs — unchanged
         ------------------------------------------------------------------- */

      root.addEventListener('click', function (e) {
        var tab = e.target.closest('.account__tab');
        if (!tab) return;

        var name = tab.getAttribute('data-tab');

        Array.prototype.forEach.call(tabs, function (t) {
          var on = t === tab;
          t.classList.toggle('is-active', on);
          t.setAttribute('aria-selected', String(on));
        });

        Array.prototype.forEach.call(forms, function (f) {
          f.hidden = f.getAttribute('data-form') !== name;
        });
      });

      /* -------------------------------------------------------------------
         Submitting
         ------------------------------------------------------------------- */

      function say(form, message, bad) {
        var note = form.querySelector('.account__note');
        if (!note) return;

        /* Emptied first so an identical message is a fresh insertion and is
           announced again by a screen reader. */
        note.textContent = '';
        note.textContent = message;
        note.classList.toggle('is-error', !!bad);
        note.setAttribute('role', bad ? 'alert' : 'status');
      }

      function busy(form, on, label) {
        var button = form.querySelector('button[type="submit"]');
        button.disabled = on;
        button.setAttribute('aria-busy', String(on));
        button.textContent = label;

        Array.prototype.forEach.call(form.querySelectorAll('.field'), function (input) {
          input.readOnly = on;
        });
      }

      Array.prototype.forEach.call(forms, function (form) {
        var kind = form.getAttribute('data-form');

        form.addEventListener('submit', function (e) {
          e.preventDefault();

          /* The browser's own validation first, as before. */
          if (!form.checkValidity()) { form.reportValidity(); return; }

          var data = new FormData(form);
          var email = String(data.get('email') || '').trim();
          var password = String(data.get('password') || '');

          if (kind === 'signin') {
            busy(form, true, 'Signing in');
            say(form, '');

            ZB.auth.signIn(email, password)
              .then(function (user) { showSignedIn(user); })
              .catch(function (failure) {
                busy(form, false, 'Sign in');
                say(form, (failure && failure.message) ||
                          'Could not sign in. Try again.', true);
              });
            return;
          }

          busy(form, true, 'Creating account');
          say(form, '');

          ZB.auth.signUp(email, password, String(data.get('name') || '').trim())
            .then(function (result) {
              busy(form, false, 'Create account');

              /* Whether a confirmation email is required is the project's
                 setting, not this page's business — the server says which,
                 and the message it sends is shown as it is. */
              say(form, result.message || 'Account created.');
              form.reset();
            })
            .catch(function (failure) {
              busy(form, false, 'Create account');
              say(form, (failure && failure.message) ||
                        'Could not create that account.', true);
            });
        });
      });
    }
  };

}(window.ZB));
