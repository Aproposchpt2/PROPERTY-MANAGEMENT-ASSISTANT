'use strict';

const { createClient } = require('@supabase/supabase-js');

// In-process rate limiter — not globally shared across Lambda instances (best-effort).
const _rl = new Map();
const RL_MAX = 60, RL_WINDOW = 60_000;
function checkRate(key) {
  const now = Date.now();
  const e = _rl.get(key);
  if (!e || e.r <= now) { _rl.set(key, { c: 1, r: now + RL_WINDOW }); return true; }
  if (e.c >= RL_MAX) return false;
  e.c++; return true;
}

async function verifyManager(event, env) {
  const authHeader = (event.headers || {})['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) return { statusCode: 401, error: 'Unauthorized' };
  const token = authHeader.slice(7);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 503, error: 'Database unavailable' };
  }
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authErr } = await db.auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, error: 'Unauthorized' };
  if (!checkRate(user.id)) return { statusCode: 429, error: 'Too many requests' };
  const { data: tu, error: tuErr } = await db
    .from('tenant_users')
    .select('id, role, status')
    .eq('user_id', user.id)
    .eq('tenant_id', env.PMA_TENANT_ID)
    .eq('status', 'ACTIVE')
    .single();
  if (tuErr || !tu) return { statusCode: 403, error: 'Forbidden' };
  if (!['OWNER', 'ADMIN', 'MANAGER'].includes(tu.role)) {
    return { statusCode: 403, error: 'Forbidden' };
  }
  let allowedPropertyIds;
  if (tu.role === 'OWNER' || tu.role === 'ADMIN') {
    const { data: props } = await db
      .from('pma_properties')
      .select('id')
      .eq('tenant_id', env.PMA_TENANT_ID)
      .eq('status', 'active');
    allowedPropertyIds = (props || []).map(x => x.id);
  } else {
    const { data: access } = await db
      .from('pma_staff_property_access')
      .select('property_id')
      .eq('tenant_user_id', tu.id);
    allowedPropertyIds = (access || []).map(x => x.property_id);
  }
  return {
    authUserId: user.id,
    tenantUserId: tu.id,
    role: tu.role,
    allowedPropertyIds,
  };
}

module.exports = { verifyManager };
