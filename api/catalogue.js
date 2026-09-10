/* =========================================================================
   api/catalogue.js — GET /api/catalogue
   -------------------------------------------------------------------------
   Every published product, in the shape the storefront's catalogue has
   always had.

   IT RETURNS EVERYTHING, AND THAT IS A DECISION WITH A LIMIT
   The storefront filters, sorts and builds its facets in the browser, over
   the whole array. facets.js, category.js and search.js are all written that
   way, and they work. Serving a page at a time would mean rewriting those
   three, which is a large change to code that is not broken, in exchange for
   nothing a shop this size can feel.

   So this hands over the lot, once, at boot.

   The limit is real and worth writing down rather than discovering: at a few
   hundred products the response is tens of kilobytes and the browser sorts
   it in a frame. At several thousand it is neither, and at that point the
   filtering has to move to the server and those three files have to change.
   That is a rewrite to do when the shop needs it, not before.

   IT READS AS THE PUBLIC, ON PURPOSE
   The query goes through the anon key, so Row Level Security applies exactly
   as it would to a browser: `products: public read` admits only rows with
   status 'active'. A draft cannot appear here even if this file forgot to
   filter for it — and it does not filter for it, deliberately, because the
   policy is the better place for that rule and duplicating it would invite
   the two to disagree.

   The service role key would have worked and would have returned drafts to
   the shop. It is not used here for that reason.
   ========================================================================= */

'use strict';

var respond = require('./_lib/respond');
var shape = require('./_lib/shape');
var db = require('./_lib/supabase');
var Errors = require('./_lib/errors');

/* PostgREST answers at most a thousand rows per request whatever is asked
   of it, so a catalogue larger than that arrives in pieces. */
var PAGE = 1000;

/* A generous ceiling rather than none. If a catalogue ever grew past this,
   silently serving the first slice as though it were everything would be
   the wrong failure — the shop would look complete and be missing stock. */
var MAX = 5000;

module.exports = respond.handler(['GET'], async function (req, res) {

  var client = db.asUser(req);

  /* Department labels come from the top-level categories. One small query
     rather than a join repeated on every product row. */
  var deptRows = await client
    .from('categories')
    .select('slug, label')
    .is('parent_id', null);

  if (deptRows.error) throw Errors.internal().causedBy(new Error(deptRows.error.message));

  var labels = {};
  (deptRows.data || []).forEach(function (row) { labels[row.slug] = row.label; });

  /* Products, in pages, until a short page says that was the end. */
  var products = [];
  var from = 0;

  for (;;) {
    var page = await client
      .from('products')
      .select(shape.PRODUCT_SELECT)
      .order('created_at', { ascending: false })
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
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);

    if (page.error) throw Errors.internal().causedBy(new Error(page.error.message));

    var rows = page.data || [];
    rows.forEach(function (row) { products.push(shape.storefrontProduct(row, labels)); });

    if (rows.length < PAGE) break;

    from += PAGE;
    if (from >= MAX) {
      throw Errors.internal().causedBy(
        new Error('catalogue exceeds ' + MAX + ' products; server-side paging is now required'));
    }
  }

  /* A catalogue is the same for every visitor and changes when the owner
     edits it, not per request. Ten seconds is short enough that a change
     made in the panel shows up while the owner is still looking at the shop,
     and long enough to absorb a burst of visitors.

     respond.js sets `no-store` for everything by default, which is right for
     an API of carts and orders and wrong for this one page. Overridden
     after the handler's own header, so this wins. */
  res.setHeader('Cache-Control', 'public, max-age=10, stale-while-revalidate=60');

  return { products: products, count: products.length };
});
