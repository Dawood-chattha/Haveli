/* =========================================================================
   scripts/verify-auth.mjs — prove the policies do what they say
   -------------------------------------------------------------------------
   Run with:  npm run verify:auth

   Policies are prose until something tries to get past them. This creates two
   throwaway accounts — one ordinary customer, one administrator — asks each of
   them for things they should and should not have, and reports what actually
   happened.

   IT TESTS WHAT SHOULD FAIL, NOT ONLY WHAT SHOULD WORK
   A test suite that only checks the happy path would pass with every policy
   deleted. Most of what follows is the other kind: a customer reading someone
   else's order, a customer making themselves an administrator, a signed-out
   visitor writing a product. Each of those has to be refused, and a refusal is
   the passing result.

   THE ACCOUNTS ARE TEMPORARY AND ARE DELETED AT THE END
   Their addresses are @verify.invalid — a reserved domain that can never
   receive mail — and their passwords are random bytes generated here, used
   once, and never written to disk. They are removed in a finally block so an
   assertion failure part-way through does not leave them behind.
   ========================================================================= */

import { createClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'node:crypto';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !svcKey) {
  console.error('\nAll three Supabase variables must be set.\n');
  process.exit(1);
}

const admin = createClient(url, svcKey, { auth: { persistSession: false } });

let failures = 0;
const pass = (m) => console.log('  ok      ' + m);
const fail = (m) => { failures++; console.error('  FAIL    ' + m); };

/** A client acting as one signed-in person. */
function as(token) {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: 'Bearer ' + token } }
  });
}

/* Two separate clients, and keeping them separate matters.
 *
 * supabase-js holds a session on the client instance after a successful sign
 * in — `persistSession: false` stops it reaching storage, not memory. The
 * first version of this file signed all three people in through the same
 * client it then used for the signed-out checks, so "anonymous" was actually
 * the last person who had signed in, and "a signed-out visitor can read
 * profiles" was reported as a policy failure when it was nothing of the kind.
 *
 * `signer` does the signing in. `anon` is never authenticated and stays what
 * its name claims. */
const anon = createClient(url, anonKey, { auth: { persistSession: false } });
const signer = createClient(url, anonKey, { auth: { persistSession: false } });

/** Expect rows back. */
async function canRead(label, client, table, filter) {
  let q = client.from(table).select('*').limit(1);
  if (filter) q = filter(q);
  const { data, error } = await q;

  if (error) fail(label + ' — refused (' + (error.code || error.message) + ')');
  else if (!data.length) fail(label + ' — allowed but returned nothing');
  else pass(label);
}

/** Expect no rows and no access. */
async function cannotRead(label, client, table) {
  const { data, error } = await client.from(table).select('*').limit(1);

  if (error) pass(label + ' — refused (' + (error.code || 'error') + ')');
  else if (!data.length) pass(label + ' — returned nothing');
  else fail(label + ' — RETURNED DATA IT SHOULD NOT HAVE');
}

/**
 * Expect an INSERT to be rejected outright.
 *
 * An insert that no policy permits fails loudly, because the row it would
 * create violates the WITH CHECK. That is not true of updates — see below.
 */
async function cannotWrite(label, run) {
  const { error } = await run();
  if (error) pass(label + ' — refused (' + (error.code || 'error') + ')');
  else fail(label + ' — THE WRITE WAS ACCEPTED');
}

/**
 * Expect an UPDATE to change nothing.
 *
 * AN UPDATE REFUSED BY ROW LEVEL SECURITY DOES NOT RETURN AN ERROR.
 *
 * This is the single most surprising thing in this file, and it caught this
 * test suite before it caught anything else. A policy's USING clause decides
 * which rows the statement can SEE; a row it cannot see is simply not part of
 * the update. So `update ... where id = <someone else's>` matches zero rows,
 * changes nothing, and reports success. Postgres is behaving correctly — no
 * rows needed changing — but "no error" reads like "it worked".
 *
 * The security consequence is nil: nothing was written. The consequence for
 * the code above it is not, and Phase 4 onward depends on knowing this. An
 * endpoint that issues an update and returns 200 because there was no error
 * will cheerfully tell an administrator their change was saved when a policy
 * discarded it. Every such endpoint has to check how many rows came back.
 *
 * So this helper asserts what actually matters — the value did not change —
 * rather than the presence of an error that was never going to arrive. It
 * reads the row back with the service role, which sees the truth regardless
 * of policy.
 */
async function cannotChange(label, run, table, id, field, expected) {
  const { error } = await run();

  const { data } = await admin.from(table).select(field).eq('id', id).single();
  const actual = data ? data[field] : undefined;

  if (actual !== expected) {
    fail(label + ' — THE VALUE CHANGED to ' + JSON.stringify(actual));
    return;
  }

  pass(label + (error ? ' — refused (' + (error.code || 'error') + ')'
                      : ' — no error, but nothing changed'));
}

async function canWrite(label, run) {
  const { error } = await run();
  if (error) fail(label + ' — refused (' + (error.code || error.message) + ')');
  else pass(label);
}

/* ------------------------------------------------------------------------- */

const stamp = Date.now();
const people = {
  customer: { email: 'customer-' + stamp + '@verify.invalid', password: randomBytes(24).toString('hex') },
  admin: { email: 'admin-' + stamp + '@verify.invalid', password: randomBytes(24).toString('hex') },
  other: { email: 'other-' + stamp + '@verify.invalid', password: randomBytes(24).toString('hex') }
};

const created = [];

try {

  /* Needed by the product-insert checks below; see the note there. */
  const { data: someCategory } = await admin.from('categories').select('id').limit(1).single();
  const realCategory = someCategory && someCategory.id;

  if (!realCategory) {
    throw new Error('no categories exist — run `npm run seed` first');
  }

  console.log('\nCreating three temporary accounts...');

  for (const [role, person] of Object.entries(people)) {
    const { data, error } = await admin.auth.admin.createUser({
      email: person.email,
      password: person.password,
      email_confirm: true            /* skip the confirmation link */
    });
    if (error) throw new Error('creating ' + role + ': ' + error.message);

    person.id = data.user.id;
    created.push(data.user.id);
  }

  /* The signup trigger should have made a profile for each, as a customer. */
  const { data: fresh } = await admin.from('profiles').select('id, role').in('id', created);
  if (fresh.length !== 3) fail('the signup trigger did not create a profile for every account');
  else if (fresh.some((p) => p.role !== 'customer')) fail('a new account was NOT created as a customer');
  else pass('all three accounts exist, all as "customer"');

  /* Promote one, the way scripts/make-admin.mjs does. */
  await admin.from('profiles').update({ role: 'admin' }).eq('id', people.admin.id);

  /* Give the customer an order, so "read someone else's order" has something
     real to fail to read. */
  const orderId = randomUUID();
  await admin.from('orders').insert({
    id: orderId, ref: 'VERIFY-' + stamp, user_id: people.customer.id,
    subtotal: 1000, discount: 0, shipping: 0, total: 1000,
    address: { city: 'Lahore' }
  });

  const tokens = {};
  for (const [role, person] of Object.entries(people)) {
    const { data, error } = await signer.auth.signInWithPassword({
      email: person.email, password: person.password
    });
    if (error) throw new Error('signing in as ' + role + ': ' + error.message);
    tokens[role] = data.session.access_token;
  }
  /* No sign-out. Signing out deletes the session at Supabase, and an access
     token names the session that issued it — so the last person signed in
     here would be left holding a token that verifies as nothing. It does not
     change the checks below, which reach PostgREST and are decided by the
     token's signature rather than by a session lookup, but it is a false
     precondition and it broke scripts/verify-api.mjs outright. `anon` is its
     own client and was never signed in, which is what actually keeps the
     signed-out checks honest. */
  pass('all three can sign in');

  const customer = as(tokens.customer);
  const owner = as(tokens.admin);
  const other = as(tokens.other);

  /* ---------------------------------------------------------------------
     A visitor who has not signed in
     --------------------------------------------------------------------- */

  console.log('\n1. SIGNED OUT — the shop is open, the office is not');

  await canRead('reads categories', anon, 'categories');

  await cannotRead('cannot read profiles', anon, 'profiles');
  await cannotRead('cannot read orders', anon, 'orders');
  await cannotRead('cannot read coupons', anon, 'coupons');
  await cannotRead('cannot read payments', anon, 'payments');
  await cannotRead('cannot read settings', anon, 'settings');
  await cannotRead('cannot read addresses', anon, 'addresses');

  await cannotWrite('cannot create a category', () =>
    anon.from('categories').insert({ dept: 'men', slug: 'x-' + stamp, label: 'X' }));

  await cannotWrite('cannot create a banner', () =>
    anon.from('banners').insert({ image: 'x', alt: 'x' }));

  /* ---------------------------------------------------------------------
     A signed-in customer
     --------------------------------------------------------------------- */

  console.log('\n2. CUSTOMER — their own things, and nothing else');

  await canRead('reads their own profile', customer, 'profiles');
  await canRead('reads their own order', customer, 'orders');

  /* The decisive one. If this passes, the whole scheme is decorative. */
  await cannotWrite('CANNOT make themselves an admin', () =>
    customer.from('profiles').update({ role: 'admin' }).eq('id', people.customer.id));

  /* Blocked first, so this tests an actual change. The first version asked an
     unblocked customer to set blocked=false, which the trigger correctly let
     through because nothing was changing — and the test read that as a hole. */
  await admin.from('profiles').update({ blocked: true }).eq('id', people.customer.id);

  await cannotChange('CANNOT unblock themselves',
    () => customer.from('profiles').update({ blocked: false }).eq('id', people.customer.id),
    'profiles', people.customer.id, 'blocked', true);

  await admin.from('profiles').update({ blocked: false }).eq('id', people.customer.id);

  /* Equally decisive. An order the customer writes is an order they price. */
  await cannotWrite('CANNOT create an order', () =>
    customer.from('orders').insert({
      ref: 'FRAUD-' + stamp, user_id: people.customer.id,
      subtotal: 1, discount: 0, shipping: 0, total: 1, address: {}
    }));

  await cannotChange('CANNOT change an order status',
    () => customer.from('orders').update({ status: 'delivered' }).eq('id', orderId),
    'orders', orderId, 'status', 'pending');

  /* A REAL category id, not a random one.
     With a made-up id the products_set_dept trigger raises first and the
     insert never reaches the policy — the check would then pass with RLS
     switched off, which is the same trap this project already fell into once
     in Phase 2. A refusal here has to be 42501, not P0001. */
  await cannotWrite('CANNOT create a product', () =>
    customer.from('products').insert({
      category_id: realCategory, title: 'x', slug: 'x-' + stamp, price: 1
    }));

  await cannotWrite('CANNOT create a coupon', () =>
    customer.from('coupons').insert({ code: 'FREE-' + stamp, type: 'percent', value: 100 }));

  await cannotRead('cannot read coupons', customer, 'coupons');
  await cannotRead('cannot read settings', customer, 'settings');
  await cannotRead('cannot read payments', customer, 'payments');

  /* ---------------------------------------------------------------------
     A different customer
     --------------------------------------------------------------------- */

  console.log('\n3. ANOTHER CUSTOMER — cannot reach the first one');

  {
    const { data } = await other.from('orders').select('*').eq('id', orderId);
    if (data && data.length) fail('read another customer\'s ORDER');
    else pass('cannot read another customer\'s order');
  }

  {
    const { data } = await other.from('profiles').select('*').eq('id', people.customer.id);
    if (data && data.length) fail('read another customer\'s PROFILE');
    else pass('cannot read another customer\'s profile');
  }

  await cannotChange('cannot edit another customer\'s profile',
    () => other.from('profiles').update({ name: 'hacked' }).eq('id', people.customer.id),
    'profiles', people.customer.id, 'name', null);

  /* ---------------------------------------------------------------------
     The administrator
     --------------------------------------------------------------------- */

  console.log('\n4. ADMIN — the office opens');

  await canRead('reads all profiles', owner, 'profiles');
  await canRead('reads all orders', owner, 'orders');
  await canRead('reads settings', owner, 'settings');

  {
    const { data } = await owner.from('profiles').select('id').eq('id', people.customer.id);
    if (data && data.length) pass('reads another customer\'s profile');
    else fail('an admin could NOT read a customer profile — the customers screen would be empty');
  }

  await canWrite('creates a coupon', () =>
    owner.from('coupons').insert({ code: 'VERIFY-' + stamp, type: 'percent', value: 10 }));

  await canWrite('updates an order status', () =>
    owner.from('orders').update({ status: 'processing' }).eq('id', orderId));

  await canWrite('promotes a customer', () =>
    owner.from('profiles').update({ role: 'admin' }).eq('id', people.other.id));

  /* ---------------------------------------------------------------------
     A blocked administrator is not an administrator
     --------------------------------------------------------------------- */

  console.log('\n5. BLOCKED — a suspended admin loses the office');

  await admin.from('profiles').update({ blocked: true }).eq('id', people.admin.id);

  await cannotRead('a blocked admin cannot read settings', owner, 'settings');
  await cannotWrite('a blocked admin cannot write a product', () =>
    owner.from('products').insert({
      category_id: realCategory, title: 'x', slug: 'blocked-' + stamp, price: 1
    }));

} catch (err) {
  fail('the run stopped: ' + err.message);
} finally {
  console.log('\nRemoving the temporary accounts...');

  for (const id of created) {
    await admin.from('orders').delete().eq('user_id', id);
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
  await admin.from('coupons').delete().ilike('code', 'VERIFY-%');
  await admin.from('orders').delete().ilike('ref', 'VERIFY-%');

  const { count } = await admin.from('profiles').select('*', { count: 'exact', head: true });
  console.log('  profiles remaining: ' + count);
}

console.log('');
if (failures) {
  console.error(failures + ' check(s) failed\n');
  process.exit(1);
}
console.log('authorization verified\n');
