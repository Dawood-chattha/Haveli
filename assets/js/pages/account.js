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

      /* -------------------------------------------------------------------
         The address book

         WHY THIS IS ON THE ACCOUNT PAGE AND NOT ONLY IN THE CHECKOUT
         A saved address is worth changing when it is wrong, not only when
         something is being bought. Somebody who has moved should not have
         to start an order to correct where their parcels go.

         WHAT DELETING ONE DOES NOT DO
         It does not change any order. place_order copies the address onto
         the order as a snapshot, so an order that shipped here last month
         still says so. The wording below says that, because "delete" beside
         an address a parcel is currently travelling to is a frightening
         button without it.
         ------------------------------------------------------------------- */

      var addressHost = null;
      var addressRows = [];
      var addressBusy = false;

      function addressApi(method, path, body) {
        return fetch('/api/account/addresses' + path, {
          method: method,
          headers: Object.assign({ Accept: 'application/json' },
                                 body ? { 'Content-Type': 'application/json' } : {}),
          credentials: 'same-origin',
          body: body ? JSON.stringify(body) : undefined
        }).then(function (res) {
          return res.json().then(function (payload) {
            if (!res.ok || !payload.ok) {
              var err = new Error((payload.error && payload.error.message) ||
                                  'That did not work.');
              err.fields = payload.error && payload.error.fields;
              throw err;
            }
            return payload.data;
          });
        });
      }

      /** One line of the address, as it would be written on a parcel. */
      function addressLine(row) {
        return [row.line1, row.line2, row.city, row.postcode]
          .filter(function (part) { return part; })
          .join(', ');
      }

      function addressCard(row) {
        return '' +
          '<li class="account__address' + (row.isDefault ? ' is-default' : '') + '"' +
              ' data-address="' + ui.esc(row.id) + '">' +
            '<div class="account__address-head">' +
              '<span class="account__address-label">' +
                ui.esc(row.label || row.city) +
              '</span>' +
              (row.isDefault
                ? '<span class="account__address-flag">Default</span>'
                : '') +
            '</div>' +
            '<p class="account__address-body">' +
              ui.esc(row.name) + ' · ' + ui.esc(row.phone) + '<br>' +
              ui.esc(addressLine(row)) +
            '</p>' +
            '<div class="account__address-actions">' +
              (row.isDefault
                ? ''
                : '<button class="btn btn--sm" type="button" data-make-default>' +
                    'Make default' +
                  '</button>') +
              '<button class="btn btn--sm" type="button" data-remove-address>' +
                'Remove' +
              '</button>' +
            '</div>' +
          '</li>';
      }

      function addressForm() {
        return '' +
          '<form class="account__address-form" id="address-form" novalidate hidden>' +
            '<div class="checkout__pair">' +
              '<label class="field-label">Name this address ' +
                '<span class="field-label__hint">optional</span>' +
                '<input class="field" type="text" name="label" maxlength="40"' +
                      ' placeholder="Home, Office">' +
              '</label>' +
              '<label class="field-label">Full name' +
                '<input class="field" type="text" name="name" autocomplete="name" required>' +
              '</label>' +
            '</div>' +

            '<label class="field-label">Phone' +
              '<input class="field" type="tel" name="phone" autocomplete="tel" required' +
                    ' inputmode="tel" placeholder="03xx xxxxxxx">' +
            '</label>' +

            '<label class="field-label">Address' +
              '<input class="field" type="text" name="line1" autocomplete="address-line1"' +
                    ' required placeholder="House and street">' +
            '</label>' +

            '<label class="field-label">Area <span class="field-label__hint">optional</span>' +
              '<input class="field" type="text" name="line2" autocomplete="address-line2">' +
            '</label>' +

            '<div class="checkout__pair">' +
              '<label class="field-label">City' +
                '<input class="field" type="text" name="city" autocomplete="address-level2"' +
                      ' required>' +
              '</label>' +
              '<label class="field-label">Postcode ' +
                '<span class="field-label__hint">optional</span>' +
                '<input class="field" type="text" name="postalCode"' +
                      ' autocomplete="postal-code">' +
              '</label>' +
            '</div>' +

            '<p class="account__note" role="alert" data-address-error hidden></p>' +

            '<div class="account__address-form-actions">' +
              '<button class="btn btn--primary" type="submit">Save address</button>' +
              '<button class="btn" type="button" data-cancel-address>Cancel</button>' +
            '</div>' +
          '</form>';
      }

      function paintAddresses() {
        if (!addressHost) return;

        addressHost.innerHTML =
          (addressRows.length
            ? '<ul class="account__addresses">' +
                addressRows.map(addressCard).join('') +
              '</ul>'
            : '<p class="account__note">' +
                'No saved addresses yet. Save one and the checkout will offer it.' +
              '</p>') +

          '<button class="btn btn--block" type="button" data-add-address>' +
            'Add an address' +
          '</button>' +

          addressForm();
      }

      function showAddresses(host) {
        addressHost = host;

        addressApi('GET', '').then(function (data) {
          if (!document.body.contains(host)) return;
          addressRows = data.items || [];
          paintAddresses();
        }).catch(function () {
          if (!document.body.contains(host)) return;
          host.innerHTML = '<p class="account__note">Your addresses could not be loaded.</p>';
        });
      }

      /* One listener on the section rather than one per button: the list is
         redrawn after every change, and handlers bound to the old buttons
         would be bound to elements that are no longer in the document. */
      function bindAddresses(root) {
        root.addEventListener('click', function (e) {
          var add = e.target.closest('[data-add-address]');
          var cancel = e.target.closest('[data-cancel-address]');
          var makeDefault = e.target.closest('[data-make-default]');
          var remove = e.target.closest('[data-remove-address]');

          if (add) {
            var form = root.querySelector('#address-form');
            add.hidden = true;
            form.hidden = false;
            form.querySelector('[name="name"]').focus();
            return;
          }

          if (cancel) {
            paintAddresses();
            return;
          }

          if (makeDefault || remove) {
            var card = e.target.closest('[data-address]');
            if (!card || addressBusy) return;

            var id = card.getAttribute('data-address');
            addressBusy = true;

            var work = makeDefault
              ? addressApi('PATCH', '/' + encodeURIComponent(id), { isDefault: true })
              : addressApi('DELETE', '/' + encodeURIComponent(id));

            work.then(function () {
              return addressApi('GET', '');
            }).then(function (data) {
              addressRows = data.items || [];
              paintAddresses();
            }).catch(function (err) {
              window.alert(err.message);
            }).then(function () {
              addressBusy = false;
            });
          }
        });

        root.addEventListener('submit', function (e) {
          var form = e.target.closest('#address-form');
          if (!form) return;

          e.preventDefault();
          if (addressBusy) return;

          var note = form.querySelector('[data-address-error]');
          var button = form.querySelector('[type="submit"]');
          var value = function (name) {
            var el = form.querySelector('[name="' + name + '"]');
            return el ? el.value.trim() : '';
          };

          note.hidden = true;
          addressBusy = true;
          button.disabled = true;
          button.textContent = 'Saving';

          addressApi('POST', '', {
            label: value('label') || undefined,
            name: value('name'),
            phone: value('phone'),
            line1: value('line1'),
            line2: value('line2') || undefined,
            city: value('city'),
            postalCode: value('postalCode') || undefined
          }).then(function () {
            return addressApi('GET', '');
          }).then(function (data) {
            addressRows = data.items || [];
            paintAddresses();
          }).catch(function (err) {
            /* The field-level messages the server sent, joined — the form
               is short enough that one line above the buttons is easier to
               act on than six markers to hunt for. */
            var fields = err.fields
              ? Object.keys(err.fields).map(function (k) { return err.fields[k]; })
              : [];

            note.textContent = fields.length ? fields.join(' ') : err.message;
            note.hidden = false;
            button.disabled = false;
            button.textContent = 'Save address';
          }).then(function () {
            addressBusy = false;
          });
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

            '<h2 class="account__heading">Delivery addresses</h2>' +
            '<p class="account__note">' +
              'Saved here and offered at the checkout. Removing one does not ' +
              'change any order already placed — an order keeps the address ' +
              'it was sent to.' +
            '</p>' +
            '<div id="account-addresses">' + ui.pending('your addresses') + '</div>' +

            '<a class="btn btn--primary btn--block" href="/wishlist">Your wishlist</a>' +
            '<button class="btn btn--block" type="button" data-signout>Sign out</button>' +
          '</div>';

        showOrders(document.getElementById('account-orders'));
        showAddresses(document.getElementById('account-addresses'));
        bindAddresses(root);

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
