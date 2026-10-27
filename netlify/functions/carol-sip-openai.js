'use strict';

const { createStore } = require('./lib/pma-sip-store');
const { createService, signControl } = require('./lib/carol-sip-server');

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' }, body: JSON.stringify({ error: 'POST only' }) };
  try {
    const raw = Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'utf8');
    if (raw.length > 65536) throw new Error('PAYLOAD_TOO_LARGE');
    const store = createStore(process.env);
    const service = createService({
      env: process.env,
      store,
      log: (name) => console.info(JSON.stringify({ event: name })),
      dispatchControl: async (binding) => {
        const body = JSON.stringify(binding);
        const response = await fetch(`${process.env.PMA_BASE_URL}/.netlify/functions/carol-sip-control-background`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-carol-control-signature': signControl(body, process.env.PMA_SIP_CONTROL_SECRET) },
          body,
          signal: AbortSignal.timeout(5000),
        });
        if (response.status !== 202) throw new Error('CONTROL_NOT_ACCEPTED');
      },
    });
    const result = await service.handle(raw, Object.fromEntries(Object.entries(event.headers || {}).map(([key, value]) => [key.toLowerCase(), value])));
    return { statusCode: result.statusCode, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' }, body: JSON.stringify(result.body) };
  } catch {
    console.error(JSON.stringify({ event: 'carol_sip_webhook_failed' }));
    return { statusCode: 503, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' }, body: JSON.stringify({ error: 'SIP setup unavailable' }) };
  }
};
