/* =========================================================================
   account-panel.js — the account drawer, made real
   -------------------------------------------------------------------------
   The panel behind the header's account icon. It used to be markup and
   nothing else: a form with onsubmit="return false" and a note underneath
   admitting it signed nobody in. So a customer who had signed in five
   minutes earlier opened it and was shown a sign-in form, which reads as
   being signed out — and is the reason this was reported as "it makes the
   same user log in again".

   IT SHOWS ONE OF TWO THINGS, AND NEVER BOTH
   Signed out: the sign-in form, and a way to register. Signed in: who you
   are, where to go, and a way to leave. Both live in index.html so the
   panel is complete before a script runs; this file only decides which is
   hidden.

   IT DOES NOT KEEP ITS OWN IDEA OF WHO IS SIGNED IN
   ZB.auth is the one answer, and this subscribes to it. Signing in from
   the account page, signing out from here, or a session refreshing in the
   background all reach this panel the same way, because none of them tell
   it anything — they change ZB.auth and it redraws.
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  function init() {
    var panel = document.getElementById('account-panel');
    if (!panel || !ZB.auth) return;

    var out = panel.querySelector('[data-account-out]');
    var inside = panel.querySelector('[data-account-in]');
    var form = panel.querySelector('#account-panel-form');
    var error = panel.querySelector('[data-account-error]');
    var who = panel.querySelector('[data-account-email]');
    var signOut = panel.querySelector('[data-account-signout]');

    if (!out || !inside || !form) return;

    var say = function (message) {
      if (!error) return;
      error.textContent = message || '';
      error.hidden = !message;
    };

    /**
     * Show the half that matches who is signed in.
     *
     * Called on every change to ZB.auth rather than once at boot: the
     * answer arrives over the network, and a panel drawn before it has
     * would be a sign-in form shown to somebody who is signed in.
     */
    function paint(user) {
      out.hidden = !!user;
      inside.hidden = !user;

      if (user && who) who.textContent = user.email || '';
      if (!user) say('');
    }

    paint(ZB.auth.user);
    ZB.auth.subscribe(paint);

    /* --- signing in ---------------------------------------------------- */

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      say('');

      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      var button = form.querySelector('[type="submit"]');
      var email = form.querySelector('[name="email"]').value.trim();
      var password = form.querySelector('[name="password"]').value;

      button.disabled = true;
      button.textContent = 'Signing in';

      ZB.auth.signIn(email, password).then(function () {
        /* Nothing to draw here: signIn changes ZB.auth, which calls paint
           through the subscription above. The form is emptied so a shared
           computer does not keep somebody's address in a visible box. */
        form.reset();
        button.disabled = false;
        button.textContent = 'Sign in';

        if (ZB.panels && ZB.panels.close) ZB.panels.close();
      }).catch(function (failure) {
        button.disabled = false;
        button.textContent = 'Sign in';
        say((failure && failure.message) || 'Those details did not match an account.');
      });
    });

    /* --- registering ---------------------------------------------------- */

    /* The link goes to /account?register=1 rather than opening a second
       form in here. Registering asks for a name as well and is worth the
       whole width of a page; a drawer is where a returning customer signs
       in, not where a new one fills in a form for the first time. */
    var register = panel.querySelector('[data-account-register]');

    if (register) {
      register.addEventListener('click', function () {
        if (ZB.panels && ZB.panels.close) ZB.panels.close();
      });
    }

    /* --- signing out ---------------------------------------------------- */

    if (signOut) {
      signOut.addEventListener('click', function () {
        signOut.disabled = true;
        signOut.textContent = 'Signing out';

        ZB.auth.signOut().then(function () {
          signOut.disabled = false;
          signOut.textContent = 'Sign out';

          if (ZB.panels && ZB.panels.close) ZB.panels.close();

          /* The page being looked at may be one only a signed-in customer
             should see. Re-rendering the route lets it decide that for
             itself rather than this file guessing which pages those are. */
          if (ZB.router && ZB.router.render) ZB.router.render();
        });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}(window.ZB));
