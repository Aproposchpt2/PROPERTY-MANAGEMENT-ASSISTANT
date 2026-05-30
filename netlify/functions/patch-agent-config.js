'use strict';

// POST /.netlify/functions/patch-agent-config
// Patches ElevenLabs agent — fixes premature disconnect caused by workflow node routing.
// Protected by PATCH_SECRET. Uses ELEVENLABS_API_KEY from Netlify environment.

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

  const SYSTEM_PROMPT = `You are Alex, a patient and professional support specialist at FlowDesk Pro.

Your ONLY job on this call:
1. Greet the caller warmly
2. Collect their first name
3. Collect their last name
4. Collect their reason for calling
5. Confirm you will pass their information to the team
6. Then and ONLY then — end the call politely

CRITICAL RULES:
- NEVER end the call before collecting all three pieces of information
- NEVER interrupt the caller while they are speaking
- Wait at least 3 full seconds after the caller stops speaking before responding
- Cellular callers may have audio gaps mid-sentence — these are NOT end-of-turn signals
- Single words like 'yes', 'okay', 'sure', 'thanks', 'um', 'uh' are NOT call endings
- If you have only the name and not the reason for call, keep the call going
- After collecting all information: thank them, confirm next steps, then call end_call`;

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
        turn_eagerness: 'patient',
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
        first_message: 'Hello, this is Alex from FlowDesk Pro — can I get your first and last name please?',
        prompt: {
          prompt: SYSTEM_PROMPT,
          llm: 'claude-sonnet-4-5',
          temperature: 0.3,
          tools: [
            {
              type: 'webhook',
              name: 'log_call',
              description: 'Log the call record at the end of every conversation. Call this only after collecting name and reason and completing the goodbye. caller_phone is optional.',
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
              description: 'Look up the caller record at the start of the conversation.',
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
    workflow: {
      nodes: {
        identify_issue: {
          additional_prompt: `Your ONLY task in this step: collect the caller's first name, last name, and reason for calling.

DO NOT advance, DO NOT route, DO NOT end the call until you have ALL THREE:
- First name ✓
- Last name ✓
- Reason for call ✓

If you only have the name and not the reason: ask "And what is the reason for your call today?" and WAIT.
If you only have the reason and not the full name: ask for the missing name part and WAIT.

NEVER call end_call in this step.
NEVER interpret a name response as a conversation ending.
After you have all three — confirm: "Thank you [Name], I'll make sure the team follows up with you about [reason]. Is there anything else before I let you go?"
Then wait for their response before routing forward.`,
          additional_knowledge_base: [],
          additional_tool_ids: [],
          type: 'override_agent',
        },
        troubleshoot: {
          additional_prompt: `You are helping the caller with a technical issue. Get details about their problem. Do NOT end the call until you have their contact information confirmed and have set a clear expectation for follow-up. Then route to resolve_or_escalate.`,
          additional_knowledge_base: [],
          additional_tool_ids: [],
          type: 'override_agent',
        },
        account_billing: {
          additional_prompt: `You are helping the caller with an account or billing question. Gather details. Do NOT end the call until you have confirmed their contact information and set a clear expectation for follow-up. Then route to resolve_or_escalate.`,
          additional_knowledge_base: [],
          additional_tool_ids: [],
          type: 'override_agent',
        },
        resolve_or_escalate: {
          additional_prompt: `Summarize what you've collected: caller name, reason for call, and any details. Confirm next steps clearly. Ask: "Is there anything else I can help you with today?" Wait for their response. ONLY call end_call after the caller has acknowledged the closing and there is nothing more to address.`,
          additional_knowledge_base: [],
          additional_tool_ids: [],
          type: 'override_agent',
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
          message: 'Agent updated — workflow nodes patched, identify_issue requires all 3 fields before routing, resolve_or_escalate requires explicit close before end_call',
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
