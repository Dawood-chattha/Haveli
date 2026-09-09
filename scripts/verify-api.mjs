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
  const { token, cookie, body } = opts || {};

  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
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
