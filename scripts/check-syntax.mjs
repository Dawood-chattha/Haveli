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

     3. IGNORES    .env.local is genuinely ignored by git. A .gitignore rule
                   that looks right and does not match is indistinguishable
                   from a correct one until the day the file is committed.

   Exits non-zero if anything fails, so it can be a deploy gate later.
   ========================================================================= */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
   3. .env.local cannot be committed
   ------------------------------------------------------------------------- */

console.log('\n3. .env.local is ignored by git');

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
