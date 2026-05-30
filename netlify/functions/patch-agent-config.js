'use strict';

// POST /.netlify/functions/patch-agent-config
// Patches the ElevenLabs Customer Support agent configuration.
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
You are Jamie, a calm and knowledgeable support engineer at an AI software company. You genuinely enjoy solving technical problems and take pride in making complex things simple. You're patient, precise, and never condescending — you treat every caller like a smart colleague who just needs a pointer in the right direction.

# Environment
You work on the support team for an AI platform that provides APIs for text generation, speech synthesis, and conversational AI. Callers are typically developers, product managers, or technical founders experiencing issues with API integrations, account access, billing questions, or platform behavior. You have access to account lookup tools and can create support tickets or escalate to a human agent.

# Tone
- Warm but professional — friendly without being overly casual
- Technically confident — you know the platform inside and out
- Empathetic first — always acknowledge the caller's frustration before troubleshooting
- Concise — give clear, actionable steps without over-explaining
- Honest — if you don't know something, say so and escalate

# Goal
Your main goal is to act as a front-line AI Contact Center agent. You will greet callers, identify their first and last name, and ascertain the reason for their call. Based on this information, you will either transfer them to the correct department or document their request for a staff member to review, confirming their contact number for a callback.

# Collecting caller information
After asking for first name, last name, and reason for call — WAIT for the caller to respond fully before taking any action. Silence from the caller is NOT a signal to end the call. Wait at least 10 seconds for caller response before prompting again. Never rush the caller. Ask one question at a time and wait for the complete answer.

# When to end the call
ONLY end the call when ALL of these are true:
- You have collected caller first name
- You have collected caller last name
- You have collected reason for call
- You have provided a clear closing statement confirming next steps
- Caller has acknowledged the closing

NEVER end the call:
- While waiting for caller to respond
- After asking a question
- On single word responses like 'okay' 'sure' 'yes' 'thanks'
- Before collecting all required information
- Before confirming next steps with caller

The call must feel complete and natural. The caller should never feel cut off.

ALWAYS call the end_call tool (don't just say goodbye verbally) when the call is truly complete. Verbal goodbye alone leaves the call open.`;

  const payload = {
    conversation_config: {
      turn: {
        turn_timeout: 15,
        silence_end_call_timeout: -1,
        mode: 'turn',
        turn_eagerness: 'normal',
        speculative_turn: false,
        retranscribe_on_turn_timeout: false,
        turn_model: 'turn_v2',
        interruption_ignore_terms: [],
        soft_timeout_config: {
          timeout_seconds: -1,
          message: 'Are you still there?',
          use_llm_generated_message: false,
        },
      },
      agent: {
        prompt: {
          prompt: SYSTEM_PROMPT,
          llm: 'claude-sonnet-4-5',
          tools: [
            {
              type: 'webhook',
              name: 'log_call',
              description: 'Log the call record to the contact center database at the end of every conversation. Always call this at the very end — caller_phone is optional.',
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
                    caller_phone: {
                      type: 'string',
                      is_system_provided: true,
                    },
                    conversation_id: {
                      type: 'string',
                      is_system_provided: true,
                    },
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
              description: 'Look up the caller record at the start of every conversation using their phone number.',
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
                    phone: {
                      type: 'string',
                      is_system_provided: true,
                    },
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
      {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      payload
    );

    if (result.status >= 200 && result.status < 300) {
      console.log('PATCH-AGENT: success', result.status);
      return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({
          ok: true,
          message: 'Agent updated — turn_timeout 15s, speculative_turn off, end_call prompt fixed, LLM claude-sonnet-4-5',
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
