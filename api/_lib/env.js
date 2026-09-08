/* =========================================================================
   api/_lib/env.js — the only place process.env is read
   -------------------------------------------------------------------------
   Every other file asks this module for configuration rather than reading
   process.env itself. One place means one audit: if a secret is ever going
   to leak, it leaks from code that reads it, and there is exactly one such
   file to check.

   NOTHING HERE IS A DEFAULT VALUE
   There is no fallback key, no development key, no "if unset use this".
   A missing variable is an error, not a signal to guess. A default
   credential is a credential in source code, which is the one thing this
   project has said from the beginning it will not have.

   THE TWO SUPABASE KEYS ARE NOT INTERCHANGEABLE
     ANON KEY          Safe in a browser. Every request it makes is still
                       judged by Row Level Security, so it can only reach
                       what the policies allow.

     SERVICE ROLE KEY  Bypasses Row Level Security entirely. It is the
                       whole database with no questions asked. It belongs on
                       a server and nowhere else — never in a page, never in
                       a response body, never in a log line, never in an
                       error message.

   The guard below exists so that a future mistake is loud: anything that
   asks for the service role key from a context that could reach a browser
   throws instead of quietly handing it over.
   ========================================================================= */

'use strict';

/* Name -> what it is, used to write a useful message when one is missing.
   The descriptions are safe to print. The values never are. */
var REQUIRED = {
  SUPABASE_URL: 'Supabase project URL',
  SUPABASE_ANON_KEY: 'Supabase anon (publishable) key',
  SUPABASE_SERVICE_ROLE_KEY: 'Supabase service role key (server only)'
};

/* Optional, with documented behaviour when unset. */
var OPTIONAL = {
  ALLOWED_ORIGINS: 'Comma-separated origins allowed to call the API from a browser',
  LOG_LEVEL: 'debug | info | error (default: info)'
};

function read(name) {
  var value = process.env[name];
  if (typeof value !== 'string') return '';
  return value.trim();
}

/**
 * Which required variables are missing.
 * Returns an array of names — never values.
 */
function missing() {
  return Object.keys(REQUIRED).filter(function (name) {
    return !read(name);
  });
}

/**
 * A report safe to send to a client: which variables are set, as booleans.
 * Used by the health check. It deliberately cannot leak a value even if
 * someone changes the health endpoint later, because there is no value
 * here to leak.
 */
function status() {
  var out = {};

  Object.keys(REQUIRED).forEach(function (name) {
    out[name] = read(name) ? 'set' : 'MISSING';
  });

  Object.keys(OPTIONAL).forEach(function (name) {
    out[name] = read(name) ? 'set' : 'unset (optional)';
  });

  return out;
}

var Env = {

  /* Public-ish: this pair is what a browser is allowed to hold. */
  supabaseUrl: function () { return read('SUPABASE_URL'); },
  anonKey: function () { return read('SUPABASE_ANON_KEY'); },

  /**
   * Server only. Never return this to a caller, never put it in a response,
   * never log it. The name is deliberately long and awkward for the same
   * reason a fire alarm is loud.
   */
  serviceRoleKey: function () {
    var key = read('SUPABASE_SERVICE_ROLE_KEY');
    if (!key) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
    }
    return key;
  },

  /**
   * Origins allowed to call this API from a browser.
   *
   * Empty by default, and empty means "same origin only" — no CORS headers
   * are sent at all. That is the correct production answer here, because
   * the site and the functions are served from one domain. A wildcard would
   * let any page on the internet make credentialed calls on a signed-in
   * viewer's behalf, so there is no code path that produces one.
   */
  allowedOrigins: function () {
    var raw = read('ALLOWED_ORIGINS');
    if (!raw) return [];
    return raw.split(',').map(function (o) { return o.trim(); })
              .filter(function (o) { return o.length > 0; });
  },

  logLevel: function () { return read('LOG_LEVEL') || 'info'; },

  isProduction: function () { return read('VERCEL_ENV') === 'production'; },

  missing: missing,
  status: status,
  required: REQUIRED,
  optional: OPTIONAL
};

module.exports = Env;
