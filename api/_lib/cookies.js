/* =========================================================================
   api/_lib/cookies.js — where the session lives
   -------------------------------------------------------------------------
   THE SESSION IS IN A COOKIE THE PAGE CANNOT READ, NOT IN localStorage.

   The usual way to hold a Supabase session in a browser is localStorage. It is
   convenient and it is what the official client does by default, and this
   project does not do it. The reason is one line of the brief this backend was
   written to:

       "Store sensitive credentials in localStorage unnecessarily" — never.

   localStorage is readable by any JavaScript running on the page. That is the
   whole of the objection. One injected script — a compromised analytics
   snippet, a bad browser extension, an XSS hole anywhere in twenty thousand
   lines of frontend — and the access token can be read and sent elsewhere,
   and the attacker then IS that user for as long as the token lives.

   A cookie marked HttpOnly is not readable by JavaScript at all. The same
   injected script can still make requests as the user while the page is open,
   which is bad but bounded; what it cannot do is take the token away and use
   it later from somewhere else.

   THE FOUR ATTRIBUTES, AND WHY EACH ONE

     HttpOnly    script cannot read it. The reason for all of this.

     Secure      sent only over HTTPS, so it cannot be read off an open
                 network. Omitted on localhost, where there is no HTTPS and
                 setting it would mean the cookie is silently never stored —
                 which looks exactly like a broken login.

     SameSite=Lax
                 the browser will not attach this cookie to a POST that
                 another site made. That is CSRF defence, and it is why this
                 project needs no CSRF token: a form on someone else's page
                 that posts to /api/checkout arrives with no session at all.
                 Lax rather than Strict so that following a link into the site
                 still finds you signed in.

     Path=/      one session for the storefront and the panel, which are two
                 documents on one origin.

   WHY TWO COOKIES
   The access token is short-lived — an hour — and is what proves identity on
   each request. The refresh token is long-lived and can mint a new access
   token. They are separate so that the access token can expire on its own
   schedule without signing anyone out.
   ========================================================================= */

'use strict';

var ACCESS = 'zb_at';
var REFRESH = 'zb_rt';

/* A refresh token is the session. Thirty days is a shop's reasonable "keep me
   signed in"; the access token it mints still expires hourly. */
var REFRESH_MAX_AGE = 60 * 60 * 24 * 30;

/* Matches Supabase's own access token lifetime. The cookie outliving the token
   inside it would mean requests that look authenticated and are not. */
var ACCESS_MAX_AGE = 60 * 60;

function parse(header) {
  var out = {};
  if (!header) return out;

  header.split(';').forEach(function (part) {
    var eq = part.indexOf('=');
    if (eq < 0) return;

    var name = part.slice(0, eq).trim();
    var value = part.slice(eq + 1).trim();
    if (!name) return;

    try {
      out[name] = decodeURIComponent(value);
    } catch (e) {
      out[name] = value;   /* a value that was never encoded */
    }
  });

  return out;
}

function read(req, name) {
  return parse(req.headers && req.headers.cookie)[name] || '';
}

/**
 * Build one Set-Cookie value.
 *
 * `secure` follows the environment rather than being hard-coded either way.
 * Hard-coded true breaks local development in a way that is very hard to
 * diagnose — the browser accepts the response, discards the cookie, and the
 * next request is anonymous with no error anywhere. Hard-coded false would
 * ship a session that travels in clear text.
 */
function serialise(name, value, maxAge, secure) {
  var parts = [
    name + '=' + encodeURIComponent(value),
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=' + maxAge
  ];

  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function isSecureRequest(req) {
  if (process.env.VERCEL_ENV) return true;   /* every Vercel deployment is HTTPS */

  var proto = (req.headers && req.headers['x-forwarded-proto']) || '';
  return proto === 'https';
}

var Cookies = {

  ACCESS: ACCESS,
  REFRESH: REFRESH,

  parse: parse,
  accessToken: function (req) { return read(req, ACCESS); },
  refreshToken: function (req) { return read(req, REFRESH); },

  /** Write both cookies from a Supabase session. */
  setSession: function (req, res, session) {
    var secure = isSecureRequest(req);

    res.setHeader('Set-Cookie', [
      serialise(ACCESS, session.access_token, ACCESS_MAX_AGE, secure),
      serialise(REFRESH, session.refresh_token, REFRESH_MAX_AGE, secure)
    ]);
  },

  /**
   * Remove both.
   *
   * Max-Age=0 with the SAME attributes the cookie was set with. A browser
   * matches on name, domain and path, so a clear that forgets Path=/ leaves
   * the original in place and the user stays signed in after logging out.
   */
  clear: function (req, res) {
    var secure = isSecureRequest(req);

    res.setHeader('Set-Cookie', [
      serialise(ACCESS, '', 0, secure),
      serialise(REFRESH, '', 0, secure)
    ]);
  }
};

module.exports = Cookies;
