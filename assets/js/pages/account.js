/* =========================================================================
   pages/account.js — account interface
   -------------------------------------------------------------------------
   Sign-in and register are presentation only: no credentials are checked,
   stored or sent anywhere. The tabs and validation states are real UI.
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

          '<div class="account">' +
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
              '<p class="account__note">Interface only — nothing is submitted and no account is created.</p>' +
            '</form>' +

            '<form class="account__form" data-form="register" hidden novalidate>' +
              '<label class="field-label">Name' +
                '<input class="field" type="text" name="name" autocomplete="name" required>' +
              '</label>' +
              '<label class="field-label">Email' +
                '<input class="field" type="email" name="email" autocomplete="email" required>' +
              '</label>' +
              '<label class="field-label">Password' +
                '<input class="field" type="password" name="password" autocomplete="new-password" required>' +
              '</label>' +
              '<button class="btn btn--primary btn--block" type="submit">Create account</button>' +
              '<p class="account__note">Interface only — nothing is submitted and no account is created.</p>' +
            '</form>' +
          '</div>' +
        '</div>';
    },

    mount: function () {
      var root = document.querySelector('.account');
      if (!root) return;

      var tabs = root.querySelectorAll('.account__tab');
      var forms = root.querySelectorAll('.account__form');

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

      Array.prototype.forEach.call(forms, function (form) {
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          // Show the browser's own validation, then stop.
          if (!form.checkValidity()) {
            form.reportValidity();
            return;
          }
          var note = form.querySelector('.account__note');
          if (note) note.textContent = 'Looks valid — but this build has no account service behind it.';
        });
      });
    }
  };

}(window.ZB));
