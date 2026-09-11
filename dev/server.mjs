/* =========================================================================
   dev/server.mjs — the whole site, locally, in one process
   -------------------------------------------------------------------------
   Run with:  npm run dev

   WHY THIS EXISTS ALONGSIDE `vercel dev`
   `vercel dev` is the authoritative local runtime and it is what production
   actually is. It also requires a Vercel account, a signed-in CLI and a
   linked project before it will serve a single byte. That is a reasonable
   thing to set up once, and an unreasonable thing to require before anyone
   can see whether a sign-in form works.

   This serves the same three things `vercel.json` describes:

     /api/*     handed to api/[...route].js, the same dispatcher Vercel runs
     files      assets/, data/, dev/, admin/ served from disk
     anything   else falls through to index.html, which is what makes the
                storefront's client-side routes survive a refresh

   It is a development tool and says so: it binds to localhost, it has no
   caching, and nothing about it ships. Where its behaviour and Vercel's could
   differ — cookie security, the production/preview flag — it follows Vercel
   rather than inventing its own answer, so that something working here is
   evidence about there.
   ========================================================================= */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const API_DIR = join(ROOT, 'api');
const require = createRequire(import.meta.url);
const PORT = Number(process.env.PORT || 3000);

/* -------------------------------------------------------------------------
   The security headers, read from vercel.json rather than written again

   WHY THEY ARE APPLIED HERE AT ALL
   A Content-Security-Policy that has never been loaded in a browser is a
   guess. The failure mode is specific and ugly: the policy is correct in
   every way except one — a font host missing, a stylesheet blocked — and the
   site looks broken in production while looking perfect on the machine it was
   written on, because nothing locally was enforcing anything.

   So this reads the policy out of vercel.json and sends it with every file it
   serves. The browser then enforces it during development, and a rule that
   would have broken the site breaks it here instead, where it costs a
   refresh.

   WHY IT IS READ AND NOT COPIED
   Two copies of a policy are two policies. The one in vercel.json is the one
   that ships, so it is the one this reads; if they ever disagreed, the
   disagreement would be exactly the thing this exists to catch.

   WHAT IS IN THE POLICY, AND THE ONE CONCESSION IN IT

     script-src 'self'        No inline script, no external script, no eval.
                              This is the rule that matters most, and the site
                              already satisfies it: there is not one inline
                              <script> or on* attribute in either document.

     style-src ... 'unsafe-inline'
                              The concession. The interface sets style="--d:.06s"
                              and similar on elements it builds — reveal delays,
                              carousel offsets, chart bars — in roughly a dozen
                              files. Removing them means rewriting working UI,
                              which this project does not do without being
                              asked, and an inline STYLE is a far smaller thing
                              than an inline script: it can restyle a page, not
                              run code or read a session.

     img-src ... https:       Deliberately open. The owner can paste a picture's
                              address into the product form, from wherever the
                              picture happens to live, and a policy that
                              silently blanked those images would look like a
                              broken panel. An image cannot execute; the value
                              of restricting this is small and the cost of
                              getting it wrong is the shop's own photographs.

     connect-src 'self'       Everything the browser fetches is /api on the
                              same origin. It never talks to Supabase directly,
                              which is the whole reason the session can live in
                              a cookie the page cannot read.

   There is deliberately no upgrade-insecure-requests. Every deployment is
   HTTPS and Strict-Transport-Security says so; adding a directive whose only
   job is rewriting http:// would mean the policy behaves differently here from
   the way it behaves in production, for no gain.
   ------------------------------------------------------------------------- */

const SECURITY_HEADERS = (() => {
  const config = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));

  /* The one block that covers the documents and the assets — the same one
     that skips /api, which sets its own headers in api/_lib/respond.js. */
  const block = (config.headers || [])
    .filter((h) => typeof h.source === 'string' && h.source.includes('api/'))[0];

  return block ? block.headers : [];
})();

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.sql': 'text/plain; charset=utf-8'
};

/* Paths served from disk. Everything else is a client-side route. This is the
   same list as the negative lookahead in vercel.json, and the two must stay in
   step — a path that resolves here and not there is a bug that only appears
   after deploying.

   Written without trailing slashes, and matched as "this exactly, or this
   followed by a slash". The first version listed 'admin/' and compared with
   startsWith, so /admin — no slash, the address the panel is actually reached
   at — matched nothing and fell through to the storefront, which answered
   with its own 404 page. vercel.json has a separate rule for the bare /admin
   for the same reason. */
const PASSTHROUGH = ['assets', 'data', 'dev', 'admin', 'favicon.ico'];

/* -------------------------------------------------------------------------
   API
   ------------------------------------------------------------------------- */

/**
 * Load the dispatcher — the same one Vercel runs.
 *
 * THIS SERVER USED TO HAVE A ROUTER OF ITS OWN
 * It resolved /api/admin/products/42 to admin/products/[id].js by looking at
 * the filesystem, which is what Vercel did too, and the two agreed because
 * somebody kept them agreeing. That was one router too many: a path that
 * worked here and 404'd in production would have been a bug with no symptom
 * until after a deployment.
 *
 * There is one router now, in api/[...route].js, and this calls it. What runs
 * on a laptop is the code that runs on the internet, including the part that
 * decides which endpoint a request belongs to.
 *
 * RELOADED ON EVERY REQUEST, WHICH IS THIS SERVER'S WHOLE PURPOSE
 * Emptying require.cache of everything under api/ is what makes an edit
 * visible without a restart, and it has to be everything: a change to
 * api/_lib/shape.js is invisible otherwise. The dispatcher requires the route
 * table, the table requires all thirty-seven endpoints, and every one of them
 * comes back fresh.
 *
 * That is exactly the wrong thing to do in production — Vercel loads each
 * module once per instance and keeps it — and exactly the right thing in a
 * server that is restarted all day.
 */
function loadDispatcher() {
  for (const cached of Object.keys(require.cache)) {
    if (cached.startsWith(API_DIR)) delete require.cache[cached];
  }

  return require(join(API_DIR, '[...route].js'));
}

/**
 * Read the request body the way Vercel's Node runtime does.
 *
 * JSON becomes an object, text stays a string, and ANYTHING ELSE STAYS A
 * BUFFER. That last part is not a detail: this used to decode every body as
 * UTF-8, which is correct for JSON and destroys an image. A photograph
 * arrived at the upload endpoint already corrupted, and the only sign was
 * that the file it stored would not open.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;

      /* A little above what the upload endpoint accepts, so an oversized
         file is refused by that endpoint with a sentence rather than by
         this one with a dropped connection. */
      if (size > 5 * 1024 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      if (!buffer.length) return resolve(undefined);

      const type = req.headers['content-type'] || '';

      if (type.includes('application/json')) {
        const raw = buffer.toString('utf8');
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve(raw);           /* let validate.js produce the error */
        }
        return;
      }

      if (type.startsWith('text/') || type.includes('x-www-form-urlencoded')) {
        resolve(buffer.toString('utf8'));
        return;
      }

      resolve(buffer);
    });

    req.on('error', reject);
  });
}

/* -------------------------------------------------------------------------
   Static
   ------------------------------------------------------------------------- */

async function sendFile(res, file) {
  const body = await readFile(file);
  res.statusCode = 200;
  res.setHeader('Content-Type', TYPES[extname(file).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');

  /* The same headers Vercel will add in front of these files. See the note
     above SECURITY_HEADERS for why they are sent by a development server. */
  for (const header of SECURITY_HEADERS) res.setHeader(header.key, header.value);

  res.end(body);
}

/* -------------------------------------------------------------------------
   The server
   ------------------------------------------------------------------------- */

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);

  /* Anything that climbs out of the project is refused before it is resolved.
     `normalize` collapses ../ so the check cannot be walked around with an
     encoded or doubled segment. */
  const safe = normalize(pathname).replace(/\\/g, '/');
  if (safe.includes('..')) {
    res.statusCode = 400;
    res.end('Bad path');
    return;
  }
  pathname = safe;

  const started = Date.now();
  const log = (status, note) =>
    console.log('  ' + String(status) + '  ' + req.method.padEnd(6) + pathname +
                '  ' + (Date.now() - started) + 'ms' + (note ? '  ' + note : ''));

  /* ---- /api/* ---- */

  if (pathname === '/api' || pathname.startsWith('/api/')) {
    let handler;

    try {
      handler = loadDispatcher();
    } catch (err) {
      /* A route file with a syntax error, or a table naming one that is not
         there. Worth saying loudly and precisely: the alternative is every
         endpoint answering 500 with the reason only in this window. */
      console.error('  !! the API could not be loaded:', err.message);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, error: { code: 'server_error', message: 'The API could not be loaded.' } }));
      log(500);
      return;
    }

    try {
      req.body = await readBody(req);
    } catch {
      res.statusCode = 413;
      res.end(JSON.stringify({ ok: false, error: { code: 'too_large', message: 'That request was too large.' } }));
      log(413);
      return;
    }

    /* Only the query string. The dispatcher adds any dynamic path segment on
       top of it, exactly as it does on Vercel — and resolves a clash the same
       way, so /api/admin/products/42?id=99 is about product 42 in both
       places. Everything about that decision now lives in one file. */
    req.query = Object.fromEntries(url.searchParams.entries());

    try {
      await handler(req, res);
    } catch (err) {
      /* respond.handler catches its own; anything here is the wrapper itself
         failing, which is worth seeing loudly rather than as a blank reply. */
      console.error('  !! endpoint threw outside the wrapper:', err);
      if (!res.writableEnded) {
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: { code: 'server_error', message: 'Something went wrong.' } }));
      }
    }

    log(res.statusCode);
    return;
  }

  /* ---- files ---- */

  const rel = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  const isFile = PASSTHROUGH.some((p) => rel === p || rel.startsWith(p + '/'));

  if (isFile) {
    try {
      /* /admin and /admin/anything are the panel's shell, matching the
         rewrite in vercel.json. */
      if (rel === 'admin' || rel.startsWith('admin/')) {
        const asFile = join(ROOT, rel);
        const info = await stat(asFile).catch(() => null);

        if (!info || info.isDirectory()) {
          await sendFile(res, join(ROOT, 'admin', 'index.html'));
          log(200, '-> admin/index.html');
          return;
        }
      }

      await sendFile(res, join(ROOT, rel));
      log(200);
      return;
    } catch {
      res.statusCode = 404;
      res.end('Not found');
      log(404);
      return;
    }
  }

  /* ---- everything else is a storefront route ---- */

  await sendFile(res, join(ROOT, 'index.html'));
  log(200, '-> index.html');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('\n  HAVELI — storefront, admin panel and API');
  console.log('  http://localhost:' + PORT);
  console.log('  http://localhost:' + PORT + '/admin');
  console.log('  http://localhost:' + PORT + '/api/health');
  console.log('\n  Ctrl+C to stop\n');
});
