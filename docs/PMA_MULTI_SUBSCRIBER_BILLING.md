# PMA Multi-Subscriber Call Tracking & Billing Strategy

**Date:** 2026-10-28  
**Status:** Architecture reference — implementation deferred until second paying customer

---

## Strategy Decision

**ElevenLabs recommendation: Strategy 1 — Single Shared Agent with Dynamic Variables & Post-Call Webhooks.**

> "Centralized Maintenance: Whenever you improve your agent's system prompt, update instructions, or add new tools, you only have to update and test one agent instead of syncing changes across dozens of duplicate agents."
>
> "Automated & Scalable: Onboarding a new subscriber requires zero agent provisioning — your application just passes the new subscriber_id at call start, and your server handles the billing math automatically."

**When to use Strategy 2 (Dedicated Agents):** Only if a subscriber demands a completely different custom voice, their own private knowledge base, or custom business rules that cannot be handled via dynamic variables.

PMA is built on Strategy 1. This is the correct long-term architecture.

---

## Overview

PMA uses ElevenLabs Strategy 1: **Shared Agent + Post-Call Webhooks**. One Ava agent handles all tenants; each tenant is identified by their Twilio inbound number and routed to their data at the tool layer. This doc covers how to extend that into per-subscriber usage billing as the customer base grows.

---

## Current Architecture (Single Tenant)

| Component | Implementation |
|---|---|
| ElevenLabs agent | Shared (agent_4901m5gzk15hfajrapnvb520f9jt — Ava) |
| Subscriber ID | Not yet in ElevenLabs dynamic vars — resolved by caller phone → DB lookup |
| Call log | `pma_call_log` table in Supabase |
| Post-call webhook | `https://pma.stellaruc.com/api/postcall` (cedar-postcall.js) |
| Billing unit | `call_duration_secs` ÷ 60 × $0.50/min |

---

## Step 1: Add `subscriber_id` Dynamic Variable

When onboarding a second tenant, define `subscriber_id` in the Ava agent config:

**In ElevenLabs Agent Dashboard:**
- Agent configuration tab → Variables / Dynamic Variables
- Add variable: `subscriber_id`, fallback default: `"unknown"`

**At call initiation (Twilio inbound):** ElevenLabs injects dynamic variables via the phone number assignment. Set the variable at the ElevenLabs phone number level or via the API when the session starts.

**Via API / outbound:**
```json
{
  "dynamic_variables": {
    "subscriber_id": "tenant_5885a020"
  }
}
```

The `subscriber_id` value then appears in the post-call webhook payload under `dynamic_variables`.

---

## Step 2: Post-Call Webhook — Field Reference

ElevenLabs sends a signed POST to `https://pma.stellaruc.com/api/postcall` after each call.

**Key fields extracted by `cedar-postcall.js`:**

| Field | Path in payload | Stored in `pma_call_log` |
|---|---|---|
| Call ID | `data.conversation_id` | `conversation_id` |
| Agent | `data.agent_id` | `agent_id` |
| Duration | `data.metadata.call_duration_secs` | `call_duration_secs` |
| Start time | `data.metadata.start_time_unix_secs` | `started_at` |
| Call result | `data.analysis.call_successful` | `call_successful` |
| End reason | `data.analysis.termination_reason` | `termination_reason` |
| Credits used | `data.cost.credits` | `credits_used` |
| Subscriber | `data.dynamic_variables.subscriber_id` | ⚠️ not yet stored — add column |

**Authentication:** HMAC-SHA256, header `ElevenLabs-Signature: t={ts},v0={hex}`. Secret stored as `ELEVENLABS_POSTCALL_SECRET` in Netlify env.

---

## Step 3: Schema Change for Multi-Tenant Billing

When ready for a second subscriber, add `tenant_id` to `pma_call_log`:

```sql
ALTER TABLE pma_call_log ADD COLUMN tenant_id uuid REFERENCES pma_tenants(id);
```

Update `cedar-postcall.js` to extract `subscriber_id` from the webhook payload and resolve it to a `tenant_id` via DB lookup before calling `store.logCall()`.

---

## Step 4: Monthly Billing Aggregation Query

```sql
SELECT
  tenant_id,
  COUNT(*)                              AS total_calls,
  ROUND(SUM(call_duration_secs) / 60.0, 2) AS total_minutes,
  ROUND(SUM(call_duration_secs) / 60.0 * 0.50, 2) AS usage_charge_usd
FROM pma_call_log
WHERE
  started_at >= '2026-11-01'
  AND started_at < '2026-12-01'
  AND call_successful = 'success'
GROUP BY tenant_id
ORDER BY total_minutes DESC;
```

Add `platform_fee_usd` ($170 flat) to `usage_charge_usd` to get total monthly invoice per tenant.

---

## Pricing Model (Locked Oct 2026)

| Component | Rate |
|---|---|
| Platform fee | $170/mo |
| Usage | $0.50/min |
| Our cost (ElevenLabs + LLM) | ~$0.09–$0.10/min |
| Gross margin on usage | ~80% |
| Target net profit per customer | ~$200/mo (at 100 call-min/mo) |

Note: ElevenLabs reference guide suggests $0.25–$0.35/min as a conservative per-minute markup. PMA charges $0.50/min — justified by the full workflow (vendor coordination, approval flows, tenant portal), not just the voice layer.

---

## Implementation Checklist (deferred)

- [ ] Add `subscriber_id` dynamic variable to Ava agent config in ElevenLabs
- [ ] Add `tenant_id` column to `pma_call_log`
- [ ] Update `cedar-postcall.js` to extract and store tenant from webhook payload
- [ ] Add Supabase RPC `pma_call_log_by_tenant_v1` for billing report
- [ ] Wire billing aggregation into manager.html monthly summary panel
