/* =========================================================================
   api/auth/logout.js — POST /api/auth/logout
   -------------------------------------------------------------------------
   -> { signedOut: true }

   TWO THINGS HAVE TO HAPPEN, AND ONLY ONE OF THEM IS THE COOKIE
   Clearing the cookies signs this browser out. It does nothing to the token
   itself, which remains valid until it expires — so a copy taken beforehand
   would still work. Supabase is therefore asked to revoke the session as
   well, which invalidates the refresh token server-side.

   Order matters: revoke first, clear second. If the revoke fails the cookies
   are still cleared, because a logout button that reports failure and leaves
   someone signed in is worse than one that half-succeeds quietly. The failure
   is logged.

   POST, NOT GET
   A GET would be triggerable by an <img> tag on any page on the internet,
   signing people out for fun. As a POST, SameSite=Lax means the cookie is not
   attached to a cross-site request at all.

   IT ALWAYS SUCCEEDS
   Logging out when already logged out is not an error; it is the state the
   caller asked for. Returning 401 here would leave a page unable to clear a
   session it cannot verify.
   ========================================================================= */

'use strict';

var respond = require('../../_lib/respond');
var Cookies = require('../../_lib/cookies');
var db = require('../../_lib/supabase');
var log = require('../../_lib/log');

module.exports = respond.handler(['POST'], async function (req, res) {

  var token = Cookies.accessToken(req);

  if (token) {
    try {
      var client = db.asUser({ headers: { authorization: 'Bearer ' + token } });
      await client.auth.signOut();
    } catch (err) {
      /* The cookies are cleared regardless — see the note above. */
      log.error('could not revoke session', err);
    }
  }

  Cookies.clear(req, res);

  return { signedOut: true };
});
