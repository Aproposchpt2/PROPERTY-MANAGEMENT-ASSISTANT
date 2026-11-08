# PMA App — Launch Guide
**Stellar Intelligent Software Developers · Property Management Assistant**
*Updated 2026-11-08 for branch `claude/new-session-ykm5xi`*

One ordered checklist to take the PMA app and today's server changes live.

**Delivery decision (2026-11-08):** the PMA app ships as part of the delivery package (the
differentiator, $999/mo platform fee + $0.50/min) as a **web app** at `pma.stellaruc.com/app`.
Residents and managers open a link or QR code and **Add to Home Screen**; it then opens full screen
like an app. No App Store, no Google Play, no Apple review. Manager alerts use web push.

Do the parts in order; each step says how to confirm it worked. Design and background:
[`PMA_MOBILE_BLUEPRINT_2026-11-08.md`](PMA_MOBILE_BLUEPRINT_2026-11-08.md). What changed:
[`PMA_CHANGE_RECORD_2026-11-08.md`](PMA_CHANGE_RECORD_2026-11-08.md).

| Part | What | Result |
|---|---|---|
| 0 | Database: security fix and web push table | Ava closes sessions again; public functions locked down; browsers can register for alerts |
| 1 | Netlify: settings, merge, deploy | The app is live at `/app`; website and app endpoints updated |
| 2 | Residents: test and roll out | Residents request maintenance and follow cases from the app |
| 3 | Managers: sign-in, test and roll out | Managers run cases from the app |
| 4 | Manager alerts (web push) | Managers' devices get alerts |
| 5 | Hand-off to each customer | Links, QR codes and a one-page how-to |

---

## What you need

- [ ] Supabase dashboard access to project `vqrqyanqsiqzsmlhytaz`
- [ ] Netlify access to site `property-management-assistant` (`pma.stellaruc.com`)
- [ ] GitHub access to merge `claude/new-session-ykm5xi`
- [ ] A computer with Node 22+ (only to generate the alert keys in Part 1)
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

## Part 3 — Managers

1. **Sign-in email.** Supabase → **Authentication → Emails → Magic Link**: the template must contain
   `{{ .Token }}`, e.g. `Your PMA sign-in code is {{ .Token }}`. The app signs in with the code.
2. **Install** as in 2.1, then **Manager sign in** on the welcome screen.
3. **Test with a manager account:**
   - [ ] Email → code → signed in; counts match the web dashboard; filters work.
   - [ ] Open a case → **Assign provider** → provider, Tomorrow, a window, a work order → Assign.
   - [ ] Type an update, leave **Also send this update to the resident** ticked → Save → resident receives it;
         the confirmation says it was sent.
   - [ ] On a case waiting for cost approval → **Approve** → confirm in the dialog → the card disappears.
         (Use a test case: approving confirms the provider's proposed visit, if any.)
   - [ ] **Sign out** returns to the welcome screen.
4. **Non-manager account:** signs in, then sees "does not have manager access" and nothing else.

---

## Part 4 — Manager alerts (web push)

Requires Part 0.2 and the Part 1 keys, with `PMA_PUSH_ENABLED=true`.

1. **iPhone:** alerts only work when PMA was opened **from the Home Screen** (iOS 16.4+). In Safari
   itself the Alerts screen explains this. **Android and computers:** work in Chrome, Edge or Firefox,
   installed or not.
2. Manager dashboard → bell icon → **Alerts** → **Turn on alerts** → allow when the browser asks.
3. Three switches appear (Emergencies, New cases, Cost approvals) → **Send a test notification** → it arrives.
4. **Test:**
   - [ ] File a normal app request → "New case #…" alert; tap it → PMA opens on that case.
   - [ ] File an emergency request → "EMERGENCY: case #…" alert; it stays on screen until dismissed.
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
- [ ] **Manager link** (same URL) and each manager's dashboard account (OWNER/ADMIN/MANAGER, with
      property access for MANAGER).
- [ ] **One-page how-to:** Add to Home Screen (2.1), request maintenance, check on a request; for managers,
      sign-in with the emailed code and **Turn on alerts**.
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
| Security fix | `20261108110000_security_fix_public_functions_rollback.sql` |
| Push tables | `20261108120000_pma_web_push_subscriptions_rollback.sql`, `20261108100000_pma_push_tokens_rollback.sql` (turn alerts off first) |

---

## Appendix — Store apps later (optional)

The same code also builds native iPhone/Android apps with native push (already built). If a customer
ever needs a store or private-store app: `cd mobile && npx eas-cli@latest init`, add FCM credentials
(`eas credentials`), `eas build`, then TestFlight / Google Play internal testing or Apple's unlisted
distribution. Not part of the current delivery.
