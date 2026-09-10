/* =========================================================================
   api/_lib/coupon-input.js
   -------------------------------------------------------------------------
   Reading a coupon out of a request body, once.

   Two endpoints take the same fields — create and patch — and the rules
   about them are not obvious ones: a percentage cannot exceed a hundred, a
   free-delivery coupon has no amount and the others may not have none, an
   end date has to come after a start, and a code is stored upper case
   because it is matched case-insensitively at the checkout.

   Written twice they would drift, and the way that shows up is a coupon the
   create form refuses and the edit form accepts.
   ========================================================================= */

'use strict';

var validate = require('./validate');
var Errors = require('./errors');

var TYPES = ['percent', 'fixed', 'shipping'];

/**
 * Read a coupon out of a request body.
 *
 * `required` is true on a create, where a code, a type and a value have to
 * be there; on a patch only what was sent is looked at.
 */
function readCoupon(req, required) {
  var v = validate.body(req);
  var body = v.source;
  var has = function (key) { return Object.prototype.hasOwnProperty.call(body, key); };
  var want = function (key) { return required || has(key); };

  var patch = {};

  if (want('code')) {
    /* Upper case, and matched case-insensitively at the checkout — the
       schema has a unique index on lower(code) for exactly that. Stored the
       way it is meant to be read out: EID20, not eid20. */
    var code = v.str('code', { min: 2, max: 40 });

    if (code && !/^[A-Za-z0-9_-]+$/.test(code)) {
      throw Errors.badRequest('Check the details and try again.', {
        code: 'A code can only hold letters, numbers, dashes and underscores.'
      });
    }

    if (code) patch.code = code.toUpperCase();
  }

  if (want('type')) patch.type = v.oneOf('type', TYPES);
  if (has('note')) patch.note = v.str('note', { optional: true, max: 200 });
  if (has('minSpend')) patch.min_spend = v.int('minSpend', { min: 0, max: 100000000 });
  /* NO LIMIT IS SPELT DIFFERENTLY ON EACH SIDE
     The panel writes it as nothing in the box, reads back as zero, and its
     list prints "No limit" for anything falsy — see usageCell in
     assets/js/admin/pages/coupons.js. The table spells it null, and refuses
     a zero outright (`usage_limit is null or usage_limit > 0`), because a
     coupon allowed zero uses is a coupon that does not work.

     shape.js already translates the other way, null to zero. Without this
     line the trip only works outbound, and the form's own default — an
     empty box, meaning no limit — is refused by the database on every
     save. */
  if (has('usageLimit')) {
    var limit = v.int('usageLimit', { optional: true, min: 0, max: 1000000 });
    patch.usage_limit = limit ? limit : null;
  }
  if (has('disabled')) patch.disabled = v.bool('disabled');

  if (want('value')) {
    patch.value = v.int('value', { min: 0, max: 100000000 });
  }

  /* Milliseconds from the panel's date helpers, or null for "no date at
     all" — a coupon with no start runs from now, and one with no end does
     not stop. */
  ['startsAt', 'expiresAt'].forEach(function (key) {
    if (!has(key)) return;

    var column = key === 'startsAt' ? 'starts_at' : 'expires_at';
    var at = body[key];

    if (at === null || at === '' || at === undefined) {
      patch[column] = null;
      return;
    }

    var when = new Date(typeof at === 'number' ? at : String(at));

    if (isNaN(when.getTime())) {
      throw Errors.badRequest('Check the details and try again.', {
        code: 'That date could not be read.'
      });
    }

    patch[column] = when.toISOString();
  });

  v.done();

  /* Zero is allowed for a free-delivery coupon and meaningless for the
     others: "0% off" and "PKR 0 off" are coupons that do nothing. The
     schema refuses them too; saying it here names the field. */
  if (patch.value !== undefined) {
    var type = patch.type || body.type;

    if (type !== 'shipping' && patch.value < 1) {
      throw Errors.badRequest('Check the details and try again.', {
        value: 'A discount has to be more than nothing.'
      });
    }

    if (type === 'percent' && patch.value > 100) {
      throw Errors.badRequest('Check the details and try again.', {
        value: 'A percentage cannot be more than 100.'
      });
    }
  }

  if (patch.starts_at && patch.expires_at &&
      new Date(patch.expires_at) <= new Date(patch.starts_at)) {
    throw Errors.badRequest('Check the details and try again.', {
      expiresAt: 'The end date has to be after the start.'
    });
  }

  return patch;
}

module.exports = { readCoupon: readCoupon, TYPES: TYPES };
