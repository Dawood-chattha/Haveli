/* =========================================================================
   api/account/wishlist.js
   -------------------------------------------------------------------------
   GET    /api/account/wishlist                 what the caller has saved
   POST   /api/account/wishlist                 add one
   DELETE /api/account/wishlist?productId=…     remove one
   PUT    /api/account/wishlist                 replace the lot

   WHY THIS ONE HAS SINGLE-ITEM WRITES AND THE CART DOES NOT
   A wishlist is edited one heart at a time, from a card in a grid, and the
   thing that happens is add-this or remove-this. A cart is edited as a
   list — quantities changed, lines removed, the whole thing reviewed on one
   page — so it is sent as a list. The shape of each endpoint follows the
   shape of the gesture that uses it.

   PUT is here for one moment only: signing in, when the browser's list and
   the account's list have to become one list. See ZB.store in
   assets/js/store.js for what that merge does and why.

   ADDING SOMETHING ALREADY THERE IS NOT AN ERROR
   Hearts get pressed twice, and on two devices. The unique index makes the
   second one a no-op rather than a duplicate row, and this returns the same
   answer either way, because "it is in your wishlist" is true both times.
   ========================================================================= */

'use strict';

var respond = require('../../_lib/respond');
var validate = require('../../_lib/validate');
var shape = require('../../_lib/shape');
var auth = require('../../_lib/auth');
var db = require('../../_lib/supabase');
var Errors = require('../../_lib/errors');

/* A wishlist, not an archive. Well past what anybody keeps, and small
   enough to send whole. */
var MAX = 200;

async function read(client, user) {
  var result = await client
    .from('wishlist_items')
    .select(shape.WISHLIST_SELECT)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(MAX);

  if (result.error) throw Errors.internal().causedBy(new Error(result.error.message));

  /* Slugs, because that is what the storefront's wishlist has always held
     and what its product routes are built from. A product that has since
     been deleted drops out rather than becoming a link to nothing. */
  var items = (result.data || [])
    .map(function (row) { return row.products && row.products.slug; })
    .filter(function (slug) { return slug; });

  return { items: items, total: items.length };
}

function productId(source, field) {
  var id = String((source && source[field]) || '');

  if (!validate.UUID.test(id)) {
    throw Errors.badRequest('Check the details and try again.', {
      productId: 'That does not name a product.'
    });
  }

  return id;
}

/* ------------------------------------------------------------------------- */

module.exports = respond.handler(['GET', 'POST', 'PUT', 'DELETE'], async function (req) {
  var user = await auth.requireUser(req);
  var client = db.asUser(req);

  if (req.method === 'GET') return read(client, user);

  /* --- add one -------------------------------------------------------- */

  if (req.method === 'POST') {
    var adding = productId(validate.body(req).source, 'productId');

    var added = await client
      .from('wishlist_items')
      .upsert({ user_id: user.id, product_id: adding },
              { onConflict: 'user_id,product_id', ignoreDuplicates: true })
      .select('id');

    if (added.error) {
      if (added.error.code === '23503') {
        throw Errors.notFound('That product is no longer sold here.');
      }
      throw Errors.internal().causedBy(new Error(added.error.message));
    }

    return read(client, user);
  }

  /* --- replace the lot, on sign-in ------------------------------------- */

  if (req.method === 'PUT') {
    var body = validate.body(req).source;

    if (!Array.isArray(body.items)) {
      throw Errors.badRequest('A wishlist has to be sent as a list of products.');
    }

    if (body.items.length > MAX) {
      throw Errors.badRequest('That is more than ' + MAX + ' saved products.');
    }

    var wanted = {};

    body.items.forEach(function (id, i) {
      var one = String(id || '');

      if (!validate.UUID.test(one)) {
        throw Errors.badRequest('Check the details and try again.', {
          items: 'The entry at items[' + i + '] does not name a product.'
        });
      }

      wanted[one] = true;
    });

    var ids = Object.keys(wanted);

    var cleared = await client.from('wishlist_items').delete().eq('user_id', user.id);
    if (cleared.error) throw Errors.internal().causedBy(new Error(cleared.error.message));

    if (ids.length) {
      var wrote = await client.from('wishlist_items').insert(
        ids.map(function (id) { return { user_id: user.id, product_id: id }; }));

      if (wrote.error) {
        if (wrote.error.code === '23503') {
          throw Errors.conflict('Something on that list is no longer sold here. ' +
                                'Reload the page and try again.');
        }
        throw Errors.internal().causedBy(new Error(wrote.error.message));
      }
    }

    return read(client, user);
  }

  /* --- remove one ------------------------------------------------------ */

  var removing = productId(req.query || {}, 'productId');

  var gone = await client
    .from('wishlist_items')
    .delete()
    .eq('user_id', user.id)
    .eq('product_id', removing);

  if (gone.error) throw Errors.internal().causedBy(new Error(gone.error.message));

  /* No row to delete is not a failure. Two tabs, one heart, and the second
     press finds it already gone — the answer to "is this saved" is no
     either way. */
  return read(client, user);
});
