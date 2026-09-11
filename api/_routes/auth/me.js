/* =========================================================================
   api/auth/me.js — GET /api/auth/me
   -------------------------------------------------------------------------
   -> { user: { id, email, name, role, isAdmin } }  or  { user: null }

   Who the browser is, asked of the server. The page cannot answer this itself
   because the session is in a cookie it cannot read, which is the point of
   putting it there.

   A SIGNED-OUT VISITOR IS NOT AN ERROR
   This answers 200 with `user: null` rather than 401. Being signed out is the
   normal state of a shop's visitor, and a 401 would have every page treating
   an ordinary browse as a failure.

   IT REFRESHES A STALE SESSION
   Access tokens last an hour. Without this, someone signing in and going to
   make tea would come back signed out. When the access token no longer
   verifies, the refresh token is used to mint a new pair and the cookies are
   rewritten — so a session lasts as long as the refresh token, and the short
   life of the access token costs nobody anything.

   `role` HERE DECIDES WHAT IS DRAWN, NOT WHAT IS ALLOWED
   The admin panel asks this to know whether to render itself. That is a
   convenience, not a gate: someone who edits the answer in their own browser
   gets to look at an empty panel, because every admin endpoint checks the
   database and every RLS policy checks it again. Visiting /admin does not
   make anyone an administrator, and neither does lying to this endpoint.
   ========================================================================= */

'use strict';

var respond = require('../../_lib/respond');
var Cookies = require('../../_lib/cookies');
var auth = require('../../_lib/auth');
var db = require('../../_lib/supabase');
var log = require('../../_lib/log');

module.exports = respond.handler(['GET'], async function (req, res) {

  var user = await auth.currentUser(req);
  if (user) return { user: shape(user) };

  /* No usable access token. There may still be a refresh token, which is the
     ordinary state an hour after signing in. */
  var refresh = Cookies.refreshToken(req);
  if (!refresh) return { user: null };

  var anon = db.asUser({ headers: {} });

  var result;
  try {
    result = await anon.auth.refreshSession({ refresh_token: refresh });
  } catch (err) {
    log.error('refresh failed', err);
    Cookies.clear(req, res);
    return { user: null };
  }

  if (result.error || !result.data || !result.data.session) {
    /* The refresh token is spent, revoked or forged. Clearing both cookies
       matters: leaving a dead one behind means every future request pays for
       a refresh attempt that cannot succeed. */
    Cookies.clear(req, res);
    return { user: null };
  }

  Cookies.setSession(req, res, result.data.session);

  /* Re-asked with the new token rather than assembled from the refresh
     response, so the role and blocked flag are read fresh from the database.
     An account suspended during the old token's hour is suspended now. */
  var refreshed = await auth.currentUser({
    headers: { authorization: 'Bearer ' + result.data.session.access_token }
  });

  return { user: refreshed ? shape(refreshed) : null };
});

/* Only what a page needs to draw itself. `blocked` is not included: a blocked
   account cannot get here, since requireUser refuses it and currentUser is
   what this endpoint reports. */
function shape(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isAdmin: user.isAdmin
  };
}
