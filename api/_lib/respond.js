/* =========================================================================
   api/_lib/respond.js — one response shape, and the headers around it
   -------------------------------------------------------------------------
   Every endpoint answers in exactly one of two shapes:

     { "ok": true,  "data": ... }
     { "ok": false, "error": { "code": "...", "message": "...", ... } }

   A caller can therefore branch on `ok` alone and never has to guess
   whether a 200 with an "error" field inside it counts as success. This
   matters more than it looks: ZB.repo's methods return promises, and the
   admin panel's error handling is built around a promise that rejects.
   One predictable shape is what lets that stay true.

   `handler()` wraps every function. It is where four things happen that
   would otherwise have to be remembered at each endpoint:

     1. CORS, decided by env.js and defaulting to same-origin only.
     2. OPTIONS preflight, answered and ended.
     3. Method checking against a declared list.
     4. A catch that turns any thrown value into a safe response and logs
        the real one.

   POINT 4 IS THE IMPORTANT ONE
   An unhandled exception in a serverless function otherwise returns the
   platform's own error page, which is not JSON and may quote internals. By
   catching everything here, the API's contract holds even when the code
   inside it is wrong.
   ========================================================================= */

'use strict';

var Env = require('./env');
var Errors = require('./errors');
var log = require('./log');

/* -------------------------------------------------------------------------
   Headers
   ------------------------------------------------------------------------- */

function securityHeaders(res) {
  /* An API response is never a document; saying so stops a browser from
     deciding a JSON body is HTML and running it. */
  res.setHeader('X-Content-Type-Options', 'nosniff');

  /* Nothing here is meant to be framed. */
  res.setHeader('X-Frame-Options', 'DENY');

  res.setHeader('Referrer-Policy', 'no-referrer');

  /* API answers are per-user and often per-moment. Caching one at a shared
     hop is how one customer ends up looking at another's cart. */
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
}

/**
 * CORS, narrowly.
 *
 * The default is no CORS headers at all, which is not an oversight: the
 * storefront, the panel and these functions are served from one domain on
 * Vercel, so a browser never needs permission to call them. Headers appear
 * only for an origin explicitly listed in ALLOWED_ORIGINS.
 *
 * There is deliberately no code path that emits `Access-Control-Allow-Origin: *`.
 * A wildcard with credentials is what lets any page on the internet make
 * calls as a signed-in viewer, and it is the single most common way an
 * otherwise careful API is opened up by accident.
 */
function cors(req, res) {
  var allowed = Env.allowedOrigins();
  if (!allowed.length) return;

  var origin = req.headers.origin;
  if (!origin || allowed.indexOf(origin) === -1) return;

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '600');

  /* The answer depends on the request's Origin, so any cache between here
     and the browser has to key on it. */
  res.setHeader('Vary', 'Origin');
}

/* -------------------------------------------------------------------------
   Sending
   ------------------------------------------------------------------------- */

function send(res, status, body) {
  if (res.writableEnded) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function ok(res, data, status) {
  send(res, status || 200, { ok: true, data: data === undefined ? null : data });
}

/**
 * Turn anything thrown into a safe response.
 *
 * An AppError was written with a client in mind and is passed through.
 * Anything else was not — a driver error, a TypeError, a library's
 * complaint — so the caller gets a flat 500 and the real error goes to the
 * log where it belongs.
 */
function fail(res, err) {
  var safe = (err instanceof Errors.AppError) ? err : null;

  if (!safe) {
    log.error('unhandled error in endpoint', err);
    safe = Errors.internal();
  } else if (safe.status >= 500) {
    log.error('server error: ' + safe.code, safe.cause || safe);
  } else {
    log.info('request rejected', { code: safe.code, status: safe.status });
  }

  var body = { ok: false, error: { code: safe.code, message: safe.message } };
  if (safe.extra) {
    Object.keys(safe.extra).forEach(function (k) { body.error[k] = safe.extra[k]; });
  }

  send(res, safe.status, body);
}

/* -------------------------------------------------------------------------
   The wrapper
   ------------------------------------------------------------------------- */

/**
 * Wrap an endpoint.
 *
 *   module.exports = handler(['GET'], async function (req, res) { ... });
 *
 * The handler may return a value, in which case it is sent as `data`, or
 * send its own response and return undefined. Throwing is the intended way
 * to fail — there is no need to catch inside an endpoint.
 *
 * `opts.requireConfig: false` lets an endpoint run with variables missing.
 * Exactly one endpoint wants that — the health check, whose job is to
 * report what is missing. Everything else fails closed.
 */
function handler(methods, fn, opts) {
  var allowed = (methods || ['GET']).map(function (m) { return m.toUpperCase(); });
  var requireConfig = !opts || opts.requireConfig !== false;

  return async function (req, res) {
    securityHeaders(res);
    cors(req, res);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (allowed.indexOf(req.method) === -1) {
      res.setHeader('Allow', allowed.join(', '));
      fail(res, Errors.methodNotAllowed(allowed));
      return;
    }

    /* Configuration is checked before the endpoint runs rather than inside
       it, so a missing variable is one clear 500 with a log line naming the
       variable, instead of a confusing failure deeper in a query. The
       caller is told only that the server is misconfigured. */
    var absent = requireConfig ? Env.missing() : [];
    if (absent.length) {
      log.error('missing environment variables', null, { missing: absent });
      fail(res, Errors.misconfigured());
      return;
    }

    try {
      var result = await fn(req, res);
      if (!res.writableEnded && result !== undefined) ok(res, result);
    } catch (err) {
      fail(res, err);
    }
  };
}

module.exports = {
  ok: ok,
  fail: fail,
  handler: handler,
  securityHeaders: securityHeaders
};
