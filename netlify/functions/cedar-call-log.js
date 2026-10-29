'use strict';

// Authenticated read endpoint: returns PMA voice call summary stats and recent calls.
// Requires a valid manager Bearer token (verifyManager — OWNER, ADMIN, or MANAGER role).
// Consumed by the Manager Dashboard and BDMS Command Center (must pass Bearer token).

const { createStore } = require('./lib/cedar-store');
const { verifyManager } = require('./lib/pma-auth');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Cache-Control': 'private, no-store',
};

function json(statusCode, body) {
  return { statusCode, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return json(405, { success: false, error: 'Method Not Allowed' });
  }

  const auth = await verifyManager(event, process.env);
  if (auth.statusCode) {
    return json(auth.statusCode, { success: false, error: auth.error });
  }

  try {
    const store = createStore();
    const result = await store.callLogSummary();
    return json(200, result);
  } catch (err) {
    console.error('[cedar-call-log] error:', err.message);
    return json(500, { success: false, error: 'UNAVAILABLE' });
  }
};
