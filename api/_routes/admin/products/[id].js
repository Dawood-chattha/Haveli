/* =========================================================================
   api/admin/products/[id].js
   -------------------------------------------------------------------------
   GET    /api/admin/products/:id
   PATCH  /api/admin/products/:id
   DELETE /api/admin/products/:id

   PATCH RATHER THAN PUT
   The panel's form sends the fields it changed. A PUT would mean it has to
   send every field every time, and a field it forgot would be erased. Only
   keys that are present are written here; absent is not the same as null.

   DELETE IS SOFT, AND THE PANEL ALREADY KNEW THAT
   Removing a product sets its status to 'archived'. It stops appearing in
   the shop immediately — the public read policy admits only 'active' — and
   the row stays, because order_items point at it. A hard delete would set
   those references to null and quietly cost every past order its link to
   what was bought.

   The panel's Undo already expects this: Repo.products.remove returned a
   token that restore() put back. That token is now the previous status.
   ========================================================================= */

'use strict';

var respond = require('../../../_lib/respond');
var validate = require('../../../_lib/validate');
var shape = require('../../../_lib/shape');
var rows = require('../../../_lib/rows');
var auth = require('../../../_lib/auth');
var db = require('../../../_lib/supabase');
var Errors = require('../../../_lib/errors');

var STATUSES = ['active', 'draft', 'archived'];

async function deptLabels(client) {
  var result = await client.from('categories').select('slug, label').is('parent_id', null);
  if (result.error) throw Errors.internal().causedBy(new Error(result.error.message));

  var labels = {};
  (result.data || []).forEach(function (row) { labels[row.slug] = row.label; });
  return labels;
}

function productId(req) {
  var v = validate.query(req);
  var id = v.uuid('id');
  v.done();
  return id;
}

/* -------------------------------------------------------------------------
   GET
   ------------------------------------------------------------------------- */

async function read(req, client) {
  var id = productId(req);

  var result = await client
    .from('products')
    .select(shape.PRODUCT_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (result.error) throw Errors.internal().causedBy(new Error(result.error.message));
  if (!result.data) throw Errors.notFound('That product no longer exists.');

  var labels = await deptLabels(client);
  return { product: shape.adminProduct(result.data, labels) };
}

/* -------------------------------------------------------------------------
   PATCH
   ------------------------------------------------------------------------- */

async function update(req, client) {
  var id = productId(req);
  var v = validate.body(req);

  /* Only what was sent. `has` distinguishes "set this to null" from "leave
     it alone", which a form that clears a field depends on. */
  var body = v.source;
  var has = function (key) { return Object.prototype.hasOwnProperty.call(body, key); };

  var patch = {};

  if (has('title')) patch.title = v.str('title', { min: 2, max: 200 });
  if (has('price')) patch.price = v.int('price', { min: 0, max: 100000000 });
  if (has('compareAt')) patch.compare_at = v.int('compareAt', { optional: true, min: 0, max: 100000000 });
  if (has('stock')) patch.stock = v.int('stock', { min: 0, max: 1000000 });
  if (has('status')) patch.status = v.oneOf('status', STATUSES);
  if (has('description')) patch.description = v.str('description', { optional: true, max: 5000 });
  if (has('colour')) patch.colour = v.str('colour', { optional: true, max: 60 });
  if (has('colourHex')) patch.colour_hex = v.str('colourHex', { optional: true, max: 9 });
  if (has('fabric')) patch.fabric = v.str('fabric', { optional: true, max: 60 });
  if (has('badge')) patch.badge = v.str('badge', { optional: true, max: 40 });
  if (has('featured')) patch.featured = v.bool('featured');
  if (has('categoryId')) patch.category_id = v.uuid('categoryId');

  if (has('sizes')) {
    patch.sizes = v.list('sizes', function (s) {
      return typeof s === 'string' && s.trim() ? s.trim().slice(0, 20) : null;
    }, { optional: true, max: 20 }) || [];
  }

  var images = has('images')
    ? v.list('images', function (url) {
        return typeof url === 'string' && url.trim() ? url.trim().slice(0, 1000) : null;
      }, { optional: true, max: 12 })
    : null;

  v.done();

  if (!Object.keys(patch).length && images === null) {
    throw Errors.badRequest('There was nothing to change.');
  }

  /* The price and its crossed-out original have to be checked together, and
     a PATCH may carry only one of them — so the other is read from the row
     rather than assumed. Skipping this would let a valid-looking edit hit
     the schema's constraint and return a message written for a developer. */
  if (patch.price !== undefined || patch.compare_at !== undefined) {
    var current = await client
      .from('products')
      .select('price, compare_at')
      .eq('id', id)
      .maybeSingle();

    if (current.error) throw Errors.internal().causedBy(new Error(current.error.message));
    if (!current.data) throw Errors.notFound('That product no longer exists.');

    var price = patch.price !== undefined ? patch.price : current.data.price;
    var compareAt = patch.compare_at !== undefined ? patch.compare_at : current.data.compare_at;

    if (compareAt !== null && compareAt !== undefined && compareAt <= price) {
      throw Errors.badRequest('Check the details and try again.', {
        compareAt: 'The original price must be higher than the sale price.'
      });
    }
  }

  if (Object.keys(patch).length) {
    /* mustAffect is what turns "RLS silently changed nothing" into a 404
       rather than a false success. See api/_lib/rows.js. */
    await rows.mustAffect('product', client
      .from('products')
      .update(patch)
      .eq('id', id)
      .select('id'));
  }

  /* Images are replaced wholesale rather than merged. The form holds the
     complete list and reorders it by dragging, so a partial update would
     have no way to express "this one moved to the front". */
  if (images !== null) {
    var cleared = await client.from('product_images').delete().eq('product_id', id);
    if (cleared.error) throw Errors.internal().causedBy(new Error(cleared.error.message));

    if (images.length) {
      var title = patch.title || '';
      var wrote = await client.from('product_images').insert(
        images.map(function (url, i) {
          return { product_id: id, url: url, alt: title, sort: i };
        }));
      if (wrote.error) throw Errors.internal().causedBy(new Error(wrote.error.message));
    }
  }

  var full = await client
    .from('products')
    .select(shape.PRODUCT_SELECT)
    .eq('id', id)
    .single();

  if (full.error) throw Errors.internal().causedBy(new Error(full.error.message));

  var labels = await deptLabels(client);
  return { product: shape.adminProduct(full.data, labels) };
}

/* -------------------------------------------------------------------------
   DELETE
   ------------------------------------------------------------------------- */

async function archive(req, client) {
  var id = productId(req);

  /* The previous status is read first so Undo can put it back exactly.
     Assuming 'active' would quietly publish a draft the owner archived. */
  var current = await client
    .from('products')
    .select('status')
    .eq('id', id)
    .maybeSingle();

  if (current.error) throw Errors.internal().causedBy(new Error(current.error.message));
  if (!current.data) throw Errors.notFound('That product no longer exists.');

  if (current.data.status === 'archived') {
    /* Already gone. Reporting success rather than an error: the caller asked
       for a state the row is already in. */
    return { archived: true, previousStatus: 'archived' };
  }

  await rows.mustAffect('product', client
    .from('products')
    .update({ status: 'archived' })
    .eq('id', id)
    .select('id'));

  return { archived: true, previousStatus: current.data.status };
}

/* ------------------------------------------------------------------------- */

module.exports = respond.handler(['GET', 'PATCH', 'DELETE'], async function (req) {
  await auth.requireAdmin(req);

  var client = db.asUser(req);

  if (req.method === 'GET') return read(req, client);
  if (req.method === 'PATCH') return update(req, client);
  return archive(req, client);
});
