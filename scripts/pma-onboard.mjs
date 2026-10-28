#!/usr/bin/env node
// Local-only onboarding script. Never committed with secrets.
// Usage: node scripts/pma-onboard.mjs --email user@example.com --role MANAGER [--property <id>]
// Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PMA_TENANT_ID, PMA_PROPERTY_ID
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
function arg(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; }

const email = arg('--email');
const role = (arg('--role') || 'MANAGER').toUpperCase();
const propertyId = arg('--property') || process.env.PMA_PROPERTY_ID;

if (!email) { console.error('Usage: node scripts/pma-onboard.mjs --email <email> [--role OWNER|ADMIN|MANAGER|AGENT|VIEWER] [--property <id>]'); process.exit(1); }
const VALID_ROLES = new Set(['OWNER', 'ADMIN', 'MANAGER', 'AGENT', 'VIEWER']);
if (!VALID_ROLES.has(role)) { console.error('Invalid role:', role); process.exit(1); }

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TENANT_ID = process.env.PMA_TENANT_ID;
if (!SUPABASE_URL || !SERVICE_KEY || !TENANT_ID) { console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PMA_TENANT_ID'); process.exit(1); }

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

console.log(`Onboarding ${email} as ${role}…`);

// Invite user (creates auth.users record if not exists; shouldCreateUser is admin override)
const { data: invite, error: invErr } = await db.auth.admin.inviteUserByEmail(email, {
  redirectTo: 'https://pma.stellaruc.com/manager',
  data: { pma_tenant_id: TENANT_ID, pma_role: role },
});
if (invErr && !invErr.message?.includes('already been invited') && !invErr.message?.includes('already registered')) {
  console.error('Invite failed:', invErr.message);
  process.exit(1);
}
const userId = invite?.user?.id || null;
console.log('Auth user:', userId || '(already exists — looking up)');

// Resolve user id if invite returned nothing
let resolvedId = userId;
if (!resolvedId) {
  const { data: { users }, error: listErr } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) { console.error('Could not list users:', listErr.message); process.exit(1); }
  const match = users.find(u => u.email === email);
  if (!match) { console.error('User not found after invite — try again in a moment.'); process.exit(1); }
  resolvedId = match.id;
  console.log('Resolved user id:', resolvedId);
}

// Upsert tenant_users row
const { data: tu, error: tuErr } = await db
  .from('tenant_users')
  .upsert({ user_id: resolvedId, tenant_id: TENANT_ID, role, status: 'INVITED' }, { onConflict: 'user_id,tenant_id', ignoreDuplicates: false })
  .select('id')
  .single();
if (tuErr) { console.error('tenant_users upsert failed:', tuErr.message); process.exit(1); }
console.log('tenant_users row id:', tu.id);

// For MANAGER role: link to property
if (role === 'MANAGER' && propertyId) {
  const { error: paErr } = await db
    .from('pma_staff_property_access')
    .upsert({ tenant_user_id: tu.id, property_id: propertyId }, { onConflict: 'tenant_user_id,property_id', ignoreDuplicates: true });
  if (paErr) { console.error('Property access link failed:', paErr.message); process.exit(1); }
  console.log('Property access linked:', propertyId);
}

console.log(`Done. ${email} is now ${role} on tenant ${TENANT_ID}. They will receive an invite email.`);
