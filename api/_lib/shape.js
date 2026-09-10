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
    /* The slug, because every route, link and saved cart line in the
       storefront is built from it and always has been. */
    id: row.slug,

    /* The row's own id, which is what an order line points at.
     *
     * A cart is a list of slugs in localStorage, and place_order files an
     * order line against products.id — so something has to bridge the two,
     * and this is the honest place: the catalogue already knows both. The
     * alternative was letting the checkout send slugs and having the
     * database look them up, which works until a slug changes and a cart
     * saved last week orders the wrong thing.
     *
     * There is nothing to protect here. A uuid identifies a public product
     * in a public catalogue; what may be done with it is decided by the
     * policies, not by whether it is known. */
    productId: row.id,

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

/* -------------------------------------------------------------------------
   Orders

   The panel's order screens were built against generated orders, and those
   carried both a value and its label — `status: 'shipped'` next to
   `statusLabel: 'Shipped'`. The database stores only the value, because a
   label is a word in one language and belongs in the interface. So the
   labels are reproduced here, from the same list admin-seed.js used, and
   the screens are handed the pair they already read.
   ------------------------------------------------------------------------- */

var ORDER_SELECT =
  'id, ref, user_id, status, payment_status, method, subtotal, discount,' +
  ' shipping, total, coupon_code, address, note, created_at,' +
  ' order_items ( id, product_id, title, image, price, qty, size ),' +
  ' profiles:user_id ( id, name, email, phone )';

var STATUS_LABELS = {
  pending: 'Pending',
  processing: 'Processing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled'
};

var PAYMENT_LABELS = {
  paid: 'Paid',
  unpaid: 'Unpaid',
  refunded: 'Refunded'
};

/* The panel shows a method in words. The database stores the four values the
   schema allows, and this is the only place the two meet. */
var METHOD_LABELS = {
  cod: 'Cash on delivery',
  card: 'Card',
  bank: 'Bank transfer',
  wallet: 'Wallet'
};

function orderLines(row) {
  var lines = (row && row.order_items) || [];

  return lines.map(function (line) {
    return {
      /* The product's id, because that is what the panel links to. It is
         null for a product that has since been deleted outright — the line
         keeps its own title and price, which is the point of storing them
         on the line rather than joining to the product. */
      id: line.product_id,
      title: line.title,
      image: line.image,
      price: line.price,
      qty: line.qty,
      size: line.size || null
    };
  });
}

/**
 * An order as the admin panel's list and detail screens know it.
 *
 * `address` is the snapshot stored with the order, not the customer's
 * current address — where it actually went, which is what a delivery
 * question is about.
 */
function adminOrder(row) {
  var person = row.profiles || {};
  var lines = orderLines(row);
  var address = row.address || {};

  return {
    id: row.id,
    ref: row.ref,

    /* An ISO string rather than a Date. It crosses JSON either way, and a
       string is what the screens format; a Date would arrive as a string
       and be used as if it were not. */
    date: row.created_at,
    daysAgo: daysSince(row.created_at),

    /* Null for an order whose account was deleted. The order stays — it
       happened — and the address snapshot still says who it went to. */
    customerId: person.id || null,
    customerName: person.name || address.name || 'Deleted account',
    customerEmail: person.email || null,
    city: address.city || null,

    items: lines,
    itemCount: lines.reduce(function (sum, l) { return sum + l.qty; }, 0),

    subtotal: row.subtotal,
    discount: row.discount,
    shipping: row.shipping,
    total: row.total,
    couponCode: row.coupon_code || null,

    status: row.status,
    statusLabel: STATUS_LABELS[row.status] || row.status,

    /* The panel calls this `payment`; the column is payment_status. */
    payment: row.payment_status,
    paymentLabel: PAYMENT_LABELS[row.payment_status] || row.payment_status,

    method: METHOD_LABELS[row.method] || row.method,
    methodId: row.method,

    address: address,
    note: row.note || null
  };
}

/**
 * An order as its own customer sees it, on the account page.
 *
 * Deliberately narrower than the admin's. There is no customer id, no
 * email and no note here — the person reading it is the customer, and the
 * account page is not a place to hand back a copy of what the shop knows
 * about them.
 */
function customerOrder(row) {
  var lines = orderLines(row);

  return {
    id: row.id,
    ref: row.ref,
    date: row.created_at,
    daysAgo: daysSince(row.created_at),

    items: lines,
    itemCount: lines.reduce(function (sum, l) { return sum + l.qty; }, 0),

    subtotal: row.subtotal,
    discount: row.discount,
    shipping: row.shipping,
    total: row.total,
    couponCode: row.coupon_code || null,

    status: row.status,
    statusLabel: STATUS_LABELS[row.status] || row.status,
    payment: row.payment_status,
    paymentLabel: PAYMENT_LABELS[row.payment_status] || row.payment_status,
    method: METHOD_LABELS[row.method] || row.method,

    address: row.address || {}
  };
}

/* -------------------------------------------------------------------------
   Customers
   ------------------------------------------------------------------------- */

var CUSTOMER_SELECT = 'id, name, email, phone, role, blocked, created_at';

/**
 * A customer row for the panel.
 *
 * `orders` and `spent` come from the customer_stats view rather than from
 * columns, and the schema says why at length: a total kept on the row is
 * correct until an order is cancelled and something forgets to adjust it.
 * Cancelled orders are excluded from both, which is what the panel's list
 * has always shown.
 *
 * `city` is the city of their most recent order, because that is the only
 * place this database keeps one — an address belongs to a delivery, not to
 * a person.
 */
function adminCustomer(row, stats, city) {
  var counted = stats || {};

  return {
    id: row.id,
    name: row.name || '—',
    email: row.email || null,
    phone: row.phone || null,
    city: city || null,
    joinedDaysAgo: daysSince(row.created_at),
    joined: row.created_at,

    /* The panel's word for it. `blocked` is the column; a blocked account
       can sign in and can do nothing, which is what the screen explains. */
    status: row.blocked ? 'blocked' : 'active',
    role: row.role,

    orders: Number(counted.orders || 0),
    spent: Number(counted.spent || 0),
    lastOrderAt: counted.last_order_at || null
  };
}

/* -------------------------------------------------------------------------
   Banners
   ------------------------------------------------------------------------- */

var BANNER_SELECT =
  'id, image, alt, eyebrow, headline, body, cta, href, proof, status, sort, created_at';

/**
 * A slide as the banners screen knows it.
 *
 * Almost a straight copy of the row, because the screen was built against a
 * seed file with the same field names — which is not a coincidence: the
 * table in db/schema.sql was written from that file.
 *
 * `linkOk` is deliberately absent. Whether a slide's destination exists is a
 * question about the storefront's own routes, and the browser is where those
 * are known; the repository answers it there. A server that guessed would be
 * a second list of the shop's pages, going stale on its own schedule.
 */
function adminBanner(row) {
  return {
    id: row.id,
    image: row.image,
    alt: row.alt,
    eyebrow: row.eyebrow || '',
    headline: row.headline || '',
    body: row.body || '',
    cta: row.cta || '',
    href: row.href || '/',
    proof: row.proof || '',
    status: row.status,
    sort: row.sort,
    source: 'database'
  };
}

/* -------------------------------------------------------------------------
   Coupons
   ------------------------------------------------------------------------- */

var COUPON_SELECT =
  'id, code, note, type, value, min_spend, starts_at, expires_at,' +
  ' usage_limit, used_count, disabled, created_at';

/** A timestamp as milliseconds, or null. */
function millis(value) {
  if (!value) return null;
  var at = new Date(value).getTime();
  return isNaN(at) ? null : at;
}

/**
 * A coupon in the shape the coupons screen reads.
 *
 * WHAT IS NOT DECIDED HERE
 * Whether a coupon is running, scheduled, expired, used up or switched off.
 * That follows from its dates against *today*, and today is the reader's,
 * not the server's — a shop in Karachi looking at a coupon that expires
 * tonight should be told what its own clock says. The repository works it
 * out, in one function, so the list and the dialog above it can never
 * disagree.
 *
 * What matters is that place_order does not consult any of that either: it
 * checks the dates itself, in SQL, at the moment of ordering. The state
 * shown here is a description; the refusal is the decision.
 */
function adminCoupon(row) {
  return {
    id: row.id,
    code: row.code,
    note: row.note || '',
    type: row.type,
    value: row.value,
    minSpend: row.min_spend,

    /* Milliseconds, which is what the screen's date helpers have always
       taken. Null where there is no date at all — a coupon with no start
       runs from the moment it exists, and one with no end does not stop. */
    startsAt: millis(row.starts_at),
    expiresAt: millis(row.expires_at),

    usageLimit: row.usage_limit || 0,
    used: row.used_count || 0,
    disabled: !!row.disabled,

    created: row.created_at,
    source: 'database'
  };
}

module.exports = {
  PRODUCT_SELECT: PRODUCT_SELECT,
  CATEGORY_SELECT: CATEGORY_SELECT,
  ORDER_SELECT: ORDER_SELECT,
  CUSTOMER_SELECT: CUSTOMER_SELECT,
  BANNER_SELECT: BANNER_SELECT,
  COUPON_SELECT: COUPON_SELECT,

  storefrontProduct: storefrontProduct,
  adminProduct: adminProduct,
  adminCategory: adminCategory,
  navigationTree: navigationTree,

  adminOrder: adminOrder,
  customerOrder: customerOrder,
  adminCustomer: adminCustomer,
  adminBanner: adminBanner,
  adminCoupon: adminCoupon,

  STATUS_LABELS: STATUS_LABELS,
  PAYMENT_LABELS: PAYMENT_LABELS,
  METHOD_LABELS: METHOD_LABELS,

  imagesOf: imagesOf,
  daysSince: daysSince
};
