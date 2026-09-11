/* =========================================================================
   api/admin/uploads.js
   -------------------------------------------------------------------------
   POST /api/admin/uploads?for=products
   POST /api/admin/uploads?for=banners

   The request body is the file itself — raw bytes, with the picture's own
   type in the Content-Type header. The answer is the URL it now lives at.

   WHY THE BODY IS THE FILE AND NOT A FORM
   A multipart form is what a browser sends by default, and reading one means
   a parser: either a dependency this project does not have, or a hundred
   lines of boundary-splitting written here and got subtly wrong. Sending the
   bytes on their own needs neither. `fetch(url, { method: 'POST', body:
   file })` is one line in the panel and sets the Content-Type from the file.

   WHY THE UPLOAD GOES THROUGH THE SERVER AT ALL
   Supabase Storage would take a file straight from the browser. Doing that
   means the browser holds a key that may write to the bucket, and the anon
   key is public — printed in every request anyone can read in a network
   tab. So the write happens here, as the caller, and the bucket's own policy
   in db/storage.sql asks public.is_admin() about them. Neither check is
   decorative: requireAdmin gives a clear refusal, and the policy is what
   holds if this file is ever wrong.

   WHAT IS CHECKED, AND WHY EACH ONE
   The type, because "image/jpeg" in a header is a claim, and the first bytes
   of the file are the evidence. The size, because a serverless function
   refuses a body over about four and a half megabytes and an upload that
   large would fail somewhere unhelpful. The name, because this file decides
   it — a name from the caller is a path from the caller.
   ========================================================================= */

'use strict';

var crypto = require('crypto');

var respond = require('../../_lib/respond');
var validate = require('../../_lib/validate');
var auth = require('../../_lib/auth');
var db = require('../../_lib/supabase');
var Env = require('../../_lib/env');
var Errors = require('../../_lib/errors');
var log = require('../../_lib/log');

var BUCKET = 'shop-images';

/* Four megabytes. db/storage.sql says at length why this number and not a
   rounder one: Vercel refuses a larger body before the function runs. */
var MAX_BYTES = 4 * 1024 * 1024;

/* Where each kind of picture is filed. A fixed list rather than a folder
   name from the request: a caller who can choose the path can choose to
   write over something. */
var FOLDERS = { products: 'products', banners: 'banners' };

/**
 * What a file actually is, from its first bytes.
 *
 * The Content-Type header says what the browser thinks it is sending, which
 * is a claim by whoever made the request. These signatures are the file
 * itself. They agree almost always; when they do not, something is wrong
 * that is worth refusing rather than storing.
 */
var SIGNATURES = [
  { type: 'image/jpeg', ext: 'jpg',
    test: function (b) { return b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF; } },

  { type: 'image/png', ext: 'png',
    test: function (b) {
      return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 &&
             b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A;
    } },

  /* RIFF....WEBP — the four bytes at 8 are what tell a WebP from any other
     RIFF container. */
  { type: 'image/webp', ext: 'webp',
    test: function (b) {
      return b.length > 12 &&
             b.toString('ascii', 0, 4) === 'RIFF' &&
             b.toString('ascii', 8, 12) === 'WEBP';
    } }
];

function identify(buffer) {
  if (!buffer || buffer.length < 12) return null;

  for (var i = 0; i < SIGNATURES.length; i++) {
    if (SIGNATURES[i].test(buffer)) return SIGNATURES[i];
  }
  return null;
}

module.exports = respond.handler(['POST'], async function (req) {
  await auth.requireAdmin(req);

  var v = validate.query(req);
  var kind = v.oneOf('for', Object.keys(FOLDERS), { optional: true, fallback: 'products' });
  v.done();

  var body = req.body;

  /* A string here means something upstream decoded the bytes — see
     readBody in dev/server.mjs, where exactly that used to happen and
     corrupted every image silently. */
  if (typeof body === 'string') {
    log.error('the upload arrived decoded rather than as bytes',
              new Error('content-type: ' + (req.headers['content-type'] || 'none')));
    throw Errors.internal();
  }

  if (!Buffer.isBuffer(body) || !body.length) {
    throw Errors.badRequest('No file arrived. Choose a picture and try again.');
  }

  if (body.length > MAX_BYTES) {
    throw Errors.badRequest('That picture is larger than 4 MB. Save it smaller and try again.');
  }

  var found = identify(body);

  if (!found) {
    throw Errors.badRequest('That file is not a JPEG, PNG or WebP image.');
  }

  /* The name is decided here, from random bytes, and the extension comes
     from what the file turned out to be rather than from what it was
     called. Nothing a caller sent reaches the path. */
  var path = FOLDERS[kind] + '/' + crypto.randomUUID() + '.' + found.ext;

  /* As the caller, so the bucket's own policy applies as a second opinion.
     See the note at the top. */
  var client = db.asUser(req);

  var written = await client.storage.from(BUCKET).upload(path, body, {
    contentType: found.type,

    /* A fresh random name every time, so there is nothing to overwrite.
       Allowing it would turn a repeated request into a way to replace a
       picture that is already on the shop's pages. */
    upsert: false
  });

  if (written.error) {
    var message = written.error.message || '';

    /* The bucket is created by db/storage.sql. Saying so plainly is worth
       more than a generic failure, because until it is run every upload
       fails the same way. */
    if (/bucket not found/i.test(message)) {
      log.error('the shop-images bucket is missing — db/storage.sql has not been run',
                new Error(message));
      throw Errors.unavailable('Pictures cannot be saved just now.');
    }

    if (/row-level security|not authorized|violates/i.test(message)) {
      log.error('storage refused an upload the endpoint allowed', new Error(message));
      throw Errors.forbidden('You do not have access to this.');
    }

    throw Errors.internal().causedBy(new Error(message));
  }

  /* The public URL is built rather than asked for: getPublicUrl does string
     concatenation too, and doing it here keeps the shape visible next to the
     bucket name it depends on. */
  var url = Env.supabaseUrl().replace(/\/+$/, '') +
            '/storage/v1/object/public/' + BUCKET + '/' + path;

  return {
    url: url,
    path: path,
    type: found.type,
    bytes: body.length
  };
});
