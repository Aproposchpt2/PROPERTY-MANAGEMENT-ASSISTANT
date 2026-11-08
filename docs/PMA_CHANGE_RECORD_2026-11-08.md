# PMA Change Record — 2026-11-08
**Stellar Intelligent Software Developers · Property Management Assistant**
*Branch: `claude/new-session-ykm5xi` · Base: `f98fca1` (main after PR #28) · Not yet merged*

This document records every change made on 2026-11-08: code, configuration and the live
Supabase database. The design, screens and next steps are in
[`PMA_MOBILE_BLUEPRINT_2026-11-08.md`](PMA_MOBILE_BLUEPRINT_2026-11-08.md). The step-by-step launch
checklist is [`PMA_MOBILE_LAUNCH_GUIDE.md`](PMA_MOBILE_LAUNCH_GUIDE.md).

---

## 1. Summary

| Area | Change | Status |
|---|---|---|
| Mobile app | New Expo SDK 58 app in `mobile/` (iOS/Android), built from the Ruflo handoff but wired to the live PMA system | In repo |
| Phase 1 (residents) | Request maintenance in the app, same path and result as calling the Customer Care Center; track cases by status link | In repo; needs `PMA_APP_VERIFY_SECRET` |
| Phase 2 (managers) | Dashboard, case workspace, provider assignment, cost approvals, updates sent to residents | In repo; app flag `EXPO_PUBLIC_ENABLE_MANAGER=true` |
| Push | Manager push notifications for emergencies, new cases, cost approvals | In repo; table **applied live**; needs EAS setup and `PMA_PUSH_ENABLED=true` |
| Website | `manager.html`: "Also send this update to the resident"; approval badges now show | In repo |
| Security | Stray public close-session function; public support-intake function | Fix in repo; **not yet applied live** |
| **Delivery** | **No App Store: web app at `pma.stellaruc.com/app`, built by Netlify on deploy; manager alerts by web push** (section 9) | In repo; web push table **not yet applied**; needs VAPID keys |
| **Pricing** | $999/mo platform fee (app included) + $0.50/min | `PMA_MULTI_SUBSCRIBER_BILLING.md` |
| Docs | Blueprint, launch guide, this record, original handoff | In repo |

Nothing reaches production until the branch is merged and Netlify deploys, except the
database change marked **applied live** in section 4.

---

## 2. Commits

| Commit | Description |
|---|---|
| `e725ce7` | Add PMA mobile app wired to the live case system |
| `214c5e5` | Add mobile app blueprint, next steps and the source handoff |
| `be932bb` | Phase 1 app: residents file maintenance requests like a call |
| `fb68c51` | Phase 2 manager app: approvals, provider assignment, resident updates |
| `da5d412` | Manager push notifications: emergencies, new cases, cost approvals |
| `cc871b6` | Blueprint: push token table applied to the live database |
| `7d61e3b` | Fix two public Supabase functions (migration not yet applied) |
| `0e7fe14` | Add this change record |
| `828148d` | Add single mobile launch guide |
| `d474fc3` | Deliver the PMA app as a web app at /app with web push; pricing $999/mo (section 9) |

---

## 3. Server and website changes (Netlify)

### New endpoints

| Route | Function | Purpose |
|---|---|---|
| `POST /api/app/verify` | `pma-app-api.js` | Text a 6-digit code to a resident's US/Canada mobile |
| `POST /api/app/request` | `pma-app-api.js` | File a maintenance request from the app (code required) |
| `POST /api/manager/push-token` | `pma-manager-api.js` | Register a manager's phone / save alert preferences |
| `DELETE /api/manager/push-token` | `pma-manager-api.js` | Remove a phone on sign-out |
| `POST /api/manager/push-test` | `pma-manager-api.js` | Test notification to the caller's own phones |

### Changed endpoints

| Route | Change |
|---|---|
| `GET /api/manager/cases`, `/cases/:id` | Now include `nteAmount` and `approvalState` (the live RPCs don't return them; web approval badges were never showing) |
| `PATCH /api/manager/cases/:id` | Accepts `notify_resident: true` to text or email the saved update to the resident; returns `notification` outcome |
| `POST /api/tools/pma-vendor` (`request_nte`) | Also pushes "cost approval needed" to managers; `managerNotified` counts a push |
| ElevenLabs tool `create_incident` | Also pushes new/emergency case alerts (runs during the existing pause) |

### Files

| File | Change |
|---|---|
| `netlify/functions/pma-app-api.js` | **New.** App verification and request filing |
| `netlify/functions/lib/pma-app-verify.js` | **New.** Stateless signed phone codes (`PMA_APP_VERIFY_SECRET`) |
| `netlify/functions/lib/pma-intake-flow.js` | **New.** Steps shared by calls and the app: status link, emergency escalation, text/email confirmation, staff alerts (moved out of `cedar-elevenlabs.js`, behaviour unchanged) |
| `netlify/functions/lib/pma-resident-notify.js` | **New.** Send a manager's update to the resident; add approval fields |
| `netlify/functions/lib/pma-push.js` | **New.** Expo push to managers; device registration |
| `netlify/functions/cedar-elevenlabs.js` | Uses the shared intake flow; new-case push |
| `netlify/functions/pma-manager-api.js` | Approval fields, `notify_resident`, push routes |
| `netlify/functions/pma-vendor.js` | Cost-approval push |
| `netlify/functions/lib/pma-sms.js` | New `sendVerificationCode`, `sendResidentUpdate` |
| `netlify/functions/lib/pma-email.js` | New `sendResidentUpdate` (HTML-escaped) |
| `netlify/functions/lib/pma-sip-store.js` | Close through the protected 5-argument function (SIP path is switched off) |
| `netlify.toml` | `/api/app/*` route; `pma-app-api` timeout 26 s; `/mobile/*` returns 404 on the website |
| `manager.html` | "Also send this update to the resident" checkbox and outcome message |

---

## 4. Database changes (Supabase `vqrqyanqsiqzsmlhytaz`)

| Migration | What | Live status |
|---|---|---|
| `20261108100000_pma_push_tokens.sql` | New table `pma_push_tokens` (manager phone tokens). RLS on, no anon/authenticated access, service role only | **Applied 2026-11-08** and verified (RLS on, empty, anon/authenticated have no access) |
| `20261108110000_security_fix_public_functions.sql` | (1) Drop stray 6-argument `pma_voice_session_close_v1`; (2) revoke PUBLIC/anon execute on `stellar_create_support_intake` | **Not applied.** Two attempts timed out waiting for Supabase's confirmation; verified unchanged. Run in the SQL editor (section 7) |

Each migration has a `_rollback.sql` next to it. The security rollback restores both
functions exactly as captured from the live database.

### Security findings behind `20261108110000`

1. **`pma_voice_session_close_v1(uuid,uuid,uuid,text,text,jsonb)`** — created outside this repo.
   - Executable by anyone (no grants revoked, no service-role check).
   - Cannot succeed: references `pma_voice_sessions.session_id`, which does not exist.
   - Its name clashes with the real 5-argument function, so PostgREST returns **HTTP 300
     (PGRST203)** for every close-session call. API logs show this on each call; 32 sessions in
     the last 30 days stayed open, none closed since 2026-10-27.
   - Dropping it restores Ava's close-session (and the app's) through the protected version.
2. **`stellar_create_support_intake(...)`** — from the CUSTOMER-ENGAGEMENT-OPERATIONS-CENTER repo.
   - Meant for `authenticated` and `service_role`, but the default PUBLIC grant was never revoked,
     so signed-out callers with the publishable key could create contacts in any tenant and test
     whether an email or phone is already a contact.
   - Callers checked: `pages/api/twilio/phone-support-intake.ts` (service role) and
     `pages/api/experimental-support-intake.ts` (signed-in user). Both keep working.
   - **Remaining:** any signed-in user can pass any tenant id. Fixing that needs a tenant membership
     check inside the function, in that repo.

Other read-only checks made today: function signatures and grants, `tenant_users` and
`pma_voice_sessions` columns, the live `pma_mgr_approve_case_v1` definition, session counts,
API logs. No data was changed except the new empty table.

### Repo vs live differences found (not changed)

- `pma_mgr_approve_case_v1` exists live but not in any repo migration.
- `20261029110000_pma_approval_rpcs.sql` defines 4-argument case functions that are not what is live
  (live has the original 3-argument versions).

---

## 5. Mobile app (`mobile/`)

New Expo SDK 58 / React Native 0.88 / Expo Router / TypeScript app. Dependency versions come from
Expo's bundled compatibility map. Only public values are compiled in (`mobile/.env.example`).

| Screen | File | Phase |
|---|---|---|
| Welcome | `src/app/index.tsx` | 1 |
| Request maintenance | `src/app/request.tsx` | 1 |
| My requests | `src/app/resident.tsx` | 1 |
| Case status | `src/app/status.tsx` | 1 |
| Manager sign-in, dashboard | `src/app/manager/login.tsx`, `index.tsx` | 2 |
| Case workspace | `src/app/manager/[id].tsx` | 2 |
| Assign provider | `src/app/manager/assign.tsx` | 2 |
| Alerts | `src/app/manager/alerts.tsx` | 2 |

Shared code in `src/lib/` and `src/components/`; unit tests in `mobile/test/`.

---

## 6. Configuration

| Where | Name | Value | Needed for |
|---|---|---|---|
| Netlify | `PMA_APP_VERIFY_SECRET` | **New.** ≥ 32 random characters (`openssl rand -base64 48`) | Phase 1 app requests |
| Netlify | `PMA_PUSH_ENABLED` | **New.** `true` | Manager push |
| Netlify | `EXPO_ACCESS_TOKEN` | **New, optional.** Only with enhanced push security | Manager push |
| App build | `EXPO_PUBLIC_ENABLE_MANAGER` | `false` for the resident release, `true` with managers | Phase 2 |
| App build | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_PMA_API_BASE`, `EXPO_PUBLIC_PMA_PHONE` | As in `mobile/.env.example` | All |

Existing variables (`PMA_SMS_ENABLED`, `PMA_EMAIL_ENABLED`, Twilio, Resend, `PMA_TENANT_ID`,
`PMA_PROPERTY_ID`) keep their meaning.

---

## 7. Open actions

1. **Apply the security fix** in the Supabase SQL editor:
   ```sql
   begin;
   drop function if exists public.pma_voice_session_close_v1(uuid, uuid, uuid, text, text, jsonb);
   revoke execute on function public.stellar_create_support_intake(uuid, text, text, text, text, text, text, text, text, text, text) from public, anon;
   grant execute on function public.stellar_create_support_intake(uuid, text, text, text, text, text, text, text, text, text, text) to authenticated, service_role;
   commit;
   ```
   Then re-run the Supabase security advisor and confirm the next call's session closes.
2. Apply `supabase/migrations/20261108120000_pma_web_push_subscriptions.sql` (web push table).
3. Netlify: `PMA_APP_VERIFY_SECRET`, `PMA_WEB_PUSH_PUBLIC_KEY`, `PMA_WEB_PUSH_PRIVATE_KEY`,
   `PMA_WEB_PUSH_SUBJECT`, `PMA_PUSH_ENABLED=true`; merge and deploy (the deploy now builds `/app`).
4. Supabase "Magic Link" email template must include `{{ .Token }}` (manager sign-in code).
5. Device testing on iPhone (from the Home Screen), Android and a computer with real accounts, texts,
   emails and alerts. Full checklist: [`PMA_MOBILE_LAUNCH_GUIDE.md`](PMA_MOBILE_LAUNCH_GUIDE.md).
6. Follow-ups: tag app requests as `app` instead of `voice` (needs a migration); move rate limits
   into Supabase; tenant check inside `stellar_create_support_intake` (other repo); bring repo
   migrations in line with the live approval functions.

---

## 8. Verification

| Check | Result |
|---|---|
| Root test suite (`npm test`) | 181/181 pass (147 before today; new suites for app API, push, resident notify, manager API additions) |
| Mobile typecheck (`npm run typecheck`) | Clean |
| Mobile tests (`npm test`) | 16/16 pass |
| Android bundle (`expo export`) | Builds; no secret in the bundle |
| Expo web walkthroughs (mocked API) | Resident request flow; manager dashboard, approval card, assign, save with `notify_resident`; Alerts screen |
| Live database | Push table verified; security fix verified **not** applied; web push table not applied |
| Web app (section 9) | Root suite 187/187; build script ~15 s; end-to-end in Chromium under `/app` (resident flow, browser storage, manager approval dialog, web push sign-up) |
| Not done | Real devices, real texts/emails/alerts, real cases in Supabase |

---

## 9. Web app delivery and pricing (later on 2026-11-08)

**Decision:** no App Store for phase 1. The PMA app is part of the delivery package (the
differentiator) as a web app at `pma.stellaruc.com/app`, installed from the browser to the home
screen. Pricing: **$999/mo platform fee (app included) + $0.50/min usage** (previously $170/mo in
the Oct 2026 table, then $499/mo).

| File | Change |
|---|---|
| `netlify.toml` | Build command `bash scripts/build-web-app.sh`; public `EXPO_PUBLIC_*` values; secrets-scan exemptions for public values; `/app` → `/app/` and `/app/*` → app page; `noindex` and no-cache headers for the app and its service worker |
| `scripts/build-web-app.sh` | **New.** Builds `mobile/` for the web into `./app` (git-ignored) |
| `.gitignore` | Ignore `/app/` build output |
| `mobile/app.json` | `experiments.baseUrl: "/app"`, `web.output: "single"`, web name/description/theme |
| `mobile/public/index.html`, `manifest.webmanifest` | **New.** Installable app (manifest, iPhone home-screen tags) |
| `mobile/public/sw.js` | **New.** Service worker: shows manager alerts; tap opens the case |
| `mobile/public/*.png`, `mobile/assets/icon.png`, `favicon.png` | **New** PMA icon (gold star from the Stellar banner, "PMA") |
| `mobile/src/lib/config.ts` | Web app calls the API on the same site |
| `mobile/src/lib/storage.ts` | **New.** SecureStore on phones, localStorage in the browser |
| `mobile/src/lib/recent.ts`, `profile.ts` | Now also remember cases and details in the browser |
| `mobile/src/lib/dialog.ts` | **New.** Messages/confirmations that work in browsers (React Native's Alert did nothing on the web, so Approve/Decline and save messages failed silently there) |
| `mobile/src/lib/webpush.ts` | **New.** Browser alert sign-up, iPhone Home Screen guidance, sign-out |
| `mobile/src/app/manager/alerts.tsx`, `index.tsx`, `[id].tsx`, `assign.tsx`, `login.tsx`, `resident.tsx` | Web alerts flow; browser-safe dialogs; corrected Approve/Decline wording (Decline marks the quote declined; it does not notify the provider) |
| `netlify/functions/lib/pma-push.js` | Alerts to browsers (web push, VAPID) alongside phones; browser registration/removal; test push includes browsers |
| `netlify/functions/pma-manager-api.js` | `GET/POST/DELETE /api/manager/web-push` |
| `package.json` | `web-push` dependency |
| `supabase/migrations/20261108120000_pma_web_push_subscriptions.sql` (+ rollback) | **New** table, RLS on, service role only. **Not applied** |
| `test/pma-push.test.js` | 6 web push tests |
| `docs/PMA_MULTI_SUBSCRIBER_BILLING.md` | Pricing updated |
| `docs/PMA_MOBILE_LAUNCH_GUIDE.md`, `PMA_MOBILE_BLUEPRINT_2026-11-08.md`, `mobile/README.md` | Rewritten for web app delivery |

New Netlify settings: `PMA_WEB_PUSH_PUBLIC_KEY`, `PMA_WEB_PUSH_PRIVATE_KEY` (secret),
`PMA_WEB_PUSH_SUBJECT`. The native phone-app code and its push support remain and still build.
