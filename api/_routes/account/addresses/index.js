/* =========================================================================
   api/account/addresses/index.js
   -------------------------------------------------------------------------
   GET  /api/account/addresses    the caller's saved addresses
   POST /api/account/addresses    save one

   THE CALLER'S OWN, AND NOBODY IS AN EXCEPTION
   The "addresses: own" policy in db/policies.sql is `user_id = auth.uid()`
   with no administrator clause beside it, deliberately: the panel has no
   screen that shows a customer's saved addresses and must not gain one by
   accident. So unlike orders — where an admin satisfies a second, wider
   policy and the filter has to be written out — there is genuinely only one
   answer this table will give anybody.

   The filter is still written out on the read. It costs nothing, it says
   what the endpoint means, and it is the habit that was missing from
   api/account/orders.js the first time.

   A SAVED ADDRESS IS NOT THE ADDRESS AN ORDER SHIPPED TO
   public.place_order copies the address onto the order as jsonb — a
   snapshot, with no reference back to this table. That is what makes
   deleting a saved address safe: an order placed last month still says
   where it went, and always will, however this list changes afterwards.

   ORDERING IS THE WHOLE OF WHAT "DEFAULT" DOES
   The default comes first and the rest follow newest-first, and the
   checkout selects whichever is first. So a customer with no default is not
   a customer the checkout cannot help — it offers their newest address.
   That is why deleting a default does not promote another one: there is
   nothing to repair, and silently choosing somebody's delivery address for
   them is not a thing to do quietly.
   ========================================================================= */

'use strict';

var respond = require('../../../_lib/respond');
var shape = require('../../../_lib/shape');
var rows = require('../../../_lib/rows');
var auth = require('../../../_lib/auth');
var db = require('../../../_lib/supabase');
var Errors = require('../../../_lib/errors');

var addresses = require('../../../_lib/addresses');

/* An address book, not an archive. Somebody with more saved addresses than
   this has stopped using it as a convenience. */
var MAX = 25;

/* ------------------------------------------------------------------------- */

async function list(req, client, user) {
  var result = await client
    .from('addresses')
    .select(shape.ADDRESS_SELECT)
    .eq('user_id', user.id)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false })
    /* A total ordering, so two addresses saved in the same second do not
       swap places between one page load and the next. */
    .order('id', { ascending: true })
    .limit(MAX);

  if (result.error) throw Errors.internal().causedBy(new Error(result.error.message));

  var items = (result.data || []).map(shape.customerAddress);

  return { items: items, total: items.length };
}

async function create(req, client, user) {
  var address = addresses.readAddress(req, true);

  var count = await client
    .from('addresses')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id);

  if (count.error) throw Errors.internal().causedBy(new Error(count.error.message));

  if ((count.count || 0) >= MAX) {
    throw Errors.conflict('You already have ' + MAX + ' saved addresses. ' +
                          'Remove one before adding another.');
  }

  /* The first address saved is the default, whether or not it was asked
     for. There is nothing for it to compete with, and a first address that
     is not the default would leave the checkout preselecting nothing on the
     one occasion the answer is obvious. */
  var isFirst = (count.count || 0) === 0;

  address.user_id = user.id;
  address.is_default = address.is_default === true || isFirst;

  if (address.is_default && !isFirst) await addresses.clearDefault(client, user.id);

  var created = await rows.mustInsert('address', client
    .from('addresses')
    .insert(address)
    .select(shape.ADDRESS_SELECT));

  return { address: shape.customerAddress(created[0]) };
}

/* ------------------------------------------------------------------------- */

module.exports = respond.handler(['GET', 'POST'], async function (req) {
  var user = await auth.requireUser(req);
  var client = db.asUser(req);

  if (req.method === 'GET') return list(req, client, user);
  return create(req, client, user);
});
