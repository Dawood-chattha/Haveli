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

   REGISTERING DOES NOT SIGN YOU IN, AND THAT IS THE SHOP OWNER'S CHOICE
   This endpoint creates the account and sets no cookies. Supabase does hand
   back a session when there is nothing to confirm, and an earlier version
   of this file used it to sign the new customer straight in.

   The owner asked for the other behaviour: after registering, the customer
   is taken to the sign-in form and signs in there. So the session is
   deliberately dropped, and `ready` in the answer is how the page knows
   whether signing in will work yet.

   There is a reason to prefer it beyond being asked. Typing the password
   once more, into the form they will use every time afterwards, is where
   somebody finds out they mistyped it — and a first sign-in that works is
   worth more than a step saved.

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
var Limit = require('../_lib/rate-limit');
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

  /* BY ADDRESS ONLY, AND NOTHING BY EMAIL
     A per-email limit here would be a way of asking whether an address is
     registered: an attacker would watch for the request that behaves
     differently the second time. The whole endpoint is built so that an
     address that is taken and one that is free are answered identically, and
     a limit keyed on the address would undo that from the side. */
  await Limit.check(req, res, [Limit.byIp('signup', Limit.SIGNUP_PER_IP)]);

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
     off. It is not used — see the note at the top — but whether there was
     one is exactly the question the page needs answered: can this person
     sign in now, or do they have to find an email first?

     "nothing happened" is the worst possible outcome of pressing a signup
     button, so the answer always says which. */
  var ready = !!result.data.session;

  return {
    ready: ready,

    /* The address that was just registered, so the sign-in form the page
       moves to can be filled in with it. Nothing secret: it is what the
       caller sent a moment ago. */
    email: email,

    needsConfirmation: !ready,
    message: ready
      ? 'Account created. Sign in to continue.'
      : 'Check your email for a confirmation link, then sign in.'
  };
});
