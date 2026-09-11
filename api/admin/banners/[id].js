/* =========================================================================
   api/admin/banners/[id].js
   -------------------------------------------------------------------------
   GET    /api/admin/banners/:id
   PATCH  /api/admin/banners/:id
   DELETE /api/admin/banners/:id

   DELETE IS REAL, UNLIKE A PRODUCT'S
   A product is archived because past orders point at it. Nothing points at
   a slide: it is a picture and some words on the homepage, and when it is
   gone it is gone. Hiding one is already offered, and is what "take this
   off the homepage for now" means.

   The picture in storage is not deleted with it, deliberately. Two slides
   can name the same file, an image may have been used elsewhere, and a
   delete that also removes a file is a delete that can take something with
   it that nobody meant. Unused files are tidied deliberately, not as a side
   effect of pressing Remove.
   ========================================================================= */

'use strict';

var respond = require('../../_lib/respond');
var validate = require('../../_lib/validate');
var shape = require('../../_lib/shape');
var rows = require('../../_lib/rows');
var auth = require('../../_lib/auth');
var db = require('../../_lib/supabase');
var Errors = require('../../_lib/errors');

function bannerId(req) {
  var v = validate.query(req);
  var id = v.uuid('id');
  v.done();
  return id;
}

async function load(client, id) {
  var result = await client
    .from('banners')
    .select(shape.BANNER_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (result.error) throw Errors.internal().causedBy(new Error(result.error.message));
  if (!result.data) throw Errors.notFound('That slide no longer exists.');

  return result.data;
}

/* -------------------------------------------------------------------------
   PATCH
   ------------------------------------------------------------------------- */

async function update(req, client) {
  var id = bannerId(req);

  var v = validate.body(req);
  var body = v.source;
  var has = function (key) { return Object.prototype.hasOwnProperty.call(body, key); };

  var patch = {};

  /* Moving a slide from the carousel to the collection rail is an edit like
     any other. See db/homepage.sql. */
  if (has('placement')) {
    patch.placement = v.oneOf('placement', ['hero', 'collection', 'feature']);
  }

  if (has('image')) patch.image = v.str('image', { max: 1000 });
  if (has('alt')) patch.alt = v.str('alt', { max: 200 });
  if (has('eyebrow')) patch.eyebrow = v.str('eyebrow', { optional: true, max: 60 });
  if (has('headline')) patch.headline = v.str('headline', { optional: true, max: 120 });
  if (has('body')) patch.body = v.str('body', { optional: true, max: 300 });
  if (has('cta')) patch.cta = v.str('cta', { optional: true, max: 40 });
  if (has('proof')) patch.proof = v.str('proof', { optional: true, max: 120 });
  if (has('status')) patch.status = v.oneOf('status', ['active', 'hidden']);

  if (has('href')) {
    var href = v.str('href', { optional: true, fallback: '/', max: 300 });

    /* The same rule as on create: a page on this site, not anywhere else.
       See api/admin/banners/index.js. */
    if (href && (href.indexOf('/') !== 0 || href.indexOf('//') === 0)) {
      throw Errors.badRequest('Check the details and try again.', {
        href: 'A slide can only link to a page on this site.'
      });
    }

    patch.href = href || '/';
  }

  v.done();

  if (!Object.keys(patch).length) {
    throw Errors.badRequest('There was nothing to change.');
  }

  await load(client, id);

  var saved = await rows.mustAffect('slide', client
    .from('banners')
    .update(patch)
    .eq('id', id)
    .select(shape.BANNER_SELECT));

  return { banner: shape.adminBanner(saved[0]) };
}

/* ------------------------------------------------------------------------- */

module.exports = respond.handler(['GET', 'PATCH', 'DELETE'], async function (req) {
  await auth.requireAdmin(req);

  var client = db.asUser(req);

  if (req.method === 'GET') {
    return { banner: shape.adminBanner(await load(client, bannerId(req))) };
  }

  if (req.method === 'PATCH') return update(req, client);

  var id = bannerId(req);
  await load(client, id);

  await rows.mustAffect('slide', client
    .from('banners')
    .delete()
    .eq('id', id)
    .select('id'));

  return { deleted: true };
});
