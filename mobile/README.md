# PROPERTY MANAGEMENT ASSISTANT: Mobile

Expo (SDK 58) + Expo Router + TypeScript app for iOS and Android, built from the
November 2026 Ruflo handoff and wired to the **live PMA system** in this repository.

Full blueprint and phased next steps: [`docs/PMA_MOBILE_BLUEPRINT_2026-11-08.md`](../docs/PMA_MOBILE_BLUEPRINT_2026-11-08.md).

## How it connects

The app has no tables of its own and needs no database migration. It uses the same
server APIs as the web pages:

| Screen | API | Authorization |
|---|---|---|
| Manager dashboard and case workspace | `/api/manager/cases`, `/api/manager/cases/:id` (GET, PATCH) | Supabase sign-in, then `tenant_users` role OWNER/ADMIN/MANAGER and property access, checked on the server (`netlify/functions/lib/pma-auth.js`) |
| Resident case status | `/api/portal/case?t=TOKEN` | The status-link token residents receive by text or email |
| Resident report | Calls the property line | Ava files the case (`pma_maintenance_requests`) and sends the status link |

Cases filed by voice therefore appear in the app straight away, and a status change made
in the app is the same change the web Management Dashboard makes.

The app bundle contains only public values: the Supabase URL, the publishable key and
the site address. The service-role key stays in Netlify.

## Run

1. `npm install`
2. `cp .env.example .env` (the values in it are the public ones the web dashboard already uses)
3. `npx expo start`, then open in Expo Go or a development build

Checks: `npm run typecheck` and `npm test`.

Add packages with `npx expo install <name>` so versions match the SDK.

## Sign-in

Managers sign in with the same emailed one-time code as `manager.html`
(`signInWithOtp` with `shouldCreateUser: false`, then `verifyOtp`). The Supabase
"Magic Link" email template must include `{{ .Token }}` for the code to be in the email.
A signed-in user without a manager role sees an access message and nothing else.

## Screens

- `src/app/index.tsx`: choose resident or manager
- `src/app/resident.tsx`: call the property line; paste a status link; recent cases on this device (kept in SecureStore)
- `src/app/status.tsx`: resident case view; also opens from `pma://status?t=TOKEN`
- `src/app/manager/login.tsx`: emailed-code sign-in
- `src/app/manager/index.tsx`: Active / New / Urgent / Resolved counts, filterable queue
- `src/app/manager/[id].tsx`: case details, status, update for the resident, internal notes, activity timeline

## Differences from the handoff

- **No new schema.** The handoff's `001_pma.sql` (`profiles`, `properties`, `units`,
  `incidents`) would have created a second incident system that voice intake never writes to.
  The app uses the existing `pma_*` tables through the existing APIs instead.
- **Lifecycle** uses the live statuses: New, Assigned, Scheduled, In Progress, Completed, Closed.
- **Residents report by phone**, as on the website. Residents have no app accounts in the
  live system, so in-app reporting, photo uploads and push notifications are next steps
  that need a resident identity design first.
- **Vendor assignment and cost approvals** stay on the web dashboard for now; the app links to it.
- **Role gating** is enforced by the server on every request. Route guards (`Stack.Protected`) only
  keep signed-out users on the sign-in screen.

## Next steps (from the handoff's production checklist)

Resident accounts and in-app reporting, photo storage, push-token registration and
notification preferences, vendor assignment in the app, offline retry, device-size and
accessibility QA, app icons and splash, and EAS preview builds (`eas.json`).
