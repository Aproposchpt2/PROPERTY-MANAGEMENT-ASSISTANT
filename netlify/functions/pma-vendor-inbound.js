'use strict';

const { createClient } = require('@supabase/supabase-js');
const { sendVendorSms } = require('./lib/pma-sms');

const TWIML_HEADERS = {
  'content-type': 'text/xml',
  'cache-control': 'no-store',
};
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function twiml(body = '') {
  const text = body ? `<Message>${body}</Message>` : '';
  return { statusCode: 200, headers: TWIML_HEADERS, body: `<?xml version="1.0" encoding="UTF-8"?><Response>${text}</Response>` };
}

function makeRpc(env) {
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return async (name, args) => {
    const { data, error } = await db.rpc(name, args);
    if (error) throw new Error(`RPC_${error.code || 'FAILED'}: ${error.message}`);
    return data;
  };
}

function verifyTwilioSignature(env, event) {
  const twilio = require('twilio');
  const sig = (event.headers || {})['x-twilio-signature'] || '';
  if (!sig) return false;
  const host = (event.headers || {})['x-forwarded-proto'] + '://' + (event.headers || {})['host'];
  const url = host + event.path;
  let params = {};
  try { params = Object.fromEntries(new URLSearchParams(event.body || '')); } catch { return false; }
  return twilio.validateRequest(env.TWILIO_AUTH_TOKEN, sig, url, params);
}

exports.handler = async function handler(event) {
  const env = process.env;
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'content-type': 'text/plain' }, body: 'POST only' };
  }
  if (!verifyTwilioSignature(env, event)) {
    return { statusCode: 403, headers: { 'content-type': 'text/plain' }, body: 'Forbidden' };
  }

  let params = {};
  try { params = Object.fromEntries(new URLSearchParams(event.body || '')); } catch { return twiml(); }

  const from = params.From || '';
  const msgBody = (params.Body || '').trim().toUpperCase();

  if (!from) return twiml();
  const last4 = String(from).slice(-4);
  console.log(JSON.stringify({ event: 'pma_vendor_inbound', from_last4: last4 }));

  // Parse YES<CODE> or NO<CODE> pattern (short_code = 6 alphanumeric uppercase chars)
  const approvalMatch = msgBody.match(/^(YES|NO)([A-Z0-9]{6})$/);
  if (approvalMatch) {
    const responseWord = approvalMatch[1];
    const shortCode = approvalMatch[2];
    const response = responseWord === 'YES' ? 'APPROVED' : 'DECLINED';
    const rpc = makeRpc(env);
    try {
      const data = await rpc('pma_approval_respond_v1', { response, short_code: shortCode, token_hash: null });
      if (!data || !data.success) {
        const msg = data?.state === 'EXPIRED'
          ? 'This approval request has expired. Please contact your property manager.'
          : 'Could not find that request. It may already have been handled.';
        return twiml(msg);
      }
      const verb = response === 'APPROVED' ? 'approved' : 'declined';
      const reply = `Desert Ridge PMA: NTE $${Number(data.amount).toFixed(2)} for case #${data.caseNumber} has been ${verb}. Thank you.`;
      if (data.vendorPhone && response === 'APPROVED') {
        await sendVendorSms({
          to: data.vendorPhone,
          body: `PMA: Your NTE quote of $${Number(data.amount).toFixed(2)} for case #${data.caseNumber} was approved. Proceed with work.`,
          env,
        }).catch(() => {});
      }
      return twiml(reply);
    } catch (err) {
      console.error(JSON.stringify({ event: 'pma_vendor_inbound_approval_error', error: err?.message }));
      return twiml('An error occurred processing your response. Please try again.');
    }
  }

  // HELP or STOP
  if (msgBody === 'HELP') {
    return twiml('Desert Ridge PMA Vendor Line. Reply YES<CODE> to approve or NO<CODE> to decline NTE requests. For help call (702) 308-7429.');
  }
  if (msgBody === 'STOP' || msgBody === 'UNSUBSCRIBE') {
    return twiml(EMPTY_TWIML) && { statusCode: 200, headers: TWIML_HEADERS, body: EMPTY_TWIML };
  }

  return twiml('Desert Ridge PMA: Unrecognized command. Reply HELP for assistance.');
};
