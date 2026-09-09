/* =========================================================================
   api/admin/categories/[id].js
   -------------------------------------------------------------------------
   GET    /api/admin/categories/:id
   PATCH  /api/admin/categories/:id
   DELETE /api/admin/categories/:id

   DELETING A CATEGORY IS REFUSED WHILE ANYTHING IS IN IT
   Not soft-deleted, not cascaded — refused, with a count of what is in the
   way. The schema's foreign key is `on delete restrict`, so the database
   would refuse it regardless; this checks first so the answer is "this holds
   14 products" rather than a constraint error.

   The alternative was a cascade, and it is worth saying why not. Deleting
   "Eastern Wear" would take six sub-categories and every product in them,
   from one click, with an Undo that cannot put products back once their
   images and order lines are gone. A category that must go is emptied first,
   deliberately, one decision at a time. Hiding it — active = false — takes
   it out of the shop immediately and is reversible, which is what "remove
   this from the menu" almost always means.

   THE SLUG DOES NOT FOLLOW THE LABEL
   Renaming "Kurta" to "Kurtas" leaves the slug as `kurta`, so
   /category/men/kurta keeps working — for anyone who bookmarked it, and for
   every search engine that indexed it. A rename is a change of wording, not
   a change of address.
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

function categoryId(req) {
  var v = validate.query(req);
  var id = v.uuid('id');
  v.done();
  return id;
}

/** The row, or a 404. Departments are not addressable here — see index.js. */
async function load(client, id) {
  var result = await client
    .from('categories')
    .select(shape.CATEGORY_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (result.error) throw Errors.internal().causedBy(new Error(result.error.message));
  if (!result.data) throw Errors.notFound('That category no longer exists.');

  if (!result.data.parent_id) {
    throw Errors.forbidden('Departments cannot be changed here.');
  }

  return result.data;
}

/* -------------------------------------------------------------------------
   GET
   ------------------------------------------------------------------------- */

async function read(req, client) {
  var id = categoryId(req);

  /* load() first, because it is what refuses a department. Then shaped, so
     the panel gets the same object its list gave it. */
  await load(client, id);
  return { category: await categories.shapeOne(client, id) };
}

/* -------------------------------------------------------------------------
   PATCH
   ------------------------------------------------------------------------- */

async function update(req, client) {
  var id = categoryId(req);
  await load(client, id);

  var v = validate.body(req);
  var body = v.source;
  var has = function (key) { return Object.prototype.hasOwnProperty.call(body, key); };

  var patch = {};
  if (has('label')) patch.label = v.str('label', { min: 1, max: 80 });
  if (has('active')) patch.active = v.bool('active');
  if (has('sort')) patch.sort = v.int('sort', { min: 0, max: 9999 });
  v.done();

  /* `slug`, `dept` and `parent_id` are deliberately not accepted.
   *
   * A slug is an address (see the header). A department or parent change
   * moves a category and everything under it to a different part of the
   * menu, which also has to move its products' `dept` — a larger operation
   * than a form field, and one nothing in the panel currently asks for.
   * Silently ignoring those keys would be worse than not offering them, so
   * they are simply absent from this list and any that arrive are dropped. */

  if (!Object.keys(patch).length) {
    throw Errors.badRequest('There was nothing to change.');
  }

  /* mustAffect, not a bare update: a policy that refuses this change would
     return success and zero rows. See api/_lib/rows.js. */
  await rows.mustAffect('category', client
    .from('categories')
    .update(patch)
    .eq('id', id)
    .select('id'));

  return { category: await categories.shapeOne(client, id) };
}

/* -------------------------------------------------------------------------
   DELETE
   ------------------------------------------------------------------------- */

async function remove(req, client) {
  var id = categoryId(req);
  await load(client, id);

  /* Two counts before touching anything, so the refusal can say which of the
     two is in the way. */
  var kids = await client
    .from('categories')
    .select('id', { count: 'exact', head: true })
    .eq('parent_id', id);

  if (kids.error) throw Errors.internal().causedBy(new Error(kids.error.message));

  if (kids.count) {
    throw Errors.conflict('This category still holds ' + kids.count +
      (kids.count === 1 ? ' sub-category.' : ' sub-categories.') +
      ' Move or delete those first, or hide this category instead.');
  }

  var held = await client
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', id);

  if (held.error) throw Errors.internal().causedBy(new Error(held.error.message));

  if (held.count) {
    throw Errors.conflict('This category still holds ' + held.count +
      (held.count === 1 ? ' product.' : ' products.') +
      ' Move them elsewhere first, or hide this category instead.');
  }

  await rows.mustAffect('category', client
    .from('categories')
    .delete()
    .eq('id', id)
    .select('id'));

  return { deleted: true };
}

/* ------------------------------------------------------------------------- */

module.exports = respond.handler(['GET', 'PATCH', 'DELETE'], async function (req) {
  await auth.requireAdmin(req);

  var client = db.asUser(req);

  if (req.method === 'GET') return read(req, client);
  if (req.method === 'PATCH') return update(req, client);
  return remove(req, client);
});
