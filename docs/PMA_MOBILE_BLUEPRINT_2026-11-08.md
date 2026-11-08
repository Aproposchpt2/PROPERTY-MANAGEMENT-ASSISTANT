# PMA Mobile App — Blueprint
**Stellar Intelligent Software Developers · Property Management Assistant**
*Snapshot: 2026-11-08 · Status: Built, not yet device-tested or released*

Source handoff: [`handoff/PROPERTY_MANAGEMENT_ASSISTANT_COMPLETE_RUFLO_HANDOFF.docx`](handoff/PROPERTY_MANAGEMENT_ASSISTANT_COMPLETE_RUFLO_HANDOFF.docx)
Code: [`/mobile`](../mobile) · Run instructions: [`mobile/README.md`](../mobile/README.md)

---

## 1. What This Is

An iOS and Android app for the Property Management Assistant. Its promise is the same as the
website's: **from incident report to resolution, everyone stays informed.**

- **Managers** (owners, managers, administrators) monitor and work cases from their phone.
- **Residents** report an issue by calling the property line and follow their case in the app.

The app is a new front end on the **existing** PMA system. It has no database of its own:
a case filed by Ava on a call appears in the app immediately, and a change made in the app
is the same change the web Management Dashboard makes.

---

## 2. Architecture

| Layer | Implementation |
|---|---|
| Client | Expo SDK 58, React Native 0.88, Expo Router (`mobile/src/app`), TypeScript (strict) |
| Sign-in | Supabase Auth, emailed one-time code (same as `manager.html`), session in device keychain via `expo-secure-store` |
| Data | PMA Netlify APIs at `pma.stellaruc.com` (no direct table access from the app) |
| Database | Supabase `vqrqyanqsiqzsmlhytaz`, existing `pma_*` tables and RPCs, unchanged |
| Deep link | `pma://status?t=TOKEN` opens a resident's case |
| Platforms | iOS, Android; Expo web kept for development only |

### API map

| App screen | Endpoint | Server function | Authorization |
|---|---|---|---|
| Manager dashboard | `GET /api/manager/cases` | `pma-manager-api.js` → `pma_mgr_case_list_v1` | Supabase JWT + `tenant_users` role OWNER/ADMIN/MANAGER + property access (`lib/pma-auth.js`) |
| Manager case | `GET /api/manager/cases/:id` | `pma_mgr_case_get_v1` | same |
| Manager save | `PATCH /api/manager/cases/:id` (`status`, `tenant_update`, `internal_notes`) | `pma_mgr_case_update_v1` (writes `pma_maintenance_activity`) | same |
| Resident case | `GET /api/portal/case?t=TOKEN` | `pma-portal-api.js` → `pma_portal_case_view_v1` | Status-link token (SHA-256 hashed in `pma_portal_tokens`) |
| Resident report | `tel:` property line | Ava voice intake → `pma_maintenance_requests` | Caller on the phone line |

### Security model

- Role and property checks happen **on the server on every request**. The app's route guard
  (`Stack.Protected`) only keeps signed-out users on the sign-in screen.
- The bundle holds only public values: Supabase URL, publishable key, site URL, phone number
  (`mobile/.env.example`). The service-role key stays in Netlify. A built Android bundle was
  checked and contains no secret.
- Status-link tokens are credentials; the app keeps recent ones in SecureStore, never in plain storage.
- `/mobile/*` returns 404 on the website (`netlify.toml`), because Netlify publishes the repo root.

---

## 3. Screens

| File | Screen | What it does |
|---|---|---|
| `src/app/index.tsx` | Welcome | Choose resident or manager; 911 notice |
| `src/app/resident.tsx` | Resident | Call the property line; paste a status link; last 5 cases on this device |
| `src/app/status.tsx` | Case status | Lifecycle tracker, team update, service visit, activity; refreshes every 60 s and on app resume |
| `src/app/manager/login.tsx` | Manager sign-in | Email → 6-digit code; `shouldCreateUser: false` |
| `src/app/manager/index.tsx` | Dashboard | Active / New / Urgent / Resolved tiles; queue filters All, Urgent, New, Assigned, Scheduled, In Progress, Resolved; urgent cases marked in red |
| `src/app/manager/[id].tsx` | Case workspace | Details, masked contact preference, provider and schedule, status, update for the resident (≤1000 chars), staff-only notes (≤4000), timeline |

Case lifecycle (live values): **New → Assigned → Scheduled → In Progress → Completed → Closed.**
Shared logic lives in `src/lib/cases.ts` and is unit-tested (`mobile/test/cases.test.mjs`).

---

## 4. Reconciliation With the Handoff

The handoff was written without knowledge of the live system. These decisions were made on
2026-11-08 (owner chose "wire to live schema"):

| Handoff item | Decision | Reason |
|---|---|---|
| `001_pma.sql` (`profiles`, `properties`, `units`, `incidents`, `incident_updates`) | **Not applied** | Would create a second incident system that voice intake never writes to; "tenant" already means a subscriber organization (`public.tenants`) |
| Handoff RLS policies | Not used | No update policy on `incidents` and no insert policy on `incident_updates` (manager saves would fail silently); no profile row ever created (tenant reports would fail); tenants could insert cases already `closed` or assigned |
| Manage tab visible to all users | Replaced | Server-side role check on every call, plus a no-access screen |
| Free-text priority input | Removed | Priority is set by intake/emergency detection, not typed |
| Statuses `reported…closed` | Mapped to live statuses | Same values as the web dashboard |
| Password sign-in | Emailed code | Matches existing manager accounts (no passwords set) |
| `"latest"` dependency tags | Expo SDK 58 versions | From Expo's bundled compatibility map |
| In-app reporting, photos, push | Deferred | Residents have no app accounts in the live system yet (see §6) |

---

## 5. Verification Done (2026-11-08)

- `npm run typecheck` clean; `npm test` 6/6 pass (mobile); root suite 147/147 pass.
- `expo export --platform android` builds; bundle contains no secret.
- Every screen rendered at 390×844 on Expo web; manager screens checked with a seeded session and
  mocked API data; signed-out `/manager` redirects to sign-in; no console errors.
- **Not yet done:** real device, real manager account, real non-manager account, real status link.

---

## 6. Next Steps

### Phase 1 — Prove it on devices (no new backend)

1. **Sign-in email template.** Confirm the Supabase "Magic Link" template includes `{{ .Token }}`;
   the app needs the 6-digit code, not only the link.
2. **Device test with real accounts** in Expo Go: an OWNER/MANAGER account (sees cases, can save),
   a signed-in account with no `tenant_users` row (sees the no-access screen), and a real status
   link from a test call (opens the case, and `pma://status?t=…` opens it too).
3. **Branding assets.** Replace the Expo placeholder icon, adaptive icon and splash in `mobile/assets`.
4. **EAS preview builds.** `eas init`, add `eas.json` (development, preview, production profiles),
   set the `EXPO_PUBLIC_*` values as EAS environment variables, build internal-distribution
   iOS and Android previews for the team.

### Phase 2 — Close the "everyone stays informed" loop

5. **Notify residents when a manager posts an update.** Today, saving `tenant_update` (web or app)
   only changes the status page; no text or email is sent. Add a notification step to
   `PATCH /api/manager/cases/:id` that reuses the existing SMS/email senders and the case's recorded
   contact preference, with an audit row in `pma_maintenance_activity`. Benefits web and app equally.
6. **Vendor assignment and cost approvals in the app.** The APIs exist
   (`POST /cases/:id/assign`, `GET /vendors`, `POST /cases/:id/approve`); add the screens.
7. **Manager push notifications.** New `pma_push_tokens` table (per `tenant_users` row and device,
   RLS on, service-role only), a `POST /api/manager/push-token` route, and Expo push sends alongside
   the existing staff SMS when a case is filed or marked emergency. Add per-user preferences.

### Phase 3 — Resident accounts (decision needed first)

8. **Choose resident identity.** Recommended: sign in by phone-number code, then **claim** cases by
   opening their status link (proves the resident received it). Store claims in a new
   `pma_resident_case_access` table keyed by auth user, tenant, property and request. Avoid matching
   by phone number alone (shared or recycled numbers).
9. **In-app reporting.** New RPC mirroring voice intake (same emergency detection, case number and
   confirmation), exposed through a rate-limited, authenticated endpoint. The 911 wording stays above the form.
10. **Photos.** Private Supabase Storage bucket, upload through signed URLs issued by the API,
    visible to the resident who filed and to managers with property access.
11. **Resident push** for status changes and team updates, honouring the contact preference.

### Phase 4 — Scale and release

12. **Multiple properties.** `pma-manager-api.js` serves one `PMA_PROPERTY_ID`. Add a property
    selector driven by `allowedPropertyIds`, aligned with `PMA_MULTI_SUBSCRIBER_BILLING.md`.
13. **Resilience.** Offline banner, retry with backoff for saves, keep the last case list on screen.
14. **Quality.** Component tests for the screens, screen-reader pass (VoiceOver/TalkBack), large-text
    and small-device layouts, Spanish copy to match the status page's `es` support.
15. **Store release.** Apple Developer and Google Play accounts, privacy labels, update
    `privacy.html` for the app, App Store and Play screenshots, TestFlight / internal testing, submit.

---

## 7. Known Gaps

| Item | Notes |
|---|---|
| Expo web against production | Manager and portal APIs send no CORS headers; web is for layout checks only |
| Single property | Inherited from the manager API (`PMA_PROPERTY_ID`) |
| Resident updates not pushed | See step 5; applies to the web dashboard too |
| `npx expo install` online check | Blocked in the cloud build environment; versions came from Expo's bundled map. Run `npx expo install --check` on a developer machine |
| Expo's `npm audit` notices | 5 moderate, in build tooling; review before release |
