/* =========================================================================
   api/_lib/shape.js — database rows into the shapes the frontend already has
   -------------------------------------------------------------------------
   THE FRONTEND IS NOT BEING CHANGED TO SUIT THE DATABASE. THIS FILE MAKES
   THE DATABASE SUIT THE FRONTEND.

   Twenty thousand lines of storefront and panel were built against two
   shapes: the product the catalogue generator produced, and the row the
   admin repository handed to its pages. Every card, filter, facet, sort,
   form and table reads those fields by name.

   The database could have been read straight into those pages, letting each
   one learn `compare_at` and `colour_hex` and `product_images[0].url`. That
   would have meant editing dozens of files to rename fields, for no gain
   whatever — the names would be no better, and each edit is a chance to
   break something that works.

   So the translation happens once, here. Both halves of the site keep the
   vocabulary they were written in.

   TWO SHAPES, BECAUSE THERE ARE TWO QUESTIONS
   A shop asks "what can I buy" — badges, related items, images to swap on
   hover. A panel asks "what do we sell" — SKU, stock, status, whether it is
   published at all. The old build had toRow() turning one into the other;
   here they are simply two functions over the same row.

   IDENTIFIERS DIFFER, AND DELIBERATELY
     storefront   id = the slug, so URLs stay /product/men-basic-polo-3
                  rather than /product/8f14e45f-ceea-467a-9b1e-cf9e3a2b4c11
     admin        id = the uuid, because the panel edits rows and a slug can
                  be changed by the person editing it

   A product therefore has two names, each used where it belongs. The admin
   row carries storefrontPath so the panel can link to the shop without
   knowing that rule.
   ========================================================================= */

'use strict';

/* What every query must select for these functions to work. Kept here rather
   than repeated in each endpoint, so a field added below is added once. */
var PRODUCT_SELECT =
  'id, title, slug, description, price, compare_at, sku, stock, colour,' +
  ' colour_hex, fabric, sizes, badge, featured, status, dept, created_at,' +
  ' product_images (url, alt, sort),' +
  ' categories!products_category_id_fkey (' +
  '   id, slug, label, dept,' +
  /* parent_id on the parent as well, which is what distinguishes "this
     category sits inside another category" from "this category sits
     directly inside a department". See parentLabel below. */
  '   parent:parent_id ( id, slug, label, parent_id )' +
  ' )';

var CATEGORY_SELECT = 'id, parent_id, dept, slug, label, sort, active, created_at';

/* -------------------------------------------------------------------------
   Helpers
   ------------------------------------------------------------------------- */

/**
 * Images in their intended order, as bare urls.
 *
 * PostgREST returns an embedded array in no guaranteed order, so the sort
 * happens here rather than being hoped for. The storefront's card swaps to
 * images[1] on hover and the panel shows images[0] as the thumbnail, so the
 * order is not cosmetic.
 */
function imagesOf(row) {
  var list = row.product_images || [];
  return list.slice()
    .sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); })
    .map(function (image) { return image.url; });
}

/** Whole days since a date. The storefront sorts "newest" by this. */
function daysSince(value) {
  if (!value) return 0;
  var then = new Date(value).getTime();
  if (!isFinite(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 86400000));
}

/**
 * The label the storefront shows for a department.
 *
 * Departments are rows in the categories table like any other — a top-level
 * one, with no parent. Their labels therefore have to be looked up, and the
 * endpoints pass a map built once per request rather than making this
 * function query.
 */
function deptLabel(labels, dept) {
  return (labels && labels[dept]) || dept;
}

/* -------------------------------------------------------------------------
   Products
   ------------------------------------------------------------------------- */

/**
 * A product as the storefront's catalogue knows it.
 *
 * Matches what assets/js/catalogue.js used to generate, field for field. The
 * two exceptions are noted where they occur.
 */
function storefrontProduct(row, labels) {
  var category = row.categories || {};
  var parent = category.parent || null;

  return {
    id: row.slug,
    title: row.title,

    dept: row.dept,
    deptLabel: deptLabel(labels, row.dept),
    category: category.slug || null,
    categoryLabel: category.label || null,

    /* Only when the category sits inside another CATEGORY.
     *
     * Every category has a parent in the database, because departments are
     * rows too — so "has a parent" is true of all of them and is the wrong
     * test. The first version used it and put "Kids" here for a category
     * directly under the Kids department, where the generator this replaces
     * left it empty. The breadcrumb would then have read Kids / Kids /
     * Accessories.
     *
     * A parent that has no parent of its own is a department. */
    parentLabel: (parent && parent.parent_id) ? parent.label : null,

    /* The owner's own words about the product. The generated catalogue had
       none, so the product page invented a sentence instead; it still does
       when this is empty, and uses this when it is not. */
    description: row.description || '',

    price: row.price,
    compareAt: row.compare_at,
    badge: row.badge,
    colour: row.colour,
    colourHex: row.colour_hex,
    fabric: row.fabric,
    sizes: row.sizes || [],

    /* There is no in_stock column and there should not be: two columns that
       must agree eventually disagree. */
    inStock: (row.stock || 0) > 0,

    /* NOT REAL YET, AND NOT INVENTED.
       The generator produced a number from the product's own id, which made
       the "Best selling" sort return a stable but meaningless order. There
       is nothing to count until orders exist, so this is zero for every
       product and that sort falls back to the catalogue's own order. It
       becomes a count of order_items in Phase 8. Zero is the honest answer;
       a made-up ranking in a real shop is not. */
    popularity: 0,

    addedDaysAgo: daysSince(row.created_at),

    images: imagesOf(row),
    path: '/product/' + row.slug
  };
}

/**
 * A product as the admin panel's list and forms know it.
 *
 * `status` is now the column of that name rather than something derived from
 * stock. The old build had no status to store, so it reported a product as
 * "out-of-stock" when it had none left; the panel's filter still offers that
 * value and the endpoint answers it with `stock = 0`, which is the question
 * that was really being asked.
 */
function adminProduct(row, labels) {
  var category = row.categories || {};

  return {
    id: row.id,
    title: row.title,
    image: imagesOf(row)[0] || null,

    dept: row.dept,
    deptLabel: deptLabel(labels, row.dept),
    category: category.slug || null,
    categoryLabel: category.label || null,

    /* The form needs the id to preselect the category; the list needs the
       slug to filter by it. Both are here rather than one being derived. */
    categoryId: category.id || null,

    price: row.price,
    compareAt: row.compare_at,
    colour: row.colour,
    colourHex: row.colour_hex,
    fabric: row.fabric,
    sizes: row.sizes || [],

    stock: row.stock || 0,
    inStock: (row.stock || 0) > 0,

    sku: row.sku,
    status: row.status,
    featured: !!row.featured,
    badge: row.badge,
    description: row.description || '',

    images: imagesOf(row),
    storefrontPath: '/product/' + row.slug,
    slug: row.slug
  };
}

/* -------------------------------------------------------------------------
   Categories
   ------------------------------------------------------------------------- */

/**
 * A category as the admin panel's list knows it.
 *
 * `level` is 1 for a category directly under a department and 2 for one
 * nested below that — which is what the panel indents by, and what its
 * "Top level / Sub-category" filter means. Departments themselves are not
 * returned as rows: the panel manages the categories inside a department,
 * not the three departments, and showing them would offer a Delete button
 * for "Women".
 */
function adminCategory(row, byId, labels, counts) {
  var parent = row.parent_id ? byId[row.parent_id] : null;

  /* A parent that is itself a department means this row is level 1. */
  var parentIsDept = parent && !parent.parent_id;

  return {
    id: row.id,
    label: row.label,
    slug: row.slug,
    dept: row.dept,
    deptLabel: deptLabel(labels, row.dept),

    parentId: parentIsDept ? null : row.parent_id,
    parentLabel: parentIsDept ? null : (parent ? parent.label : null),
    level: parentIsDept ? 1 : 2,

    childCount: (counts && counts.children[row.id]) || 0,
    productCount: (counts && counts.products[row.id]) || 0,

    status: row.active ? 'active' : 'hidden',
    sort: row.sort,

    /* Everything is editable now. The old build marked rows that came from
       the static navigation file, because those could not be written to. */
    source: 'database'
  };
}

/**
 * The whole tree in the shape ZB.navigation has always had:
 *
 *   [ { id, label, items: [ { label, children: [ { label } ] } ] } ]
 *
 * The menu drawer, the storefront's category routes and the catalogue's own
 * lookups are all built on it. Producing it here means none of them change.
 *
 * Hidden categories are absent rather than flagged, because every consumer
 * of this list treats what it receives as the menu.
 */
function navigationTree(rows) {
  var byParent = {};
  var depts = [];

  rows.forEach(function (row) {
    if (!row.active) return;

    if (!row.parent_id) { depts.push(row); return; }

    (byParent[row.parent_id] = byParent[row.parent_id] || []).push(row);
  });

  var bySort = function (a, b) {
    if (a.sort !== b.sort) return a.sort - b.sort;
    return a.label.localeCompare(b.label);
  };

  depts.sort(bySort);

  return depts.map(function (dept) {
    var items = (byParent[dept.id] || []).sort(bySort);

    return {
      id: dept.slug,
      label: dept.label,
      items: items.map(function (item) {
        var children = (byParent[item.id] || []).sort(bySort);

        var out = { label: item.label };

        /* The drawer decides whether a category opens a sub-panel by
           whether `children` is present at all, so an empty array is not
           the same as none and must not be sent. */
        if (children.length) {
          out.children = children.map(function (child) { return { label: child.label }; });
        }
        return out;
      })
    };
  });
}

module.exports = {
  PRODUCT_SELECT: PRODUCT_SELECT,
  CATEGORY_SELECT: CATEGORY_SELECT,
  storefrontProduct: storefrontProduct,
  adminProduct: adminProduct,
  adminCategory: adminCategory,
  navigationTree: navigationTree,
  imagesOf: imagesOf,
  daysSince: daysSince
};
