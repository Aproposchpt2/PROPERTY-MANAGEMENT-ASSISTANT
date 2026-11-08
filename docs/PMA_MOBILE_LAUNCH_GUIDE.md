# PMA App — Launch Guide
**Stellar Intelligent Software Developers · Property Management Assistant**
*Updated 2026-11-08 for branch `claude/new-session-ykm5xi`*

One ordered checklist to take the PMA app and today's server changes live.

**Delivery decision (2026-11-08):** the PMA app is part of the delivery package (the
differentiator, $999/mo platform fee + $0.50/min). No public App Store or Google Play listing.

| Who | Gets | How |
|---|---|---|
| **The client's management team** (whatever titles the client uses) | **In-house mobile app**, iPhone and Android, staff-only, with native alerts | Private install link from Expo (EAS internal distribution); iPhones registered first |
| **Residents** | **Web app** at `pma.stellaruc.com/app` | Link or QR code → Add to Home Screen; nothing to register |

Why the split: Apple only allows in-house iPhone installs on registered devices (up to 100 iPhones
per year per Apple account), which suits a small team but not every resident. The in-house app is
**staff-only**: it opens on team sign-in and has no resident screens. The team can also use the web app
(with web push alerts) on any device.

**Built for each client's business:** the app never names a job title; it says "team". Who gets in is
decided by the client's dashboard accounts (system roles OWNER, ADMIN or MANAGER, assigned to whoever
the client chooses). Put the client's business name in `mobile/eas.json` → `internal` → `env` →
`EXPO_PUBLIC_BUSINESS_NAME` before building; it appears on sign-in and the dashboard.

Do the parts in order; each step says how to confirm it worked. Design and background:
[`PMA_MOBILE_BLUEPRINT_2026-11-08.md`](PMA_MOBILE_BLUEPRINT_2026-11-08.md). What changed:
[`PMA_CHANGE_RECORD_2026-11-08.md`](PMA_CHANGE_RECORD_2026-11-08.md).

| Part | What | Result |
|---|---|---|
| 0 | Database: security fix and web push table | Ava closes sessions again; public functions locked down; browsers can register for alerts |
| 1 | Netlify: settings, merge, deploy | The app is live at `/app`; website and app endpoints updated |
| 2 | Residents: test and roll out | Residents request maintenance and follow cases from the app |
| 3 | Management team: in-house app — accounts, register iPhones, build, install, test | The team runs cases from their phones |
| 4 | Manager alerts | Native alerts in the in-house app; web push for managers using the browser |
| 5 | Hand-off to each customer | Install links, QR codes and a one-page how-to |

---

## Fast path — launch the staff mobile app only

Everything below is the minimum to get the in-house app onto the management team's phones. The
resident web app, web push and the security SQL can follow later (Parts 0, 2 and 4 web sections).

| # | Step | Where | Done |
|---|---|---|---|
| 1 | Merge `claude/new-session-ykm5xi` into `main`; wait for Netlify **Published** (the alerts, "send update to resident" and approval fields live in this branch) | GitHub, Netlify | ☐ |
| 2 | Netlify env var `PMA_PUSH_ENABLED` = `true`, then **Trigger deploy** | Netlify | ☐ |
| 3 | Supabase → Authentication → Emails → **Magic Link** contains `{{ .Token }}` (sign-in code) | Supabase | ☐ |
| 4 | `cd mobile && npm install && npx eas-cli@latest login && npx eas-cli@latest init` → commit the updated `app.json` | Your computer | ☐ |
| 5 | Put the client's name in `mobile/eas.json` → `internal.env.EXPO_PUBLIC_BUSINESS_NAME` → commit | Repo | ☐ |
| 6 | Android alerts: Firebase project → Android app `com.stellar.pma` → `google-services.json` into `mobile/` + `"googleServicesFile": "./google-services.json"` under `android` in `app.json`; service-account key → `npx eas-cli@latest credentials` (3.2) | Firebase, your computer | ☐ |
| 7 | Join the **Apple Developer Program** ($99/yr) | developer.apple.com | ☐ |
| 8 | `npx eas-cli@latest device:create` → send the link to each team member's iPhone → they install the profile (3.3) | Your computer, their iPhones | ☐ |
| 9 | `npx eas-cli@latest build --profile internal --platform all` → sign in to Apple when asked; say **yes** to certificates, profile and push key (3.4) | Your computer | ☐ |
| 10 | Send the install links; iPhone: Developer Mode on (Settings → Privacy & Security), Android: allow the install | Team phones | ☐ |
| 11 | Each person signs in with their dashboard email + code → **Allow** notifications → Alerts → **Send a test notification** | Team phones | ☐ |
| 12 | Test: one case update with "send to resident", one provider assignment, one approval, one test request by phone call (new-case alert) | Team phones | ☐ |

Who can sign in: anyone with an active dashboard account (OWNER, ADMIN, or MANAGER with access to
the property) — whatever title the client gives them.

---

## What you need

- [ ] Supabase dashboard access to project `vqrqyanqsiqzsmlhytaz`
- [ ] Netlify access to site `property-management-assistant` (`pma.stellaruc.com`)
- [ ] GitHub access to merge `claude/new-session-ykm5xi`
- [ ] A computer with Node 22+ and this repo cloned
- [ ] **Expo account** (free to start; builds run on Expo's servers) — expo.dev
- [ ] **Apple Developer Program** membership ($99/year) — needed to install the in-house app on iPhones
- [ ] **Firebase project** (free) — needed for Android alerts in the in-house app
- [ ] Test devices: an iPhone (iOS 16.4 or later), an Android phone, and a computer browser
- [ ] A manager account on the web dashboard (OWNER, ADMIN or MANAGER in `tenant_users`) and a
      signed-in account that is **not** a manager

---

## Part 0 — Database (Supabase)

### 0.1 Security fix

Fixes a stray public function that makes every close-session call fail, and a support-intake
function anyone could call without signing in (details: change record, section 4).

1. Supabase → project `vqrqyanqsiqzsmlhytaz` → **SQL Editor** → New query → paste → **Run**:
   ```sql
   begin;
   drop function if exists public.pma_voice_session_close_v1(uuid, uuid, uuid, text, text, jsonb);
   revoke execute on function public.stellar_create_support_intake(uuid, text, text, text, text, text, text, text, text, text, text) from public, anon;
   grant execute on function public.stellar_create_support_intake(uuid, text, text, text, text, text, text, text, text, text, text) to authenticated, service_role;
   commit;
   ```
2. **Confirm** — expect one `pma_voice_session_close_v1` row (5 arguments) and no leading
   `=X/postgres` entry on the support-intake function:
   ```sql
   select p.oid::regprocedure, array_to_string(p.proacl, ',')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('pma_voice_session_close_v1', 'stellar_create_support_intake');
   ```
3. **Advisors → Security Advisor** → Refresh. No warnings left for `pma_voice_session_close_v1`;
   `stellar_create_support_intake` gone from "Public Can Execute…". It stays under "Signed-In Users
   Can Execute…" on purpose (its web intake route runs as the signed-in user).
4. After a short test call to the PMA line, the newest session should be `closed`:
   ```sql
   select status, started_at, ended_at from public.pma_voice_sessions order by started_at desc limit 1;
   ```

**Undo:** `supabase/migrations/20261108110000_security_fix_public_functions_rollback.sql`.

### 0.2 Web push table

Paste the contents of `supabase/migrations/20261108120000_pma_web_push_subscriptions.sql` into a new
SQL Editor query and **Run**. Confirm:
```sql
select relrowsecurity from pg_class where relname = 'pma_web_push_subscriptions';  -- expect true
```
(The phone-app token table `pma_push_tokens` was applied on 2026-11-08 and is already there.)

**Undo:** `20261108120000_pma_web_push_subscriptions_rollback.sql`.

---

## Part 1 — Netlify settings, merge and deploy

1. **App request secret.** On your computer:
   ```bash
   openssl rand -base64 48
   ```
2. **Alert keys** (VAPID, the standard keys for web push):
   ```bash
   npx web-push generate-vapid-keys
   ```
   It prints a Public Key and a Private Key.
3. Netlify → **Site configuration → Environment variables** → add:

   | Key | Value | Secret? |
   |---|---|---|
   | `PMA_APP_VERIFY_SECRET` | output of step 1 | **Yes** |
   | `PMA_WEB_PUSH_PRIVATE_KEY` | Private Key from step 2 | **Yes** |
   | `PMA_WEB_PUSH_PUBLIC_KEY` | Public Key from step 2 | No (browsers receive it) |
   | `PMA_WEB_PUSH_SUBJECT` | `mailto:` plus an address push services can contact, e.g. `mailto:support@your-domain.com` | No |
   | `PMA_PUSH_ENABLED` | `true` (or leave unset until Part 4) | No |

   Keep `PMA_SMS_ENABLED=true` and `PMA_EMAIL_ENABLED=true` as they are today. The app's public
   settings (`EXPO_PUBLIC_*`) are already in `netlify.toml`; nothing to add for them.
4. **Merge** `claude/new-session-ykm5xi` into `main` (pull request on GitHub). Netlify now runs a build
   step (`scripts/build-web-app.sh`) that builds the app into `/app`; the first build takes a few
   minutes longer while it installs the app's packages. Wait for **Published**.
   - If the deploy fails at the build step, the live site stays on the previous deploy. Check the
     deploy log for the `build-web-app.sh` output.
5. **Confirm:**
   - [ ] `https://pma.stellaruc.com/app` opens the PMA welcome screen.
   - [ ] App endpoint (sends no text):
     ```bash
     curl -s -X POST https://pma.stellaruc.com/api/app/verify -H 'content-type: application/json' -d '{"phone":"+44 7700 900123"}'
     ```
     Expect `"state":"INVALID_PHONE"`. `"UNAVAILABLE"` means `PMA_APP_VERIFY_SECRET` is missing → redeploy.
   - [ ] Web dashboard `https://pma.stellaruc.com/manager`: pending cost approvals show the blue badge;
         saving an update with **Also send this update to the resident…** ticked reaches the resident.
   - [ ] `https://pma.stellaruc.com/mobile/README.md` returns 404 (source folder not public).

**Undo:** Netlify → Deploys → previous deploy → **Publish deploy**.

---

## Part 2 — Residents

### 2.1 Install on a phone

- **iPhone (Safari):** open `pma.stellaruc.com/app` → **Share** → **Add to Home Screen** → Add.
- **Android (Chrome):** open the link → menu **⋮** → **Install app** / **Add to Home screen**.
- Open **PMA** from the home screen: it runs full screen with the PMA icon.

### 2.2 Test

- [ ] Welcome shows **Request maintenance** and **Check on a request**.
- [ ] **Request maintenance** → problem, name, address, unit → Continue → mobile, **Text**, tick consent →
      **Text me a code** → code arrives from (725) 201-0584 → enter → **Submit request**.
- [ ] Case number shown; confirmation text with status link arrives; staff texts arrive as for a call.
- [ ] Case appears in the web dashboard (shown as "voice" until the follow-up migration).
- [ ] **Follow my request** opens the status screen. Close and reopen the app: **Check on a request**
      lists it, and a second request has name, address and unit filled in.
- [ ] Repeat with **Email**, and with **Español**.
- [ ] Emergency wording ("I smell gas in the kitchen"): red urgent notice and emergency texts to staff.
- [ ] Enter a wrong code five times; the sixth try says "Too many wrong codes. Request a new code."
- [ ] A UK number (+44…) is refused.

---

## Part 3 — Management team: in-house app (staff-only)

### 3.1 Sign-in email (once)

Supabase → **Authentication → Emails → Magic Link**: the template must contain `{{ .Token }}`, e.g.
`Your PMA sign-in code is {{ .Token }}`. The app signs in with the code.

### 3.2 Set up the build (once)

The build settings are already in `mobile/eas.json` (profile **internal**: private install links,
manager screens on, Android as a direct-install APK). On your computer:
```bash
cd mobile
npm install
npx eas-cli@latest login      # your Expo account
npx eas-cli@latest init       # creates the Expo project; writes its id into app.json — commit that change
```

**Android alerts (Firebase):** in the Firebase console create a project → **Add app → Android** with
package `com.stellar.pma` → download `google-services.json` into `mobile/` → add
`"googleServicesFile": "./google-services.json"` inside `"android"` in `mobile/app.json` → commit. Then
Project settings → Service accounts → **Generate new private key**, and upload it:
```bash
npx eas-cli@latest credentials   # Android → internal → Google Service Account Key for push (FCM V1)
```
(The service-account key is a secret: upload it, never commit it.)

### 3.3 Register managers' iPhones

Apple installs in-house apps only on registered iPhones (up to 100 per year per Apple account).
```bash
npx eas-cli@latest device:create   # choose "Website": you get a link / QR code
```
Send the link to each manager. On their iPhone, in **Safari**, they open it and install the small
registration profile (Settings → Profile Downloaded → Install). Android phones need no registration.

### 3.4 Build and send install links

```bash
npx eas-cli@latest build --profile internal --platform all
```
- The first iOS build asks you to sign in with the Apple Developer account and lets EAS create the
  certificate, the in-house provisioning profile (with the registered iPhones) and the **push key**
  — answer **yes** to each.
- When it finishes, Expo shows an **install page link and QR code** per platform. Send them to managers.
- **iPhone:** open the link in Safari → Install. On iOS 16+, the first open asks for **Developer Mode**:
  Settings → Privacy & Security → Developer Mode → On → restart. (Required by Apple for in-house apps.)
- **Android:** open the link → download → allow "install from this source" once → Install.

**New manager iPhone later:** register it (3.3), then rebuild iOS
(`npx eas-cli@latest build --profile internal --platform ios`) and send the new link.
**App changes later:** rebuild and send the new link; installing it updates the app in place.

### 3.5 Test with a manager account

Open **PMA**: it goes straight to **Team Sign In** (no resident screens in this app).
   - [ ] Email → code → signed in; counts match the web dashboard; filters work.
   - [ ] Open a case → **Assign provider** → provider, Tomorrow, a window, a work order → Assign.
   - [ ] Type an update, leave **Also send this update to the resident** ticked → Save → resident receives it;
         the confirmation says it was sent.
   - [ ] On a case waiting for cost approval → **Approve** → confirm in the dialog → the card disappears.
         (Use a test case: approving confirms the provider's proposed visit, if any.)
   - [ ] **Sign out** returns to the welcome screen.
- **Non-manager account:** signs in, then sees "does not have manager access" and nothing else.
- Managers can also use the web app (`/app`) on any computer or phone with the same sign-in.

---

## Part 4 — Manager alerts

Requires `PMA_PUSH_ENABLED=true` (Part 1). The phone token table is already live (applied
2026-11-08); browser alerts also need Part 0.2 and the Part 1 web push keys.

**In-house app (iPhone and Android):** after a manager signs in, the app asks to allow notifications
→ **Allow**. That's all. (Android also needs the Firebase steps in 3.2.)

**Web app (managers on a computer, or a phone without the in-house app):** bell icon → **Alerts** →
**Turn on alerts** → allow. On iPhone this only works when PMA was opened **from the Home Screen**
(iOS 16.4+); the screen explains it.

On either: bell icon → **Alerts** shows three switches (Emergencies, New cases, Cost approvals) and
**Send a test notification**.

**Test:**
   - [ ] File a normal app request → "New case #…" alert; tap it → PMA opens on that case.
   - [ ] File an emergency request → "EMERGENCY: case #…" alert (Android: emergency channel; web: stays
         on screen until dismissed).
   - [ ] A provider quote over the limit (vendor line) → "Cost approval needed" alert.
   - [ ] Turn **New cases** off → no alert for a normal request; emergencies still arrive.
   - [ ] **Sign out** → no more alerts on that device.
   - [ ] A MANAGER without access to the property gets none; OWNER/ADMIN do.
   - [ ] Staff texts still arrive as before.

**Turn alerts off at any time:** remove `PMA_PUSH_ENABLED` in Netlify and redeploy.

---

## Part 5 — Hand-off to each customer

Part of each delivery package:

- [ ] **Resident link and QR code** for `https://pma.stellaruc.com/app` (lobby sign, welcome packet,
      resident portal, and the status texts residents already receive).
- [ ] **Managers:** each manager's dashboard account (OWNER/ADMIN/MANAGER, with property access for
      MANAGER); their iPhones registered (3.3); the in-house app install links (3.4).
- [ ] **One-page how-to for residents:** Add to Home Screen (2.1), request maintenance, check on a request.
- [ ] **One-page how-to for managers:** install from the link (allow Developer Mode on iPhone / the install
      source on Android), sign in with the emailed code, allow notifications.
- [ ] Remind everyone that PMA does not replace 911.

Before onboarding customers, update `privacy.html` and `terms.html` to cover the app (it collects
name, phone, email and property address to file requests; phones are confirmed by text; managers'
devices register for alerts).

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/app` shows a 404 or old content | Deploy predates the merge, or the build step failed | Check the Netlify deploy log; redeploy |
| App: "Requests by app are not available right now" | `PMA_APP_VERIFY_SECRET` missing, or `PMA_SMS_ENABLED` not `true` | Part 1; redeploy |
| No code text arrives | Number opted out (STOP), not a mobile, or Twilio issue | Text START to (725) 201-0584; check Twilio logs |
| "Too many codes requested" | 3 codes per number / 5 per device in 10 minutes | Wait 10 minutes |
| Manager sign-in email has only a link | Template lacks `{{ .Token }}` | Part 3, step 1 |
| Signed-in manager sees "does not have manager access" | No active OWNER/ADMIN/MANAGER row, or MANAGER without property access | Fix in `tenant_users` / `pma_staff_property_access` |
| Alerts: "add PMA to your Home Screen first" | iPhone using Safari, not the installed app | Install (2.1) and open from the Home Screen |
| In-house app won't install on an iPhone ("unable to install") | iPhone not registered before the build | Register (3.3), rebuild iOS, send the new link |
| In-house app won't open on an iPhone | Developer Mode off (iOS 16+) | Settings → Privacy & Security → Developer Mode → On → restart |
| In-house app Alerts: "no EAS project id" | Built before `eas init` | 3.2, rebuild |
| No alerts on Android in-house app | Firebase file or FCM key missing | 3.2, rebuild |
| Alerts: "not set up on the server yet" | `PMA_WEB_PUSH_*` keys missing | Part 1, steps 2–3; redeploy |
| Alerts: "Notifications are blocked for this site" | Permission denied earlier | iPhone: Settings → Notifications → PMA. Browser: site settings → Notifications → Allow |
| Test notification: "not switched on" | `PMA_PUSH_ENABLED` not `true` | Part 1, step 3 |
| Resident update not sent: "didn't choose text or email" | Resident gave no preference on the call | Expected; they see it on their status page |
| Voice sessions stay `active`; API logs show HTTP 300 on `pma_voice_session_close_v1` | Part 0.1 not applied | Part 0.1 |

---

## Rollback summary

| Change | How to undo |
|---|---|
| Server code and web app | Netlify → Deploys → publish the previous deploy (or revert the merge) |
| App requests only | Remove `PMA_APP_VERIFY_SECRET` → the app tells residents to call instead |
| Manager alerts | Remove `PMA_PUSH_ENABLED` |
| Manager screens in the web app | Set `EXPO_PUBLIC_ENABLE_MANAGER = "false"` in `netlify.toml` |
| A manager's in-house app | Remove their iPhone in the Apple Developer account and rebuild; their dashboard account controls access regardless (remove or suspend it in `tenant_users`) |
| Security fix | `20261108110000_security_fix_public_functions_rollback.sql` |
| Push tables | `20261108120000_pma_web_push_subscriptions_rollback.sql`, `20261108100000_pma_push_tokens_rollback.sql` (turn alerts off first) |

---

## Appendix — Beyond 100 iPhones, or a store listing later (optional)

- **More than ~100 manager iPhones a year:** use **TestFlight** (up to 10,000 people by email or link;
  each build expires after 90 days, so send updates regularly) or Apple's **unlisted** App Store
  distribution (private link, not searchable, one-time Apple review). Apple's Enterprise program is
  only for a company's own employees, so it doesn't fit customers' managers.
- **Public store listing:** `eas.json` already has a `production` profile:
  `npx eas-cli@latest build --profile production --platform all`, then `npx eas-cli@latest submit`.
  Not part of the current delivery.
