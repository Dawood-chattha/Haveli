/* =========================================================================
   admin-auth.js — the authentication seam, now connected
   -------------------------------------------------------------------------
   This module was written in the UI-only build as the one place a real
   service would later be attached. This is that attachment, and it is worth
   noting what it did NOT require: the sign-in form, its field validation, its
   loading state, its caps-lock hint, its error plumbing and its markup are
   untouched. Only the bodies of three methods changed.

   WHAT CHANGED

     signIn        was: check the shape of the input and resolve
                   now: POST /api/auth/login, which verifies the password,
                        reads the account's role from the database, and puts
                        the session in an HttpOnly cookie

     signOut       was: forget a variable
                   now: POST /api/auth/logout, which revokes the session
                        upstream and clears the cookies

     requestReset  was: nothing — the screen said plainly that password
                        recovery needed a service and none was connected
                   now: POST /api/auth/forgot, which emails a one-time link

     currentUser   was: a value held in memory
                   now: what the server last reported, via ZB.auth

     isProtected   was: false, and the sign-in screen said so plainly
                   now: true

   WHAT DID NOT CHANGE
   `validate` is exactly as it was. It is a hint that helps someone catch a
   typo before a round trip — it never was, and still is not, a gate. The only
   authority on whether an address and password are right is the server.

   WHY THERE IS STILL NO CREDENTIAL IN THIS FILE
   The old header promised there would never be a password, an API key, a
   token or a list of accounts here, and connecting a real service has not
   changed that. There is no key in this file because the session is in a
   cookie the page cannot read, and no password because the form's value goes
   straight into a request and is never stored.

   AND WHY A FRONTEND CHECK IS STILL NOT SECURITY
   `isProtected` returning true means the panel now redirects a signed-out
   visitor to the sign-in screen. That is a courtesy, not a lock. Anyone can
   set a variable in the console and watch the panel render; what they will
   see is a panel with nothing in it, because every admin endpoint re-checks
   the role in the database and Row Level Security refuses the rows underneath
   that. Visiting /admin has never made anyone an administrator and still
   does not.
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  /* Deliberately permissive. Address validation is a hint that helps someone
     catch a typo, not a gate — the only authority on whether an address is
     real is the service that owns the account. */
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /* Long enough to catch an empty or half-typed field. It is not a password
     policy: strength is enforced where accounts are created, not here. */
  var MIN_PASSWORD = 8;

  var Auth = {

    /**
     * Field-level checks, returned as a map of field name to message.
     * An empty map means the form may be submitted.
     *
     * Unchanged from the UI-only build. It belongs to the form, not to the
     * service, and a real provider replaces what happens after it rather than
     * what it does.
     */
    validate: function (email, password) {
      var errors = {};

      if (!email) errors.email = 'Enter your email address.';
      else if (!EMAIL.test(email)) errors.email = 'That does not look like an email address.';

      if (!password) errors.password = 'Enter your password.';
      else if (password.length < MIN_PASSWORD) {
        errors.password = 'Passwords are at least ' + MIN_PASSWORD + ' characters.';
      }

      return errors;
    },

    /**
     * Sign in. Resolves with the user, or rejects with { message, fields }.
     *
     * The local check runs first purely to save a round trip on an obviously
     * incomplete form. It is not a gate: an empty password that got past it
     * would be refused by the server, which is where the decision is made.
     *
     * A SIGNED-IN CUSTOMER IS NOT AN ERROR HERE
     * Anyone with an account can sign in at this screen — it is the same
     * endpoint the storefront uses, because two authentication paths would
     * mean two places for a flaw. What a customer cannot do is get past this
     * screen: the panel checks `isAdmin` and every endpoint behind it checks
     * the database. They are told plainly rather than left at a form that
     * appears to fail.
     *
     * `remember` is accepted and ignored, as before. How long a session lasts
     * is decided by the server's cookie, not by a checkbox that the browser
     * could change.
     */
    signIn: function (email, password, remember) {
      var errors = Auth.validate(email, password);

      if (Object.keys(errors).length) {
        return Promise.reject({
          message: 'Check the details above and try again.',
          fields: errors
        });
      }

      return ZB.auth.signIn(email, password).then(function (user) {
        if (!user.isAdmin) {
          /* Signed in, but not here. The session is left in place — they are
             a legitimate customer and may use the shop — and the panel simply
             does not open. */
          return Promise.reject({
            message: 'That account does not have access to the owner panel.'
          });
        }
        return user;
      });
    },

    /**
     * Ask for a password-reset email.
     *
     * The same endpoint the storefront uses, for the same reason signIn is:
     * two paths to one account's password would be two places for a flaw.
     *
     * IT ANSWERS THE SAME WAY FOR AN ADDRESS WITH NO ACCOUNT
     * Deliberately, and it matters more here than on the shop's own page. An
     * owner sign-in screen that confirmed which addresses have accounts would
     * confirm which address is the owner's, which is the one address worth
     * knowing to anybody trying to get into this panel. So the screen below
     * repeats the server's wording rather than inventing a friendlier one.
     *
     * WHERE THE LINK GOES
     * To /reset-password on the storefront, which is where the new password is
     * chosen — by the owner and by customers alike, because it is the same
     * account system. There is nothing about the panel on that page, and the
     * owner comes back here to sign in afterwards.
     */
    requestReset: function (email) {
      if (!email) {
        return Promise.reject({
          message: 'Enter the email address of the account.',
          fields: { email: 'Enter your email address.' }
        });
      }

      if (!EMAIL.test(email)) {
        return Promise.reject({
          message: 'That does not look like an email address.',
          fields: { email: 'That does not look like an email address.' }
        });
      }

      return ZB.auth.requestReset(email);
    },

    signOut: function () {
      return ZB.auth.signOut();
    },

    /** The signed-in user, or null. Reported by the server, not remembered
        here — see the header. */
    currentUser: function () {
      return ZB.auth.user || null;
    },

    /**
     * Whether the panel should be treated as protected.
     *
     * True now. The sign-in screen no longer tells viewers the panel is open,
     * because it is not.
     */
    isProtected: function () {
      return true;
    }
  };

  /* Kept as a property for the sake of anything that read it, and derived
     rather than stored so it cannot disagree with ZB.auth. */
  Object.defineProperty(Auth, 'user', {
    get: function () { return ZB.auth ? ZB.auth.user : null; }
  });

  ZB.adminAuth = Auth;

}(window.ZB));
