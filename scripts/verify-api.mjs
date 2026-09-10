/* =========================================================================
   scripts/verify-api.mjs — prove the endpoints do what they say
   -------------------------------------------------------------------------
   Run with:  npm run verify:api        (the server must already be running)

   verify-auth.mjs proves the database refuses the wrong people. This proves
   the layer above it: that the HTTP endpoints answer correctly, refuse
   correctly, and hand back the shapes the frontend is about to be wired to.

   IT TALKS TO THE RUNNING SERVER, NOT TO THE FUNCTIONS
   Importing the handlers and calling them would skip routing, the cookie and
   bearer parsing, the status codes and the JSON envelope — which is most of
   what can go wrong. So this makes real requests to 127.0.0.1:3000.

   THE ACCOUNTS AND THE ROWS ARE TEMPORARY
   Two throwaway accounts at @verify.invalid, and every category and product
   this file creates is deleted in the finally block — by id, so nothing the
   shop owner added can be caught by the cleanup. A product is hard-deleted
   there rather than archived: the endpoint's soft delete is the behaviour
   under test, not the way to tidy up after it.
   ========================================================================= */

import { createClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'node:crypto';

const BASE = process.env.API_URL || 'http://127.0.0.1:3000';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !svcKey) {
  console.error('\nAll three Supabase variables must be set.\n');
  process.exit(1);
}

const admin = createClient(url, svcKey, { auth: { persistSession: false } });
const signer = createClient(url, anonKey, { auth: { persistSession: false } });

let failures = 0;
const pass = (m) => console.log('  ok      ' + m);
const fail = (m) => { failures++; console.error('  FAIL    ' + m); };

function check(label, condition, detail) {
  if (condition) pass(label);
  else fail(label + (detail ? ' — ' + detail : ''));
}

/* -------------------------------------------------------------------------
   The request helper
   ------------------------------------------------------------------------- */

async function call(method, path, opts) {
  const { token, cookie, body, bytes, type } = opts || {};

  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  /* An upload is the file itself — raw bytes with the picture's own type in
     the header, which is what api/admin/uploads.js reads and what the panel
     sends. See the note at the top of that file for why it is not a form. */
  if (bytes !== undefined) headers['Content-Type'] = type || 'application/octet-stream';

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: bytes !== undefined ? bytes
        : body === undefined ? undefined
        : JSON.stringify(body)
  });

  const text = await res.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text.slice(0, 200) }; }

  return { status: res.status, body: payload };
}

/** Expect a particular status, and say what came back when it is not. */
async function expectStatus(label, wanted, method, path, opts) {
  const res = await call(method, path, opts);

  if (res.status === wanted) pass(label + ' — ' + wanted);
  else fail(label + ' — wanted ' + wanted + ', got ' + res.status + ' ' +
            JSON.stringify(res.body).slice(0, 160));

  return res;
}

const keysOf = (o) => Object.keys(o || {}).sort().join(',');

/* -------------------------------------------------------------------------
   Setup
   ------------------------------------------------------------------------- */

const stamp = Date.now();
const people = {
  owner: { email: 'apiadmin-' + stamp + '@verify.invalid', password: randomBytes(24).toString('hex') },
  shopper: { email: 'apiuser-' + stamp + '@verify.invalid', password: randomBytes(24).toString('hex') }
};

const madeUsers = [];
const madeCategories = [];
const madeProducts = [];
const madeOrders = [];
const madeCoupons = [];
const madeBanners = [];
const madeAddresses = [];
const madeUploads = [];

try {
  /* Nothing below means anything if the server is not the one being tested. */
  const health = await call('GET', '/api/health');

  if (health.status !== 200) {
    throw new Error('the server at ' + BASE + ' did not answer /api/health (' + health.status +
                    '). Start it with `npm run dev` and try again.');
  }
  if (!(health.body && health.body.data && health.body.data.database &&
        health.body.data.database.reachable)) {
    throw new Error('the server is running but cannot reach the database');
  }
  pass('the server is up and can reach the database');

  console.log('\nCreating two temporary accounts...');

  for (const [role, person] of Object.entries(people)) {
    const { data, error } = await admin.auth.admin.createUser({
      email: person.email, password: person.password, email_confirm: true
    });
    if (error) throw new Error('creating ' + role + ': ' + error.message);
    person.id = data.user.id;
    madeUsers.push(data.user.id);
  }

  await admin.from('profiles').update({ role: 'admin' }).eq('id', people.owner.id);

  for (const [role, person] of Object.entries(people)) {
    const { data, error } = await signer.auth.signInWithPassword({
      email: person.email, password: person.password
    });
    if (error) throw new Error('signing in as ' + role + ': ' + error.message);
    person.token = data.session.access_token;
  }
  /* NOBODY IS SIGNED OUT HERE, AND THAT IS DELIBERATE
   *
   * The first version of this file called signer.auth.signOut() after
   * collecting the tokens, out of the habit of leaving no session behind.
   * Every "a customer cannot do this" check then came back 401 instead of
   * 403 — the test was measuring a signed-out visitor while reporting on a
   * signed-in one, which is the kind of check that passes for the wrong
   * reason and would have kept passing with requireAdmin deleted.
   *
   * The cause is that signing out deletes the session at Supabase, and an
   * access token names the session that issued it. Once that session is gone
   * the token verifies as nothing, whatever it still says inside. Scoping
   * the sign-out to 'local' does not help: the session is deleted either
   * way, only the breadth differs.
   *
   * Nothing needs it in the first place. A signed-out request here is one
   * with no Authorization header, not a client that has been emptied — so
   * `signer` simply keeps its session until the accounts are deleted with it
   * in the finally block. */

  const owner = { token: people.owner.token };
  const shopper = { token: people.shopper.token };

  /* =====================================================================
     1. The public endpoints
     ===================================================================== */

  console.log('\n1. PUBLIC — the shop, with nobody signed in');

  const cat = await expectStatus('GET /api/catalogue', 200, 'GET', '/api/catalogue');
  const products = cat.body && cat.body.data ? cat.body.data.products : null;

  check('the catalogue is an array of products',
        Array.isArray(products) && products.length > 0,
        'got ' + JSON.stringify(products).slice(0, 80));

  if (Array.isArray(products) && products.length) {
    const p = products[0];
    check('a storefront product is keyed by slug, not uuid',
          typeof p.id === 'string' && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(p.id),
          'id was ' + p.id);
    check('a storefront product carries the fields the UI reads',
          'price' in p && 'dept' in p && 'category' in p && 'images' in p && 'path' in p,
          Object.keys(p).join(','));
  }

  const nav = await expectStatus('GET /api/categories', 200, 'GET', '/api/categories');
  const tree = nav.body && nav.body.data ? nav.body.data.navigation : null;

  check('the menu tree has departments with items',
        Array.isArray(tree) && tree.length > 0 && Array.isArray(tree[0].items),
        JSON.stringify(tree || null).slice(0, 120));

  /* =====================================================================
     2. The refusals
     ===================================================================== */

  console.log('\n2. REFUSED — the office is not open to the shop');

  await expectStatus('signed out cannot list products', 401, 'GET', '/api/admin/products');
  await expectStatus('signed out cannot list categories', 401, 'GET', '/api/admin/categories');
  await expectStatus('signed out cannot create a product', 401, 'POST', '/api/admin/products',
                     { body: { title: 'Nope', categoryId: randomUUID(), price: 100 } });

  await expectStatus('a customer cannot list products', 403, 'GET', '/api/admin/products', shopper);
  await expectStatus('a customer cannot list categories', 403, 'GET', '/api/admin/categories', shopper);
  await expectStatus('a customer cannot create a category', 403, 'POST', '/api/admin/categories',
                     { token: shopper.token, body: { label: 'Nope', dept: 'men' } });

  await expectStatus('a nonsense token is refused', 401, 'GET', '/api/admin/products',
                     { token: 'not-a-real-token' });

  await expectStatus('an unsupported method is refused', 405, 'PUT', '/api/admin/products', owner);

  /* =====================================================================
     3. Categories
     ===================================================================== */

  console.log('\n3. CATEGORIES — as the owner');

  const listed = await expectStatus('GET /api/admin/categories', 200, 'GET',
                                    '/api/admin/categories', owner);

  const items = (listed.body.data && listed.body.data.items) || [];
  const departments = (listed.body.data && listed.body.data.departments) || [];

  check('the list returns categories', items.length > 0, 'got ' + items.length);
  check('the list returns departments separately', departments.length > 0, 'got ' + departments.length);
  check('no department appears as an editable row',
        !items.some((i) => departments.some((d) => d.id === i.id)));
  check('every row is shaped for the panel',
        items.every((i) => 'status' in i && 'level' in i && 'productCount' in i && !('active' in i)),
        JSON.stringify(items[0]).slice(0, 160));
  check('levels are 1 or 2, never deeper',
        items.every((i) => i.level === 1 || i.level === 2));

  const dept = departments.find((d) => d.slug === 'men') || departments[0];

  const madeName = 'Verify Category ' + stamp;
  const created = await expectStatus('POST creates a category', 200, 'POST', '/api/admin/categories',
                                     { token: owner.token, body: { label: madeName, dept: dept.slug } });

  const categoryA = created.body.data && created.body.data.category;
  if (categoryA && categoryA.id) madeCategories.push(categoryA.id);

  check('the new category comes back in the panel shape',
        categoryA && 'status' in categoryA && 'level' in categoryA && !('active' in categoryA),
        JSON.stringify(categoryA).slice(0, 160));
  check('its slug was derived from the label',
        categoryA && categoryA.slug === 'verify-category-' + stamp,
        'slug was ' + (categoryA && categoryA.slug));
  check('it sits directly under the department',
        categoryA && categoryA.level === 1 && categoryA.parentId === null &&
        categoryA.dept === dept.slug);
  check('it starts with no products', categoryA && categoryA.productCount === 0);

  const twin = await expectStatus('a second category with the same name', 200, 'POST',
                                  '/api/admin/categories',
                                  { token: owner.token, body: { label: madeName, dept: dept.slug } });

  const categoryB = twin.body.data && twin.body.data.category;
  if (categoryB && categoryB.id) madeCategories.push(categoryB.id);

  check('the duplicate name got a distinct slug',
        categoryB && categoryB.slug === categoryA.slug + '-2',
        'slug was ' + (categoryB && categoryB.slug));

  await expectStatus('a category with neither parent nor department', 400, 'POST',
                     '/api/admin/categories', { token: owner.token, body: { label: 'Homeless' } });
  await expectStatus('a category under a department that does not exist', 400, 'POST',
                     '/api/admin/categories',
                     { token: owner.token, body: { label: 'Nowhere', dept: 'atlantis' } });
  await expectStatus('a category under a parent that does not exist', 400, 'POST',
                     '/api/admin/categories',
                     { token: owner.token, body: { label: 'Nowhere', parentId: randomUUID() } });
  await expectStatus('a category with no label at all', 400, 'POST', '/api/admin/categories',
                     { token: owner.token, body: { dept: dept.slug } });

  const readBack = await expectStatus('GET one category', 200, 'GET',
                                      '/api/admin/categories/' + categoryA.id, owner);

  check('reading gives the same shape as listing',
        keysOf(readBack.body.data && readBack.body.data.category) === keysOf(categoryA),
        keysOf(readBack.body.data && readBack.body.data.category));

  await expectStatus('a department is not editable here', 403, 'GET',
                     '/api/admin/categories/' + dept.id, owner);
  await expectStatus('a category that does not exist', 404, 'GET',
                     '/api/admin/categories/' + randomUUID(), owner);
  await expectStatus('an id that is not a uuid', 400, 'GET',
                     '/api/admin/categories/not-a-uuid', owner);

  const renamed = await expectStatus('PATCH renames it', 200, 'PATCH',
                                     '/api/admin/categories/' + categoryA.id,
                                     { token: owner.token, body: { label: 'Verify Renamed ' + stamp } });

  check('the label changed',
        renamed.body.data.category.label === 'Verify Renamed ' + stamp);
  check('THE SLUG DID NOT — the address survives a rename',
        renamed.body.data.category.slug === categoryA.slug,
        'slug is now ' + renamed.body.data.category.slug);

  const hidden = await expectStatus('PATCH hides it', 200, 'PATCH',
                                    '/api/admin/categories/' + categoryA.id,
                                    { token: owner.token, body: { active: false } });

  check('hiding shows as a status, not a boolean',
        hidden.body.data.category.status === 'hidden',
        JSON.stringify(hidden.body.data.category).slice(0, 120));

  await expectStatus('a PATCH carrying only a slug', 400, 'PATCH',
                     '/api/admin/categories/' + categoryA.id,
                     { token: owner.token, body: { slug: 'stolen-address' } });

  {
    const { data } = await admin.from('categories').select('slug').eq('id', categoryA.id).single();
    check('and the slug really was not written', data && data.slug === categoryA.slug,
          'slug is now ' + (data && data.slug));
  }

  await expectStatus('an empty PATCH', 400, 'PATCH', '/api/admin/categories/' + categoryA.id,
                     { token: owner.token, body: {} });

  /* Put it back on before the products go in. */
  await call('PATCH', '/api/admin/categories/' + categoryA.id,
             { token: owner.token, body: { active: true } });

  /* =====================================================================
     4. Products
     ===================================================================== */

  console.log('\n4. PRODUCTS — as the owner');

  const productName = 'Verify Kurta ' + stamp;
  const madeProduct = await expectStatus('POST creates a product', 200, 'POST',
                                         '/api/admin/products', {
    token: owner.token,
    body: {
      title: productName,
      categoryId: categoryA.id,
      price: 4500,
      compareAt: 6000,
      stock: 7,
      status: 'draft',
      colour: 'Ivory',
      fabric: 'Lawn',
      sizes: ['S', 'M', 'L'],
      images: ['assets/img/placeholder.svg']
    }
  });

  const productA = madeProduct.body.data && madeProduct.body.data.product;
  if (productA && productA.id) madeProducts.push(productA.id);

  check('the product is keyed by uuid for the panel',
        /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test((productA && productA.id) || ''),
        'id was ' + (productA && productA.id));
  check('its slug and sku were derived, not accepted',
        productA.slug === 'verify-kurta-' + stamp && productA.sku.indexOf('HAV-') === 0,
        productA.slug + ' / ' + productA.sku);
  check('THE DEPARTMENT CAME FROM THE CATEGORY, not the request',
        productA.dept === dept.slug, 'dept was ' + productA.dept);
  check('the images were written', (productA.images || []).length === 1);
  check('the sizes survived', JSON.stringify(productA.sizes) === JSON.stringify(['S', 'M', 'L']));
  check('it was created as a draft', productA.status === 'draft');

  await expectStatus('an original price below the sale price', 400, 'POST', '/api/admin/products',
                     { token: owner.token,
                       body: { title: 'Bad Pricing', categoryId: categoryA.id, price: 5000, compareAt: 4000 } });
  await expectStatus('a negative price', 400, 'POST', '/api/admin/products',
                     { token: owner.token, body: { title: 'Bad Price', categoryId: categoryA.id, price: -1 } });
  await expectStatus('a category that does not exist', 400, 'POST', '/api/admin/products',
                     { token: owner.token, body: { title: 'Homeless', categoryId: randomUUID(), price: 100 } });
  await expectStatus('no title', 400, 'POST', '/api/admin/products',
                     { token: owner.token, body: { categoryId: categoryA.id, price: 100 } });
  await expectStatus('a price that is not a number', 400, 'POST', '/api/admin/products',
                     { token: owner.token, body: { title: 'Wordy', categoryId: categoryA.id, price: 'free' } });

  /* --- listing, filtering, paging --- */

  const found = await expectStatus('GET searches by title', 200, 'GET',
                                   '/api/admin/products?search=' + encodeURIComponent(productName), owner);

  check('the search found exactly the new product',
        found.body.data.total === 1 && found.body.data.items[0].id === productA.id,
        'total ' + found.body.data.total);

  const byCategory = await expectStatus('GET filters by category', 200, 'GET',
                                        '/api/admin/products?category=' + categoryA.slug, owner);

  check('the category filter found it, and only it', byCategory.body.data.total === 1,
        'total ' + byCategory.body.data.total);

  {
    /* The version of this filter that read the slug off the embedded category
       returned the whole catalogue for any value at all. An unknown slug is
       the cheapest way to catch that happening again. */
    const nowhere = await call('GET', '/api/admin/products?category=atlantis', owner);
    check('a category nobody has returns nothing, not everything',
          nowhere.body.data.total === 0, 'total ' + nowhere.body.data.total);
  }

  const byStatus = await expectStatus('GET filters by status', 200, 'GET',
                                      '/api/admin/products?status=draft&search=' +
                                      encodeURIComponent(productName), owner);

  check('the status filter found it', byStatus.body.data.total === 1);

  const wrongStatus = await call('GET', '/api/admin/products?status=active&search=' +
                                 encodeURIComponent(productName), owner);

  check('and does not find it under the wrong status', wrongStatus.body.data.total === 0,
        'total ' + wrongStatus.body.data.total);

  const paged = await expectStatus('GET pages', 200, 'GET',
                                   '/api/admin/products?perPage=5&page=2', owner);

  check('a page holds what it was asked for',
        paged.body.data.items.length <= 5 && paged.body.data.page === 2,
        JSON.stringify({ n: paged.body.data.items.length, page: paged.body.data.page }));
  check('the pager knows the whole total',
        paged.body.data.total > 5 && paged.body.data.pages > 1);

  await expectStatus('an unknown sort falls back rather than failing', 200, 'GET',
                     '/api/admin/products?sort=by-vibes', owner);
  await expectStatus('a page size beyond the cap', 400, 'GET',
                     '/api/admin/products?perPage=5000', owner);

  const oneProduct = await expectStatus('GET one product', 200, 'GET',
                                        '/api/admin/products/' + productA.id, owner);

  check('reading gives the same shape as listing',
        keysOf(oneProduct.body.data.product) === keysOf(productA));

  await expectStatus('a product that does not exist', 404, 'GET',
                     '/api/admin/products/' + randomUUID(), owner);

  /* --- editing --- */

  const repriced = await expectStatus('PATCH changes the price', 200, 'PATCH',
                                      '/api/admin/products/' + productA.id,
                                      { token: owner.token, body: { price: 3900 } });

  check('the price changed', repriced.body.data.product.price === 3900);
  check('and nothing else did',
        repriced.body.data.product.title === productName &&
        repriced.body.data.product.stock === 7);

  await expectStatus('a PATCH that would cross the prices over', 400, 'PATCH',
                     '/api/admin/products/' + productA.id,
                     { token: owner.token, body: { price: 9000 } });

  const reimaged = await expectStatus('PATCH replaces the images', 200, 'PATCH',
                                      '/api/admin/products/' + productA.id,
                                      { token: owner.token, body: { images: ['a.svg', 'b.svg'] } });

  check('the images were replaced, not appended',
        reimaged.body.data.product.images.length === 2,
        JSON.stringify(reimaged.body.data.product.images));

  await expectStatus('an empty PATCH', 400, 'PATCH', '/api/admin/products/' + productA.id,
                     { token: owner.token, body: {} });

  /* =====================================================================
     5. The whole point
     ===================================================================== */

  console.log('\n5. END TO END — publish it, and look in the shop');

  await expectStatus('the owner publishes it', 200, 'PATCH', '/api/admin/products/' + productA.id,
                     { token: owner.token, body: { status: 'active' } });

  {
    const shop = await call('GET', '/api/catalogue');
    const seen = shop.body.data.products.find((p) => p.id === productA.slug);
    check('A SIGNED-OUT VISITOR NOW SEES IT', !!seen, 'not in the catalogue');
    check('and sees the price the owner set', seen && seen.price === 3900,
          'price was ' + (seen && seen.price));
  }

  const removed = await expectStatus('the owner removes it', 200, 'DELETE',
                                     '/api/admin/products/' + productA.id, owner);

  check('removal is soft and reports what to undo to',
        removed.body.data.archived === true && removed.body.data.previousStatus === 'active',
        JSON.stringify(removed.body.data));

  {
    const shop = await call('GET', '/api/catalogue');
    const seen = shop.body.data.products.find((p) => p.id === productA.slug);
    check('AND THE SHOP NO LONGER SHOWS IT', !seen, 'it is still in the catalogue');
  }

  {
    const { data } = await admin.from('products').select('status').eq('id', productA.id).single();
    check('the row is still there, only archived', data && data.status === 'archived');
  }

  const again = await call('DELETE', '/api/admin/products/' + productA.id, owner);
  check('removing it twice is not an error',
        again.status === 200 && again.body.data.previousStatus === 'archived',
        again.status + ' ' + JSON.stringify(again.body.data));

  const undone = await expectStatus('undo puts it back', 200, 'PATCH',
                                    '/api/admin/products/' + productA.id,
                                    { token: owner.token, body: { status: 'active' } });

  check('it is active again', undone.body.data.product.status === 'active');

  /* =====================================================================
     6. Deleting a category
     ===================================================================== */

  console.log('\n6. DELETING A CATEGORY — refused while anything is in it');

  await expectStatus('a category holding a product', 409, 'DELETE',
                     '/api/admin/categories/' + categoryA.id, owner);

  await expectStatus('an empty category', 200, 'DELETE',
                     '/api/admin/categories/' + categoryB.id, owner);

  {
    const { data } = await admin.from('categories').select('id').eq('id', categoryB.id).maybeSingle();
    check('and it really is gone', !data);
    if (!data) madeCategories.splice(madeCategories.indexOf(categoryB.id), 1);
  }

  await expectStatus('a customer cannot delete a category', 403, 'DELETE',
                     '/api/admin/categories/' + categoryA.id, shopper);

  /* =====================================================================
     7. The cookie path
     ===================================================================== */

  console.log('\n7. SIGNED IN WITH A COOKIE — the way a browser actually is');

  /* EVERY CHECK ABOVE THIS USES A BEARER TOKEN, WHICH NO BROWSER SENDS
   *
   * The panel signs in with an HttpOnly cookie precisely so that the token
   * is out of JavaScript's reach, so a header is the one thing it can never
   * use. The two paths went through different code, and one of them was
   * wrong: requireAdmin read the cookie, the database client did not, and a
   * signed-in owner was handed an anonymous connection. Reads still
   * answered — the catalogue is public — so the product list showed the
   * public's view of the shop and called it the owner's. Only a write
   * failed, and only because a policy caught it.
   *
   * So the same things are asked again, over the cookie. */

  const signIn = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: people.owner.email, password: people.owner.password })
  });

  const jar = (typeof signIn.headers.getSetCookie === 'function'
    ? signIn.headers.getSetCookie()
    : []).map((one) => one.split(';')[0]).join('; ');

  check('signing in sets an access cookie',
        signIn.status === 200 && jar.indexOf('zb_at=') > -1,
        signIn.status + ' ' + jar.slice(0, 60));

  const browser = { cookie: jar };

  await expectStatus('the cookie reaches the product list', 200, 'GET',
                     '/api/admin/products', browser);
  await expectStatus('the cookie reaches the category list', 200, 'GET',
                     '/api/admin/categories', browser);

  const draftName = 'Verify Cookie Draft ' + stamp;
  const madeWithCookie = await expectStatus('THE COOKIE CAN WRITE', 200, 'POST',
                                            '/api/admin/products', {
    cookie: jar,
    body: { title: draftName, categoryId: categoryA.id, price: 1200, status: 'draft' }
  });

  const draftProduct = madeWithCookie.body.data && madeWithCookie.body.data.product;
  if (draftProduct && draftProduct.id) madeProducts.push(draftProduct.id);

  {
    /* The point of the whole section: a draft is invisible to the public,
       so finding it proves the request ran as the owner rather than as a
       stranger who happened to be allowed to read the shop. */
    const seen = await call('GET', '/api/admin/products?status=draft&search=' +
                            encodeURIComponent(draftName), browser);

    check('AND SEES A DRAFT, WHICH THE PUBLIC CANNOT',
          seen.body.data.total === 1, 'total ' + seen.body.data.total);
  }

  {
    const shop = await call('GET', '/api/catalogue');
    const leaked = shop.body.data.products.find(function (p) {
      return p.id === (draftProduct && draftProduct.slug);
    });
    check('and the shop does not show that draft', !leaked);
  }

  await expectStatus('the cookie can edit', 200, 'PATCH',
                     '/api/admin/products/' + draftProduct.id,
                     { cookie: jar, body: { price: 1300 } });

  await expectStatus('signing out', 200, 'POST', '/api/auth/logout', browser);

  /* =====================================================================
     8. Checkout
     ---------------------------------------------------------------------
     The most consequential thing in this file. Everything below is about
     one question: can a browser decide what it pays?
     ===================================================================== */

  console.log('\n8. CHECKOUT — the server prices it, or nobody does');

  /* Two products with prices and stock this file chose, so every figure
     below can be checked by hand rather than by repeating the server's own
     arithmetic back at it. */
  const cheap = (await call('POST', '/api/admin/products', {
    token: owner.token,
    body: { title: 'Verify Cheap ' + stamp, categoryId: categoryA.id,
            price: 1200, stock: 5, status: 'active' }
  })).body.data.product;

  const pricey = (await call('POST', '/api/admin/products', {
    token: owner.token,
    body: { title: 'Verify Pricey ' + stamp, categoryId: categoryA.id,
            price: 6000, stock: 2, status: 'active' }
  })).body.data.product;

  madeProducts.push(cheap.id, pricey.id);

  const address = {
    name: 'Verify Buyer', phone: '03001234567',
    line1: '1 Test Street', city: 'Karachi'
  };

  const buy = (items, extra) => Object.assign({ items: items }, address, extra || {});

  await expectStatus('a signed-out visitor cannot check out', 401, 'POST', '/api/checkout',
                     { body: buy([{ productId: cheap.id, qty: 1 }]) });

  await expectStatus('an empty cart', 400, 'POST', '/api/checkout',
                     { token: shopper.token, body: buy([]) });

  await expectStatus('an order with no address', 400, 'POST', '/api/checkout',
                     { token: shopper.token,
                       body: { items: [{ productId: cheap.id, qty: 1 }] } });

  /* --- the ordinary case ------------------------------------------------ */

  const placed = await expectStatus('a customer places an order', 200, 'POST',
                                    '/api/checkout', {
    token: shopper.token,
    body: buy([{ productId: cheap.id, qty: 2 }])
  });

  const order = placed.body.data && placed.body.data.order;
  if (order) madeOrders.push(order.id);

  check('the order has a reference', /^HAV-\d{4}-\d{5}$/.test((order && order.ref) || ''),
        'ref was ' + (order && order.ref));
  check('THE SUBTOTAL IS THE SHOP PRICE TIMES THE QUANTITY',
        order.subtotal === 2400, 'subtotal was ' + order.subtotal);
  check('delivery was charged, because the order is under the free threshold',
        order.shipping === 250, 'shipping was ' + order.shipping);
  check('and the total adds up', order.total === 2650, 'total was ' + order.total);
  check('it starts pending and unpaid',
        order.status === 'pending' && order.payment === 'unpaid');
  check('cash on delivery', order.method === 'Cash on delivery', order.method);
  check('the line kept the price it was sold at',
        order.items.length === 1 && order.items[0].price === 1200 && order.items[0].qty === 2);

  {
    const { data } = await admin.from('products').select('stock').eq('id', cheap.id).single();
    check('THE STOCK CAME DOWN', data.stock === 3, 'stock is ' + data.stock);
  }

  /* --- the whole point -------------------------------------------------- */

  const forged = await expectStatus('an order that tries to name its own prices',
                                    200, 'POST', '/api/checkout', {
    token: shopper.token,
    body: buy([{ productId: cheap.id, qty: 1, price: 1, total: 1 }],
              { price: 1, subtotal: 1, discount: 99999, shipping: 0, total: 1 })
  });

  const forgedOrder = forged.body.data && forged.body.data.order;
  if (forgedOrder) madeOrders.push(forgedOrder.id);

  check('EVERY FIGURE IT SENT WAS IGNORED',
        forgedOrder.subtotal === 1200 && forgedOrder.discount === 0 &&
        forgedOrder.shipping === 250 && forgedOrder.total === 1450,
        JSON.stringify({ subtotal: forgedOrder.subtotal, discount: forgedOrder.discount,
                         shipping: forgedOrder.shipping, total: forgedOrder.total }));

  /* --- shipping ---------------------------------------------------------- */

  const bigger = await expectStatus('an order over the free-delivery threshold',
                                    200, 'POST', '/api/checkout', {
    token: shopper.token,
    body: buy([{ productId: pricey.id, qty: 1 }])
  });

  const bigOrder = bigger.body.data.order;
  madeOrders.push(bigOrder.id);

  check('delivery is free above the threshold',
        bigOrder.shipping === 0 && bigOrder.total === 6000,
        JSON.stringify({ shipping: bigOrder.shipping, total: bigOrder.total }));

  /* --- what cannot be bought --------------------------------------------- */

  /* Five, not ninety-nine. A quantity above the per-line cap is refused by
     validation as a 400 before the database is asked anything — a real rule,
     but a different one, and using it here meant this check passed without
     ever reaching the stock. Only one of the two remains, so five is more
     than there is. */
  await expectStatus('more than there is', 409, 'POST', '/api/checkout',
                     { token: shopper.token, body: buy([{ productId: pricey.id, qty: 5 }]) });

  await expectStatus('a quantity beyond what one line may hold', 400, 'POST', '/api/checkout',
                     { token: shopper.token, body: buy([{ productId: cheap.id, qty: 99 }]) });

  await expectStatus('a product that does not exist', 409, 'POST', '/api/checkout',
                     { token: shopper.token, body: buy([{ productId: randomUUID(), qty: 1 }]) });

  {
    await admin.from('products').update({ status: 'draft' }).eq('id', cheap.id);

    await expectStatus('a product that is not on sale', 409, 'POST', '/api/checkout',
                       { token: shopper.token, body: buy([{ productId: cheap.id, qty: 1 }]) });

    await admin.from('products').update({ status: 'active' }).eq('id', cheap.id);
  }

  await expectStatus('a quantity of zero', 400, 'POST', '/api/checkout',
                     { token: shopper.token, body: buy([{ productId: cheap.id, qty: 0 }]) });

  /* --- coupons ----------------------------------------------------------- */

  const couponCode = 'VERIFY' + stamp;

  await admin.from('coupons').insert({
    code: couponCode, type: 'percent', value: 20, min_spend: 0
  });
  madeCoupons.push(couponCode);

  const discounted = await expectStatus('a coupon is applied', 200, 'POST',
                                        '/api/checkout', {
    token: shopper.token,
    body: buy([{ productId: pricey.id, qty: 1 }], { coupon: couponCode })
  });

  const couponOrder = discounted.body.data.order;
  madeOrders.push(couponOrder.id);

  check('the discount is 20% of the subtotal',
        couponOrder.subtotal === 6000 && couponOrder.discount === 1200,
        JSON.stringify({ subtotal: couponOrder.subtotal, discount: couponOrder.discount }));
  check('DELIVERY IS DECIDED ON WHAT IS ACTUALLY PAID',
        couponOrder.shipping === 250 && couponOrder.total === 5050,
        'a 6,000 order discounted to 4,800 falls below the free threshold: ' +
        JSON.stringify({ shipping: couponOrder.shipping, total: couponOrder.total }));

  {
    const { data } = await admin.from('coupons').select('used_count')
      .eq('code', couponCode).single();
    check('the coupon counted its use', data.used_count === 1, 'used ' + data.used_count);
  }

  await expectStatus('a code nobody issued', 400, 'POST', '/api/checkout',
                     { token: shopper.token,
                       body: buy([{ productId: cheap.id, qty: 1 }],
                                 { coupon: 'NOPE' + stamp }) });

  {
    const expired = 'EXPIRED' + stamp;
    await admin.from('coupons').insert({
      code: expired, type: 'fixed', value: 500,
      expires_at: new Date(Date.now() - 86400000).toISOString()
    });
    madeCoupons.push(expired);

    await expectStatus('a code that has expired', 400, 'POST', '/api/checkout',
                       { token: shopper.token,
                         body: buy([{ productId: cheap.id, qty: 1 }], { coupon: expired }) });
  }

  {
    const rich = 'MINSPEND' + stamp;
    await admin.from('coupons').insert({
      code: rich, type: 'fixed', value: 500, min_spend: 100000
    });
    madeCoupons.push(rich);

    await expectStatus('a code that needs a bigger order', 400, 'POST', '/api/checkout',
                       { token: shopper.token,
                         body: buy([{ productId: cheap.id, qty: 1 }], { coupon: rich }) });
  }

  /* =====================================================================
     9. Who may see an order
     ===================================================================== */

  console.log('\n9. AN ORDER BELONGS TO ITS CUSTOMER, AND TO THE SHOP');

  {
    const mine = await call('GET', '/api/account/orders', shopper);
    check('the customer sees their own orders',
          mine.body.data.orders.some(function (o) { return o.id === order.id; }));

    const one = await call('GET', '/api/account/orders?ref=' +
                           encodeURIComponent(order.ref), shopper);
    check('and can fetch one by reference', one.body.data.order.id === order.id);
  }

  {
    /* The owner is an administrator, and this is the customer endpoint —
       the policy scopes it to the caller's own rows whoever they are. */
    const theirs = await call('GET', '/api/account/orders?ref=' +
                              encodeURIComponent(order.ref), { token: people.owner.token });

    check('SOMEBODY ELSE CANNOT READ IT THROUGH THE ACCOUNT ENDPOINT',
          theirs.status === 404, 'got ' + theirs.status);
  }

  await expectStatus('a signed-out visitor sees no orders', 401, 'GET', '/api/account/orders');

  {
    const seen = await call('GET', '/api/admin/orders?search=' +
                            encodeURIComponent(order.ref), owner);
    check('the shop sees it', seen.body.data.total === 1 &&
          seen.body.data.items[0].ref === order.ref);
    check('with the customer on it',
          seen.body.data.items[0].customerName === 'Verify Buyer',
          seen.body.data.items[0].customerName);
  }

  await expectStatus('a customer cannot read the order list', 403, 'GET',
                     '/api/admin/orders', shopper);

  {
    const sum = await call('GET', '/api/admin/orders/summary', owner);
    /* Four were placed above: the ordinary one, the one that tried to name
       its own prices, the one over the free-delivery threshold, and the one
       with a coupon. */
    check('the summary counts the orders just placed',
          sum.body.data.total >= 4 && sum.body.data.waiting >= 4,
          JSON.stringify(sum.body.data));
  }

  /* =====================================================================
     10. Cancelling, and the stock that comes back with it
     ===================================================================== */

  console.log('\n10. CANCELLING — the shelf gets its stock back');

  {
    const before = (await admin.from('products').select('stock')
      .eq('id', pricey.id).single()).data.stock;

    await expectStatus('the shop cancels an order', 200, 'PATCH',
                       '/api/admin/orders/' + couponOrder.id,
                       { token: owner.token, body: { status: 'cancelled' } });

    const after = (await admin.from('products').select('stock')
      .eq('id', pricey.id).single()).data.stock;

    check('THE STOCK WENT BACK ON THE SHELF', after === before + 1,
          before + ' -> ' + after);

    const coupon = (await admin.from('coupons').select('used_count')
      .eq('code', couponCode).single()).data;
    check('and the coupon may be used again', coupon.used_count === 0,
          'used ' + coupon.used_count);
  }

  {
    /* Reopening takes the stock again. It is there, so this succeeds; the
       case where it is not is what the function raises HV001 for. */
    await expectStatus('the shop reopens it', 200, 'PATCH',
                       '/api/admin/orders/' + couponOrder.id,
                       { token: owner.token, body: { status: 'pending' } });

    const coupon = (await admin.from('coupons').select('used_count')
      .eq('code', couponCode).single()).data;
    check('the coupon is spent again', coupon.used_count === 1,
          'used ' + coupon.used_count);
  }

  await expectStatus('a status the database does not have', 400, 'PATCH',
                     '/api/admin/orders/' + order.id,
                     { token: owner.token, body: { status: 'nonsense' } });

  await expectStatus('the shop marks one paid', 200, 'PATCH',
                     '/api/admin/orders/' + order.id,
                     { token: owner.token, body: { payment: 'paid' } });

  {
    const read = await call('GET', '/api/admin/orders/' + order.id, owner);
    check('and it reads back as paid', read.body.data.order.payment === 'paid');
  }

  await expectStatus('a customer cannot change an order', 403, 'PATCH',
                     '/api/admin/orders/' + order.id,
                     { token: shopper.token, body: { status: 'delivered' } });

  {
    const { data } = await admin.from('orders').select('status').eq('id', order.id).single();
    check('and the order did not move', data.status === 'pending', data.status);
  }

  /* =====================================================================
     11. Customers, now that one has bought something
     ===================================================================== */

  console.log('\n11. THE CUSTOMER LIST');

  {
    const found = await call('GET', '/api/admin/customers?search=' +
                             encodeURIComponent(people.shopper.email), owner);

    check('the buyer is in the list', found.body.data.total === 1,
          'total ' + found.body.data.total);

    const row = found.body.data.items[0];
    check('COUNTED FROM THE ORDERS, NOT STORED ON THE ROW',
          row.orders >= 3 && row.spent > 0,
          JSON.stringify({ orders: row.orders, spent: row.spent }));
    check('with the city of their latest delivery', row.city === 'Karachi', row.city);
  }

  {
    const sum = await call('GET', '/api/admin/customers/summary', owner);
    check('the summary offers Karachi as a filter',
          (sum.body.data.cities || []).some(function (c) { return c.id === 'Karachi'; }),
          JSON.stringify(sum.body.data.cities));
  }

  {
    const blocked = await expectStatus('the shop blocks a customer', 200, 'PATCH',
                                       '/api/admin/customers/' + people.shopper.id,
                                       { token: owner.token, body: { status: 'blocked' } });

    check('the account reads as blocked', blocked.body.data.customer.status === 'blocked');

    await expectStatus('A BLOCKED CUSTOMER CANNOT ORDER', 403, 'POST', '/api/checkout',
                       { token: shopper.token, body: buy([{ productId: cheap.id, qty: 1 }]) });

    await expectStatus('and is let back in', 200, 'PATCH',
                       '/api/admin/customers/' + people.shopper.id,
                       { token: owner.token, body: { status: 'active' } });
  }

  await expectStatus('an administrator is not blocked from this screen', 403, 'PATCH',
                     '/api/admin/customers/' + people.owner.id,
                     { token: owner.token, body: { status: 'blocked' } });

  /* =====================================================================
     12. The dashboard
     ===================================================================== */

  console.log('\n12. THE DASHBOARD — counted, not invented');

  {
    const metrics = await expectStatus('GET /api/admin/metrics', 200, 'GET',
                                       '/api/admin/metrics?days=30', owner);

    const data = metrics.body.data;

    check('it counts the orders just placed', data.summary.orders.value >= 4,
          'orders ' + data.summary.orders.value);
    check('and their revenue', data.summary.sales.value > 0,
          'sales ' + data.summary.sales.value);
    check('the sales line has one bucket per day',
          data.series.length === 30, 'buckets ' + data.series.length);
    check('the best sellers name real products',
          data.topProducts.length > 0 && data.topProducts[0].revenue > 0,
          JSON.stringify(data.topProducts[0]));
    check('the badges agree with the order summary',
          typeof data.badges.orders === 'number' &&
          typeof data.badges.inventory === 'number');
  }

  await expectStatus('a customer cannot read the dashboard', 403, 'GET',
                     '/api/admin/metrics', shopper);

  /* =====================================================================
     13. Uploads
     ---------------------------------------------------------------------
     The panel used to turn a chosen picture into a data URI and put it in
     a column capped at a thousand characters, which stored the first
     thousand characters of it and said nothing. These endpoints are the
     replacement, and the question here is whether a file that is not a
     picture, or is not from the owner, can reach the bucket.
     ===================================================================== */

  console.log('\n13. UPLOADS — the bytes decide what a file is, not its header');

  /* A real one-pixel PNG and a real one-pixel JPEG. Small enough to sit in
     this file, genuine enough that the signature check has something to
     read. */
  const onePixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');

  const onePixelJpeg = Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64');

  await expectStatus('a signed-out visitor cannot upload', 401, 'POST',
                     '/api/admin/uploads', { bytes: onePixelPng, type: 'image/png' });

  await expectStatus('A CUSTOMER CANNOT UPLOAD', 403, 'POST', '/api/admin/uploads',
                     { token: shopper.token, bytes: onePixelPng, type: 'image/png' });

  await expectStatus('a file that is not a picture', 400, 'POST', '/api/admin/uploads',
                     { token: owner.token,
                       bytes: Buffer.from('<?php echo "hello"; ?>            '),
                       type: 'image/png' });

  await expectStatus('nothing at all', 400, 'POST', '/api/admin/uploads',
                     { token: owner.token, bytes: Buffer.alloc(0), type: 'image/png' });

  await expectStatus('a folder this endpoint does not file into', 400, 'POST',
                     '/api/admin/uploads?for=%2Fetc',
                     { token: owner.token, bytes: onePixelPng, type: 'image/png' });

  const upload = await expectStatus('the owner uploads a picture', 200, 'POST',
                                    '/api/admin/uploads?for=products',
                                    { token: owner.token, bytes: onePixelPng,
                                      type: 'image/png' });

  let bannerImageUrl = 'https://example.invalid/slide.png';

  if (upload.status === 200) {
    const file = upload.body.data;
    madeUploads.push(file.path);

    check('it comes back with a URL, a path, a type and a size',
          keysOf(file) === 'bytes,path,type,url', keysOf(file));
    check('it was filed under products/',
          /^products\/[0-9a-f-]{36}\.png$/.test(file.path), file.path);
    check('the name is the endpoint’s, not the caller’s',
          file.path.indexOf('..') < 0 && file.path.indexOf(' ') < 0, file.path);
    check('the size is the file’s own', file.bytes === onePixelPng.length,
          'said ' + file.bytes + ', sent ' + onePixelPng.length);

    /* The point of a public bucket: the shop's own pages read these with no
       key at all, exactly as a visitor's browser will. */
    const fetched = await fetch(file.url);

    check('AND THE PICTURE IS READABLE BY ANYONE, WITH NO KEY',
          fetched.status === 200, 'got ' + fetched.status);
    check('served as the image it is',
          (fetched.headers.get('content-type') || '').indexOf('image/png') === 0,
          fetched.headers.get('content-type'));
  }

  {
    /* A JPEG sent under a PNG header. The header is a claim by whoever made
       the request; the first three bytes are the evidence. */
    const lied = await expectStatus('a JPEG announced as a PNG', 200, 'POST',
                                    '/api/admin/uploads',
                                    { token: owner.token, bytes: onePixelJpeg,
                                      type: 'image/png' });

    if (lied.status === 200) {
      madeUploads.push(lied.body.data.path);
      check('IS STORED AS THE JPEG IT ACTUALLY IS',
            lied.body.data.type === 'image/jpeg' && /\.jpg$/.test(lied.body.data.path),
            lied.body.data.type + ' ' + lied.body.data.path);
    }
  }

  {
    const banner = await expectStatus('a banner picture', 200, 'POST',
                                      '/api/admin/uploads?for=banners',
                                      { token: owner.token, bytes: onePixelPng,
                                        type: 'image/png' });

    if (banner.status === 200) {
      madeUploads.push(banner.body.data.path);
      bannerImageUrl = banner.body.data.url;

      check('is filed apart from the products',
            banner.body.data.path.indexOf('banners/') === 0, banner.body.data.path);
    }
  }

  /* =====================================================================
     14. The carousel
     ---------------------------------------------------------------------
     The slides used to be a file the storefront read with an overlay on
     top, so an edit here never reached the shop. Now there is one table.
     What matters below is the order, because the order is most of what a
     carousel screen is for.
     ===================================================================== */

  console.log('\n14. BANNERS — one list, in the order it plays');

  await expectStatus('a customer cannot read the carousel', 403, 'GET',
                     '/api/admin/banners', shopper);

  await expectStatus('nor rearrange it', 403, 'PATCH', '/api/admin/banners',
                     { token: shopper.token, body: { order: [randomUUID()] } });

  const before = await expectStatus('GET /api/admin/banners', 200, 'GET',
                                    '/api/admin/banners', owner);

  const beforeIds = ((before.body.data && before.body.data.items) || []).map((s) => s.id);

  check('the slides arrive in playing order',
        ((before.body.data && before.body.data.items) || [])
          .every((s, i, a) => i === 0 || a[i - 1].sort <= s.sort),
        JSON.stringify(((before.body.data && before.body.data.items) || []).map((s) => s.sort)));

  await expectStatus('a slide that links off this site', 400, 'POST',
                     '/api/admin/banners',
                     { token: owner.token,
                       body: { image: bannerImageUrl, alt: 'Verify',
                               href: 'https://elsewhere.invalid/sale' } });

  await expectStatus('or to a protocol-relative address', 400, 'POST',
                     '/api/admin/banners',
                     { token: owner.token,
                       body: { image: bannerImageUrl, alt: 'Verify',
                               href: '//elsewhere.invalid/sale' } });

  const madeSlide = await expectStatus('the owner adds a slide', 200, 'POST',
                                       '/api/admin/banners', {
    token: owner.token,
    body: { image: bannerImageUrl, alt: 'Verify slide ' + stamp,
            headline: 'Verify ' + stamp, href: '/shop', status: 'active' }
  });

  if (madeSlide.status === 200) {
    const slide = madeSlide.body.data.banner;
    madeBanners.push(slide.id);

    check('it carries the picture that was uploaded', slide.image === bannerImageUrl);
    check('IT GOES TO THE END OF THE RUN, NOT THE FRONT',
          slide.sort >= beforeIds.length,
          'sort ' + slide.sort + ' with ' + beforeIds.length + ' slides before it');

    const after = await call('GET', '/api/admin/banners', owner);

    check('and the list has grown by one',
          after.body.data.items.length === beforeIds.length + 1,
          after.body.data.items.length + ' vs ' + beforeIds.length);
    check('with it last',
          after.body.data.items[after.body.data.items.length - 1].id === slide.id);

    /* --- the running order ---------------------------------------------- */

    const reordered = await expectStatus('the whole order is sent, and taken', 200, 'PATCH',
                                         '/api/admin/banners',
                                         { token: owner.token,
                                           body: { order: [slide.id].concat(beforeIds) } });

    if (reordered.status === 200) {
      check('THE NEW SLIDE IS NOW FIRST',
            reordered.body.data.items[0].id === slide.id,
            reordered.body.data.items[0].id);
      check('and the rest kept their order among themselves',
            reordered.body.data.items.slice(1).map((s) => s.id).join(',') === beforeIds.join(','));
    }

    /* Put back the way it was found, so a failure later in this file does
       not leave the shop's own homepage rearranged. */
    if (beforeIds.length) {
      await expectStatus('and back again', 200, 'PATCH', '/api/admin/banners',
                         { token: owner.token,
                           body: { order: beforeIds.concat([slide.id]) } });
    }

    await expectStatus('an order naming a slide that is not there', 409, 'PATCH',
                       '/api/admin/banners',
                       { token: owner.token,
                         body: { order: beforeIds.concat([randomUUID()]) } });

    await expectStatus('an order of nothing', 400, 'PATCH', '/api/admin/banners',
                       { token: owner.token, body: { order: [] } });

    /* --- hiding, and removing ------------------------------------------- */

    const hidden = await expectStatus('a slide is taken off the homepage', 200, 'PATCH',
                                      '/api/admin/banners/' + slide.id,
                                      { token: owner.token, body: { status: 'hidden' } });

    if (hidden.status === 200) {
      check('it reads as hidden', hidden.body.data.banner.status === 'hidden');

      const counted = await call('GET', '/api/admin/banners', owner);
      check('and is counted among the hidden ones', counted.body.data.hidden >= 1,
            'hidden ' + counted.body.data.hidden);
    }

    await expectStatus('a customer cannot remove one', 403, 'DELETE',
                       '/api/admin/banners/' + slide.id, shopper);

    await expectStatus('the owner removes it', 200, 'DELETE',
                       '/api/admin/banners/' + slide.id, owner);

    await expectStatus('and it is gone', 404, 'GET',
                       '/api/admin/banners/' + slide.id, owner);

    /* Deleted above, so the cleanup has nothing left to do. */
    madeBanners.length = 0;
  }

  await expectStatus('a slide id that is not an id', 400, 'GET',
                     '/api/admin/banners/not-a-uuid', owner);

  /* =====================================================================
     15. Coupons
     ---------------------------------------------------------------------
     place_order has been reading this table since Phase 5 and there was no
     way to put a row in it. These endpoints are that way. The check that
     matters is the one in the middle: a code created here has to change
     what the checkout charges, or the two are not the same rows after all.
     ===================================================================== */

  console.log('\n15. COUPONS — created here, applied in SQL');

  await expectStatus('a customer cannot read the coupons', 403, 'GET',
                     '/api/admin/coupons', shopper);

  await expectStatus('nor create one', 403, 'POST', '/api/admin/coupons',
                     { token: shopper.token,
                       body: { code: 'VERIFYFREE' + stamp, type: 'percent', value: 90 } });

  await expectStatus('more than a hundred per cent', 400, 'POST', '/api/admin/coupons',
                     { token: owner.token,
                       body: { code: 'VERIFYBAD' + stamp, type: 'percent', value: 150 } });

  await expectStatus('a discount of nothing', 400, 'POST', '/api/admin/coupons',
                     { token: owner.token,
                       body: { code: 'VERIFYBAD' + stamp, type: 'fixed', value: 0 } });

  await expectStatus('an end date before the start', 400, 'POST', '/api/admin/coupons',
                     { token: owner.token,
                       body: { code: 'VERIFYBAD' + stamp, type: 'fixed', value: 100,
                               startsAt: Date.now(), expiresAt: Date.now() - 86400000 } });

  await expectStatus('a code with a space in it', 400, 'POST', '/api/admin/coupons',
                     { token: owner.token,
                       body: { code: 'VERIFY BAD', type: 'fixed', value: 100 } });

  /* --- free delivery ----------------------------------------------------- */

  const shipCode = 'VERIFYSHIP' + stamp;

  const shipping = await expectStatus('a free-delivery coupon', 200, 'POST',
                                      '/api/admin/coupons', {
    token: owner.token,
    body: { code: shipCode.toLowerCase(), type: 'shipping', value: 4321,
            minSpend: 0, usageLimit: 0, note: 'Verify run' }
  });

  if (shipping.status === 200) {
    const made = shipping.body.data.coupon;
    madeCoupons.push(made.code);

    check('the code is stored the way it is meant to be read out',
          made.code === shipCode, made.code);
    check('FREE DELIVERY HAS NO AMOUNT, WHATEVER THE FORM SENT',
          made.value === 0, 'value ' + made.value);
    check('and nobody has used it yet', made.used === 0, 'used ' + made.used);

    await expectStatus('the same code twice', 409, 'POST', '/api/admin/coupons',
                       { token: owner.token,
                         body: { code: shipCode, type: 'fixed', value: 100 } });

    /* --- and now the only question that matters -------------------------- */

    const free = await expectStatus('a small order with the free-delivery code',
                                    200, 'POST', '/api/checkout', {
      token: shopper.token,
      body: buy([{ productId: cheap.id, qty: 1 }], { coupon: shipCode })
    });

    if (free.status === 200) {
      const o = free.body.data.order;
      madeOrders.push(o.id);

      check('THE DELIVERY CHARGE IS GONE', o.shipping === 0, 'shipping ' + o.shipping);
      check('and nothing came off the goods', o.discount === 0, 'discount ' + o.discount);
      check('so the total is the subtotal', o.total === o.subtotal,
            o.total + ' vs ' + o.subtotal);
    }

    const counted = await call('GET', '/api/admin/coupons/' + made.id, owner);
    check('the coupon counted the redemption',
          counted.body.data.coupon.used === 1, 'used ' + counted.body.data.coupon.used);

    /* Used, so it cannot be deleted: the order would be left holding a
       discount from a code that no longer exists. */
    await expectStatus('A COUPON THAT HAS BEEN USED CANNOT BE DELETED', 409, 'DELETE',
                       '/api/admin/coupons/' + made.id, owner);

    const off = await expectStatus('but it can be switched off', 200, 'PATCH',
                                   '/api/admin/coupons/' + made.id,
                                   { token: owner.token, body: { disabled: true } });

    if (off.status === 200) check('and reads as off', off.body.data.coupon.disabled === true);

    await expectStatus('after which the checkout refuses it', 400, 'POST', '/api/checkout',
                       { token: shopper.token,
                         body: buy([{ productId: cheap.id, qty: 1 }], { coupon: shipCode }) });
  }

  /* --- one nobody used --------------------------------------------------- */

  const spare = await expectStatus('a coupon nobody has used', 200, 'POST',
                                   '/api/admin/coupons', {
    token: owner.token,
    body: { code: 'VERIFYSPARE' + stamp, type: 'percent', value: 10, minSpend: 500 }
  });

  if (spare.status === 200) {
    const id = spare.body.data.coupon.id;
    madeCoupons.push(spare.body.data.coupon.code);

    const listed = await expectStatus('GET /api/admin/coupons', 200, 'GET',
                                      '/api/admin/coupons', owner);

    check('it is in the list', (listed.body.data.items || []).some((c) => c.id === id));

    await expectStatus('a customer cannot delete one', 403, 'DELETE',
                       '/api/admin/coupons/' + id, shopper);

    await expectStatus('and this one can be deleted', 200, 'DELETE',
                       '/api/admin/coupons/' + id, owner);

    await expectStatus('after which it is gone', 404, 'GET',
                       '/api/admin/coupons/' + id, owner);
  }

  /* =====================================================================
     16. Settings
     ---------------------------------------------------------------------
     The screen kept its answers in a variable a reload emptied, while the
     numbers that decide delivery sat in a table nobody could reach. This
     is that table.

     The last check in here is the whole point of the phase: change the
     delivery charge through the panel, place a real order, and see the new
     charge on it — decided by place_order, in SQL, not by anything the
     browser said.
     ===================================================================== */

  console.log('\n16. SETTINGS — the numbers the shop actually runs on');

  await expectStatus('a customer cannot read the settings', 403, 'GET',
                     '/api/admin/settings', shopper);

  await expectStatus('nor change what delivery costs', 403, 'PATCH',
                     '/api/admin/settings',
                     { token: shopper.token, body: { store: { shipping: { flat: 0 } } } });

  await expectStatus('a signed-out visitor cannot either', 401, 'GET',
                     '/api/admin/settings');

  const opened = await expectStatus('GET /api/admin/settings', 200, 'GET',
                                    '/api/admin/settings', owner);

  /* Everything below changes the live settings row, so what it was is
     captured here and put back at the end whatever happens. */
  const wasSettings = opened.status === 200 ? opened.body.data.settings : null;

  if (wasSettings) {
    check('it comes back in two named groups, and no others',
          keysOf(wasSettings) === 'notifications,store,updatedAt', keysOf(wasSettings));
    check('the delivery rule is always answered',
          Number.isInteger(wasSettings.store.shipping.flat) &&
          Number.isInteger(wasSettings.store.shipping.freeOver),
          JSON.stringify(wasSettings.store.shipping));
    check('and so is the low-stock level',
          Number.isInteger(wasSettings.store.lowStockAt) && wasSettings.store.lowStockAt > 0,
          'lowStockAt ' + wasSettings.store.lowStockAt);

    /* --- what will not be accepted -------------------------------------- */

    await expectStatus('a delivery charge that is a typo', 400, 'PATCH',
                       '/api/admin/settings',
                       { token: owner.token, body: { store: { shipping: { flat: 99999999 } } } });

    await expectStatus('half a rupee of delivery', 400, 'PATCH', '/api/admin/settings',
                       { token: owner.token, body: { store: { shipping: { flat: 2.5 } } } });

    await expectStatus('a negative delivery charge', 400, 'PATCH', '/api/admin/settings',
                       { token: owner.token, body: { store: { shipping: { flat: -100 } } } });

    await expectStatus('a low-stock level of zero', 400, 'PATCH', '/api/admin/settings',
                       { token: owner.token, body: { store: { lowStockAt: 0 } } });

    await expectStatus('a support address that is not one', 400, 'PATCH',
                       '/api/admin/settings',
                       { token: owner.token, body: { store: { supportEmail: 'not-an-address' } } });

    await expectStatus('nothing to change', 400, 'PATCH', '/api/admin/settings',
                       { token: owner.token, body: {} });

    await expectStatus('a section this endpoint does not keep', 400, 'PATCH',
                       '/api/admin/settings',
                       { token: owner.token,
                         body: { appearance: { density: 'compact' } } });

    /* --- one section at a time ------------------------------------------ */

    const named = await expectStatus('the shop is given a name', 200, 'PATCH',
                                     '/api/admin/settings', {
      token: owner.token,
      body: { store: { name: 'Verify Shop ' + stamp } }
    });

    if (named.status === 200) {
      check('SAVING THE NAME LEFT THE DELIVERY RULE ALONE',
            named.body.data.settings.store.shipping.flat === wasSettings.store.shipping.flat &&
            named.body.data.settings.store.shipping.freeOver === wasSettings.store.shipping.freeOver,
            JSON.stringify(named.body.data.settings.store.shipping));
    }

    const halfShipping = await expectStatus('only the delivery charge is changed', 200, 'PATCH',
                                            '/api/admin/settings', {
      token: owner.token,
      body: { store: { shipping: { flat: 111 } } }
    });

    if (halfShipping.status === 200) {
      const s = halfShipping.body.data.settings.store;

      check('AND THE THRESHOLD BESIDE IT SURVIVED',
            s.shipping.freeOver === wasSettings.store.shipping.freeOver,
            'freeOver ' + s.shipping.freeOver);
      check('as did the name saved a moment ago',
            s.name === 'Verify Shop ' + stamp, s.name);
    }

    /* A role is dropped rather than stored. Nothing here grants anything,
       and a field called "role" in a settings record would be the most
       plausible-looking place to try. */
    const smuggled = await expectStatus('a role smuggled into the store record', 200, 'PATCH',
                                        '/api/admin/settings',
                                        { token: owner.token,
                                          body: { store: { role: 'admin', city: 'Lahore' } } });

    if (smuggled.status === 200) {
      check('THE ROLE WAS NOT STORED',
            !('role' in smuggled.body.data.settings.store),
            keysOf(smuggled.body.data.settings.store));
      check('and the field beside it was', smuggled.body.data.settings.store.city === 'Lahore');
    }

    /* --- the notifications, which are still only recorded ---------------- */

    const noticed = await expectStatus('the notification choices are saved', 200, 'PATCH',
                                       '/api/admin/settings', {
      token: owner.token,
      body: { notifications: { newOrder: false, lowStock: true,
                               sendTo: 'shop-' + stamp + '@verify.invalid' } }
    });

    if (noticed.status === 200) {
      const n = noticed.body.data.settings.notifications;
      check('they read back as they were set',
            n.newOrder === false && n.lowStock === true &&
            n.sendTo === 'shop-' + stamp + '@verify.invalid',
            JSON.stringify(n));
      check('and the store section was not touched',
            noticed.body.data.settings.store.city === 'Lahore');
    }

    /* =====================================================================
       AND NOW THE ONE THAT MATTERS
       ===================================================================== */

    await expectStatus('the owner sets a new delivery charge', 200, 'PATCH',
                       '/api/admin/settings', {
      token: owner.token,
      body: { store: { shipping: { flat: 377, freeOver: 900000 } } }
    });

    {
      /* What a shopper is quoted before ordering. Read as the shopper, from
         the endpoint the checkout page actually calls. */
      const quoted = await call('GET', '/api/checkout', shopper);

      check('THE CHECKOUT PAGE QUOTES THE NEW CHARGE',
            quoted.body.data && quoted.body.data.shipping &&
            quoted.body.data.shipping.flat === 377,
            JSON.stringify(quoted.body.data && quoted.body.data.shipping));
    }

    const priced = await expectStatus('and a real order is placed', 200, 'POST',
                                      '/api/checkout', {
      token: shopper.token,
      body: buy([{ productId: cheap.id, qty: 1 }])
    });

    if (priced.status === 200) {
      const o = priced.body.data.order;
      madeOrders.push(o.id);

      check('THE ORDER WAS CHARGED THE NEW DELIVERY, DECIDED IN SQL',
            o.shipping === 377, 'shipping ' + o.shipping);
      check('and the total is the goods plus that',
            o.total === o.subtotal + 377, o.total + ' vs ' + (o.subtotal + 377));
    }

    /* The threshold is real too: at 900000 nothing in this shop qualifies,
       so the order above was charged despite being over the old 5,000. */
    check('nothing qualified for free delivery at that threshold',
          priced.status !== 200 || priced.body.data.order.shipping > 0);

    /* --- put the shop back exactly as it was ---------------------------- */

    const back = await call('PATCH', '/api/admin/settings', {
      token: owner.token,
      body: {
        store: {
          /* Sent only where there is something to send: the endpoint
             requires a name when one is given, and this row may never have
             had one. */
          tagline: wasSettings.store.tagline,
          phone: wasSettings.store.phone,
          address: wasSettings.store.address,
          city: wasSettings.store.city,
          lowStockAt: wasSettings.store.lowStockAt,
          shipping: wasSettings.store.shipping
        }
      }
    });

    check('the settings are put back as they were found',
          back.status === 200 &&
          back.body.data.settings.store.shipping.flat === wasSettings.store.shipping.flat &&
          back.body.data.settings.store.shipping.freeOver === wasSettings.store.shipping.freeOver &&
          back.body.data.settings.store.lowStockAt === wasSettings.store.lowStockAt,
          back.status + ' ' + JSON.stringify(back.body.data && back.body.data.settings.store));

    /* The name and the support address are cleared straight through the
       service key: the endpoint will not take an empty name, deliberately,
       and this run must not leave "Verify Shop" as the shop's name. */
    await admin.from('settings').update({
      store: wasSettings.store.name || wasSettings.store.supportEmail
        ? {
            name: wasSettings.store.name,
            tagline: wasSettings.store.tagline,
            supportEmail: wasSettings.store.supportEmail,
            phone: wasSettings.store.phone,
            address: wasSettings.store.address,
            city: wasSettings.store.city,
            lowStockAt: wasSettings.store.lowStockAt,
            shipping: wasSettings.store.shipping
          }
        : { shipping: wasSettings.store.shipping,
            lowStockAt: wasSettings.store.lowStockAt },
      notifications: wasSettings.notifications.sendTo ? wasSettings.notifications : {}
    }).eq('id', true);

    const finally_ = await call('GET', '/api/admin/settings', owner);

    check('AND THE SHOP IS NOT LEFT NAMED AFTER A TEST RUN',
          (finally_.body.data.settings.store.name || '').indexOf('Verify Shop') < 0,
          finally_.body.data.settings.store.name);
  }

  /* =====================================================================
     17. The shop's own details, on the shop's own pages
     ---------------------------------------------------------------------
     The footer used to carry an invented mailbox at haveli.example and a
     phone number nobody answers, written into data/footer.js. A customer
     reading a footer cannot tell an invented address from a real one, so
     they are gone, and GET /api/shop serves the owner's instead.

     The two things worth proving: a signed-out visitor can read it, and
     it publishes the named fields rather than whatever else is in the
     settings record.
     ===================================================================== */

  console.log('\n17. THE SHOP — what the storefront is allowed to know');

  {
    /* Something to look for, set through the panel the way the owner does. */
    const phone = '+92 300 ' + String(stamp).slice(-7);

    await expectStatus('the owner fills in the shop’s details', 200, 'PATCH',
                       '/api/admin/settings', {
      token: owner.token,
      body: { store: { name: 'Verify Shop ' + stamp,
                       tagline: 'Verify tagline ' + stamp,
                       supportEmail: 'shop-' + stamp + '@verify.invalid',
                       phone: phone,
                       lowStockAt: 7 } }
    });

    const seen = await expectStatus('A SIGNED-OUT VISITOR CAN READ THEM', 200, 'GET',
                                    '/api/shop');

    if (seen.status === 200) {
      const shop = seen.body.data.shop;

      check('the name and tagline are published',
            shop.name === 'Verify Shop ' + stamp &&
            shop.tagline === 'Verify tagline ' + stamp,
            JSON.stringify(shop));
      check('so is how to reach the shop',
            shop.email === 'shop-' + stamp + '@verify.invalid' && shop.phone === phone,
            shop.email + ' / ' + shop.phone);

      /* The named list, and nothing beyond it. A field added to the
         settings record later must not be published by having been added. */
      check('AND NOTHING ELSE FROM THE SETTINGS RECORD IS',
            keysOf(shop) === 'address,city,email,name,phone,tagline', keysOf(shop));
      check('the low-stock level in particular is not public',
            !('lowStockAt' in shop), keysOf(shop));
      check('nor the delivery rule, which has its own endpoint',
            !('shipping' in shop), keysOf(shop));
      check('nor anything about notifications',
            !('notifications' in shop) && !('sendTo' in shop), keysOf(shop));
    }

    await expectStatus('and it is a read-only endpoint', 405, 'PATCH', '/api/shop',
                       { token: owner.token, body: { name: 'Nope' } });

    /* Cleared straight through the service key: the endpoint will not take
       an empty name, deliberately, and this run must not leave the shop
       named after a test. */
    await admin.from('settings')
      .update({ store: { shipping: { flat: 250, freeOver: 5000 }, lowStockAt: 10 },
                notifications: {} })
      .eq('id', true);

    const cleared = await call('GET', '/api/shop');

    check('THE SHOP IS NOT LEFT NAMED AFTER A TEST RUN',
          cleared.body.data.shop.name.indexOf('Verify Shop') < 0,
          cleared.body.data.shop.name);
    check('and an unset detail comes back empty rather than invented',
          cleared.body.data.shop.email === '' && cleared.body.data.shop.phone === '',
          JSON.stringify(cleared.body.data.shop));
  }

  /* =====================================================================
     18. Saved addresses
     ---------------------------------------------------------------------
     The addresses table has existed since Phase 1 and been empty since
     Phase 1. These are the endpoints that fill it.

     The two that matter are at the end: another customer cannot reach one
     of these rows, and deleting one does not change an order that shipped
     to it. The second is what makes the first safe to offer at all — an
     address book you cannot clear out without rewriting history is not one
     anybody should be given.
     ===================================================================== */

  console.log('\n18. ADDRESSES — the customer’s own, and only theirs');

  await expectStatus('a signed-out visitor cannot list them', 401, 'GET',
                     '/api/account/addresses');

  await expectStatus('nor save one', 401, 'POST', '/api/account/addresses',
                     { body: { name: 'X', phone: '03001234567',
                               line1: '1 Street', city: 'Karachi' } });

  {
    const empty = await expectStatus('a new customer has none', 200, 'GET',
                                     '/api/account/addresses', shopper);

    check('an empty book is an empty list, not an error',
          empty.body.data.total === 0 && Array.isArray(empty.body.data.items),
          JSON.stringify(empty.body.data));
  }

  /* --- what will not be saved ------------------------------------------- */

  await expectStatus('an address with no city', 400, 'POST', '/api/account/addresses',
                     { token: shopper.token,
                       body: { name: 'Verify Buyer', phone: '03001234567',
                               line1: '1 Test Street' } });

  await expectStatus('a phone number made of words', 400, 'POST',
                     '/api/account/addresses',
                     { token: shopper.token,
                       body: { name: 'Verify Buyer', phone: 'call me',
                               line1: '1 Test Street', city: 'Karachi' } });

  /* --- the first one is the default ------------------------------------- */

  const home = await expectStatus('the first address is saved', 200, 'POST',
                                  '/api/account/addresses', {
    token: shopper.token,
    body: { label: 'Home', name: 'Verify Buyer', phone: '03001234567',
            line1: '1 Test Street', line2: 'Block A', city: 'Karachi',
            postalCode: '75500' }
  });

  if (home.status === 200) {
    const row = home.body.data.address;
    madeAddresses.push(row.id);

    check('THE FIRST ONE IS THE DEFAULT WITHOUT BEING ASKED',
          row.isDefault === true, JSON.stringify(row));
    check('it comes back in the checkout form’s own vocabulary',
          keysOf(row) === 'city,created,id,isDefault,label,line1,line2,name,phone,postcode',
          keysOf(row));
    check('the postcode survived the rename',
          row.postcode === '75500', row.postcode);

    const office = await expectStatus('a second address', 200, 'POST',
                                      '/api/account/addresses', {
      token: shopper.token,
      body: { label: 'Office', name: 'Verify Buyer', phone: '03009999999',
              line1: '9 Work Road', city: 'Lahore' }
    });

    if (office.status === 200) {
      const second = office.body.data.address;
      madeAddresses.push(second.id);

      check('DOES NOT STEAL THE DEFAULT', second.isDefault === false,
            JSON.stringify(second));

      const listed = await call('GET', '/api/account/addresses', shopper);

      check('the default is listed first',
            listed.body.data.items[0].id === row.id, listed.body.data.items[0].label);

      /* --- moving the default ------------------------------------------ */

      await expectStatus('the second is made the default', 200, 'PATCH',
                         '/api/account/addresses/' + second.id,
                         { token: shopper.token, body: { isDefault: true } });

      const moved = await call('GET', '/api/account/addresses', shopper);
      const defaults = moved.body.data.items.filter((a) => a.isDefault);

      check('THERE IS EXACTLY ONE DEFAULT AFTERWARDS',
            defaults.length === 1 && defaults[0].id === second.id,
            JSON.stringify(moved.body.data.items.map((a) => a.label + (a.isDefault ? '*' : ''))));
      check('and it moved to the top of the list',
            moved.body.data.items[0].id === second.id);

      await expectStatus('turning the default off is refused', 400, 'PATCH',
                         '/api/account/addresses/' + second.id,
                         { token: shopper.token, body: { isDefault: false } });

      /* --- editing ------------------------------------------------------ */

      const fixed = await expectStatus('a phone number is corrected', 200, 'PATCH',
                                       '/api/account/addresses/' + row.id,
                                       { token: shopper.token,
                                         body: { phone: '03211112223' } });

      if (fixed.status === 200) {
        check('only that field changed',
              fixed.body.data.address.phone === '03211112223' &&
              fixed.body.data.address.line1 === '1 Test Street' &&
              fixed.body.data.address.city === 'Karachi',
              JSON.stringify(fixed.body.data.address));
      }

      await expectStatus('nothing to change', 400, 'PATCH',
                         '/api/account/addresses/' + row.id,
                         { token: shopper.token, body: {} });

      await expectStatus('an id that is not an id', 400, 'GET',
                         '/api/account/addresses/not-a-uuid', shopper);

      /* --- and the reason the policy is there --------------------------- */

      await expectStatus('ANOTHER CUSTOMER CANNOT READ IT', 404, 'GET',
                         '/api/account/addresses/' + row.id, owner);

      await expectStatus('NOR EDIT IT', 404, 'PATCH',
                         '/api/account/addresses/' + row.id,
                         { token: owner.token, body: { city: 'Taken' } });

      await expectStatus('NOR DELETE IT', 404, 'DELETE',
                         '/api/account/addresses/' + row.id, owner);

      {
        /* Including the shop's owner, who has no wider policy here — unlike
           orders, where they do. The panel has no screen for this and must
           not gain one by accident. */
        const mine = await call('GET', '/api/account/addresses/' + row.id, shopper);
        check('and it is untouched', mine.body.data.address.city === 'Karachi',
              mine.body.data.address.city);

        const theirs = await call('GET', '/api/account/addresses', owner);
        check('an administrator’s own book holds only their own',
              (theirs.body.data.items || []).every((a) => a.id !== row.id),
              theirs.body.data.total + ' rows');
      }

      /* --- ordering to one, then deleting it ---------------------------- */

      /* Restocked first. Sections 8 and 15 between them bought every one
         of the five this product started with, and an order that cannot be
         placed would make the check below pass for having nothing to
         prove. */
      await call('PATCH', '/api/admin/products/' + cheap.id,
                 { token: owner.token, body: { stock: 5 } });

      const sent = await expectStatus('an order is placed to a saved address', 200,
                                      'POST', '/api/checkout', {
        token: shopper.token,
        body: Object.assign({
          items: [{ productId: cheap.id, qty: 1 }]
        }, {
          name: row.name, phone: '03211112223', line1: row.line1,
          line2: row.line2, city: row.city, postcode: row.postcode
        })
      });

      if (sent.status === 200) {
        madeOrders.push(sent.body.data.order.id);

        await expectStatus('the address is then deleted', 200, 'DELETE',
                           '/api/account/addresses/' + row.id, shopper);

        madeAddresses.splice(madeAddresses.indexOf(row.id), 1);

        const still = await call('GET', '/api/account/orders?ref=' +
                                 encodeURIComponent(sent.body.data.order.ref), shopper);

        check('AND THE ORDER STILL SAYS WHERE IT WENT',
              still.body.data.order.address.line1 === '1 Test Street' &&
              still.body.data.order.address.city === 'Karachi',
              JSON.stringify(still.body.data.order.address));
      }

      await expectStatus('and the deleted address is gone', 404, 'GET',
                         '/api/account/addresses/' + row.id, shopper);

      const left = await call('GET', '/api/account/addresses', shopper);
      check('the other one is still there', left.body.data.total === 1,
            left.body.data.total + ' rows');
    }
  }

} catch (err) {
  fail('the run stopped: ' + err.message);
} finally {
  console.log('\nRemoving what this run created...');

  /* By id, every time. A cleanup that matched on a name pattern could reach
     a row the shop owner had added. */
  /* Orders first: an order line points at a product, so a product cannot
     go while one still does. */
  for (const id of madeOrders) {
    await admin.from('order_items').delete().eq('order_id', id);
    await admin.from('orders').delete().eq('id', id);
  }
  for (const code of madeCoupons) {
    await admin.from('coupons').delete().eq('code', code);
  }
  for (const id of madeBanners) {
    await admin.from('banners').delete().eq('id', id);
  }
  for (const id of madeAddresses) {
    await admin.from('addresses').delete().eq('id', id);
  }
  /* The pictures this run put in the bucket. Nothing else removes them: a
     slide's delete deliberately leaves its file alone, because two slides
     can name the same one. */
  if (madeUploads.length) {
    await admin.storage.from('shop-images').remove(madeUploads).catch(() => {});
  }
  for (const id of madeProducts) {
    await admin.from('product_images').delete().eq('product_id', id);
    await admin.from('products').delete().eq('id', id);
  }
  for (const id of madeCategories) {
    await admin.from('categories').delete().eq('id', id);
  }
  for (const id of madeUsers) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }

  const { count: p } = await admin.from('products').select('*', { count: 'exact', head: true });
  const { count: c } = await admin.from('categories').select('*', { count: 'exact', head: true });
  console.log('  products: ' + p + '   categories: ' + c);
}

console.log('');
if (failures) {
  console.error(failures + ' check(s) failed\n');
  process.exit(1);
}
console.log('the API does what it says\n');
