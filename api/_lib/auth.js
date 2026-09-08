/* =========================================================================
   api/_lib/auth.js — who is calling
   -------------------------------------------------------------------------
   This module answers one question — who sent this request — and refuses to
   answer a second one until there is a table to answer it from.

   WHAT IS HERE (PHASE 1)
     bearerToken(req)   the raw access token, or ''
     currentUser(req)   the verified user, or null
     requireUser(req)   the verified user, or a 401

   WHAT IS NOT HERE YET
     requireAdmin(req)  arrives in Phase 3, because it must read a role from
                        the `profiles` table and that table is created in
                        Phase 2. A stub that returned true, or that trusted
                        a claim in the token, would be worse than its
                        absence: an endpoint could be written against it and
                        look protected while being open.

   VERIFICATION IS NOT DECODING
   A JWT is base64, not a lock. Anyone can write one that says
   `{"role":"admin"}` and send it. What makes a token trustworthy is the
   signature, and checking that signature requires the secret the token was
   signed with — which is why this module hands the token to Supabase rather
   than reading it here. `auth.getUser(token)` verifies against the project
   that issued it and returns nothing if the signature does not hold.

   So: this file never calls a decode function, never reads a claim out of
   the token string, and never accepts a user id from a header, a query
   parameter or a body. Those are all things a caller controls.

   WHY ROLE WILL COME FROM THE DATABASE, NOT THE TOKEN
   When requireAdmin is written in Phase 3, it will read `profiles.role`
   with a fresh query on every call. A role copied into a token is a
   snapshot: revoke someone's access and their existing token still says
   admin until it expires. Reading the row means access ends the moment it
   is withdrawn.
   ========================================================================= */

'use strict';

var db = require('./supabase');
var Errors = require('./errors');
var log = require('./log');

/**
 * The verified user behind this request, or null.
 *
 * Returns null for every failure mode — no header, malformed token, expired
 * token, bad signature, unreachable auth service — because an endpoint's
 * decision is the same in all of them, and telling the difference apart in
 * a response would help someone probing for valid tokens.
 */
async function currentUser(req) {
  var token = db.bearerToken(req);
  if (!token) return null;

  var client = db.asUser(req);

  var result;
  try {
    result = await client.auth.getUser(token);
  } catch (err) {
    /* A network failure reaching Supabase, not a rejected token. Logged so
       an outage is visible, but the caller is still simply unauthenticated. */
    log.error('could not verify token', err);
    return null;
  }

  if (result.error || !result.data || !result.data.user) return null;

  var user = result.data.user;

  return {
    id: user.id,
    email: user.email || null,

    /* Deliberately NOT copied from the token:
         role         — read from profiles in Phase 3, see the header
         name, phone  — belong to the profiles row, not to auth
       Anything derived from user_metadata is written by the account holder
       and is therefore caller-controlled data, not identity. */
    emailConfirmed: !!user.email_confirmed_at
  };
}

/**
 * The verified user, or a 401.
 *
 * The message is the same whether there was no token or a bad one. There is
 * nothing useful for a legitimate caller in the difference, and something
 * useful in it for an illegitimate one.
 */
async function requireUser(req) {
  var user = await currentUser(req);
  if (!user) throw Errors.unauthorized('Sign in to continue.');
  return user;
}

module.exports = {
  bearerToken: db.bearerToken,
  currentUser: currentUser,
  requireUser: requireUser

  /* requireAdmin — Phase 3. See the header for why it is not stubbed. */
};
