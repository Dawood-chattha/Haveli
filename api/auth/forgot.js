/* =========================================================================
   api/auth/forgot.js — POST /api/auth/forgot
   -------------------------------------------------------------------------
   { email }  ->  { sent: true, message }

   Asks the auth service to email a one-time link that leads to
   /reset-password, where api/auth/reset.js finishes the job.

   THE ANSWER IS THE SAME WHETHER OR NOT THE ADDRESS HAS AN ACCOUNT
   This is the whole design of this endpoint, and it is easy to lose by
   accident. An endpoint that says "no account with that address" is a way of
   asking whether an address is registered, one address at a time, with no
   password needed. For a shop that is a customer list; combined with a
   stolen password dump it is a target list.

   So there is one answer: the link has been sent if there was an account to
   send it to. Supabase behaves the same way underneath — resetPasswordForEmail
   reports success for an address it has never seen — and nothing here unpicks
   that. Even a genuine failure inside the service is logged and answered with
   the same sentence, because the difference between "no such account" and
   "the mail service is down" is not something a caller can be told apart
   without also being told the first one.

   WHAT THIS ENDPOINT CANNOT DO
   It cannot change a password, it cannot sign anybody in, and it cannot read
   anything. Its entire effect is one outbound email. That is why it is safe
   for it to be open to the public, which it has to be: somebody who cannot
   sign in is the only person who will ever need it.

   RATE LIMITING
   This endpoint sends an email to somebody else's inbox on the say-so of an
   anonymous request, which makes it the one worth limiting most: four an hour
   for an address, twenty an hour from one place. Both counts are kept in the
   database — see api/_lib/rate-limit.js.

   A refusal is safe to state plainly. It is a fact about how many requests
   have arrived, not about whether the address has an account, and it reads
   the same either way.

   Supabase enforces its own limit underneath, and a 429 from it is passed
   through below for the same reason.
   ========================================================================= */

'use strict';

var respond = require('../_lib/respond');
var validate = require('../_lib/validate');
var Limit = require('../_lib/rate-limit');
var Errors = require('../_lib/errors');
var Env = require('../_lib/env');
var db = require('../_lib/supabase');
var log = require('../_lib/log');

/* Said to everyone, every time. Written once so that no future edit can make
   one branch of this endpoint more informative than another. */
var ANSWER = 'If that address has an account, a link to choose a new ' +
             'password is on its way. Check your inbox, and the spam folder.';

/**
 * Where the link in the email should land.
 *
 * SITE_URL when it is set, which it must be in production — see env.js for
 * why the Host header is not trusted. The fallback exists so that a developer
 * running this on localhost does not have to configure anything to try the
 * flow, and it reaches Supabase's own Redirect URLs allow-list before it
 * reaches anybody's inbox.
 */
function resetPageUrl(req) {
  var configured = Env.siteUrl();
  if (configured) return configured + '/reset-password';

  var host = (req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '';
  var proto = (req.headers && req.headers['x-forwarded-proto']) ||
              (process.env.VERCEL_ENV ? 'https' : 'http');

  if (!host) return '';
  return proto + '://' + host + '/reset-password';
}

module.exports = respond.handler(['POST'], async function (req, res) {

  var v = validate.body(req);
  var email = v.email('email');
  v.done();

  await Limit.check(req, res, [
    Limit.byId('forgot', email, Limit.FORGOT_PER_ACCOUNT),
    Limit.byIp('forgot', Limit.FORGOT_PER_IP)
  ]);

  var redirectTo = resetPageUrl(req);

  if (!redirectTo) {
    /* No configured origin and no Host header to fall back on. The caller is
       told the server is misconfigured rather than that the mail was sent,
       because a person waiting for an email that was never requested is the
       one outcome worse than an error. */
    log.error('cannot build a reset link: SITE_URL unset and no Host header');
    throw Errors.misconfigured();
  }

  var anon = db.asUser({ headers: {} });

  var result = await anon.auth.resetPasswordForEmail(email, { redirectTo: redirectTo });

  if (result.error) {
    var message = result.error.message || '';

    /* Being throttled is worth saying. It is a fact about this caller's
       recent requests, not about whether the account exists. */
    if (result.error.status === 429 || /rate limit/i.test(message)) {
      throw Errors.tooManyRequests(
        'A link was requested very recently. Wait a minute and try again.');
    }

    /* Everything else: the operator finds out, the caller does not. */
    log.error('reset email failed', null, { reason: message });
  }

  return { sent: true, message: ANSWER };
});
