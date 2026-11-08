# PMA Mobile App — Blueprint
**Stellar Intelligent Software Developers · Property Management Assistant**
*Snapshot: 2026-11-08 · Status: Phase 1 and phase 2 built, not yet device-tested or released*

Source handoff: [`handoff/PROPERTY_MANAGEMENT_ASSISTANT_COMPLETE_RUFLO_HANDOFF.docx`](handoff/PROPERTY_MANAGEMENT_ASSISTANT_COMPLETE_RUFLO_HANDOFF.docx)
Code: [`/mobile`](../mobile) · Run instructions: [`mobile/README.md`](../mobile/README.md) · Change record: [`PMA_CHANGE_RECORD_2026-11-08.md`](PMA_CHANGE_RECORD_2026-11-08.md) · **Launch steps: [`PMA_MOBILE_LAUNCH_GUIDE.md`](PMA_MOBILE_LAUNCH_GUIDE.md)**

---

## 1. Scope

The current PMA system is the **Customer Care Center tenant maintenance request**: a resident
calls the property line, Ava takes the request, the resident gets a case number and a status
link, and staff are alerted (immediately by text for emergencies).

**Phase 1 of the phone app does the same thing in the app.** A resident files a maintenance
request in the app and gets the same result as calling: same case record, case number,
emergency escalation, staff alerts, text or email confirmation and status link. The resident
can then follow the request in the app.

**Phase 2 is the manager app** (section 2A): managers work cases from their phone, assign
providers, answer cost approvals and send updates to residents.

### Delivery and pricing (decided 2026-11-08)

- **No public App Store or Google Play listing.** The app is part of the delivery package and the
  differentiator.
- **Managers: in-house mobile app** (iPhone and Android) from private install links (Expo EAS internal
  distribution, `mobile/eas.json` profile `internal`), with native alerts. Apple requires each iPhone to
  be registered first (up to 100 per year per Apple account).
- **Residents: web app** at `pma.stellaruc.com/app`, added to the home screen; nothing to register.
  Managers can also use it on any device, with web push alerts.
- One codebase (Expo) for both; the in-house app also contains the resident screens.
- **Price:** $999/mo platform fee (app included) + $0.50/min usage
  (`PMA_MULTI_SUBSCRIBER_BILLING.md`).
- Launch steps: [`PMA_MOBILE_LAUNCH_GUIDE.md`](PMA_MOBILE_LAUNCH_GUIDE.md) (Part 3 for the in-house app).

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

## 2A. Phase 2: Manager App

### What a manager does

| Screen | Capability |
|---|---|
| Sign in | Emailed 6-digit code (same accounts as the web dashboard). Non-managers see an access message only |
| Dashboard | Active / New / Urgent / Resolved tiles; "N cost approvals waiting" banner; queue filters All, Urgent, Approval, New, Assigned, Scheduled, In Progress, Resolved; emergencies marked red, approvals marked blue |
| Case | Details and masked resident contact; **cost approval** card (Approve / Decline, with confirmation); **service provider** card; status; update for the resident with **"Also send this update to the resident"**; staff-only notes; activity timeline |
| Assign provider | Choose an active provider for the property; optional visit day (next 7 days) and 2-hour window (8am–6pm); optional work order number. A New case moves to Assigned or Scheduled; an earlier provider is replaced |

Adding or editing providers and pre-approval limits stays on the web dashboard.

### Server changes (benefit the web dashboard too)

| Change | Where | Detail |
|---|---|---|
| **Send update to resident** | `PATCH /api/manager/cases/:id` with `notify_resident: true`; `lib/pma-resident-notify.js` | Sends the saved update by the resident's chosen method (text or email, English or Spanish) and records `resident_update_sent` in the timeline. Returns `notification: { sent, state, method }`; states `SENT`, `OPTED_OUT`, `DISABLED`, `NO_PREFERENCE`, `FAILED`. Never fails the save itself |
| Web dashboard checkbox | `manager.html` | "Also send this update to the resident"; the save message reports the outcome |
| **Cost approval fields** | `GET /api/manager/cases` and `/cases/:id` | Adds `nteAmount` and `approvalState`. The live case RPCs don't return them, so the web dashboard's approval badges never showed; they now do |
| Senders | `lib/pma-sms.js`, `lib/pma-email.js` | New `sendResidentUpdate` (text honours STOP opt-outs; email HTML-escapes the update) |

### Push notifications to managers

| Alert | When | Sent from | Android channel |
|---|---|---|---|
| Emergency | A case is flagged urgent (call or app) | `cedar-elevenlabs.js`, `pma-app-api.js` via `pushNewCase` | `emergency` (max importance) |
| New case | Any other new case (call or app) | same | `cases` |
| Cost approval | A provider's quote is over the pre-approved limit | `pma-vendor.js` (`request_nte`) via `pushApprovalNeeded` | `cases` |

- **Who gets them:** active OWNER and ADMIN users of the tenant, and MANAGER users with access to the
  property (the same rule as manager sign-in), filtered by each phone's preferences.
- **Phones:** after the server confirms manager access, the app asks for permission and registers its Expo
  push token (`POST /api/manager/push-token`). Signing out removes it (`DELETE`). The **Alerts** screen
  (bell on the dashboard) has a switch per alert type and **Send a test notification** (`POST /api/manager/push-test`,
  own phones only). Tapping an alert opens that case, including when the tap launches the app.
- **Storage:** `pma_push_tokens` (migration `20261108100000_pma_push_tokens.sql`): RLS on, service role only;
  one row per token; a token that moves to another manager's sign-in moves with it.
- **Delivery:** Expo push service (`exp.host`), 100 per request, 5-second timeout; tokens Expo reports as
  `DeviceNotRegistered` are switched off. Best effort: a push failure never delays or fails filing a case,
  and staff texts continue unchanged. On a normal call the push runs during Ava's existing pause, so callers
  wait no longer.
- **Switch:** nothing is sent unless `PMA_PUSH_ENABLED=true`. Lock-screen text mirrors the existing staff
  texts: case number and unit for new cases; address and a short description for emergencies.

**Web push (the delivered web app).** Every alert above also goes to managers' browsers, under the same
recipient rules and per-device switches:

- **Browser side:** `public/sw.js` (service worker, scope `/app/`) shows the alert and, on tap, opens
  `/app/manager/<case id>`. Emergencies stay on screen until dismissed. The **Alerts** screen shows
  **Turn on alerts** (browsers only ask for permission after a tap), then the same switches and test.
  On iPhone it first explains Add to Home Screen when opened in Safari.
- **Server side:** `GET /api/manager/web-push` (public key), `POST` (register subscription and
  preferences), `DELETE` (sign-out); sending with the `web-push` library and VAPID keys
  (`PMA_WEB_PUSH_PUBLIC_KEY`, `PMA_WEB_PUSH_PRIVATE_KEY`, `PMA_WEB_PUSH_SUBJECT`). A 404/410 from the
  push service switches that subscription off. Without the keys, browsers are skipped and phones/texts
  carry on.
- **Storage:** `pma_web_push_subscriptions` (migration `20261108120000`): RLS on, service role only.

Approve/Decline uses the existing `POST /cases/:id/approve` (`pma_mgr_approve_case_v1`, live in
Supabase but not in this repo's migrations; see Known Gaps). Assignment uses the existing
`POST /cases/:id/assign`. Database additions for alerts: the phone token and web push tables.

---

## 3. App Architecture

| Layer | Implementation |
|---|---|
| Client | Expo SDK 58, React Native 0.88, Expo Router (`mobile/src/app`), TypeScript (strict) |
| Data | PMA Netlify APIs at `pma.stellaruc.com`; no direct table access from the app |
| Database | Supabase `vqrqyanqsiqzsmlhytaz`; existing `pma_*` tables and RPCs, unchanged |
| Deep link | `pma://status?t=TOKEN` opens a resident's case (native builds) |
| Delivery | **Web app** at `pma.stellaruc.com/app` (Expo web export, `experiments.baseUrl: "/app"`), built by Netlify on each deploy (`scripts/build-web-app.sh` → `./app`, git-ignored). Installable: `public/manifest.webmanifest`, PMA icons, `public/index.html`. Same-origin API calls |
| Storage | Phones: SecureStore. Web: the browser's localStorage (`src/lib/storage.ts`) |
| Dialogs | `src/lib/dialog.ts`: browser dialogs on the web (React Native's Alert does nothing there), native alerts on phones |
| In-house app | iOS/Android from the same code; `mobile/eas.json` profile `internal` (private install links, APK on Android, manager screens on, public values in `env`); `production` profile kept for a possible store listing |

| File | Screen | Phase |
|---|---|---|
| `src/app/index.tsx` | Welcome: Request maintenance, Check on a request, 911 notice | 1 |
| `src/app/request.tsx` | Request maintenance (3 steps + confirmation) | 1 |
| `src/app/resident.tsx` | My requests: recent cases, paste a status link, call the line | 1 |
| `src/app/status.tsx` | Case status: progress, team update, visit, activity; refreshes every 60 s | 1 |
| `src/app/manager/login.tsx`, `index.tsx` | Manager sign-in, dashboard | 2 |
| `src/app/manager/[id].tsx` | Case: approval, provider, status, resident update, notes, timeline | 2 |
| `src/app/manager/assign.tsx` | Assign provider and visit window | 2 |
| `src/app/manager/alerts.tsx` | Alerts: Turn on (web), switches, test notification | 2 |

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
- **Phase 2:** root suite **170/170** (8 new tests for resident notification, approval fields and the
  PATCH flag); mobile **15/15**. Manager screens run on Expo web against a mocked API: approval banner
  and filter, approval card, assign screen sending provider + 2-hour window + work order, return to the
  case without losing a half-typed update, and save sending `notify_resident: true`.
- **Push:** root suite **181/181** (9 tests for recipients by role, property access and preference;
  channel and data; dead-token switch-off; Expo outage; replay skip; registration, shared phones, removal
  and test push; 2 route tests); mobile **16/16**. Android bundle builds with notifications; the web build
  loads (notifications are skipped in a browser) and the resident flow is unchanged.
- **Web app delivery:** root suite **187/187** (6 web push tests: phones and browsers under the same rules,
  keys-missing skip, 410 switch-off, missing table never blocks phones, subscription validation, test push);
  mobile **16/16**. `scripts/build-web-app.sh` builds `./app` in ~15 s locally. End-to-end in Chromium against
  the repo served like Netlify (`/app` fallback) with a mocked API: `/app` → `/app/`, manifest linked,
  resident request → status, details and recent case remembered in the browser, manager dashboard, Approve
  through a real confirmation dialog, Alerts → Turn on → service worker at `/app/` → 65-byte server key →
  subscription posted → switches shown. (Headless Chrome reports notification permission as denied and
  has no push service, so permission and subscription were stood in for in that one test.)
- **Not yet done:** real devices, real texts, real push delivery, a real case in Supabase.

---

## 6. Next Steps

### Launch (phases 1 and 2 together, as a web app)

1. Follow [`PMA_MOBILE_LAUNCH_GUIDE.md`](PMA_MOBILE_LAUNCH_GUIDE.md) Parts 0–5: database fix and web push
   table, Netlify settings (`PMA_APP_VERIFY_SECRET`, VAPID keys, `PMA_PUSH_ENABLED`), merge, test residents
   and managers on real devices, turn on alerts, hand-off to each customer.
2. **Mark app requests as app requests.** The create RPC records `source_channel = 'voice'` and
   `callerAssertedIdentity`. Add a small migration so app requests read `app` and `phone_verified`;
   until then they look like calls in the dashboard.
3. **Global rate limit (before wide release):** move the per-number and per-code limits into
   Supabase so they hold across server instances.
4. **Privacy and terms:** update `privacy.html` and `terms.html` to cover the app.
5. **Customer hand-off kit:** QR code and one-page how-to per property (launch guide, Part 5).
6. **Bring the repo in line with the live database:** add a migration capturing
   `pma_mgr_approve_case_v1` as deployed, and remove or rename the unused 4-argument case functions
   in `20261029110000_pma_approval_rpcs.sql`, which differ from what is live.

### Phase 3 — Richer requests

7. Photos (private Supabase Storage bucket, signed upload URLs from the API).
8. Resident push notifications for status changes (web push, as for managers).
9. Multiple properties: the API is scoped to one `PMA_PROPERTY_ID`; add property selection aligned with
   `PMA_MULTI_SUBSCRIBER_BILLING.md`. Needed before one deployment serves several customers.
10. Offline retry, screen-reader and large-text QA, Spanish screens.

---

## 7. Configuration

| Where | Name | Value |
|---|---|---|
| Netlify | `PMA_APP_VERIFY_SECRET` | **New.** Random, ≥ 32 characters. Signs phone-check codes |
| Netlify | `PMA_SMS_ENABLED`, `PMA_EMAIL_ENABLED` | Existing; same meaning as for calls |
| Netlify | `PMA_SMS_FROM_NUMBER`, `PMA_SMS_MESSAGING_SERVICE_SID`, Twilio keys | Existing; codes are sent from PMA's line |
| Netlify | `PMA_PUSH_ENABLED` | **New.** `true` to send manager alerts |
| Netlify | `PMA_WEB_PUSH_PUBLIC_KEY`, `PMA_WEB_PUSH_PRIVATE_KEY` | **New.** VAPID keys (`npx web-push generate-vapid-keys`); private key is a secret |
| Netlify | `PMA_WEB_PUSH_SUBJECT` | **New.** `mailto:` contact address for push services |
| Netlify | `EXPO_ACCESS_TOKEN` | Optional; native builds only, with enhanced push security |
| `netlify.toml` | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_PMA_PHONE`, `EXPO_PUBLIC_ENABLE_MANAGER="true"` | Public values compiled into the web app (committed; never secrets) |
| `mobile/eas.json` (`internal`) | `EXPO_PUBLIC_*` incl. `EXPO_PUBLIC_PMA_API_BASE=https://pma.stellaruc.com` | Public values for the in-house app (the web app uses same-origin URLs) |
| Expo / Apple / Firebase | EAS project id (`eas init`), Apple Developer account, FCM service-account key (`eas credentials`), `mobile/google-services.json` | In-house app builds and Android alerts |

---

## 8. Known Gaps

| Item | Notes |
|---|---|
| App requests labelled as voice | Step 2 above |
| Rate limits per instance | Step 3 above |
| Single property | Inherited from the voice path (`PMA_TENANT_ID`, `PMA_PROPERTY_ID`); step 9 before serving several customers from one deployment |
| Repo vs live approval functions | `pma_mgr_approve_case_v1` exists only in the live database; the repo's 4-argument case functions are not what is live (step 6) |
| Web push on iPhone | Only for PMA opened from the Home Screen, iOS 16.4+; the Alerts screen explains this. Staff texts are unchanged |
| In-house iPhone limit | Ad hoc installs: registered iPhones only, up to 100 per year per Apple account; a new iPhone needs a rebuild. Beyond that: TestFlight (90-day builds) or unlisted App Store (launch guide appendix) |
| In-house app not built yet | Needs the Expo account, Apple Developer account and Firebase setup (launch guide 3.2); no in-house build has been made |
| Web push delivery | Browsers' push services may delay or drop alerts when a device is asleep or offline; staff texts remain the guaranteed channel for emergencies |
| Netlify build step | Deploys now build the web app; if that build fails, the deploy fails and the previous one stays live |
| iOS critical alerts | Emergencies use normal alerts; bypassing silent mode needs an Apple entitlement (native app only) |
| `npx expo install` online check | Blocked in the cloud build environment; run `npx expo install --check` on a developer machine |
