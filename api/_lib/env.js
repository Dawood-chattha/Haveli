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
  SITE_URL: 'This deployment public origin, used to build password-reset links',
  EMAIL_API_KEY: 'Transactional mail provider key (server only)',
  EMAIL_FROM: 'The address order emails are sent from',
  EMAIL_FROM_NAME: 'The name beside that address in an inbox',
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

  /**
   * The public origin of this deployment — 'https://haveli.example' with no
   * trailing slash, and an empty string when it is not configured.
   *
   * WHY A PASSWORD RESET NEEDS THIS AT ALL
   * The reset email has to contain a link back to a page on this site, and
   * the server that sends it has to know that page's address. The obvious
   * source is the request's own Host header — and that is the classic hole.
   * A Host header is written by whoever made the request, so a forged one
   * sends the real customer an email whose link points at the attacker's
   * copy of the reset page, which then reads the token out of the URL.
   *
   * So the configured value wins whenever there is one, and forgot.js falls
   * back to the request's origin only for local development. That fallback
   * is not the only thing standing in the way either: Supabase refuses a
   * redirect target that is not in the project's own Redirect URLs list, so
   * a forged host is rejected upstream as well. Two guards, because the
   * consequence of this one being wrong is somebody else's account.
   */
  siteUrl: function () {
    return read('SITE_URL').replace(/\/+$/, '');
  },

  /**
   * The transactional mail account.
   *
   * OPTIONAL, AND UNSET IS A WORKING STATE
   * A shop with no mail account takes orders perfectly well; what it does not
   * do is tell anybody about them afterwards. api/_lib/email.js checks and
   * says so once rather than failing, because the alternative — refusing an
   * order because a third party could not be reached — is worse than a
   * missing email by a wide margin.
   *
   * The key is as much a secret as any other and is read here for the same
   * reason everything else is: one file to audit. It must never reach a
   * response body, a log line or a page.
   */
  emailKey: function () { return read('EMAIL_API_KEY'); },

  /** The address messages are sent from. Must be one the provider has
      verified, or every message is refused. */
  emailFrom: function () { return read('EMAIL_FROM'); },

  /* The shop's own name is a fair fallback here, unlike an invented contact
     address: it is the real name of the real shop, and a message from
     "HAVELI" is what a customer expects to see. */
  emailFromName: function () { return read('EMAIL_FROM_NAME') || 'HAVELI'; },

  logLevel: function () { return read('LOG_LEVEL') || 'info'; },

  isProduction: function () { return read('VERCEL_ENV') === 'production'; },

  missing: missing,
  status: status,
  required: REQUIRED,
  optional: OPTIONAL
};

module.exports = Env;
