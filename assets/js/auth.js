/* =========================================================================
   auth.js — the browser's side of signing in
   -------------------------------------------------------------------------
   Shared by both shells: the storefront's account page and the admin panel's
   sign-in screen talk to this, and to nothing else.

   THERE IS NO TOKEN IN THIS FILE
   Nothing here reads, writes or holds a session token, and there is nowhere in
   this module it could be kept. The session lives in a cookie marked HttpOnly,
   which JavaScript cannot read by design — so a script injected into this page
   cannot take the session away with it.

   The consequence is that the page cannot tell who it is by looking. It has to
   ask, which is what `load()` does, and it has to sign in by asking the server
   to do it rather than by calling an auth service directly. That is a real
   cost — one extra request on boot — paid deliberately.

   `ZB.auth.user` IS FOR DRAWING, NOT FOR DECIDING
   It says what the server last reported. Anyone can set it to
   `{ isAdmin: true }` from the console and watch the admin panel render, and
   they will be looking at a panel with no data in it: every admin endpoint
   re-checks the database, and every Row Level Security policy checks it again
   underneath that. Nothing in this file is a permission. Nothing in any file
   the browser downloads could be.
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  /**
   * Read one JSON response in the shape every endpoint answers in.
   *
   * A failure is rejected rather than returned, so callers use the same
   * try/catch path for a network error and a refused sign-in. The rejection
   * carries `message` and, where the server sent them, per-field messages —
   * which is exactly the shape the admin sign-in form already expects.
   */
  function readAnswer(response) {
    return response.text().then(function (text) {
      var body = null;
      try { body = JSON.parse(text); } catch (e) { /* not JSON */ }

      if (!body || typeof body.ok !== 'boolean') {
        /* Reaching here usually means /api is not being served at all — the
           static-only dev server answers with index.html, which parses as
           nothing. Saying so is more use than "unexpected token <". */
        throw {
          message: 'The server did not answer as expected. If this is a local ' +
                   'machine, check that the API is running (npm run dev).'
        };
      }

      if (!body.ok) {
        throw {
          message: (body.error && body.error.message) || 'Something went wrong.',
          code: body.error && body.error.code,
          fields: (body.error && body.error.fields) || null
        };
      }

      return body.data;
    });
  }

  function call(path, options) {
    options = options || {};

    var init = {
      method: options.method || 'GET',
      headers: { 'Accept': 'application/json' },

      /* Without this the session cookie is not sent, and every request is
         anonymous no matter who is signed in. */
      credentials: 'same-origin'
    };

    if (options.body) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }

    return fetch(path, init).then(readAnswer).catch(function (err) {
      /* A thrown object from readAnswer already has a message. A genuine
         network failure is a TypeError with an unhelpful one. */
      if (err && err.message && !(err instanceof TypeError)) throw err;
      throw { message: 'Could not reach the server. Check your connection.' };
    });
  }

  var listeners = [];

  var Auth = {

    /** The last answer from the server. Null when signed out, and null before
        load() has finished — see `ready`. */
    user: null,

    /** False until the first load() settles, so a page can tell "signed out"
        apart from "not asked yet". Drawing a signed-out header during that
        gap is the flicker this exists to prevent. */
    loaded: false,

    /**
     * Ask the server who this is.
     *
     * Called once at boot by each shell. The promise is kept so that several
     * callers during boot share one request rather than making three.
     */
    ready: null,

    load: function (force) {
      if (Auth.ready && !force) return Auth.ready;

      Auth.ready = call('/api/auth/me')
        .then(function (data) {
          Auth.user = data.user || null;
          Auth.loaded = true;
          emit();
          return Auth.user;
        })
        .catch(function () {
          /* A failure to reach the server is not a signed-in state, and it is
             not an error a shop's visitor should be shown. The site works
             signed out. */
          Auth.user = null;
          Auth.loaded = true;
          emit();
          return null;
        });

      return Auth.ready;
    },

    /**
     * Sign in.
     *
     * Resolves with the user. Rejects with { message, fields } — the same
     * shape the admin sign-in form was already written against, which is why
     * that form needs no changes.
     */
    signIn: function (email, password) {
      return call('/api/auth/login', {
        method: 'POST',
        body: { email: email, password: password }
      }).then(function (data) {
        Auth.user = data.user;
        Auth.loaded = true;
        emit();
        return Auth.user;
      });
    },

    /**
     * Create an account. This does not sign anybody in.
     *
     * No cookies come back and nothing here changes — the new customer
     * signs in through the form, which is what the shop's owner asked for.
     * The answer carries `ready`, saying whether that will work yet, and
     * the address to fill the form in with.
     */
    signUp: function (email, password, name) {
      return call('/api/auth/signup', {
        method: 'POST',
        body: { email: email, password: password, name: name || '' }
      });
    },

    /**
     * Sign out.
     *
     * The local user is cleared whatever happens. A logout that reports
     * failure and leaves the page looking signed in is worse than one that
     * clears what it can — and the server clears its cookies even when
     * revoking the session upstream fails.
     */
    signOut: function () {
      return call('/api/auth/logout', { method: 'POST' })
        .catch(function () { /* clear locally regardless */ })
        .then(function () {
          Auth.user = null;
          Auth.loaded = true;
          emit();
        });
    },

    isSignedIn: function () { return !!Auth.user; },

    /** What the panel asks before drawing itself. Not a permission. */
    isAdmin: function () { return !!(Auth.user && Auth.user.isAdmin); },

    subscribe: function (fn) {
      listeners.push(fn);
      fn(Auth.user);
      return function () {
        listeners = listeners.filter(function (l) { return l !== fn; });
      };
    }
  };

  function emit() {
    listeners.forEach(function (fn) {
      try { fn(Auth.user); } catch (e) { /* one bad listener is not the others' problem */ }
    });
  }

  ZB.auth = Auth;

}(window.ZB));
