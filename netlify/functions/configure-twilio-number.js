'use strict';

// POST /.netlify/functions/configure-twilio-number
// One-time utility: sets StatusCallback on the Twilio number so every call
// ending on 725.201.0584 auto-creates a record in the Lead Manager.
// Protected by PATCH_SECRET. Uses TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN from Netlify.

const https = require('https');

const TARGET_NUMBER = '+17252010584';
const LEAD_MANAGER_CALLBACK = 'https://lead-management.aiflowdeskpro.com/.netlify/functions/lead-manager';

function twilioRequest(method, path, accountSid, authToken, params) {
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const body = params ? new URLSearchParams(params).toString() : null;

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.twilio.com',
      path,
      method,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Twilio timeout')));
    if (body) req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: JSON.stringify({ ok: false }) };

  const patchSecret = process.env.PATCH_SECRET;
  if (patchSecret) {
    const provided = (event.headers['x-patch-secret'] || event.headers['X-Patch-Secret'] || '').trim();
    if (provided !== patchSecret) {
      return { statusCode: 401, headers: cors, body: JSON.stringify({ ok: false, error: 'Unauthorized' }) };
    }
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: 'TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not configured' }) };
  }

  try {
    // Step 1: List phone numbers to find the SID for our target number
    const listResult = await twilioRequest('GET',
      `/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(TARGET_NUMBER)}`,
      accountSid, authToken
    );

    if (listResult.status !== 200) {
      return { statusCode: 502, headers: cors, body: JSON.stringify({
        ok: false, error: 'Failed to list Twilio numbers', detail: listResult.data
      }) };
    }

    const numbers = listResult.data?.incoming_phone_numbers || [];
    if (numbers.length === 0) {
      return { statusCode: 404, headers: cors, body: JSON.stringify({
        ok: false, error: `Number ${TARGET_NUMBER} not found in this Twilio account`,
        note: 'This number may be provisioned through ElevenLabs — configure StatusCallback in ElevenLabs dashboard instead'
      }) };
    }

    const phoneSid = numbers[0].sid;
    console.log(`Found number ${TARGET_NUMBER} → SID: ${phoneSid}`);

    // Step 2: Update StatusCallback URL
    const updateResult = await twilioRequest('POST',
      `/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers/${phoneSid}.json`,
      accountSid, authToken,
      {
        StatusCallback: LEAD_MANAGER_CALLBACK,
        StatusCallbackMethod: 'POST',
      }
    );

    if (updateResult.status < 200 || updateResult.status >= 300) {
      return { statusCode: 502, headers: cors, body: JSON.stringify({
        ok: false, error: 'Failed to update number', detail: updateResult.data
      }) };
    }

    return { statusCode: 200, headers: cors, body: JSON.stringify({
      ok: true,
      phone_number: TARGET_NUMBER,
      phone_sid: phoneSid,
      status_callback: LEAD_MANAGER_CALLBACK,
      message: `Every call ending on ${TARGET_NUMBER} will now create a Lead Manager record automatically`,
    }) };

  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
