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

     /api/*     the serverless functions, imported and called directly
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
import { readdirSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const API_DIR = join(ROOT, 'api');
const require = createRequire(import.meta.url);
const PORT = Number(process.env.PORT || 3000);

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
 * Find the file that serves a path, the way Vercel does.
 *
 * Three shapes, tried in this order:
 *
 *   /api/catalogue            api/catalogue.js
 *   /api/admin/products       api/admin/products/index.js
 *   /api/admin/products/42    api/admin/products/[id].js   -> params.id = '42'
 *
 * Order matters. A literal file wins over a dynamic one, so an endpoint
 * called /api/admin/products/export would be served by export.js if it
 * existed, rather than being swallowed by [id].js and arriving as a product
 * id of "export".
 *
 * Only the last segment is matched dynamically, which is all this API needs.
 * Vercel supports a bracket at any depth; adding that here before something
 * uses it would be inventing a requirement.
 */
async function resolveEndpoint(pathname) {
  const rel = pathname.replace(/^\/+/, '').replace(/\/+$/, '');

  /* An underscore prefix marks a shared module, not a route — the same rule
     Vercel applies, restated here so /api/_lib/env cannot be fetched. */
  if (rel.split('/').some((part) => part.startsWith('_'))) return null;

  const exists = async (f) => {
    try { return (await stat(f)).isFile(); } catch { return false; }
  };

  const candidates = [
    { file: join(ROOT, rel + '.js'), params: {} },
    { file: join(ROOT, rel, 'index.js'), params: {} }
  ];

  const parts = rel.split('/');
  if (parts.length > 1) {
    const last = parts.pop();
    const dir = join(ROOT, parts.join('/'));

    /* Which bracket file is present is discovered rather than assumed, so
       [id].js and [slug].js both work and the parameter is named by the
       file that claimed it. */
    let names = [];
    try {
      names = readdirSync(dir).filter((n) => /^\[[^\]]+\]\.js$/.test(n));
    } catch { /* no such directory */ }

    for (const name of names) {
      const param = name.slice(1, -4).replace(/\]$/, '');
      candidates.push({ file: join(dir, name), params: { [param]: last } });
    }
  }

  for (const candidate of candidates) {
    if (await exists(candidate.file)) return candidate;
  }
  return null;
}

/**
 * Import a function module fresh on every request.
 *
 * THE QUERY STRING ALONE DOES NOT DO THIS, AND LOOKED LIKE IT DID
 * `?t=` busts the ES module cache. Every endpoint here is CommonJS, because
 * the site's own .js files are and package.json has no "type": "module" to
 * say otherwise — and the CommonJS loader resolves by filename and ignores
 * the query entirely. So an edited endpoint kept serving its old code, and
 * the way that surfaced was a bug fix that changed nothing followed by a
 * test that failed identically twice.
 *
 * Emptying require.cache of everything under api/ is what actually reloads
 * it, and it has to be everything rather than just the endpoint: a change to
 * api/_lib/shape.js is exactly as invisible otherwise.
 *
 * Both caches leak a little per request. That matters in a long-running
 * server and does not in one that is restarted all day.
 */
async function loadEndpoint(file) {
  for (const cached of Object.keys(require.cache)) {
    if (cached.startsWith(API_DIR)) delete require.cache[cached];
  }

  const mod = await import(pathToFileURL(file).href + '?t=' + Date.now());
  return mod.default || mod;
}

/**
 * Read and parse a JSON body, the way Vercel's Node runtime does, so that
 * `req.body` is an object by the time an endpoint sees it.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      /* A body this large is not something any endpoint here accepts, and
         reading it would only be a way to exhaust memory. */
      if (size > 2 * 1024 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(undefined);

      const type = req.headers['content-type'] || '';
      if (type.includes('application/json')) {
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve(raw);           /* let validate.js produce the error */
        }
        return;
      }
      resolve(raw);
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
    const found = await resolveEndpoint(pathname);
    const handler = found ? await loadEndpoint(found.file) : null;

    if (!handler) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, error: { code: 'not_found', message: 'No such endpoint.' } }));
      log(404);
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

    /* Vercel gives endpoints one object holding both the query string and
       any dynamic path segment, so an endpoint reads req.query.id whether
       the id arrived in the path or after a ?. The path wins: a request for
       /api/admin/products/42?id=99 is about product 42. */
    req.query = { ...Object.fromEntries(url.searchParams.entries()), ...found.params };

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
