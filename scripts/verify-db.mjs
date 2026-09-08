/* =========================================================================
   scripts/verify-db.mjs — prove the database is what the schema said
   -------------------------------------------------------------------------
   Run with:  npm run verify:db

   Applying db/schema.sql produces "Success. No rows returned", which says the
   statements parsed and ran. It does not say the database ended up in the
   state that was intended. These checks do.

   THE SECOND GROUP IS THE ONE THAT MATTERS
   Anyone can confirm that fourteen tables exist. The check worth having is
   the opposite: that the publishable key — the one that will sit in a browser
   where anybody can read it — can reach NOTHING. Row Level Security is on
   with no policies written, so every table must refuse it.

   If that check ever passes when it should fail, the shop's orders, customers
   and addresses are readable by the public, and no amount of correctness
   elsewhere makes up for it. So it is asserted rather than assumed, and it is
   re-run in every later phase: Phase 3 will add policies, and this is what
   proves each one opened only the door it meant to.
   ========================================================================= */

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !svcKey) {
  console.error('\nAll three Supabase variables must be set. Run: npm run verify:db\n');
  process.exit(1);
}

const admin = createClient(url, svcKey, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

let failures = 0;
const pass = (m) => console.log('  ok    ' + m);
const fail = (m) => { failures++; console.error('  FAIL  ' + m); };

const TABLES = [
  'profiles', 'categories', 'products', 'product_images', 'addresses',
  'carts', 'cart_items', 'wishlist_items', 'coupons', 'orders',
  'order_items', 'payments', 'banners', 'settings'
];

/* -------------------------------------------------------------------------
   1. The tables exist
   ------------------------------------------------------------------------- */

console.log('\n1. tables exist and are readable by the server');

const counts = {};
for (const table of TABLES) {
  const { count, error } = await admin.from(table).select('*', { count: 'exact', head: true });
  if (error) fail(table + ': ' + error.message);
  else { counts[table] = count; pass(table.padEnd(15) + count + ' rows'); }
}

/* The view that replaces stored customer totals. */
{
  const { error } = await admin.from('customer_stats').select('*').limit(1);
  if (error) fail('customer_stats view: ' + error.message);
  else pass('customer_stats  (view)');
}

/* -------------------------------------------------------------------------
   2. The publishable key can reach nothing
   ------------------------------------------------------------------------- */

console.log('\n2. RLS is closed — the browser key must reach NOTHING');

for (const table of TABLES) {
  const { data, error } = await anon.from(table).select('*').limit(1);

  /* Two acceptable shapes for "denied": an explicit permission error, or a
     silent empty result. Postgres returns the latter for a select with no
     policy, which is why the row count is checked and not only the error. */
  if (error) pass(table.padEnd(15) + 'refused (' + (error.code || 'error') + ')');
  else if (Array.isArray(data) && data.length === 0) pass(table.padEnd(15) + 'returned nothing');
  else fail(table + ' RETURNED DATA TO THE PUBLIC KEY — RLS is not protecting it');
}

/* Writing must be refused too. A table that reads as empty but accepts an
   insert is not protected; it is a place for anyone to put anything.
 *
 * This probes `banners` rather than `products`, and the reason is a lesson
 * about tests. The first version inserted a product with a made-up category
 * id, and it was refused — but with code P0001, which is the products_set_dept
 * trigger raising "category does not exist". The trigger runs before the RLS
 * check, so the insert never reached the thing being tested. The check passed
 * while measuring nothing, which is the most dangerous kind of passing test:
 * it would have gone on passing if RLS had been switched off.
 *
 * `banners` has no BEFORE trigger and no foreign key, so a refusal there can
 * only have come from RLS.
 */
{
  const probe = 'rls-probe-' + Date.now();
  const { error } = await anon.from('banners').insert({ image: probe, alt: probe });

  if (error) pass('banners         insert refused (' + (error.code || 'error') + ')');
  else {
    fail('THE PUBLIC KEY CAN INSERT — RLS is not protecting writes');
    await admin.from('banners').delete().eq('image', probe);
  }
}

/* -------------------------------------------------------------------------
   3. The constraints actually hold
   -------------------------------------------------------------------------
   Tested through the service role, which bypasses RLS but NOT constraints —
   that is the distinction being demonstrated. A check constraint is the last
   defence when a bug in the server would otherwise write a bad row, so it
   should be proven rather than trusted.
   ------------------------------------------------------------------------- */

console.log('\n3. constraints reject bad rows even from the server');

async function mustReject(label, run) {
  const { error } = await run();
  if (error) pass(label + ' (' + (error.code || 'rejected') + ')');
  else fail(label + ' WAS ACCEPTED — the constraint is missing');
}

await mustReject('an order whose total does not add up', () =>
  admin.from('orders').insert({
    ref: 'PROBE-' + Date.now(),
    subtotal: 1000, discount: 0, shipping: 200,
    total: 999,                       /* should be 1200 */
    address: {}
  }));

/* The price check needs a category that exists, for the same reason the RLS
   probe above needed a table without a trigger: with a made-up category id the
   trigger rejects the row first and the price constraint is never reached.
   Skipped rather than faked when the categories table is still empty — a
   check that cannot run should say so, not quietly report success. */
{
  const { data: cat } = await admin.from('categories').select('id').limit(1);

  if (cat && cat.length) {
    await mustReject('a product with a negative price', () =>
      admin.from('products').insert({
        category_id: cat[0].id,
        title: 'probe', slug: 'probe-neg-' + Date.now(), price: -5
      }));

    await mustReject('a compare_at below the price', () =>
      admin.from('products').insert({
        category_id: cat[0].id,
        title: 'probe', slug: 'probe-cmp-' + Date.now(), price: 1000, compare_at: 500
      }));

    await mustReject('negative stock', () =>
      admin.from('products').insert({
        category_id: cat[0].id,
        title: 'probe', slug: 'probe-stk-' + Date.now(), price: 100, stock: -1
      }));
  } else {
    console.log('  skip  product constraints (no categories yet — run: npm run seed)');
  }
}

await mustReject('a profile with an invented role', () =>
  admin.from('profiles').insert({
    id: '00000000-0000-0000-0000-000000000001',
    email: 'probe@example.com', role: 'superuser'
  }));

await mustReject('an order with an unknown status', () =>
  admin.from('orders').insert({
    ref: 'PROBE2-' + Date.now(),
    status: 'almost-there',
    subtotal: 100, discount: 0, shipping: 0, total: 100, address: {}
  }));

await mustReject('a second settings row', () =>
  admin.from('settings').insert({ id: false }));

/* -------------------------------------------------------------------------
   4. The single settings row exists
   ------------------------------------------------------------------------- */

console.log('\n4. the settings row');

{
  const { data, error } = await admin.from('settings').select('id');
  if (error) fail('settings: ' + error.message);
  else if (data.length === 1) pass('exactly one settings row');
  else fail('expected exactly 1 settings row, found ' + data.length);
}

/* ------------------------------------------------------------------------- */

console.log('');
if (failures) {
  console.error(failures + ' check(s) failed\n');
  process.exit(1);
}
console.log('database verified\n');
