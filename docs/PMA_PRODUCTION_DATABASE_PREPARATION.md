# PMA Production Database Preparation

**Environment:** Production Supabase  
**Project:** `STELLAR-UCAAS-PRODUCTION`  
**Project ref:** `vqrqyanqsiqzsmlhytaz`  
**PMA site:** https://pma.stellaruc.com/  
**PMA application repository:** https://github.com/Aproposchpt2/PROPERTY-MANAGEMENT-ASSISTANT  
**Prepared:** 2026-10-26

## Purpose and scope

This document records the initial production database foundation for PMA. All PMA-owned database objects use the `pma_` prefix. The changes are additive: they create empty tables and supporting identity indexes. They do not seed tenants, properties, resident or vendor contacts, knowledge articles, intents, or notification recipients.

The production PMA application is **not yet wired** to these tables. This is schema preparation only.

## Tables created

### Public domain and operating data

- `public.pma_properties` — tenant-owned properties, timezone, operating status, and emergency instructions.
- `public.pma_units` — unit labels, bedroom counts, inventory status, and recorded availability dates.
- `public.pma_occupancies` — contact-to-unit occupancy records and optional authenticated resident binding.
- `public.pma_vendors` — tenant-owned maintenance vendors and trade.
- `public.pma_property_vendors` — property-specific vendor assignments.
- `public.pma_maintenance_requests` — idempotent maintenance requests, status, category, priority, and structured risk assessment.
- `public.pma_vendor_assignments` — assignment state, including vendor acceptance or decline.
- `public.pma_maintenance_activity` — request activity/audit entries.
- `public.pma_showings` — tour requests and their non-booking status.
- `public.pma_attachments` — request attachment metadata; no storage bucket or file access policy was created.
- `public.pma_emergency_incidents` — incident state, intent, severity, risk facts, correlation, and deduplication key.
- `public.pma_notification_preferences` — per-property recipient/channel preferences; `active` defaults to false and no recipients are configured.
- `public.pma_notification_attempts` — distinct submission, carrier-delivery, and acknowledgment states per attempted notification.
- `public.pma_notification_events` — provider status callback evidence.
- `public.pma_dispatch_outbox` — idempotent dispatch work state; no worker or dispatcher is attached.
- `public.pma_knowledge_entries` — versioned property knowledge with approval and effective-date fields.
- `public.pma_intent_catalog` — versioned product intent definitions; entries default inactive.

### Private trusted voice state

- `private.pma_voice_sessions` — binds a call/session to a tenant, property, call SID, and server-side actor.
- `private.pma_voice_operations` — idempotent operation ledger with revision, facts, and outcome for recovery.

Composite foreign keys scope PMA properties, units, contacts, interactions, incidents, and notification attempts to their tenant. Supporting unique tenant-identity indexes were added to existing `ai4cc_contacts`, `ai4cc_interactions`, and `ai4cc_leads`.

## Access control

- Row-level security is enabled on every `pma_` table.
- Table privileges are revoked from `PUBLIC`, `anon`, and `authenticated`.
- Only the server-side `service_role` has table privileges.
- No browser/client access policy or public RPC was added.
- The service-role key must remain server-side. Future orchestration functions must validate trusted call/session binding and tenant/property scope before reading or writing these tables.

## Verification recorded

After creation, a read-only check confirmed:

- 19 `pma_` tables exist across `public` and `private`.
- RLS is enabled on every table.
- `anon` and `authenticated` have no table-level SELECT access.
- `service_role` has table-level SELECT access.
- Sampled domain, incident, recipient-preference, notification, outbox, KB, and intent tables each contain zero rows.

Supabase records the applied migration names in its project migration history. The production schema currently has no PMA rows.

## Not implemented by this preparation

- PMA application/database wiring or production Netlify deployment.
- Production-safe RLS policies for direct dashboard access.
- RPCs, triggers, functions, or background dispatch workers.
- PMA KB or intent-catalog imports and activation.
- Property/vendor/owner/resident provisioning or recipient activation.
- Twilio sender selection, callback URL configuration, or live notification delivery.
- Orchestration acceptance testing.

Do not report an operation, incident, dispatch, message delivery, booking, or vendor acknowledgment as complete until the corresponding production runtime and authoritative database/provider evidence confirm it.

## Migration source tracking

The initial DDL was applied through the Supabase migration interface and is recorded in the production project's migration history. The matching canonical SQL migration files still need to be reconciled into this repository before the next schema change or a fresh-environment rebuild. Do not blindly replay the staging migrations: they contain staging-specific gates, fixture assumptions, and names that differ from this production `pma_` convention.
