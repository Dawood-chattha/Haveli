# HAVELI — backend

The site itself is unchanged: static HTML, CSS and JavaScript with no build
step and no framework. This document covers only the serverless functions
under `api/`, which were added in Phase 1 and are the seam through which a
real database will arrive.

---

## What exists today

One endpoint, `GET /api/health`, and the shared modules it is built on. There
is no database, no authentication and no business logic yet — those are Phases
2 and 3. Phase 1 built the floor they stand on.

```
api/
  health.js          the only endpoint
  _lib/
    env.js           the only file that reads process.env
    supabase.js      two database clients, and the rule for choosing
    auth.js          who is calling
    respond.js       one response shape, plus CORS and the catch-all
    errors.js        one error type, two audiences
    validate.js      input checking
    log.js           logging, with redaction
scripts/
  check-syntax.mjs   the checks that run without a database
```

Anything under `api/_lib/` is a shared module, not a route: Vercel does not
publish a path beginning with an underscore.

---

## Running it

### The site on its own — unchanged

```bash
npm run static
```

The existing PowerShell server on <http://localhost:8123>. It serves the
storefront and the panel exactly as before and knows nothing about `api/`.
Nothing about this was modified in Phase 1.

### The site plus the API

```bash
npm run dev
```

`vercel dev` on <http://localhost:3000>. It serves the same static files,
honours `vercel.json`, and additionally runs the functions. This needs a
Vercel account and will ask you to sign in and link the folder the first time.

If you would rather not link a Vercel project yet, `npm run check` below
verifies everything that can be verified without one.

### The database

`db/schema.sql` is applied once, by hand, in the Supabase SQL editor — DDL
cannot travel over the REST API, so there is no script for it. It is written to
be re-runnable: applying it again repairs rather than fails.

```bash
npm run seed              # categories only — the shop's real structure
npm run seed:demo         # + 560 placeholder products, images, banners
npm run seed:demo:remove  # removes exactly those, nothing else
npm run seed:dry          # shape every row and check it, write nothing
npm run verify:db         # prove the schema, RLS and constraints are real
```

**`seed` and `seed:demo` are not the same thing, and the difference matters.**
The products the site displays today are placeholders built to design the
interface against; the shop's real products are entered by its owner through
the admin panel. Loading several hundred invented products into a live database
would hand that owner a catalogue to empty by hand before they could trade.

Demo rows exist so Phase 4 can be tested against something — an empty catalogue
proves nothing about whether the UI is correctly connected. Every demo row's id
is derived from its name, so `seed:demo:remove` deletes precisely the rows the
script created and cannot touch a product added through the panel.

Orders, customers, carts, addresses, coupons and payments are never seeded in
either mode. Those record things that actually happened, and inventing them
would put figures on the reports screen that someone might believe.

### The checks

```bash
npm run check
```

Three things, none of which need a database, a network or a filled-in
`.env.local`:

1. every file under `api/` parses
2. no file the browser downloads mentions a server secret
3. `.env.local` is genuinely ignored by git

Run this before every commit from here on. Check 2 is the one that matters:
the worst possible outcome in this project is the service role key reaching a
page, and this is what would catch it.

---

## Configuration

```bash
cp .env.example .env.local
```

Then fill in the copy from the Supabase dashboard, under **Project Settings →
API**. `.env.example` documents every variable and what it is for.

In production the same values go in the Vercel dashboard under **Settings →
Environment Variables** — never into a file, and never into the repository.

`GET /api/health` will tell you which variables are still missing.

---

## The rules this backend is built on

These are not style preferences. Each one is a decision that a later phase
depends on, and reversing any of them quietly is how a security bug arrives.

### The service role key is the most dangerous value in the project

It bypasses Row Level Security completely — every order, every customer,
every address, readable and writable by anyone holding it. It lives in an
environment variable, it is read in exactly one file (`env.js`), and it never
appears in a response, a log line, an error message or anything under
`assets/` or `data/`. `npm run check` enforces the last part.

If it is ever exposed, rotate it in the Supabase dashboard immediately. A key
that has been published once cannot be un-published by deleting the file.

### `asUser` by default; `asAdmin` only where unavoidable

`supabase.asUser(req)` carries the caller's own token, so every query it makes
is judged by Row Level Security. A mistake in an endpoint is then caught by a
policy that does not care what the code intended.

`supabase.asAdmin()` is the whole database with no questions asked. Each use
must say at the call site why it is necessary, and must first establish who is
calling. It is never the answer to "the query was blocked" — that is a policy
to fix.

### Authorization is read from the database, never from the request

A role in a token is a snapshot; a role in a request body is a suggestion.
`auth.js` reads identity from a verified token and will, from Phase 3, read
the role from the `profiles` table on every call. Nothing that decides what
someone may do is taken from what they sent.

`requireAdmin` deliberately does not exist yet. A stub that returned `true`
would let an endpoint be written that looks protected and is not.

### Prices and totals are read from the database, never from the request

`validate.js` has no price validator, and that is on purpose. A price in a
body is not checked for plausibility and then used — it is discarded, and the
real one is read from the `products` table. The same will be true of order
totals, discounts and stock.

### Errors have two audiences

Callers get a stable `code` and a message safe to show a person. Operators get
the original exception in the server log. Anything that is not an `AppError`
is treated as a leak risk and flattened to a 500, because a library's error
message was never written with a client in mind.

### CORS defaults to nothing

The storefront, the panel and the functions are one domain on Vercel, so no
browser needs permission to call them and no headers are sent. `ALLOWED_ORIGINS`
opens specific origins for local development. There is no code path that emits
a wildcard.

---

## Response shape

Every endpoint answers in one of two shapes, so a caller can branch on `ok`
alone:

```json
{ "ok": true, "data": { } }
```

```json
{ "ok": false, "error": { "code": "bad_request", "message": "Check the details and try again." } }
```

Clients may switch on `code`. They must never parse `message` — that wording
is for people and will change.

---

## What is deliberately absent

| Not here | Why |
|---|---|
| A web framework | Vercel's runtime already routes and parses. Express would add a layer with nothing to do. |
| An ORM | Serverless functions pay a cold start for a heavy client. The Supabase client plus SQL is enough. |
| A validation library | The checks needed are a few dozen lines. A schema compiler is a larger surface than the problem. |
| A logging service | Vercel collects stdout and stderr. `log.js` only has to make that output consistent and safe. |
| `requireAdmin` | Phase 3. See above. |
