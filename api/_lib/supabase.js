/* =========================================================================
   api/_lib/supabase.js — database connection
   -------------------------------------------------------------------------
   Two clients, and choosing between them is the most consequential decision
   in any endpoint written from here on.

     asUser(req)   Carries the caller's own access token. Every query it
                   makes is judged by Row Level Security exactly as if the
                   browser had made it. If a policy says a customer may only
                   read their own orders, this client cannot read anyone
                   else's — not through a bug, not through a crafted filter,
                   not through a forgotten `where` clause.

     asAdmin()     Carries the service role key. Row Level Security does not
                   apply. It is the entire database with no questions asked.

   THE RULE: asUser BY DEFAULT. asAdmin ONLY WHERE IT IS UNAVOIDABLE.

   The reason is that asUser makes the database the second opinion. A
   mistake in an endpoint — the wrong id, a missing check, a filter built
   from a query string — is caught by a policy that does not care what the
   code intended. Under asAdmin the same mistake returns the data.

   asAdmin is genuinely needed in a small number of places, and each one
   should say why in a comment at the call site:

     - reading a caller's role, which they must not be able to change
     - a checkout that must write rows across several tables atomically
     - a payment webhook, which arrives with no user session at all
     - decrementing stock, where the row being protected is not the
       caller's own

   Every one of those first establishes who is calling, through auth.js.
   asAdmin is never the answer to "the query was blocked" — that is a policy
   to fix, not a client to swap.

   NO CLIENT IS CACHED ACROSS REQUESTS
   A serverless instance can serve several requests in sequence. A client
   holding one user's token, reused for the next request, would run that
   request as the previous caller. Both factories therefore build a fresh
   client each time. This is cheap: the client is a thin wrapper over fetch,
   and there is no connection pool to warm.
   ========================================================================= */

'use strict';

var createClient = require('@supabase/supabase-js').createClient;
var Env = require('./env');
var Cookies = require('./cookies');

/* Sessions belong to the browser. A server client that tried to persist or
   refresh one would be writing another request's identity into a shared
   instance, which is the bug this file is most concerned with. */
var SERVER_AUTH = {
  autoRefreshToken: false,
  persistSession: false,
  detectSessionInUrl: false
};

/* A REQUEST THAT NEVER ENDS IS WORSE THAN ONE THAT FAILS
 *
 * Without this, a slow or unreachable Supabase leaves the endpoint waiting
 * for as long as the network cares to take. It is not hypothetical: one
 * verification run here recorded a single PATCH at fifty-one seconds, with
 * the browser showing a spinner for all of it and the serverless function
 * billed for all of it. Vercel would have cut the function off before the
 * answer arrived anyway, so the wait bought nothing.
 *
 * Fifteen seconds is far longer than a healthy round trip and short enough
 * to become a 503 the panel can act on. The abort surfaces as a thrown
 * fetch error, which auth.js and the endpoints already treat as an outage.
 */
var TIMEOUT_MS = 15000;

function fetchWithTimeout(input, init) {
  var options = init || {};

  /* A signal already on the request wins — a caller that set its own
     deadline meant it. */
  if (options.signal) return fetch(input, options);

  var merged = {};
  Object.keys(options).forEach(function (k) { merged[k] = options[k]; });
  merged.signal = AbortSignal.timeout(TIMEOUT_MS);

  return fetch(input, merged);
}

/**
 * The caller's own access token: the cookie first, then the header.
 *
 * Returns an empty string when there is none, which is a valid state rather
 * than an error — anonymous visitors read the catalogue.
 *
 * THE COOKIE HAS TO BE READ HERE, NOT ONLY IN auth.js
 *
 * This used to look at the Authorization header alone, and auth.js looked at
 * both. So a browser — which is signed in with an HttpOnly cookie and cannot
 * send a header, because JavaScript is not allowed to read the token — was
 * correctly identified as an administrator by requireAdmin(), and then given
 * an ANONYMOUS database client to do the work with.
 *
 * What that looked like was worse than a clean failure. Reads appeared to
 * succeed, because the catalogue is public: the product list came back with
 * a plausible number of rows in it. It was the public's view of the shop —
 * no drafts, nothing archived — presented as the owner's. Writes were
 * refused by the policies, which is the only reason it was noticed.
 *
 * Every test until then had authenticated with the header, the one way
 * nothing in the browser ever does.
 */
function bearerToken(req) {
  var fromCookie = Cookies.accessToken(req);
  if (fromCookie) return fromCookie;

  var header = (req && req.headers && req.headers.authorization) || '';
  if (!header) return '';

  var parts = header.split(' ');
  if (parts.length !== 2) return '';
  if (parts[0].toLowerCase() !== 'bearer') return '';

  return parts[1].trim();
}

/**
 * A client that acts as whoever is calling.
 *
 * With no token it is an anonymous reader, which policies treat as the
 * public. With one it is that user, and `auth.uid()` inside every policy
 * resolves to them.
 */
function asUser(req) {
  var token = bearerToken(req);

  var headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;

  return createClient(Env.supabaseUrl(), Env.anonKey(), {
    auth: SERVER_AUTH,
    global: { headers: headers, fetch: fetchWithTimeout }
  });
}

/**
 * A client that bypasses Row Level Security.
 *
 * Read the header of this file before using it. The key it carries must
 * never reach a response body, a log line or an error message; env.js and
 * log.js are the two places that enforce that, and neither can help if a
 * value is put into a response by hand.
 */
function asAdmin() {
  return createClient(Env.supabaseUrl(), Env.serviceRoleKey(), {
    auth: SERVER_AUTH,
    global: { fetch: fetchWithTimeout }
  });
}

/**
 * Whether the project is reachable at all.
 *
 * Used by the health check. It returns a plain result rather than throwing,
 * because the health endpoint's job is to describe a broken state, not to
 * fail in it.
 *
 * WHY THIS ASKS THE AUTH SERVICE AND NOT PostgREST
 * The obvious probe is PostgREST's root document at /rest/v1/, which
 * answers before any table exists. It was the first thing tried here and it
 * is wrong: with Supabase's current key format that endpoint refuses a
 * publishable key outright —
 *
 *     401  {"message":"Secret API key required",
 *           "hint":"Only secret API keys can be used for this endpoint."}
 *
 * — which is a rule about that one endpoint, not a verdict on the key. The
 * health check read it as "key rejected" and reported a correctly
 * configured project as broken. A probe that fails when everything is fine
 * is worse than no probe, because the next person spends an afternoon
 * fixing a setup that was never broken.
 *
 * /auth/v1/health is the endpoint built for this. It requires the apikey
 * header, so a wrong or missing key still produces a 401 and is still
 * caught, but a correct publishable key is accepted the way it is
 * everywhere else in the project.
 *
 * The anon key is used deliberately rather than the service role key: this
 * is meant to prove the credentials the rest of the system actually runs
 * on, and the service role key would succeed in cases where they would not.
 */
async function ping() {
  var url = Env.supabaseUrl();
  var key = Env.anonKey();

  if (!url || !key) return { reachable: false, reason: 'not configured' };

  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, 5000);

  try {
    var res = await fetch(url.replace(/\/+$/, '') + '/auth/v1/health', {
      method: 'GET',
      headers: { apikey: key },
      signal: controller.signal
    });

    if (res.status === 401 || res.status === 403) {
      return { reachable: false, reason: 'key rejected' };
    }

    if (res.status >= 500) {
      return { reachable: false, reason: 'service error ' + res.status };
    }

    return { reachable: true, status: res.status };
  } catch (e) {
    return { reachable: false, reason: e.name === 'AbortError' ? 'timed out' : 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  asUser: asUser,
  asAdmin: asAdmin,
  bearerToken: bearerToken,
  ping: ping
};
