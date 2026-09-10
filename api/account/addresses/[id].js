/* =========================================================================
   api/account/addresses/[id].js
   -------------------------------------------------------------------------
   PATCH  /api/account/addresses/:id    change one, or make it the default
   DELETE /api/account/addresses/:id    remove one

   DELETE IS REAL, AND SAFE, FOR A REASON WORTH STATING
   Nothing points at this row. public.place_order copies the delivery
   address onto the order as jsonb — a snapshot — so an order that shipped
   here last month still says so after this row is gone, and always will.
   That is why a saved address can simply be deleted, where a product has to
   be archived instead.

   THE ID IS CHECKED, AND SO IS WHOSE IT IS
   Both, and neither is redundant. The `addresses: own` policy is what makes
   a mistake here harmless: a request naming somebody else's address touches
   nothing, whatever this file believes. The explicit user_id is what makes
   the answer a 404 rather than a silent success on zero rows — see
   api/_lib/rows.js for the afternoon that cost.
   ========================================================================= */

'use strict';

var respond = require('../../_lib/respond');
var validate = require('../../_lib/validate');
var shape = require('../../_lib/shape');
var rows = require('../../_lib/rows');
var auth = require('../../_lib/auth');
var db = require('../../_lib/supabase');
var Errors = require('../../_lib/errors');

var addresses = require('../../_lib/addresses');

function addressId(req) {
  var v = validate.query(req);
  var id = v.uuid('id');
  v.done();
  return id;
}

async function load(client, user, id) {
  var result = await client
    .from('addresses')
    .select(shape.ADDRESS_SELECT)
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (result.error) throw Errors.internal().causedBy(new Error(result.error.message));

  /* The same answer for "no such address" and "not yours", which is the
     right one: a customer has no business learning that an id they guessed
     belongs to somebody. */
  if (!result.data) throw Errors.notFound('That address is no longer saved.');

  return result.data;
}

/* -------------------------------------------------------------------------
   PATCH
   ------------------------------------------------------------------------- */

async function update(req, client, user) {
  var id = addressId(req);
  var was = await load(client, user, id);

  var patch = addresses.readAddress(req, false);

  if (!Object.keys(patch).length) {
    throw Errors.badRequest('There was nothing to change.');
  }

  /* Turning the default OFF is refused rather than obeyed.

     A person with addresses and no default is a state the shop copes with —
     the list falls back to newest-first — but it is not a state anybody
     asks for. "Not the default any more" always means "that other one is",
     and that is a PATCH on the other one. Obeying this literally would
     leave the account with no default and no way to see why. */
  if (patch.is_default === false && was.is_default) {
    throw Errors.badRequest('To change which address is the default, ' +
                            'set the other one as default instead.');
  }

  if (patch.is_default === true && !was.is_default) {
    await addresses.clearDefault(client, user.id);
  } else {
    /* Not resent as false: the row already holds the right value, and
       writing it again is a write that can fail for nothing. */
    delete patch.is_default;
  }

  var saved = await rows.mustAffect('address', client
    .from('addresses')
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id)
    .select(shape.ADDRESS_SELECT));

  return { address: shape.customerAddress(saved[0]) };
}

/* ------------------------------------------------------------------------- */

module.exports = respond.handler(['GET', 'PATCH', 'DELETE'], async function (req) {
  var user = await auth.requireUser(req);
  var client = db.asUser(req);

  if (req.method === 'GET') {
    return { address: shape.customerAddress(await load(client, user, addressId(req))) };
  }

  if (req.method === 'PATCH') return update(req, client, user);

  var id = addressId(req);
  await load(client, user, id);

  await rows.mustAffect('address', client
    .from('addresses')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id'));

  /* Deliberately not promoting another address to default. See the note in
     index.js: the list falls back to newest-first, the checkout offers
     that, and choosing somebody's delivery address for them without being
     asked is not a thing to do quietly. */
  return { deleted: true };
});
