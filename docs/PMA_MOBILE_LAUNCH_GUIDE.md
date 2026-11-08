# PMA Mobile App — Launch Guide
**Stellar Intelligent Software Developers · Property Management Assistant**
*Written 2026-11-08 for branch `claude/new-session-ykm5xi`*

One ordered checklist to take the mobile app and today's server changes live. Do the parts in
order; each step says how to confirm it worked. Background and design:
[`PMA_MOBILE_BLUEPRINT_2026-11-08.md`](PMA_MOBILE_BLUEPRINT_2026-11-08.md). What changed:
[`PMA_CHANGE_RECORD_2026-11-08.md`](PMA_CHANGE_RECORD_2026-11-08.md).

| Part | What | Who can use it after |
|---|---|---|
| 0 | Database security fix | Ava closes sessions again; public functions locked down |
| 1 | Server: secret, merge, deploy | Web dashboard can text/email residents; app endpoints live |
| 2 | Phase 1 app: resident requests | Residents (test builds, then stores) |
| 3 | Phase 2 app: managers | Managers |
| 4 | Manager push notifications | Managers' phones get alerts |
| 5 | Store release | Public |

---

## What you need

- [ ] Supabase dashboard access to project `vqrqyanqsiqzsmlhytaz`
- [ ] Netlify access to site `property-management-assistant` (`pma.stellaruc.com`)
- [ ] GitHub access to merge `claude/new-session-ykm5xi`
- [ ] An Expo account (free) — for builds and push
- [ ] A computer with Node 22+ and this repo cloned
- [ ] Test phones: one iPhone, one Android, each able to receive texts
- [ ] A manager account on the web dashboard (OWNER, ADMIN or MANAGER in `tenant_users`) and a
      signed-in account that is **not** a manager, for access checks
- [ ] For store release: Apple Developer Program and Google Play Console accounts

---

## Part 0 — Database security fix (do first)

Fixes two problems found on 2026-11-08 (details in the change record, section 4): a stray
public function that makes every close-session call fail, and a support-intake function anyone
could call without signing in.

1. Supabase → project `vqrqyanqsiqzsmlhytaz` → **SQL Editor** → New query. Paste and **Run**:
   ```sql
   begin;
   drop function if exists public.pma_voice_session_close_v1(uuid, uuid, uuid, text, text, jsonb);
   revoke execute on function public.stellar_create_support_intake(uuid, text, text, text, text, text, text, text, text, text, text) from public, anon;
   grant execute on function public.stellar_create_support_intake(uuid, text, text, text, text, text, text, text, text, text, text) to authenticated, service_role;
   commit;
   ```
   (Same as `supabase/migrations/20261108110000_security_fix_public_functions.sql`.)

2. **Confirm** — run this; expect exactly one `pma_voice_session_close_v1` row (5 arguments) and no
   leading `=X/postgres` entry for the support-intake function:
   ```sql
   select p.oid::regprocedure, array_to_string(p.proacl, ',')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('pma_voice_session_close_v1', 'stellar_create_support_intake');
   ```
3. Supabase → **Advisors → Security Advisor** → Refresh. Expect:
   - No warnings left for `pma_voice_session_close_v1`.
   - `stellar_create_support_intake` no longer under "Public Can Execute…". It **stays** under
     "Signed-In Users Can Execute…" on purpose: its web intake route runs as the signed-in user.
     Removing that needs a tenant check inside the function (CUSTOMER-ENGAGEMENT-OPERATIONS-CENTER repo).
4. Make a short test call to the PMA line, end it normally, then confirm the session closed:
   ```sql
   select status, started_at, ended_at from public.pma_voice_sessions order by started_at desc limit 1;
   ```
   Expect `closed`.

**Undo:** run `supabase/migrations/20261108110000_security_fix_public_functions_rollback.sql`.

---

## Part 1 — Server (Netlify)

1. **Create the app secret.** On your computer:
   ```bash
   openssl rand -base64 48
   ```
2. Netlify → site → **Site configuration → Environment variables** → Add:

   | Key | Value |
   |---|---|
   | `PMA_APP_VERIFY_SECRET` | the value from step 1 (keep it secret; never put it in the app) |

   Leave `PMA_PUSH_ENABLED` unset for now (Part 4). Check `PMA_SMS_ENABLED=true` and
   `PMA_EMAIL_ENABLED=true` are already set as they are today.
3. **Merge** branch `claude/new-session-ykm5xi` into `main` (open a pull request on GitHub and merge).
   Netlify deploys automatically. Wait for the deploy to show **Published**.
4. **Confirm the app endpoint** — from any terminal (this sends no text):
   ```bash
   curl -s -X POST https://pma.stellaruc.com/api/app/verify -H 'content-type: application/json' -d '{"phone":"+44 7700 900123"}'
   ```
   Expect `"state":"INVALID_PHONE"`. If you see `"state":"UNAVAILABLE"`, the secret from step 2 is
   missing or the deploy predates it — redeploy.
5. **Confirm the website** — open `https://pma.stellaruc.com/manager`, sign in, open a test case:
   - [ ] Cases with a pending cost approval show the blue approval badge.
   - [ ] Type an update, tick **Also send this update to the resident…**, Save. The message says
         "Resident notified." (or why not), and the resident's phone/email receives it.
   - [ ] `https://pma.stellaruc.com/mobile/README.md` returns 404 (the app folder is not public).

**Undo:** Netlify → Deploys → pick the previous deploy → **Publish deploy**.

---

## Part 2 — Phase 1 app: resident maintenance requests

### 2.1 Set up the project (once)

```bash
cd mobile
npm install
cp .env.example .env          # public values only; EXPO_PUBLIC_ENABLE_MANAGER=false
npm run typecheck && npm test # expect: no errors, all tests pass
npx eas-cli@latest login
npx eas-cli@latest init       # creates the Expo project and writes its id into app.json
npx eas-cli@latest build:configure   # creates eas.json (development, preview, production)
```
Commit the updated `app.json` and new `eas.json`.

Add the app's public settings to the Expo project so cloud builds get them (Expo dashboard →
project → **Environment variables**, or `npx eas-cli@latest env:create`), one per line of
`mobile/.env.example`:

| Name | Value |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `https://vqrqyanqsiqzsmlhytaz.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | as in `.env.example` |
| `EXPO_PUBLIC_PMA_API_BASE` | `https://pma.stellaruc.com` |
| `EXPO_PUBLIC_PMA_PHONE` | `+17252010584` (or the property line residents should call) |
| `EXPO_PUBLIC_ENABLE_MANAGER` | `false` for the resident release |

Never add `SUPABASE_SERVICE_ROLE_KEY`, `PMA_APP_VERIFY_SECRET` or any other secret here:
`EXPO_PUBLIC_` values are readable inside the app.

### 2.2 Branding

Replace the Expo placeholders in `mobile/assets/` (`icon.png`, `splash-icon.png`,
`android-icon-*.png`, `favicon.png`) with PMA artwork at the same sizes.

### 2.3 Test build

```bash
npx eas-cli@latest build --profile preview --platform all
```
Install from the links Expo gives (Android: APK link; iPhone: register the device when prompted,
or use TestFlight in Part 5).

### 2.4 Test on both phones

- [ ] Welcome shows **Request maintenance** and **Check on a request**; no manager button.
- [ ] **Request maintenance**: fill the problem, name, address, unit → Continue → mobile number,
      **Text**, tick consent → **Text me a code** → code arrives from (725) 201-0584 → enter → Submit.
- [ ] Confirmation shows a case number; the confirmation text with a status link arrives.
- [ ] Staff texts arrive at the maintenance and manager numbers, as for a call.
- [ ] The case appears in the web dashboard. (It shows as "voice" until the follow-up migration; see
      the blueprint.)
- [ ] **Follow my request** opens the status screen; **Check on a request** lists it.
- [ ] Repeat choosing **Email**, and once with **Español**.
- [ ] Emergency: describe "I smell gas in the kitchen". Expect the red urgent notice in the app and
      emergency texts to both staff numbers.
- [ ] Enter a wrong code five times; the sixth try says "Too many wrong codes. Request a new code."
      Nothing is filed.
- [ ] A UK number (+44…) is refused.
- [ ] Paste a status link from a phone-call case into **Check on a request** → it opens.

---

## Part 3 — Phase 2 app: managers

1. **Sign-in email.** Supabase → **Authentication → Emails → Magic Link** template must contain
   `{{ .Token }}` so managers get a 6-digit code (the app cannot use the link). Example line:
   `Your PMA sign-in code is {{ .Token }}`.
2. Set `EXPO_PUBLIC_ENABLE_MANAGER` to `true` in the Expo project's environment variables (and in
   your local `.env` for development) and build again:
   ```bash
   npx eas-cli@latest build --profile preview --platform all
   ```
3. **Test with a manager account:**
   - [ ] Welcome shows **Manager sign in** → email → code arrives → signed in.
   - [ ] Dashboard counts match the web dashboard; filters work; a pending approval shows the blue
         banner and **Approval** filter.
   - [ ] Open a case → **Assign provider** → pick a provider, Tomorrow, a window, a work order →
         Assign. The case shows the provider and visit time (a New case moves to Scheduled).
   - [ ] Type an update, leave **Also send this update to the resident** ticked → Save → the resident
         receives it; the timeline shows "Update sent to resident".
   - [ ] On a case waiting for cost approval → **Approve** → confirm → the card disappears.
         (Use a test case: approving confirms the provider's proposed visit.)
   - [ ] Sign out returns to the welcome screen.
4. **Test with a non-manager account:** sign-in succeeds but the app shows "does not have manager
   access" and nothing else.

---

## Part 4 — Manager push notifications

The `pma_push_tokens` table is already in the live database (applied 2026-11-08).

1. **Android credentials.** Create a Firebase project, add an Android app with package
   `com.stellar.pma`, create a service-account key, then:
   ```bash
   npx eas-cli@latest credentials   # Android → production → Google Service Account Key for FCM V1
   ```
   **iPhone:** EAS creates the Apple push key during the first iOS build; answer **yes** when asked.
2. **Build** a development or preview build (push does not work in Expo Go on Android):
   ```bash
   npx eas-cli@latest build --profile development --platform all
   ```
3. Netlify → environment variables → add `PMA_PUSH_ENABLED` = `true`. (Only if you turn on
   "Enhanced push security" in the Expo project, also add `EXPO_ACCESS_TOKEN`.) Redeploy.
4. **Test:**
   - [ ] Sign in as a manager on each phone → allow notifications when asked.
   - [ ] Dashboard bell → **Alerts** → all three switches on → **Send a test notification** → it arrives.
   - [ ] File a normal app request → "New case #…" push. Tap it → the app opens that case.
   - [ ] File an emergency request → "EMERGENCY: case #…" push (Android: emergency channel).
   - [ ] Have a provider quote over the limit (via the vendor line) → "Cost approval needed" push.
   - [ ] Turn **New cases** off → a normal request sends no push to that phone; emergencies still do.
   - [ ] Sign out → no more pushes to that phone.
   - [ ] A MANAGER without access to the property gets no pushes; OWNER/ADMIN do.
   - [ ] Staff texts still arrive as before.

**Turn push off at any time:** remove `PMA_PUSH_ENABLED` in Netlify and redeploy.

---

## Part 5 — Store release

1. Update `privacy.html` and `terms.html` to cover the app: it collects name, phone, email and
   property address to file maintenance requests; phone numbers are confirmed by text; managers'
   devices store push tokens. Deploy.
2. Production builds:
   ```bash
   npx eas-cli@latest build --profile production --platform all
   ```
3. Store listings: screenshots (iPhone and Android), description, support URL, privacy policy URL
   (`https://pma.stellaruc.com/privacy.html`). App privacy answers: name, phone, email, physical
   address — used for app functionality, linked to the user, not used for tracking.
4. Internal testing first:
   ```bash
   npx eas-cli@latest submit --platform ios       # TestFlight
   npx eas-cli@latest submit --platform android   # Play internal testing track
   ```
5. After testers sign off, submit for review / promote to production in App Store Connect and the
   Play Console.

Decide which release carries managers: a resident-only release keeps
`EXPO_PUBLIC_ENABLE_MANAGER=false`; a later release turns it on.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| App: "Requests by app are not available right now" | `PMA_APP_VERIFY_SECRET` missing, or `PMA_SMS_ENABLED` not `true` | Part 1, step 2; redeploy |
| No code text arrives | Number opted out (replied STOP), not a mobile, or Twilio issue | Text START to (725) 201-0584; check Twilio logs |
| "Too many codes requested" | 3 codes per number / 5 per device in 10 minutes | Wait 10 minutes |
| Manager sign-in email has only a link | Template lacks `{{ .Token }}` | Part 3, step 1 |
| Signed-in manager sees "does not have manager access" | No active OWNER/ADMIN/MANAGER row, or MANAGER without property access | Add them in `tenant_users` / `pma_staff_property_access` |
| Alerts screen: "no EAS project id" | `eas init` not run before the build | Part 2.1, rebuild |
| Alerts screen: "Notifications are turned off" | Permission denied on the phone | **Open Settings** button → allow |
| Test notification: "not switched on" | `PMA_PUSH_ENABLED` not `true` | Part 4, step 3 |
| Android gets no push in Expo Go | Not supported since SDK 53 | Use a development or preview build |
| Resident update not sent: "didn't choose text or email" | Resident gave no preference on the call | Expected; they see it on their status page |
| Voice sessions stay `active`; API logs show HTTP 300 on `pma_voice_session_close_v1` | Part 0 not applied | Part 0 |

---

## Rollback summary

| Change | How to undo |
|---|---|
| Server code | Netlify → Deploys → publish the previous deploy (or revert the merge) |
| App request endpoint only | Remove `PMA_APP_VERIFY_SECRET` → app tells residents to call instead |
| Manager push | Remove `PMA_PUSH_ENABLED` |
| Manager screens in the app | Build with `EXPO_PUBLIC_ENABLE_MANAGER=false` |
| Security fix | `supabase/migrations/20261108110000_security_fix_public_functions_rollback.sql` |
| Push table | `supabase/migrations/20261108100000_pma_push_tokens_rollback.sql` (turn push off first) |
