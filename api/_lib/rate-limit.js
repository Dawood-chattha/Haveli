/* =========================================================================
   api/_lib/rate-limit.js — how often the same caller may try
   -------------------------------------------------------------------------
   USAGE

     var Limit = require('../_lib/rate-limit');

     await Limit.check(req, res, [
       Limit.byIp('login', Limit.LOGIN_PER_IP),
       Limit.byId('login', email, Limit.LOGIN_PER_ACCOUNT)
     ]);

   It throws a 429 when a limit has been reached, and sets Retry-After on the
   way out. Nothing else is returned: an endpoint either continues or does not.

   THE COUNTER IS IN THE DATABASE, NOT IN THIS PROCESS
   See the header of db/rate-limits.sql. In short: these functions are
   serverless, several run at once, and each is recycled without warning, so
   a counter held in one instance's memory would be a check that looks like a
   limit and is not. Every count below is one round trip to Postgres, which is
   the price of the limit being real.

   WHY EVERY LIMIT IS TWO LIMITS
   The two attacks are not the same shape and one number cannot catch both.

     Somebody guessing one account's password sends many attempts for one
     address. The per-account limit catches that, and it can be strict,
     because one person does not sign in eight times in a quarter of an hour.

     Somebody working through a stolen password list tries ONE password
     against thousands of addresses. Every per-account counter stays at one,
     and only the per-address limit sees it.

   AND WHY THE PER-ADDRESS LIMIT IS THE LOOSE ONE
   Because an address here is not a person. Mobile networks in Pakistan put
   very large numbers of customers behind a small number of addresses, so a
   strict per-address limit on a shop's sign-in would lock out everyone on a
   phone network the moment one of them mistyped a password a few times. The
   per-account limit does the strict work; the per-address limit is set where
   a shared network will not reach it and an attacker's script will.

   NEITHER THE ADDRESS NOR THE EMAIL LEAVES THIS FILE
   Both are hashed before the query, and only the hash is stored. The table
   compares buckets for equality and has no use for the original text, and a
   table listing every email that has tried to sign in would be a customer
   list assembled by accident — one that nobody decided to keep and nobody
   would think to protect.

   IT FAILS OPEN, AND SAYS SO IN THE LOG
   If the count cannot be taken — the database is unreachable, the function is
   missing because the migration has not been run — the request is allowed
   through and the failure is logged as an error. The alternative is that a
   database hiccup locks every customer out of their account, and on this
   project it would be a strange trade: every endpoint that is rate limited
   needs the same database a moment later anyway, so failing closed here would
   turn one outage into two.
   ========================================================================= */

'use strict';

var crypto = require('crypto');

var Errors = require('./errors');
var db = require('./supabase');
var log = require('./log');

/* -------------------------------------------------------------------------
   The limits, in one place

   Each is [ how many, over how many seconds ].

   They are here rather than in the endpoints so that the whole policy can be
   read at once. Changing one is a decision about the shop, not about a file.
   ------------------------------------------------------------------------- */

var MINUTE = 60;
var HOUR = 60 * 60;

var Limits = {

  /* Signing in. Eight attempts on one account in a quarter of an hour is far
     past mistyping and far short of guessing: it leaves an attacker about 770
     tries a day against an address, against millions unthrottled. */
  LOGIN_PER_ACCOUNT: [8, 15 * MINUTE],

  /* Loose on purpose — see the header. Sixty in a quarter of an hour is more
     than a shared network of ordinary customers produces and much less than a
     script working through a password list. */
  LOGIN_PER_IP: [60, 15 * MINUTE],

  /* Registering. Accounts are free to make and each one costs the shop a row
     and possibly an email, so this is about stopping a machine filling the
     customer list, not about stopping a family sharing a connection. */
  SIGNUP_PER_IP: [20, HOUR],

  /* A reset link is an email sent to somebody else's inbox on the say-so of
     an anonymous request. Four an hour for one address is generous for a
     person and useless as a way of burying somebody in mail. */
  FORGOT_PER_ACCOUNT: [4, HOUR],
  FORGOT_PER_IP: [20, HOUR],

  /* Setting the new password. The token is the real guard here — this exists
     so the endpoint cannot be used to grind at tokens. */
  RESET_PER_IP: [30, HOUR]
};

/* -------------------------------------------------------------------------
   Who is asking
   ------------------------------------------------------------------------- */

/**
 * The caller's address.
 *
 * ON VERCEL x-forwarded-for IS WRITTEN BY THE PLATFORM, NOT BY THE CALLER
 * The proxy in front of these functions replaces whatever the request
 * arrived with, so the first entry is the address the connection actually
 * came from. That is what makes it usable as a limit key here.
 *
 * It is NOT usable that way on a server a caller can reach directly, where
 * the header is simply a claim — which is the case when this project is run
 * with `npm run dev` on a machine. That is a development server and nothing
 * is defended by it; the moment it is deployed the platform is in front.
 *
 * An empty answer is possible and is not an error: it becomes its own
 * bucket, shared by every request that has no address, which is the safe way
 * round — those callers are limited together rather than not at all.
 */
function addressOf(req) {
  var headers = (req && req.headers) || {};

  var forwarded = headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();

  if (headers['x-real-ip']) return String(headers['x-real-ip']).trim();

  var socket = req && (req.socket || req.connection);
  return (socket && socket.remoteAddress) || '';
}

/**
 * The bucket key: a name, a scope, and a hash of the thing being counted.
 *
 * Truncated to 32 hex characters. That is 128 bits, which is far past any
 * question of two different callers colliding, and it keeps the key short
 * enough to be a comfortable primary key.
 */
function bucketFor(name, scope, value) {
  var digest = crypto.createHash('sha256')
    .update(name + '|' + scope + '|' + String(value || ''))
    .digest('hex')
    .slice(0, 32);

  return name + ':' + scope + ':' + digest;
}

/* -------------------------------------------------------------------------
   Declaring a rule
   ------------------------------------------------------------------------- */

/** Count this attempt against the caller's address. */
function byIp(name, pair) {
  return { name: name, scope: 'ip', value: null, max: pair[0], window: pair[1] };
}

/**
 * Count this attempt against something the caller named — an email address,
 * almost always. Lower-cased first, so Ali@ and ali@ are one account's
 * allowance rather than two.
 *
 * A rule whose value is empty is skipped rather than counted under a shared
 * blank bucket, because a blank bucket would make every caller who omitted
 * the field share one allowance and lock each other out.
 */
function byId(name, value, pair) {
  return {
    name: name,
    scope: 'id',
    value: value ? String(value).toLowerCase() : '',
    max: pair[0],
    window: pair[1]
  };
}

/* -------------------------------------------------------------------------
   Taking the count
   ------------------------------------------------------------------------- */

/**
 * Count one attempt against every rule, and throw if any of them is over.
 *
 * ALL THE RULES ARE COUNTED, EVEN WHEN THE FIRST ONE REFUSES
 * They run together rather than in turn, which is faster and is also the
 * behaviour that is wanted: an attempt that broke the per-account limit was
 * still an attempt from that address, and the per-address counter should know
 * about it. Stopping at the first refusal would let somebody run an address
 * counter at zero for as long as they kept tripping the other one.
 *
 * The Retry-After that goes back is the longest of the ones that refused, so
 * a caller who waits that long is past all of them rather than the first.
 */
async function check(req, res, rules) {
  var wanted = (rules || []).filter(function (rule) {
    return rule.scope !== 'id' || rule.value;
  });

  if (!wanted.length) return;

  var client = db.asAdmin();

  var answers = await Promise.all(wanted.map(async function (rule) {
    var key = bucketFor(rule.name, rule.scope,
                        rule.scope === 'ip' ? addressOf(req) : rule.value);

    var result = await client.rpc('rate_limit_hit', {
      p_bucket: key,
      p_limit: rule.max,
      p_window: rule.window
    });

    if (result.error) {
      /* Fails open — see the header. Logged as an error rather than as
         information, because a limiter that is not running is a thing
         somebody has to fix, not a thing that happened. */
      log.error('the rate limit could not be counted', null, {
        limit: rule.name + ':' + rule.scope,
        reason: result.error.message
      });
      return null;
    }

    var row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!row) return null;

    return {
      rule: rule,
      allowed: row.allowed !== false,
      hits: row.hits,
      retryAfter: row.retry_after
    };
  }));

  var refused = answers.filter(function (a) { return a && !a.allowed; });
  if (!refused.length) return;

  var wait = refused.reduce(function (longest, a) {
    return Math.max(longest, a.retryAfter || 0);
  }, 0);

  /* The log says which limit and how far past it, because "somebody was rate
     limited" is not enough to tell an attack from a customer having a bad
     morning. It does not say who: the bucket is a hash and stays one. */
  log.info('rate limited', {
    limit: refused[0].rule.name + ':' + refused[0].rule.scope,
    hits: refused[0].hits,
    allowed: refused[0].rule.max,
    retryAfter: wait
  });

  if (res && !res.writableEnded) {
    /* The standard way of saying how long to wait. Without it a caller can
       only guess, and a well-behaved client guesses badly — usually by
       retrying immediately. */
    res.setHeader('Retry-After', String(wait));
  }

  throw Errors.tooManyRequests(
    'Too many attempts. Try again in ' + describe(wait) + '.');
}

/** "a minute", "4 minutes", "an hour" — a wait a person can act on. */
function describe(seconds) {
  if (!seconds || seconds < 60) return 'a moment';

  var minutes = Math.ceil(seconds / 60);
  if (minutes === 1) return 'a minute';
  if (minutes < 60) return minutes + ' minutes';

  var hours = Math.ceil(minutes / 60);
  return hours === 1 ? 'an hour' : hours + ' hours';
}

module.exports = {
  check: check,
  byIp: byIp,
  byId: byId,

  addressOf: addressOf,
  describe: describe,

  LOGIN_PER_ACCOUNT: Limits.LOGIN_PER_ACCOUNT,
  LOGIN_PER_IP: Limits.LOGIN_PER_IP,
  SIGNUP_PER_IP: Limits.SIGNUP_PER_IP,
  FORGOT_PER_ACCOUNT: Limits.FORGOT_PER_ACCOUNT,
  FORGOT_PER_IP: Limits.FORGOT_PER_IP,
  RESET_PER_IP: Limits.RESET_PER_IP
};
