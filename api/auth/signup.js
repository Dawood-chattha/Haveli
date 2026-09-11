/* =========================================================================
   api/auth/signup.js — POST /api/auth/signup
   -------------------------------------------------------------------------
   { email, password, name? }  ->  { user, needsConfirmation }

   THE REQUEST CANNOT ASK FOR A ROLE
   There is no `role` field read here, and adding one would be the single
   worst change that could be made to this backend. Even if it were validated
   against a list, validating it would mean accepting it. The role is set by
   the handle_new_user trigger in db/schema.sql, which writes 'customer'
   unconditionally and never looks at what the signup contained.

   The first administrator is promoted from outside the system, by
   scripts/make-admin.mjs, because at that moment there is nobody who could
   authorise it. Every later one is promoted by an existing admin.

   THE PASSWORD RULE IS A FLOOR, NOT A PUZZLE
   Eight characters minimum and nothing else — no required symbol, no mixed
   case, no digit. Composition rules push people towards Password1! and
   towards reusing the one string that satisfies every site they have met.
   Length is what actually costs an attacker time.

   REGISTERING SIGNS YOU IN
   When the account is usable immediately — which it is, because this
   project has email confirmation switched off — the cookies are set here
   and the caller comes back signed in. Making somebody type the password
   they chose four seconds ago, into a second form, is a step that exists
   only because two endpoints were written separately.

   It is the same session either way. Supabase issues one from signUp when
   there is nothing to confirm, and it is the same kind of token
   /api/auth/login hands out; this sets the same cookies through the same
   Cookies.setSession, so nothing downstream can tell how a visitor arrived.

   With confirmation ON there is no session to set, and the answer is
   unchanged: the account exists and cannot be used until the link is
   followed. That branch is kept rather than assumed away, because the
   setting is a checkbox in a dashboard and can be turned back on.

   WHY THE ANSWER IS THE SAME WHETHER OR NOT THE ADDRESS IS TAKEN
   Supabase deliberately returns a normal-looking result for an address that
   already has an account, so that this endpoint cannot be used to test which
   addresses are registered. That behaviour is preserved rather than unpicked:
   the caller is told to check their email either way, which is true — one
   person gets a confirmation, the other gets a note that they already have an
   account.
   ========================================================================= */

'use strict';

var respond = require('../_lib/respond');
var validate = require('../_lib/validate');
var Cookies = require('../_lib/cookies');
var Errors = require('../_lib/errors');
var db = require('../_lib/supabase');
var log = require('../_lib/log');

var MIN_PASSWORD = 8;

module.exports = respond.handler(['POST'], async function (req, res) {

  var v = validate.body(req);
  var email = v.email('email');
  var password = v.str('password', { min: MIN_PASSWORD, max: 200 });
  var name = v.str('name', { optional: true, max: 80 });
  v.done();

  var anon = db.asUser({ headers: {} });

  var result = await anon.auth.signUp({
    email: email,
    password: password,

    /* This reaches raw_user_meta_data, which is written by whoever is signing
       up. The trigger reads `name` from it and nothing else — deliberately,
       because everything in here is caller-controlled and a `role` sitting
       beside the name must never be consulted. */
    options: { data: name ? { name: name } : {} }
  });

  if (result.error) {
    log.info('signup refused', { reason: result.error.message });

    /* Supabase's own message is used for the few cases where it is safe and
       genuinely useful — a password the project rejects, a malformed address.
       Anything else is flattened. */
    var message = /password/i.test(result.error.message)
      ? result.error.message
      : 'That account could not be created. Check the details and try again.';

    throw Errors.badRequest(message);
  }

  /* A session comes back only when the project has email confirmation turned
     off. With it on the account exists but cannot be used until the link is
     followed, and the caller is told so — because "nothing happened" is the
     worst possible outcome of pressing a signup button. */
  var session = result.data.session;

  if (!session) {
    return {
      needsConfirmation: true,
      user: null,
      message: 'Check your email for a confirmation link.'
    };
  }

  var user = result.data.user;

  /* The profile is written by the handle_new_user trigger the moment the
     account exists, so this is a read of something that is already there.
     Its absence means the trigger is missing, not that the caller is new. */
  var profile = await db.asAdmin()
    .from('profiles')
    .select('name, role, blocked')
    .eq('id', user.id)
    .maybeSingle();

  if (profile.error || !profile.data) {
    log.error('signed up but no profile row', profile.error, { userId: user.id });
    throw Errors.internal();
  }

  /* Blocked at the moment of creation should be impossible — the trigger
     writes false — but the check costs nothing and this is the one place
     where setting a cookie first and refusing after would leave a usable
     token in a browser. The same order as api/auth/login.js, deliberately. */
  if (profile.data.blocked) {
    throw Errors.forbidden('This account has been suspended.');
  }

  Cookies.setSession(req, res, session);

  return {
    needsConfirmation: false,
    user: {
      id: user.id,
      email: user.email,
      name: profile.data.name || null,
      role: profile.data.role,
      isAdmin: profile.data.role === 'admin'
    },
    message: 'Welcome to HAVELI.'
  };
});
