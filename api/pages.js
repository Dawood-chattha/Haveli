/* =========================================================================
   api/pages.js
   -------------------------------------------------------------------------
   GET /api/pages           every page, as the storefront needs them
   GET /api/pages?slug=…    one of them

   WHY ALL OF THEM AT ONCE
   Twelve rows of text, and the storefront's router can land on any of them
   from any other. Fetching one per navigation would mean a visible wait on
   every footer link for a payload smaller than one product photograph. So
   this hands over the lot, once, alongside the catalogue and the menu — the
   same decision api/catalogue.js makes and for the same reason.

   The `slug` parameter exists anyway, for the panel's preview and for
   anything that wants one page without the rest.

   A DRAFT ANSWERS, AND SAYS NOTHING
   Withholding the words is api/_lib/shape.js's job, not the policy's: the
   admin endpoints read the same table and must see what they are editing.
   The route keeps working either way, because a link in the footer that
   leads to a 404 is worse than one that leads to a page saying it has not
   been written.
   ========================================================================= */

'use strict';

var respond = require('./_lib/respond');
var validate = require('./_lib/validate');
var shape = require('./_lib/shape');
var db = require('./_lib/supabase');
var Errors = require('./_lib/errors');

/* The same window api/categories.js uses. These are the shop's own pages:
   read on nearly every visit, changed a handful of times in a shop's life,
   and worth seeing within half a minute of being changed. */
var CACHE = 'public, max-age=30, stale-while-revalidate=300';

module.exports = respond.handler(['GET'], async function (req, res) {
  var v = validate.query(req);
  var slug = v.slug('slug', { optional: true });
  v.done();

  /* Read as the server. The policy in db/pages.sql lets anyone read this
     table, so this is not about permission — it is about the anon key
     never needing to leave the server for a public read, which is how
     every other public endpoint here already works. */
  var query = db.asAdmin()
    .from('pages')
    .select(shape.PAGE_SELECT)
    .order('sort', { ascending: true });

  if (slug) query = query.eq('slug', slug);

  var result = await query;

  if (result.error) throw Errors.internal().causedBy(new Error(result.error.message));

  var found = result.data || [];

  if (slug && !found.length) {
    throw Errors.notFound('There is no such page.');
  }

  res.setHeader('Cache-Control', CACHE);

  var items = found.map(shape.publicPage);

  return slug ? { page: items[0] } : { items: items, total: items.length };
});
