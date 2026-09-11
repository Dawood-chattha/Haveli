/* =========================================================================
   api/admin/banners/index.js
   -------------------------------------------------------------------------
   GET   /api/admin/banners     every slide, in the order it plays
   POST  /api/admin/banners     add one, at the end of the run
   PATCH /api/admin/banners     { order: [id, id, …] } — the whole run

   NEVER PAGED
   Seven slides is the whole of it, and a carousel with fifty is a carousel
   nobody watches. Paging would hide the one thing this screen is for:
   seeing the run of slides in the order they play.

   THE ORDER IS SENT WHOLE, NOT AS A MOVE
   "Slide three moved up" needs the server to know what three was, which
   means the screen and the server agreeing about the current order before
   the change — and they can disagree, if two tabs are open. A complete list
   of ids says what the run should now be, whatever it was. The last save
   wins, which for a shop's own carousel is the right answer.
   ========================================================================= */

'use strict';

var respond = require('../../../_lib/respond');
var validate = require('../../../_lib/validate');
var shape = require('../../../_lib/shape');
var rows = require('../../../_lib/rows');
var auth = require('../../../_lib/auth');
var db = require('../../../_lib/supabase');
var Errors = require('../../../_lib/errors');

/* A carousel nobody would sit through. Not a technical limit — a limit on
   how much homepage one shop needs. */
var MAX_SLIDES = 24;

/* -------------------------------------------------------------------------
   GET
   ------------------------------------------------------------------------- */

async function list(req, client) {
  var result = await client
    .from('banners')
    .select(shape.BANNER_SELECT)
    .order('sort', { ascending: true })
    .order('created_at', { ascending: true });

  if (result.error) throw Errors.internal().causedBy(new Error(result.error.message));

  var items = (result.data || []).map(shape.adminBanner);

  return {
    items: items,
    total: items.length,
    active: items.filter(function (row) { return row.status === 'active'; }).length,
    hidden: items.filter(function (row) { return row.status !== 'active'; }).length
  };
}

/* -------------------------------------------------------------------------
   POST
   ------------------------------------------------------------------------- */

function readSlide(req, required) {
  var v = validate.body(req);
  var body = v.source;
  var has = function (key) { return Object.prototype.hasOwnProperty.call(body, key); };

  var patch = {};

  /* On a create everything required is required. On a patch only what was
     sent is looked at, so clearing a headline is possible and forgetting to
     resend one is not the same as erasing it. */
  var want = function (key) { return required || has(key); };

  /* WHERE ON THE HOME PAGE THIS ROW APPEARS
     Three places, one table: see db/homepage.sql for why. Absent on a
     create means 'hero', which is what every row written before that
     migration is, and what somebody adding a slide almost always means.

     It goes through oneOf rather than being taken as given, so a value the
     database's own check constraint would refuse is answered with a
     sentence about the field rather than a 500 from Postgres. */
  if (has('placement') || required) {
    patch.placement = has('placement')
      ? v.oneOf('placement', ['hero', 'collection', 'feature'])
      : 'hero';
  }

  if (want('image')) patch.image = v.str('image', { max: 1000 });
  if (want('alt')) patch.alt = v.str('alt', { max: 200 });

  if (has('eyebrow')) patch.eyebrow = v.str('eyebrow', { optional: true, max: 60 });
  if (has('headline')) patch.headline = v.str('headline', { optional: true, max: 120 });
  if (has('body')) patch.body = v.str('body', { optional: true, max: 300 });
  if (has('cta')) patch.cta = v.str('cta', { optional: true, max: 40 });
  if (has('proof')) patch.proof = v.str('proof', { optional: true, max: 120 });
  if (has('status')) patch.status = v.oneOf('status', ['active', 'hidden']);

  /* A path within this site, and only that. The panel offers a list of real
     destinations rather than a text box, and this is the rule behind it: an
     absolute URL here would let the shop's own homepage carry a link
     somewhere else entirely. */
  if (want('href')) {
    var href = v.str('href', { optional: true, fallback: '/', max: 300 });

    if (href) {
      if (href.indexOf('/') !== 0 || href.indexOf('//') === 0) {
        throw Errors.badRequest('Check the details and try again.', {
          href: 'A slide can only link to a page on this site.'
        });
      }
      patch.href = href;
    }
  }

  v.done();
  return patch;
}

async function create(req, client) {
  var slide = readSlide(req, true);

  var count = await client
    .from('banners')
    .select('id', { count: 'exact', head: true });

  if (count.error) throw Errors.internal().causedBy(new Error(count.error.message));

  if ((count.count || 0) >= MAX_SLIDES) {
    throw Errors.conflict('There are already ' + MAX_SLIDES + ' slides. ' +
                          'Remove one before adding another.');
  }

  /* At the end of the run. A new slide appearing first would put something
     nobody has looked at yet in front of everyone who opens the shop. */
  var last = await client
    .from('banners')
    .select('sort')
    .order('sort', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (last.error) throw Errors.internal().causedBy(new Error(last.error.message));

  slide.sort = last.data ? last.data.sort + 1 : 0;
  if (!slide.status) slide.status = 'active';

  var created = await rows.mustInsert('slide', client
    .from('banners')
    .insert(slide)
    .select(shape.BANNER_SELECT));

  return { banner: shape.adminBanner(created[0]) };
}

/* -------------------------------------------------------------------------
   PATCH — the running order
   ------------------------------------------------------------------------- */

async function reorder(req, client) {
  var v = validate.body(req);

  var order = v.list('order', function (id) {
    return typeof id === 'string' &&
           /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      ? id : null;
  }, { max: MAX_SLIDES });
  v.done();

  if (!order || !order.length) {
    throw Errors.badRequest('There was no order to save.');
  }

  var current = await client.from('banners').select('id');
  if (current.error) throw Errors.internal().causedBy(new Error(current.error.message));

  var known = {};
  (current.data || []).forEach(function (row) { known[row.id] = true; });

  /* An order naming a slide that has gone — deleted in another tab — would
     write positions for the rest and silently drop it. Refusing sends the
     screen back for a fresh list, which is what it needs anyway. */
  var missing = order.filter(function (id) { return !known[id]; });

  if (missing.length) {
    throw Errors.conflict('The slides have changed since this page loaded. ' +
                          'Reload and try again.');
  }

  /* One statement per slide. A carousel is a couple of dozen rows at most,
     and the alternative — an upsert of the whole table — would rewrite
     every other column from values this request never sent.

     ALL AT ONCE, NOT ONE AFTER THE OTHER
     They were sequential to begin with, and a run of seven took between
     three and sixteen seconds depending on the day. The sixteen-second one
     passed the fifteen-second deadline in api/_lib/supabase.js and came
     back as a server error with the order half written. Nothing here waits
     on anything else — each statement sets one row's position to a number
     already decided above — so the round trips overlap and the whole
     reorder costs about what one of them does.

     IT IS STILL NOT ATOMIC, AND THAT IS A KNOWN LIMIT
     PostgREST has no transaction spanning separate requests. If one of
     these fails the rest may already have been applied, and the carousel is
     left in an order nobody asked for. It is recoverable — the screen
     reloads from the database and the owner can move the slide again — and
     it is the homepage's running order rather than anybody's money. If that
     ever stops being good enough the fix is a security-definer function
     taking the whole array, the way place_order takes a whole basket. */
  var writes = await Promise.all(order.map(function (id, i) {
    return client.from('banners').update({ sort: i }).eq('id', id).select('id');
  }));

  var broke = writes.filter(function (w) { return w.error; })[0];
  if (broke) throw Errors.internal().causedBy(new Error(broke.error.message));

  return list(req, client);
}

/* ------------------------------------------------------------------------- */

module.exports = respond.handler(['GET', 'POST', 'PATCH'], async function (req) {
  await auth.requireAdmin(req);

  var client = db.asUser(req);

  if (req.method === 'GET') return list(req, client);
  if (req.method === 'POST') return create(req, client);
  return reorder(req, client);
});
