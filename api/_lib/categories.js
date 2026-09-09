/* =========================================================================
   api/_lib/categories.js
   -------------------------------------------------------------------------
   One category, shaped the way the list shapes them.

   WHY THIS FILE EXISTS
   The list endpoint fetches the whole tree, so it can answer "is this row a
   sub-category", "how many children does it have", "how many products hang
   below it" for every row at once, and it returns shape.adminCategory().
   Create, read and update each touch one row, and the first version of them
   returned that row straight from the database — `parent_id`, `active`,
   `created_at`, and no counts.

   So the panel would have been handed two different objects for the same
   thing: `status: 'active'` after a list, `active: true` after a save. Every
   screen that re-reads a row after editing it would have shown the wrong
   badge, and the bug would have looked like the save had failed.

   THE COUNTS ARE SCOPED, NOT RECOMPUTED
   The list builds its counts by walking the whole tree because it needs all
   of them. For one row, two counting queries answer the same question — the
   tree is two levels deep, so "everything below this" is this row and its
   direct children and nothing else.
   ========================================================================= */

'use strict';

var shape = require('./shape');
var Errors = require('./errors');

/**
 * @param client  a Supabase client — the caller's, so policies still apply
 * @param id      the category's uuid
 * @returns the same object shape.adminCategory produces in the list
 */
async function shapeOne(client, id) {
  var row = await client
    .from('categories')
    .select(shape.CATEGORY_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (row.error) throw Errors.internal().causedBy(new Error(row.error.message));
  if (!row.data) throw Errors.notFound('That category no longer exists.');

  /* The parent, and only the parent. adminCategory needs it to tell a
     category under a department from one nested a level deeper. */
  var byId = {};
  if (row.data.parent_id) {
    var parent = await client
      .from('categories')
      .select(shape.CATEGORY_SELECT)
      .eq('id', row.data.parent_id)
      .maybeSingle();

    if (parent.error) throw Errors.internal().causedBy(new Error(parent.error.message));
    if (parent.data) byId[parent.data.id] = parent.data;
  }

  var depts = await client.from('categories').select('slug, label').is('parent_id', null);
  if (depts.error) throw Errors.internal().causedBy(new Error(depts.error.message));

  var labels = {};
  (depts.data || []).forEach(function (d) { labels[d.slug] = d.label; });

  var kids = await client.from('categories').select('id').eq('parent_id', id);
  if (kids.error) throw Errors.internal().causedBy(new Error(kids.error.message));

  var kidIds = (kids.data || []).map(function (k) { return k.id; });

  /* Archived products are left out, the same rule the list uses: the number
     answers "is this category worth keeping", and an archived product is
     not in the shop. */
  var held = await client
    .from('products')
    .select('id', { count: 'exact', head: true })
    .in('category_id', [id].concat(kidIds))
    .neq('status', 'archived');

  if (held.error) throw Errors.internal().causedBy(new Error(held.error.message));

  var counts = { children: {}, products: {} };
  counts.children[id] = kidIds.length;
  counts.products[id] = held.count || 0;

  return shape.adminCategory(row.data, byId, labels, counts);
}

module.exports = { shapeOne: shapeOne };
