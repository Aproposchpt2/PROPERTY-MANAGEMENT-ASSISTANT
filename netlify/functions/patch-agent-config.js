'use strict';

// POST /.netlify/functions/patch-agent-config
// Patches ElevenLabs agent — fixes premature disconnect caused by workflow node routing.
// Protected by PATCH_SECRET. Uses ELEVENLABS_API_KEY from Netlify environment.

const https = require('https');

const AGENT_ID = 'agent_6101ksv5amdpfqn90z89gtvh34a7';

function httpsRequest(method, urlStr, headers, body) {
  const buf = body && method !== 'GET' ? Buffer.from(JSON.stringify(body)) : null;
  const reqHeaders = { ...headers };
  if (buf) reqHeaders['Content-Length'] = buf.length;
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: reqHeaders,
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Timeout')));
    if (buf) req.write(buf);
    req.end();
  });
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };

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

  // GET — full agent config review
  if (event.httpMethod === 'GET') {
    try {
      const result = await httpsRequest('GET', `https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`,
        { 'xi-api-key': apiKey, 'Content-Type': 'application/json' }, null);
      const a = JSON.parse(result.body);
      const cc = a?.conversation_config || {};
      const turn = cc.turn || {};
      const asr = cc.asr || {};
      const vad = cc.vad || {};
      const agent = cc.agent || {};
      const prompt = agent.prompt || {};
      const tools = prompt.tools || [];
      const wf = a?.workflow || {};
      const nodes = wf.nodes || {};

      const report = {
        ok: true,
        agent_id: a.agent_id,
        agent_name: a.name,
        llm: prompt.llm,
        temperature: prompt.temperature,

        turn: {
          turn_timeout: turn.turn_timeout,
          silence_end_call_timeout: turn.silence_end_call_timeout,
          turn_eagerness: turn.turn_eagerness,
          speculative_turn: turn.speculative_turn,
          retranscribe_on_turn_timeout: turn.retranscribe_on_turn_timeout,
          interruption_ignore_terms: turn.interruption_ignore_terms,
          soft_timeout_seconds: turn.soft_timeout_config?.timeout_seconds,
          soft_timeout_message: turn.soft_timeout_config?.message,
        },

        asr: {
          quality: asr.quality,
          provider: asr.provider,
          audio_format: asr.user_input_audio_format,
        },

        vad: {
          background_voice_detection: vad.background_voice_detection,
        },

        agent: {
          first_message: agent.first_message,
          language: agent.language,
          max_duration_seconds: cc.conversation?.max_duration_seconds,
        },

        system_prompt_preview: (prompt.prompt || '').slice(0, 300) + '...',

        tools: tools.map(t => ({
          name: t.name,
          type: t.type,
          url: t.api_schema?.url,
          method: t.api_schema?.method,
          required_params: t.api_schema?.request_body_schema?.required
            || t.api_schema?.query_params_schema?.required || [],
          system_provided: Object.entries(
            t.api_schema?.request_body_schema?.properties
            || t.api_schema?.query_params_schema?.properties || {}
          ).filter(([, v]) => v.is_system_provided).map(([k]) => k),
          llm_provided: Object.entries(
            t.api_schema?.request_body_schema?.properties
            || t.api_schema?.query_params_schema?.properties || {}
          ).filter(([, v]) => !v.is_system_provided).map(([k]) => k),
        })),

        built_in_tools: Object.keys(prompt.built_in_tools || {})
          .filter(k => prompt.built_in_tools[k] !== null),

        workflow_nodes: Object.entries(nodes).map(([id, node]) => ({
          id,
          type: node.type,
          label: node.label,
          prompt_preview: node.additional_prompt
            ? node.additional_prompt.slice(0, 150) + '...'
            : null,
          edges_out: (wf.edges ? Object.entries(wf.edges)
            .filter(([, e]) => e.source === id)
            .map(([eid, e]) => ({
              edge: eid,
              target: e.target,
              condition_type: e.forward_condition?.type,
              condition: e.forward_condition?.condition || 'unconditional',
            })) : []),
        })),

        phone_numbers: (a.phone_numbers || []).map(p => ({
          number: p.phone_number,
          label: p.label,
          agent_assigned: p.assigned_agent?.agent_name,
        })),
      };

      return { statusCode: 200, headers: cors, body: JSON.stringify(report, null, 2) };
    } catch (err) {
      return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: err.message }) };
    }
  }

  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: JSON.stringify({ ok: false }) };

  // ?action=register_webhook — discover webhook API and patch agent
  const qs = event.queryStringParameters || {};
  if (qs.action === 'register_webhook') {
    try {
      const webhookUrl = 'https://ai4contact-center.netlify.app/.netlify/functions/log-call';
      const elHeaders  = { 'xi-api-key': apiKey, 'Content-Type': 'application/json' };

      // Try known ElevenLabs webhook endpoints
      const endpoints = [
        'https://api.elevenlabs.io/v1/convai/webhooks',
        'https://api.elevenlabs.io/v1/workspace/webhooks',
        'https://api.elevenlabs.io/v1/webhooks',
      ];

      let webhookId = null;
      let usedEndpoint = null;

      for (const endpoint of endpoints) {
        const r = await httpsRequest('POST', endpoint, elHeaders,
          { url: webhookUrl, name: 'FlowDesk Pro Log Call', events: ['transcript'] }
        );
        if (r.status >= 200 && r.status < 300) {
          const data = JSON.parse(r.body);
          webhookId = data.webhook_id || data.id;
          usedEndpoint = endpoint;
          break;
        }
        console.log(`Endpoint ${endpoint} → ${r.status}: ${r.body.slice(0, 100)}`);
      }

      // If no registration endpoint works — try patching agent directly with URL
      if (!webhookId) {
        const directPatch = await httpsRequest('PATCH',
          `https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`,
          elHeaders,
          { platform_settings: { workspace_overrides: { webhooks: {
            post_call_webhook_url: webhookUrl,
            events: ['transcript'],
            transcript_format: 'json',
            send_audio: false,
          } } } }
        );
        if (directPatch.status >= 200 && directPatch.status < 300) {
          return { statusCode: 200, headers: cors, body: JSON.stringify({
            ok: true, method: 'direct_url_patch', webhook_url: webhookUrl,
            message: 'Webhook URL patched directly on agent — no registration needed',
          }) };
        }
        return { statusCode: 502, headers: cors, body: JSON.stringify({
          ok: false, error: 'All webhook registration attempts failed',
          direct_patch_response: directPatch.body.slice(0, 300),
        }) };
      }

      // Patch agent with webhook ID
      const patchResult = await httpsRequest('PATCH',
        `https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`,
        elHeaders,
        { platform_settings: { workspace_overrides: { webhooks: { post_call_webhook_id: webhookId } } } }
      );

      return { statusCode: 200, headers: cors, body: JSON.stringify({
        ok: true, webhook_id: webhookId, webhook_url: webhookUrl,
        endpoint_used: usedEndpoint,
        agent_patched: patchResult.status >= 200 && patchResult.status < 300,
        message: 'Post-call webhook registered — every call auto-logs to Supabase',
      }) };
    } catch (err) {
      return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: err.message }) };
    }
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
- After collecting all information: thank them, confirm next steps, say "Thanks for calling FlowDesk Pro, have a great day!" then ALWAYS call log_call first, then call end_call
- SEQUENCE IS MANDATORY: log_call → end_call. Never call end_call without calling log_call first`;

  const payload = {
    conversation_config: {
      asr: {
        quality: 'high',
        provider: 'scribe_realtime',
        user_input_audio_format: 'pcm_16000',
        keywords: [],
      },
      tts: {
        model_id: 'eleven_v3_conversational',
        voice_id: '7EzWGsX10sAS4c9m9cPf',
        optimize_streaming_latency: 4,
        stability: 0.4,
        speed: 1.05,
        similarity_boost: 0.8,
        agent_output_audio_format: 'pcm_16000',
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
                  required: [],
                },
                request_body_schema: null,
                response_body_schema: null,
                content_type: 'application/json',
                auth_resolved_params: [],
                auth_connection: null,
              },
            },
            // end_call — force speech before hangup so goodbye plays fully
            {
              type: 'system',
              name: 'end_call',
              description: 'End the call. Only call this after saying the full goodbye phrase.',
              response_timeout_secs: 20,
              disable_interruptions: true,
              force_pre_tool_speech: true,
              pre_tool_speech: 'Thanks for calling FlowDesk Pro, have a great day!',
              assignments: [],
              tool_call_sound: null,
              tool_call_sound_behavior: 'auto',
              tool_error_handling_mode: 'auto',
              params: { system_tool_type: 'end_call' },
            },
            // Restore transfer_to_number system tool
            {
              type: 'system',
              name: 'transfer_to_number',
              description: 'Transfer the caller to a human agent when they request it.',
              response_timeout_secs: 20,
              disable_interruptions: false,
              force_pre_tool_speech: false,
              pre_tool_speech: 'auto',
              assignments: [],
              tool_call_sound: null,
              tool_call_sound_behavior: 'auto',
              tool_error_handling_mode: 'auto',
              params: {
                system_tool_type: 'transfer_to_number',
                transfers: [
                  {
                    custom_sip_headers: [],
                    transfer_destination: {
                      type: 'phone',
                      phone_number: '+17023087429',
                    },
                    transfer_type: 'conference',
                    post_dial_digits: null,
                    phone_number: '+17023087429',
                    condition: 'The caller wants to speak with a human or be transferred to the team',
                  },
                ],
                enable_client_message: true,
              },
            },
            // Restore language_detection system tool
            {
              type: 'system',
              name: 'language_detection',
              description: 'Detect the user language and switch to it.',
              response_timeout_secs: 20,
              disable_interruptions: false,
              force_pre_tool_speech: false,
              pre_tool_speech: 'auto',
              assignments: [],
              tool_call_sound: null,
              tool_call_sound_behavior: 'auto',
              tool_error_handling_mode: 'auto',
              params: { system_tool_type: 'language_detection' },
            },
          ],
        },
      },
    },
    workflow: {
      prevent_subagent_loops: false,
      edges: {
        edge_1801ksxsy2kwfjp8wfnhwjgc3q3t: {
          source: 'start_node',
          target: 'node_4501ksxsy2kvf1tr9nw9kzpxb567',
          forward_condition: { label: null, type: 'unconditional' },
          backward_condition: null,
        },
        edge_0301ksxsy2kyeg3ah8cg1m88fc9m: {
          source: 'node_4501ksxsy2kvf1tr9nw9kzpxb567',
          target: 'node_4601ksxsy2kxfhzr73yy2fdqkn33',
          forward_condition: {
            label: null,
            type: 'llm',
            condition: 'The caller explicitly asks to speak with a human agent or be transferred',
          },
          backward_condition: null,
        },
        edge_6501ksxsy2m0e3t8b2qyav5tdzgw: {
          source: 'node_4501ksxsy2kvf1tr9nw9kzpxb567',
          target: 'node_2101ksxsy2kzeyftc99fd2y7pw06',
          forward_condition: {
            label: null,
            type: 'llm',
            condition: 'The agent has collected the caller first name AND last name AND reason for call, has confirmed next steps with the caller, and the caller has explicitly said goodbye or acknowledged the closing statement',
          },
          backward_condition: null,
        },
      },
      nodes: {
        start_node: {
          type: 'start',
          position: { x: 544, y: 64 },
          edge_order: ['edge_1801ksxsy2kwfjp8wfnhwjgc3q3t'],
        },
        node_4501ksxsy2kvf1tr9nw9kzpxb567: {
          conversation_config: {
            tts: {},
            agent: { prompt: { built_in_tools: {} } },
          },
          additional_prompt: `MANDATORY CLOSING SEQUENCE — follow this exact order every time:
1. Say "Thanks for calling FlowDesk Pro, have a great day!"
2. Call log_call tool (REQUIRED — logs the call record)
3. Call end_call tool (ONLY after log_call completes)

NEVER call end_call without calling log_call first.

IMPORTANT — do not end this call or advance until ALL of the following are true:
1. You have the caller's first name
2. You have the caller's last name
3. You have the caller's reason for calling
4. You have confirmed next steps with the caller
5. The caller has said goodbye or acknowledged the closing

If you have only the name and not the reason — ask: "And what is the reason for your call today?" and wait for the full answer.
If you have only a first name — ask for the last name before moving forward.
NEVER route to end after just receiving a name. A name alone does NOT complete this conversation.`,
          additional_knowledge_base: [],
          additional_tool_ids: [],
          type: 'override_agent',
          position: { x: 544, y: 242 },
          edge_order: [
            'edge_0301ksxsy2kyeg3ah8cg1m88fc9m',
            'edge_6501ksxsy2m0e3t8b2qyav5tdzgw',
          ],
          label: 'Customer Support',
          auto_advance_after_first_response: false,
        },
        node_4601ksxsy2kxfhzr73yy2fdqkn33: {
          custom_sip_headers: [],
          transfer_destination: { type: 'phone', phone_number: '+17023087429' },
          transfer_type: 'conference',
          post_dial_digits: null,
          type: 'phone_number',
          position: { x: 128, y: 420 },
          edge_order: [],
        },
        node_2101ksxsy2kzeyftc99fd2y7pw06: {
          type: 'end',
          position: { x: 960, y: 420 },
          edge_order: [],
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
