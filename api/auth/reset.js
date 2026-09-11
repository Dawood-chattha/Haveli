/* =========================================================================
   api/auth/reset.js — POST /api/auth/reset
   -------------------------------------------------------------------------
   { token, password }  ->  { done: true, email }

   The second half of a password reset. api/auth/forgot.js sends the email;
   this is what the page at /reset-password calls once somebody has chosen a
   new password, and `token` is the one-time recovery token that arrived in
   that email's link.

   IT DOES NOT SIGN ANYBODY IN
   No cookies are set. The customer is taken to the sign-in form and types the
   password they have just chosen, which is the same shape as registering —
   the shop's owner asked for that there, and the reasoning carries over
   exactly: the first time a new password is used should be in the form it
   will be used in every day, while the person is still sitting in front of
   it, rather than a week later when there is nobody to tell.

   `email` comes back so that form can be filled in. It is read from the
   account the token belongs to, not from the request.

   THE TOKEN COMES FROM THE BODY AND NEVER FROM THE COOKIE
   This matters more than it looks. The session cookie is marked HttpOnly, so
   a script running on the page cannot read it; if this endpoint also accepted
   the cookie as authority, a script could POST here with no token at all and
   change the signed-in customer's password — locking the real owner out of
   their own account, from a single injected file. It does not, so it cannot.
   The only way to reach this endpoint is to hold the token, and the only way
   to hold the token is to have opened the link in the email.

   WHY THE OTHER SESSIONS ARE ENDED
   A reset is what somebody does when they think their password is known to
   another person. If that person is signed in elsewhere, changing the
   password alone leaves them signed in — their session was minted before the
   change and does not care about it. So every refresh token for the account
   is revoked, everywhere, and whoever it was has to know the new password to
   come back. This is done on a best-effort basis: if the revoke call fails
   the password change still stands, because a changed password with stale
   sessions is better than neither.

   WHY THIS TALKS TO THE AUTH SERVICE OVER PLAIN HTTP
   The supabase-js client's updateUser() reads the access token out of a
   stored session, and there is no stored session here by design — see the
   note at the top of api/_lib/supabase.js about why no client on this server
   may hold one. Both calls below are the two requests that method would have
   made, written out, with the token passed explicitly. No new dependency, and
   nothing ambiguous about which account is being changed.
   ========================================================================= */

'use strict';

var respond = require('../_lib/respond');
var validate = require('../_lib/validate');
var Cookies = require('../_lib/cookies');
var Limit = require('../_lib/rate-limit');
var Errors = require('../_lib/errors');
var Env = require('../_lib/env');
var log = require('../_lib/log');

/* The same floor api/auth/signup.js applies, for the same reason: length is
   what costs an attacker time, and composition rules produce Password1!. */
var MIN_PASSWORD = 8;

/* A recovery token is a JWT. The bounds are a sanity check on the shape of
   the field, not a verdict on the token — the auth service decides that. */
var MIN_TOKEN = 20;
var MAX_TOKEN = 4000;

/* Matches api/_lib/supabase.js. A request that never returns is worse than
   one that fails, and Vercel would cut the function off anyway. */
var TIMEOUT_MS = 15000;

/**
 * One call to the auth service, carrying the recovery token as the caller.
 *
 * Returns { status, body }. A network failure throws, and is turned into a
 * 503 by the caller rather than a 500 — an auth service that did not answer
 * is not a token that was refused, and telling somebody their reset link has
 * expired when it has not would send them back to their inbox for nothing.
 */
async function authCall(method, path, token, body) {
  var res = await fetch(Env.supabaseUrl().replace(/\/+$/, '') + path, {
    method: method,
    headers: {
      apikey: Env.anonKey(),
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });

  var text = await res.text();
  var parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }

  return { status: res.status, body: parsed };
}

module.exports = respond.handler(['POST'], async function (req, res) {

  var v = validate.body(req);
  var token = v.str('token', { min: MIN_TOKEN, max: MAX_TOKEN });
  var password = v.str('password', { min: MIN_PASSWORD, max: 200 });
  v.done();

  /* BY ADDRESS ONLY
     There is nothing else to key on. The token names an account, but reading
     which one means asking the auth service, which is the expensive call this
     limit exists to protect — and a limit keyed on a value the caller made up
     would be one an attacker could vary their way out of. */
  await Limit.check(req, res, [Limit.byIp('reset', Limit.RESET_PER_IP)]);

  /* ---- change it -------------------------------------------------------- */

  var changed;

  try {
    changed = await authCall('PUT', '/auth/v1/user', token, { password: password });
  } catch (e) {
    log.error('the auth service did not answer a password change', e);
    throw Errors.unavailable();
  }

  if (changed.status === 401 || changed.status === 403) {
    /* The commonest failure by a distance, and the one worth wording well:
       the link was used once already, or it sat in an inbox for a day. */
    throw Errors.unauthorized(
      'This reset link has expired or has already been used. ' +
      'Request a new one and try again.');
  }

  if (changed.status !== 200) {
    var message = (changed.body && (changed.body.msg || changed.body.message ||
                   changed.body.error_description)) || '';

    /* Two refusals are the service telling the customer something they can
       act on, and both are safe to repeat: a password the project considers
       too weak, and a new password identical to the old one. Anything else
       is flattened, because an auth service's error text was not written
       with this shop's customers in mind. */
    if (changed.status === 422 && /password/i.test(message)) {
      throw Errors.badRequest(message, { password: message });
    }

    log.error('password change refused', null, {
      status: changed.status,
      reason: message
    });

    throw Errors.badRequest('That password could not be set. Try again.');
  }

  var email = (changed.body && changed.body.email) || null;

  /* ---- end every other session ----------------------------------------- */

  /* scope=global revokes every refresh token this account has, on every
     device. Best effort: see the header for why a failure here does not
     undo the change above. */
  try {
    var out = await authCall('POST', '/auth/v1/logout?scope=global', token);
    if (out.status >= 400) {
      log.error('could not end the other sessions after a reset', null,
                { status: out.status });
    }
  } catch (e) {
    log.error('could not end the other sessions after a reset', e);
  }

  /* This browser's own cookies go too. They may well be empty — most people
     resetting a password are signed out, which is how they got here — but if
     they are not, the tokens in them were just revoked upstream, and a cookie
     holding a dead session looks exactly like being signed in until the next
     request fails. */
  Cookies.clear(req, res);

  log.info('password reset completed');

  return {
    done: true,

    /* The address of the account that was changed, read from the account
       itself, so the sign-in form can be filled in with it. */
    email: email,

    message: 'Your password has been changed. Sign in to continue.'
  };
});
