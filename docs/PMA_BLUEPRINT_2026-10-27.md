# PMA Voice Agent System — Blueprint
**Stellar Intelligent Technologies · Property Management Assistant**
*Snapshot: 2026-10-27 · Status: Production*

---

## 1. What This Is

PMA is a 24/7 AI voice agent for property management companies. Tenants call a dedicated Twilio number, speak with **Ava** (ElevenLabs Conversational AI), and can:

- File a maintenance/incident report
- Get a status update on an existing case
- Record a contact preference (SMS or email confirmation)

The system is self-contained on **Stellar UC** infrastructure and observable from the **BDMS Command Center**.

---

## 2. Infrastructure Map

| Layer | Component | Value |
|---|---|---|
| Phone number | Twilio (PMA) | (725) 201-0584 |
| Voice agent | ElevenLabs | `agent_4901m5gzk15hfajrapnvb520f9jt` — "Ava — Desert Ridge PMA" |
| Voice | ElevenLabs | Tiffany |
| Backend functions | Netlify | `property-management-assistant` → `pma.stellaruc.com` |
| Database | Supabase | `vqrqyanqsiqzsmlhytaz` (STELLAR-UCAAS-PRODUCTION) |
| Monitoring | BDMS Command Center | `bdms.aproposgroupllc.com/command-center.html` → PMA Voice Monitor tab |
| Post-call webhook | ElevenLabs workspace | "PMA Post-Call Log" → `https://pma.stellaruc.com/api/postcall` |

---

## 3. Netlify Functions

| Function | Route | Purpose |
|---|---|---|
| `cedar-elevenlabs.js` | `/api/tools/cedar-elevenlabs` | Ava's tool handler (create_incident, get_case_status, record_contact_preference, close_session) |
| `cedar-twilio.js` | `/api/intake/cedar-twilio` | Twilio webhook — session init on inbound call |
| `cedar-postcall.js` | `/api/postcall` | ElevenLabs post-call webhook — logs call metrics |
| `cedar-call-log.js` | `/api/call-log` | Public read API — BDMS Monitor fetches from here |
| `carol-sip-openai.js` | `/api/intake/carol-sip-openai` | SIP/OpenAI bridge (staged, `PMA_SIP_ENABLED=false`) |

---

## 4. Supabase Schema (Key Tables)

| Table | Purpose |
|---|---|
| `pma_voice_sessions` | One row per call — tenant, property, call_sid |
| `pma_cases` | Maintenance incident records |
| `pma_contact_preferences` | SMS/email opt-ins |
| `pma_sms_log` | Outbound SMS delivery records |
| `pma_email_log` | Outbound email delivery records |
| `pma_call_log` | Post-call metrics (duration, credits, Twilio cost) |

All RPCs are `SECURITY DEFINER`, granted to `service_role` only, revoked from `public/anon/authenticated`.

---

## 5. Ava Tool Set

| Tool | ElevenLabs Name | What It Does |
|---|---|---|
| File incident | `create_incident` | Creates a `pma_cases` record with address, unit, description |
| Case lookup | `get_case_status` | Looks up by caller ID or case number; handles MULTIPLE_CASES |
| Contact preference | `record_contact_preference` | Saves SMS/email opt-in; triggers confirmation send |
| End call | `close_session` | Closes the voice session cleanly |

**Dynamic variables auto-injected by ElevenLabs:**
- `system__caller_id` → caller's E.164 phone number
- `system__call_sid` → Twilio call SID
- `system__conversation_id` → ElevenLabs conversation ID

---

## 6. Call Flow

```
Tenant dials (725) 201-0584
  └─ Twilio → ElevenLabs native phone number integration
       └─ Ava greets tenant
            ├─ New issue? → create_incident → case number confirmed
            ├─ Check status? → get_case_status (by caller ID or case number)
            │    ├─ success → reads back case + status
            │    ├─ MULTIPLE_CASES → asks for case number → retries
            │    ├─ NOT_FOUND → offers to file new incident
            │    └─ NO_IDENTIFIER → asks for case number directly
            └─ Contact preference? → record_contact_preference → SMS/email sent
```

---

## 7. Post-Call Metrics Pipeline

```
Call ends
  └─ ElevenLabs fires post-call webhook (HMAC-signed)
       └─ cedar-postcall.js verifies signature
            └─ Logs to pma_call_log:
                 - conversation_id, agent_id
                 - call_duration_secs
                 - credits_used (ElevenLabs)
                 - twilio_cost_usd (estimated: $0.0085/min)
                 - termination_reason, call_successful
  └─ cedar-call-log.js (BDMS polls every 60s)
       └─ pma_call_log_summary_v1 RPC
            └─ Returns: total_calls, avg_duration, EL credits, Twilio cost, recent 25 calls
```

---

## 8. Env Vars (Netlify — `property-management-assistant`)

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | DB write access |
| `ELEVENLABS_WEBHOOK_SECRET` | Tool webhook HMAC (cedar-elevenlabs) |
| `ELEVENLABS_POSTCALL_SECRET` | Post-call webhook HMAC (cedar-postcall) |
| `PMA_ELEVENLABS_TOOL_KEY` | Shared key for tool auth |
| `PMA_SMS_ENABLED` | `true` to enable outbound SMS confirmations |
| `PMA_SIP_ENABLED` | `false` — SIP bridge not yet live |
| `TWILIO_ACCOUNT_SID` | Twilio account |
| `TWILIO_AUTH_TOKEN` | Twilio auth |
| `TWILIO_FROM_NUMBER` | +17252010584 |
| `PMA_SMS_MAINTENANCE_NUMBER` | Staff SMS recipient |
| `PMA_SMS_MANAGER_NUMBER` | Manager SMS recipient |
| `RESEND_API_KEY` | Email (Resend) |
| `RESEND_FROM_EMAIL` | From address |
| `OPENAI_WEBHOOK_SECRET` | SIP/OpenAI bridge (staged) |

---

## 9. Tenant and Property Scoping

Every RPC is scoped to `(tenant_id, property_id)`. The `cedar-twilio.js` / `cedar-elevenlabs.js` functions resolve these from the incoming call's Twilio number via `pma_voice_session_start_v1`. Multi-tenant operation is supported — additional properties are onboarded by assigning their Twilio number to a new `(tenant_id, property_id)` pair.

---

## 10. What Was Built — 2026-10-27

- **Bug fix:** `system__caller_id` was not being extracted from ElevenLabs payloads → `get_case_status` always received `null` caller number → returned `NO_IDENTIFIER` → Ava improvised "authorization issue" language. Fixed in `cedar-elevenlabs.js` (`normalizePayload` + `IDENTITY_FIELDS`).
- **Ava prompt update:** All `get_case_status` return states now have explicit scripted responses. "Never improvise error language" rule added.
- **Call log system:** `pma_call_log` table + `pma_call_log_insert_v1` / `pma_call_log_summary_v1` RPCs applied to Supabase.
- **cedar-postcall.js:** ElevenLabs post-call webhook handler — verifies HMAC, logs metrics.
- **cedar-call-log.js:** Public read API — no auth, CORS open, consumed by BDMS.
- **ElevenLabs workspace webhook:** "PMA Post-Call Log" registered at `https://pma.stellaruc.com/api/postcall`, HMAC auth, Transcript events.
- **BDMS PMA Voice Monitor tab:** Added to Command Center side panel — total calls, avg duration, EL credits, Twilio cost, 25-row call table, 60s auto-refresh.

---

## 11. Roadmap — Next Session (2026-10-28)

### Manager Dashboard
A web UI (likely at `pma.stellaruc.com/manager`) for property managers to:
- View all open cases by property
- Update case status
- See contact preference records
- Review call log / voice activity

### Tenant Portal
A web UI (likely at `pma.stellaruc.com/portal`) for tenants to:
- Look up their own case by phone number or case number
- See case status and timeline
- Submit a new case without calling

---

## 12. Known Gaps / Future Work

| Item | Notes |
|---|---|
| Outbound SMS | Twilio number (725) 201-0584 is SMS-approved; `PMA_SMS_ENABLED` controls it |
| SIP cutover | `PMA_SIP_ENABLED=false`; OpenAI webhook + Twilio trunk must both be updated in a controlled change before enabling |
| Multi-property onboarding | Architecture supports it; no UI for self-serve tenant/property provisioning yet |
| Email confirmation | `PMA_EMAIL_ENABLED` controls it; Resend configured |
| Manager notifications | Staff SMS on incident filed is wired; manager dashboard is next |
