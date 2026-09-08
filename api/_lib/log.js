/* =========================================================================
   api/_lib/log.js — server logging
   -------------------------------------------------------------------------
   Vercel collects whatever a function writes to stdout and stderr, so there
   is no logging service to install and none is wanted. This module exists
   to make the output consistent and, more importantly, to make it safe.

   WHAT MUST NEVER BE LOGGED
   A log is written once and read by whoever has access to the dashboard,
   possibly years later. So it never receives:

     a password, in any form
     an API key, a service role key, a session token or a JWT
     an Authorization header
     a full request body, because a body is where the first three arrive

   `redact()` below is the enforcement rather than the reminder: anything
   handed to it is stripped of keys whose names suggest a secret, and long
   token-shaped strings are truncated. It is applied to every object this
   module writes, so a caller who forgets is still covered.

   WHY IDs AND NOT NAMES
   Log a user's id, not their email; an order id, not the address. An id is
   enough to find the record when something needs investigating, and it does
   not turn the log into a second copy of the customer database.
   ========================================================================= */

'use strict';

var Env = require('./env');

var LEVELS = { debug: 10, info: 20, error: 30 };

/* Key names that must never have their values printed. Matched loosely and
   case-insensitively on purpose: `apiKey`, `API_KEY`, `x-api-key` and
   `serviceRoleKey` should all be caught by one rule. */
var SECRET_KEY = /pass|secret|token|key|auth|cookie|session|credential|jwt/i;

/* A long unbroken run of token characters is probably a token even when the
   key name gives nothing away. */
var TOKEN_SHAPED = /^[A-Za-z0-9._~+/=-]{40,}$/;

function redact(value, depth) {
  depth = depth || 0;
  if (depth > 4) return '[deep]';

  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return TOKEN_SHAPED.test(value) ? '[redacted]' : value;
  }

  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.slice(0, 20).map(function (v) { return redact(v, depth + 1); });
  }

  var out = {};
  Object.keys(value).forEach(function (key) {
    out[key] = SECRET_KEY.test(key) ? '[redacted]' : redact(value[key], depth + 1);
  });
  return out;
}

function write(level, message, detail) {
  if (LEVELS[level] < LEVELS[Env.logLevel()]) return;

  var line = {
    level: level,
    at: new Date().toISOString(),
    msg: message
  };

  if (detail) line.detail = redact(detail);

  var text = JSON.stringify(line);

  if (level === 'error') process.stderr.write(text + '\n');
  else process.stdout.write(text + '\n');
}

module.exports = {
  debug: function (message, detail) { write('debug', message, detail); },
  info: function (message, detail) { write('info', message, detail); },

  /**
   * An error line carries the real exception — name, message and stack —
   * because this is the audience that needs it. It is written to stderr and
   * never reaches a response body; respond.js is what keeps those apart.
   */
  error: function (message, err, detail) {
    var line = { msg: message };

    if (err) {
      line.error = {
        name: err.name || 'Error',
        message: err.message || String(err),
        stack: err.stack || null
      };
      if (err.cause) {
        line.error.cause = {
          name: err.cause.name || 'Error',
          message: err.cause.message || String(err.cause)
        };
      }
    }

    if (detail) line.detail = redact(detail);

    process.stderr.write(JSON.stringify({
      level: 'error',
      at: new Date().toISOString(),
      msg: message,
      error: line.error || null,
      detail: line.detail || null
    }) + '\n');
  },

  redact: redact
};
