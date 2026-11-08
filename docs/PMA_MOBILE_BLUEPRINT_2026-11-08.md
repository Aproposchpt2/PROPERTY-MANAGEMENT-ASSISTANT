# PMA Mobile App — Blueprint
**Stellar Intelligent Software Developers · Property Management Assistant**
*Snapshot: 2026-11-08 · Status: Phase 1 built, not yet device-tested or released*

Source handoff: [`handoff/PROPERTY_MANAGEMENT_ASSISTANT_COMPLETE_RUFLO_HANDOFF.docx`](handoff/PROPERTY_MANAGEMENT_ASSISTANT_COMPLETE_RUFLO_HANDOFF.docx)
Code: [`/mobile`](../mobile) · Run instructions: [`mobile/README.md`](../mobile/README.md)

---

## 1. Scope

The current PMA system is the **Customer Care Center tenant maintenance request**: a resident
calls the property line, Ava takes the request, the resident gets a case number and a status
link, and staff are alerted (immediately by text for emergencies).

**Phase 1 of the phone app does the same thing in the app.** A resident files a maintenance
request in the app and gets the same result as calling: same case record, case number,
emergency escalation, staff alerts, text or email confirmation and status link. The resident
can then follow the request in the app.

Manager screens were also built from the handoff. They are **phase 2**: in the code, hidden
from the app until `EXPO_PUBLIC_ENABLE_MANAGER=true`.

---

## 2. Phase 1: Request Maintenance

### What the resident does

1. **Problem:** describe it, then name, property address, unit, and language for updates (English or Español).
   The 911 notice is at the top of the form.
2. **Contact:** mobile phone, updates by text or email, and consent to updates.
3. **Confirm:** enter the 6-digit code texted to that phone, then submit.
4. **Done:** case number, an urgent notice if the request was flagged as an emergency, and
   **Follow my request**, which opens the case status in the app.

The app remembers the resident's details and recent cases on the device (SecureStore), so a
second request is quicker. "Call the property line" stays available on every screen.

### Same path as a call

| Step | On a call (Ava) | In the app |
|---|---|---|
| Who is it | Caller ID | Phone confirmed by texted code |
| Session | `pma_voice_session_start_v1` (call SID) | Same RPC, session id `app-<nonce>` |
| Case | `pma_voice_incident_create_v1` (emergency detection, case number) | Same RPC, same four fields + language |
| Emergency | `escalateEmergency` → maintenance and manager lines | Same function |
| Preference | `pma_voice_incident_preference_v1` | Same RPC; text goes to the confirmed phone |
| Confirmation + status link | `confirmBySms` / `confirmByEmail` | Same functions |
| Staff alert | Maintenance and manager lines / addresses | Same |

The shared steps live in `netlify/functions/lib/pma-intake-flow.js`, used by both
`cedar-elevenlabs.js` (calls) and `pma-app-api.js` (app). Changing one changes both.

### Server endpoints

| Route | Body | Result |
|---|---|---|
| `POST /api/app/verify` | `{ phone }` | Texts a code; returns a signed `challenge` |
| `POST /api/app/request` | `{ challenge, code, reportedName, reportedAddress, reportedUnit, description, language, contactMethod, email?, consent }` | `{ caseNumber, urgent, statusToken, notificationSent, notificationState }` |
| `GET /api/portal/case?t=TOKEN` | — | Resident case view (existing) |

### Protections

- **Phone check:** 6-digit code, 10-minute expiry, at most 5 tries per code. Nothing is stored:
  the challenge is signed with `PMA_APP_VERIFY_SECRET`, and the code inside it is keyed by that
  secret, so it cannot be guessed offline from the challenge.
- **One case per code:** the code's nonce becomes the session id, so resubmitting files nothing new.
- **US and Canada numbers only**, and never PMA's own lines: keeps texts on domestic routes and
  blocks texting-fraud to premium international numbers.
- **Rate limits:** 5 codes per device address and 3 per phone number per 10 minutes; 20 submissions
  per address per 10 minutes. These are per server instance (best effort, not global).
- **Same limits as the database:** name 2–150, address 5–300, unit 1–80, description 3–4000 characters.
- **Turned off cleanly:** with `PMA_SMS_ENABLED` not `true` or no secret set, the app tells the
  resident to call the property line instead.
- The app bundle holds only public values (`mobile/.env.example`). The service-role key stays in Netlify.

---

## 3. App Architecture

| Layer | Implementation |
|---|---|
| Client | Expo SDK 58, React Native 0.88, Expo Router (`mobile/src/app`), TypeScript (strict) |
| Data | PMA Netlify APIs at `pma.stellaruc.com`; no direct table access from the app |
| Database | Supabase `vqrqyanqsiqzsmlhytaz`; existing `pma_*` tables and RPCs, unchanged |
| Deep link | `pma://status?t=TOKEN` opens a resident's case |
| Platforms | iOS, Android; Expo web kept for development only |

| File | Screen | Phase |
|---|---|---|
| `src/app/index.tsx` | Welcome: Request maintenance, Check on a request, 911 notice | 1 |
| `src/app/request.tsx` | Request maintenance (3 steps + confirmation) | 1 |
| `src/app/resident.tsx` | My requests: recent cases, paste a status link, call the line | 1 |
| `src/app/status.tsx` | Case status: progress, team update, visit, activity; refreshes every 60 s | 1 |
| `src/app/manager/*` | Manager sign-in, dashboard, case workspace | 2 (hidden) |

Shared logic with unit tests: `src/lib/cases.ts`, `src/lib/request.ts` (`mobile/test/`).

---

## 4. Reconciliation With the Handoff

| Handoff item | Decision | Reason |
|---|---|---|
| `001_pma.sql` (`profiles`, `properties`, `units`, `incidents`) | **Not applied** | Would create a second incident system apart from the Customer Care Center; "tenant" already means a subscriber organization (`public.tenants`) |
| Handoff RLS policies | Not used | Manager saves and tenant reports would have failed; tenants could insert closed or assigned cases |
| Tenant email/password accounts | Phone code per request | Matches how the Customer Care Center identifies residents (by phone), with no accounts to manage |
| Free-text priority | Removed | Urgency comes from the same emergency detection as calls |
| Manager dashboard in phase 1 | Moved to phase 2 | Phase 1 matches the current system's capability |
| `"latest"` dependency tags | Expo SDK 58 versions | From Expo's bundled compatibility map |

---

## 5. Verification Done (2026-11-08)

- Root suite **162/162** pass, including 15 new tests for `/api/app/*` (code, forgery, expiry,
  lockout, international and own-line numbers, filing path, emergency escalation, email,
  texts-off fallback) and all existing voice tests after moving the shared steps.
- Mobile: typecheck clean; **10/10** unit tests pass; Android bundle builds and holds no secret.
- The request flow was run end to end on Expo web at phone size against a mocked server:
  form checks, code step, the exact body sent to the server, the urgent confirmation and the
  status hand-off. The manager button is hidden and `/manager` returns to the welcome screen.
- **Not yet done:** real device, real texts, a real case in Supabase.

---

## 6. Next Steps

### Phase 1 — Launch the resident maintenance request

1. **Set the secret in Netlify:** `PMA_APP_VERIFY_SECRET` = a random value of at least 32 characters
   (for example `openssl rand -base64 48`). Without it the app sends residents to the phone line.
   Deploy, then file one test request from a phone and confirm it in the web Management Dashboard.
2. **Mark app requests as app requests.** The create RPC records `source_channel = 'voice'` and
   `callerAssertedIdentity`. Add a small migration so app requests read `app` and `phone_verified`;
   until then they look like calls in the dashboard.
3. **Device test** in Expo Go on iPhone and Android: text and email confirmations, Spanish,
   an emergency wording (e.g. "gas smell") reaching the maintenance and manager lines, a wrong code,
   an expired code, and the status link opening in the app.
4. **Branding:** replace the Expo placeholder icon, adaptive icon and splash in `mobile/assets`.
5. **Store release:** `eas init` and `eas.json` (preview, production); `EXPO_PUBLIC_*` values as EAS
   environment variables; Apple Developer and Google Play accounts; privacy labels (name, phone,
   email, address collected to provide the service); update `privacy.html` and `terms.html` to cover
   the app; TestFlight and Play internal testing; submit.
6. **Global rate limit (before wide release):** move the per-number and per-code limits into
   Supabase so they hold across server instances.

### Phase 2 — Manager app and updates to residents

7. Turn on the manager screens (`EXPO_PUBLIC_ENABLE_MANAGER=true`); confirm the Supabase sign-in email
   includes the 6-digit code (`{{ .Token }}`).
8. **Text or email residents when a manager posts an update.** Today a saved update only appears on the
   status page (web dashboard and app alike). Reuse `pma-intake-flow.js` senders and the case's preference.
9. Vendor assignment and cost approvals in the app (APIs exist); manager push notifications.

### Phase 3 — Richer requests

10. Photos (private Supabase Storage bucket, signed upload URLs from the API).
11. Resident push notifications for status changes.
12. Multiple properties: the API is scoped to one `PMA_PROPERTY_ID`; add property selection aligned with
    `PMA_MULTI_SUBSCRIBER_BILLING.md`.
13. Offline retry, screen-reader and large-text QA, Spanish screens.

---

## 7. Configuration

| Where | Name | Value |
|---|---|---|
| Netlify | `PMA_APP_VERIFY_SECRET` | **New.** Random, ≥ 32 characters. Signs phone-check codes |
| Netlify | `PMA_SMS_ENABLED`, `PMA_EMAIL_ENABLED` | Existing; same meaning as for calls |
| Netlify | `PMA_SMS_FROM_NUMBER`, `PMA_SMS_MESSAGING_SERVICE_SID`, Twilio keys | Existing; codes are sent from PMA's line |
| App | `EXPO_PUBLIC_PMA_API_BASE` | `https://pma.stellaruc.com` |
| App | `EXPO_PUBLIC_PMA_PHONE` | Property line shown to residents |
| App | `EXPO_PUBLIC_ENABLE_MANAGER` | `false` for phase 1 |

---

## 8. Known Gaps

| Item | Notes |
|---|---|
| App requests labelled as voice | Step 2 above |
| Rate limits per instance | Step 6 above |
| Single property | Inherited from the voice path (`PMA_TENANT_ID`, `PMA_PROPERTY_ID`) |
| Expo web against production | APIs send no CORS headers; web is for layout checks only |
| `npx expo install` online check | Blocked in the cloud build environment; run `npx expo install --check` on a developer machine |
