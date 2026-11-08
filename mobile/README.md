# PROPERTY MANAGEMENT ASSISTANT: App

Expo (SDK 58) + Expo Router + TypeScript. **Delivered as a web app** at
`https://pma.stellaruc.com/app` that residents and managers add to their home screen (no App
Store). The same code also builds native iOS/Android apps if ever needed.

- **Residents:** request maintenance (same result as calling the Customer Care Center: case number,
  emergency escalation, staff alerts, text or email confirmation, status link) and follow their cases.
- **Managers:** dashboard, cases, provider assignment, cost approvals, updates sent to residents, and
  alerts (web push in the browser, native push in phone builds).

Blueprint: [`docs/PMA_MOBILE_BLUEPRINT_2026-11-08.md`](../docs/PMA_MOBILE_BLUEPRINT_2026-11-08.md) ·
Launch checklist: [`docs/PMA_MOBILE_LAUNCH_GUIDE.md`](../docs/PMA_MOBILE_LAUNCH_GUIDE.md)

## How it connects

| Screen | API | Notes |
|---|---|---|
| Request maintenance | `POST /api/app/verify`, `POST /api/app/request` (`netlify/functions/pma-app-api.js`) | Phone confirmed by texted code, then filed through the same steps as a call (`lib/pma-intake-flow.js`) |
| Case status | `GET /api/portal/case?t=TOKEN` | The status-link token is the credential |
| Manager | `/api/manager/cases`, `/cases/:id` (GET, PATCH with `notify_resident`), `/cases/:id/assign`, `/cases/:id/approve`, `/vendors` | Role and property access checked on the server |
| Alerts | `/api/manager/web-push` (browsers), `/api/manager/push-token` (phone builds), `/api/manager/push-test` | Same recipients and per-device switches |

Only public values are compiled in. For the web app they are in `netlify.toml`; for local work, in
`.env` (copy `.env.example`). Server secrets (`PMA_APP_VERIFY_SECRET`, `PMA_WEB_PUSH_PRIVATE_KEY`, …)
live only in Netlify.

## Web app

- Built on every Netlify deploy by `scripts/build-web-app.sh` into `./app` (git-ignored), served at `/app`
  (`experiments.baseUrl` in `app.json`).
- `public/`: `index.html` (home-screen tags), `manifest.webmanifest`, `sw.js` (alerts), PMA icons.
- Same-origin API calls; set `EXPO_PUBLIC_PMA_API_BASE_WEB` only for local web development.
- Browser storage remembers a resident's details and recent cases (`src/lib/storage.ts`).
- Dialogs use `src/lib/dialog.ts` (React Native's `Alert` does nothing in a browser).

Build locally like Netlify:
```bash
bash scripts/build-web-app.sh   # from the repo root; output in ./app
```

## Develop

1. `npm install`
2. `cp .env.example .env` (set `EXPO_PUBLIC_ENABLE_MANAGER=true` to see the manager screens)
3. `npx expo start` (press `w` for web)

Checks: `npm run typecheck` and `npm test`. Add packages with `npx expo install <name>`.

## Screens

- `src/app/index.tsx`: welcome (Request maintenance, Check on a request, 911 notice)
- `src/app/request.tsx`: problem → contact → code → confirmation
- `src/app/resident.tsx`: my requests, paste a status link, call the property line
- `src/app/status.tsx`: case status (also `pma://status?t=TOKEN` in phone builds)
- `src/app/manager/*`: sign-in (emailed code; the Supabase "Magic Link" template must include
  `{{ .Token }}`), dashboard, case, assign provider, alerts
