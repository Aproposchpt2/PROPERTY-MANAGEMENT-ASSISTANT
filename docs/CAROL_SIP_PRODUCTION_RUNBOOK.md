# Carol SIP production-validation runbook

## Authoritative deployment

- Repository: `Aproposchpt2/PROPERTY-MANAGEMENT-ASSISTANT`
- Deployment branch: `main`
- Site: `https://pma.stellaruc.com`
- Webhook: `https://pma.stellaruc.com/api/intake/carol-sip-openai`
- Supabase project: `vqrqyanqsiqzsmlhytaz`
- Twilio trunk: `TK69a2c74346cedc6dda18c892cf5eb6b7`
- OpenAI project: `proj_OJFvFXah4kyyNHzbtlswcS5Q`

The standalone PMA repository and its `main` branch are the only production-validation source of truth. The former `pma-validation` staging site is not part of this call path.

## Call path

1. Twilio Elastic SIP sends the call directly to the OpenAI Realtime SIP project.
2. OpenAI sends `realtime.call.incoming` to the production webhook.
3. The webhook verifies the OpenAI signature, dedicated caller, Twilio `Diversion` DID, and the static trunk admission token.
4. Carol collects the caller-reported name, address, unit and verbatim incident description.
5. `create_incident` is the sole creation tool. A database-confirmed result is required before Carol reads a case number.
6. Carol records the caller's explicitly consented contact preference and closes the session.

## Required Twilio origination URI

The existing OpenAI SIP URI must retain `;transport=tls` and include exactly one static header:

```text
sip:OPENAI_PROJECT_ID@sip.api.openai.com;transport=tls?X-Stellar-Trunk-Token=SECRET_VALUE
```

Never commit or paste the token into tickets, screenshots or logs. The dialed number is verified from Twilio's standard `Diversion` header; no fabricated dynamic Call SID header is required.

## Runtime controls

- `PMA_SIP_ENABLED=false` rejects before accepting any call.
- `PMA_SIP_ENABLED=true` permits only the pinned production-validation configuration.
- `PMA_RUNTIME_MODE` must be `production-validation`.
- `PMA_BASE_URL` must be `https://pma.stellaruc.com`.
- `SUPABASE_URL` must be `https://vqrqyanqsiqzsmlhytaz.supabase.co`.
- The service-role key is server-only and must never be exposed to the browser.

The `pma_voice_*_v1` RPCs are executable only by `service_role`. The `pma_voice_sessions` table has RLS enabled and grants revoked from `public`, `anon`, and `authenticated`; therefore, the Supabase advisory that it has no client policy is intentional.

## Validation order

1. Run `npm ci`, `npm test`, `npm audit --omit=dev --audit-level=high`, and JavaScript syntax checks.
2. Apply the Supabase migrations and execute the rollback-only database workflow test.
3. Deploy with `PMA_SIP_ENABLED=false` and confirm the webhook returns `405` to GET and `503` to an unsigned POST.
4. Update the OpenAI webhook to the production URL.
5. Add the trunk admission token to the Twilio origination URI.
6. Enable `PMA_SIP_ENABLED=true`, redeploy, and place one owner-authorized call from the allowlisted number.
7. Verify one `pma_voice_sessions` row, one `pma_maintenance_requests` row, the exact case number, and no invented notification or vendor status.

## Rollback

Set `PMA_SIP_ENABLED=false` and redeploy first. Then restore the OpenAI webhook to the prior URL or disable it, and remove the Twilio origination token/route if necessary. Database migrations are additive and can remain in place; existing PMA records are not rewritten or deleted.
