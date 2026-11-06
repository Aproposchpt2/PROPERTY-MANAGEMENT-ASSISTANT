// Call Trace Lab lessons, in Jeff's study format: layman's explanation, visual,
// technical explanation, production example (live records from this system),
// troubleshooting sequence, knowledge check, engineering takeaway.
(function () {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const parse = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } };
  const mask = (n) => (n && n.length > 4 ? `***${n.slice(-4)}` : n);
  // The caller's case confirmation: the SID saved on the case wins, then any text to the caller.
  const pickText = (msgs) => msgs.find((x) => x.saved_on_case) || msgs.find((x) => x.to_caller) || msgs[0];
  const toolResults = (d, name) => d.elevenlabs.turns.flatMap((t) => t.tool_results.filter((r) => r.tool_name === name).map((r) => ({ ...r, at: t.at })));

  const LESSONS = [
    {
      id: 'sms-delivery',
      title: 'Accepted is not delivered: following a text message',
      calls: ['conv_5801m6hkfpxeewqv2kzw2ambyyx3'],
      layman: [
        'When Ava offers to text the caller a case confirmation, the PMA function asks Twilio to send it. Twilio answers right away with a tracking number, the Message SID.',
        'That answer proves Twilio took the package. It does not prove the package arrived. Delivery is reported later, on the same tracking number.',
        'So the tool result Ava gets back, notificationState "SENT", only means "Twilio accepted it". To know whether the caller\'s phone got it, you look up the Message SID.',
      ],
      visual: (d) => {
        const m = pickText(d.sms?.data || []);
        const st = !m ? 'na' : m.status === 'delivered' ? 'ok' : ['undelivered', 'failed'].includes(m.status) ? 'bad' : 'warn';
        return [['Ava (ElevenLabs)', 'ok'], ['record_contact_preference', 'ok'], ['Netlify function', 'ok'], ['Twilio API: 201 + SM SID', m ? 'ok' : 'na'], ['Carrier', st], ['Caller\'s phone', st]];
      },
      technical: {
        text: [
          'The function calls Twilio\'s Messages API. Twilio replies HTTP 201 Created with a Message resource whose SID starts with SM. The function saves that SID on the maintenance request (intake_details → contactPreference → messageSid) and tells Ava notificationState SENT.',
          'The Message resource keeps changing after that: queued → sending → sent → delivered, or undelivered / failed with an error code. "sent" means handed to the carrier. Only "delivered" means the carrier confirmed the handset received it.',
        ],
        fields: [['sid', 'Tracking number (SM…)'], ['status', 'Where the message is in its life cycle right now'], ['error_code', 'Twilio\'s code when delivery or processing failed (for example 30003, unreachable handset)'], ['error_message', 'Extra detail, when Twilio has it'], ['date_created / date_updated', 'When Twilio accepted it, and when the status last changed']],
      },
      example: (d) => {
        const pref = toolResults(d, 'record_contact_preference').map((r) => parse(r.result));
        const msgs = d.sms?.data || [];
        const m = pickText(msgs);
        const record = {
          tool_result_ava_received: pref[0] ? { notificationState: pref[0].notificationState, notificationSent: pref[0].notificationSent } : null,
          twilio_message_resource: m ? { sid: m.sid, to: mask(m.to), status: m.status, error_code: m.error_code, error_message: m.error_message, date_created: m.date_created, date_updated: m.date_updated, saved_on_case: m.saved_on_case } : null,
          other_texts_in_window: msgs.filter((x) => x !== m).map((x) => ({ sid: x.sid, to: mask(x.to), status: x.status, error_code: x.error_code })),
        };
        const read = [];
        if (d.sms?.error) read.push(`The lab could not read Twilio messages: ${d.sms.error}.`);
        else if (!m) read.push('No Message resource was found for this call. Check the SID saved on the case in Supabase, then search it in Twilio\'s Messaging log.');
        else {
          read.push(`Ava was told "${pref[0]?.notificationState || '?'}". That is the 201 Created checkpoint only.`);
          if (m.status === 'delivered') read.push('Twilio now reports "delivered": the carrier confirmed the handset received it. This text worked end to end.');
          else if (['undelivered', 'failed'].includes(m.status)) read.push(`Twilio reports "${m.status}" with error ${m.error_code}. Twilio accepted the request but the text never reached the phone, even though Ava told the caller it was sent.`);
          else read.push(`Twilio reports "${m.status}". Delivery has not been confirmed.`);
          const others = msgs.filter((x) => x !== m);
          if (others.length) {
            const same = others.filter((x) => x.to_caller).length;
            read.push(`${others.length} other text(s) went out in the same window (${others.map((x) => x.status).join(', ')}).${same ? ` ${same} of them went to the caller's own number. The staff alerts go to the numbers in PMA_SMS_MAINTENANCE_NUMBER and PMA_SMS_MANAGER_NUMBER; if those point to the same phone you test from, you receive the staff alerts too.` : ''}`);
          }
        }
        return { record, read };
      },
      steps: [
        'Read the tool result Ava received (record_contact_preference): note notificationState and notificationSent.',
        'Get the Message SID: from the maintenance request in Supabase (intake_details → contactPreference → messageSid) or from the lab\'s Text delivery hop.',
        'Look up the Message resource in Twilio (Monitor → Logs → Messaging, search the SID).',
        'Read status, error_code and error_message. Remember the status can still change.',
        'If undelivered or failed: check the destination number the caller gave, the sending number\'s registration, and the error code\'s meaning in Twilio\'s docs.',
        'Correlate with the case: the request row should say SENT, and Twilio should say delivered. If they disagree, the gap is in the carrier leg, not in your code.',
      ],
      check: {
        q: 'Ava\'s tool result says notificationState "SENT". The caller says they never got a text. What has been established so far?',
        options: ['The caller is wrong: SENT means the text arrived.', 'Twilio accepted the request and issued a Message SID. Delivery has to be checked on that Message resource.', 'The Netlify function failed, because the text did not arrive.'],
        answer: 1,
        why: 'SENT is recorded when Twilio returns 201 Created. It proves acceptance, not delivery. The function did its job; the next stage to check is the Message status and error code in Twilio.',
      },
      takeaway: 'Ava → PMA function → Twilio API (201 + SM SID) → carrier → caller\'s phone. Each arrow is its own checkpoint.',
    },
    {
      id: 'ok-not-success',
      title: '200 OK is not success: the close_session failure',
      calls: ['conv_5801m6hkfpxeewqv2kzw2ambyyx3'],
      layman: [
        'Picture a courier who knocks, gets the door answered, and hands over a note that says "sorry, we could not do that". The knock worked. The job did not.',
        'HTTP 200 OK means the web request reached the function and got an answer. It says nothing about whether the work behind it succeeded. You have to read what the answer says.',
        'On this call, close_session got 200 OK both times, so ElevenLabs shows no error. The answer inside said success false.',
      ],
      visual: () => [['Ava (ElevenLabs)', 'ok'], ['close_session tool', 'ok'], ['Netlify function: HTTP 200', 'ok'], ['Body: success false', 'bad'], ['Supabase: session close', 'bad']],
      technical: {
        text: [
          'ElevenLabs marks a tool call as an error (is_error true) only when the HTTP request itself fails: a 4xx or 5xx status, a timeout, or no answer. A 200 with an error inside the body is passed to the agent as a normal result.',
          'The PMA function catches database errors and returns 200 with { success: false, state: "UNKNOWN" } on purpose, so Ava does not invent a case number. That is safe for the caller, but it hides failures from any check that only looks at status codes.',
          'close_session runs the Supabase function pma_voice_session_close_v1. If it succeeds, the session row gets status closed and an ended_at time.',
        ],
        fields: [['is_error', 'ElevenLabs: did the HTTP request fail?'], ['result_value', 'The body the function returned. Read success and state here.'], ['tool_latency_secs', 'How long the tool took'], ['pma_voice_sessions.status', 'active or closed'], ['pma_voice_sessions.ended_at', 'Set only when the close worked']],
      },
      example: (d) => {
        const closes = toolResults(d, 'close_session');
        const sess = (d.supabase.pma_voice_sessions.data || [])[0];
        const record = {
          close_session_calls: closes.map((r) => ({ at_second: r.at, is_error: r.is_error, latency_secs: Number(r.latency_secs?.toFixed(2)), result: parse(r.result) })),
          session_row: sess ? { status: sess.status, started_at: sess.started_at, ended_at: sess.ended_at } : d.supabase.pma_voice_sessions.error || null,
          function_trace: (d.function_trace.data || []).filter((r) => r.tool_name === 'close_session').map((r) => ({ status_code: r.status_code, outcome_state: r.outcome_state, error: r.error })),
        };
        const read = [`close_session was called ${closes.length} time(s): ${closes.map((r) => `at ${r.at}s → ${parse(r.result)?.success === false ? 'success false' : 'ok'}`).join(', ')}. ElevenLabs is_error: ${closes.map((r) => r.is_error).join(', ')}.`];
        if (sess) read.push(sess.status === 'closed' && sess.ended_at ? 'The session row is closed, so a later attempt worked.' : `The session row is still "${sess.status}" with no ended_at. The close never reached the database.`);
        if (closes[0] && closes[0].at < 60) read.push(`The first close_session came at ${closes[0].at} seconds, long before the call ended. That is a second problem: Ava called the tool too early, a prompt issue.`);
        read.push(record.function_trace.length ? 'The function trace rows below name the real error.' : 'This call is older than the function trace, so the exact error code is not stored. A fresh call will record it in the Netlify trace (error field) once the trace tables are live.');
        return { record, read };
      },
      steps: [
        'In ElevenLabs, open the transcript and read the result body of each tool call, not only whether it shows an error.',
        'Note the state (UNKNOWN here) and the exact second each tool was called.',
        'Check the database side: is the pma_voice_sessions row for this CallSid still active, and is ended_at empty?',
        'Find the reason: Netlify function log for cedar-elevenlabs, event cedar_elevenlabs_tool_failed with tool close_session; the error reads PMA_RPC_<code>. In the lab, the function trace error field shows the same.',
        'Look up that Postgres error code and read pma_voice_session_close_v1 in Supabase to see which check rejects it.',
        'Separately, read Ava\'s prompt for when it tells her to call close_session.',
      ],
      check: {
        q: 'A tool call shows HTTP 200, ElevenLabs is_error false, and the body {"success":false,"state":"UNKNOWN"}. Best conclusion?',
        options: ['Everything worked: 200 means success.', 'ElevenLabs failed to reach the function.', 'The request reached the function, but the operation behind it failed. Investigate the function log and the database.'],
        answer: 2,
        why: 'Transport and outcome are different layers. 200 proves the request and response worked; the body proves the work failed. The cause is inside the function or the database call it makes.',
      },
      takeaway: 'Ava → HTTP 200 (transport OK) → body success false (operation failed) → Supabase row unchanged. Always read the body.',
    },
    {
      id: 'credits-out',
      title: 'The call that never started: the vendor ran out of credits',
      calls: ['conv_3001m6fngj20ey4ty8bphdqft2cy', 'conv_9201m6fnb50he75sya3jzdgepbeq'],
      layman: [
        'Twilio answers the phone and hands the caller to ElevenLabs, like a receptionist transferring to a specialist. On Nov 2 the specialist\'s account had run out of prepaid time.',
        'One caller was cut off mid-conversation after 137 seconds. The next three callers were transferred to nobody: the calls connected and ended in 0 seconds.',
        'Nothing was wrong with the code, the phone line or the database. The failure was a billing limit at one vendor.',
      ],
      visual: () => [['Caller', 'ok'], ['Twilio: call answered', 'ok'], ['ElevenLabs: start conversation', 'bad'], ['Tools / Netlify', 'na'], ['Supabase', 'na']],
      technical: {
        text: [
          'ElevenLabs bills each conversation against the account\'s credits. When credits run out it refuses to start new conversations (error code 3000, quota_exceeded, error_type call_initialization_error) and ends a running one with "This request exceeds your quota limit."',
          'Twilio still shows the call: it answered and streamed audio to ElevenLabs, which closed the stream. No tools ran, so the PMA function and Supabase have nothing for these calls. Silence in the later hops is itself a clue.',
        ],
        fields: [['status', 'ElevenLabs conversation status: failed'], ['metadata.error.code / reason', 'Why it failed to start'], ['termination_reason', 'Why a running call ended'], ['call_duration_secs', '0 for calls that never started'], ['Twilio call duration', 'Short, but the call did connect']],
      },
      example: (d1, d2) => {
        const one = d1.elevenlabs; const two = d2?.elevenlabs;
        const record = {
          call_that_never_started: { conversation: one.conversation_id, status: one.status, duration_secs: one.duration_secs, error: one.error, twilio_call: d1.twilio.error ? d1.twilio.error : { status: d1.twilio.call.status, duration: d1.twilio.call.duration }, tools_run: one.turns.flatMap((t) => t.tool_calls).length },
          call_cut_off: two ? { conversation: two.conversation_id, status: two.status, duration_secs: two.duration_secs, termination_reason: two.termination_reason, tools_run: two.turns.flatMap((t) => t.tool_calls.map((c) => c.tool_name)) } : null,
        };
        const read = [
          `The first record failed with: ${String(one.error?.reason || one.status).replace(/\.$/, '')}. Duration ${one.duration_secs} s, ${record.call_that_never_started.tools_run} tools.`,
          d1.twilio.error ? 'Twilio\'s side could not be read here.' : `Twilio shows that call as "${d1.twilio.call.status}", ${d1.twilio.call.duration} s: the phone leg worked.`,
        ];
        if (two) read.push(`The earlier call ended after ${two.duration_secs} s with "${two.termination_reason}". Credits ran out during that call, and every call after it failed until credits were added.`);
        return { record, read };
      },
      steps: [
        'Spot the pattern: several calls in a row at 0 seconds, status failed, no transcript.',
        'Open one in ElevenLabs (Overview): read the error reason and error type.',
        'Confirm the phone leg in Twilio: the call connected, so the number and webhook are fine.',
        'Note that Netlify and Supabase have no records, consistent with a failure before any tool could run.',
        'Remedy: add credits or upgrade the ElevenLabs plan. Prevention: usage alerts, auto top-up, and a Twilio fallback that forwards to a person when the agent is unavailable.',
      ],
      check: {
        q: 'Calls connect but end in 0 seconds. ElevenLabs shows status failed, error_type call_initialization_error, reason quota_exceeded. Twilio shows the calls completed. Which layer do you fix?',
        options: ['Twilio: the phone number is misconfigured.', 'The ElevenLabs account: it is out of credits.', 'The Netlify function: it is crashing.'],
        answer: 1,
        why: 'Twilio connected the calls, so the line works. The function was never called. The error comes from ElevenLabs refusing to start a conversation because the account is out of credits.',
      },
      takeaway: 'Caller → Twilio (OK) → ElevenLabs (refused: no credits) → nothing downstream. When later hops are empty, the fault is at the last hop that has records.',
    },
,
    {
      id: 'academy-diagnostic-1',
      title: "HTTP 201 Created: accepted does not mean delivered",
      calls: [],
      synthetic: true,
      layman: ["The messaging provider accepted a new message resource. Think of a courier assigning a tracking number; the package has not arrived yet."],
      visual: () => [["POST /Messages","ok"],["HTTP 201 Created","ok"],["Message SID assigned","ok"],["carrier pending","warn"]],
      technical: { text: ["201 Created confirms resource creation, not handset delivery."], fields: [["http_status","Synthetic diagnostic value: 201 Created"],["message_sid","Synthetic diagnostic value: SM (synthetic example)"],["status","Synthetic diagnostic value: queued"]] },
      example: () => ({ record: { synthetic: true, scenario: "HTTP 201 Created: accepted does not mean delivered", diagnostic: Object.fromEntries([["http_status","201 Created"],["message_sid","SM (synthetic example)"],["status","queued"]]) }, read: ["201 Created confirms resource creation, not handset delivery."] }),
      steps: ['Identify the HTTP method and status, if present.', 'Read the JSON fields without assuming downstream success.', 'Find the last confirmed successful hop and the first observed failure.', 'Correlate the Message SID, request logs and provider error details when applicable.', 'Verify the actual outcome before retrying; avoid duplicate messages or incidents.'],
      check: { q: "A notification tool returns 201 and a Message SID. What is proven?", options: ["The recipient read the text.","Twilio created a Message resource; delivery still requires verification.","The carrier rejected the text."], answer: 1, why: "201 is the creation checkpoint. Retrieve the SID and check later status." },
      takeaway: "201 is the creation checkpoint. Retrieve the SID and check later status.",
    },
    {
      id: 'academy-diagnostic-2',
      title: "HTTP 200 with failed business outcome",
      calls: [],
      synthetic: true,
      layman: ["A diagnostic dashboard can load correctly while reporting an equipment fault. Successful reporting is not successful repair."],
      visual: () => [["GET incident","ok"],["HTTP 200","ok"],["JSON notification_status: failed","warn"]],
      technical: { text: ["HTTP success describes the GET transaction; JSON describes the incident workflow."], fields: [["http_status","Synthetic diagnostic value: 200 OK"],["incident_status","Synthetic diagnostic value: open"],["notification_status","Synthetic diagnostic value: failed"]] },
      example: () => ({ record: { synthetic: true, scenario: "HTTP 200 with failed business outcome", diagnostic: Object.fromEntries([["http_status","200 OK"],["incident_status","open"],["notification_status","failed"]]) }, read: ["HTTP success describes the GET transaction; JSON describes the incident workflow."] }),
      steps: ['Identify the HTTP method and status, if present.', 'Read the JSON fields without assuming downstream success.', 'Find the last confirmed successful hop and the first observed failure.', 'Correlate the Message SID, request logs and provider error details when applicable.', 'Verify the actual outcome before retrying; avoid duplicate messages or incidents.'],
      check: { q: "GET returns 200 with notification_status failed. What follows?", options: ["The notification succeeded.","The incident was deleted.","The retrieval succeeded, but notification is reported failed."], answer: 2, why: "Inspect the notification attempt and its provider evidence." },
      takeaway: "Inspect the notification attempt and its provider evidence.",
    },
    {
      id: 'academy-diagnostic-3',
      title: "Sent is not delivered: reading JSON null",
      calls: [],
      synthetic: true,
      layman: ["A router forwarding a packet to its next hop does not prove end-to-end arrival."],
      visual: () => [["Twilio accepted","ok"],["sent","ok"],["delivery still unconfirmed","warn"]],
      technical: { text: ["JSON null is absence of a recorded value, not a success flag."], fields: [["status","Synthetic diagnostic value: sent"],["error_code","Synthetic diagnostic value: null"]] },
      example: () => ({ record: { synthetic: true, scenario: "Sent is not delivered: reading JSON null", diagnostic: Object.fromEntries([["status","sent"],["error_code",null]]) }, read: ["JSON null is absence of a recorded value, not a success flag."] }),
      steps: ['Identify the HTTP method and status, if present.', 'Read the JSON fields without assuming downstream success.', 'Find the last confirmed successful hop and the first observed failure.', 'Correlate the Message SID, request logs and provider error details when applicable.', 'Verify the actual outcome before retrying; avoid duplicate messages or incidents.'],
      check: { q: "Twilio says status sent and error_code null. Which interpretation is correct?", options: ["The handset definitely received it.","The message was sent onward; delivery has not been confirmed.","The message was rejected."], answer: 1, why: "Check later delivery status or callbacks; do not equate null with success." },
      takeaway: "Check later delivery status or callbacks; do not equate null with success.",
    },
    {
      id: 'academy-diagnostic-4',
      title: "Delivered does not mean read",
      calls: [],
      synthetic: true,
      layman: ["A courier may confirm a package was delivered without knowing whether anyone opened it."],
      visual: () => [["Twilio status: delivered","ok"],["handset delivery reported","ok"],["reading unknown","warn"]],
      technical: { text: ["A delivery receipt is not a read receipt."], fields: [["status","Synthetic diagnostic value: delivered"],["error_code","Synthetic diagnostic value: null"]] },
      example: () => ({ record: { synthetic: true, scenario: "Delivered does not mean read", diagnostic: Object.fromEntries([["status","delivered"],["error_code",null]]) }, read: ["A delivery receipt is not a read receipt."] }),
      steps: ['Identify the HTTP method and status, if present.', 'Read the JSON fields without assuming downstream success.', 'Find the last confirmed successful hop and the first observed failure.', 'Correlate the Message SID, request logs and provider error details when applicable.', 'Verify the actual outcome before retrying; avoid duplicate messages or incidents.'],
      check: { q: "What does delivered establish?", options: ["The person read the SMS.","The application database is closed.","Twilio reports delivery, not that the recipient read it."], answer: 2, why: "Delivery confirmation is not proof of human acknowledgement." },
      takeaway: "Delivery confirmation is not proof of human acknowledgement.",
    },
    {
      id: 'academy-diagnostic-5',
      title: "401 Unauthorized: authentication rejected",
      calls: [],
      synthetic: true,
      layman: ["The security desk cannot verify your badge, so it refuses entry."],
      visual: () => [["Client","ok"],["API","ok"],["401 Unauthorized","warn"]],
      technical: { text: ["401 is named Unauthorized but generally points to missing or invalid authentication."], fields: [["http_status","Synthetic diagnostic value: 401 Unauthorized"],["operation","Synthetic diagnostic value: GET /Messages/{sid}"]] },
      example: () => ({ record: { synthetic: true, scenario: "401 Unauthorized: authentication rejected", diagnostic: Object.fromEntries([["http_status","401 Unauthorized"],["operation","GET /Messages/{sid}"]]) }, read: ["401 is named Unauthorized but generally points to missing or invalid authentication."] }),
      steps: ['Identify the HTTP method and status, if present.', 'Read the JSON fields without assuming downstream success.', 'Find the last confirmed successful hop and the first observed failure.', 'Correlate the Message SID, request logs and provider error details when applicable.', 'Verify the actual outcome before retrying; avoid duplicate messages or incidents.'],
      check: { q: "Which check comes first for a reported 401?", options: ["Inspect the authentication credentials, account context and request method.","Check carrier delivery.","Recreate the incident."], answer: 0, why: "401 is an authentication checkpoint; check the provider error details." },
      takeaway: "401 is an authentication checkpoint; check the provider error details.",
    },
    {
      id: 'academy-diagnostic-6',
      title: "403 Forbidden: access refused",
      calls: [],
      synthetic: true,
      layman: ["Your badge identifies you, but does not grant access to every secured room."],
      visual: () => [["Authenticated client","ok"],["protected resource","ok"],["403 Forbidden","warn"]],
      technical: { text: ["403 commonly indicates permission or policy refusal; it does not always prove authentication succeeded."], fields: [["http_status","Synthetic diagnostic value: 403 Forbidden"],["resource","Synthetic diagnostic value: protected message report"]] },
      example: () => ({ record: { synthetic: true, scenario: "403 Forbidden: access refused", diagnostic: Object.fromEntries([["http_status","403 Forbidden"],["resource","protected message report"]]) }, read: ["403 commonly indicates permission or policy refusal; it does not always prove authentication succeeded."] }),
      steps: ['Identify the HTTP method and status, if present.', 'Read the JSON fields without assuming downstream success.', 'Find the last confirmed successful hop and the first observed failure.', 'Correlate the Message SID, request logs and provider error details when applicable.', 'Verify the actual outcome before retrying; avoid duplicate messages or incidents.'],
      check: { q: "One resource returns 200 and another 403. Best next step?", options: ["Assume the network is offline.","Compare authorization, resource ownership, account context and response details.","Assume SMS was delivered."], answer: 1, why: "Investigate access rules for the specific resource." },
      takeaway: "Investigate access rules for the specific resource.",
    },
    {
      id: 'academy-diagnostic-7',
      title: "Missing environment variable: no request sent",
      calls: [],
      synthetic: true,
      layman: ["The technician cannot find the labeled credential before making the call."],
      visual: () => [["Netlify","ok"],["credential validation failed","ok"],["Twilio not contacted","warn"]],
      technical: { text: ["process.env looks up the exact variable key; a different key name is not automatically equivalent."], fields: [["missing_variable","Synthetic diagnostic value: TWILIO_API_SECRET"],["configured_variable","Synthetic diagnostic value: TWILIO_AUTH_KEY"],["api_request_sent","Synthetic diagnostic value: false"]] },
      example: () => ({ record: { synthetic: true, scenario: "Missing environment variable: no request sent", diagnostic: Object.fromEntries([["missing_variable","TWILIO_API_SECRET"],["configured_variable","TWILIO_AUTH_KEY"],["api_request_sent",false]]) }, read: ["process.env looks up the exact variable key; a different key name is not automatically equivalent."] }),
      steps: ['Identify the HTTP method and status, if present.', 'Read the JSON fields without assuming downstream success.', 'Find the last confirmed successful hop and the first observed failure.', 'Correlate the Message SID, request logs and provider error details when applicable.', 'Verify the actual outcome before retrying; avoid duplicate messages or incidents.'],
      check: { q: "What should you inspect first?", options: ["Twilio carrier logs.","Netlify variable names, scope and function code.","Recipient handset settings."], answer: 1, why: "No API request means isolate the local configuration stage first." },
      takeaway: "No API request means isolate the local configuration stage first.",
    },
    {
      id: 'academy-diagnostic-8',
      title: "Message SID and error code: find the failing hop",
      calls: [],
      synthetic: true,
      layman: ["A shipping tracking number lets you find the package's latest disposition."],
      visual: () => [["Netlify 201","ok"],["SM SID","ok"],["Twilio status undelivered","warn"]],
      technical: { text: ["A Message SID identifies the message resource; an undelivered status and provider error guide the next investigation."], fields: [["status","Synthetic diagnostic value: undelivered"],["error_code","Synthetic diagnostic value: 30003"],["sid","Synthetic diagnostic value: SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"]] },
      example: () => ({ record: { synthetic: true, scenario: "Message SID and error code: find the failing hop", diagnostic: Object.fromEntries([["status","undelivered"],["error_code",30003],["sid","SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"]]) }, read: ["A Message SID identifies the message resource; an undelivered status and provider error guide the next investigation."] }),
      steps: ['Identify the HTTP method and status, if present.', 'Read the JSON fields without assuming downstream success.', 'Find the last confirmed successful hop and the first observed failure.', 'Correlate the Message SID, request logs and provider error details when applicable.', 'Verify the actual outcome before retrying; avoid duplicate messages or incidents.'],
      check: { q: "Twilio accepted the message but later reports undelivered, code 30003. Next action?", options: ["Inspect the message's provider diagnostics and destination reachability.","Assume the original webhook never arrived.","Declare successful delivery."], answer: 0, why: "30003 indicates an unreachable destination handset, but not the precise physical cause." },
      takeaway: "30003 indicates an unreachable destination handset, but not the precise physical cause.",
    }
  ];

  const done = (id) => { try { return localStorage.getItem('lesson_' + id); } catch { return null; } };

  function chain(steps) {
    return `<div class="chain">${steps.map(([label, st], i) => `${i ? '<span class="arrow">→</span>' : ''}<span class="link ${st}">${esc(label)}</span>`).join('')}</div>`;
  }

  function listView(main, ctx) {
    main.innerHTML = `<h2 class="ls-h">Lessons</h2>
      <p class="desc">Each lesson follows the same order: layman's explanation, visual, technical explanation, a production example from your calls or a clearly labeled synthetic diagnostic, the troubleshooting sequence, and a knowledge check.</p>
      ${LESSONS.map((l, i) => `<button class="call ls-pick" data-id="${l.id}" style="border:1px solid var(--line);margin-bottom:8px"><b>Lesson ${i + 1}: ${esc(l.title)}</b><div class="sub">${done(l.id) === 'right' ? 'Knowledge check passed' : done(l.id) ? 'Knowledge check attempted' : 'Not started'}</div></button>`).join('')}`;
    main.querySelectorAll('.ls-pick').forEach((b) => b.addEventListener('click', () => lessonView(main, ctx, b.dataset.id)));
  }

  async function lessonView(main, ctx, id) {
    const l = LESSONS.find((x) => x.id === id); const n = LESSONS.indexOf(l) + 1;
    main.innerHTML = `<p class="muted">Loading the real records for this lesson…</p>`;
    let data;
    try { data = l.synthetic ? [] : await Promise.all(l.calls.map((c) => ctx.api('/api/ops/trace/calls/' + c))); }
    catch (e) { main.innerHTML = `<div class="err-box">${esc(e.message)}</div>`; return; }
    const ex = l.example(...data);
    const prev = done(l.id);
    main.innerHTML = `
      <button class="btn-sm" id="ls-back">← All lessons</button>
      <div class="ls-kicker">APG AI ACADEMY · CALL TRACE LAB</div>
      <h2 class="ls-h">Lesson ${n}: ${esc(l.title)}</h2>
      <section class="ls-sec"><h3>1. Layman's explanation</h3>${l.layman.map((p) => `<p>${esc(p)}</p>`).join('')}</section>
      <section class="ls-sec"><h3>2. Visual: follow the transaction</h3>${chain(l.visual(...data))}<p class="muted small">Colors come from this call's real records (green worked, red failed, amber not confirmed, grey not reached).</p></section>
      <section class="ls-sec"><h3>3. Technical explanation</h3>${l.technical.text.map((p) => `<p>${esc(p)}</p>`).join('')}
        <table class="fields"><thead><tr><th>Field</th><th>Diagnostic purpose</th></tr></thead><tbody>${l.technical.fields.map(([f, p]) => `<tr><td class="mono">${esc(f)}</td><td>${esc(p)}</td></tr>`).join('')}</tbody></table></section>
      <section class="ls-sec"><h3>4. ${l.synthetic ? 'Synthetic diagnostic example (training only)' : 'Production example: your real records'}</h3>
        <pre class="ls-pre">${esc(JSON.stringify(ex.record, null, 2))}</pre>
        <p><b>Reading it precisely:</b></p><ul>${ex.read.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
        <div class="drawer-actions">${l.calls.map((c) => `<button class="btn-sm ls-open" data-c="${c}">Open the full trace for ${esc(c.slice(0, 14))}…</button>`).join('')}</div></section>
      <section class="ls-sec"><h3>5. Troubleshooting: your diagnostic sequence</h3><ol>${l.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></section>
      <section class="ls-sec"><h3>6. Knowledge check</h3><p>${esc(l.check.q)}</p>
        <div class="kc">${l.check.options.map((o, i) => `<label><input type="radio" name="kc" value="${i}"> <b>${'ABC'[i]}.</b> ${esc(o)}</label>`).join('')}</div>
        <button class="btn-primary" id="kc-submit">Submit answer</button><div id="kc-out" role="status">${prev ? `<p class="muted small">Previous attempt: ${prev === 'right' ? 'correct' : 'incorrect'}.</p>` : ''}</div></section>
      <section class="ls-sec"><h3>Engineering takeaway</h3><p>${esc(l.takeaway)}</p></section>
      <div class="drawer-actions">${LESSONS[n] ? `<button class="btn-sm" id="ls-next">Next lesson →</button>` : ''}</div>`;
    main.scrollTop = 0;
    main.querySelector('#ls-back').onclick = () => listView(main, ctx);
    if (main.querySelector('#ls-next')) main.querySelector('#ls-next').onclick = () => lessonView(main, ctx, LESSONS[n].id);
    main.querySelectorAll('.ls-open').forEach((b) => { b.onclick = () => ctx.openCall(b.dataset.c); });
    main.querySelector('#kc-submit').onclick = () => {
      const pick = main.querySelector('input[name=kc]:checked');
      const out = main.querySelector('#kc-out');
      if (!pick) { out.innerHTML = '<p class="muted">Pick an answer first.</p>'; return; }
      const right = Number(pick.value) === l.check.answer;
      try { localStorage.setItem('lesson_' + l.id, right ? 'right' : 'wrong'); } catch { /* private mode */ }
      out.innerHTML = `<div class="${right ? 'ok-box' : 'err-box'}">${right ? 'Correct.' : `Not quite. The answer is ${'ABC'[l.check.answer]}.`} ${esc(l.check.why)}</div>`;
    };
  }

  window.Lessons = { render: (main, ctx) => (ctx.lessonId && LESSONS.some((l) => l.id === ctx.lessonId) ? lessonView(main, ctx, ctx.lessonId) : listView(main, ctx)), LESSONS };
})();
