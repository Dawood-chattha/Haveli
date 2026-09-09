/* =========================================================================
   api/_lib/auth.js — who is calling, and what they are allowed to be
   -------------------------------------------------------------------------
     bearerToken(req)   the raw access token, or ''
     currentUser(req)   the verified user with their role, or null
     requireUser(req)   the verified user, or a 401
     requireAdmin(req)  the verified user if they are an admin, or a 401/403

   VERIFICATION IS NOT DECODING
   A JWT is base64, not a lock. Anyone can write one that says
   {"role":"admin"} and send it. What makes a token trustworthy is its
   signature, and checking that requires the secret it was signed with — which
   is why this module hands the token to Supabase rather than reading it here.
   `auth.getUser(token)` verifies against the project that issued it and
   returns nothing if the signature does not hold.

   So this file never decodes a token, never reads a claim out of the string,
   and never accepts a user id from a header, a query parameter or a body.
   Those are all things a caller controls.

   THE ROLE COMES FROM THE DATABASE, ON EVERY CALL
   Not from the token, even after the signature is verified. Two reasons:

     A role in a token is a snapshot. Revoke someone's admin access and their
     existing token keeps saying admin until it expires, which may be an hour
     — an hour during which a dismissed employee still has the panel.

     The role is not in the token in the first place. Supabase's JWT carries
     what Supabase knows, and `profiles.role` is this application's own idea.
     Putting it into the token would mean maintaining a copy of the truth.

   It is read with the service role rather than as the caller. Reading it as
   the caller would work — the "profiles: read own" policy allows it — but it
   would make an authorization decision depend on a policy being correct, and
   the policies are the thing this check exists to back up. Two independent
   mechanisms that must both fail before an outsider reaches the panel is the
   point; chaining one to the other would leave one.

   REQUIREADMIN IS THE SECOND LOCK, NOT THE FIRST
   The first is db/policies.sql, which stops an unauthorised read inside
   Postgres no matter what code above it does. This function stops the request
   earlier and with a clearer answer. Neither is sufficient alone: without the
   policies an endpoint that forgot to call this would leak, and without this
   an endpoint using the service role would bypass the policies entirely.
   ========================================================================= */

'use strict';

var db = require('./supabase');
var Cookies = require('./cookies');
var Errors = require('./errors');
var log = require('./log');

/**
 * The access token, from the session cookie or an Authorization header.
 *
 * The cookie is checked first because that is where the browser's session
 * lives; the header is accepted so that a script or a test can authenticate
 * without one. Neither is trusted — both end up at the same verification.
 */
function bearerToken(req) {
  /* One implementation, in supabase.js, so that the token this file
     verifies is always the token the database client will carry. They were
     two, and they disagreed about cookies — see the note there. */
  return db.bearerToken(req);
}

/**
 * The verified user behind this request, with their role, or null.
 *
 * Null means the caller is not authenticated, and it means that for every
 * reason a caller could be responsible for — no token, malformed, expired,
 * revoked, signed by something else. They are not told which: the difference
 * is of no use to anyone holding a real token and of some use to anyone
 * guessing at one.
 *
 * A service that could not answer is not one of those reasons, and this
 * throws a 503 for it instead. See the note at the call below.
 */
async function currentUser(req) {
  var token = bearerToken(req);
  if (!token) return null;

  var client = db.asUser({ headers: { authorization: 'Bearer ' + token } });

  /* AN OUTAGE IS NOT A LOGOUT
   *
   * Everything below separates "this token is no good" from "the service
   * that would have told us did not answer". The first is null and becomes
   * a 401. The second is a 503, because the alternative is that a slow
   * network signs the shop owner out in the middle of an edit and blames
   * them for it — which is exactly what happened while this was being
   * tested: Supabase took fifty seconds to answer one request, returned an
   * error, and the panel reported the owner as not signed in.
   *
   * Failing closed is still failing closed. Nothing is let through either
   * way; only the explanation differs, and the explanation decides whether
   * the panel asks the owner to sign in again or to try again. */
  var result;
  try {
    result = await client.auth.getUser(token);
  } catch (err) {
    log.error('the auth service could not be reached', err);
    throw Errors.unavailable();
  }

  if (result.error) {
    /* A status in the 4xx range is a verdict on the token — expired, revoked,
       signed by something else. Anything else (a 5xx, or the 0 that a fetch
       failure carries) is a verdict on the service. */
    var status = result.error.status;

    if (status >= 400 && status < 500) return null;

    log.error('the auth service refused to answer', result.error, { status: status });
    throw Errors.unavailable();
  }

  if (!result.data || !result.data.user) return null;

  var user = result.data.user;

  /* The profile carries this application's own facts about the account. The
     id it is looked up by came out of a verified token, so it is the one
     input here that a caller cannot forge. */
  var profile = null;
  try {
    var row = await db.asAdmin()
      .from('profiles')
      .select('role, blocked, name, email')
      .eq('id', user.id)
      .maybeSingle();

    if (row.error) throw new Error(row.error.message);
    profile = row.data;
  } catch (err) {
    /* The database, not the caller. Same reasoning as above: a profile that
       cannot be read is an outage, and calling it "signed out" would be a
       lie that costs the owner their session. */
    log.error('could not read profile', err, { userId: user.id });
    throw Errors.unavailable();
  }

  if (!profile) return null;

  return {
    id: user.id,
    email: profile.email || user.email || null,
    name: profile.name || null,
    role: profile.role,
    blocked: !!profile.blocked,
    isAdmin: profile.role === 'admin' && !profile.blocked
  };
}

/**
 * The verified user, or a 401.
 *
 * The message does not distinguish a missing token from a bad one. There is
 * nothing useful in that difference for a legitimate caller, and something
 * useful in it for an illegitimate one.
 */
async function requireUser(req) {
  var user = await currentUser(req);
  if (!user) throw Errors.unauthorized('Sign in to continue.');

  /* A blocked account is authenticated and permitted nothing. Saying so
     plainly is right here — it is not a hint an attacker can use, and a
     customer who is blocked needs to know that rather than seeing an
     unexplained failure. */
  if (user.blocked) throw Errors.forbidden('This account has been suspended.');

  return user;
}

/**
 * The verified user if they are an administrator.
 *
 * 401 when nobody is signed in and 403 when someone is but may not be here,
 * because those call for different things from the caller: one is "sign in",
 * the other is "signing in again will not help". The 403 message says nothing
 * about what an admin would have been able to see.
 *
 * Note the order: identity first, privilege second. Asking "are you an admin"
 * of a request with no user is how a null gets treated as a pass.
 */
async function requireAdmin(req) {
  var user = await requireUser(req);

  if (!user.isAdmin) {
    log.info('admin route refused', { userId: user.id, role: user.role });
    throw Errors.forbidden('You do not have access to this.');
  }

  return user;
}

module.exports = {
  bearerToken: bearerToken,
  currentUser: currentUser,
  requireUser: requireUser,
  requireAdmin: requireAdmin
};
