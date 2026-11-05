// Call Trace Lab page (/admin/testing/calls). Shows one phone call across Twilio,
// the language menu, ElevenLabs, the PMA tool function and Supabase, and runs
// staged fault drills. Data comes from /api/ops/trace/*.
(function () {
  const { esc, api, boot } = OpsAdmin;
  const $ = (id) => document.getElementById(id);
  const S = { calls: [], next: null, open: null, view: 'calls', status: null };
  const NORMAL_END = ['end_call tool was called.', 'Call ended by remote party'];

  const fmtTime = (unix) => (unix ? new Date(unix * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
  const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const parse = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } };
  const pretty = (o) => esc(JSON.stringify(o, null, 2));
  const raw = (label, o) => `<details class="raw"><summary>${esc(label)}</summary><pre>${pretty(o)}</pre></details>`;
  const safeDecode = (t) => { const s = String(t || '').replace(/\+/g, ' '); try { return decodeURIComponent(s); } catch { return s; } };
  const shortUrl = (u) => { try { const x = new URL(u); return x.host + x.pathname; } catch { return u || ''; } };

  function listFlags(c) {
    const f = [];
    if (c.status === 'failed') f.push(['Failed', '']);
    if (c.duration_secs < 10) f.push(['Under 10 s', 'w']);
    if (c.termination_reason && !NORMAL_END.includes(c.termination_reason)) f.push([c.termination_reason.slice(0, 40), '']);
    if (c.call_successful === 'failure') f.push(['Marked unsuccessful', '']);
    if (!f.length && c.tools.length) f.push(['Tools ran', 'ok']);
    return f;
  }

  function renderList() {
    const el = $('calls');
    if (!S.calls.length) { el.innerHTML = '<p class="muted" style="padding:18px">No calls found.</p>'; return; }
    el.innerHTML = S.calls.map((c) => `
      <button class="call${S.open === c.conversation_id ? ' on' : ''}" data-id="${esc(c.conversation_id)}">
        <b>${esc(c.title || 'Untitled call')}</b>
        <div class="sub">${esc(fmtTime(c.started_at))} · ${esc(c.duration_secs)} s · ${esc(c.language || '')} · ${esc(c.status)}</div>
        <div class="sub">${esc(c.tools.join(', ') || 'no tools')}</div>
        <div class="flags">${listFlags(c).map(([t, k]) => `<span class="flag ${k}">${esc(t)}</span>`).join('')}</div>
      </button>`).join('') + (S.next ? '<button class="call" id="more"><b>Load older calls</b></button>' : '');
    el.querySelectorAll('.call[data-id]').forEach((b) => b.addEventListener('click', () => openCall(b.dataset.id)));
    if ($('more')) $('more').addEventListener('click', () => loadCalls(true));
  }

  async function loadStatus() {
    try {
      S.status = await api('/api/ops/trace/status');
      const s = S.status;
      const mark = (ok, name) => `${ok ? '✓' : '✕'} ${name}`;
      $('sources').innerHTML = [mark(s.elevenlabs, 'ElevenLabs'), mark(s.twilio, 'Twilio'), mark(s.supabase, 'Supabase'), mark(s.lab_tables, 'Trace tables')].map(esc).join(' · ')
        + (s.lab_tables ? '' : '<br><span style="color:var(--warn)">Trace tables are not created yet, so function traces and drills are off.</span>');
    } catch (e) { $('sources').textContent = 'Could not check sources: ' + e.message; }
  }

  async function loadCalls(more) {
    if (!more) { S.calls = []; S.next = null; $('calls').innerHTML = '<p class="muted" style="padding:18px">Loading…</p>'; }
    try {
      const r = await api('/api/ops/trace/calls' + (more && S.next ? '?cursor=' + encodeURIComponent(S.next) : ''));
      S.calls = S.calls.concat(r.calls || []); S.next = r.next_cursor; renderList();
    } catch (e) { $('calls').innerHTML = `<div class="err-box" style="margin:14px">${esc(e.message)}</div>`; }
  }

  // ---------- one call ----------
  function toolOutcome(r) {
    const v = parse(r.result);
    if (r.is_error) return { level: 'bad', text: `error${r.error_type ? ' ' + r.error_type : ''}${r.raw_error_message ? ': ' + r.raw_error_message : ''}` };
    if (v && v.success === false) return { level: 'bad', text: `HTTP OK but success false, state ${v.state || 'unknown'}` };
    if (v && typeof v === 'object') return { level: r.latency_secs > 4 ? 'warn' : 'ok', text: [v.state, v.caseNumber, v.notificationState && 'notification ' + v.notificationState].filter(Boolean).join(' · ') || 'ok' };
    return { level: 'warn', text: 'response was not JSON' };
  }

  function hops(d) {
    const el = d.elevenlabs; const tw = d.twilio; const menu = d.language_menu; const db = d.supabase;
    const results = el.turns.flatMap((t) => t.tool_results.filter((r) => r.tool_name !== 'end_call' && !['language_detection', 'transfer_to_number'].includes(r.tool_name)));
    const outcomes = results.map(toolOutcome);
    const fnRows = d.function_trace.data || [];
    const H = [];
    if (tw.error) H.push(['1 · Twilio', 'Phone line', 'na', tw.error]);
    else {
      const errs = Array.isArray(tw.notifications) ? tw.notifications.filter((n) => n.level === 'error') : [];
      const badHooks = Array.isArray(tw.events) ? tw.events.filter((e) => e.response_code >= 400) : [];
      H.push(['1 · Twilio', 'Phone line', errs.length || badHooks.length ? 'bad' : tw.call.status === 'completed' ? 'ok' : 'warn',
        errs.length ? `${errs.length} error alert(s)` : badHooks.length ? `${badHooks.length} webhook(s) failed` : `${tw.call.status}, ${tw.call.duration} s`]);
    }
    if (menu.error) H.push(['2 · Menu', 'stellaruc.com language menu', 'na', menu.error]);
    else H.push(['2 · Menu', 'stellaruc.com language menu', (menu.data || []).length ? 'ok' : 'warn', (menu.data || []).length ? `Chose ${menu.data[0].language || menu.data[0].digit || '?'}` : 'No menu record for this call']);
    const elBad = el.status === 'failed' || el.error;
    H.push(['3 · ElevenLabs', 'Ava agent', elBad ? 'bad' : NORMAL_END.includes(el.termination_reason) ? 'ok' : 'warn', elBad ? (el.error?.message || el.termination_reason || 'failed') : el.termination_reason || el.status]);
    const fnBad = outcomes.some((o) => o.level === 'bad') || fnRows.some((r) => r.status_code >= 400 || r.phase === 'started' && !fnRows.some((x) => x.phase === 'finished' && x.tool_name === r.tool_name && x.created_at > r.created_at));
    H.push(['4 · Netlify', 'PMA tool function', !results.length ? 'na' : fnBad ? 'bad' : outcomes.some((o) => o.level === 'warn') ? 'warn' : 'ok',
      !results.length ? 'No tools called' : `${results.length} request(s), ${outcomes.filter((o) => o.level === 'bad').length} failed`]);
    const created = results.some((r) => r.tool_name === 'create_incident' && toolOutcome(r).level !== 'bad');
    const reqRows = db.pma_maintenance_requests.data || [];
    const dbErr = db.pma_voice_sessions.error || db.pma_maintenance_requests.error;
    H.push(['5 · Supabase', 'Database rows', dbErr ? 'na' : created && !reqRows.length ? 'bad' : (db.pma_voice_sessions.data || []).length ? 'ok' : results.length ? 'warn' : 'na',
      dbErr ? dbErr : `${(db.pma_voice_sessions.data || []).length} session, ${reqRows.length} request, ${(db.pma_call_log.data || []).length} call log`]);
    const sms = d.sms || {}; const msgs = sms.data || [];
    const failed = msgs.filter((m) => ['undelivered', 'failed'].includes(m.status));
    const pending = msgs.filter((m) => !['delivered', 'undelivered', 'failed', 'received', 'read'].includes(m.status));
    H.push(['6 · Text delivery', 'Twilio messages', sms.error ? 'na' : !msgs.length ? 'na' : failed.length ? 'bad' : pending.length ? 'warn' : 'ok',
      sms.error ? sms.error : !msgs.length ? 'No texts on this call' : failed.length ? `${failed.length} of ${msgs.length} not delivered` : pending.length ? `${pending.length} of ${msgs.length} not confirmed (${pending[0].status})` : `${msgs.length} delivered`]);
    return H;
  }

  function timeline(d) {
    const el = d.elevenlabs; const t0 = (el.started_at || 0) * 1000; const E = [];
    const add = (ms, cls, src, what, more = '') => { if (Number.isFinite(ms)) E.push({ ms, cls, src, what, more }); };
    const tw = d.twilio;
    if (!tw.error) {
      add(Date.parse(tw.call.start_time), 'twilio', 'TWILIO', `Call starts: ${tw.call.from} → ${tw.call.to}`);
      (Array.isArray(tw.events) ? tw.events : []).forEach((e) => add(Date.parse(e.at), `twilio ${e.response_code >= 400 ? 'bad' : e.response_code >= 200 && e.response_code < 300 ? 'ok' : ''}`, 'TWILIO',
        `${e.method || ''} ${shortUrl(e.url)} → HTTP ${e.response_code ?? '?'} in ${e.ms ?? '?'} ms`, e.body ? e.body.slice(0, 260) : ''));
      (Array.isArray(tw.notifications) ? tw.notifications : []).forEach((n) => add(Date.parse(n.at), `twilio ${n.level === 'error' ? 'bad' : 'warn'}`, 'TWILIO', `Alert ${n.code} (${n.level})`, safeDecode(n.text).slice(0, 300)));
      if (tw.call.end_time) add(Date.parse(tw.call.end_time), 'twilio', 'TWILIO', `Call ends: ${tw.call.status}, ${tw.call.duration} s, price ${tw.call.price ?? 'pending'}`);
    }
    (d.language_menu.data || []).forEach((m) => add(Date.parse(m.created_at), 'menu', 'MENU', `Caller chose ${m.digit ?? ''} → ${m.language ?? ''}`));
    add(t0, 'el', 'ELEVENLABS', `Ava answers (${el.phone_call?.agent_number || ''}, caller ${el.phone_call?.external_number || ''})`);
    el.turns.forEach((t) => {
      const at = t0 + (t.at || 0) * 1000;
      if (t.message) {
        const llm = t.metrics.convai_llm_service_ttfb; const gap = t.metrics.convai_ttf_audio_since_silence;
        const slow = t.role === 'agent' && gap > 3;
        add(at, `el say${slow ? ' warn' : ''}`, t.role === 'agent' ? 'AVA' : 'CALLER', `“${t.message}”`,
          t.role === 'agent' && (llm || gap) ? `LLM first token ${llm?.toFixed(2) ?? '?'} s · caller heard audio ${gap?.toFixed(2) ?? '?'} s after they stopped talking${t.interrupted ? ' · interrupted' : ''}` : '');
      }
      t.tool_calls.forEach((c) => add(at, 'el', 'ELEVENLABS', `Calls tool ${c.tool_name}${c.url ? ' → POST ' + shortUrl(c.url) : ''}`, c.body ? c.body.slice(0, 400) : (c.params || '')));
      t.tool_results.forEach((r) => { const o = toolOutcome(r); add(at + 1, `el ${o.level}`, 'ELEVENLABS', `Tool ${r.tool_name} result in ${r.latency_secs?.toFixed(2)} s: ${o.text}`, String(r.result || '').slice(0, 400)); });
    });
    (d.function_trace.data || []).forEach((r) => add(Date.parse(r.created_at), `fn ${r.status_code >= 400 || r.success === false || r.phase === 'started' ? 'bad' : 'ok'}`, 'NETLIFY',
      r.phase === 'started' ? `Tool function started ${r.tool_name} (drill: ${r.fault_key || 'none'}) — no finish row means it never answered` : `Tool function ${r.tool_name} → HTTP ${r.status_code} in ${r.latency_ms} ms, ${r.outcome_state || (r.success ? 'ok' : 'failed')}`,
      [r.error && `error: ${r.error}`, r.fault_key && `drill fired: ${r.fault_key}`].filter(Boolean).join(' · ')));
    (d.supabase.pma_voice_sessions.data || []).forEach((s) => {
      add(Date.parse(s.started_at), 'db', 'SUPABASE', `pma_voice_sessions row created (status ${s.status})`);
      if (s.ended_at) add(Date.parse(s.ended_at), 'db', 'SUPABASE', 'pma_voice_sessions row closed');
    });
    (d.supabase.pma_maintenance_requests.data || []).forEach((q) => add(Date.parse(q.created_at), 'db', 'SUPABASE', `pma_maintenance_requests row ${q.case_number || ''} (status ${q.status || '?'})`));
    (d.supabase.pma_call_log.data || []).forEach((l) => add(Date.parse(l.created_at), 'db', 'SUPABASE', `pma_call_log row written by the post-call webhook (${l.call_duration_secs} s)`));
    (d.sms?.data || []).forEach((m) => {
      const who = m.to_caller ? 'the caller' : m.to;
      add(Date.parse(m.date_created), 'twilio ok', 'TWILIO SMS', `Text accepted (HTTP 201), Message SID ${m.sid} → ${who}`, m.saved_on_case ? 'This SID is saved on the maintenance request.' : '');
      const bad = ['undelivered', 'failed'].includes(m.status); const done = m.status === 'delivered';
      add(Date.parse(m.date_updated || m.date_sent || m.date_created) + 1, `twilio ${bad ? 'bad' : done ? 'ok' : 'warn'}`, 'TWILIO SMS',
        `Text to ${who} is now "${m.status}"${m.error_code ? `, error ${m.error_code}` : ''}`, m.error_message || (done ? 'The carrier confirmed delivery to the handset.' : bad ? '' : 'Accepted or sent, but delivery is not confirmed.'));
    });
    E.sort((a, b) => a.ms - b.ms);
    return `<ul class="tl">${E.map((e) => `<li class="ev ${e.cls}"><span class="at">${mmss(e.ms - t0)}</span><span class="src">${e.src}</span><span class="what">${esc(e.what)}</span>${e.more ? `<div class="more">${esc(e.more)}</div>` : ''}</li>`).join('')}</ul>`;
  }

  function sourceDetail(d) {
    const el = d.elevenlabs;
    const sid = el.phone_call?.call_sid || '';
    return `
      <div class="section-sep">Where each piece lives in production</div>
      <div class="field-row"><span class="field-label">1 · Twilio</span>
        <p class="where">Twilio Console → Monitor → Logs → Calls → search CallSid <span class="mono">${esc(sid)}</span>. Open "Request Inspector" for every webhook Twilio called and what came back; "Errors and warnings" in Monitor → Alerts.</p>
        ${d.twilio.error ? `<div class="err-box">${esc(d.twilio.error)}</div>` : raw('Twilio call record', d.twilio.call) + raw('Twilio webhook requests (Request Inspector)', d.twilio.events) + raw('Twilio alerts for this call', d.twilio.notifications)}</div>
      <div class="field-row"><span class="field-label">2 · Language menu (stellaruc.com)</span>
        <p class="where">Netlify → project stellar-intelligent-technologies → Logs → Functions → language-menu / language-choice / language-init. Saved choice: Supabase table voice_language_choices.</p>
        ${d.language_menu.error ? `<div class="err-box">${esc(d.language_menu.error)}</div>` : raw('voice_language_choices rows', d.language_menu.data)}</div>
      <div class="field-row"><span class="field-label">3 · ElevenLabs</span>
        <p class="where">ElevenLabs → Agents → Ava — Desert Ridge PMA → Call history → conversation <span class="mono">${esc(el.conversation_id)}</span>. Transcript tab shows each tool call and result; Overview shows the end reason and cost.</p>
        ${raw('Conversation summary', { status: el.status, termination_reason: el.termination_reason, error: el.error, duration_secs: el.duration_secs, language: el.language, llm: el.llm, cost_usd: el.cost_usd, version_id: el.version_id, analysis: el.analysis, phone_call: el.phone_call, dynamic_variables: el.dynamic_variables })}
        ${raw('Full transcript with tool calls and timings', el.turns)}</div>
      <div class="field-row"><span class="field-label">4 · Netlify (PMA tool function)</span>
        <p class="where">Netlify → PMA project → Logs → Functions → cedar-elevenlabs. Search the log for the CallSid or for event names like cedar_elevenlabs_tool_failed and cedar_elevenlabs_auth_failed. The rows below are the function's own trace of each request.</p>
        ${d.function_trace.error ? `<div class="err-box">${esc(d.function_trace.error)}</div>` : (d.function_trace.data || []).length ? raw('ops_call_trace rows', d.function_trace.data) : '<p class="muted small">No function trace rows. Calls before the lab went live have none.</p>'}</div>
      <div class="field-row"><span class="field-label">5 · Supabase</span>
        <p class="where">Supabase → Stellar project → Table Editor → pma_voice_sessions (filter call_sid), pma_maintenance_requests (by request_id), pma_call_log (by conversation_id). Database errors: Logs → Postgres and API.</p>
        ${raw('pma_voice_sessions', d.supabase.pma_voice_sessions)}${raw('pma_maintenance_requests', d.supabase.pma_maintenance_requests)}${raw('pma_call_log', d.supabase.pma_call_log)}</div>
      <div class="field-row"><span class="field-label">6 · Text delivery (Twilio Messaging)</span>
        <p class="where">Twilio Console → Monitor → Logs → Messaging → search the Message SID (starts with SM). The status there changes over time: accepted → queued → sent → delivered, or undelivered / failed with an error code.</p>
        ${d.sms?.error ? `<div class="err-box">${esc(d.sms.error)}</div>` : raw('Twilio Message resources for this call', d.sms?.data || [])}</div>`;
  }

  async function openCall(id) {
    S.open = id; S.view = 'calls'; setTab(); renderList();
    const main = $('main');
    main.innerHTML = '<p class="muted">Pulling this call from Twilio, ElevenLabs, Netlify and Supabase…</p>';
    let d;
    try { d = await api('/api/ops/trace/calls/' + encodeURIComponent(id)); }
    catch (e) { main.innerHTML = `<div class="err-box">${esc(e.message)}</div>`; return; }
    const el = d.elevenlabs; const tw = d.twilio;
    main.innerHTML = `
      <h2 style="font:500 28px 'Cormorant Garamond',serif;margin:0;color:var(--ivory)">${esc(el.analysis.title || 'Call')}</h2>
      <div class="kv-grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));margin-top:12px">
        <div class="kv"><span>Started</span><span>${esc(fmtTime(el.started_at))}</span></div>
        <div class="kv"><span>Caller → line</span><span>${esc(el.phone_call?.external_number || '?')} → ${esc(el.phone_call?.agent_number || '?')}</span></div>
        <div class="kv"><span>Length: Twilio / ElevenLabs</span><span>${esc(tw.error ? '?' : tw.call.duration)} s / ${esc(el.duration_secs)} s</span></div>
        <div class="kv"><span>Ended because</span><span>${esc(el.termination_reason || el.status)}</span></div>
        <div class="kv"><span>CallSid</span><span class="mono">${esc(el.phone_call?.call_sid || '—')}</span></div>
        <div class="kv"><span>Conversation</span><span class="mono">${esc(el.conversation_id)}</span></div>
      </div>
      <div class="path">${hops(d).map(([n, t, lvl, s]) => `<div class="hop ${lvl}"><div class="n">${esc(n)}</div><div class="t">${esc(t)}</div><div class="s">${esc(s)}</div></div>`).join('')}</div>
      <div class="section-sep">Timeline, every source merged (time from when Ava answered)</div>
      ${timeline(d)}
      ${sourceDetail(d)}
      <div class="drawer-actions"><button class="btn-sm" id="dl-call">Download this trace (JSON)</button></div>`;
    $('dl-call').addEventListener('click', () => OpsAdmin.download(`call-trace-${id}.json`, OpsAdmin.report('call_trace', { trace: d })));
  }

  // ---------- drills ----------
  async function renderDrills() {
    const main = $('main');
    main.innerHTML = '<p class="muted">Loading drills…</p>';
    let r;
    try { r = await api('/api/ops/trace/drills'); }
    catch (e) { main.innerHTML = `<h2>Fault drills</h2><div class="err-box">${esc(e.message)}</div>`; return; }
    const saved = (() => { try { return localStorage.getItem('lab_caller') || ''; } catch { return ''; } })();
    main.innerHTML = `
      <h2 style="font:500 28px 'Cormorant Garamond',serif;margin:0 0 6px;color:var(--ivory)">Fault drills</h2>
      <p class="desc">Arm a fault, call the PMA line at (725) 201-0584 from your own phone, report a maintenance problem, then find the cause on the Calls tab. A drill only affects calls from the number you enter, only on the tool you pick, and switches itself off when time runs out. Every other caller gets the normal system.</p>
      <div class="drill-form">
        <label><span class="field-label">Fault</span><select class="field-input" id="d-fault"><option value="mystery">Mystery (hidden until you reveal it)</option>${r.catalog.map((c) => `<option value="${esc(c.key)}">${esc(c.label)}</option>`).join('')}</select></label>
        <label><span class="field-label">On tool</span><select class="field-input" id="d-scope">${r.tool_scopes.map((s) => `<option${s === 'create_incident' ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
        <label><span class="field-label">Your phone number</span><input class="field-input" id="d-caller" inputmode="tel" placeholder="702 555 0100" value="${esc(saved)}"></label>
        <label><span class="field-label">Minutes</span><select class="field-input" id="d-min"><option>15</option><option selected>30</option><option>60</option></select></label>
        <button class="btn-primary" id="d-arm">Arm drill</button>
      </div>
      <p class="inline-msg" id="d-msg" role="status"></p>
      <div class="section-sep">Drills, newest first</div>
      ${r.drills.length ? r.drills.map(drillCard).join('') : '<p class="muted">No drills yet.</p>'}`;
    $('d-arm').addEventListener('click', arm);
    main.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
      try { await api(`/api/ops/trace/drills/${b.dataset.id}/${b.dataset.act}`, { method: 'POST' }); renderDrills(); }
      catch (e) { alertBox(e.message); }
    }));
  }

  function drillCard(d) {
    const a = d.answer;
    return `<div class="drill">
      <h3>${d.fault_key ? esc(a?.label || d.fault_key) : 'Mystery fault (hidden)'} <span class="tag">${esc(d.state)}</span></h3>
      <div class="muted small">On ${esc(d.tool_scope)} · calls from ${esc(d.caller_number)} · armed ${esc(new Date(d.armed_at).toLocaleString())} · ${d.state === 'armed' ? 'ends ' + esc(new Date(d.expires_at).toLocaleTimeString()) : ''} · fired ${esc(d.hits)} time(s)</div>
      ${a ? `<div class="answer"><div><b>Layer:</b> ${esc(a.layer)}</div><div><b>What the caller hears:</b> ${esc(a.symptom)}</div><div><b>Evidence:</b> ${esc(a.evidence)}</div><div><b>Cause:</b> ${esc(a.cause)}</div><div><b>Remedy:</b> ${esc(a.remedy)}</div></div>` : ''}
      <div class="drawer-actions" style="margin-top:10px">
        ${!d.fault_key ? `<button class="btn-sm" data-act="reveal" data-id="${esc(d.id)}">Reveal the answer</button>` : ''}
        ${d.state === 'armed' ? `<button class="btn-sm" data-act="disarm" data-id="${esc(d.id)}">Disarm now</button>` : ''}
      </div></div>`;
  }

  function alertBox(msg) { const m = $('d-msg'); if (m) { m.innerHTML = `<span style="color:var(--fail)">${esc(msg)}</span>`; } }

  async function arm() {
    const caller = $('d-caller').value.trim();
    try { localStorage.setItem('lab_caller', caller); } catch { /* private mode */ }
    $('d-arm').disabled = true;
    try {
      await api('/api/ops/trace/drills', { method: 'POST', body: { fault_key: $('d-fault').value, tool_scope: $('d-scope').value, caller_number: caller, minutes: $('d-min').value } });
      await renderDrills();
      $('d-msg').textContent = 'Armed. Call (725) 201-0584 from that phone and report a maintenance problem.';
    } catch (e) { alertBox(e.message); $('d-arm').disabled = false; }
  }

  function setTab() {
    $('tab-calls').classList.toggle('on', S.view === 'calls');
    $('tab-lessons').classList.toggle('on', S.view === 'lessons');
    $('tab-drills').classList.toggle('on', S.view === 'drills');
  }
  const showLessons = (id) => { S.view = 'lessons'; setTab(); window.Lessons.render($('main'), { api, openCall, lessonId: id }); };

  function ready() {
    const rib = $('ribbon-site'); if (rib) rib.textContent = 'PROPERTY MANAGEMENT ASSISTANT · CALL TRACE LAB';
    $('tab-calls').onclick = () => { S.view = 'calls'; setTab(); if (S.open) openCall(S.open); };
    $('tab-drills').onclick = () => { S.view = 'drills'; setTab(); renderDrills(); };
    $('tab-lessons').onclick = () => showLessons();
    $('refresh').onclick = () => { loadStatus(); loadCalls(false); if (S.view === 'drills') renderDrills(); else if (S.view === 'lessons') showLessons(); else if (S.open) openCall(S.open); };
    let practice = false; try { practice = localStorage.getItem('lab_practice') === '1'; } catch { /* ignore */ }
    $('practice').checked = practice; document.body.classList.toggle('practice', practice);
    $('practice').onchange = (e) => { document.body.classList.toggle('practice', e.target.checked); try { localStorage.setItem('lab_practice', e.target.checked ? '1' : '0'); } catch { /* ignore */ } };
    loadStatus(); loadCalls(false);
    const qs = new URLSearchParams(location.search);
    if (qs.get('call')) openCall(qs.get('call'));
    else if (qs.has('lesson')) showLessons(qs.get('lesson') || undefined);
  }

  boot({ onReady: ready });
})();
