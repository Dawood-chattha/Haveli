/* =========================================================================
   api/admin/categories/index.js
   -------------------------------------------------------------------------
   GET  /api/admin/categories   the whole tree, with counts
   POST /api/admin/categories   create one

   THIS ONE RETURNS EVERYTHING, WHERE PRODUCTS DOES NOT
   The products endpoint pages in the database because a catalogue grows
   without limit. A category tree does not: it is the shop's menu, two levels
   deep, and ninety rows is already a large one. More to the point, almost
   everything the panel shows about a category needs the whole tree anyway —
   whether a row is top-level depends on its parent, the indenting depends on
   the ordering of the rest, the "parent" dropdown is a list of all of them,
   and a product count has to include the children.

   Fetching the lot and answering those questions once is simpler and fewer
   round trips than paging a table whose size is bounded by how many things
   a person is willing to put in a menu.

   PRODUCT COUNTS INCLUDE CHILDREN
   A category with sub-categories usually holds no products itself; they hang
   off the leaves. Counting only direct products would report "Eastern Wear:
   0" next to six sub-categories full of stock, which reads as an error. So a
   parent's count is its own plus everything beneath it — the same rule the
   storefront's byCategory() has always used.

   Archived products are not counted. The number is there to answer "is this
   category worth keeping", and an archived product is not in the shop.
   ========================================================================= */

'use strict';

var respond = require('../../_lib/respond');
var validate = require('../../_lib/validate');
var shape = require('../../_lib/shape');
var rows = require('../../_lib/rows');
var auth = require('../../_lib/auth');
var db = require('../../_lib/supabase');
var Errors = require('../../_lib/errors');
var categories = require('../../_lib/categories');

/* -------------------------------------------------------------------------
   GET
   ------------------------------------------------------------------------- */

async function list(req, client) {
  var result = await client
    .from('categories')
    .select(shape.CATEGORY_SELECT)
    .order('sort', { ascending: true });

  if (result.error) throw Errors.internal().causedBy(new Error(result.error.message));

  var all = result.data || [];

  var byId = {};
  all.forEach(function (row) { byId[row.id] = row; });

  var labels = {};
  all.forEach(function (row) { if (!row.parent_id) labels[row.slug] = row.label; });

  /* Direct product counts, then pushed up the tree. One column of one query
     rather than a count per category. */
  var products = await client
    .from('products')
    .select('category_id')
    .neq('status', 'archived');

  if (products.error) throw Errors.internal().causedBy(new Error(products.error.message));

  var direct = {};
  (products.data || []).forEach(function (row) {
    direct[row.category_id] = (direct[row.category_id] || 0) + 1;
  });

  var children = {};
  all.forEach(function (row) {
    if (row.parent_id) children[row.parent_id] = (children[row.parent_id] || 0) + 1;
  });

  /* A category's total is its own plus its descendants'. Walking up from
     each row is O(depth) and the tree is two deep, so this is a handful of
     steps rather than a traversal. */
  var totals = {};
  all.forEach(function (row) { totals[row.id] = direct[row.id] || 0; });

  all.forEach(function (row) {
    var count = direct[row.id] || 0;
    if (!count) return;

    var parentId = row.parent_id;
    var guard = 0;
    while (parentId && guard++ < 10) {
      totals[parentId] = (totals[parentId] || 0) + count;
      parentId = byId[parentId] ? byId[parentId].parent_id : null;
    }
  });

  var counts = { products: totals, children: children };

  /* Departments are not returned as editable rows. The panel manages the
     categories inside a department; offering a Delete button beside "Women"
     would be offering to delete a third of the shop. */
  var items = all
    .filter(function (row) { return !!row.parent_id; })
    .map(function (row) { return shape.adminCategory(row, byId, labels, counts); });

  /* The department list the "add category" form needs, which is exactly the
     rows that were just filtered out. */
  var departments = all
    .filter(function (row) { return !row.parent_id; })
    .map(function (row) { return { id: row.id, slug: row.slug, label: row.label }; });

  return { items: items, departments: departments, total: items.length };
}

/* -------------------------------------------------------------------------
   POST
   ------------------------------------------------------------------------- */

async function create(req, client) {
  var v = validate.body(req);

  var label = v.str('label', { min: 1, max: 80 });
  var parentId = v.uuid('parentId', { optional: true });
  var deptSlug = v.str('dept', { optional: true, max: 60 });
  var active = v.bool('active', { optional: true, fallback: true });
  var sort = v.int('sort', { optional: true, fallback: 0, min: 0, max: 9999 });
  v.done();

  if (!parentId && !deptSlug) {
    throw Errors.badRequest('Check the details and try again.', {
      parentId: 'Choose where this category belongs.'
    });
  }

  /* Where it goes decides its department, and the department is never taken
     from the request when a parent was named — a category inside "Men"
     belongs to Men whatever the body claims. */
  var dept = deptSlug;

  if (parentId) {
    var parent = await client
      .from('categories')
      .select('id, dept, parent_id, label')
      .eq('id', parentId)
      .maybeSingle();

    if (parent.error) throw Errors.internal().causedBy(new Error(parent.error.message));
    if (!parent.data) {
      throw Errors.badRequest('Check the details and try again.', {
        parentId: 'That parent category does not exist.'
      });
    }

    /* The storefront's menu is two levels deep and its drawer has nowhere to
       render a third. A category whose parent is already a sub-category
       would exist in the database and be invisible in the shop. */
    if (parent.data.parent_id) {
      var grandparent = await client
        .from('categories')
        .select('parent_id')
        .eq('id', parent.data.parent_id)
        .maybeSingle();

      if (grandparent.data && grandparent.data.parent_id) {
        throw Errors.badRequest('Check the details and try again.', {
          parentId: 'Categories can only go two levels deep.'
        });
      }
    }

    dept = parent.data.dept;
  } else {
    /* No parent named, so this sits directly under a department — which
       means the department row itself is the parent. */
    var deptRow = await client
      .from('categories')
      .select('id, slug, dept')
      .is('parent_id', null)
      .eq('slug', deptSlug)
      .maybeSingle();

    if (deptRow.error) throw Errors.internal().causedBy(new Error(deptRow.error.message));
    if (!deptRow.data) {
      throw Errors.badRequest('Check the details and try again.', {
        dept: 'That department does not exist.'
      });
    }

    parentId = deptRow.data.id;
    dept = deptRow.data.dept;
  }

  /* Slugs are unique per department, which is what the schema's
     (dept, slug) index says and what the storefront's
     /category/:dept/:sub URLs assume. */
  var slug = await rows.uniqueSlug(client, 'categories', label, { dept: dept }, null);

  var created = await rows.mustInsert('category', client
    .from('categories')
    .insert({
      parent_id: parentId,
      dept: dept,
      slug: slug,
      label: label,
      sort: sort,
      active: active
    })
    .select('id'));

  /* Shaped, not raw — see api/_lib/categories.js for why the panel must be
     handed the same object a list would have given it. */
  return { category: await categories.shapeOne(client, created[0].id) };
}

/* ------------------------------------------------------------------------- */

module.exports = respond.handler(['GET', 'POST'], async function (req) {
  await auth.requireAdmin(req);

  var client = db.asUser(req);

  if (req.method === 'GET') return list(req, client);
  return create(req, client);
});
