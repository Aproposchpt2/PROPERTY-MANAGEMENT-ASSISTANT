'use strict';

// POST /.netlify/functions/patch-agent-config
// Patches the ElevenLabs Customer Support agent — cellular audio optimized.
// Protected by PATCH_SECRET env var.
// Uses ELEVENLABS_API_KEY from Netlify environment.

const https = require('https');

const AGENT_ID = 'agent_6101ksv5amdpfqn90z89gtvh34a7';

function httpsRequest(method, urlStr, headers, body) {
  const buf = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: { ...headers, 'Content-Length': buf.length },
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Timeout')));
    req.write(buf);
    req.end();
  });
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: JSON.stringify({ ok: false }) };

  const patchSecret = process.env.PATCH_SECRET;
  if (patchSecret) {
    const provided = (event.headers['x-patch-secret'] || event.headers['X-Patch-Secret'] || '').trim();
    if (provided !== patchSecret) {
      return { statusCode: 401, headers: cors, body: JSON.stringify({ ok: false, error: 'Unauthorized' }) };
    }
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: 'ELEVENLABS_API_KEY not configured' }) };
  }

  const SYSTEM_PROMPT = `# Personality
You are Alex, a calm and knowledgeable support specialist at FlowDesk Pro. You are patient, attentive, and give every caller the time they need to explain their situation fully without interruption.

# Environment
You handle inbound calls for FlowDesk Pro — an AI platform providing contact center, CRM, and business automation systems. Callers are business owners, staff, or prospects.

# Tone
- Warm but professional
- Patient — never rush the caller
- Empathetic first — always acknowledge before acting
- Concise and clear

# Goal
Greet callers, collect their first name, last name, and reason for call. Then transfer or document for callback.

# Critical listening rules
- ALWAYS let the caller finish their complete thought before responding
- NEVER interrupt a caller mid-sentence under any circumstances
- Cellular callers may have micro-pauses in their audio — these are NOT end-of-turn signals
- After asking a question, wait in silence for the caller's COMPLETE response
- Silence or brief pauses do NOT mean the caller has finished speaking
- Single words like 'okay', 'yes', 'sure', 'thanks', 'um', 'uh' are NOT conversation endings
- Wait at least 3 full seconds of silence before assuming the caller has finished speaking

# Collecting caller information
Ask one question at a time. Wait fully for each complete answer.
1. Ask for first name and last name
2. Ask for reason for call
3. Confirm next steps and close naturally

# When to end the call
ONLY end the call when ALL of these are true:
- You have collected caller first name
- You have collected caller last name
- You have collected reason for call
- You have provided a clear closing statement confirming next steps
- Caller has responded with a complete closing acknowledgement

NEVER end the call:
- While the caller is speaking
- While waiting for a caller response
- After asking a question
- On single words like 'okay' 'sure' 'yes' 'thanks' 'uh-huh'
- Before collecting all required information
- If there is a brief audio pause mid-sentence

ALWAYS call the end_call tool when the call is truly complete. Verbal goodbye alone leaves the call open.`;

  const payload = {
    conversation_config: {
      asr: {
        quality: 'high',
        provider: 'scribe_realtime',
        user_input_audio_format: 'pcm_16000',
        keywords: [],
      },
      turn: {
        turn_timeout: 20,
        silence_end_call_timeout: -1,
        mode: 'turn',
        turn_eagerness: 'low',
        speculative_turn: false,
        retranscribe_on_turn_timeout: true,
        turn_model: 'turn_v2',
        interruption_ignore_terms: [
          'um', 'uh', 'hmm', 'yeah', 'okay', 'ok',
          'sure', 'right', 'yes', 'no', 'thanks', 'uh-huh',
        ],
        soft_timeout_config: {
          timeout_seconds: -1,
          message: 'Are you still there?',
          use_llm_generated_message: false,
        },
      },
      vad: {
        background_voice_detection: false,
      },
      agent: {
        first_message: 'Hello, this is Alex from FlowDesk Pro support — can I get your first and last name and the reason for your call today?',
        prompt: {
          prompt: SYSTEM_PROMPT,
          llm: 'claude-sonnet-4-5',
          temperature: 0.3,
          tools: [
            {
              type: 'webhook',
              name: 'log_call',
              description: 'Log the call record at the end of every conversation. Always call this at the very end — caller_phone is optional.',
              response_timeout_secs: 20,
              disable_interruptions: false,
              force_pre_tool_speech: false,
              pre_tool_speech: 'auto',
              assignments: [],
              tool_call_sound: null,
              tool_call_sound_behavior: 'auto',
              tool_error_handling_mode: 'auto',
              dynamic_variables: { dynamic_variable_placeholders: {} },
              execution_mode: 'immediate',
              api_schema: {
                request_headers: {},
                url: 'https://ai4contact-center.netlify.app/.netlify/functions/log-call',
                method: 'POST',
                path_params_schema: {},
                query_params_schema: null,
                request_body_schema: {
                  type: 'object',
                  required: [],
                  description: 'Log call data at end of conversation.',
                  properties: {
                    caller_phone: { type: 'string', is_system_provided: true },
                    conversation_id: { type: 'string', is_system_provided: true },
                  },
                },
                response_body_schema: null,
                content_type: 'application/json',
                auth_resolved_params: [],
                auth_connection: null,
              },
            },
            {
              type: 'webhook',
              name: 'lookup_caller',
              description: 'Look up the caller record at the start of every conversation.',
              response_timeout_secs: 20,
              disable_interruptions: false,
              force_pre_tool_speech: false,
              pre_tool_speech: 'auto',
              assignments: [],
              tool_call_sound: null,
              tool_call_sound_behavior: 'auto',
              tool_error_handling_mode: 'auto',
              dynamic_variables: { dynamic_variable_placeholders: {} },
              execution_mode: 'immediate',
              api_schema: {
                request_headers: {},
                url: 'https://ai4contact-center.netlify.app/.netlify/functions/lookup-caller',
                method: 'GET',
                path_params_schema: {},
                query_params_schema: {
                  properties: {
                    phone: { type: 'string', is_system_provided: true },
                  },
                  required: ['phone'],
                },
                request_body_schema: null,
                response_body_schema: null,
                content_type: 'application/json',
                auth_resolved_params: [],
                auth_connection: null,
              },
            },
          ],
        },
      },
    },
  };

  try {
    const result = await httpsRequest(
      'PATCH',
      `https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`,
      { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      payload
    );

    if (result.status >= 200 && result.status < 300) {
      return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({
          ok: true,
          message: 'Agent updated — cellular audio optimized: turn_eagerness low, turn_timeout 20s, speculative_turn off, interruption_ignore_terms set, retranscribe on timeout, Alex branding, temperature 0.3',
          elevenlabs_status: result.status,
        }),
      };
    } else {
      console.error('PATCH-AGENT error', result.status, result.body);
      return {
        statusCode: 502,
        headers: cors,
        body: JSON.stringify({ ok: false, error: 'ElevenLabs API error', status: result.status, detail: result.body }),
      };
    }
  } catch (err) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
