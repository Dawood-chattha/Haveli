/* =========================================================================
   api/auth/login.js — POST /api/auth/login
   -------------------------------------------------------------------------
   { email, password }  ->  { user: { id, email, name, role, isAdmin } }

   The tokens are NOT in that response. They go into HttpOnly cookies, which
   the page cannot read. See api/_lib/cookies.js for why.

   ONE MESSAGE FOR EVERY FAILURE
   Wrong password, no such account, unconfirmed email — all of them answer
   "Those details did not match an account." Distinguishing them turns this
   endpoint into a way of asking whether an address is registered, which is
   worth knowing to anyone assembling a list of a shop's customers, and worth
   more to anyone who already has that address and a stolen password list.

   THIS IS THE SAME ENDPOINT FOR CUSTOMERS AND FOR THE OWNER
   There is no separate admin sign-in, and adding one would be a mistake: two
   authentication paths mean two places for a flaw. `role` in the response
   tells the panel what to draw. It does not grant anything — every admin
   endpoint checks the database itself, and so does every RLS policy.

   RATE LIMITING
   Supabase applies its own limits to this call. A limit of this project's own
   belongs in Phase 12, alongside the rest of the abuse handling.
   ========================================================================= */

'use strict';

var respond = require('../_lib/respond');
var validate = require('../_lib/validate');
var Cookies = require('../_lib/cookies');
var Errors = require('../_lib/errors');
var db = require('../_lib/supabase');
var log = require('../_lib/log');

module.exports = respond.handler(['POST'], async function (req, res) {

  var v = validate.body(req);
  var email = v.email('email');

  /* Length is checked, strength is not. A sign-in is not the place to grade a
     password: the account already exists and its password is whatever it is.
     Refusing a short one here would only refuse a legitimate old account. */
  var password = v.str('password', { min: 1, max: 200 });
  v.done();

  var anon = db.asUser({ headers: {} });

  var result = await anon.auth.signInWithPassword({ email: email, password: password });

  if (result.error || !result.data || !result.data.session) {
    /* The real reason goes to the log, where the operator can see it and the
       caller cannot. */
    log.info('sign-in refused', { reason: result.error && result.error.message });
    throw Errors.unauthorized('Those details did not match an account.');
  }

  var session = result.data.session;
  var user = result.data.user;

  /* The profile is this application's own record of the account. It is
     created by a trigger the moment an account is, so its absence means
     something is wrong rather than that the user is new. */
  var profile = await db.asAdmin()
    .from('profiles')
    .select('name, role, blocked')
    .eq('id', user.id)
    .maybeSingle();

  if (profile.error || !profile.data) {
    log.error('signed in but no profile row', profile.error, { userId: user.id });
    throw Errors.internal();
  }

  /* A blocked account gets no session at all. Setting the cookies first and
     refusing later would leave a usable token in the browser. */
  if (profile.data.blocked) {
    throw Errors.forbidden('This account has been suspended.');
  }

  Cookies.setSession(req, res, session);

  return {
    user: {
      id: user.id,
      email: user.email,
      name: profile.data.name || null,
      role: profile.data.role,
      isAdmin: profile.data.role === 'admin'
    }
  };
});
