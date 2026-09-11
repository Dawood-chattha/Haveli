/* =========================================================================
   api/categories.js — GET /api/categories
   -------------------------------------------------------------------------
   The menu tree, in the shape ZB.navigation has always had:

     [ { id, label, items: [ { label, children: [ { label } ] } ] } ]

   WHY THE MENU MOVED INTO THE DATABASE
   It used to come from data/navigation.js, a static file, while categories
   were being edited in the panel and stored in Postgres. Two records of the
   same thing, and the shop would have shown the file's version: an owner
   adding a category would see it in the panel, not in the menu, with nothing
   to explain why. One of the two had to go, and the editable one is the one
   worth keeping.

   The file remains in the repository and is no longer loaded by the
   storefront. It is what seeded the database, and deleting it would throw
   away the record of where the tree came from.

   HIDDEN CATEGORIES ARE ABSENT, NOT FLAGGED
   The RLS policy admits only rows with active = true, and shape.js drops
   any that slipped through. A category the owner has hidden is not in the
   menu, is not reachable at /category/..., and is not visible to anyone
   reading this endpoint directly.
   ========================================================================= */

'use strict';

var respond = require('../_lib/respond');
var shape = require('../_lib/shape');
var db = require('../_lib/supabase');
var Errors = require('../_lib/errors');

module.exports = respond.handler(['GET'], async function (req, res) {

  /* As the public, so the policy decides what is visible — the same
     reasoning as api/catalogue.js. */
  var client = db.asUser(req);

  var result = await client
    .from('categories')
    .select(shape.CATEGORY_SELECT)
    .order('sort', { ascending: true });

  if (result.error) throw Errors.internal().causedBy(new Error(result.error.message));

  var tree = shape.navigationTree(result.data || []);

  /* An empty tree means the seed has not been run. Saying so plainly beats
     a storefront with an empty menu and no explanation — this is the first
     thing anyone will check. */
  if (!tree.length) {
    throw Errors.notFound('No categories have been set up yet.');
  }

  res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=300');

  return { navigation: tree };
});
