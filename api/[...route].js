/* =========================================================================
   api/[...route].js — the only serverless function this project deploys
   -------------------------------------------------------------------------
   Every /api/... request arrives here and is handed to the endpoint that
   owns it. The endpoints themselves are unchanged: same files, same
   handlers, same URLs, same answers. What changed is who does the routing.

   WHY

   Vercel makes one serverless function per file under api/, which is a good
   arrangement until the count matters. This shop has thirty-seven endpoints
   and the plan it runs on allows twelve, so the deployment was refused before
   a line of it ran.

   Thirty-seven was never thirty-seven programs. It was one API answering on
   thirty-seven paths, and the split was a file layout rather than a design.
   So the files moved under _routes — which Vercel ignores, because of the
   underscore — and this stands in front of them.

   THE ROUTING IS THE SAME ROUTING, DELIBERATELY

   Three shapes, tried in this order, which is what Vercel's own file-system
   routing does and what dev/server.mjs has always done:

     /api/catalogue            catalogue.js
     /api/admin/products       admin/products/index.js
     /api/admin/products/42    admin/products/[id].js   -> req.query.id = '42'

   Order matters. A literal path wins over a bracket, so an endpoint at
   /api/admin/products/export would be served by export.js if one existed
   rather than arriving at [id].js as a product called "export".

   Keeping the rules identical is the point. Three routers that mostly agree
   — Vercel's, the dev server's and this one — would be three chances for a
   path to work locally and 404 in production. There are now two, they are
   written from the same table in api/_routes/index.js, and the table is
   checked against the files on disk by scripts/check-syntax.mjs.

   WHAT THIS DOES NOT DO

   It does not authenticate, authorise, validate, log or shape anything. Every
   one of those still happens inside the endpoint, behind respond.handler, and
   underneath all of it Row Level Security decides what the database will
   actually hand over. A dispatcher that started making decisions would be a
   new place for a permission to be granted by accident, so it makes none: it
   finds a handler or it answers 404.
   ========================================================================= */

'use strict';

var respond = require('./_lib/respond');
var Errors = require('./_lib/errors');
var routes = require('./_routes/index');

/* Built once per instance rather than per request. The keys never change —
   the table is a literal object in a file — so the work of splitting them is
   done at cold start and shared by every request that instance serves. */
var TABLE = (function () {
  var exact = {};
  var dynamic = {};

  Object.keys(routes).forEach(function (key) {
    var match = key.match(/^(.*?)\/?\[([^\]]+)\]$/);

    if (!match) {
      exact[key] = routes[key];
      return;
    }

    /* 'admin/products/[id]' -> parent 'admin/products', parameter 'id'.
       A parent can hold only one bracket, which is what a directory can hold
       too — the file name IS the parameter name. */
    dynamic[match[1]] = { param: match[2], handler: routes[key] };
  });

  return { exact: exact, dynamic: dynamic };
}());

/**
 * The path this request is for, with /api and any query string removed.
 *
 * Taken from the URL rather than from req.query.route. The catch-all
 * parameter is the platform's own decoded copy and would do, but the URL is
 * what actually arrived — and one source is easier to reason about than two
 * that are nearly the same.
 */
function pathOf(req) {
  var raw = String(req.url || '');
  var cut = raw.indexOf('?');
  var path = cut > -1 ? raw.slice(0, cut) : raw;

  var decoded;
  try {
    decoded = decodeURIComponent(path);
  } catch (e) {
    /* A path that is not valid percent-encoding is not a path this API has.
       Returning it undecoded lets the lookup below fail normally. */
    decoded = path;
  }

  return decoded.replace(/^\/+/, '').replace(/^api\/?/, '').replace(/\/+$/, '');
}

/**
 * Find the handler for a path, and the parameter it carries.
 *
 * Returns { handler, params } or null.
 */
function resolve(path) {
  if (!path) return null;

  /* THE UNDERSCORE RULE, RESTATED HERE
     Vercel refuses to serve a path with an underscore-prefixed segment, which
     is what keeps api/_lib/env out of a browser's reach. That rule was the
     platform's to enforce while the platform was doing the routing. It is
     this file's now, and it is enforced before the lookup rather than trusted
     to the fact that no key in the table happens to start with one. */
  var segments = path.split('/');

  for (var i = 0; i < segments.length; i++) {
    if (segments[i].charAt(0) === '_' || segments[i] === '..') return null;
  }

  if (Object.prototype.hasOwnProperty.call(TABLE.exact, path)) {
    return { handler: TABLE.exact[path], params: {} };
  }

  if (segments.length < 2) return null;

  var last = segments[segments.length - 1];
  var parent = segments.slice(0, -1).join('/');

  var found = Object.prototype.hasOwnProperty.call(TABLE.dynamic, parent)
    ? TABLE.dynamic[parent]
    : null;

  if (!found) return null;

  var params = {};
  params[found.param] = last;

  return { handler: found.handler, params: params };
}

module.exports = async function (req, res) {
  var hit = resolve(pathOf(req));

  if (!hit) {
    /* respond.fail writes the same envelope every other refusal uses, so a
       missing endpoint reads the same way as any other error rather than
       being the one answer shaped differently. The security headers go on
       first, because a 404 is a response like any other. */
    respond.securityHeaders(res);
    respond.fail(res, Errors.notFound('There is no endpoint at that address.'));
    return;
  }

  /* THE PARAMETER GOES WHERE THE HANDLER ALREADY LOOKS
     Endpoints read an id through validate.query(req), which reads req.query —
     because that is where Vercel's own dynamic routing used to put it. So it
     goes there, merged over whatever the query string carried.

     The path parameter wins on a clash. /api/admin/products/42?id=99 is a
     request about product 42, and letting a query string rename the row being
     edited would be a way of editing one thing while appearing to edit
     another. dev/server.mjs has always resolved the clash the same way. */
  var query = {};
  var source = req.query || {};

  Object.keys(source).forEach(function (key) {
    /* The catch-all's own parameter is routing machinery, not input. Leaving
       it in would hand every endpoint a `route` field it never asked for. */
    if (key !== 'route') query[key] = source[key];
  });

  Object.keys(hit.params).forEach(function (key) { query[key] = hit.params[key]; });

  req.query = query;

  return hit.handler(req, res);
};
