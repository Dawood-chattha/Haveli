/* =========================================================================
   api/shop.js
   -------------------------------------------------------------------------
   GET /api/shop    the shop's own details, for the shop's own pages

   WHY THIS IS PUBLIC AND api/admin/settings.js IS NOT
   They read the same row and they are not the same question. The panel's
   endpoint is the owner's whole record — the low-stock threshold, the
   notification choices, everything — and it is behind requireAdmin because
   most of that is nobody else's business.

   This is the handful of fields a shop prints on its own footer: the name,
   the line under it, and how to get in touch. A customer is *meant* to see
   them. They are named one by one below rather than passed through, so a
   field added to the settings record in future is not published by
   accident.

   READ AS THE SERVER, DELIBERATELY
   The settings table's policy is "admins only", for read as well as write,
   which is right — but it means a signed-out visitor cannot read this row
   for themselves. So this reads it with the service key and hands back the
   named fields, exactly as GET /api/checkout does for the delivery rate,
   and for the same reason: not secret, but not readable by the person who
   needs it.

   AN EMPTY FIELD IS AN EMPTY FIELD
   Nothing here is filled in with a plausible default. The shop's contact
   details start blank because nobody has typed them yet, and a footer
   showing an invented mailbox is worse than a footer showing none — a
   customer would write to it. The pages omit what is missing; the moment
   the owner fills the box in Settings, it appears.
   ========================================================================= */

'use strict';

var respond = require('../_lib/respond');
var db = require('../_lib/supabase');
var Errors = require('../_lib/errors');

/* The same window api/categories.js uses, and for the same reason: this is
   the shop's own structure rather than its stock, every page asks for it,
   and it changes a few times in a shop's life.

   THE NUMBER IS SHORT ON PURPOSE
   A longer cache saves more and costs the owner their own change. Somebody
   who corrects a typo in the shop's phone number and then looks at the
   footer has to see the correction — not in eleven minutes, which is what a
   generous max-age plus a generous stale-while-revalidate adds up to, and
   long enough to be reported as the setting not saving. */
var CACHE = 'public, max-age=30, stale-while-revalidate=300';

module.exports = respond.handler(['GET'], async function (req, res) {
  var result = await db.asAdmin()
    .from('settings')
    .select('store')
    .eq('id', true)
    .maybeSingle();

  if (result.error) throw Errors.internal().causedBy(new Error(result.error.message));

  var store = (result.data && result.data.store) || {};

  res.setHeader('Cache-Control', CACHE);

  /* Named one at a time. See the note at the top: this list is the
     difference between "what the shop publishes" and "what the owner
     happened to store". */
  return {
    shop: {
      name: store.name || '',
      tagline: store.tagline || '',
      email: store.supportEmail || '',
      phone: store.phone || '',
      address: store.address || '',
      city: store.city || ''
    }
  };
});
