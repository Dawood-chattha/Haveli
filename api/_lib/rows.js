/* =========================================================================
   api/_lib/rows.js — writing rows, and knowing whether anything happened
   -------------------------------------------------------------------------
   THE PROBLEM THIS FILE EXISTS FOR

   An UPDATE or DELETE that Row Level Security refuses does not return an
   error. A policy's USING clause decides which rows the statement can SEE,
   and a row it cannot see is simply not part of the statement. So:

       update products set price = 1 where id = '<someone else's>'

   matches zero rows, changes nothing, and reports success. Postgres is
   behaving correctly — no rows needed changing — but to the code above it,
   "no error" is indistinguishable from "it worked".

   This was found in Phase 3 by a test that expected an error and did not get
   one. The security consequence is nil: nothing was written. The consequence
   for an endpoint is not. Without the check below, an administrator whose
   change was discarded by a policy is told it was saved, and finds out when
   the shop does not match the panel.

   The same shape catches a second case that is not about policies at all: an
   id that does not exist. That should be a 404, and without counting rows it
   is a 200.

   SO EVERY UPDATE AND DELETE IN THIS API GOES THROUGH HERE.
   `.select()` after a write makes PostgREST return the affected rows, and an
   empty array is the signal. Nothing is inferred from the absence of an
   error.
   ========================================================================= */

'use strict';

var Errors = require('./errors');
var log = require('./log');

/**
 * Run a PostgREST write that was built with `.select()` on the end, and
 * insist that it touched something.
 *
 * @param {string} what     for the 404 message — 'product', 'category'
 * @param {Promise} query   a supabase-js query with .select() applied
 * @returns the rows it wrote
 */
async function mustAffect(what, query) {
  var result = await query;

  if (result.error) {
    /* 23505 is a unique violation, which here always means a slug, code or
       SKU someone else already has. That is the caller's to fix, so it is a
       409 with a message rather than a 500 with none. */
    if (result.error.code === '23505') {
      throw Errors.conflict('Something with that name or code already exists.');
    }

    /* 23514 is a check constraint — a price below zero, a compare_at under
       the price, a status outside the allowed list. The database is the last
       line of that defence and validate.js should have caught it first, so
       reaching here is a gap worth logging. */
    if (result.error.code === '23514') {
      log.error('a check constraint rejected a write that validation allowed',
                new Error(result.error.message));
      throw Errors.badRequest('Some of those values are not allowed.');
    }

    /* 23503 is a foreign key — a category that does not exist, or a category
       still holding products when something tried to delete it. */
    if (result.error.code === '23503') {
      throw Errors.conflict('That refers to something which does not exist, ' +
                            'or is still in use.');
    }

    /* 42501 is insufficient_privilege: a policy refused the write outright,
       which for an INSERT it does rather than silently affecting no rows.
       Reaching here means requireAdmin let the caller through and the
       database did not — the two disagreeing about who this is. That is a
       bug on this side every time, so it is logged as one, and the caller
       is told the truth without the SQL. */
    if (result.error.code === '42501') {
      log.error('the database refused a write the endpoint allowed',
                new Error(result.error.message), { what: what });
      throw Errors.forbidden('You do not have access to this.');
    }

    throw Errors.internal().causedBy(new Error(result.error.message));
  }

  var rows = result.data || [];

  if (!rows.length) {
    /* Either there is no such row, or a policy refused this caller. The
       answer is the same on purpose: telling an outsider which of the two it
       was would confirm that a row exists. */
    throw Errors.notFound('That ' + what + ' no longer exists, or you may not change it.');
  }

  return rows;
}

/**
 * The same insistence for an insert, where an empty result means the row was
 * refused by a policy's WITH CHECK.
 */
async function mustInsert(what, query) {
  return mustAffect(what, query);
}

/**
 * Turn a title into a url-safe slug.
 *
 * Matches ZB.ui.slug in the frontend character for character, including
 * '&' becoming 'and' — so a category created in the panel gets the same slug
 * the storefront would have derived for it, and its URL does not change the
 * day the two are compared.
 */
function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * A slug nobody else in `table` is using.
 *
 * Appends -2, -3 and so on. The alternative — letting the unique index
 * reject it and asking the person to think of another name — is a worse
 * experience for something the server can simply resolve.
 *
 * `scope` narrows the search where uniqueness is scoped: categories are
 * unique per department, products globally.
 */
async function uniqueSlug(client, table, base, scope, ignoreId) {
  var slug = slugify(base) || 'item';

  for (var n = 1; n < 100; n++) {
    var candidate = n === 1 ? slug : slug + '-' + n;

    var q = client.from(table).select('id').eq('slug', candidate);
    if (scope) Object.keys(scope).forEach(function (k) { q = q.eq(k, scope[k]); });
    if (ignoreId) q = q.neq('id', ignoreId);

    var found = await q.limit(1);
    if (found.error) throw Errors.internal().causedBy(new Error(found.error.message));
    if (!found.data.length) return candidate;
  }

  /* A hundred products with the same name is not a case worth guessing at. */
  throw Errors.conflict('Too many items already share that name.');
}

/* -------------------------------------------------------------------------
   Paging

   ASKING FOR A PAGE THAT IS NOT THERE USED TO BE A 500
   PostgREST answers 416 "Requested range not satisfiable" when the offset is
   past the last row — not an empty list, an error — and every list endpoint
   turned that into "Something went wrong on our side."

   It stayed hidden for as long as the database had five hundred and sixty
   demo products in it, because nobody had ever asked for page two of a short
   list. The moment the placeholder catalogue was removed, page two of the
   products screen answered 500, and so would the orders screen on any day
   with few orders. The same would have happened on a live shop the first
   time an owner deleted enough products to shorten the list while looking at
   the last page of it.

   THE RIGHT ANSWER IS AN EMPTY PAGE WITH THE REAL TOTAL
   Empty, because there is genuinely nothing on that page — and the total,
   because that is what the pager needs in order to offer a page that does
   exist. Failing tells the screen nothing it can act on.

   WHY THE QUERY IS BUILT BY A FUNCTION
   A supabase-js query builder cannot be run twice, so recovering from the
   miss needs a second one carrying exactly the same filters. Taking a
   `build` function rather than a query is what makes "exactly the same"
   true by construction instead of by a comment asking someone to keep two
   places in step.
   ------------------------------------------------------------------------- */

function isRangeMiss(error) {
  if (!error) return false;
  return error.code === 'PGRST103' ||
         /range not satisfiable/i.test(error.message || '');
}

/**
 * One page of rows, plus the total the filters match.
 *
 * @param {function} build  Returns a FRESH, fully filtered and ordered query
 *                          each time it is called.
 */
async function paged(build, page, perPage) {
  var from = (page - 1) * perPage;
  var result = await build().range(from, from + perPage - 1);

  if (!result.error) {
    return { rows: result.data || [], total: result.count || 0 };
  }

  if (!isRangeMiss(result.error)) {
    throw Errors.internal().causedBy(new Error(result.error.message));
  }

  /* Past the end. limit(0) asks the same question with no rows attached: it
     is satisfiable whatever the table holds — including nothing — and the
     count that comes back is the real one under the same filters. */
  var counted = await build().limit(0);

  if (counted.error) {
    throw Errors.internal().causedBy(new Error(counted.error.message));
  }

  return { rows: [], total: counted.count || 0 };
}

module.exports = {
  mustAffect: mustAffect,
  mustInsert: mustInsert,
  slugify: slugify,
  uniqueSlug: uniqueSlug,
  paged: paged,
  isRangeMiss: isRangeMiss
};
