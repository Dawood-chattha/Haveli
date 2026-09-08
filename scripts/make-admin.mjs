/* =========================================================================
   scripts/make-admin.mjs — promote an account to administrator
   -------------------------------------------------------------------------
   Run with:  npm run make-admin -- you@example.com

   WHY THIS IS A SCRIPT AND NOT AN ENDPOINT
   There is no API route that grants admin, and there will not be one. The
   first administrator cannot be created through the application, because at
   that moment there is nobody with the authority to approve it — an endpoint
   that made an exception for "the first one" would be an endpoint that grants
   admin to whoever calls it first, which on a public URL is a race anyone can
   enter.

   So the first promotion happens from outside: from a machine that holds the
   service role key, which is to say from the owner's own computer. That key
   is the authority here, and it is the only thing that could be.

   Later administrators will be promoted by an existing one through the panel,
   under db/policies.sql's rule that only an admin may change a role.

   IT DOES NOT CREATE ACCOUNTS
   The person must already have signed up through the site, with their own
   password, which this script never sees and could not read. All it changes
   is one column.
   ========================================================================= */

import { createClient } from '@supabase/supabase-js';

const email = (process.argv[2] || '').trim().toLowerCase();

if (!email || !email.includes('@')) {
  console.error('\nUsage:  npm run make-admin -- you@example.com\n');
  console.error('The account must already exist — sign up on the site first.\n');
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('\nSUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

const found = await db
  .from('profiles')
  .select('id, email, name, role, blocked')
  .ilike('email', email)
  .maybeSingle();

if (found.error) {
  console.error('\nCould not read profiles: ' + found.error.message + '\n');
  process.exit(1);
}

if (!found.data) {
  console.error('\nNo account for ' + email);
  console.error('Sign up on the site first, then run this again.\n');
  process.exit(1);
}

if (found.data.role === 'admin' && !found.data.blocked) {
  console.log('\n' + email + ' is already an administrator.\n');
  process.exit(0);
}

/* A blocked account is not an administrator however its role reads — is_admin()
   checks both — so promoting one unblocks it too. Doing that silently would be
   wrong, hence the line below. */
if (found.data.blocked) {
  console.log('\nNote: this account was blocked. Promoting it also unblocks it.');
}

const updated = await db
  .from('profiles')
  .update({ role: 'admin', blocked: false })
  .eq('id', found.data.id)
  .select('id, email, role, blocked')
  .single();

if (updated.error) {
  console.error('\nCould not promote: ' + updated.error.message + '\n');
  process.exit(1);
}

console.log('\n' + updated.data.email + ' is now an administrator.');
console.log('  role    : ' + updated.data.role);
console.log('  blocked : ' + updated.data.blocked);
console.log('\nSign in at /admin/login.\n');
