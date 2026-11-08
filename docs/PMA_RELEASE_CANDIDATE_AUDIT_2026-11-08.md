# PMA mobile release-candidate audit — November 8, 2026

Owner: Apropos Group LLC. Brand: STELLAR INTELLIGENT SOFTWARE DEVELOPERS.
Phase A verdict: **NOT READY for a controlled device pilot. Existing implementation is substantial; retain it.**
This report records inspection and fresh local validation, not production remediation or device acceptance.

## Evidence baseline

- Audited branch: `claude/new-session-ykm5xi`, commit `326d8239256dd836cb570b5d3695a68718dd64d2`.
- Main/base: `f98fca1556a671c78ae47c27e3421949c11b713e`. Development is 17 commits ahead, zero behind; 85 changed files.
- Netlify site `61d32c54-e9f3-4074-af4e-26d6a16baf99`, published deploy `6aefea0dd3b494177a623741`: ready, production context, branch main, commit f98fca1. The audited mobile/backend changes are not in that published deploy.
- Read all four requested handoff documents and mobile/AGENTS.md; reconciled against source and selected live database definitions/grants.
- Supabase project `vqrqyanqsiqzsmlhytaz`: metadata-only SELECT inspection. No tenant records, secrets, production writes, messages or live test cases.
- No merge, deployment, account purchase, signed build, public submission or client distribution performed.

## Verified architecture and completion

| Area | Source and actual status |
|---|---|
| Framework | mobile/package.json: Expo ~58.0.23, React Native 0.88.1, React 19.3.0, TypeScript ~6.0.3, Expo Router ~58.0.30. Lockfiles install successfully. |
| Navigation | src/app/_layout.tsx protects resident routes with STAFF_APP. Staff opens team sign-in; manager routes include dashboard, case, assignment and alerts. Resident request/status remain in shared web codebase. |
| Staff configuration | internal EAS profile sets APP_MODE=staff and manager enabled. BUSINESS_NAME is an environment value, blank by default; client name is not hardcoded in these screens. |
| API | mobile/src/lib/api.ts uses /api/manager/cases, detail/PATCH, assign, approve, vendors, push-token, push-test and web-push. Native default and internal profile point at production pma.stellaruc.com; web uses same origin. This needs an explicit nonproduction build profile before integration tests. |
| Authentication | Existing Supabase email OTP, shouldCreateUser=false; native session persisted with SecureStore, foreground auto refresh. Valid Supabase session alone opens manager navigation; server API authorizes tenant membership. Actual OTP delivery/template remains untested. |
| Authorization | lib/pma-auth.js validates token with getUser, ACTIVE tenant_users membership in configured tenant and OWNER/ADMIN/MANAGER role. OWNER/ADMIN get tenant active properties; MANAGER uses property-access rows. API rejects configured property outside allowedPropertyIds. Case RPCs scope to configured tenant/property. This is positive source evidence, not end-to-end isolation proof. |
| Dashboard | Counts, queue filters, urgent indicators, case details and timeline implemented. Approval fields added server-side with scoped reads. |
| Operations | Provider selection, visit window/work order, status/notes, cost approval/decline and optional resident updates implemented. Physical-device and real-backend operation tests outstanding. |
| Voice synchronization | App intake reuses pma-intake-flow.js and voice RPCs; cedar-elevenlabs.js now uses shared helpers and new-case push. These are production-sensitive changes. |
| Notifications | SMS/Twilio and email/Resend helpers; native Expo push plus optional VAPID web push; role/property recipient filtering and per-device preferences. New-case push skips result.replayed. No complete durable notification deduplication or push receipt processing found. |
| Branding | Black/gold/ivory tokens and Cormorant Garamond, DM Sans, Syncopate fonts present; urgent red. Native splash asset exists but app.json has no explicit splash configuration; verify native appearance rather than treating the asset as wired. |
| Build | app.json uses com.stellar.pma on iOS/Android; EAS internal profile uses real-device iOS and Android APK with auto increment. No EAS project ID/owner or Android googleServicesFile configuration found. Signed build/account readiness unverified. Store profile exists but must not be invoked under current authorization. |

## Release blockers and recommended corrections

| ID | Priority / scope | Verified finding and correction |
|---|---|---|
| A01 | Critical shared infrastructure | Live six-argument pma_voice_session_close_v1 remains alongside protected five-argument version. Six-argument function is SECURITY DEFINER, default PUBLIC execution, default transcript argument and invalid session_id/close_v1 references. Overload ambiguity risk is consistent with prior report; no live close was invoked in this audit. Prepare exact-signature removal with rollback and nonproduction close tests; obtain owner approval before production. |
| A02 | Critical shared infrastructure | Live stellar_create_support_intake has PUBLIC EXECUTE and no authenticated tenant-membership guard. Existing security migration only revokes PUBLIC/anon; authenticated arbitrary tenant ID remains possible by definition. Scope a compatible membership check with CUSTOMER-ENGAGEMENT-OPERATIONS-CENTER consumers and service-role calls; stage and test both products before requesting production approval. |
| A03 | High confidentiality | mobile/src/lib/push.ts unregisterPush catches DELETE failure and then deletes its locally stored token; dashboard signs out regardless. Server recipient selection validates active membership, not signed-in device session. A valid Expo token may continue receiving address/incident text after logout. Dead-token cleanup does not revoke a valid token. Implement acknowledged revocation/retry and define safe offline logout; test offline, 401/403, timeout and shared-device paths. |
| A04 | High notification integrity | PATCH resident updates call notifyResident on every successful request; helper has no durable request ID/outbox/unique delivery key. Vendor request_nte pushes on every successful pending response without replay guard. Approval RPC also has no pending-state compare-and-set. UI busy states do not prevent network replay/concurrent requests. Add server-side idempotency and atomic approval transitions with isolated concurrency tests. |
| A05 | High truthful confirmation | mobile/src/lib/api.ts updateCase returns HTTP-200 bodies without checking success. Case screen shows Saved after it resolves. Other operations explicitly check success. Reject unsuccessful/malformed results and verify error recovery before pilot. |
| A06 | High validation | Existing manager API tests stub verifyManager; mobile tests cover helpers, not native screens/auth. No real-device sign-in, account denial, cross-client/property denial, restart persistence or end-to-end workflow evidence was produced. Use isolated fixtures and actual iPhone + Android. |
| A07 | High build configuration | EAS project ID absent from committed app config; registerForPush returns NO_PROJECT when unavailable. Android Firebase native configuration absent. STELLAR Expo/Apple signing/APNs/FCM credentials, free build allowance and registered pilot devices not verified. Do not infer account absence from repo absence. Verify accounts without exposing keys, then produce signed IPA/APK using available allowance. |
| A08 | High testing isolation | Internal profile points at live API/auth. No verified isolated backend/test tenant and notification destinations established in this session. Build a nonproduction profile and test fixture plan before functional tests that write or notify. |
| A09 | High release controls | New forward migrations and rollback SQL coexist under supabase/migrations with identical timestamp prefixes. An automated migration sweep risks duplicate-version handling or executing reversal scripts. Move manual rollbacks outside the forward migration discovery path and validate a fresh nonproduction replay. Never run an unreviewed blanket db push. |
| A10 | Conditional multi-client gate | SMS/email templates contain Desert Ridge names and fixed contact wording. Server scope is PMA_TENANT_ID/PMA_PROPERTY_ID, one configured property. Client app label does not change server tenant scope or sender branding. Configure per-client templates before second-client onboarding; multi-property support requires explicit design and tests. |
| A11 | Optional web-push scope | Live pma_push_tokens exists with RLS=true, no anon/authenticated SELECT and no authenticated INSERT; ACL grants postgres/service_role only. Live pma_web_push_subscriptions absent. Web push migration/VAPID setup blocks browser alerts, not necessarily a native-only pilot. Do not apply it just to build native apps. |
| A12 | Distribution gate | No signed installation artifact or physical-device evidence. Confirm STELLAR account membership, device limits, provisioning expiry, certificate ownership and pilot eligibility. EAS internal does not itself authorize broad external customer distribution. Keep links private and obtain owner pilot approval before sharing with clients. |

## Documentation reconciliation

1. Blueprint/change record claim pma_mgr_approve_case_v1 exists only live and not in a migration. This is incorrect: supabase/migrations/20261029110000_pma_approval_rpcs.sql defines it at line 183. Selected live implementation has equivalent approval behavior, with minor implementation differences. Do not invent a missing-function migration; compare definitions first.
2. Historical test counts differ by development stage. Fresh current results below supersede those counts for this commit.
3. Launch-guide “fast path” allows security SQL later and starts by merging main. Do not execute that checklist under current instructions. Security assessment, isolated validation and explicit production approval come first.
4. “In-house” must distinguish Apple enterprise employee distribution from registered-device ad hoc testing. Apple Enterprise is for an organization's employees, not an assumed route for client staff.
5. Existing descriptions of guaranteed emergency SMS delivery must not be treated as measured delivery assurance. Unit-test success and provider acceptance are not receipt/device delivery.
6. Spanish SMS/email templates exist; staff interface is English. Full Spanish native UI remains incomplete if required for pilot.
7. Resident app source-channel labels, global rate limits, photos and richer resident features remain documented follow-ups. They are not prerequisites to rebuilding or expanding this staff-only pilot.

## Fresh validation

Environment: Node v24.22.1; Netlify configured Node 22. Node-22 parity remains outstanding.
Commands run after clean npm ci --ignore-scripts at root and mobile; no live messages/cases.

| Check | Result | Evidence / limit |
|---|---|---|
| Root npm test | PASS | 187 tests, zero failures/skips; mock-based suite, ~12.3 seconds. |
| Mobile npm test | PASS | 16 tests, zero failures/skips. Helper/unit coverage, ~185 ms. |
| Mobile npm run typecheck | PASS | tsc --noEmit exit 0. |
| Staff export for iOS, Android and web | PASS | EXPO_OFFLINE=1 CI=1 EXPO_PUBLIC_APP_MODE=staff EXPO_PUBLIC_ENABLE_MANAGER=true expo export --platform all; all three exported successfully. JS/Hermes bundles, not signed native applications. |
| Dependency compatibility | LIMITED | Offline expo install --check says dependencies up to date but explicitly warns validation is unreliable offline. Online doctor/compatibility check outstanding. |
| Lint | BLOCKED | No lint script/config/toolchain established in mobile package. Do not count typecheck as lint or silently install/configure a new linter during audit. |
| Production schema metadata | PASS, selected objects only | Functions/grants and push-table RLS checked read-only. Not a full production security certification. |
| Production deploy provenance | PASS | Netlify published commit matches main f98fca1; Claude app changes not published. |

## Required integration acceptance matrix

PASS means demonstrated end to end on the intended device/backend; mocked unit checks are listed as partial evidence only.

| # | Scenario | Status | Evidence and next action |
|---|---|---|---|
| 1 | Authorized management sign-in | BLOCKED | OTP code path present; need isolated active accounts and real devices/email. |
| 2 | Unauthorized-user denial | BLOCKED | API rejection unit paths pass; real verifyManager is stubbed in API tests. Test inactive/wrong-role/nonmember accounts. |
| 3 | Cross-property/client denial | BLOCKED | Source scoping present; need two isolated clients/properties and direct API/RPC negative tests. A02 is a separate shared-function exposure. |
| 4 | Existing voice creates synchronized case | BLOCKED | Voice unit suite passes; no real test voice call made. Use nonproduction routing. |
| 5 | New-case delivery | BLOCKED | Push unit tests pass; no provider/device receipt. |
| 6 | Emergency escalation | BLOCKED | Detection unit tests pass; validate flooding/severity and controlled destinations end to end. |
| 7 | Provider assignment | BLOCKED | RPC/API wiring tested with stubs; need isolated provider/case fixtures. |
| 8 | Cost approval/rejection | BLOCKED | Wiring present; test pending/duplicate/concurrent decisions and audit trail. |
| 9 | Resident updates | BLOCKED | SMS/email unit tests pass; real isolated delivery and accurate outcomes outstanding. |
| 10 | Duplicate prevention | BLOCKED | New-case replay test passes; resident-update and approval durable deduplication incomplete (A04). |
| 11 | iOS push | BLOCKED | Need signed provisioned build, APNs credentials, registered iPhone and receipt. |
| 12 | Android push | BLOCKED | Need signed APK, Firebase config/credentials and Android device receipt. |
| 13 | Logout/token removal | BLOCKED | Failure-path defect A03; real logout/revocation acceptance pending. |
| 14 | API failure/recovery | BLOCKED | Error handling present; native outage, ambiguous-success/retry and A05 tests needed. |
| 15 | Restart/session persistence | BLOCKED | SecureStore/session source exists; actual restart/refresh/expiry testing pending. |
| 16 | English/Spanish supported workflows | BLOCKED | Templates support language; device/backend tests pending; staff UI English. |

## Production-sensitive changes versus main

Review separately before merge: cedar-elevenlabs.js shared intake extraction/new push; pma-intake-flow.js; pma-manager-api.js approval fields/resident notifications/push endpoints; pma-vendor.js approval push; pma-sms.js and pma-email.js; pma-sip-store.js; manager.html; netlify.toml web build/routes/timeouts and script; database migrations. Native builds alone cannot deliver branch-only server features against currently published main.

## Recommended sequence and gates

1. Continue authorized development on dedicated fix/release branches: truthful API outcomes, secure logout, durable notification idempotency, atomic approvals, authorization tests and migration organization.
2. Establish isolated staging with synthetic data and safe notification destinations. Reconcile shared-product support-intake dependencies, prepare forward correction plus rollback, and test schema replay.
3. Verify STELLAR-owned signing/build accounts and remaining free allowance; configure EAS/APNs/FCM and create private device builds without purchasing services.
4. Execute all 16 acceptance scenarios on real iPhone/Android; retain version, device/OS, timestamp, synthetic case IDs and delivery evidence.
5. Present exact reviewed migration and deployment changes with staging evidence for owner approval. No production change is authorized by this audit.
6. Prepare final one-page installation/update guide only with verified artifact links and provisioning limitations; owner must approve client pilot distribution.

### Distribution reference checks

- Expo internal distribution: https://docs.expo.dev/build/internal-distribution/
- Apple registered devices: https://developer.apple.com/help/account/devices/devices-overview/
- Apple Enterprise eligibility: https://developer.apple.com/programs/enterprise/

Reviewed November 8, 2026. Expo documents ad hoc signing for registered iOS devices and APK internal builds. Apple documents up to 100 devices per product family per membership year. This is not unlimited client deployment, and this audit has not verified STELLAR membership/signing eligibility.
