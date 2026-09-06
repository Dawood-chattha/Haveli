/* =========================================================================
   admin-auth.js — the authentication seam
   -------------------------------------------------------------------------
   THERE IS NO AUTHENTICATION IN THIS BUILD.

   This module exists so that there is one place, and only one place, where
   a real service is connected later. The sign-in page talks to it and to
   nothing else, so connecting an auth provider means rewriting the bodies
   of these three methods — not touching the form, its validation, its
   loading state or its error handling.

   WHAT IT DOES TODAY
   `signIn` checks that the input is well formed and then resolves. It does
   not verify anyone, because there is nothing to verify against. Every
   screen that uses it says so plainly to the viewer.

   WHAT IT MUST NEVER DO
   It must never contain a password, an API key, a token, or a list of
   accounts — not even for testing. A credential compared in frontend code
   is a credential published to everyone who opens the page. If a demo
   account is ever wanted, it belongs on a server.

   WHY A FRONTEND CHECK IS NOT SECURITY
   Whatever is added here later, it only decides what this page draws.
   Anyone can open the console and set a variable, or request data directly.
   Real protection has to be enforced where the data lives — permission
   rules or an authorising server that checks the caller's identity and role
   on every read and write. Visiting /admin must never be what makes someone
   an administrator.

   THE SHAPE A REAL IMPLEMENTATION KEEPS
     signIn(email, password, remember) -> Promise, rejects with { message }
     signOut()                         -> Promise
     currentUser()                     -> the signed-in user, or null
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

    /* Mirrors ZB.repo.latency — a sign-in that answered instantly would let
       the loading state go untested, and it is the state most likely to be
       wrong when a real network is behind it. */
    latency: 900,

    /**
     * Field-level checks, returned as a map of field name to message.
     * An empty map means the form may be submitted.
     *
     * Kept here rather than in the page because the rules belong to
     * authentication, and a real provider will replace or extend them.
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
     * Sign in. Resolves with a user object, or rejects with { message }.
     *
     * `remember` is accepted and ignored. It maps to how long a real
     * provider keeps the session — a choice that belongs to the provider,
     * and there is nothing to persist without one. Nothing about the
     * attempt is written to storage: no address, no flag, and above all no
     * password.
     */
    signIn: function (email, password, remember) {
      return new Promise(function (resolve, reject) {
        window.setTimeout(function () {
          var errors = Auth.validate(email, password);

          if (Object.keys(errors).length) {
            reject({ message: 'Check the details above and try again.', fields: errors });
            return;
          }

          /* No verification happens. The address is echoed back so the
             panel has something to show, and is held in memory only — it
             is gone on refresh, which is the honest behaviour when there
             is no session behind it. */
          Auth.user = {
            email: email,
            name: ZB.adminUser ? ZB.adminUser.name : 'Store Owner',
            role: ZB.adminUser ? ZB.adminUser.role : 'Owner'
          };

          resolve(Auth.user);
        }, Auth.latency);
      });
    },

    signOut: function () {
      Auth.user = null;
      return Promise.resolve();
    },

    currentUser: function () {
      return Auth.user || null;
    },

    /* Held in memory on purpose. See signIn. */
    user: null,

    /**
     * Whether the panel should be treated as protected.
     *
     * It answers false, and the panel is therefore open to anyone who knows
     * the address. This is stated on the sign-in screen rather than hidden,
     * because a build that looks protected and is not is worse than one
     * that is plainly open.
     */
    isProtected: function () {
      return false;
    }
  };

  ZB.adminAuth = Auth;

}(window.ZB));
