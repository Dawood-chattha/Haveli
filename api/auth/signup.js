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
var Errors = require('../_lib/errors');
var db = require('../_lib/supabase');
var log = require('../_lib/log');

var MIN_PASSWORD = 8;

module.exports = respond.handler(['POST'], async function (req) {

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
     off. With it on — the default — the account exists but cannot sign in
     until the link is followed. The caller is told which, because "nothing
     happened" is the worst possible outcome of pressing a signup button.
     No cookies are set either way: a confirmed account signs in through
     /api/auth/login like anyone else. */
  var needsConfirmation = !result.data.session;

  return {
    needsConfirmation: needsConfirmation,
    message: needsConfirmation
      ? 'Check your email for a confirmation link.'
      : 'Account created. You can sign in now.'
  };
});
