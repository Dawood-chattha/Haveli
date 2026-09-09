/* =========================================================================
   api/_lib/errors.js — one error type, and the line between two audiences
   -------------------------------------------------------------------------
   An error has two readers with opposite needs.

     THE CALLER wants to know what to do next. "That coupon has expired."
     They must not learn anything about how the system is built, because a
     stack trace, a table name, a driver message or a file path is a map for
     someone probing the API.

     THE OPERATOR wants everything. The original exception, the query, the
     line it failed on.

   So every AppError carries both: `message` goes out, `cause` stays in and
   is only ever written to the server log.

   ANYTHING NOT AN AppError IS TREATED AS A LEAK RISK
   A raw exception from a database driver or a third-party library was never
   written with a client in mind. respond.js turns any such error into a
   flat "Something went wrong on our side" and logs the real one. That is
   deliberately blunt: it is safer to say too little than to discover later
   that a library's error message quoted a connection string.
   ========================================================================= */

'use strict';

/**
 * @param {string} code    Stable, machine-readable. Clients may switch on
 *                         this; they must never parse `message`.
 * @param {string} message Safe to show a human. No internals.
 * @param {number} status  HTTP status.
 * @param {object} [extra] Optional safe detail, e.g. per-field validation
 *                         messages. Held to the same rule as `message`.
 */
function AppError(code, message, status, extra) {
  Error.call(this, message);

  this.name = 'AppError';
  this.code = code;
  this.message = message;
  this.status = status || 500;
  this.extra = extra || null;

  /* Set by the thrower when there is an underlying cause. Never serialised
     to a client — respond.js reads it only to log it. */
  this.cause = null;

  if (Error.captureStackTrace) Error.captureStackTrace(this, AppError);
}

AppError.prototype = Object.create(Error.prototype);
AppError.prototype.constructor = AppError;

/** Attach the underlying error for the log, and return this for chaining. */
AppError.prototype.causedBy = function (err) {
  this.cause = err;
  return this;
};

/* -------------------------------------------------------------------------
   The errors this API actually produces.

   Kept as named constructors rather than raw `new AppError(...)` calls
   scattered around, so the wording of, say, a 401 is decided once and every
   endpoint says the same thing. Inconsistent auth messages are themselves
   an information leak: "no such account" and "wrong password" together tell
   an attacker which addresses are registered.
   ------------------------------------------------------------------------- */

var Errors = {

  AppError: AppError,

  /** The request was malformed or failed validation. */
  badRequest: function (message, fields) {
    return new AppError('bad_request', message || 'That request was not valid.', 400,
                        fields ? { fields: fields } : null);
  },

  /** No credentials, or credentials that do not verify. */
  unauthorized: function (message) {
    return new AppError('unauthorized', message || 'Sign in to continue.', 401);
  },

  /**
   * Verified, but not allowed.
   *
   * The message never says what would have been allowed, and never
   * distinguishes "this does not exist" from "you may not see it" for
   * protected resources — that distinction is itself information.
   */
  forbidden: function (message) {
    return new AppError('forbidden', message || 'You do not have access to this.', 403);
  },

  notFound: function (message) {
    return new AppError('not_found', message || 'Not found.', 404);
  },

  methodNotAllowed: function (allowed) {
    return new AppError('method_not_allowed',
                        'That method is not supported here.', 405,
                        { allowed: allowed });
  },

  /** A rule was broken that the caller could not have known in advance —
      a coupon that expired between loading the page and submitting it, a
      product that sold out. Distinct from 400: the request was well formed. */
  conflict: function (message) {
    return new AppError('conflict', message || 'That is no longer possible.', 409);
  },

  tooManyRequests: function (message) {
    return new AppError('too_many_requests', message || 'Too many requests. Try again shortly.', 429);
  },

  /** The server is misconfigured — a missing environment variable, say.
      The caller learns only that it is our fault, never which variable. */
  misconfigured: function () {
    return new AppError('server_error', 'The server is not configured correctly.', 500);
  },

  internal: function () {
    return new AppError('server_error', 'Something went wrong on our side.', 500);
  },

  /**
   * A service this request depends on did not answer.
   *
   * Distinct from 500 because it is worth telling a caller that trying again
   * is likely to work, and distinct from 401 for a more important reason: an
   * auth service that times out is not a caller who is signed out. Returning
   * 401 there would send the shop owner back to the login screen in the
   * middle of an edit and call it their fault.
   */
  unavailable: function (message) {
    return new AppError('unavailable',
                        message || 'The service is busy. Try again in a moment.', 503);
  }
};

module.exports = Errors;
