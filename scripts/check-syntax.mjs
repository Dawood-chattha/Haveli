/* =========================================================================
   scripts/check-syntax.mjs — the checks that run without a database
   -------------------------------------------------------------------------
   Run with:  npm run check

   Three checks. None of them needs Supabase, a network, or a filled-in
   .env.local, which is the point: they can be run on a fresh clone, before
   any credential exists, and they will still catch the mistakes that matter
   most.

     1. SYNTAX     Every file under api/ parses. A serverless function with
                   a typo does not fail at deploy — it fails on the first
                   request, in production, as a 500.

     2. SECRETS    No file the browser downloads mentions the service role
                   key or a private environment variable. This is the check
                   worth having: the single worst outcome in this project is
                   that key reaching a page, and it would reach it by
                   somebody pasting a line of server code into a frontend
                   file. This runs on every phase from here on.

     3. ROUTES     The route table in api/_routes/index.js names every file
                   under _routes and no others. The table is written by hand
                   on purpose — see the note at the top of it — and a list by
                   hand goes stale. An endpoint added without a line there
                   would answer 404 for a reason nothing else explains; one
                   left there after its file went would crash the whole API
                   on the first request, because the table is loaded as a
                   unit.

     4. IGNORES    .env.local is genuinely ignored by git. A .gitignore rule
                   that looks right and does not match is indistinguishable
                   from a correct one until the day the file is committed.

   Exits non-zero if anything fails, so it can be a deploy gate later.
   ========================================================================= */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

let failures = 0;
const fail = (msg) => { failures++; console.error('  FAIL  ' + msg); };
const pass = (msg) => console.log('  ok    ' + msg);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/* -------------------------------------------------------------------------
   1. Syntax
   ------------------------------------------------------------------------- */

console.log('\n1. api/ parses');

const apiFiles = walk(join(ROOT, 'api')).filter((f) => extname(f) === '.js');

if (!apiFiles.length) fail('no files found under api/');

for (const file of apiFiles) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    pass(relative(ROOT, file));
  } catch (err) {
    fail(relative(ROOT, file) + '\n' + String(err.stderr || err.message));
  }
}

/* -------------------------------------------------------------------------
   2. Secrets never reach the browser
   -------------------------------------------------------------------------
   Everything under assets/ and data/, plus the two HTML shells, is served
   verbatim to anyone who opens the site. Nothing in there may name a
   private variable — not in code, and not in a comment, because a comment
   is downloaded too.

   `.env.example` is exempt: it is a template of placeholder values, it is
   never served, and naming the variables is its entire job.
   ------------------------------------------------------------------------- */

console.log('\n2. no server secrets in files the browser downloads');

const BANNED = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'service_role',
  'SERVICE_ROLE',
  'process.env',

  /* Supabase's current key format. The old service role key was a JWT with
     "service_role" inside it, which the line above catches. The new one is
     an opaque string beginning sb_secret_ and contains no such word, so it
     needs its own rule — a scan that only knew the old format would pass a
     file with the new key sitting in it. */
  'sb_secret_'
];

const shipped = [
  ...walk(join(ROOT, 'assets')),
  ...walk(join(ROOT, 'data')),
  join(ROOT, 'index.html'),
  join(ROOT, 'admin', 'index.html')
].filter((f) => ['.js', '.html', '.css'].includes(extname(f)) && existsSync(f));

let leaks = 0;
for (const file of shipped) {
  const text = readFileSync(file, 'utf8');
  for (const needle of BANNED) {
    if (text.includes(needle)) {
      fail(relative(ROOT, file) + ' contains "' + needle + '"');
      leaks++;
    }
  }
}
if (!leaks) pass(shipped.length + ' files scanned, none mention a server secret');

/* -------------------------------------------------------------------------
   3. The route table matches the files
   -------------------------------------------------------------------------
   api/[...route].js serves every endpoint from one table, and the table is
   a literal list of requires rather than a directory scan — because Vercel
   bundles a function by tracing the requires it can SEE, and a path computed
   at runtime is invisible to that. A scanned route would work perfectly here
   and be missing from the deployment.

   The cost of writing it out is that it can drift from the files beside it.
   This is what stops that drift reaching a deployment.
   ------------------------------------------------------------------------- */

console.log('\n3. the route table names every endpoint');

{
  const routesDir = join(ROOT, 'api', '_routes');

  /* The key a file answers to: its path under _routes, without .js, and
     without a trailing /index — the same two rules the table is written by. */
  const onDisk = walk(routesDir)
    .filter((file) => extname(file) === '.js')
    .map((file) => relative(routesDir, file).split(sep).join('/'))
    .filter((rel) => rel !== 'index.js')
    .map((rel) => rel.replace(/\.js$/, '').replace(/\/index$/, ''))
    .sort();

  let table = null;

  try {
    /* Required rather than parsed. Loading it is also the check that every
       endpoint it names parses and can be constructed — which is the failure
       that would otherwise wait for the first request in production. */
    table = createRequire(import.meta.url)(join(routesDir, 'index.js'));
  } catch (err) {
    fail('api/_routes/index.js could not be loaded\n' + String(err.message));
  }

  if (table) {
    const listed = Object.keys(table).sort();

    const missing = onDisk.filter((key) => listed.indexOf(key) === -1);
    const extra = listed.filter((key) => onDisk.indexOf(key) === -1);

    if (missing.length) {
      fail('these endpoints exist but are not in the table, so they would ' +
           'answer 404:\n        ' + missing.join('\n        '));
    }

    if (extra.length) {
      fail('the table names these and there is no such file:\n        ' +
           extra.join('\n        '));
    }

    if (!missing.length && !extra.length) {
      pass(listed.length + ' endpoints, all present and all listed');
    }

    /* A table entry that is not a function would pass the name check and
       fail on the first request instead. */
    const notCallable = listed.filter((key) => typeof table[key] !== 'function');

    if (notCallable.length) {
      fail('these do not export a handler:\n        ' + notCallable.join('\n        '));
    } else if (listed.length) {
      pass('every one of them exports a handler');
    }
  }
}

/* -------------------------------------------------------------------------
   4. .env.local cannot be committed
   ------------------------------------------------------------------------- */

console.log('\n4. .env.local is ignored by git');

try {
  execFileSync('git', ['check-ignore', '-q', '.env.local'], { cwd: ROOT, stdio: 'pipe' });
  pass('.env.local is ignored');
} catch {
  fail('.env.local is NOT ignored by git — fix .gitignore before adding any key');
}

/* ------------------------------------------------------------------------- */

console.log('');
if (failures) {
  console.error(failures + ' check(s) failed\n');
  process.exit(1);
}
console.log('all checks passed\n');
