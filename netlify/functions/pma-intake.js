'use strict';

// Public consultation intake for pma.stellaruc.com/intake.html.
// Mirrors the stellaruc.com intake (name, business name, phone, email, optional SMS consent).
// Each submission becomes a lead in the Apropos Group Lead Management pipeline (same tenant,
// tables and RPCs as stellaruc.com/api/public/intake), then the owner is emailed (best effort).

let clientOverride = null; // test hook

const NOTIFY_EMAIL = 'jmitchell@aproposgroupllc.com';
// Apropos Group LLC tenant and actor used by the stellaruc.com intake; overridable per environment.
const LEAD_TENANT_ID = process.env.AI4CC_LEAD_TENANT_ID || '5885a020-d363-4c27-910a-c035eda132f5';
const ACTOR_USER_ID = process.env.AI4CC_INTAKE_FALLBACK_ACTOR_ID || '735fc481-1b75-4cf3-9f68-128e9e169fdc';
const SOURCE = 'pma_stellaruc_intake';
const SMS_CONSENT_TEXT =
  'Yes, StellarUC (Apropos Group LLC) may send me text messages about my inquiry and consultation. ' +
  'Message frequency varies. Msg & data rates may apply. Reply STOP to opt out or HELP for help. ' +
  'Consent is not a condition of purchase.';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CLIENT_TOKEN_RE = /^[A-Za-z0-9_-]{8,80}$/;
const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

const reply = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });
const text = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function normalizePhone(value) {
  const raw = value.trim();
  if (!raw || !/^[+\d().\-\s]+$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  if (raw.startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits;
}

function sameOrigin(headers) {
  const origin = headers.origin || headers.Origin;
  const host = headers.host || headers.Host;
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

async function sendEmail({ name, businessName, phone, email, smsConsent, at }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) { console.warn('[pma-intake] Resend not configured; skipping owner email'); return; }
  const to = process.env.PMA_INTAKE_TO_EMAIL || process.env.OWNER_NOTIFICATION_EMAIL || NOTIFY_EMAIL;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: email,
      subject: `New PMA consultation request: ${businessName}`,
      text:
        'New consultation request from pma.stellaruc.com/intake.html.\n' +
        'Already in the workspace under Lead Management / Customer 360.\n\n' +
        `Name: ${name}\nBusiness: ${businessName}\nPhone: ${phone}\nEmail: ${email}\n` +
        `SMS consent: ${smsConsent ? `Yes (${at})\nConsent text: ${SMS_CONSENT_TEXT}` : 'No'}\n`,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) console.error('[pma-intake] owner email failed', res.status);
}

async function saveLead(db, { name, businessName, phone, email, smsConsent, clientToken, at }) {
  // Idempotent on (tenant_id, channel, external_id): one clientToken per page load.
  const { error: upsertError } = await db.from('ai4cc_interactions').upsert(
    {
      tenant_id: LEAD_TENANT_ID, channel: 'email', direction: 'inbound', external_id: clientToken,
      customer_identifier: email, status: 'completed', started_at: at, ended_at: at,
      metadata: {
        source: SOURCE, product: 'Property Management Assistant', name, businessName, phone, email,
        sms_consent: { granted: smsConsent, text: smsConsent ? SMS_CONSENT_TEXT : null, at },
      },
    },
    { onConflict: 'tenant_id,channel,external_id', ignoreDuplicates: true },
  );
  if (upsertError) throw upsertError;

  const { data: interaction, error: fetchError } = await db.from('ai4cc_interactions').select('id')
    .eq('tenant_id', LEAD_TENANT_ID).eq('channel', 'email').eq('external_id', clientToken).single();
  if (fetchError) throw fetchError;

  const { data: existing, error: lookupError } = await db.from('ai4cc_leads').select('id')
    .eq('tenant_id', LEAD_TENANT_ID).eq('originating_interaction_id', interaction.id).maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return false;

  const { data: created, error: rpcError } = await db.rpc('ai4cc_create_lead_from_interaction', {
    p_tenant_id: LEAD_TENANT_ID, p_actor_user_id: ACTOR_USER_ID, p_interaction_id: interaction.id,
    p_identifier_type: 'email', p_identifier_value: email, p_email: email, p_phone: phone,
    p_contact_name: name, p_company_name: businessName, p_title: 'PMA website intake',
    p_service_interest: 'Property Management Assistant',
    p_description: `PMA website intake form submitted. Name: ${name}. Business: ${businessName}. Wants a Property Management Assistant consultation.`,
    p_pipeline_stage: 'new', p_priority: 'normal', p_score: 50, p_estimated_value: 0, p_probability: 0,
    p_next_action: 'Contact to schedule Property Management Assistant consultation.', p_next_follow_up: null,
  });
  if (rpcError) throw rpcError;

  const leadId = created && created.lead && created.lead.id;
  if (leadId) {
    const { error: activityError } = await db.rpc('ai4cc_record_lead_activity', {
      p_tenant_id: LEAD_TENANT_ID, p_actor_user_id: ACTOR_USER_ID, p_lead_id: leadId,
      p_activity_type: 'website_intake', p_direction: 'inbound', p_subject: 'PMA website intake form submitted',
      p_body: `Name: ${name}\nBusiness: ${businessName}\nPhone: ${phone}\nEmail: ${email}\nSource: pma.stellaruc.com/intake.html`,
      p_outcome: null,
    });
    if (activityError) throw activityError;
  }
  return true;
}

function admin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (clientOverride) return clientOverride;
  if (!url || !key) throw new Error('SUPABASE_NOT_CONFIGURED');
  const { createClient } = require('@supabase/supabase-js');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });
  if (!sameOrigin(event.headers || {})) return reply(403, { error: 'Invalid request origin' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid request.' }); }

  const name = text(body.name);
  const businessName = text(body.businessName);
  const email = text(body.email).toLowerCase();
  const phone = normalizePhone(text(body.phone, 40));
  const smsConsent = body.smsConsent === true;
  const website = text(body.website); // honeypot: real visitors never fill this

  if (!name) return reply(400, { error: 'Name is required.' });
  if (!businessName) return reply(400, { error: 'Business name is required.' });
  if (!phone) return reply(400, { error: 'A valid phone number is required.' });
  if (!EMAIL_RE.test(email)) return reply(400, { error: 'A valid email address is required.' });
  const clientToken = text(body.clientToken, 80);
  if (!CLIENT_TOKEN_RE.test(clientToken)) return reply(400, { error: 'Invalid submission token.' });
  if (website) return reply(200, { ok: true });

  const at = new Date().toISOString();
  try {
    const isNew = await saveLead(admin(), { name, businessName, phone, email, smsConsent, clientToken, at });
    if (isNew) {
      try { await sendEmail({ name, businessName, phone, email, smsConsent, at }); }
      catch (err) { console.error('[pma-intake] owner email failed:', err.message); }
    }
    return reply(200, { ok: true });
  } catch (err) {
    console.error('[pma-intake] failed:', err.message || err);
    return reply(500, { error: 'We could not save your information. Please try again.' });
  }
};

exports._test = { normalizePhone, sameOrigin, setClient: (c) => { clientOverride = c; } };
