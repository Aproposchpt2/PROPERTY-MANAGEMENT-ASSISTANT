'use strict';

// POST /.netlify/functions/patch-agent-config
// One-time utility: patches the ElevenLabs Customer Support agent with correct tool config.
// Protected by PATCH_SECRET env var — set a random string in Netlify and pass as header.
// Uses ELEVENLABS_API_KEY from Netlify environment — key never exposed in code or chat.

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

  // Protect with a secret so this can't be triggered by anyone
  const patchSecret = process.env.PATCH_SECRET;
  if (patchSecret) {
    const provided = (event.headers['x-patch-secret'] || event.headers['X-Patch-Secret'] || '').trim();
    if (provided !== patchSecret) {
      return { statusCode: 401, headers: cors, body: JSON.stringify({ ok: false, error: 'Unauthorized' }) };
    }
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: 'ELEVENLABS_API_KEY not configured in Netlify env vars' }) };
  }

  const payload = {
    conversation_config: {
      agent: {
        prompt: {
          llm: 'claude-sonnet-4-5',
          tools: [
            {
              type: 'webhook',
              name: 'log_call',
              description: 'Log the call record to the contact center database at the end of every conversation. Always call this — caller_phone is optional.',
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
                  description: 'Log call data at end of conversation. caller_phone is optional.',
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
      console.log('PATCH-AGENT: success status', result.status);
      return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({
          ok: true,
          message: 'Agent updated — log_call and lookup_caller now system-provided, LLM set to claude-sonnet-4-5',
          elevenlabs_status: result.status,
        }),
      };
    } else {
      console.error('PATCH-AGENT: ElevenLabs error', result.status, result.body);
      return {
        statusCode: 502,
        headers: cors,
        body: JSON.stringify({ ok: false, error: 'ElevenLabs API error', status: result.status, detail: result.body }),
      };
    }
  } catch (err) {
    console.error('PATCH-AGENT: exception', err.message);
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
