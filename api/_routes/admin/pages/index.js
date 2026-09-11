/* =========================================================================
   api/admin/pages/index.js
   -------------------------------------------------------------------------
   GET /api/admin/pages    every page, drafts and all

   THERE IS NO POST HERE, AND THERE SHOULD NOT BE
   Each of these twelve rows has a route in assets/js/routes.js and a link
   in data/footer.js. A thirteenth would be a page nothing leads to — words
   the owner wrote and no visitor can reach — and there is no honest way for
   this endpoint to add the route that would fix that.

   Adding a page is a change to the site's shape. It belongs in the two
   files above and in db/pages.sql, together, in one commit. Not in a form.

   NOT PAGED
   Twelve rows, and the screen's whole purpose is the count of how many are
   still empty. A page of six would answer that wrongly.
   ========================================================================= */

'use strict';

var respond = require('../../../_lib/respond');
var shape = require('../../../_lib/shape');
var auth = require('../../../_lib/auth');
var db = require('../../../_lib/supabase');
var Errors = require('../../../_lib/errors');

module.exports = respond.handler(['GET'], async function (req) {
  await auth.requireAdmin(req);

  var result = await db.asUser(req)
    .from('pages')
    .select(shape.PAGE_SELECT)
    .order('sort', { ascending: true })
    .order('slug', { ascending: true });

  if (result.error) throw Errors.internal().causedBy(new Error(result.error.message));

  var items = (result.data || []).map(shape.adminPage);

  return {
    items: items,
    total: items.length,

    /* The two numbers the screen is opened to see. "Published" is not the
       same question as "written": a page can be published with an empty
       body, which is a link to nothing and worth counting separately. */
    published: items.filter(function (row) { return row.status === 'published'; }).length,
    empty: items.filter(function (row) { return !row.written; }).length
  };
});
