/* =========================================================================
   api/health.js — is the backend alive, and is it configured
   -------------------------------------------------------------------------
   GET /api/health

   The first endpoint, and for now the only one. It proves four things at
   once, which is exactly what is worth proving before any real feature is
   built on top:

     1. Vercel is routing /api/* to a function rather than to index.html
     2. the function runtime starts and the shared lib files load
     3. the environment variables are present
     4. the Supabase project is reachable with the key it was given

   IT REPORTS LESS IN PRODUCTION, AND THAT IS THE POINT
   Locally it names every variable and says which are missing, because that
   is the fastest way to fix a setup. In production it answers only that it
   is alive. A public endpoint that lists your configuration — even as
   set/MISSING, with no values — tells an unwanted visitor which services
   you use and which of them are currently misconfigured. That is free
   reconnaissance, and there is no reason to give it away for the sake of a
   check that can be run from a preview deployment instead.

   IT IS ONE OF TWO ENDPOINTS THAT MAY RUN UNCONFIGURED
   Every other endpoint fails closed when a variable is missing. This one
   must not, or the only tool for diagnosing a missing variable would be
   disabled by the missing variable.
   ========================================================================= */

'use strict';

var respond = require('../_lib/respond');
var Env = require('../_lib/env');
var db = require('../_lib/supabase');

module.exports = respond.handler(['GET'], async function () {

  /* Public answer: alive, and nothing else. */
  if (Env.isProduction()) {
    return { status: 'ok', time: new Date().toISOString() };
  }

  var absent = Env.missing();

  /* Only worth asking when there is something to ask with. */
  var database = absent.length
    ? { reachable: false, reason: 'not configured' }
    : await db.ping();

  return {
    status: absent.length || !database.reachable ? 'degraded' : 'ok',
    time: new Date().toISOString(),

    runtime: {
      node: process.version,
      env: process.env.VERCEL_ENV || 'local'
    },

    /* Names and set/MISSING only. env.status() cannot return a value even
       if this endpoint were later changed to print everything it gets. */
    config: Env.status(),
    missing: absent,

    database: database
  };

}, { requireConfig: false });
