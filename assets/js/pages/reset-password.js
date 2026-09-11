/* =========================================================================
   pages/reset-password.js — the only way back into a locked-out account
   -------------------------------------------------------------------------
   One route, /reset-password, with four panes. Which one is showing depends
   entirely on what is in the URL when the page opens:

     ask      no token in the link  ->  "email me a link"
     choose   a recovery token      ->  "choose a new password"
     expired  an error from the auth service, or a used link
     signin   the password has just been changed

   WHY ASK AND CHOOSE ARE THE SAME ROUTE
   Because they are the same errand, interrupted by an email. Somebody who
   asks for a link and then follows it should arrive somewhere that looks like
   where they started, and a second URL to get wrong — bookmarked, mistyped,
   linked to from the wrong place — buys nothing.

   THE TOKEN IS READ ONCE AND NEVER STORED
   It arrives in the fragment of the link Supabase redirects to. Two things
   happen to it here and nothing else: it is copied into a variable inside
   mount(), and it is sent to /api/auth/reset when the form is submitted. It
   is not put in localStorage, not in sessionStorage, not in a cookie, and not
   into any element's markup.

   AND IT IS WIPED OUT OF THE ADDRESS BAR IMMEDIATELY
   A token sitting in window.location is a token in the browser's history, in
   a screenshot of the tab, and in whatever gets pasted into a chat window by
   somebody asking why the page will not load. history.replaceState removes it
   the moment it has been read, which costs nothing: the variable already has
   it, and the form does not need the URL.

   WHAT THIS PAGE CANNOT DO
   It cannot sign anybody in by itself, and it does not try. Changing the
   password ends every session the account had — that is the point of a reset —
   and then this page shows an ordinary sign-in form with the address filled
   in. The same shape as registering, for the same reason the shop's owner gave
   there: the first use of a new password should happen while the person who
   chose it is still sitting in front of the form.
   ========================================================================= */

window.ZB = window.ZB || {};
window.ZB.pages = window.ZB.pages || {};

(function (ZB) {
  'use strict';

  var MIN_PASSWORD = 8;

  /**
   * Read a fragment or query string into a plain object.
   *
   * Written out rather than handed to URLSearchParams because the fragment
   * arrives with '+' standing in for spaces in error_description, which
   * URLSearchParams handles for a query and not for a fragment.
   */
  function parsePairs(raw) {
    var out = {};

    String(raw || '').replace(/^[#?]/, '').split('&').forEach(function (pair) {
      if (!pair) return;

      var eq = pair.indexOf('=');
      var key = eq > -1 ? pair.slice(0, eq) : pair;
      var value = eq > -1 ? pair.slice(eq + 1) : '';

      try {
        out[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
      } catch (e) {
        out[key] = value;
      }
    });

    return out;
  }

  ZB.pages.resetPassword = {

    title: 'Password',

    render: function () {
      var ui = ZB.ui;

      return '' +
        '<div class="route-page container">' +
          ui.breadcrumbs([
            { label: 'Home', path: '/' },
            { label: 'Account', path: '/account' },
            { label: 'Password' }
          ]) +
          ui.pageHead({ eyebrow: 'Account', title: 'Reset your password' }) +

          '<div class="account" id="reset-root">' +

            /* ---- ask: no token, so request one ---- */
            '<form class="account__form" data-pane="ask" novalidate hidden>' +
              '<p class="account__note">' +
                'Enter the address you signed up with and we will email you a ' +
                'link to choose a new password. The link works once, and stops ' +
                'working after an hour.' +
              '</p>' +
              '<label class="field-label">Email' +
                '<input class="field" type="email" name="email" autocomplete="email" required>' +
              '</label>' +
              '<button class="btn btn--primary btn--block" type="submit">Email me a link</button>' +
              '<p class="account__note" data-say role="status"></p>' +
              '<p class="account__note">' +
                'Remembered it? <a href="' + ui.href('/account') + '">Back to sign in</a>' +
              '</p>' +
            '</form>' +

            /* ---- choose: the link was good ---- */
            '<form class="account__form" data-pane="choose" novalidate hidden>' +
              '<p class="account__note">' +
                'Choose a new password. At least ' + MIN_PASSWORD + ' characters — ' +
                'length is what makes a password hard to guess, so there is no ' +
                'required symbol or capital.' +
              '</p>' +
              '<label class="field-label">New password' +
                '<input class="field" type="password" name="password"' +
                      ' autocomplete="new-password" required minlength="' + MIN_PASSWORD + '">' +
              '</label>' +
              '<label class="field-label">New password again' +
                '<input class="field" type="password" name="confirm"' +
                      ' autocomplete="new-password" required minlength="' + MIN_PASSWORD + '">' +
              '</label>' +
              '<button class="btn btn--primary btn--block" type="submit">Save new password</button>' +
              '<p class="account__note" data-say role="status"></p>' +
              '<p class="account__note">' +
                'Saving this signs out anyone using the old password, on every ' +
                'device.' +
              '</p>' +
            '</form>' +

            /* ---- expired: the link was not good ---- */
            '<div data-pane="expired" hidden>' +
              '<p class="account__note is-error" role="alert" data-expired-text></p>' +
              '<p class="account__note">' +
                '<a href="/reset-password" data-ask-again>Request a new link</a>' +
              '</p>' +
            '</div>' +

            /* ---- signin: it is changed, so use it ---- */
            '<form class="account__form" data-pane="signin" novalidate hidden>' +
              '<label class="field-label">Email' +
                '<input class="field" type="email" name="email" autocomplete="email" required>' +
              '</label>' +
              '<label class="field-label">Password' +
                '<input class="field" type="password" name="password"' +
                      ' autocomplete="current-password" required>' +
              '</label>' +
              '<button class="btn btn--primary btn--block" type="submit">Sign in</button>' +
              '<p class="account__note" data-say role="status"></p>' +
            '</form>' +

          '</div>' +
        '</div>';
    },

    mount: function () {
      var root = document.getElementById('reset-root');
      if (!root) return;

      var panes = root.querySelectorAll('[data-pane]');
      var heading = document.querySelector('.page-head__title');

      var HEADINGS = {
        ask: 'Reset your password',
        choose: 'Choose a new password',
        expired: 'That link has expired',
        signin: 'Sign in'
      };

      function show(name) {
        Array.prototype.forEach.call(panes, function (pane) {
          pane.hidden = pane.getAttribute('data-pane') !== name;
        });

        if (heading && HEADINGS[name]) heading.textContent = HEADINGS[name];
      }

      function say(pane, message, bad) {
        var note = root.querySelector('[data-pane="' + pane + '"] [data-say]');
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

      /* -------------------------------------------------------------------
         What was in the link
         ------------------------------------------------------------------- */

      /* The fragment first, which is where the tokens are, then the query,
         which is where some versions of the auth service put errors. */
      var fromHash = parsePairs(window.location.hash);
      var fromQuery = parsePairs(window.location.search);

      /* THE ONLY COPY OF THE TOKEN. A local variable in a closure, gone when
         this page is left. See the header. */
      var token = fromHash.access_token || '';

      var failure = fromHash.error_description || fromHash.error ||
                    fromQuery.error_description || fromQuery.error || '';

      /* Out of the address bar, out of the history entry, out of the next
         screenshot. Done before anything can go wrong further down, and only
         in history mode — in hash mode the route itself lives there. */
      if (ZB.router.mode === 'history' && window.location.hash) {
        try {
          window.history.replaceState(null, '',
            window.location.pathname + window.location.search);
        } catch (e) { /* an old browser keeps its fragment; nothing else breaks */ }
      }

      if (token) show('choose');
      else if (failure) {
        root.querySelector('[data-expired-text]').textContent =
          failure + '. Reset links work once and expire after an hour.';
        show('expired');
      } else show('ask');

      /* The "request a new link" link is this same route, so the router
         treats it as a click on the page you are already on and only scrolls.
         Switching panes is what was meant. */
      var again = root.querySelector('[data-ask-again]');
      if (again) {
        again.addEventListener('click', function (e) {
          e.preventDefault();
          show('ask');
          var box = root.querySelector('[data-pane="ask"] [name="email"]');
          if (box) box.focus();
        });
      }

      /* -------------------------------------------------------------------
         ask — send me a link
         ------------------------------------------------------------------- */

      var askForm = root.querySelector('[data-pane="ask"]');

      askForm.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!askForm.checkValidity()) { askForm.reportValidity(); return; }

        var email = String(new FormData(askForm).get('email') || '').trim();

        busy(askForm, true, 'Sending');
        say('ask', '');

        ZB.auth.requestReset(email)
          .then(function (result) {
            busy(askForm, false, 'Email me a link');
            askForm.reset();

            /* Worded as the server words it, which is deliberately
               non-committal: it must not reveal whether that address has an
               account here. */
            say('ask', (result && result.message) ||
                       'If that address has an account, a link is on its way.');
          })
          .catch(function (err) {
            busy(askForm, false, 'Email me a link');
            say('ask', (err && err.message) ||
                       'That could not be sent. Try again in a moment.', true);
          });
      });

      /* -------------------------------------------------------------------
         choose — the new password
         ------------------------------------------------------------------- */

      var chooseForm = root.querySelector('[data-pane="choose"]');

      chooseForm.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!chooseForm.checkValidity()) { chooseForm.reportValidity(); return; }

        var data = new FormData(chooseForm);
        var password = String(data.get('password') || '');
        var confirm = String(data.get('confirm') || '');

        /* Checked here because the server has no way to: it is sent one
           password, and two boxes that disagree is a typo, not a refusal. */
        if (password !== confirm) {
          say('choose', 'Those two passwords are not the same.', true);
          var second = chooseForm.querySelector('[name="confirm"]');
          if (second) { second.value = ''; second.focus(); }
          return;
        }

        busy(chooseForm, true, 'Saving');
        say('choose', '');

        ZB.auth.resetPassword(token, password)
          .then(function (result) {
            chooseForm.reset();
            busy(chooseForm, false, 'Save new password');

            /* Used up. Keeping it would serve no purpose — the server has
               revoked it — and a variable holding a dead key is still a
               variable holding a key. */
            token = '';

            show('signin');

            var signin = root.querySelector('[data-pane="signin"]');
            var address = signin.querySelector('[name="email"]');
            var secret = signin.querySelector('[name="password"]');

            if (address && result && result.email) address.value = result.email;
            if (secret) secret.focus();

            say('signin', (result && result.message) ||
                          'Your password has been changed. Sign in to continue.');
          })
          .catch(function (err) {
            busy(chooseForm, false, 'Save new password');

            /* A 401 means the link has been used or has timed out, and there
               is nothing useful left on this form — the whole pane is the
               wrong thing to be looking at. */
            if (err && err.code === 'unauthorized') {
              token = '';
              root.querySelector('[data-expired-text]').textContent =
                err.message || 'This reset link has expired.';
              show('expired');
              return;
            }

            say('choose', (err && err.message) ||
                          'That password could not be saved.', true);
          });
      });

      /* -------------------------------------------------------------------
         signin — straight afterwards, on the same page
         ------------------------------------------------------------------- */

      var signinForm = root.querySelector('[data-pane="signin"]');

      signinForm.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!signinForm.checkValidity()) { signinForm.reportValidity(); return; }

        var data = new FormData(signinForm);

        busy(signinForm, true, 'Signing in');
        say('signin', '');

        ZB.auth.signIn(String(data.get('email') || '').trim(),
                       String(data.get('password') || ''))
          .then(function () {
            /* The account page, never the owner panel — that address is not
               advertised anywhere on the storefront, and an owner who has
               just reset their password knows where it is. */
            ZB.router.navigate('/account');
          })
          .catch(function (err) {
            busy(signinForm, false, 'Sign in');
            say('signin', (err && err.message) ||
                          'Could not sign in. Try again.', true);
          });
      });
    }
  };

}(window.ZB));
