/* =========================================================================
   api/banners.js — GET /api/banners
   -------------------------------------------------------------------------
   { hero: [...], collections: [...], feature: {...} | null }

   What the home page puts at the top of itself, and what it says lower down.
   Public, because it is the front of a shop.

   WHY THIS EXISTS AT ALL
   The banners table, the endpoints that write it and the panel's Banners
   screen were built in Phase 6, and nothing on the storefront ever read them.
   The hero carousel came from data/hero.js — seven invented slides in a file
   the owner cannot reach — so slides could be edited all afternoon and the
   shop would not change. This is the other end of that wire.

   THREE PLACES, ONE TABLE
   A hero slide, a collection tile and the editorial band are the same row
   with different parts filled in. `placement` says which, and this groups
   them so the page can ask once. See db/homepage.sql.

   HIDDEN MEANS UNREACHABLE, NOT MERELY UNLISTED
   The filter on status below is a courtesy; the guarantee is the policy in
   db/policies.sql, which lets the public read rows whose status is 'active'
   and no others. A visitor reading this API directly, or guessing an id,
   cannot see a hidden slide.

   AN EMPTY ANSWER IS A REAL ANSWER
   A shop that has not chosen a hero picture yet gets an empty list, and the
   storefront draws nothing where the carousel would be. It does not fall back
   to a file. That is the same rule the catalogue follows and it is there for
   the same reason: a stale menu is still a menu, but an invented headline is
   a claim the shop never made.
   ========================================================================= */

'use strict';

var respond = require('./_lib/respond');
var shape = require('./_lib/shape');
var Errors = require('./_lib/errors');
var db = require('./_lib/supabase');

/* The same window the catalogue uses. Long enough to absorb a burst of
   visitors, short enough that the owner sees a change while still looking at
   the shop they just edited. */
var CACHE = 'public, max-age=30, stale-while-revalidate=300';

/* A page cannot show fifty hero slides, and a request that could ask for
   fifty thousand rows is a request worth bounding. */
var MAX = 60;

module.exports = respond.handler(['GET'], async function (req, res) {

  /* As the caller, not as the server: the public read policy is what decides
     that a hidden slide is invisible, and going through it is what makes that
     true rather than merely implemented here. */
  var client = db.asUser(req);

  var result = await client
    .from('banners')
    .select(shape.BANNER_SELECT)
    .eq('status', 'active')
    .order('sort', { ascending: true })
    /* Postgres does not have to break ties the same way twice, and slides
       seeded together share a sort. Without this the carousel could deal the
       same picture twice and skip another. */
    .order('id', { ascending: true })
    .limit(MAX);

  if (result.error) {
    throw Errors.internal().causedBy(new Error(result.error.message));
  }

  var rows = result.data || [];

  function placed(where) {
    return rows.filter(function (row) { return row.placement === where; });
  }

  res.setHeader('Cache-Control', CACHE);

  return {
    hero: placed('hero').map(shape.publicBanner),
    collections: placed('collection').map(shape.publicBanner),

    /* One band, not a list. The screen has room for one and the owner orders
       them, so the first is the one they meant. */
    feature: placed('feature').map(shape.publicBanner)[0] || null
  };
});
