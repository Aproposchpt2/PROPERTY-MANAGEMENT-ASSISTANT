'use strict';

const { createStore } = require('./lib/pma-sip-store');
const { createService, verifyControl } = require('./lib/carol-sip-server');

exports.handler = async function handler(event) {
  const raw = Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'utf8').toString('utf8');
  const signature = event.headers?.['x-carol-control-signature'] || event.headers?.['X-Carol-Control-Signature'];
  const binding = verifyControl(raw, signature, process.env.PMA_SIP_CONTROL_SECRET);
  const service = createService({ env: process.env, store: createStore(process.env), log: (name) => console.info(JSON.stringify({ event: name })) });
  if (!service.enabled()) throw new Error('SIP_VALIDATION_DISABLED');
  await service.run(binding);
  return { statusCode: 200 };
};
