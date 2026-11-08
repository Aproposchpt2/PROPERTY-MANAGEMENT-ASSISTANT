# PROPERTY MANAGEMENT ASSISTANT: Mobile

Expo (SDK 58) + Expo Router + TypeScript app for iOS and Android.

**Phase 1** is the Customer Care Center maintenance request, in the app: a resident files a
request and gets the same result as calling the property line (case number, emergency
escalation, staff alerts, text or email confirmation, status link), then follows it in the app.
**Phase 2** is the manager app, built and switched on per build with `EXPO_PUBLIC_ENABLE_MANAGER=true`.

Full blueprint and next steps: [`docs/PMA_MOBILE_BLUEPRINT_2026-11-08.md`](../docs/PMA_MOBILE_BLUEPRINT_2026-11-08.md).
Step-by-step launch checklist: [`docs/PMA_MOBILE_LAUNCH_GUIDE.md`](../docs/PMA_MOBILE_LAUNCH_GUIDE.md).

## How it connects

The app has no tables of its own and needs no database migration.

| Screen | API | Notes |
|---|---|---|
| Request maintenance | `POST /api/app/verify`, `POST /api/app/request` (`netlify/functions/pma-app-api.js`) | Phone confirmed by texted code, then filed through the same steps as a call (`lib/pma-intake-flow.js`) |
| Case status | `GET /api/portal/case?t=TOKEN` | The status-link token is the credential |
| Manager (phase 2) | `/api/manager/cases`, `/cases/:id` (GET, PATCH with `notify_resident`), `/cases/:id/assign`, `/cases/:id/approve`, `/vendors` | Role and property access checked on the server |

Only public values ship in the app (`.env.example`). The server needs
`PMA_APP_VERIFY_SECRET` set in Netlify; without it the app tells residents to call instead.

## Run

1. `npm install`
2. `cp .env.example .env`
3. `npx expo start`, then open in Expo Go or a development build

Checks: `npm run typecheck` and `npm test`. Add packages with `npx expo install <name>`.

## Screens

- `src/app/index.tsx`: welcome (Request maintenance, Check on a request, 911 notice)
- `src/app/request.tsx`: problem → contact → code → confirmation
- `src/app/resident.tsx`: my requests, paste a status link, call the property line
- `src/app/status.tsx`: case status; also opens from `pma://status?t=TOKEN`
- `src/app/manager/*` (phase 2, on with `EXPO_PUBLIC_ENABLE_MANAGER=true`): dashboard with approval
  banner and filters; case screen with cost approval, provider, status, resident update (optionally
  texted or emailed to the resident) and notes; assign-provider screen with visit windows; Alerts screen
  for push notifications (emergency, new case, cost approval). Push needs a development or store build
  (not Expo Go on Android) and `npx eas-cli@latest init` for the project id; see the blueprint. Managers
  sign in with an emailed code, so the Supabase "Magic Link" email template must include `{{ .Token }}`.
