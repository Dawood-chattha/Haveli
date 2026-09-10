/* =========================================================================
   api/admin/products/index.js
   -------------------------------------------------------------------------
   GET  /api/admin/products   a page of products, filtered and sorted
   POST /api/admin/products   create one

   ADMIN ONLY, CHECKED TWICE
   requireAdmin() reads the role from the database and refuses anyone else
   before a query is built. Underneath that, every query runs through the
   caller's own token, so the "products: admins write" policy has to admit it
   as well. Neither check is decorative: without the first an outsider gets a
   confusing empty page instead of a clear 403, and without the second a bug
   in this file would be the only thing standing between them and the data.

   FILTERING HAPPENS IN THE DATABASE, UNLIKE THE STOREFRONT
   The shop hands the browser its whole catalogue because its filtering,
   sorting and facets were built that way and work. The panel was not: its
   pages already ask for `{ items, total, page, pages }` and draw a pager
   from it. So this pages properly, and the panel does not change.

   WHAT THE REQUEST IS NOT TRUSTED FOR
   `dept` is never read from the body. It is copied down from the category by
   a database trigger, so a product cannot claim to be in a department its
   category is not in. `slug` and `sku` are derived here rather than accepted,
   and `status` is checked against a fixed list rather than passed through.
   ========================================================================= */

'use strict';

var respond = require('../../_lib/respond');
var validate = require('../../_lib/validate');
var shape = require('../../_lib/shape');
var rows = require('../../_lib/rows');
var auth = require('../../_lib/auth');
var db = require('../../_lib/supabase');
var Errors = require('../../_lib/errors');

var STATUSES = ['active', 'draft', 'archived'];

/* The panel's sort control, mapped to columns. An unknown key falls through
   to the default rather than erroring: a stale bookmark carrying a sort that
   no longer exists should show products, not a failure. */
var SORTS = {
  'newest': { column: 'created_at', ascending: false },
  'name-asc': { column: 'title', ascending: true },
  'name-desc': { column: 'title', ascending: false },
  'price-asc': { column: 'price', ascending: true },
  'price-desc': { column: 'price', ascending: false },
  'stock-asc': { column: 'stock', ascending: true }
};

async function deptLabels(client) {
  var result = await client.from('categories').select('slug, label').is('parent_id', null);
  if (result.error) throw Errors.internal().causedBy(new Error(result.error.message));

  var labels = {};
  (result.data || []).forEach(function (row) { labels[row.slug] = row.label; });
  return labels;
}

/**
 * Every category id a slug refers to, and every id beneath those.
 *
 * Slugs are unique per department, not globally, so without a department
 * "shawls" may legitimately name a row under Men and another under Women;
 * both are returned, because the panel asked for shawls and meant shawls.
 */
async function idsBelow(client, slug, dept) {
  var q = client.from('categories').select('id').eq('slug', slug);
  if (dept) q = q.eq('dept', dept);

  var found = await q;
  if (found.error) throw Errors.internal().causedBy(new Error(found.error.message));

  var ids = (found.data || []).map(function (row) { return row.id; });
  if (!ids.length) return [];

  /* The tree is two levels deep, so one hop finds everything below. */
  var kids = await client.from('categories').select('id').in('parent_id', ids);
  if (kids.error) throw Errors.internal().causedBy(new Error(kids.error.message));

  return ids.concat((kids.data || []).map(function (row) { return row.id; }));
}

/* -------------------------------------------------------------------------
   GET
   ------------------------------------------------------------------------- */

async function list(req, client) {
  var v = validate.query(req);

  var search = v.str('search', { optional: true, max: 120 });
  var dept = v.str('dept', { optional: true, max: 60 });
  var category = v.str('category', { optional: true, max: 60 });
  var status = v.str('status', { optional: true, max: 20 });
  var sort = v.str('sort', { optional: true, max: 20 });
  var page = v.int('page', { optional: true, fallback: 1, min: 1, max: 10000 });
  var perPage = v.int('perPage', { optional: true, fallback: 20, min: 1, max: 100 });
  v.done();

  var query = client
    .from('products')
    .select(shape.PRODUCT_SELECT, { count: 'exact' });

  if (search) {
    /* Escaping the characters PostgREST's `or` filter treats as structure.
       A search for "polo,shirt" would otherwise be read as two conditions. */
    var needle = search.replace(/[,()]/g, ' ').trim();
    if (needle) {
      query = query.or('title.ilike.*' + needle + '*,sku.ilike.*' + needle + '*');
    }
  }

  if (dept) query = query.eq('dept', dept);

  /* A CATEGORY FILTER IS RESOLVED TO IDS FIRST, AND HAS TO BE
   *
   * The obvious version of this line is `.eq('categories.slug', category)`,
   * and it is wrong in a way that looks like it works. A filter on an
   * embedded table does not narrow the rows it is embedded in — PostgREST
   * empties the embed on rows that do not match and returns every row
   * regardless. So the panel asked for one category and was handed the whole
   * catalogue with the right total printed underneath it.
   *
   * Resolving the slug here also fixes two things the embedded filter could
   * not do: a slug nobody has returns an empty page rather than everything,
   * and a parent category includes what is beneath it, which is what the
   * count beside it in the category list already claims.
   */
  var categoryIds = null;

  if (category) {
    categoryIds = await idsBelow(client, category, dept);
    if (!categoryIds.length) {
      return { items: [], total: 0, page: 1, pages: 1, perPage: perPage };
    }
    query = query.in('category_id', categoryIds);
  }

  /* 'out-of-stock' is not a status in the database and never was — the old
     build derived it from stock because it had no status column. The panel's
     filter still offers it, and this is the question it was really asking. */
  if (status === 'out-of-stock') query = query.eq('stock', 0);
  else if (status && STATUSES.indexOf(status) > -1) query = query.eq('status', status);

  var order = SORTS[sort] || SORTS.newest;
  query = query.order(order.column, { ascending: order.ascending });

  /* AND THEN BY ID, WHICH IS NOT A DETAIL
   *
   * Postgres breaks ties in whatever order it likes, and it does not have
   * to pick the same order twice. Five hundred and sixty products seeded in
   * one statement share a created_at to the microsecond, so paging by that
   * alone returned some rows on two pages and others on none — the list
   * looked right, the totals were right, and five products were missing
   * from a walk through all of them.
   *
   * An id is unique, so adding it makes the ordering total: every row has
   * exactly one place, and page two begins where page one ended. */
  query = query.order('id', { ascending: true });

  var from = (page - 1) * perPage;
  query = query.range(from, from + perPage - 1);

  var result = await query;
  if (result.error) throw Errors.internal().causedBy(new Error(result.error.message));

  var labels = await deptLabels(client);
  var total = result.count || 0;
  var pages = Math.max(1, Math.ceil(total / perPage));

  return {
    items: (result.data || []).map(function (row) { return shape.adminProduct(row, labels); }),
    total: total,
    page: Math.min(page, pages),
    pages: pages,
    perPage: perPage
  };
}

/* -------------------------------------------------------------------------
   POST
   ------------------------------------------------------------------------- */

async function create(req, client) {
  var v = validate.body(req);

  var title = v.str('title', { min: 2, max: 200 });
  var categoryId = v.uuid('categoryId');
  var price = v.int('price', { min: 0, max: 100000000 });
  var compareAt = v.int('compareAt', { optional: true, min: 0, max: 100000000 });
  var stock = v.int('stock', { optional: true, fallback: 0, min: 0, max: 1000000 });
  var status = v.oneOf('status', STATUSES, { optional: true, fallback: 'draft' });
  var description = v.str('description', { optional: true, max: 5000 });
  var colour = v.str('colour', { optional: true, max: 60 });
  var colourHex = v.str('colourHex', { optional: true, max: 9 });
  var fabric = v.str('fabric', { optional: true, max: 60 });
  var badge = v.str('badge', { optional: true, max: 40 });
  var featured = v.bool('featured', { optional: true, fallback: false });
  var sizes = v.list('sizes', function (s) {
    return typeof s === 'string' && s.trim() ? s.trim().slice(0, 20) : null;
  }, { optional: true, max: 20 });
  var images = v.list('images', function (url) {
    return typeof url === 'string' && url.trim() ? url.trim().slice(0, 1000) : null;
  }, { optional: true, max: 12 });
  v.done();

  /* The schema rejects a compare_at at or below the price, which is correct
     and produces an unhelpful database error. Saying it here names the field
     the person has to fix. */
  if (compareAt !== null && compareAt <= price) {
    throw Errors.badRequest('Check the details and try again.', {
      compareAt: 'The original price must be higher than the sale price.'
    });
  }

  /* That the category exists is checked before the insert so the answer
     names the problem. The trigger would also refuse it, with a message
     written for a developer. */
  var category = await client
    .from('categories')
    .select('id, slug, dept')
    .eq('id', categoryId)
    .maybeSingle();

  if (category.error) throw Errors.internal().causedBy(new Error(category.error.message));
  if (!category.data) {
    throw Errors.badRequest('Check the details and try again.', {
      categoryId: 'That category does not exist.'
    });
  }

  var slug = await rows.uniqueSlug(client, 'products', title, null, null);

  var created = await rows.mustInsert('product', client
    .from('products')
    .insert({
      title: title,
      slug: slug,
      description: description,
      category_id: categoryId,
      price: price,
      compare_at: compareAt,
      stock: stock,
      status: status,
      colour: colour,
      colour_hex: colourHex,
      fabric: fabric,
      badge: badge,
      featured: featured,
      sizes: sizes || [],

      /* Readable, stable, and derived rather than accepted — a SKU typed in
         a form is a SKU that can collide with one already in use. */
      sku: 'HAV-' + slug.toUpperCase().slice(0, 24)

      /* `dept` is absent on purpose: the products_set_dept trigger copies it
         from the category. Sending it would let a request disagree with the
         category it named. */
    })
    .select(shape.PRODUCT_SELECT));

  /* Images are their own table, so they go in after the product exists. */
  if (images && images.length) {
    var imageRows = images.map(function (url, i) {
      return { product_id: created[0].id, url: url, alt: title, sort: i };
    });

    var wrote = await client.from('product_images').insert(imageRows);
    if (wrote.error) throw Errors.internal().causedBy(new Error(wrote.error.message));
  }

  /* Read back rather than returning the insert's own row, so the response
     carries the images that were just written and the category that was
     joined — the same shape a GET would give. */
  var full = await client
    .from('products')
    .select(shape.PRODUCT_SELECT)
    .eq('id', created[0].id)
    .single();

  if (full.error) throw Errors.internal().causedBy(new Error(full.error.message));

  var labels = await deptLabels(client);
  return { product: shape.adminProduct(full.data, labels) };
}

/* ------------------------------------------------------------------------- */

module.exports = respond.handler(['GET', 'POST'], async function (req) {
  await auth.requireAdmin(req);

  /* The caller's own token, so the policies apply as a second opinion. */
  var client = db.asUser(req);

  if (req.method === 'GET') return list(req, client);
  return create(req, client);
});
