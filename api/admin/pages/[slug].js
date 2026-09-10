/* =========================================================================
   api/admin/pages/[slug].js
   -------------------------------------------------------------------------
   GET   /api/admin/pages/:slug    one page, as it is
   PATCH /api/admin/pages/:slug    change its words

   NO DELETE, FOR THE SAME REASON THERE IS NO POST
   The footer links to every one of these. Removing a row would leave a link
   pointing at a page that no longer exists, and the panel would have taken
   the shop's own navigation apart from a screen about wording. Emptying a
   page is what "remove" means here, and it is done by clearing the body.

   THE SLUG IS NOT EDITABLE
   It is the route. assets/js/routes.js and data/footer.js both name it, and
   a slug the panel could change is a footer link the panel could break. The
   title above the words is editable; the address is not.

   THE BODY IS TEXT, AND STAYS TEXT
   Nothing stored here is rendered as markup. assets/js/pages/static.js
   escapes every character before applying its three rules. That is the
   whole of why an owner may type freely into this field without it becoming
   a way to put a script on the shop's own pages — so nothing downstream may
   ever start trusting it.
   ========================================================================= */

'use strict';

var respond = require('../../_lib/respond');
var validate = require('../../_lib/validate');
var shape = require('../../_lib/shape');
var rows = require('../../_lib/rows');
var auth = require('../../_lib/auth');
var db = require('../../_lib/supabase');
var Errors = require('../../_lib/errors');

/* Long enough for a real returns policy or a privacy notice, short enough
   that a paste of something enormous is refused with a clear message rather
   than stored. */
var MAX_BODY = 20000;

function pageSlug(req) {
  var v = validate.query(req);
  var slug = v.slug('slug');
  v.done();
  return slug;
}

async function load(client, slug) {
  var result = await client
    .from('pages')
    .select(shape.PAGE_SELECT)
    .eq('slug', slug)
    .maybeSingle();

  if (result.error) throw Errors.internal().causedBy(new Error(result.error.message));
  if (!result.data) throw Errors.notFound('There is no such page.');

  return result.data;
}

/* ------------------------------------------------------------------------- */

module.exports = respond.handler(['GET', 'PATCH'], async function (req) {
  await auth.requireAdmin(req);

  var client = db.asUser(req);
  var slug = pageSlug(req);

  if (req.method === 'GET') {
    return { page: shape.adminPage(await load(client, slug)) };
  }

  /* Existence first, so a slug that is not one of the twelve is a 404
     rather than a validation error about fields on a page that is not
     there. */
  await load(client, slug);

  var v = validate.body(req);
  var body = v.source;
  var has = function (key) { return Object.prototype.hasOwnProperty.call(body, key); };

  var patch = {};

  if (has('title')) patch.title = v.str('title', { min: 2, max: 120 });
  if (has('eyebrow')) patch.eyebrow = v.str('eyebrow', { optional: true, fallback: '', max: 60 });
  if (has('lead')) patch.lead = v.str('lead', { optional: true, fallback: '', max: 300 });
  if (has('body')) patch.body = v.str('body', { optional: true, fallback: '', max: MAX_BODY });
  if (has('status')) patch.status = v.oneOf('status', ['draft', 'published']);

  v.done();

  if (!Object.keys(patch).length) {
    throw Errors.badRequest('There was nothing to change.');
  }

  /* Publishing a page with nothing in it would put a live link in the
     footer leading to a heading and white space. Refused here rather than
     allowed and then explained on the screen, because the screen is not
     the only thing that can call this. */
  if (patch.status === 'published') {
    var text = patch.body !== undefined ? patch.body : (await load(client, slug)).body;

    if (!String(text || '').trim()) {
      throw Errors.badRequest('Check the details and try again.', {
        body: 'Write something before publishing this page.'
      });
    }
  }

  var saved = await rows.mustAffect('page', client
    .from('pages')
    .update(patch)
    .eq('slug', slug)
    .select(shape.PAGE_SELECT));

  return { page: shape.adminPage(saved[0]) };
});
