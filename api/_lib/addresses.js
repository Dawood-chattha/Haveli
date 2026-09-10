/* =========================================================================
   api/_lib/addresses.js
   -------------------------------------------------------------------------
   The two things both address endpoints need: reading one out of a request
   body, and moving which one is the default.

   Two endpoints take the same fields — saving a new one and editing an
   existing one — and written twice they would drift. The way that shows up
   is an address the account page refuses and the edit form accepts.

   THE SAME FOUR FIELDS place_order INSISTS ON
   db/checkout.sql refuses an order whose address has no name, no phone, no
   first line or no city. That check is the real one — it runs inside the
   transaction that prices the order — and these are the same four, so a
   saved address is never one that cannot be delivered to.

   WHAT IS DELIBERATELY NOT VALIDATED
   The shape of a phone number and the shape of a postcode. Pakistan Post
   uses five digits, mobile numbers are written half a dozen ways, and a
   customer whose number is correct but formatted unusually must not be
   stopped from ordering. A digit is required in the phone, which catches
   the field being filled with words, and nothing more is claimed.
   ========================================================================= */

'use strict';

var validate = require('./validate');
var Errors = require('./errors');

/**
 * Read an address out of a request body.
 *
 * `required` is true when saving a new one, where the four fields have to
 * be there; on an edit only what was sent is looked at, so correcting a
 * phone number does not mean resending the street.
 */
function readAddress(req, required) {
  var v = validate.body(req);
  var body = v.source;
  var has = function (key) { return Object.prototype.hasOwnProperty.call(body, key); };
  var want = function (key) { return required || has(key); };

  var patch = {};

  if (want('name')) patch.name = v.str('name', { min: 2, max: 120 });
  if (want('phone')) patch.phone = v.str('phone', { min: 5, max: 40 });
  if (want('line1')) patch.line1 = v.str('line1', { min: 3, max: 200 });
  if (want('city')) patch.city = v.str('city', { min: 2, max: 80 });

  if (has('line2')) patch.line2 = v.str('line2', { optional: true, max: 200 });
  if (has('postalCode')) patch.postal_code = v.str('postalCode', { optional: true, max: 20 });

  /* What the customer calls this address — "Home", "Office". Their own word
     for it, shown on the chooser at checkout so the two are told apart at a
     glance rather than by reading both streets. */
  if (has('label')) patch.label = v.str('label', { optional: true, max: 40 });

  /* Read here rather than off req.body, so it goes through the same parse
     as everything else. A body that arrived as a string — which happens —
     has no properties to read, and `req.body.isDefault` would quietly be
     undefined on a request that plainly asked for it. */
  if (has('isDefault')) patch.is_default = v.bool('isDefault');

  v.done();

  /* A phone number with no digits in it is a field somebody typed a word
     into. Nothing beyond that is checked — see the note at the top. */
  if (patch.phone !== undefined && patch.phone !== null && !/\d/.test(patch.phone)) {
    throw Errors.badRequest('Check the details and try again.', {
      phone: 'A phone number needs some digits.'
    });
  }

  return patch;
}

/* -------------------------------------------------------------------------
   Moving the default

   At most one per person, stated in the database by a partial unique index
   (addresses_one_default_idx in db/schema.sql). So switching it is two
   statements: clear whatever holds it, then set the new one.

   THE ORDER MATTERS AND IS NOT ARBITRARY
   There is no transaction spanning two PostgREST requests, so one of them
   can succeed alone. Clearing first means that leaves the person with no
   default, which everything copes with — the list falls back to
   newest-first and the checkout offers that. Setting first would be refused
   by the index, and if it somehow were not it would leave two, which is the
   state nothing copes with.
   ------------------------------------------------------------------------- */

async function clearDefault(client, userId) {
  var cleared = await client
    .from('addresses')
    .update({ is_default: false })
    .eq('user_id', userId)
    .eq('is_default', true)
    .select('id');

  if (cleared.error) throw Errors.internal().causedBy(new Error(cleared.error.message));
}

module.exports = {
  readAddress: readAddress,
  clearDefault: clearDefault
};
