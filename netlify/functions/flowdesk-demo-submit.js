'use strict';

const { buildCorsHeaders, handleOptions } = require('./lib/flowdesk-cors');
const { getSupabaseAdmin } = require('./lib/flowdesk-supabase-admin');
const { json, error, parseJsonBody } = require('./lib/flowdesk-response-utils');

const TWILIO_COMPLIANCE = '\nReply STOP to unsubscribe. Reply HELP for help. Msg & data rates may apply. AI4 Businesses aiflowdeskpro.com';

function esc(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function sendResend({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL || 'FlowDesk Pro <notifications@aiflowdeskpro.com>',
      to,
      subject,
      html,
    }),
  });
}

async function sendTwilioSms(to, body) {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_PHONE_NUMBER || '+17253305102';
  if (!sid || !token || !to) return;

  const payload = new URLSearchParams({ To: to, From: from, Body: body + TWILIO_COMPLIANCE }).toString();
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');

  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: payload,
  });
}

exports.handler = async (event) => {
  const origin = event.headers && event.headers.origin;
  const corsHeaders = buildCorsHeaders(origin);

  if (event.httpMethod === 'OPTIONS') return handleOptions(origin);
  if (event.httpMethod !== 'POST') {
    return error(405, 'METHOD_NOT_ALLOWED', 'Only POST is supported', corsHeaders);
  }

  const body = parseJsonBody(event);
  if (!body) {
    return error(400, 'INVALID_BODY', 'Request body must be valid JSON', corsHeaders);
  }

  const { business_name, contact_name, phone, email, sms_consent, demo_site } = body;

  if (!phone) {
    return error(400, 'MISSING_PHONE', 'phone is required', corsHeaders);
  }

  const smsConsented = sms_consent === 'yes' || sms_consent === true;
  const demoSite = demo_site || 'contact-center.aiflowdeskpro.com';

  const supabase = getSupabaseAdmin();
  const { data, error: dbErr } = await supabase
    .from('demo_requests')
    .insert({
      business_name: business_name || null,
      contact_name: contact_name || null,
      phone,
      email: email || null,
      sms_consent: smsConsented,
      demo_site: demoSite,
      created_at: new Date().toISOString(),
    })
    .select('id, business_name, contact_name, phone, email, created_at')
    .single();

  if (dbErr) {
    console.error('DEMO SUBMIT DB ERROR:', dbErr.message);
    return error(500, 'DB_ERROR', 'Failed to save demo request', corsHeaders);
  }

  const firstName = (contact_name || '').split(' ')[0] || 'there';
  const biz = business_name || 'your business';
  const ownerEmail = process.env.OWNER_NOTIFICATION_EMAIL || 'jmitchell@aproposgroupllc.com';

  // Owner notification
  try {
    await sendResend({
      to: ownerEmail,
      subject: `New Contact Center Demo Request: ${biz}`,
      html: `<div style="font-family:Arial,sans-serif;background:#07111f;color:#f5f8ff;padding:28px;border-radius:16px;max-width:600px;margin:0 auto">
        <div style="color:#73E6FF;font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:800;margin-bottom:14px">FlowDesk Pro — Contact Center Demo</div>
        <h2 style="margin:0 0 12px;color:#fff">New Demo Request: ${esc(biz)}</h2>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:7px;color:#90A3BC;width:120px">Name</td><td style="padding:7px;color:#fff">${esc(contact_name || 'N/A')}</td></tr>
          <tr><td style="padding:7px;color:#90A3BC">Email</td><td style="padding:7px;color:#73E6FF">${esc(email || 'N/A')}</td></tr>
          <tr><td style="padding:7px;color:#90A3BC">Phone</td><td style="padding:7px;color:#fff">${esc(phone)}</td></tr>
          <tr><td style="padding:7px;color:#90A3BC">SMS Consent</td><td style="padding:7px;color:${smsConsented ? '#55E6A5' : '#90A3BC'}">${smsConsented ? 'Yes' : 'No'}</td></tr>
          <tr><td style="padding:7px;color:#90A3BC">Demo Site</td><td style="padding:7px;color:#fff">${esc(demoSite)}</td></tr>
        </table>
      </div>`,
    });
  } catch (e) { console.error('Owner email failed:', e.message); }

  // User confirmation email
  if (email) {
    try {
      await sendResend({
        to: email,
        subject: `Your FlowDesk Pro Contact Center demo is confirmed`,
        html: `<div style="font-family:Arial,sans-serif;background:#07111f;color:#f5f8ff;padding:32px;border-radius:16px;max-width:560px;margin:0 auto">
          <div style="color:#73E6FF;font-size:11px;letter-spacing:.18em;text-transform:uppercase;font-weight:800;margin-bottom:18px">FlowDesk Pro Contact Center</div>
          <h2 style="margin:0 0 10px;color:#fff">Demo confirmed, ${esc(firstName)}.</h2>
          <p style="color:#a8b8d0;line-height:1.75;margin-bottom:20px">We've received your demo request for <strong style="color:#73E6FF">${esc(biz)}</strong>. Our team will be in touch within one business day to walk you through the Contact Center live.</p>
          <a href="https://contact-center.aiflowdeskpro.com" style="display:inline-block;background:linear-gradient(135deg,#f5f8ff,#73e6ff,#4a7fff);color:#03101f;font-weight:900;text-decoration:none;border-radius:10px;padding:13px 22px;font-size:13px">Explore FlowDesk Pro →</a>
          <p style="font-size:11px;color:#586880;margin-top:22px">FlowDesk Pro · Apropos Group LLC · Las Vegas, NV</p>
        </div>`,
      });
    } catch (e) { console.error('User email failed:', e.message); }
  }

  // SMS if consented
  if (smsConsented && phone) {
    try {
      await sendTwilioSms(phone, `Hi ${firstName}, your FlowDesk Pro Contact Center demo is confirmed for ${biz}. We'll reach out within one business day.`);
    } catch (e) { console.error('SMS failed:', e.message); }
  }

  return json(201, { ok: true, demo: data }, corsHeaders);
};
