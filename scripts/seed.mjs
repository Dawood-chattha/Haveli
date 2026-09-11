/* =========================================================================
   scripts/seed.mjs — fill the database from the data the site already uses
   -------------------------------------------------------------------------
   Run with:  npm run seed          (after db/schema.sql has been applied)

   WHY THIS RUNS THE STOREFRONT'S OWN GENERATOR
   The catalogue is not a list in a file. data/catalogue.js holds ingredients
   and assets/js/catalogue.js expands them across every leaf of the menu tree
   — which is how one small seed file produces the several hundred products
   the site shows. Writing the SQL by hand would mean maintaining a second,
   diverging copy of that expansion.

   So this script loads those exact files, in a shim that gives them the
   `window` they expect, and reads the result. Whatever the storefront shows
   today is what goes into the database, down to the ids. Phase 4 then swaps
   the source without the pages noticing.

   IDS ARE DERIVED, NOT RANDOM
   Every row's uuid is computed from its natural key — 'men/polo', or a
   product id like 'men-basic-polo-3' — using the standard version 5
   algorithm. Two consequences, both wanted:

     re-running this script updates rows instead of duplicating them, so it
     is safe to run again after editing the catalogue;

     a category's id is knowable before it is inserted, so products can name
     their category in the same run without reading anything back.

   WHY IT USES THE SERVICE ROLE KEY
   Row Level Security is on and Phase 3 has not written the policies yet, so
   nothing else can write. This is a one-off administrative import run from a
   developer's machine, which is one of the few places that key belongs. It
   is read from .env.local through Node's own --env-file and is never printed.

   TWO SEEDS, AND THE LINE BETWEEN THEM

     npm run seed         CATEGORIES ONLY. The department and category tree
                          is the shop's real structure — Men, Women, Kids and
                          the categories beneath them are what this shop
                          actually sells. It belongs in the database.

     npm run seed:demo    THE 560 GENERATED PRODUCTS, their images, and the
                          hero banners. These are invented. They exist so that
                          Phase 4 can be tested against something, because an
                          empty catalogue proves nothing about whether the UI
                          is correctly connected.

     npm run seed:demo:remove
                          Deletes every row the demo seed created, and nothing
                          else. Run this before the shop goes live.

   The split is the point. The products visible on the site today are
   placeholders built to design the interface against; the real ones will be
   entered by the shop's owner through the admin panel. Loading several
   hundred invented products into the real database would hand that owner a
   catalogue they have to empty by hand before they can trade — which is worse
   than starting with nothing.

   Removal is exact rather than a blanket delete: every demo row's id is
   derived from its name, so this script knows precisely which rows it created
   and can remove those without touching a single product the owner has added.

   WHAT IS NEVER SEEDED, IN EITHER MODE
   Orders, customers, carts, wishlists, addresses, coupons and payments. Those
   record things that actually happened. Inventing them would give the shop a
   sales history it never had, and that history would then appear on the
   reports screen as figures someone might believe. The admin panel's mock
   orders stay mock until real ones arrive.
   ========================================================================= */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/* -------------------------------------------------------------------------
   Deterministic ids (RFC 4122 version 5, SHA-1 over a namespace + name)
   ------------------------------------------------------------------------- */

/* A namespace of this project's own, so ids cannot collide with any other
   system that happens to use the same names. */
const NAMESPACE = 'b4f2c1a0-8e3d-4c7b-9a15-6d0e2f8a3c41';

function uuid5(name) {
  const hex = NAMESPACE.replace(/-/g, '');
  const ns = Buffer.from(hex, 'hex');
  const hash = createHash('sha1').update(Buffer.concat([ns, Buffer.from(name, 'utf8')])).digest();

  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;   /* version 5 */
  bytes[8] = (bytes[8] & 0x3f) | 0x80;   /* RFC 4122 variant */

  const s = bytes.toString('hex');
  return [s.slice(0, 8), s.slice(8, 12), s.slice(12, 16), s.slice(16, 20), s.slice(20)].join('-');
}

/* -------------------------------------------------------------------------
   Load the storefront's data files in a window shim
   ------------------------------------------------------------------------- */

function loadFrontendData() {
  /* Enough of a browser for files that only ever touch window.ZB at load
     time. None of the four below reaches into the DOM before it is called;
     `document` is present only so that a stray reference throws something
     legible rather than a ReferenceError. */
  const shim = { ZB: {} };
  const doc = { createElement: () => ({ style: {} }), documentElement: { style: {} } };

  const files = [
    'assets/js/ui.js',
    'data/navigation.js',
    'data/catalogue.js',
    'data/hero.js',
    'assets/js/catalogue.js'
  ];

  for (const rel of files) {
    const code = readFileSync(join(ROOT, rel), 'utf8');
    try {
      new Function('window', 'document', code)(shim, doc);
    } catch (err) {
      throw new Error('could not load ' + rel + ': ' + err.message);
    }
  }

  if (!shim.ZB.navigation) throw new Error('ZB.navigation did not load');
  if (!shim.ZB.catalogue) throw new Error('ZB.catalogue did not load');

  return shim.ZB;
}

/* -------------------------------------------------------------------------
   Shape the rows
   ------------------------------------------------------------------------- */

/**
 * The menu tree becomes category rows.
 *
 * Depth 0 is a department and has no parent. Depth 1 and 2 are its
 * categories and sub-categories. `dept` repeats the department's id on every
 * row, which is what the schema's (dept, slug) uniqueness is keyed on and
 * what the storefront's /category/:dept/:sub URLs already assume.
 */
function buildCategories(ZB) {
  const slug = ZB.ui.slug;
  const rows = [];
  const seen = new Map();

  const add = (dept, key, row) => {
    if (seen.has(key)) {
      throw new Error('two categories share the slug "' + key + '" — the schema ' +
                      'requires (dept, slug) to be unique, so one must be renamed');
    }
    seen.set(key, true);
    rows.push(row);
  };

  ZB.navigation.forEach((dept, deptIndex) => {
    const deptId = uuid5('category:' + dept.id);

    add(dept.id, dept.id + '/' + dept.id, {
      id: deptId, parent_id: null, dept: dept.id,
      slug: dept.id, label: dept.label, sort: deptIndex, active: true
    });

    dept.items.forEach((item, itemIndex) => {
      const itemSlug = slug(item.label);
      const itemId = uuid5('category:' + dept.id + '/' + itemSlug);

      add(dept.id, dept.id + '/' + itemSlug, {
        id: itemId, parent_id: deptId, dept: dept.id,
        slug: itemSlug, label: item.label, sort: itemIndex, active: true
      });

      (item.children || []).forEach((child, childIndex) => {
        const childSlug = slug(child.label);

        add(dept.id, dept.id + '/' + childSlug, {
          id: uuid5('category:' + dept.id + '/' + childSlug),
          parent_id: itemId, dept: dept.id,
          slug: childSlug, label: child.label, sort: childIndex, active: true
        });
      });
    });
  });

  return rows;
}

/**
 * Products, and their images as separate rows.
 *
 * `compare_at` is only written when it is genuinely higher than the price —
 * the schema rejects anything else, and a product that is not reduced should
 * have nothing crossed out.
 */
function buildProducts(ZB, categoryIds) {
  const products = [];
  const images = [];

  for (const p of ZB.catalogue.all()) {
    const categoryId = categoryIds.get(p.dept + '/' + p.category);
    if (!categoryId) {
      throw new Error('product ' + p.id + ' names category "' + p.dept + '/' +
                      p.category + '", which is not in the menu tree');
    }

    products.push({
      id: uuid5('product:' + p.id),
      category_id: categoryId,
      title: p.title,
      slug: p.id,
      description: null,
      price: Math.round(p.price),
      compare_at: p.compareAt && p.compareAt > p.price ? Math.round(p.compareAt) : null,
      sku: p.id.toUpperCase(),

      /* The catalogue only knows in-stock or not. A real count arrives when
         the shop starts trading; until then anything available gets a
         plausible figure and anything sold out gets a true zero, so the
         inventory screen has both states to show. */
      stock: p.inStock ? 12 : 0,

      colour: p.colour || null,
      colour_hex: p.colourHex || null,
      fabric: p.fabric || null,
      sizes: p.sizes || [],
      badge: p.badge || null,
      featured: !!p.badge,
      status: 'active'
    });

    (p.images || []).forEach((url, i) => {
      images.push({
        id: uuid5('image:' + p.id + ':' + i),
        product_id: uuid5('product:' + p.id),
        url,
        alt: p.title,
        sort: i
      });
    });
  }

  return { products, images };
}

function buildBanners(ZB) {
  return (ZB.heroSlides || []).map((s, i) => ({
    id: uuid5('banner:' + i),
    image: s.image,
    alt: s.alt || s.headline || 'Banner',
    eyebrow: s.eyebrow || null,
    headline: s.headline || null,
    body: s.body || null,
    cta: s.cta || null,
    href: s.href || null,
    proof: s.proof || null,
    status: 'active',
    sort: i
  }));
}

/* -------------------------------------------------------------------------
   Write
   ------------------------------------------------------------------------- */

/**
 * Upsert in batches.
 *
 * PostgREST will accept a large array, but a single request carrying several
 * thousand rows is one thing to time out and lose entirely. Batching also
 * makes a partial failure legible: the log says which batch stopped.
 */
async function upsert(db, table, rows, size = 200) {
  for (let i = 0; i < rows.length; i += size) {
    const batch = rows.slice(i, i + size);
    const { error } = await db.from(table).upsert(batch, { onConflict: 'id' });

    if (error) {
      throw new Error(table + ' rows ' + i + '-' + (i + batch.length) + ': ' +
                      error.message + (error.hint ? ' (' + error.hint + ')' : ''));
    }
    process.stdout.write('  ' + table + ': ' + Math.min(i + size, rows.length) +
                         '/' + rows.length + '\r');
  }
  console.log('  ' + table + ': ' + rows.length + '/' + rows.length + '   ');
}

/* ------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------
   Modes
   -------------------------------------------------------------------------
   Default is the real seed: the category tree and nothing else. Demo content
   has to be asked for by name, because the failure mode of getting this wrong
   — invented products sitting in a live shop — is not obvious from the
   outside. It looks like a working catalogue.
   ------------------------------------------------------------------------- */

const DEMO = process.argv.includes('--demo');
const REMOVE = process.argv.includes('--remove-demo');

/* `--dry` shapes every row and reports what would be written, without
   connecting to anything. It is how the expansion is checked — slug
   collisions, a category a product names that does not exist, a compare_at
   the schema would reject — before a single row is sent anywhere. */
const DRY = process.argv.includes('--dry');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!DRY && (!url || !key)) {
  console.error('\nSUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  console.error('Run it as:  npm run seed   (which reads .env.local)\n');
  process.exit(1);
}

console.log('\nReading the storefront catalogue...');
const ZB = loadFrontendData();

const categories = buildCategories(ZB);
const categoryIds = new Map(categories.map((c) => [c.dept + '/' + c.slug, c.id]));
const { products, images } = buildProducts(ZB, categoryIds);
const banners = buildBanners(ZB);

console.log('  categories: ' + categories.length + '   (real — the shop\'s own structure)');
console.log('  products:   ' + products.length + '  (demo — placeholders, not inventory)');
console.log('  images:     ' + images.length + ' (demo)');
console.log('  banners:    ' + banners.length + '   (demo)');

/* -------------------------------------------------------------------------
   Dry run
   ------------------------------------------------------------------------- */

if (DRY) {
  console.log('\nSample rows:');
  console.log('  category ->', JSON.stringify(categories[1]));
  console.log('  product  ->', JSON.stringify(products[0]));
  console.log('  image    ->', JSON.stringify(images[0]));
  console.log('  banner   ->', JSON.stringify(banners[0]));

  /* The constraints the schema will enforce, checked here so a violation is
     a readable message rather than a Postgres error mid-import. */
  const problems = [];
  for (const p of products) {
    if (p.compare_at !== null && p.compare_at <= p.price) {
      problems.push(p.slug + ': compare_at is not above price');
    }
    if (!Number.isInteger(p.price) || p.price < 0) problems.push(p.slug + ': bad price');
    if (!Number.isInteger(p.stock) || p.stock < 0) problems.push(p.slug + ': bad stock');
    if (!p.title) problems.push(p.slug + ': no title');
  }

  const slugs = new Set();
  for (const p of products) {
    if (slugs.has(p.slug)) problems.push('duplicate product slug: ' + p.slug);
    slugs.add(p.slug);
  }

  const ids = new Set();
  for (const row of [...categories, ...products, ...images, ...banners]) {
    if (ids.has(row.id)) problems.push('uuid collision: ' + row.id);
    ids.add(row.id);
  }

  console.log('\nConstraint check:');
  if (problems.length) {
    problems.slice(0, 20).forEach((p) => console.log('  FAIL  ' + p));
    console.log('\n' + problems.length + ' problem(s)\n');
    process.exit(1);
  }
  console.log('  ok    ' + ids.size + ' rows, no duplicate ids, no constraint violations');
  console.log('\nDry run only — nothing was written.\n');
  process.exit(0);
}

const db = createClient(url, key, { auth: { persistSession: false } });

/* -------------------------------------------------------------------------
   Remove the demo content
   -------------------------------------------------------------------------
   By id, in batches, and only the ids this script generates.
   `delete().in('id', [...])` names every row explicitly, so a product the
   owner added through the admin panel cannot be caught by it — which a
   `delete all products` would do, and which is exactly the mistake worth
   engineering out of a command whose whole job is deleting things.

   Images go with their product through `on delete cascade`, so they are not
   deleted separately; naming them again would be a second chance to get a
   filter wrong.
   ------------------------------------------------------------------------- */

async function removeByIds(table, ids, size = 200) {
  let gone = 0;
  for (let i = 0; i < ids.length; i += size) {
    const batch = ids.slice(i, i + size);
    const { error, count } = await db.from(table).delete({ count: 'exact' }).in('id', batch);
    if (error) throw new Error('deleting from ' + table + ': ' + error.message);
    gone += count || 0;
  }
  console.log('  ' + table.padEnd(15) + gone + ' demo rows removed');
}

/* -------------------------------------------------------------------------
   Which rows in the database were made by this script

   THIS USED TO BE ANSWERED BY THE GENERATOR, AND THE ANSWER WENT WRONG
   `--remove-demo` originally deleted the ids that buildProducts() had just
   generated, on the reasoning that generating them twice gives the same list.
   That held until assets/js/catalogue.js was rewired to fetch the catalogue
   from the API instead of building it from data/catalogue.js. From then on
   ZB.catalogue.all() returned nothing here, buildProducts() produced an empty
   list, and `npm run seed:demo:remove` reported success having deleted
   nothing at all, while five hundred and sixty demo products sat in the shop.

   A command whose whole job is deleting things, which cheerfully reports
   having done it and has not, is the worst shape a bug can take. So the
   question is now asked of the database, which is where the rows actually
   are, and answered from the rows themselves.

   HOW A DEMO ROW IS RECOGNISED
   Every id this script writes is uuid5 of a fixed namespace and the row's own
   natural key — 'product:' plus the slug, 'banner:' plus the position. So a
   row is one of this script's if recomputing that from the row gives back the
   row's own id, and it cannot be one otherwise: a product added through the
   admin panel gets a random uuid, which will not match its slug by accident.

   That is a stronger test than the old one and it is checked per row, so a
   catalogue that is half demo and half real is sorted correctly rather than
   being treated as one or the other.
   ------------------------------------------------------------------------- */

async function sortDemoFromReal(table, columns, idFor, pageSize = 1000) {
  const demo = [];
  const theirs = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db.from(table)
      .select(columns)
      .order('id')
      .range(from, from + pageSize - 1);

    if (error) throw new Error('reading ' + table + ': ' + error.message);
    if (!data.length) break;

    for (const row of data) {
      (idFor(row) === row.id ? demo : theirs).push(row);
    }

    if (data.length < pageSize) break;
  }

  return { demo, theirs };
}

if (REMOVE) {
  console.log('\nRemoving demo content...');
  console.log('  (categories are NOT touched — they are the shop\'s real structure)');

  const p = await sortDemoFromReal('products', 'id, slug, title',
    (row) => (row.slug ? uuid5('product:' + row.slug) : ''));

  /* A banner has no slug to derive from, only the position it was seeded at.
     A generous ceiling costs nothing: it is arithmetic, not a query. */
  const bannerIds = new Set();
  for (let i = 0; i < 500; i++) bannerIds.add(uuid5('banner:' + i));

  const b = await sortDemoFromReal('banners', 'id, headline, sort', (row) =>
    bannerIds.has(row.id) ? row.id : '');

  console.log('  found      ' + p.demo.length + ' demo products, ' +
              b.demo.length + ' demo banners');

  /* The reassuring half of the report. Anything listed here is staying, and
     saying so by name is the difference between trusting this command and
     holding one's breath through it. */
  if (p.theirs.length || b.theirs.length) {
    console.log('  keeping    ' + p.theirs.length + ' products and ' +
                b.theirs.length + ' banners that this script did not write:');
    p.theirs.slice(0, 20).forEach((row) =>
      console.log('               ' + (row.title || row.slug || row.headline || row.id)));
    if (p.theirs.length > 20) console.log('               ... and ' +
                                          (p.theirs.length - 20) + ' more');
  }

  await removeByIds('products', p.demo.map((row) => row.id));
  await removeByIds('banners', b.demo.map((row) => row.id));

  console.log('\nRemaining:');
  for (const table of ['categories', 'products', 'product_images', 'banners']) {
    const { count, error } = await db.from(table).select('*', { count: 'exact', head: true });
    if (error) throw new Error('counting ' + table + ': ' + error.message);
    console.log('  ' + table.padEnd(15) + count + ' rows');
  }

  console.log('\nDemo content removed. Anything added through the admin panel is untouched.\n');
  process.exit(0);
}

/* -------------------------------------------------------------------------
   Write
   ------------------------------------------------------------------------- */

console.log('\nWriting...');

/* Categories go in either way: products cannot exist without them, and they
   are real regardless of which mode this is. */
await upsert(db, 'categories', categories);

if (DEMO) {
  /* Order matters: a product needs its category, an image needs its product. */
  await upsert(db, 'products', products);
  await upsert(db, 'product_images', images);
  await upsert(db, 'banners', banners);
} else {
  console.log('  products, images, banners: skipped');
  console.log('    These are placeholders, not inventory. The shop\'s real products');
  console.log('    are entered through the admin panel. Use `npm run seed:demo` if');
  console.log('    you want them for testing, and `npm run seed:demo:remove` after.');
}

/* Read back through a plain count, so the numbers reported are the
   database's own and not this script's hopes. */
console.log('\nVerifying...');
for (const table of ['categories', 'products', 'product_images', 'banners']) {
  const { count, error } = await db.from(table).select('*', { count: 'exact', head: true });
  if (error) throw new Error('counting ' + table + ': ' + error.message);
  console.log('  ' + table.padEnd(15) + count + ' rows');
}

console.log('\nSeed complete.\n');
