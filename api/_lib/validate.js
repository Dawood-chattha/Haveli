/* =========================================================================
   api/_lib/validate.js — input checking, written by hand on purpose
   -------------------------------------------------------------------------
   There is no validation library here. Not because one would be bad, but
   because what this API actually needs is a few dozen lines of string,
   number and enum checks, and a dependency that ships a schema compiler to
   do that is a larger surface than the problem.

   WHAT VALIDATION IS FOR HERE, AND WHAT IT IS NOT FOR
   These checks reject nonsense early and produce a message a person can
   act on. They are NOT the security boundary. The security boundary is Row
   Level Security in the database and the authorization checks in auth.js —
   things that hold even when a caller skips this code entirely by crafting
   their own request.

   The distinction matters most for values that look like permissions. A
   `role` field arriving in a request body is not validated here and then
   trusted; it is ignored. Anything that decides what someone may do is read
   from the database, never from the request.

   PRICES AND TOTALS ARE THE SAME RULE
   A price in a request body is never checked for plausibility and then
   used. It is discarded, and the real price is read from the products
   table. This module has no `price` validator for that reason.

   USAGE
     var v = validate.body(req);
     var email = v.email('email');
     var qty   = v.int('qty', { min: 1, max: 20 });
     v.done();                 // throws a 400 listing every bad field
   ========================================================================= */

'use strict';

var Errors = require('./errors');

/* Deliberately permissive. The only authority on whether an address is real
   is the service that owns the account; this catches a typo, nothing more. */
var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/* A slug is used in URLs, so it is held to a narrow shape. */
var SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Collects failures rather than throwing at the first one, so a form can
 * show every problem at once instead of one per submit. The admin panel's
 * field components already expect a map of field name to message.
 */
function Checker(source) {
  this.source = (source && typeof source === 'object') ? source : {};
  this.errors = {};
}

Checker.prototype.reject = function (field, message) {
  if (!this.errors[field]) this.errors[field] = message;
  return null;
};

Checker.prototype.raw = function (field) {
  return this.source[field];
};

/**
 * A string.
 *
 * Trimmed, length-checked, and returned as-is — NOT escaped and NOT
 * stripped of markup. Escaping belongs at the point of output, where what
 * is being escaped for is known. A value sanitised here and stored would
 * be wrong in a plain-text email and double-escaped in a page.
 */
Checker.prototype.str = function (field, opts) {
  opts = opts || {};
  var value = this.source[field];

  if (value === undefined || value === null || value === '') {
    if (opts.optional) return opts.fallback === undefined ? null : opts.fallback;
    return this.reject(field, opts.label || 'This is required.');
  }

  if (typeof value !== 'string') return this.reject(field, 'Expected text.');

  value = value.trim();

  if (!value.length && !opts.optional) return this.reject(field, 'This is required.');

  var min = opts.min || 0;
  var max = opts.max || 2000;

  if (value.length < min) return this.reject(field, 'Must be at least ' + min + ' characters.');
  if (value.length > max) return this.reject(field, 'Must be ' + max + ' characters or fewer.');

  return value;
};

/**
 * A whole number.
 *
 * Rejects a numeric string that is not exactly an integer rather than
 * rounding it, because silently turning 2.5 into 2 or 3 is a decision the
 * caller did not make. Money and stock are integers throughout this
 * project, so there is no float variant here at all.
 */
Checker.prototype.int = function (field, opts) {
  opts = opts || {};
  var raw = this.source[field];

  if (raw === undefined || raw === null || raw === '') {
    if (opts.optional) return opts.fallback === undefined ? null : opts.fallback;
    return this.reject(field, 'This is required.');
  }

  var value = Number(raw);

  if (!Number.isFinite(value)) return this.reject(field, 'Expected a number.');
  if (!Number.isInteger(value)) return this.reject(field, 'Expected a whole number.');

  if (opts.min !== undefined && value < opts.min) {
    return this.reject(field, 'Must be ' + opts.min + ' or more.');
  }
  if (opts.max !== undefined && value > opts.max) {
    return this.reject(field, 'Must be ' + opts.max + ' or less.');
  }

  return value;
};

Checker.prototype.bool = function (field, opts) {
  opts = opts || {};
  var raw = this.source[field];

  if (raw === undefined || raw === null) {
    if (opts.optional) return opts.fallback === undefined ? false : opts.fallback;
    return this.reject(field, 'This is required.');
  }

  if (typeof raw === 'boolean') return raw;
  if (raw === 'true' || raw === '1' || raw === 1) return true;
  if (raw === 'false' || raw === '0' || raw === 0) return false;

  return this.reject(field, 'Expected true or false.');
};

Checker.prototype.email = function (field, opts) {
  var value = this.str(field, opts);
  if (value === null) return null;

  /* Stored lower-case so that one address cannot become two accounts. */
  value = value.toLowerCase();

  if (!EMAIL.test(value)) return this.reject(field, 'That does not look like an email address.');
  if (value.length > 254) return this.reject(field, 'That address is too long.');

  return value;
};

Checker.prototype.uuid = function (field, opts) {
  var value = this.str(field, opts);
  if (value === null) return null;
  if (!UUID.test(value)) return this.reject(field, 'That identifier is not valid.');
  return value;
};

Checker.prototype.slug = function (field, opts) {
  var value = this.str(field, opts);
  if (value === null) return null;
  if (!SLUG.test(value)) {
    return this.reject(field, 'Use lower-case letters, numbers and hyphens only.');
  }
  return value;
};

/**
 * One of a fixed list.
 *
 * This is the shape every status, role and type field takes. An enum
 * checked against a list defined in code cannot be widened by a request,
 * which is why order status and payment status will both go through here
 * rather than being written straight from a body.
 */
Checker.prototype.oneOf = function (field, allowed, opts) {
  var value = this.str(field, opts);
  if (value === null) return null;
  if (allowed.indexOf(value) === -1) {
    return this.reject(field, 'Choose one of: ' + allowed.join(', ') + '.');
  }
  return value;
};

/** An array, with each entry run through a callback that returns a value
    or null. Entries that fail are dropped and the field is rejected. */
Checker.prototype.list = function (field, each, opts) {
  opts = opts || {};
  var raw = this.source[field];

  if (raw === undefined || raw === null) {
    if (opts.optional) return [];
    return this.reject(field, 'This is required.');
  }

  if (!Array.isArray(raw)) return this.reject(field, 'Expected a list.');

  var max = opts.max || 100;
  if (raw.length > max) return this.reject(field, 'At most ' + max + ' items.');
  if (!raw.length && !opts.optional) return this.reject(field, 'At least one item is required.');

  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var value = each(raw[i], i);
    if (value === null || value === undefined) {
      return this.reject(field, 'Item ' + (i + 1) + ' is not valid.');
    }
    out.push(value);
  }
  return out;
};

/** Throw if anything failed. Every endpoint calls this before acting. */
Checker.prototype.done = function () {
  var fields = Object.keys(this.errors);
  if (!fields.length) return;
  throw Errors.badRequest('Check the details and try again.', this.errors);
};

/* -------------------------------------------------------------------------
   Sources
   ------------------------------------------------------------------------- */

/**
 * The parsed JSON body.
 *
 * Vercel's Node runtime parses application/json for us. A body that was not
 * JSON arrives as a string or a Buffer, and that is rejected rather than
 * guessed at.
 */
function body(req) {
  var raw = req.body;

  if (raw === undefined || raw === null || raw === '') return new Checker({});

  if (typeof raw === 'string' || Buffer.isBuffer(raw)) {
    try {
      raw = JSON.parse(raw.toString('utf8'));
    } catch (e) {
      throw Errors.badRequest('The request body was not valid JSON.');
    }
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw Errors.badRequest('The request body must be a JSON object.');
  }

  return new Checker(raw);
}

/** The query string, as a Checker. Values arrive as strings. */
function query(req) {
  return new Checker(req.query || {});
}

module.exports = {
  body: body,
  query: query,
  Checker: Checker,
  EMAIL: EMAIL,
  UUID: UUID,
  SLUG: SLUG
};
